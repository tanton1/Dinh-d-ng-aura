'use strict'

const path = require('node:path')

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

async function main() {
  const project = argument('project', process.env.GCLOUD_PROJECT || DEFAULT_PROJECT)
  const region = argument('region', DEFAULT_REGION)
  const json = process.argv.includes('--json')
  const failOnUnhealthy = process.argv.includes('--fail-on-unhealthy')
  const names = new Set(argument('functions', '').split(',').map((item) => item.trim().toLowerCase()).filter(Boolean))
  const token = await accessToken()
  const allServices = await listServices(project, region, token)
  const services = names.size ? allServices.filter((service) => names.has(serviceName(service))) : allServices
  const rows = services.map((service) => {
    const name = serviceName(service)
    const readyRevision = String(service.latestReadyRevision || '').split('/').at(-1) || ''
    const createdRevision = String(service.latestCreatedRevision || '').split('/').at(-1) || ''
    const traffic = service.trafficStatuses || service.traffic || []
    const trafficServesReadyRevision = Boolean(readyRevision) && traffic.length > 0 && traffic.every((target) => {
      if (target.type === 'TRAFFIC_TARGET_ALLOCATION_TYPE_REVISION') return target.revision === readyRevision
      if (target.type === 'TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST') return createdRevision === readyRevision
      return false
    })
    // Cloud Functions CLI can report a successful update even when Cloud Run
    // retires the newly created revision and leaves traffic on an older ready
    // revision (for example after a regional CPU quota rejection). Such a
    // service is available, but the requested release is not live.
    const latestCreatedIsReady = Boolean(createdRevision) && createdRevision === readyRevision
    const ready = trafficServesReadyRevision && latestCreatedIsReady
    return {
      name,
      ready,
      readyRevision,
      createdRevision,
      reason: ready
        ? ''
        : !latestCreatedIsReady
          ? 'Revision mới nhất chưa sẵn sàng; production vẫn đang phục vụ revision cũ.'
          : failureReason(service),
      uri: service.uri || '',
    }
  }).sort((left, right) => left.name.localeCompare(right.name))
  const failed = rows.filter((item) => !item.ready)

  if (json) process.stdout.write(`${JSON.stringify({ project, region, total: rows.length, healthy: rows.length - failed.length, failed: failed.length, services: rows }, null, 2)}\n`)
  else {
    console.log(`Cloud Run ${project}/${region}: ${rows.length - failed.length}/${rows.length} dịch vụ khỏe mạnh.`)
    if (failed.length) {
      console.log(`Không khỏe mạnh (${failed.length}):`)
      for (const item of failed) console.log(`- ${item.name}: ready=${item.readyRevision || '-'} created=${item.createdRevision || '-'} · ${item.reason || 'revision chưa sẵn sàng'}`)
    }
  }
  if (names.size && rows.length !== names.size) {
    const found = new Set(rows.map((item) => item.name))
    const missing = [...names].filter((name) => !found.has(name))
    console.error(`Không tìm thấy dịch vụ: ${missing.join(', ')}`)
    process.exitCode = 2
  } else if (failOnUnhealthy && failed.length) process.exitCode = 1
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
