'use strict'

const crypto = require('node:crypto')
const path = require('node:path')

const TARGET = Object.freeze({
  projectId: 'gen-lang-client-0815966909',
  databaseId: 'ai-studio-aurafitnesselear-0f7609b4-b8d1-4fb3-9d62-99a2c03e1ce7',
})

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 16)
}

function normalizePhone(value) {
  return String(value || '').replace(/\D/g, '').replace(/^84(?=\d{9}$)/, '0')
}

function firebaseCliAuth() {
  if (!process.env.APPDATA) throw new Error('APPDATA is unavailable.')
  const auth = require(path.join(process.env.APPDATA, 'npm', 'node_modules', 'firebase-tools', 'lib', 'auth.js'))
  const account = auth.getProjectDefaultAccount(process.cwd()) || auth.getGlobalDefaultAccount()
  if (!account?.tokens?.refresh_token) throw new Error('Firebase CLI is not signed in.')
  return { auth, account }
}

async function accessToken() {
  const { auth, account } = firebaseCliAuth()
  const result = await auth.getAccessToken(account.tokens.refresh_token, [])
  if (!result?.access_token) throw new Error('Unable to obtain a Firebase access token.')
  return result.access_token
}

function baseUrl() {
  return `https://firestore.googleapis.com/v1/projects/${TARGET.projectId}/databases/${encodeURIComponent(TARGET.databaseId)}`
}

async function requestJson(token, endpoint, options = {}) {
  const response = await fetch(`${baseUrl()}${endpoint}`, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(options.headers || {}) },
  })
  const raw = await response.text()
  if (!response.ok) throw new Error(`Firestore request failed (${response.status}).`)
  return raw ? JSON.parse(raw) : null
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

async function query(token, collectionId, filters = []) {
  const fieldFilters = filters.map(([fieldPath, op, value]) => ({
    fieldFilter: {
      field: { fieldPath },
      op,
      value: { stringValue: value },
    },
  }))
  const where = fieldFilters.length === 0
    ? undefined
    : fieldFilters.length === 1
      ? fieldFilters[0]
      : { compositeFilter: { op: 'AND', filters: fieldFilters } }
  const body = {
    structuredQuery: {
      from: [{ collectionId }],
      ...(where ? { where } : {}),
      orderBy: [{ field: { fieldPath: '__name__' }, direction: 'ASCENDING' }],
    },
  }
  const rows = await requestJson(token, '/documents:runQuery', { method: 'POST', body: JSON.stringify(body) })
  const prefix = `projects/${TARGET.projectId}/databases/${TARGET.databaseId}/documents/${collectionId}/`
  return (Array.isArray(rows) ? rows : [rows]).filter((row) => row?.document?.name?.startsWith(prefix)).map((row) => ({
    id: row.document.name.slice(prefix.length),
    data: decodeFields(row.document.fields || {}),
  }))
}

function mondayInSaigon(offsetWeeks = 0) {
  const shifted = new Date(Date.now() + 7 * 60 * 60 * 1000)
  const day = shifted.getUTCDay()
  shifted.setUTCDate(shifted.getUTCDate() - (day === 0 ? 6 : day - 1) + offsetWeeks * 7)
  return shifted.toISOString().slice(0, 10)
}

function scheduleEntryCount(value) {
  return Object.values(value || {}).reduce((total, entries) => total + (Array.isArray(entries) ? entries.length : 0), 0)
}

function statusCount(values) {
  return values.reduce((result, value) => {
    const status = String(value.data.status || 'missing')
    result[status] = Number(result[status] || 0) + 1
    return result
  }, {})
}

