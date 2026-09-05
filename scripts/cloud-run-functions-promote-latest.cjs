'use strict'

const path = require('node:path')
const { GoogleAuth } = require('google-auth-library')

const DEFAULT_PROJECT = 'gen-lang-client-0815966909'
const DEFAULT_REGION = 'asia-southeast1'

function argument(name, fallback) {
  const prefix = `--${name}=`
  const value = process.argv.find((item) => item.startsWith(prefix))
  return value ? value.slice(prefix.length) : fallback
}

async function accessToken() {
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS || process.env.GOOGLE_GHA_CREDS_PATH) {
    const client = await new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] }).getClient()
    const token = await client.getAccessToken()
    if (token?.token) return token.token
  }
  const appData = process.env.APPDATA
  if (!appData) throw new Error('Không tìm thấy thông tin đăng nhập Google Cloud.')
  const firebaseAuth = require(path.join(appData, 'npm', 'node_modules', 'firebase-tools', 'lib', 'auth.js'))
  const account = firebaseAuth.getProjectDefaultAccount(process.cwd()) || firebaseAuth.getGlobalDefaultAccount()
  if (!account?.tokens?.refresh_token) throw new Error('Hãy đăng nhập Firebase CLI trước khi chuyển traffic Cloud Run.')
  const token = await firebaseAuth.getAccessToken(account.tokens.refresh_token, [])
  if (!token?.access_token) throw new Error('Không lấy được access token Firebase CLI.')
  return token.access_token
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

async function requestJson(url, headers, options = {}) {
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const response = await fetch(url, {
      ...options,
      headers: {
        ...headers,
        ...(options.body ? { 'content-type': 'application/json' } : {}),
      },
    })
    if (response.ok) return response.json()
    const message = await response.text()
    if (response.status !== 429 || attempt === 5) {
      throw new Error(`Cloud Run ${response.status}: ${message.slice(0, 800)}`)
    }
    await sleep(1_500 * (2 ** (attempt - 1)))
  }
  throw new Error('Cloud Run không nhận yêu cầu chuyển traffic.')
}

function shortName(resourceName) {
  return String(resourceName || '').split('/').at(-1) || ''
}

async function promoteLatest(project, region, name, headers) {
  const v2Url = `https://run.googleapis.com/v2/projects/${project}/locations/${region}/services/${name}`
  const current = await requestJson(v2Url, headers)
  const createdRevision = shortName(current.latestCreatedRevision)
  if (!createdRevision) throw new Error(`${name} chưa có revision mới để chuyển traffic.`)

  const traffic = current.trafficStatuses || current.traffic || []
  const alreadyLatest = traffic.length > 0 && traffic.every((target) => (
    target.type === 'TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST'
    && Number(target.percent || 0) === 100
  ))
  if (!alreadyLatest) {
    const v1Url = `https://${region}-run.googleapis.com/apis/serving.knative.dev/v1/namespaces/${project}/services/${name}`
    const service = await requestJson(v1Url, headers)
    delete service.status
    service.spec = service.spec || {}
    // Keep traffic attached to "latest" instead of pinning a revision name.
    // This lets the next healthy Firebase deployment receive traffic without
    // leaving production silently stuck on an older revision.
    service.spec.traffic = [{ latestRevision: true, percent: 100 }]
    await requestJson(v1Url, headers, { method: 'PUT', body: JSON.stringify(service) })
  }

  for (let attempt = 1; attempt <= 24; attempt += 1) {
    const service = await requestJson(v2Url, headers)
    const latestCreated = shortName(service.latestCreatedRevision)
    const latestReady = shortName(service.latestReadyRevision)
    const trafficStatuses = service.trafficStatuses || service.traffic || []
    const servingLatest = latestCreated && latestCreated === latestReady && trafficStatuses.some((target) => (
      Number(target.percent || 0) === 100
      && (target.type === 'TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST' || target.revision === latestCreated)
    ))
    if (servingLatest) return latestCreated
    await sleep(2_500)
  }
  throw new Error(`${name} chưa chuyển 100% traffic sang revision mới trong thời gian chờ.`)
}

async function main() {
  const project = argument('project', process.env.GCLOUD_PROJECT || DEFAULT_PROJECT)
  const region = argument('region', DEFAULT_REGION)
  const confirmation = argument('confirm', '')
  if (confirmation !== `${project}/${region}`) throw new Error(`Chuyển traffic cần --confirm=${project}/${region}`)
  const names = argument('functions', '').split(',').map((item) => item.trim().toLowerCase()).filter(Boolean)
  if (!names.length || names.some((name) => !/^[a-z][a-z0-9]*$/.test(name))) {
    throw new Error('Cần danh sách service hợp lệ qua --functions=name1,name2')
  }

  const token = await accessToken()
  const headers = { authorization: `Bearer ${token}` }
  for (const name of names) {
    const revision = await promoteLatest(project, region, name, headers)
    console.log(`+ ${name} -> ${revision}`)
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
