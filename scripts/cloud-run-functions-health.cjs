'use strict'

const path = require('node:path')
const { mapBounded } = require('./audit-function-regions.cjs')
const { revisionResource, assertHealthyRevision } = require('./cloud-run-revision-policy.cjs')
const { latestReleaseFreshness, servingHealth, recentWindow, recentMetricUrl, recentRequestErrors } = require('./cloud-run-health-observation.cjs')

const DEFAULT_PROJECT = 'gen-lang-client-0815966909'
const DEFAULT_REGION = 'asia-southeast1'

function argument(name, fallback) {
  const prefix = `--${name}=`
  const value = process.argv.find((item) => item.startsWith(prefix))
  return value ? value.slice(prefix.length) : fallback
}

async function accessToken() {
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS || process.env.GOOGLE_GHA_CREDS_PATH) {
    const { GoogleAuth } = require('google-auth-library')
    const client = await new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] }).getClient()
    const token = await client.getAccessToken()
    if (token?.token) return token.token
  }

  const appData = process.env.APPDATA
  if (!appData) throw new Error('Không tìm thấy thông tin đăng nhập Google Cloud.')
  const firebaseAuth = require(path.join(appData, 'npm', 'node_modules', 'firebase-tools', 'lib', 'auth.js'))
  const account = firebaseAuth.getProjectDefaultAccount(process.cwd()) || firebaseAuth.getGlobalDefaultAccount()
  if (!account?.tokens?.refresh_token) throw new Error('Hãy đăng nhập Firebase CLI trước khi kiểm tra Cloud Run.')
  const token = await firebaseAuth.getAccessToken(account.tokens.refresh_token, [])
  if (!token?.access_token) throw new Error('Không lấy được access token Firebase CLI.')
  return token.access_token
}

function condition(service, type) {
  if (service.terminalCondition?.type === type) return service.terminalCondition
  return (service.conditions || []).find((item) => item.type === type) || null
}

function serviceName(service) {
  return String(service.name || '').split('/').at(-1) || ''
}

function failureReason(service) {
  const terminal = condition(service, 'Ready')
  return [terminal?.reason, terminal?.message].filter(Boolean).join(': ')
}

async function listServices(project, region, token) {
  const services = []
  let pageToken = ''
  do {
    const url = new URL(`https://run.googleapis.com/v2/projects/${project}/locations/${region}/services`)
    url.searchParams.set('pageSize', '100')
    if (pageToken) url.searchParams.set('pageToken', pageToken)
    const response = await fetch(url, { headers: { authorization: `Bearer ${token}` } })
    if (!response.ok) throw new Error(`Cloud Run API ${response.status}: ${(await response.text()).slice(0, 500)}`)
    const payload = await response.json()
    services.push(...(payload.services || []))
    pageToken = payload.nextPageToken || ''
  } while (pageToken)
  return services
}

async function serviceHealth(service, readRevision, expected = {}, { mode = 'release' } = {}) {
  if (!['release', 'serving'].includes(mode)) throw new Error('mode must be release or serving.')
  if (mode === 'serving' && (expected.expectedRevision || expected.expectedImage)) throw new Error('Expected revision/image require the strict release mode.')
  const name = serviceName(service)
  const readyRevision = String(service.latestReadyRevision || '').split('/').at(-1) || ''
  const createdRevision = String(service.latestCreatedRevision || '').split('/').at(-1) || ''
  const base = { name, mode, readyRevision, createdRevision, releaseFreshness: latestReleaseFreshness(service), uri: service.uri || '' }
  if (mode === 'serving') {
    const observed = await servingHealth(service, readRevision)
    return { ...base, ready: observed.ready, status: observed.status, reason: observed.reason, servingHealth: observed,
      ...(observed.revisions.length === 1 ? { image: observed.revisions[0].image } : {}) }
  }
  let readCompleted = false
  try {
    // Always inspect the actual revision, even when service-level names agree.
    // A Ready service can still point at a retired/failed container revision.
    const revision = await readRevision(revisionResource(service))
    readCompleted = true
    const result = assertHealthyRevision(service, revision, { ...expected, requireServing: true })
    return { ...base, ready: true, status: 'healthy', image: result.image, reason: '' }
  } catch (error) {
    return { ...base, ready: false, status: readCompleted ? 'unhealthy' : 'unknown', reason: error.message || failureReason(service) }
  }
}

