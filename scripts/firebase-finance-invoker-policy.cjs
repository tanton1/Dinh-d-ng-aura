const path = require('node:path')

const TARGET_PROJECT = 'gen-lang-client-0815966909'
const REGION = 'asia-southeast1'
const CONFIRMATION = 'ENABLE_AURA_FINANCE_CALLABLES'
const SERVICES = Object.freeze([
  'listFinanceLedger',
  'recordContractPayment',
  'reverseContractPayment',
  'recordRefund',
  'lockFinancePeriod',
  'listCashAccounts',
  'initializeCashAccount',
  'listCashTransactions',
  'recordCashExpense',
  'transferCash',
  'listBusinessPerformance',
  'listPayrollRuns',
  'getPayrollRun',
  'createPayrollRun',
  'reviewPayrollRun',
  'lockPayrollRun',
  'markPayrollRunPaid',
])

function parseArgs() {
  const result = { mode: 'dry-run', project: '' }
  process.argv.slice(2).forEach((argument) => {
    if (argument.startsWith('--mode=')) result.mode = argument.slice(7)
    else if (argument.startsWith('--project=')) result.project = argument.slice(10)
    else if (argument.startsWith('--confirm=')) result.confirm = argument.slice(10)
    else throw new Error(`Unknown argument: ${argument.split('=')[0]}`)
  })
  if (!['dry-run', 'apply', 'verify'].includes(result.mode)) throw new Error('Mode must be dry-run, apply, or verify.')
  if (result.mode === 'apply' && (result.project !== TARGET_PROJECT || result.confirm !== CONFIRMATION)) {
    throw new Error('Apply requires the exact production project and confirmation.')
  }
  return result
}

function firebaseCliAuth() {
  const cliLib = path.join(process.env.APPDATA || '', 'npm', 'node_modules', 'firebase-tools', 'lib')
  const auth = require(path.join(cliLib, 'auth.js'))
  const account = auth.getProjectDefaultAccount(process.cwd()) || auth.getGlobalDefaultAccount()
  if (!account?.tokens?.refresh_token) throw new Error('Firebase CLI is not signed in.')
  return { auth, account }
}

async function accessToken() {
  const { auth, account } = firebaseCliAuth()
  const result = await auth.getAccessToken(account.tokens.refresh_token, [])
  if (!result?.access_token) throw new Error('Unable to obtain Firebase access token.')
  return result.access_token
}

function endpoint(service, action) {
  return `https://run.googleapis.com/v2/projects/${TARGET_PROJECT}/locations/${REGION}/services/${service.toLowerCase()}:${action}`
}

async function request(token, url, body) {
  const isRead = url.endsWith(':getIamPolicy')
  const response = await fetch(url, {
    method: isRead ? 'GET' : 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: isRead ? undefined : JSON.stringify(body),
  })
  const raw = await response.text()
  if (!response.ok) throw new Error(`Cloud Run IAM request failed (${response.status}) for ${url.split('/').at(-1)}.`)
  return raw ? JSON.parse(raw) : {}
}

function hasPublicInvoker(policy) {
  return Array.isArray(policy.bindings) && policy.bindings.some((binding) => (
    binding.role === 'roles/run.invoker' && Array.isArray(binding.members) && binding.members.includes('allUsers')
  ))
}

function withPublicInvoker(policy) {
  const bindings = Array.isArray(policy.bindings) ? policy.bindings.map((binding) => ({ ...binding, members: [...(binding.members || [])] })) : []
  const invoker = bindings.find((binding) => binding.role === 'roles/run.invoker' && !binding.condition)
  if (invoker) invoker.members = [...new Set([...invoker.members, 'allUsers'])]
  else bindings.push({ role: 'roles/run.invoker', members: ['allUsers'] })
  return { version: policy.version || 1, etag: policy.etag, bindings }
}

async function main() {
  const args = parseArgs()
  const token = await accessToken()
  const results = []
  for (const service of SERVICES) {
    const policy = await request(token, endpoint(service, 'getIamPolicy'), {})
    const before = hasPublicInvoker(policy)
    let changed = false
    if (args.mode === 'apply' && !before) {
      const updated = await request(token, endpoint(service, 'setIamPolicy'), { policy: withPublicInvoker(policy) })
      changed = hasPublicInvoker(updated)
    }
    const finalPolicy = args.mode === 'verify' || args.mode === 'apply'
      ? await request(token, endpoint(service, 'getIamPolicy'), {})
      : policy
    results.push({ service, publicInvoker: hasPublicInvoker(finalPolicy), changed })
  }
  const missing = results.filter((item) => !item.publicInvoker)
  console.log(JSON.stringify({ mode: args.mode, project: TARGET_PROJECT, region: REGION, serviceCount: results.length, missingCount: missing.length, results }, null, 2))
  if (args.mode === 'verify' && missing.length) process.exitCode = 2
}

main().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})
