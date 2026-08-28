'use strict'

const fs = require('node:fs')
const path = require('node:path')

const TARGET = Object.freeze({
  projectId: 'gen-lang-client-0815966909',
  databaseId: 'ai-studio-aurafitnesselear-0f7609b4-b8d1-4fb3-9d62-99a2c03e1ce7',
})
const REPORT = path.resolve('.migration-private', 'current-week-attendance-audit.json')
const AUTO_CONFIRM_MS = 48 * 60 * 60_000

function firebaseAuth() {
  const root = path.join(process.env.APPDATA || '', 'npm', 'node_modules', 'firebase-tools', 'lib')
  const auth = require(path.join(root, 'auth.js'))
  const account = auth.getProjectDefaultAccount(process.cwd()) || auth.getGlobalDefaultAccount()
  if (!account?.tokens?.refresh_token) throw new Error('Firebase CLI is not signed in.')
  return { auth, account }
}

async function accessToken() {
  const { auth, account } = firebaseAuth()
  const result = await auth.getAccessToken(account.tokens.refresh_token, [])
  if (!result?.access_token) throw new Error('Unable to obtain a Firebase access token.')
  return result.access_token
}

function dateKey(now = new Date()) {
  return new Date(now.getTime() + 7 * 60 * 60_000).toISOString().slice(0, 10)
}

function addDays(value, days) {
  const parsed = new Date(`${value}T00:00:00.000Z`)
  parsed.setUTCDate(parsed.getUTCDate() + days)
  return parsed.toISOString().slice(0, 10)
}

function monday(value) {
  const parsed = new Date(`${value}T00:00:00.000Z`)
  const weekday = parsed.getUTCDay()
  return addDays(value, weekday === 0 ? -6 : 1 - weekday)
}

function decode(value = {}) {
  if ('stringValue' in value) return value.stringValue
  if ('integerValue' in value) return Number(value.integerValue)
  if ('doubleValue' in value) return Number(value.doubleValue)
  if ('booleanValue' in value) return value.booleanValue
  if ('nullValue' in value) return null
  return undefined
}

function fields(value = {}) {
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, decode(item)]))
}

async function runQuery(token, structuredQuery) {
  const database = `projects/${TARGET.projectId}/databases/${TARGET.databaseId}`
  const response = await fetch(`https://firestore.googleapis.com/v1/${database}/documents:runQuery`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ structuredQuery }),
  })
  if (!response.ok) throw new Error(`Firestore query failed (${response.status}).`)
  const rows = await response.json()
  return rows.filter((row) => row.document).map((row) => ({
    id: row.document.name.split('/').pop(),
    ...fields(row.document.fields),
  }))
}

function sessionHour(value, sessionId) {
  if (Number.isInteger(value) && value >= 0 && value <= 23) return value
  const fallback = Number(String(sessionId).split('-')[1])
  return Number.isInteger(fallback) && fallback >= 0 && fallback <= 23 ? fallback : null
}

function sessionStart(session, sessionId) {
  const date = typeof session.date === 'string' ? session.date.slice(0, 10) : ''
  const hour = sessionHour(session.hour, sessionId)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || hour === null) return null
  const result = new Date(`${date}T${String(hour).padStart(2, '0')}:00:00+07:00`)
  return Number.isNaN(result.getTime()) ? null : result
}

