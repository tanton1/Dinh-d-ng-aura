'use strict'

// Offline evidence join only. No business module imports, network, deployment,
// lifecycle decisions, or inference that an endpoint is unused.
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { sourceSnapshot } = require('./evaluate-function-lifecycle.cjs')
const { auditProject } = require('./audit-callable-usage.cjs')
const KINDS = new Set(['sdk', 'inventory', 'health', 'activity', 'telemetry', 'review', 'historical'])
const TRIGGERS = { callableTrigger: 'callable', httpsTrigger: 'http', eventTrigger: 'event-trigger', scheduleTrigger: 'scheduled', taskQueueTrigger: 'task-queue', blockingTrigger: 'blocking' }
const NAME = /^[A-Za-z][A-Za-z0-9_]{0,100}$/
const REGION = /^[a-z]+-[a-z]+[0-9]+$/
const PROJECT = /^[a-z][a-z0-9-]{4,62}$/
const SERVICE = /^[a-z][a-z0-9-]{0,62}$/
const sha = value => crypto.createHash('sha256').update(value).digest('hex')
const finite = value => typeof value === 'number' && Number.isFinite(value) && value >= 0
const date = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null
const short = value => typeof value === 'string' ? value.split('/').at(-1) : null
const safe = (value, pattern) => typeof value === 'string' && pattern.test(value) ? value : null
const sourceIdentity = source => ({ commit: safe(source?.commit, /^[a-f0-9]{40}$/), digest: safe(source?.digest, /^[a-f0-9]{64}$/) })
function resourceName(value, project, region, service = null) {
  if (typeof value !== 'string') return null
  if (!value.includes('/')) return safe(value, SERVICE)
  const match = /^projects\/([^/]+)\/locations\/([^/]+)\/services\/([^/]+)(?:\/revisions\/([^/]+))?$/.exec(value)
  if (!match || match[1] !== project || match[2] !== region || (service ? match[3] !== service || !match[4] : match[4])) return null
  return safe(service ? match[4] : match[3], SERVICE)
}
const sameSource = (a, b) => Boolean(a?.commit && a?.digest && a.commit === b?.commit && a.digest === b?.digest)
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const sourceLocation = value => {
  const file = safe(value?.file, /^(?:src|functions|scripts|tests)\/[A-Za-z0-9_./ -]+\.[cm]?[jt]sx?$/)
  return file && !file.split('/').includes('..') ? { file, line: Number.isSafeInteger(value.line) && value.line > 0 ? value.line : null } : null
}
const observation = (artifact, value, status = artifact.status) => ({ artifact: artifact.id, status, value })
function fact(observations = []) {
  const known = observations.filter(row => row.status === 'known')
  if (known.some(row => !same(row.value, known[0].value))) return { status: 'conflicting', value: null, observations }
  if (known.length) return { status: 'known', value: known[0].value, observations }
  const status = observations.some(row => row.status === 'partial') ? 'partial' : observations.some(row => row.status === 'stale') ? 'stale' : 'unknown'
  return { status, value: null, observations }
}
function invalidInventoryRows(data, project) {
  if (!Array.isArray(data.functions)) return 0
  const scope = Array.isArray(data.scope?.regions) ? data.scope.regions : null
  const seen = new Set()
  return data.functions.filter(item => {
    if (!item || !safe(item.name, NAME) || !safe(item.region, REGION)) return true
    const key = `${item.region}/${item.name}`, duplicate = seen.has(key)
    seen.add(key)
    if (duplicate || (scope && !scope.includes(item.region))) return true
    const service = resourceName(item.service, project, item.region)
    if (item.service != null && !service) return true
    const revision = value => service && resourceName(value, project, item.region, service)
    if (['latestCreatedRevision', 'latestReadyRevision'].some(key => item[key] != null && !revision(item[key]))) return true
    if (item.traffic != null && !Array.isArray(item.traffic)) return true
    return (item.traffic || []).some(target => !target || !finite(target.percent) || target.percent > 100 || !revision(target.revision))
  }).length
}
function artifactInfo(input, index, { project, source, now, maxAgeHours }) {
  const data = input.data || {}, observedAt = date(data.observedAt || data.generatedAt || data.checkedAt)
  const identity = sourceIdentity(data.source)
  const binding = sameSource(identity, source) ? 'matched' : identity.commit || identity.digest ? 'mismatched' : 'unknown'
  const target = safe(data.project, PROJECT)
  // Raw local SDK maps and old routing summaries may lack project metadata.
  // Neither supplies cloud deployment evidence or joins historical counters.
  const projectAccepted = target === project || (!target && ['sdk', 'historical'].includes(input.kind))
  const shapeValid = input.kind === 'inventory' ? Array.isArray(data.functions)
    : input.kind === 'health' ? Array.isArray(data.services) && REGION.test(data.region || '')
      : input.kind === 'activity' ? data.windows && typeof data.windows === 'object' && !Array.isArray(data.windows)
        : input.kind === 'telemetry' ? Array.isArray(data.operations)
          : input.kind === 'review' ? Array.isArray(data.entries)
            : data && typeof data === 'object' && !Array.isArray(data)
  const accepted = projectAccepted && Boolean(shapeValid)
  const invalidRows = input.kind === 'inventory' ? invalidInventoryRows(data, project) : 0
  const incomplete = data.complete === false || (Array.isArray(data.warnings) && data.warnings.length > 0) || invalidRows > 0
  const age = observedAt ? Date.parse(now) - Date.parse(observedAt) : null
  let status = incomplete ? 'partial' : age === null || age < -300_000 ? 'unknown' : age > maxAgeHours * 3_600_000 ? 'stale' : 'known'
  if (['sdk', 'review'].includes(input.kind) && binding !== 'matched') status = binding === 'mismatched' ? 'stale' : 'unknown'
  if (input.kind === 'historical') status = 'stale'
  if (!accepted) status = 'unknown'
  return { id: `${input.kind}:${index}`, kind: input.kind, sha256: safe(input.sha256, /^[a-f0-9]{64}$/) || sha(JSON.stringify(data)), project: target,
    accepted, observedAt, source: identity, sourceBinding: binding, status,
    complete: incomplete ? false : typeof data.complete === 'boolean' ? data.complete : null, invalidRows,
    scope: { regions: (Array.isArray(data.scope?.regions) ? data.scope.regions : data.region ? [data.region] : []).filter(region => REGION.test(region)) },
    issues: [...(!projectAccepted ? ['PROJECT_MISSING_OR_MISMATCHED'] : []), ...(!shapeValid ? ['INPUT_SHAPE_INVALID'] : []), ...(invalidRows ? ['INVALID_OR_DUPLICATE_INVENTORY_ROWS'] : []), ...(incomplete ? ['PARTIAL_INPUT'] : []),
      ...(!observedAt ? ['OBSERVATION_TIME_UNKNOWN'] : []), ...(age !== null && age < -300_000 ? ['FUTURE_OBSERVATION'] : [])] }
}
function sdkEntries(data) {
  if (Array.isArray(data.matrix)) return data.matrix.flatMap(mode => Object.entries(mode.selectedEndpoints || {}).map(([name, value]) => ({ name, ...value, selectedOnly: true })))
  return Object.entries(data.endpoints || data).filter(([name, value]) => NAME.test(name) && value?.endpoint).map(([name, value]) => ({ name, ...value }))
}
function buildManifest({ project, source, staticAudit, inputs = [], registry = null, now = new Date().toISOString(), maxAgeHours = 24 }) {
  if (!PROJECT.test(project) || !date(now) || !(maxAgeHours > 0 && maxAgeHours <= 168) || !sameSource(sourceIdentity(source), source) || !sameSource(source, staticAudit?.source) || staticAudit?.snapshotStable !== true) throw Error('A stable, commit-and-digest-bound static audit is required.')
  if (!Array.isArray(inputs) || inputs.some(input => !KINDS.has(input.kind))) throw Error('Unknown evidence kind.')
  const artifacts = inputs.map((input, index) => artifactInfo(input, index, { project, source, now, maxAgeHours }))
  const rows = new Map(), sourceExports = new Map((staticAudit.backendExports || []).filter(x => NAME.test(x.name)).map(x => [x.name, x]))
  const ensure = (name, region) => {
    if (!NAME.test(name || '') || (region !== null && !REGION.test(region || ''))) return null
    const id = `${project}/${region || '?'}/${name}`
    if (!rows.has(id)) rows.set(id, { id, project, region, name, sourceObserved: false, cloudObserved: false, sourceRegionConfirmed: false,
      kind: [], service: [], state: [], serving: [], latest: [], consumers: [], handlerCandidates: [], review: [], observations: [] })
    return rows.get(id)
  }
  inputs.forEach((input, index) => {
    const artifact = artifacts[index], data = input.data || {}
    if (!artifact.accepted) return
    if (input.kind === 'sdk') for (const entry of sdkEntries(data)) {
      const endpoint = entry.endpoint || {}, kinds = Object.entries(TRIGGERS).filter(([key]) => endpoint[key]).map(([, kind]) => kind)
      for (const region of Array.isArray(endpoint.region) ? endpoint.region : []) {
        const row = ensure(entry.name, region)
        if (!row) continue
        row.sourceObserved ||= sourceExports.has(entry.name)
        row.sourceRegionConfirmed ||= artifact.status === 'known' && sourceExports.has(entry.name)
        row.kind.push(observation(artifact, kinds.length === 1 ? kinds[0] : null, kinds.length === 1 ? artifact.status : 'unknown'))
      }
      if (entry.selectedOnly) { artifact.complete = false; if (!artifact.issues.includes('SELECTED_ENDPOINTS_ONLY')) artifact.issues.push('SELECTED_ENDPOINTS_ONLY') }
    }
    if (input.kind === 'inventory') for (const item of Array.isArray(data.functions) ? data.functions : []) {
      if (!item || typeof item !== 'object') continue
      const row = ensure(item.name, item.region)
      if (!row) continue
      row.cloudObserved = true
      const service = resourceName(item.service, project, item.region)
      if (service) row.service.push(observation(artifact, service))
      const kind = Object.values(TRIGGERS).includes(item.kind) ? item.kind : null
      if (kind) row.kind.push(observation(artifact, kind))
      const state = ['ACTIVE', 'FAILED', 'DEPLOYING', 'DELETING', 'UNKNOWN', 'OFFLINE'].includes(item.state) ? item.state : null
      if (state) row.state.push(observation(artifact, state))
      const revision = value => service ? resourceName(value, project, item.region, service) : null
      row.latest.push(observation(artifact, { created: revision(item.latestCreatedRevision), ready: revision(item.latestReadyRevision) }))
      const traffic = (Array.isArray(item.traffic) ? item.traffic : []).filter(x => x && finite(x.percent) && x.percent > 0 && x.percent <= 100 && revision(x.revision)).map(x => ({ revision: revision(x.revision), percent: x.percent })).sort((a, b) => a.revision.localeCompare(b.revision))
      // Traffic is routing metadata, not a check of the serving container.
      row.serving.push(observation(artifact, { traffic, health: ['healthy', 'unhealthy', 'unknown', 'not_verified'].includes(item.servingHealth?.status) ? item.servingHealth.status : 'not_verified' }))
    }
  })
  for (const name of sourceExports.keys()) if (![...rows.values()].some(row => row.name === name && row.sourceObserved)) ensure(name, null).sourceObserved = true
  const sourceArtifact = { id: 'source:current', status: 'known' }
  for (const row of rows.values()) {
    const exported = sourceExports.get(row.name)
    if (exported) {
      row.handlerCandidates = (exported.sourceDefinitions || []).map(file => sourceLocation({ file })).filter(Boolean)
      row.registrationLocations = (exported.bindings || []).map(sourceLocation).filter(Boolean)
      const consumer = (staticAudit.frontendCallables || []).find(x => x.name === row.name)
      row.consumers = (consumer?.references || []).map(x => {
        const location = sourceLocation(x)
        return location ? { ...location, directTransport: x.directTransport === true, dynamic: x.dynamic === true,
          possibleRegions: (x.possibleRegions || []).filter(region => REGION.test(region)), status: 'static-candidate' } : null
      }).filter(Boolean)
      if (!row.kind.length) for (const kind of exported.kinds || []) if (Object.values(TRIGGERS).includes(kind)) row.kind.push(observation(sourceArtifact, kind))
    }
  }
  const historical = [], unmatchedEvidence = []
  const joinedStatus = (row, artifact) => {
    const mapping = fact(row.service)
    return mapping.status === 'known' ? artifact.status : mapping.status === 'stale' ? 'stale' : 'unknown'
  }
  inputs.forEach((input, index) => {
    const artifact = artifacts[index], data = input.data || {}
    if (!artifact.accepted) return
    const matchService = (region, service) => [...rows.values()].filter(row => {
      if (row.region !== region || !service) return false
      const current = fact(row.service)
      // An older mapping must not borrow the authority of a fresh, different
      // mapping for the same export. Unresolved matches stay unresolved below.
      return current.status === 'known' ? current.value === service : row.service.some(x => x.value === service)
    })
    if (input.kind === 'health') for (const item of Array.isArray(data.services) ? data.services : []) {
      const service = resourceName(item.name, project, data.region), matches = matchService(data.region, service)
      if (matches.length !== 1) { unmatchedEvidence.push({ artifact: artifact.id, reason: matches.length ? 'AMBIGUOUS_SERVICE_MAPPING' : 'SERVICE_MAPPING_UNKNOWN' }); continue }
      const row = matches[0], mapping = fact(row.service)
      const status = mapping.status === 'known' ? artifact.status : mapping.status === 'stale' ? 'stale' : 'unknown'
      // Strict release success proves that exact created/ready revision serves;
      // failure does not mean an older serving revision is down.
      const revisions = Array.isArray(item.servingHealth?.revisions) ? item.servingHealth.revisions : []
      const revision = value => resourceName(value, project, data.region, service)
      let value = { traffic: revisions.filter(x => finite(x.percent) && x.percent > 0 && x.percent <= 100 && revision(x.revision)).map(x => ({ revision: revision(x.revision), percent: x.percent })),
        health: ['healthy', 'unhealthy', 'unknown'].includes(item.servingHealth?.status) ? item.servingHealth.status : 'not_verified' }
      if (data.mode === 'release' && item.ready === true && item.status === 'healthy' && item.createdRevision === item.readyRevision && revision(item.createdRevision)) value = { traffic: [{ revision: revision(item.createdRevision), percent: 100 }], health: 'healthy' }
      row.observations.push({ type: 'health', ...observation(artifact, value, status) })
    }
    if (input.kind === 'activity') for (const window of Object.values(data.windows || {})) {
      const start = date(window?.start), end = date(window?.end)
      if (!start || !end || end <= start || Date.parse(end) > Date.parse(now) + 300_000) { unmatchedEvidence.push({ artifact: artifact.id, reason: 'INVALID_OBSERVATION_WINDOW' }); continue }
      for (const group of Array.isArray(window.groups) ? window.groups : []) {
        const [region, service, extra] = typeof group.key === 'string' ? group.key.split('/') : []
        if (extra || !REGION.test(region || '') || !SERVICE.test(service || '') || !finite(group.requests)) continue
        const matches = matchService(region, service)
        if (matches.length !== 1) { unmatchedEvidence.push({ artifact: artifact.id, reason: matches.length ? 'AMBIGUOUS_SERVICE_MAPPING' : 'SERVICE_MAPPING_UNKNOWN' }); continue }
        matches[0].observations.push({ type: 'request-window', ...observation(artifact, { start, end, requests: group.requests, complete: window.status === 'complete' }, window.status === 'complete' ? joinedStatus(matches[0], artifact) : 'partial') })
      }
    }
    if (input.kind === 'telemetry') for (const operation of Array.isArray(data.operations) ? data.operations : []) {
      if (!NAME.test(operation.operation || '')) continue
      for (const cohort of Array.isArray(operation.cohorts) ? operation.cohorts : []) {
        const service = safe(cohort.service, SERVICE), matches = matchService(cohort.region, service)
        if (matches.length !== 1) { unmatchedEvidence.push({ artifact: artifact.id, reason: matches.length ? 'AMBIGUOUS_SERVICE_MAPPING' : 'SERVICE_MAPPING_UNKNOWN' }); continue }
        matches[0].observations.push({ type: 'sampled-telemetry', ...observation(artifact, { operation: operation.operation,
          start: date(data.range?.start), end: date(data.range?.end), revision: safe(cohort.release, /^[A-Za-z0-9_.-]{1,150}$/),
          authenticated: typeof cohort.authenticated === 'boolean' ? cohort.authenticated : null,
          outcome: ['success', 'error'].includes(cohort.outcome) ? cohort.outcome : null,
          sampleCount: finite(cohort.sampleCount) ? cohort.sampleCount : null }, data.complete === true ? joinedStatus(matches[0], artifact) : 'partial') })
      }
    }
    if (input.kind === 'review') for (const item of Array.isArray(data.entries) ? data.entries : []) {
      const row = rows.get(`${project}/${item.region}/${item.name}`)
      if (!row) continue
      const owner = safe(item.owner, /^[A-Za-z][A-Za-z0-9_. -]{0,79}$/)
      const reviewer = safe(data.reviewer, /^[A-Za-z][A-Za-z0-9_. -]{0,79}$/)
      row.review.push(observation(artifact, { owner, reviewer, canonical: safe(item.canonical, NAME), reviewed: item.reviewed === true },
        item.reviewed === true && owner && reviewer ? artifact.status : 'unknown'))
    }
    if (input.kind === 'historical') historical.push({ artifact: artifact.id, historicalOnly: true, observedAt: artifact.observedAt,
      sourceCommit: safe(data.sourceCommit, /^[a-f0-9]{40}$/), latestNotServing: finite(data.summary?.latestNotServing) ? data.summary.latestNotServing : null })
  })
  const entries = [...rows.values()].sort((a, b) => a.id.localeCompare(b.id)).map(row => {
    const compatibility = registry?.project === project ? registry.entries?.find(x => x.name === row.name && x.region === row.region) : null
    return { id: row.id, name: row.name, project, region: row.region,
      presence: row.sourceObserved ? row.cloudObserved ? 'source-and-cloud' : 'source-only' : row.cloudObserved ? 'cloud-only' : 'sdk-only',
      sourceRegionConfirmed: row.sourceRegionConfirmed, kind: fact(row.kind), service: fact(row.service), deploymentState: fact(row.state),
      latestRevision: fact(row.latest), servingRouting: fact(row.serving),
      handler: { status: 'review-required', sourceCandidates: row.handlerCandidates, registrationLocations: row.registrationLocations || [] },
      consumers: { status: row.consumers.length ? 'static-candidates' : 'unknown', references: row.consumers },
      ownership: fact(row.review), compatibility: compatibility ? { status: 'registry-declared', artifact: 'source:current', canonical: safe(compatibility.canonical, NAME),
        lifecycle: ['deprecated-observing', 'retained-maintenance'].includes(compatibility.status) ? compatibility.status : null,
        observationStart: date(compatibility.observationStart), notBefore: date(compatibility.notBefore) } : { status: 'unknown' },
      observations: row.observations, deletionAllowed: false }
  })
  const dynamic = (staticAudit.unresolvedCallableSites || []).map(sourceLocation).filter(Boolean)
  const aliases = (staticAudit.aliasFamilies || []).filter(x => NAME.test(x.base || '') && NAME.test(x.alias || '')).map(x => ({ base: x.base, alias: x.alias, status: 'name-similarity-only' }))
  return { schemaVersion: 1, project, generatedAt: date(now), source: sourceIdentity(source), deletionAllowed: false,
    summary: { endpoints: entries.length, sourceExports: sourceExports.size, sourceOnly: entries.filter(x => x.presence === 'source-only').length,
      cloudOnly: entries.filter(x => x.presence === 'cloud-only').length, sourceAndCloud: entries.filter(x => x.presence === 'source-and-cloud').length,
      sdkOnly: entries.filter(x => x.presence === 'sdk-only').length,
      unknownRegions: entries.filter(x => x.region === null).length, rejectedArtifacts: artifacts.filter(x => !x.accepted).length },
    artifacts, cloudCoverage: artifacts.filter(x => x.kind === 'inventory').map(({ id, accepted, status, complete, scope }) => ({ artifact: id, accepted, status, complete, scope })),
    entries, aliasCandidates: aliases, unresolved: { counts: Object.fromEntries(['unresolvedCallableSites', 'unresolvedDynamicImports', 'unresolvedComputedExports', 'unresolvedExports'].map(key => [key, Array.isArray(staticAudit[key]) ? staticAudit[key].length : null])), callableSites: dynamic,
      dynamicImports: (staticAudit.unresolvedDynamicImports || []).map(sourceLocation).filter(Boolean),
      computedExports: (staticAudit.unresolvedComputedExports || []).map(sourceLocation).filter(Boolean),
      exportSpreads: (staticAudit.unresolvedExports || []).map(sourceLocation).filter(Boolean) },
    unmatchedEvidence, historical,
    limitations: ['Presence means evidence was supplied, not current deployment existence or inactivity.',
      'Static consumer candidates include fallback/dynamic uncertainty and do not establish executed requests. Handler locations require review.',
      'Owners and canonical relationships are never inferred from filenames, Git authors or similar endpoint names.',
      'Serving routing and health observations are separate from latest-created release state. Old evidence remains dated.',
      'Request windows are retained separately, never added. Missing series and missing sampled telemetry are unknown, not zero.',
      'No retirement eligibility, traffic changes, deletion, cloud query, or billing estimate is produced.'] }
}
function runCli(argv = process.argv.slice(2), dependencies = {}) {
  if (argv.includes('--help')) { console.log('node scripts/build-endpoint-manifest.cjs --project=PROJECT --out=.migration-private/endpoints.json [--root=.] [--sdk=JSON] [--inventory=JSON] [--health=JSON] [--activity=JSON] [--telemetry=JSON] [--review=JSON] [--historical=JSON]\nEvidence options repeat. Offline only; artifacts never authorize deletion.'); return }
  const options = {}, inputs = []
  for (const argument of argv) {
    const parsed = /^--([a-z-]+)=(.+)$/.exec(argument)
    if (!parsed || !new Set([...KINDS, 'root', 'project', 'out']).has(parsed[1])) throw Error('Unknown or invalid argument.')
    if (KINDS.has(parsed[1])) inputs.push({ kind: parsed[1], file: parsed[2] })
    else { if (options[parsed[1]]) throw Error('Duplicate command option.'); options[parsed[1]] = parsed[2] }
  }
  if (!PROJECT.test(options.project || '') || !options.out || inputs.length > 30) throw Error('Provide a project, artifact output, and at most 30 inputs.')
  const root = fs.realpathSync(options.root || process.cwd()), output = path.resolve(root, options.out), relative = path.relative(root, output).replaceAll('\\', '/')
  if (!/^(?:tmp|\.migration-private)\/.+\.json$/.test(relative)) throw Error('Output must be an ignored JSON artifact under root tmp/ or .migration-private/.')
  let ancestor = path.dirname(output)
  while (!fs.existsSync(ancestor)) ancestor = path.dirname(ancestor)
  const realRelative = path.relative(root, fs.realpathSync(ancestor))
  if (realRelative.startsWith('..') || path.isAbsolute(realRelative)) throw Error('Output ancestor leaves the workspace.')
  if (fs.existsSync(output) && fs.lstatSync(output).isSymbolicLink()) throw Error('Output cannot be a symbolic link.')
  const records = inputs.map(({ kind, file }) => {
    const resolved = fs.realpathSync(path.resolve(root, file))
    if (resolved.toLowerCase() === output.toLowerCase() || fs.statSync(resolved).size > 20 * 1024 * 1024) throw Error('Input cannot be overwritten or exceed 20 MiB.')
    const bytes = fs.readFileSync(resolved)
    return { kind, sha256: sha(bytes), data: JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, '')) }
  })
  const snapshot = dependencies.sourceSnapshot || sourceSnapshot, audit = dependencies.auditProject || auditProject
  const source = snapshot(root), staticAudit = audit(root)
  staticAudit.source = source
  const registryFile = path.join(root, 'ops/function-lifecycle.json')
  const registry = fs.existsSync(registryFile) ? JSON.parse(fs.readFileSync(registryFile, 'utf8')) : null
  staticAudit.snapshotStable = sameSource(source, snapshot(root))
  const report = buildManifest({ project: options.project, source, staticAudit, inputs: records, registry })
  fs.mkdirSync(path.dirname(output), { recursive: true })
  const pending = `${output}.pending-${process.pid}`
  fs.writeFileSync(pending, JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
  try { fs.renameSync(pending, output) } catch (error) { fs.unlinkSync(pending); throw error }
  console.log(JSON.stringify({ output, source: report.source, summary: report.summary, deletionAllowed: false }))
  return report
}
if (require.main === module) { try { runCli() } catch { console.error('Endpoint evidence manifest failed: check arguments, JSON inputs and stable source. No cloud action was performed.'); process.exitCode = 1 } }
module.exports = { buildManifest, runCli, artifactInfo, fact }
