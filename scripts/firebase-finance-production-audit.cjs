const fs = require('node:fs')
const path = require('node:path')
const { teachingSlotsFromAttendance } = require('../functions/payroll')

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
  const [ledger, cashAccounts, cashTransactions, attendance, payrollRuns, payrollPolicies, payrollRunItems, trainers, staff, users, sessions] = await Promise.all([
    listCollection(token, 'ledgerEntries'),
    listCollection(token, 'cashAccounts'),
    listCollection(token, 'cashTransactions'),
    listCollection(token, 'attendanceEvents'),
    listCollection(token, 'payrollRuns'),
    listCollection(token, 'payrollPolicies'),
    listCollection(token, 'payrollRunItems'),
    listCollection(token, 'trainers'),
    listCollection(token, 'staff'),
    listCollection(token, 'users'),
    listCollection(token, 'sessions'),
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
  const trainerById = new Map(trainers.map((item) => [item.id, item]))
  const staffById = new Map(staff.map((item) => [item.id, item]))
  const userById = new Map(users.map((item) => [item.id, item]))
  const identityName = (item) => item?.name || item?.fullName || item?.displayName || ''
  const payrollQuality = payrollRunItems.reduce((result, item) => {
    const teachingSlots = Array.isArray(item.teachingSlots) ? item.teachingSlots : []
    const storedCount = Number(item.sessionCount || 0)
    const exactIdentityName = identityName(trainerById.get(item.trainerId)) || identityName(staffById.get(item.trainerId)) || identityName(userById.get(item.trainerId))
    result.storedTeachingSlots += storedCount
    result.snapshotTeachingSlots += teachingSlots.length
    result.attendanceEvents += Number(item.attendanceEventCount || storedCount || 0)
    if (!identityName(item.trainerSnapshot)) result.missingSnapshotName += 1
    if (!exactIdentityName) result.missingExactIdentityName += 1
    if (!teachingSlots.length) result.itemsWithoutTeachingSlotDetails += 1
    if (teachingSlots.length && teachingSlots.length !== storedCount) result.slotCountMismatches += 1
    return result
  }, {
    storedTeachingSlots: 0,
    snapshotTeachingSlots: 0,
    attendanceEvents: 0,
    missingSnapshotName: 0,
    missingExactIdentityName: 0,
    itemsWithoutTeachingSlotDetails: 0,
    slotCountMismatches: 0,
  })
  const sessionById = new Map(sessions.map((item) => [item.id, item]))
  const legacyDraftPreviews = payrollRuns
    .filter((run) => run.status === 'draft' && Number(run.schemaVersion || 0) < 4 && /^\d{4}-\d{2}$/.test(run.periodId || ''))
    .map((run) => {
      const [year, month] = run.periodId.split('-').map(Number)
      const start = new Date(`${run.periodId}-01T00:00:00+07:00`)
      const end = new Date(`${month === 12 ? year + 1 : year}-${String(month === 12 ? 1 : month + 1).padStart(2, '0')}-01T00:00:00+07:00`)
      const runAttendance = attendance.filter((item) => {
        const occurredAt = new Date(item.occurredAt || '')
        return !Number.isNaN(occurredAt.getTime()) && occurredAt >= start && occurredAt < end
      })
      const runItems = payrollRunItems.filter((item) => item.runId === run.id)
      const rate = Number(run.policySnapshot?.ratePerSession || runItems.find((item) => Number(item.ratePerSession || 0) > 0)?.ratePerSession || 0)
      try {
        const preview = teachingSlotsFromAttendance(runAttendance, sessionById, {
          ratePerSession: rate,
          dailySessionThreshold: 8,
          rateAfterDailyThreshold: rate,
          eveningStartHour: 20,
          rateAfterDailyThresholdEvening: rate,
        })
        return {
          periodId: run.periodId,
          attendanceEvents: preview.attendanceEventCount,
          teachingSlots: preview.teachingSlotCount,
          trainers: preview.trainers.size,
          compression: preview.attendanceEventCount - preview.teachingSlotCount,
        }
      } catch (error) {
        return { periodId: run.periodId, errorCode: error?.code || 'preview_failed' }
      }
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
      payrollPolicies: payrollPolicies.length,
      payrollRunItems: payrollRunItems.length,
      sessions: sessions.length,
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
    payrollQuality: {
      ...payrollQuality,
      runStatuses: payrollRuns.reduce((result, item) => {
        const key = typeof item.status === 'string' && item.status ? item.status : 'unknown'
        result[key] = (result[key] || 0) + 1
        return result
      }, {}),
      trainerDocuments: trainers.length,
      staffDocuments: staff.length,
      userDocuments: users.length,
      runSchemaVersions: [...new Set(payrollRuns.map((item) => Number(item.schemaVersion || 0)))].sort((left, right) => left - right),
      itemSchemaVersions: [...new Set(payrollRunItems.map((item) => Number(item.schemaVersion || 0)))].sort((left, right) => left - right),
      runFieldNames: [...new Set(payrollRuns.flatMap((item) => Object.keys(item)))].sort(),
      itemFieldNames: [...new Set(payrollRunItems.flatMap((item) => Object.keys(item)))].sort(),
      policySnapshotFieldNames: [...new Set(payrollRuns.flatMap((item) => item.policySnapshot && typeof item.policySnapshot === 'object' ? Object.keys(item.policySnapshot) : []))].sort(),
      legacyDraftPreviews,
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
