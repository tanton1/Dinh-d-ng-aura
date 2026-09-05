'use strict'

const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const TARGET = Object.freeze({
  projectId: 'gen-lang-client-0815966909',
  databaseId: 'ai-studio-aurafitnesselear-0f7609b4-b8d1-4fb3-9d62-99a2c03e1ce7',
})

function periodId(value = '') {
  const result = value || new Date(Date.now() + 7 * 60 * 60_000).toISOString().slice(0, 7)
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(result)) throw new Error('Period must use YYYY-MM.')
  return result
}

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
  if ('arrayValue' in value) return (value.arrayValue?.values || []).map(decode)
  if ('mapValue' in value) return decodeFields(value.mapValue?.fields || {})
  return undefined
}

function decodeFields(fields = {}) {
  return Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, decode(value)]))
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
    ...decodeFields(row.document.fields || {}),
  }))
}

function lastDate(period) {
  const [year, month] = period.split('-').map(Number)
  return `${period}-${String(new Date(Date.UTC(year, month, 0)).getUTCDate()).padStart(2, '0')}`
}

function hour(value) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= 23 ? parsed : null
}

function shiftKey(value) {
  const trainerId = typeof value.trainerId === 'string' ? value.trainerId : typeof value.staffId === 'string' ? value.staffId : ''
  const date = typeof value.date === 'string' ? value.date.slice(0, 10) : ''
  const normalizedHour = hour(value.hour)
  return trainerId && /^\d{4}-\d{2}-\d{2}$/.test(date) && normalizedHour !== null
    ? `${trainerId}|${date}|${normalizedHour}`
    : ''
}

function digest(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 12)
}