async function main() {
  const now = new Date()
  const today = dateKey(now)
  const weekStart = monday(today)
  const token = await accessToken()
  const [sessions, contracts] = await Promise.all([
    runQuery(token, {
        from: [{ collectionId: 'sessions' }],
        where: { compositeFilter: { op: 'AND', filters: [
          { fieldFilter: { field: { fieldPath: 'date' }, op: 'GREATER_THAN_OR_EQUAL', value: { stringValue: weekStart } } },
          { fieldFilter: { field: { fieldPath: 'date' }, op: 'LESS_THAN', value: { stringValue: addDays(today, 1) } } },
        ] } },
        orderBy: [{ field: { fieldPath: 'date' }, direction: 'ASCENDING' }],
        limit: 2001,
    }),
    runQuery(token, { from: [{ collectionId: 'contracts' }], limit: 2000 }),
  ])
  const contractsById = new Map(contracts.map((contract) => [contract.id, contract]))
  const contractsByStudent = new Map()
  contracts.forEach((contract) => {
    const list = contractsByStudent.get(contract.studentId) || []
    list.push(contract)
    contractsByStudent.set(contract.studentId, list)
  })
  const summary = {
    total: sessions.length,
    elapsed: 0,
    activeElapsed: 0,
    chargedPending: 0,
    billingReviewRequired: 0,
    billingReviewPendingAttendance: 0,
    pendingWithin48Hours: 0,
    pendingOver48Hours: 0,
    unchargedDue: 0,
    confirmedPresent: 0,
    confirmedLate: 0,
    confirmedNoShow: 0,
    cancelledOrExempt: 0,
    invalidTime: 0,
    missingContract: 0,
    blockedUnchargedReasons: {},
    blockedContractStatuses: {},
    blockedContractDiagnostics: {},
    alternateContractResolution: { unique: 0, ambiguous: 0, none: 0 },
    truncated: sessions.length > 2000,
  }
  for (const session of sessions.slice(0, 2000)) {
    const startsAt = sessionStart(session, session.id)
    if (!startsAt) { summary.invalidTime += 1; continue }
    if (startsAt.getTime() > now.getTime()) continue
    summary.elapsed += 1
    if (!session.contractId) summary.missingContract += 1
    if (session.scheduleStatus === 'cancelled' || session.billingStatus === 'exempt' || ['student_cancelled', 'trainer_cancelled', 'cancelled'].includes(session.status)) {
      summary.cancelledOrExempt += 1
      continue
    }
    if (['scheduled', 'rescheduled'].includes(session.status)) summary.activeElapsed += 1
    if (session.billingStatus === 'review_required') summary.billingReviewRequired += 1
    if (session.attendanceStatus === 'present' || ['completed', 'attended'].includes(session.status)) summary.confirmedPresent += 1
    else if (session.attendanceStatus === 'late') summary.confirmedLate += 1
    else if (session.attendanceStatus === 'no_show' || session.status === 'no_show') summary.confirmedNoShow += 1
    else if (session.billingStatus === 'charged' || session.billingStatus === 'review_required') {
      if (session.billingStatus === 'charged') summary.chargedPending += 1
      else summary.billingReviewPendingAttendance += 1
      if (startsAt.getTime() + AUTO_CONFIRM_MS <= now.getTime()) summary.pendingOver48Hours += 1
      else summary.pendingWithin48Hours += 1
    } else if (['scheduled', 'rescheduled'].includes(session.status)) {
      summary.unchargedDue += 1
      const contract = contractsById.get(session.contractId)
      const sessionDate = typeof session.date === 'string' ? session.date.slice(0, 10) : ''
      const reason = !session.contractId
        ? 'missing_contract_id'
        : !contract
          ? 'contract_not_found'
          : contract.studentId !== session.studentId
            ? 'contract_student_mismatch'
            : contract.status !== 'active'
              ? 'contract_not_active'
              : sessionDate < String(contract.startDate || '').slice(0, 10) || sessionDate > String(contract.endDate || '').slice(0, 10)
                ? 'outside_contract_term'
                : Number(contract.usedSessions || 0) >= Number(contract.totalSessions || 0)
                  ? 'contract_quota_exhausted'
                  : 'retry_pending'
      summary.blockedUnchargedReasons[reason] = Number(summary.blockedUnchargedReasons[reason] || 0) + 1
      if (contract) {
        const status = String(contract.status || 'missing')
        summary.blockedContractStatuses[status] = Number(summary.blockedContractStatuses[status] || 0) + 1
        const withinTerm = sessionDate >= String(contract.startDate || '').slice(0, 10)
          && sessionDate <= String(contract.endDate || '').slice(0, 10)
        const hasQuota = Number(contract.usedSessions || 0) < Number(contract.totalSessions || 0)
        const diagnostic = `${status}_${withinTerm ? 'in_term' : 'outside_term'}_${hasQuota ? 'has_quota' : 'quota_exhausted'}`
        summary.blockedContractDiagnostics[diagnostic] = Number(summary.blockedContractDiagnostics[diagnostic] || 0) + 1
      }
      const alternatives = (contractsByStudent.get(session.studentId) || []).filter((candidate) => (
        candidate.id !== session.contractId
        && ['active', 'expired'].includes(candidate.status)
        && sessionDate >= String(candidate.startDate || '').slice(0, 10)
        && sessionDate <= String(candidate.endDate || '').slice(0, 10)
        && Number(candidate.usedSessions || 0) < Number(candidate.totalSessions || 0)
      ))
      const resolution = alternatives.length === 1 ? 'unique' : alternatives.length > 1 ? 'ambiguous' : 'none'
      summary.alternateContractResolution[resolution] += 1
    }
  }
  const report = { target: TARGET, generatedAt: now.toISOString(), weekStart, through: today, summary }
  fs.mkdirSync(path.dirname(REPORT), { recursive: true })
  fs.writeFileSync(REPORT, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 })
  console.log(JSON.stringify({ weekStart, through: today, ...summary }))
}

main().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})
