const fs = require('node:fs')
const path = require('node:path')

const TARGET = Object.freeze({
  projectId: 'gen-lang-client-0815966909',
  databaseId: 'ai-studio-aurafitnesselear-0f7609b4-b8d1-4fb3-9d62-99a2c03e1ce7',
})
const REPORT_PATH = path.resolve('.migration-private', 'firebase-finance-production-audit.json')

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

function decode(value = {}) {
  if ('nullValue' in value) return null
  if ('booleanValue' in value) return Boolean(value.booleanValue)
  if ('integerValue' in value) return Number(value.integerValue)
  if ('doubleValue' in value) return Number(value.doubleValue)
  if ('timestampValue' in value) return value.timestampValue
  if ('stringValue' in value) return value.stringValue
  if ('arrayValue' in value) return (value.arrayValue.values || []).map(decode)
  if ('mapValue' in value) return decodeFields(value.mapValue.fields || {})
  return undefined
}

function decodeFields(fields = {}) {
  return Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, decode(value)]))
}

async function listCollection(token, collectionId) {
  const documents = []
  let pageToken = ''
  do {
    const query = new URLSearchParams({ pageSize: '1000', showMissing: 'false' })
    if (pageToken) query.set('pageToken', pageToken)
    const endpoint = `https://firestore.googleapis.com/v1/projects/${TARGET.projectId}/databases/${encodeURIComponent(TARGET.databaseId)}/documents/${collectionId}?${query}`
    const response = await fetch(endpoint, { headers: { Authorization: `Bearer ${token}` } })
    if (!response.ok) throw new Error(`Firestore read failed (${response.status}) for ${collectionId}.`)
    const page = await response.json()
    ;(page.documents || []).forEach((item) => documents.push({ id: item.name.split('/').at(-1), ...decodeFields(item.fields || {}) }))
    pageToken = page.nextPageToken || ''
  } while (pageToken)
  return documents
}

function sum(items, field) {
  return items.reduce((total, item) => total + (Number.isFinite(Number(item[field])) ? Number(item[field]) : 0), 0)
}

function cashImpact(item) {
  if (Number.isFinite(Number(item.cashImpact))) return Number(item.cashImpact)
  return ['payment', 'refund', 'reversal', 'adjustment'].includes(item.type) ? Number(item.amount || 0) : 0
}

function sourceOf(item) {
  if (typeof item.source === 'string' && item.source && item.source !== 'legacy') return item.source
  return item.contractId ? 'pt_gym' : 'legacy_unclassified'
}

async function main() {
  const token = await accessToken()
  const [ledger, cashAccounts, cashTransactions, attendance, payrollRuns] = await Promise.all([
    listCollection(token, 'ledgerEntries'),
    listCollection(token, 'cashAccounts'),
    listCollection(token, 'cashTransactions'),
    listCollection(token, 'attendanceEvents'),
    listCollection(token, 'payrollRuns'),
  ])
  const postedLedger = ledger.filter((item) => item.status === 'posted')
  const revenueEntries = postedLedger.filter((item) => item.type === 'revenue_recognition')
  const recognitionSessionIds = new Set(revenueEntries.map((item) => item.sessionId).filter(Boolean))
  const attendanceSessionIds = new Set(attendance.map((item) => item.sessionId).filter(Boolean))
  const recognisedAttendance = [...attendanceSessionIds].filter((id) => recognitionSessionIds.has(id)).length
  const bySource = {}
  postedLedger.forEach((item) => {
    const source = sourceOf(item)
    const current = bySource[source] || { entries: 0, cashImpact: 0, revenueImpact: 0, expenseImpact: 0 }
    current.entries += 1
    current.cashImpact += cashImpact(item)
    current.revenueImpact += Number(item.revenueImpact || 0)
    current.expenseImpact += Number(item.expenseImpact || 0)
    bySource[source] = current
  })
  const report = {
    generatedAt: new Date().toISOString(),
    mode: 'read-only',
    target: TARGET,
    writesPerformed: false,
    inventory: {
      ledgerEntries: ledger.length,
      postedLedgerEntries: postedLedger.length,
      cashAccounts: cashAccounts.length,
      cashTransactions: cashTransactions.length,
      attendanceEvents: attendance.length,
      uniqueAttendanceSessions: attendanceSessionIds.size,
      payrollRuns: payrollRuns.length,
    },
    totals: {
      cashImpact: postedLedger.reduce((total, item) => total + cashImpact(item), 0),
      recognisedRevenue: sum(postedLedger, 'revenueImpact'),
      operatingExpense: sum(postedLedger, 'expenseImpact'),
      cashAccountBalances: sum(cashAccounts.filter((item) => item.status !== 'inactive'), 'balance'),
    },
    reconciliation: {
      revenueRecognitionEntries: revenueEntries.length,
      recognisedAttendanceSessions: recognisedAttendance,
      attendanceSessionsWithoutRecognition: Math.max(0, attendanceSessionIds.size - recognisedAttendance),
      unlinkedCashTransactions: cashTransactions.filter((item) => !item.ledgerEntryId && !['opening_balance', 'transfer_in', 'transfer_out'].includes(item.type)).length,
      paidPayrollRunsOutsideLedger: payrollRuns.filter((item) => item.status === 'paid' && !item.ledgerEntryId).length,
    },
    bySource,
  }
  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true })
  const temporary = `${REPORT_PATH}.tmp`
  fs.writeFileSync(temporary, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 })
  fs.renameSync(temporary, REPORT_PATH)
  console.log(JSON.stringify(report, null, 2))
}

main().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})