async function main() {
  const phoneArgument = process.argv.find((item) => item.startsWith('--student-phone='))
  const nameArgument = process.argv.find((item) => item.startsWith('--student-name='))
  const phone = normalizePhone(phoneArgument?.slice('--student-phone='.length))
  const studentName = String(nameArgument?.slice('--student-name='.length) || '').trim().toLocaleLowerCase('vi')
  const token = await accessToken()
  const metadata = await requestJson(token, '')
  if (metadata?.name !== `projects/${TARGET.projectId}/databases/${TARGET.databaseId}`) throw new Error('Unexpected Firestore target.')

  const currentWeek = mondayInSaigon(0)
  const nextWeek = mondayInSaigon(1)
  const [branches, students, trainers, contracts, availability, drafts] = await Promise.all([
    query(token, 'branches'),
    query(token, 'students'),
    query(token, 'trainers'),
    query(token, 'contracts'),
    query(token, 'ptAvailability'),
    query(token, 'ptScheduleDrafts'),
  ])
  const activeBranches = branches.filter((item) => item.data.status !== 'archived').sort((left, right) => left.id.localeCompare(right.id))
  const branchSummary = activeBranches.map((branch, index) => {
    const branchStudents = students.filter((item) => item.data.branchId === branch.id && item.data.status !== 'inactive')
    const studentIds = new Set(branchStudents.map((item) => item.id))
    const branchTrainers = trainers.filter((item) => item.data.branchId === branch.id && item.data.status !== 'inactive')
    const currentAvailability = availability.filter((item) => item.data.weekId === currentWeek && studentIds.has(item.data.studentId))
    const nextAvailability = availability.filter((item) => item.data.weekId === nextWeek && studentIds.has(item.data.studentId))
    const draft = (week) => drafts.find((item) => item.id === `${branch.id}_${week}`)
    return {
      branch: `branch-${index + 1}`,
      branchHash: sha256(branch.id),
      activeStudents: branchStudents.length,
      weeklySessionDemand: branchStudents.reduce((total, item) => total + Math.max(0, Number(item.data.sessionsPerWeek || 0)), 0),
      legacyAvailability: {
        withSlots: branchStudents.filter((item) => Array.isArray(item.data.availableSlots) && item.data.availableSlots.length > 0).length,
        confirmed: branchStudents.filter((item) => item.data.isScheduleConfirmed === true).length,
      },
      trainers: branchTrainers.length,
      trainerModes: statusCount(branchTrainers.map((item) => ({ data: { status: item.data.availabilityMode || 'missing' } }))),
      currentWeek: {
        weekId: currentWeek,
        availability: statusCount(currentAvailability),
        missingAvailability: Math.max(0, branchStudents.length - currentAvailability.length),
        draftEntries: scheduleEntryCount(draft(currentWeek)?.data.schedule),
      },
      nextWeek: {
        weekId: nextWeek,
        availability: statusCount(nextAvailability),
        missingAvailability: Math.max(0, branchStudents.length - nextAvailability.length),
        draftEntries: scheduleEntryCount(draft(nextWeek)?.data.schedule),
      },
    }
  })

  let studentAudit = null
  if (phone || studentName) {
    const matches = students.filter((item) => phone
      ? normalizePhone(item.data.phone) === phone
      : String(item.data.name || '').trim().toLocaleLowerCase('vi') === studentName)
    if (matches.length === 1) {
      const student = matches[0]
      const [sessions, attendance] = await Promise.all([
        query(token, 'sessions', [['studentId', 'EQUAL', student.id]]),
        query(token, 'attendanceEvents', [['studentId', 'EQUAL', student.id]]),
      ])
      const studentContracts = contracts.filter((item) => item.data.studentId === student.id)
      studentAudit = {
        matched: true,
        studentHash: sha256(student.id),
        sessions: statusCount(sessions),
        attendance: statusCount(attendance.map((item) => ({ data: { status: item.data.attendanceStatus || 'missing' } }))),
        contracts: studentContracts.map((contract) => {
          const linkedCompleted = sessions.filter((item) => item.data.contractId === contract.id && ['completed', 'attended'].includes(item.data.status)).length
          const legacyCompletedInTerm = sessions.filter((item) => !item.data.contractId
            && ['completed', 'attended'].includes(item.data.status)
            && String(item.data.date || '').slice(0, 10) >= String(contract.data.startDate || '').slice(0, 10)
            && String(item.data.date || '').slice(0, 10) <= String(contract.data.endDate || '').slice(0, 10)).length
          const chargedAttendance = attendance.filter((item) => item.data.contractId === contract.id && item.data.billingStatus === 'charged').length
          return {
            contractHash: sha256(contract.id),
            status: contract.data.status || 'missing',
            startDate: String(contract.data.startDate || '').slice(0, 10),
            endDate: String(contract.data.endDate || '').slice(0, 10),
            totalSessions: Number(contract.data.totalSessions || 0),
            usedSessionsProjection: Number(contract.data.usedSessions || 0),
            attendedClassesProjection: Array.isArray(contract.data.attendedClasses) ? new Set(contract.data.attendedClasses).size : 0,
            chargedSessionProjection: Array.isArray(contract.data.chargedSessionIds) ? new Set(contract.data.chargedSessionIds).size : 0,
            linkedCompletedSessions: linkedCompleted,
            legacyCompletedInTerm,
            chargedAttendance,
          }
        }),
      }
    } else studentAudit = { matched: false, matchCount: matches.length }
  }

  console.log(JSON.stringify({
    target: TARGET,
    generatedAt: new Date().toISOString(),
    readsOnly: true,
    branchSummary,
    studentAudit,
  }, null, 2))
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'PT schedule audit failed.')
  process.exitCode = 1
})