async function main() {
  const project = argument('project', process.env.GCLOUD_PROJECT || DEFAULT_PROJECT)
  const region = argument('region', DEFAULT_REGION)
  const json = process.argv.includes('--json')
  const failOnUnhealthy = process.argv.includes('--fail-on-unhealthy')
  const mode = argument('mode', 'release')
  if (!['release', 'serving'].includes(mode)) throw new Error('mode must be release or serving.')
  const window = recentWindow(argument('recent-minutes', ''))
  const names = new Set(argument('functions', '').split(',').map((item) => item.trim().toLowerCase()).filter(Boolean))
  const expected = { expectedRevision: argument('expected-revision', ''), expectedImage: argument('expected-image', '') }
  if (mode === 'serving' && (expected.expectedRevision || expected.expectedImage)) throw new Error('Expected revision/image require the strict release mode.')
  if ((expected.expectedRevision || expected.expectedImage) && names.size !== 1) throw new Error('Expected revision/image require exactly one service.')
  const token = await accessToken()
  const allServices = await listServices(project, region, token)
  const services = names.size ? allServices.filter((service) => names.has(serviceName(service))) : allServices
  const readRevision = async (resource) => {
    const response = await fetch(`https://run.googleapis.com/v2/${resource}`, {
      headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30_000),
    })
    if (!response.ok) throw new Error(`Không đọc được revision (${response.status}).`)
    return response.json()
  }
  let recentSeries = null
  if (window) {
    try {
      recentSeries = []
      const url = recentMetricUrl(project, window, region)
      do {
        const response = await fetch(url, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30_000) })
        if (!response.ok) throw new Error(`Recent request metrics unavailable (${response.status}).`)
        const payload = await response.json()
        recentSeries.push(...(payload.timeSeries || []))
        if (!payload.nextPageToken) break
        url.searchParams.set('pageToken', payload.nextPageToken)
      } while (true)
    } catch (error) { recentSeries = null; console.error(error.message) }
  }
  const rows = (await mapBounded(services, (service) => serviceHealth(service, readRevision, expected, { mode }), 8))
    .sort((left, right) => left.name.localeCompare(right.name))
  rows.forEach(row => { row.recentErrors = recentRequestErrors(recentSeries, region, row.name, window) })
  const failed = rows.filter((item) => !item.ready)
  const unknown = rows.filter(item => item.status === 'unknown').length
  const releaseBacklog = rows.filter(item => item.releaseFreshness.status === 'backlog').length

  if (json) process.stdout.write(`${JSON.stringify({ project, region, mode, total: rows.length, healthy: rows.length - failed.length, failed: failed.length, unknown, releaseBacklog, recentErrorsWindow: window, services: rows }, null, 2)}\n`)
  else {
    console.log(`Cloud Run ${project}/${region}: ${rows.length - failed.length}/${rows.length} ${mode === 'serving' ? 'service có revision phục vụ khỏe' : 'release mới nhất đạt strict deployment gate'}; release backlog=${releaseBacklog}; chưa xác minh=${unknown}.`)
    if (failed.length) {
      console.log(`${mode === 'serving' ? 'Serving chưa đạt kiểm tra' : 'Release chưa đạt gate'} (${failed.length}):`)
      for (const item of failed) console.log(`- ${item.name}: ready=${item.readyRevision || '-'} created=${item.createdRevision || '-'} · ${item.reason || 'revision chưa sẵn sàng'}`)
    }
    if (window) {
      console.log(`Recent errors: cửa sổ ${window.startTime}–${window.endTime}, gồm mọi revision của service; metadata khỏe không bảo đảm mọi request thành công.`)
      if (!recentSeries) console.log('Chưa đọc được recent request metrics; không suy ra 0 lỗi.')
      else for (const row of rows) console.log(`- ${row.name}: requests=${row.recentErrors.requests}, 5xx=${row.recentErrors.http5xx}, 429=${row.recentErrors.http429}`)
    }
  }
  if (names.size && rows.length !== names.size) {
    const found = new Set(rows.map((item) => item.name))
    const missing = [...names].filter((name) => !found.has(name))
    console.error(`Không tìm thấy dịch vụ: ${missing.join(', ')}`)
    process.exitCode = 2
  } else if (failOnUnhealthy && failed.length) process.exitCode = 1
}

if (require.main === module) main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})

module.exports = { serviceHealth }
