'use strict'

const path = require('node:path')
const { GoogleAuth } = require('google-auth-library')
const { shortName, revisionResource, assertHealthyRevision, servesRevision } = require('./cloud-run-revision-policy.cjs')

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
    if (options.method || response.status !== 429 || attempt === 5) {
      throw new Error(`Cloud Run ${response.status}: ${message.slice(0, 800)}`)
    }
    await sleep(1_500 * (2 ** (attempt - 1)))
  }
  throw new Error('Cloud Run không nhận yêu cầu chuyển traffic.')
}

async function promoteLatest(project, region, name, headers, { request = requestJson, pause = sleep, expectedRevision, expectedImage } = {}) {
  const v2Url = `https://run.googleapis.com/v2/projects/${project}/locations/${region}/services/${name}`
  const current = await request(v2Url, headers)
  const createdRevision = shortName(current.latestCreatedRevision)
  if (!createdRevision) throw new Error(`${name} chưa có revision mới để chuyển traffic.`)
  const revision = await request(`https://run.googleapis.com/v2/${revisionResource(current)}`, headers)
  const approved = assertHealthyRevision(current, revision, { expectedRevision, expectedImage })
  if (!servesRevision(current, createdRevision)) {
    if (!current.etag) throw new Error('Missing service etag; refusing an unguarded traffic change.')
    // Only this exact, health-checked revision receives traffic. A later deploy
    // must pass this gate again; never attach production to floating "latest".
    let operation = await request(`${v2Url}?updateMask=traffic`, headers, {
      method: 'PATCH', body: JSON.stringify({ name: current.name, etag: current.etag,
        traffic: [{ type: 'TRAFFIC_TARGET_ALLOCATION_TYPE_REVISION', revision: createdRevision, percent: 100 }] }),
    })
    for (let attempt = 0; !operation.done && attempt < 48; attempt += 1) {
      if (!operation.name?.startsWith(`projects/${project}/locations/${region}/operations/`)) throw new Error('Unexpected promotion operation identity.')
      await pause(2500)
      operation = await request(`https://run.googleapis.com/v2/${operation.name}`, headers)
    }
    if (!operation.done) throw new Error('Promotion operation still pending; inspect it before retrying.')
    if (operation.error) throw new Error(`Promotion failed: ${operation.error.message || operation.error.code}`)
  }

  for (let attempt = 1; attempt <= 24; attempt += 1) {
    const service = await request(v2Url, headers)
    if (shortName(service.latestCreatedRevision) !== approved.revision) throw new Error('Concurrent release changed the candidate during promotion.')
    if (!service.reconciling && servesRevision(service, approved.revision)) {
      const live = await request(`https://run.googleapis.com/v2/${revisionResource(service)}`, headers)
      assertHealthyRevision(service, live, { expectedRevision: approved.revision, expectedImage: approved.image, requireServing: true })
      return approved.revision
    }
    await pause(2_500)
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

  const expectedRevision = argument('expected-revision', '')
  const expectedImage = argument('expected-image', '')
  if ((expectedRevision || expectedImage) && names.length !== 1) throw new Error('Expected revision/image require exactly one service.')
  const token = await accessToken()
  const headers = { authorization: `Bearer ${token}` }
  for (const name of names) {
    const revision = await promoteLatest(project, region, name, headers, { expectedRevision, expectedImage })
    console.log(`+ ${name} -> ${revision}`)
  }
}

if (require.main === module) main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})

module.exports = { promoteLatest }
