'use strict'

const path = require('node:path')
const { GoogleAuth } = require('google-auth-library')
const { shortName } = require('./cloud-run-revision-policy.cjs')

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
  if (!account?.tokens?.refresh_token) throw new Error('Hãy đăng nhập Firebase CLI trước khi rollback Cloud Run.')
  const token = await firebaseAuth.getAccessToken(account.tokens.refresh_token, [])
  if (!token?.access_token) throw new Error('Không lấy được access token Firebase CLI.')
  return token.access_token
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

async function updateWithRetry(url, headers, body) {
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const response = await fetch(url, {
      method: 'PUT',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (response.ok) return response.json()
    const message = await response.text()
    if (response.status !== 429 || attempt === 4) throw new Error(`Cloud Run ${response.status}: ${message.slice(0, 800)}`)
    await sleep(1_500 * (2 ** (attempt - 1)))
  }
  throw new Error('Cloud Run không nhận rollback.')
}

async function rollbackService(project, region, name, headers) {
  const url = `https://${region}-run.googleapis.com/apis/serving.knative.dev/v1/namespaces/${project}/services/${name}`
  const response = await fetch(url, { headers })
  if (!response.ok) throw new Error(`${name} GET ${response.status}: ${(await response.text()).slice(0, 800)}`)
  const service = await response.json()
  // A failed rollout can leave latestReadyRevisionName misleading. Without an
  // explicit earlier release snapshot, only preserve the revision already
  // receiving all traffic; never guess another revision from latest metadata.
  const targets = (service.status?.traffic || []).filter((target) => Number(target.percent) > 0)
  if (targets.length !== 1 || Number(targets[0].percent) !== 100 || !targets[0].revisionName) {
    throw new Error(`${name}: ambiguous effective traffic; explicit rollback review required.`)
  }
  const readyRevision = targets[0].revisionName
  const revisionUrl = `https://run.googleapis.com/v2/projects/${project}/locations/${region}/services/${name}/revisions/${readyRevision}`
  const revisionResponse = await fetch(revisionUrl, { headers })
  if (!revisionResponse.ok) throw new Error(`${name}: cannot verify the currently serving revision.`)
  const revision = await revisionResponse.json()
  if (shortName(revision.name) !== readyRevision
    || !['Ready', 'ContainerHealthy'].every((type) => revision.conditions?.some((item) => item.type === type && item.state === 'CONDITION_SUCCEEDED'))
    || revision.conditions?.some((item) => item.revisionReason === 'RETIRED')) {
    throw new Error(`${name}: serving revision has not passed actual container health checks.`)
  }
  delete service.status
  service.spec.traffic = [{ revisionName: readyRevision, percent: 100 }]
  await updateWithRetry(url, headers, service)
  return readyRevision
}

async function main() {
  const project = argument('project', process.env.GCLOUD_PROJECT || DEFAULT_PROJECT)
  const region = argument('region', DEFAULT_REGION)
  const confirmation = argument('confirm', '')
  if (confirmation !== `${project}/${region}`) throw new Error(`Rollback cần --confirm=${project}/${region}`)
  const names = argument('functions', '').split(',').map((item) => item.trim().toLowerCase()).filter(Boolean)
  if (!names.length || names.some((name) => !/^[a-z][a-z0-9]*$/.test(name))) throw new Error('Cần danh sách service hợp lệ qua --functions=name1,name2')
  const token = await accessToken()
  const headers = { authorization: `Bearer ${token}` }
  for (const name of names) {
    const revision = await rollbackService(project, region, name, headers)
    console.log(`+ ${name} -> ${revision}`)
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