async function main() {
  const period = periodId(process.argv.find((argument) => argument.startsWith('--period='))?.slice(9))
  const token = await accessToken()
  const [sessions, items, runs] = await Promise.all([
    runQuery(token, {
      from: [{ collectionId: 'sessions' }],
      where: { compositeFilter: { op: 'AND', filters: [
        { fieldFilter: { field: { fieldPath: 'date' }, op: 'GREATER_THAN_OR_EQUAL', value: { stringValue: `${period}-01` } } },
        { fieldFilter: { field: { fieldPath: 'date' }, op: 'LESS_THAN_OR_EQUAL', value: { stringValue: lastDate(period) } } },
      ] } },
      limit: 5001,
    }),
    runQuery(token, {
      from: [{ collectionId: 'payrollRunItems' }],
      where: { fieldFilter: { field: { fieldPath: 'periodId' }, op: 'EQUAL', value: { stringValue: period } } },
      limit: 501,
    }),
    runQuery(token, {
      from: [{ collectionId: 'payrollRuns' }],
      where: { fieldFilter: { field: { fieldPath: 'periodId' }, op: 'EQUAL', value: { stringValue: period } } },
      limit: 10,
    }),
  ])

  const eligibleSessions = sessions.filter((session) => ['completed', 'attended'].includes(session.status))
  const duplicateStudentDayMap = new Map()
  eligibleSessions.forEach((session) => {
    const studentId = String(session.studentId || '')
    const date = typeof session.date === 'string' ? session.date.slice(0, 10) : ''
    if (!studentId || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return
    const key = `${studentId}|${date}`
    duplicateStudentDayMap.set(key, [...(duplicateStudentDayMap.get(key) || []), session])
  })
  const duplicateStudentDays = [...duplicateStudentDayMap.entries()]
    .filter(([, rows]) => rows.length > 1)
    .map(([key, rows]) => {
      const separator = key.lastIndexOf('|')
      return {
        studentHash: digest(`students/${key.slice(0, separator)}`),
        date: key.slice(separator + 1),
        sessionHashes: rows.map((session) => digest(`sessions/${session.id}`)),
        trainerHashes: [...new Set(rows.map((session) => session.trainerId).filter(Boolean))].map((trainerId) => digest(`trainers/${trainerId}`)),
        hours: [...new Set(rows.map((session) => hour(session.hour)).filter((value) => value !== null))].sort((left, right) => left - right),
      }
    })
  const shiftMap = new Map()
  let invalidSessionCount = 0
  eligibleSessions.forEach((session) => {
    const key = shiftKey(session)
    if (!key) { invalidSessionCount += 1; return }
    const current = shiftMap.get(key) || { sessionIds: new Set(), studentIds: new Set() }
    current.sessionIds.add(session.id)
    if (session.studentId) current.studentIds.add(session.studentId)
    shiftMap.set(key, current)
  })

  const itemDiagnostics = items.map((item) => {
    const slots = Array.isArray(item.teachingSlots) ? item.teachingSlots : []
    const uniqueKeys = new Set(slots.map((slot) => shiftKey({ ...slot, trainerId: item.trainerId || item.staffId })).filter(Boolean))
    const summedRate = slots.reduce((total, slot) => total + Math.max(0, Number(slot.rate || 0)), 0)
    return {
      staffRef: digest(item.staffId || item.trainerId || item.id),
      storedSlotCount: Number(item.sessionCount || 0),
      slotRecords: slots.length,
      uniqueSlotCount: uniqueKeys.size,
      duplicateSlotRecords: Math.max(0, slots.length - uniqueKeys.size),
      storedTeachingPay: Number(item.teachingPayAmount || 0),
      summedSlotRates: summedRate,
      teachingPayDelta: Number(item.teachingPayAmount || 0) - summedRate,
    }
  })
  const report = {
    generatedAt: new Date().toISOString(),
    target: TARGET,
    period,
    source: {
      sessionDocuments: sessions.length,
      eligibleLearnerSessions: eligibleSessions.length,
      uniqueTeachingShifts: shiftMap.size,
      pairedTeachingShifts: [...shiftMap.values()].filter((slot) => slot.studentIds.size >= 2).length,
      duplicateStudentDayCount: duplicateStudentDays.length,
      duplicateStudentSessionCount: duplicateStudentDays.reduce((total, item) => total + item.sessionHashes.length, 0),
      invalidSessionCount,
      truncated: sessions.length > 5000 || items.length > 500,
    },
    payrollRuns: runs.map((run) => ({
      id: run.id,
      status: run.status || '',
      schemaVersion: Number(run.schemaVersion || 0),
      storedTeachingSlotCount: Number(run.teachingSlotCount ?? run.attendanceCount ?? 0),
      storedTeachingPay: Number(run.teachingPayAmount || 0),
      storedCommission: Number(run.commissionAmount || 0),
      storedGrossAmount: Number(run.grossAmount || 0),
      storedFinalAmount: Number(run.finalAmount || 0),
    })),
    payrollItems: {
      count: itemDiagnostics.length,
      duplicateSlotItemCount: itemDiagnostics.filter((item) => item.duplicateSlotRecords > 0).length,
      teachingPayMismatchItemCount: itemDiagnostics.filter((item) => item.teachingPayDelta !== 0).length,
      diagnostics: itemDiagnostics,
    },
    duplicateStudentDays,
  }
  const output = path.resolve('.migration-private', `firebase-payroll-integrity-${period}.json`)
  fs.mkdirSync(path.dirname(output), { recursive: true })
  fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`)
  console.log(JSON.stringify({
    period,
    eligibleLearnerSessions: report.source.eligibleLearnerSessions,
    uniqueTeachingShifts: report.source.uniqueTeachingShifts,
    pairedTeachingShifts: report.source.pairedTeachingShifts,
    duplicateStudentDayCount: report.source.duplicateStudentDayCount,
    duplicateStudentSessionCount: report.source.duplicateStudentSessionCount,
    payrollRunCount: report.payrollRuns.length,
    duplicateSlotItemCount: report.payrollItems.duplicateSlotItemCount,
    teachingPayMismatchItemCount: report.payrollItems.teachingPayMismatchItemCount,
    report: output,
  }, null, 2))
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
