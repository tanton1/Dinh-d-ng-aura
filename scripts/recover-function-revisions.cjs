'use strict'

// Recover an existing failed rollout, never rebuild arbitrary working-tree code.
// The previous ready revision keeps traffic until the pinned latest image is Ready.
const fs = require('node:fs')
const path = require('node:path')
const { createHash } = require('node:crypto')
const { mapBounded } = require('./audit-function-regions.cjs')
const PROJECT = 'gen-lang-client-0815966909'
const REGIONS = ['asia-southeast1', 'asia-east1', 'asia-southeast2']
// Cloud Run limits the combined service/tag name to 46 characters.
const STAGING_TAG = 'rvc'
const short = (value) => String(value || '').split('/').at(-1) || ''
const arg = (name, fallback = '') => process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3) || fallback
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex')

function latestReady(service) {
  return Boolean(service.latestCreatedRevision && service.latestCreatedRevision === service.latestReadyRevision)
}
function servingLatest(service) {
  return latestReady(service) && service.trafficStatuses?.some((target) => Number(target.percent) === 100 && short(target.revision) === short(service.latestCreatedRevision))
}
function assertReadyForPromotion(service, revision, expectedImage) {
  if (service.reconciling || !latestReady(service) || revision.name !== service.latestReadyRevision) throw new Error('Latest revision is not ready for promotion.')
  if (!(revision.conditions || []).some((condition) => condition.type === 'Ready' && condition.state === 'CONDITION_SUCCEEDED')
    || !(revision.conditions || []).some((condition) => condition.type === 'ContainerHealthy' && condition.state === 'CONDITION_SUCCEEDED')
    || (revision.conditions || []).some((condition) => condition.revisionReason === 'RETIRED')) throw new Error('New revision has not passed its container health check.')
  if (revision.containers?.[0]?.image !== expectedImage) throw new Error('Ready image digest differs from the approved latest image.')
}
function pinnedTraffic(service) {
  const targets = (service.trafficStatuses || []).filter((target) => !([STAGING_TAG, 'aura-revision-check'].includes(target.tag) && !Number(target.percent)))
  if (!service.latestReadyRevision && !targets.length) return []
  if (targets.length !== 1 || Number(targets[0].percent) !== 100 || targets[0].tag
    || short(targets[0].revision) !== short(service.latestReadyRevision)) throw new Error('Custom or ambiguous traffic split; manual review required.')
  return [{ type: 'TRAFFIC_TARGET_ALLOCATION_TYPE_REVISION', revision: short(service.latestReadyRevision), percent: 100 }]
}
function recoveryBody(service, revision, functionName, { disableStartupBoost = false } = {}) {
  if (service.reconciling) throw new Error('Another rollout is in progress.')
  if (service.latestCreatedRevision !== revision.name) throw new Error('Latest revision changed; re-plan required.')
  if (service.latestReadyRevision && short(service.name).length + STAGING_TAG.length > 46) throw new Error('Service name is too long for zero-traffic staging; separate readiness-gated rollout required.')
  if (Number(service.scaling?.minInstanceCount || 0) || Number(service.template?.scaling?.minInstanceCount || 0)) throw new Error('Warm floor is enabled; review before recovery.')
  const containers = service.template?.containers || []
  if (containers.length !== 1 || revision.containers?.length !== 1) throw new Error('Only a single managed function container is supported.')
  const target = containers[0].env?.find((item) => item.name === 'FUNCTION_TARGET')?.value
  if (target !== functionName) throw new Error('Function entrypoint mismatch.')
  const image = revision.containers[0].image
  const prefix = `${service.name.split('/')[3]}-docker.pkg.dev/${PROJECT}/gcf-artifacts/`
  if (!image?.startsWith(prefix) || !/@sha256:[a-f0-9]{64}$/.test(image)) throw new Error('A resolved managed image digest is required.')
  return {
    name: service.name, etag: service.etag,
    template: { revision: '', containers: [{ ...containers[0], image, ...(disableStartupBoost ? { resources: { ...containers[0].resources, startupCpuBoost: false } } : {}) }] },
    ...(service.latestReadyRevision ? { traffic: [...pinnedTraffic(service), { type: 'TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST', percent: 0, tag: STAGING_TAG }] } : {}),
  }
}
function validatePlan(plan) {
  if (plan.project !== PROJECT || plan.schemaVersion !== 1 || !Array.isArray(plan.targets)) throw new Error('Invalid recovery plan.')
  const age = Date.now() - Date.parse(plan.createdAt)
  if (!Number.isFinite(age) || age < -60_000 || age > 24 * 3600_000) throw new Error('Recovery plan date is invalid or over 24 hours old.')
  const seen = new Set()
  for (const item of plan.targets) {
    if (!REGIONS.includes(item.region) || !/^[A-Za-z][A-Za-z0-9]+$/.test(item.function)
      || !/^[a-z][a-z0-9]+$/.test(item.service)
      || !item.expectedCreated?.startsWith(`projects/${PROJECT}/locations/${item.region}/services/${item.service}/revisions/`)) throw new Error('Plan target is outside scope.')
    const key = `${item.region}/${item.service}`
    if (seen.has(key)) throw new Error('Duplicate plan target.')
    seen.add(key)
  }
}
async function main() {
  let tokenAt = 0
  let token = ''
  async function headers() {
    if (!token || Date.now() - tokenAt > 40 * 60_000) {
      const auth = require(path.join(process.env.APPDATA, 'npm', 'node_modules', 'firebase-tools', 'lib', 'auth.js'))
      const account = auth.getProjectDefaultAccount(process.cwd()) || auth.getGlobalDefaultAccount()
      token = (await auth.getAccessToken(account.tokens.refresh_token, [])).access_token
      tokenAt = Date.now()
    }
    return { authorization: `Bearer ${token}`, 'content-type': 'application/json' }
  }
  async function api(url, options = {}) {
    // No automatic mutation retry: after an uncertain PATCH, inspect the
    // service/operation instead of accidentally creating another revision.
    const response = await fetch(url, { ...options, headers: await headers(), signal: AbortSignal.timeout(45_000) })
    const payload = await response.json()
    if (!response.ok) throw new Error(`API ${response.status}: ${String(payload.error?.message || 'request failed').split('\n')[0].slice(0, 300)}`)
    return payload
  }
  async function list(url, field) {
    const result = []
    const request = new URL(url)
    do {
      const payload = await api(request)
      result.push(...(payload[field] || []))
      if (!payload.nextPageToken) return result
      request.searchParams.set('pageToken', payload.nextPageToken)
    } while (true)
  }
  async function operationDone(operation, timeoutMs = 600_000) {
    const deadline = Date.now() + timeoutMs
    while (!operation.done) {
      if (Date.now() >= deadline) throw new Error(`Operation still pending: ${operation.name}`)
      await sleep(2500)
      operation = await api(`https://run.googleapis.com/v2/${operation.name}`)
    }
    if (operation.error) throw new Error(String(operation.error.message || 'Operation failed').split('\n')[0])
    return operation
  }
  const planFile = path.resolve(arg('plan', 'tmp/function-revision-recovery-plan.json'))
  const selected = new Set(arg('functions').split(',').filter(Boolean))
  const excludedNames = new Set(arg('exclude').split(',').filter(Boolean))
  const reviewedStartupTimeouts = process.argv.includes('--reviewed-startup-timeouts')
  if (reviewedStartupTimeouts && !selected.size) throw new Error('Reviewed startup retries require explicit function names after inspecting revision logs.')
  if ([...selected].some((name) => excludedNames.has(name))) throw new Error('A function cannot be both selected and excluded.')
  if (!process.argv.includes('--apply')) {
    const functions = await list(`https://cloudfunctions.googleapis.com/v2/projects/${PROJECT}/locations/-/functions?pageSize=1000`, 'functions')
    const services = (await Promise.all(REGIONS.map((region) => list(`https://run.googleapis.com/v2/projects/${PROJECT}/locations/${region}/services?pageSize=100`, 'services')))).flat()
    const byName = new Map(services.map((service) => [service.name, service]))
    const targets = []
    const excluded = []
    await mapBounded(functions, async (fn) => {
      const name = short(fn.name)
      if ((selected.size && !selected.has(name)) || excludedNames.has(name)) return
      const service = byName.get(fn.serviceConfig?.service)
      if (!service || servingLatest(service)) return
      let reason = String(service.terminalCondition?.message || '')
      try {
        if (service.reconciling) throw new Error('Rollout in progress')
        if (!/quota.*CPU|CPU.*quota/i.test(reason)) {
          const revision = await api(`https://run.googleapis.com/v2/${service.latestCreatedRevision}`)
          const conditions = revision.conditions || []
          if (conditions.some((condition) => condition.revisionReason === 'RETIRED')) reason = 'Latest revision was retired without live traffic; verify via a zero-traffic tag.'
          else if (conditions.some((condition) => condition.type === 'ContainerHealthy' && condition.state === 'CONDITION_SUCCEEDED')) reason = 'Latest container is healthy but traffic is pinned to an older revision.'
          else if (conditions.some((condition) => /quota.*CPU|CPU.*quota/i.test(condition.message || ''))) reason = 'Latest revision CPU quota failure.'
          else if (reviewedStartupTimeouts && conditions.some((condition) => condition.type === 'ContainerHealthy' && /Startup probes timed out/.test(condition.message || ''))) reason = 'Startup timeout reviewed separately; retry the same immutable artifact behind zero-traffic staging.'
          else throw new Error('Unexplained container startup failure; inspect logs before recovery')
        }
        pinnedTraffic(service)
        targets.push({ function: name, region: fn.name.split('/')[3], service: short(service.name), expectedCreated: service.latestCreatedRevision, previousReady: service.latestReadyRevision || null, reason: reason.split('\n')[0], kind: fn.eventTrigger ? 'event-trigger' : fn.labels?.['deployment-scheduled'] === 'true' ? 'scheduled' : 'callable', cpu: fn.serviceConfig?.availableCpu, maxInstances: fn.serviceConfig?.maxInstanceCount })
      } catch (error) { excluded.push({ function: name, reason: error.message }) }
    })
    // Canary first; then restore the in-use overflow pool before the legacy fleet.
    targets.sort((a, b) => (a.previousReady ? 1 : 0) - (b.previousReady ? 1 : 0) || a.region.localeCompare(b.region) || a.function.localeCompare(b.function))
    const plan = { schemaVersion: 1, project: PROJECT, createdAt: new Date().toISOString(), targets, excluded }
    validatePlan(plan)
    fs.mkdirSync(path.dirname(planFile), { recursive: true })
    fs.writeFileSync(planFile, JSON.stringify(plan, null, 2))
    console.log(JSON.stringify({ planFile, targets: targets.length, regions: Object.fromEntries(REGIONS.map((region) => [region, targets.filter((item) => item.region === region).length])), excluded }, null, 2))
    return
  }
  if (arg('confirm') !== `${PROJECT}/revision-recovery`) throw new Error(`Apply requires --confirm=${PROJECT}/revision-recovery`)
  const plan = JSON.parse(fs.readFileSync(planFile, 'utf8'))
  validatePlan(plan)
  const targets = plan.targets.filter((item) => (!selected.size || selected.has(item.function)) && !excludedNames.has(item.function))
  if (selected.size && targets.length !== selected.size) throw new Error('Requested function is not present in the frozen recovery plan.')
  if ([...excludedNames].some((name) => !plan.targets.some((item) => item.function === name))) throw new Error('Excluded function is not present in the frozen recovery plan.')
  const disableStartupBoost = process.argv.includes('--disable-startup-boost')
  if (disableStartupBoost && (!selected.size || targets.some((item) => !['event-trigger', 'scheduled'].includes(item.kind)))) throw new Error('Disabling startup boost requires an explicit background-function selection.')
  const journalFile = path.resolve(arg('journal', 'tmp/function-revision-recovery-results.json'))
  const journal = fs.existsSync(journalFile) ? JSON.parse(fs.readFileSync(journalFile, 'utf8')) : { project: PROJECT, planDigest: digest(plan), results: [] }
  if (journal.project !== PROJECT || journal.planDigest !== digest(plan)) throw new Error('Journal does not match this plan.')
  let failed = false
  function record(result) {
    journal.results.push({ ...result, at: new Date().toISOString() })
    fs.mkdirSync(path.dirname(journalFile), { recursive: true })
    fs.writeFileSync(journalFile, JSON.stringify(journal, null, 2))
    console.log(JSON.stringify(result))
  }
  async function promoteReady(item, ready, expectedImage, previousReady, resumed = false) {
    const name = ready.name
    const url = `https://run.googleapis.com/v2/${name}`
    const readyRevision = await api(`https://run.googleapis.com/v2/${ready.latestReadyRevision}`)
    assertReadyForPromotion(ready, readyRevision, expectedImage)
    const promote = await api(`${url}?updateMask=traffic`, { method: 'PATCH', body: JSON.stringify({ name, etag: ready.etag, traffic: [{ type: 'TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST', percent: 100 }] }) })
    await operationDone(promote, 120_000)
    const live = await api(url)
    if (live.latestCreatedRevision !== ready.latestReadyRevision || !servingLatest(live)) throw new Error('Latest revision is not serving 100 percent.')
    record({ function: item.function, region: item.region, status: 'recovered', previousReady: short(previousReady), revision: short(live.latestReadyRevision), resumed })
  }
  async function recover(item) {
    const name = `projects/${PROJECT}/locations/${item.region}/services/${item.service}`
    const url = `https://run.googleapis.com/v2/${name}`
    const before = await api(url)
    if (servingLatest(before)) return record({ function: item.function, region: item.region, status: 'already_ready', revision: short(before.latestReadyRevision) })
    if (latestReady(before) && before.latestCreatedRevision !== item.expectedCreated) {
      // A timed-out API wait is NOT a failed rollout. Resume only a ready
      // candidate proven to be created by this exact journal/plan operation.
      const records = journal.results.filter((entry) => entry.function === item.function && entry.region === item.region)
      const ownOperation = records.findLast((entry) => entry.status === 'operation')
      const ownStart = records.findLast((entry) => entry.status === 'started')
      if (ownOperation && ownStart) {
        const completed = await api(`https://run.googleapis.com/v2/${ownOperation.operation}`)
        const active = (before.trafficStatuses || []).filter((target) => Number(target.percent))
        if (completed.done && !completed.error && completed.response?.latestCreatedRevision === before.latestCreatedRevision
          && active.length === 1 && active[0].percent === 100 && short(active[0].revision) === ownStart.previousReady) {
          const original = await api(`https://run.googleapis.com/v2/${item.expectedCreated}`)
          if (original.containers?.[0]?.image?.split('@')[1] !== ownStart.imageDigest) throw new Error('Journal image digest does not match the frozen source revision.')
          return promoteReady(item, before, original.containers[0].image, ownStart.previousReady, true)
        }
      }
      throw new Error('Ready candidate is not proven to belong to this recovery operation; manual review required.')
    }
    if (before.latestCreatedRevision !== item.expectedCreated) throw new Error('Revision changed since plan; refusing to overwrite concurrent work.')
    const previous = pinnedTraffic(before)
    const revision = await api(`https://run.googleapis.com/v2/${before.latestCreatedRevision}`)
    const body = recoveryBody(before, revision, item.function, { disableStartupBoost })
    record({ function: item.function, region: item.region, status: 'started', previousReady: short(before.latestReadyRevision), imageDigest: revision.containers[0].image.split('@')[1], disableStartupBoost })
    const operation = await api(`${url}?updateMask=template.revision,template.containers${previous.length ? ',traffic' : ''}&forceNewRevision=true`, { method: 'PATCH', body: JSON.stringify(body) })
    record({ function: item.function, region: item.region, status: 'operation', operation: operation.name })
    await operationDone(operation)
    const ready = await api(url)
    if (!latestReady(ready) || ready.latestCreatedRevision === before.latestCreatedRevision) throw new Error('New revision did not become Ready.')
    await promoteReady(item, ready, revision.containers[0].image, before.latestReadyRevision)
  }
  const concurrency = Math.max(1, Math.min(2, Number(arg('concurrency', '1')) || 1))
  // At most two starts PER REGION; stop scheduling new work after any error.
  await Promise.all(REGIONS.map(async (region) => {
    const queue = targets.filter((item) => item.region === region)
    let index = 0
    await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
      while (!failed && index < queue.length) {
        const item = queue[index++]
        try { await recover(item) }
        catch (error) {
          failed = true
          record({ function: item.function, region: item.region, status: 'failed', error: error.message })
        }
      }
    }))
  }))
  const recovered = journal.results.filter((item) => item.status === 'recovered').length
  console.log(JSON.stringify({ journalFile, recovered, failed }))
  if (failed) process.exitCode = 1
}

if (require.main === module) main().catch((error) => { console.error(error.message); process.exitCode = 1 })
module.exports = { latestReady, servingLatest, assertReadyForPromotion, pinnedTraffic, recoveryBody, validatePlan }
