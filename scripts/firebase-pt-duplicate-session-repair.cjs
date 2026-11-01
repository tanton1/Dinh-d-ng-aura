'use strict'

// Target-only, digest-locked repair for duplicate PT sessions created when a
// legacy branchId=all schedule was published again into a branch-scoped row.
// The repair never deletes a Firestore document: it cancels/exempts only the
// active duplicate and preserves the completed legacy session as evidence.

const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const { TARGET, accessToken, decodeFields, requestJson } = require('./firebase-pt-schedule-audit.cjs')

const PLAN_VERSION = 'pt-duplicate-session-repair-v1'
const APPLY_CONFIRMATION = 'APPLY_PT_DUPLICATE_SESSION_REPAIR_V1'
const ACTOR = `system:${PLAN_VERSION}`
const REASON = 'Duplicate legacy session repaired by production schedule reconciliation'
const ACTIVE_STATUSES = new Set(['scheduled', 'rescheduled'])
const EVIDENCE_STATUSES = new Set(['completed', 'attended', 'no_show'])
const REPORT_DIR = path.resolve('.migration-private')
const MAX_DOCUMENTS_PER_READ = 2001
const MAX_WRITES_PER_COMMIT = 200

function addDays(date, days) {
  return new Date(Date.parse(`${date}T00:00:00.000Z`) + days * 86400000).toISOString().slice(0, 10)
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex')
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((result, key) => {
      result[key] = canonical(value[key])
      return result
    }, {})
  }
  return value
}

function canonicalJson(value) {
  return JSON.stringify(canonical(value))
}

function parseArguments(argv) {
  const result = { mode: 'dry-run' }
  for (const argument of argv) {
    if (argument === '--help' || argument === '-h') result.help = true
    else if (argument.startsWith('--mode=')) result.mode = argument.slice('--mode='.length)
    else if (argument.startsWith('--week=')) result.week = argument.slice('--week='.length)
    else if (argument.startsWith('--project=')) result.projectId = argument.slice('--project='.length)
    else if (argument.startsWith('--database=')) result.databaseId = argument.slice('--database='.length)
    else if (argument.startsWith('--digest=')) result.digest = argument.slice('--digest='.length)
    else if (argument.startsWith('--confirm=')) result.confirmation = argument.slice('--confirm='.length)
    else throw new Error(`Unknown argument: ${argument.split('=')[0]}`)
  }
  if (!['dry-run', 'apply', 'verify'].includes(result.mode)) throw new Error('Mode must be dry-run, apply, or verify.')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result.week || '')) throw new Error('Provide a Monday --week=YYYY-MM-DD.')
  const parsed = new Date(`${result.week}T00:00:00.000Z`)
  if (Number.isNaN(parsed.getTime()) || parsed.getUTCDay() !== 1) throw new Error('The repair week must start on Monday.')
  return result
}

function usage() {
  return [
    'PT duplicate-session repair (defaults to read-only dry run)',
    '',
    `Dry run: node scripts/firebase-pt-duplicate-session-repair.cjs --week=YYYY-MM-DD`,
    '',
    `Apply: node scripts/firebase-pt-duplicate-session-repair.cjs --mode=apply --week=YYYY-MM-DD --project=${TARGET.projectId} --database=${TARGET.databaseId} --digest=<DRY_RUN_DIGEST> --confirm=${APPLY_CONFIRMATION}`,
    '',
    'Verify: node scripts/firebase-pt-duplicate-session-repair.cjs --mode=verify --week=YYYY-MM-DD',
  ].join('\n')
}

function assertTarget(arguments_) {
  if (arguments_.projectId && arguments_.projectId !== TARGET.projectId) throw new Error('Project override is not the approved target.')
  if (arguments_.databaseId && arguments_.databaseId !== TARGET.databaseId) throw new Error('Database override is not the approved named database.')
  if (arguments_.mode === 'apply') {
    if (arguments_.projectId !== TARGET.projectId || arguments_.databaseId !== TARGET.databaseId) throw new Error('Apply requires the exact target project and database guards.')
    if (!/^[a-f0-9]{64}$/.test(arguments_.digest || '')) throw new Error('Apply requires the latest dry-run digest.')
    if (arguments_.confirmation !== APPLY_CONFIRMATION) throw new Error('Apply confirmation is missing or incorrect.')
  }
}

function databaseName() {
  return `projects/${TARGET.projectId}/databases/${TARGET.databaseId}`
}

function documentName(collection, id) {
  return `${databaseName()}/documents/${collection}/${id}`
}

function encodeValue(value) {
  if (value === null || value === undefined) return { nullValue: null }
  if (typeof value === 'boolean') return { booleanValue: value }
  if (typeof value === 'number') return Number.isSafeInteger(value) ? { integerValue: String(value) } : { doubleValue: value }
  if (typeof value === 'string') return { stringValue: value }
  if (Array.isArray(value)) return { arrayValue: { values: value.map(encodeValue) } }
  if (value && typeof value === 'object') return { mapValue: { fields: encodeFields(value) } }
  throw new Error('Unsupported Firestore value.')
}

function encodeFields(value) {
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, encodeValue(item)]))
}

function dateKey(value) {
  return /^\d{4}-\d{2}-\d{2}/.exec(String(value || ''))?.[0] || ''
}

function sessionHour(value, id) {
  if (Number.isInteger(value) && value >= 0 && value <= 23) return value
  const match = /(?:^|-)T?[2-7]-(\d{1,2})-/.exec(String(id || ''))
  if (match && Number(match[1]) >= 0 && Number(match[1]) <= 23) return Number(match[1])
  const fallback = /(?:^|-)(\d{1,2})(?:-|$)/.exec(String(id || ''))
  return fallback && Number(fallback[1]) >= 0 && Number(fallback[1]) <= 23 ? Number(fallback[1]) : null
}

function safeId(value) {
  const result = typeof value === 'string' ? value.trim() : ''
  return /^[A-Za-z0-9_-]+$/.test(result) ? result : ''
}

function immutableEvidence(value) {
  return EVIDENCE_STATUSES.has(String(value?.status || '').toLowerCase())
}

function active(value) {
  return ACTIVE_STATUSES.has(String(value?.status || '').toLowerCase())
}

function readScopeQuery(collectionId, where, orderBy = '__name__') {
  return {
    structuredQuery: {
      from: [{ collectionId, allDescendants: false }],
      ...(where ? { where } : {}),
      orderBy: [{ field: { fieldPath: orderBy }, direction: 'ASCENDING' }],
      limit: MAX_DOCUMENTS_PER_READ,
    },
  }
}

async function readCollection(token, collectionId, where, orderBy = '__name__') {
  const rows = await requestJson(token, '/documents:runQuery', {
    method: 'POST',
    body: JSON.stringify(readScopeQuery(collectionId, where, orderBy)),
  })
  const prefix = `${databaseName()}/documents/${collectionId}/`
  const documents = (Array.isArray(rows) ? rows : [rows]).filter((row) => row?.document?.name?.startsWith(prefix)).map((row) => ({
    id: row.document.name.slice(prefix.length),
    name: row.document.name,
    updateTime: row.document.updateTime,
    data: decodeFields(row.document.fields || {}),
  }))
  if (documents.length >= MAX_DOCUMENTS_PER_READ) throw new Error(`Read limit exceeded for ${collectionId}.`)
  return documents
}

async function readAttendanceDocuments(token, ids, collection = 'attendanceEvents') {
  const safeIds = [...new Set(ids)].filter(safeId)
  if (!safeIds.length) return new Map()
  const result = new Map()
  for (let offset = 0; offset < safeIds.length; offset += 100) {
    const documents = safeIds.slice(offset, offset + 100).map((id) => documentName(collection, id))
    const rows = await requestJson(token, '/documents:batchGet', {
      method: 'POST',
      body: JSON.stringify({ documents }),
    })
    for (const row of Array.isArray(rows) ? rows : []) {
      if (!row?.found?.name?.startsWith(`${databaseName()}/documents/${collection}/`)) continue
      const id = row.found.name.slice(`${databaseName()}/documents/${collection}/`.length)
      result.set(id, {
        id,
        name: row.found.name,
        updateTime: row.found.updateTime,
        data: decodeFields(row.found.fields || {}),
      })
    }
  }
  return result
}

function sessionGroupKey(value, id) {
  const studentId = safeId(value.studentId)
  const trainerId = safeId(value.trainerId)
  const contractId = safeId(value.contractId)
  const date = dateKey(value.date)
  const hour = sessionHour(value.hour, id)
  const scheduleEntryId = safeId(value.scheduleEntryId)
  if (!studentId || !trainerId || !contractId || !date || hour === null || !scheduleEntryId) return null
  return [studentId, trainerId, contractId, date, hour, scheduleEntryId].join('|')
}

function buildPlan({ week, sessions, students, attendance, billing = new Map() }) {
  const studentNames = new Map(students.map((item) => [item.id, String(item.data.name || '').trim()]))
  const groups = new Map()
  const skipped = []
  for (const item of sessions) {
    const key = sessionGroupKey(item.data, item.id)
    if (!key) {
      skipped.push({ sessionId: item.id, reason: 'missing_duplicate_identity' })
      continue
    }
    const values = groups.get(key) || []
    values.push(item)
    groups.set(key, values)
  }

  const candidates = []
  const quarantined = []
  for (const [key, rows] of groups) {
    const legacy = rows.filter((item) => item.data.branchId === 'all' && immutableEvidence(item.data))
    const activeBranch = rows.filter((item) => item.data.branchId !== 'all'
      && active(item.data)
      && item.data.scheduleWeekId === week
      && String(item.data.id || item.id).startsWith('pt_'))
    if (legacy.length === 0 || activeBranch.length === 0) continue
    if (legacy.length !== 1 || activeBranch.length !== 1) {
      quarantined.push({ key, reason: 'ambiguous_duplicate_group', legacy: legacy.map((item) => item.id), active: activeBranch.map((item) => item.id) })
      continue
    }
    const canonical = legacy[0]
    const duplicate = activeBranch[0]
    const duplicateDate = dateKey(duplicate.data.date)
    const attendanceId = safeId(duplicate.data.attendanceEventId) || duplicate.id
    const attendanceRow = attendance.get(attendanceId) || null
    const attendanceLink = attendanceRow?.data?.sessionId === duplicate.id ? 'valid' : attendanceRow ? 'mismatch' : 'missing'
    if (attendanceLink === 'mismatch') {
      quarantined.push({ key, reason: 'attendance_link_mismatch', duplicateSessionId: duplicate.id, attendanceId })
      continue
    }
    // This old schedule-only repair cannot unwind a financial debit. Cancelling
    // the session alone leaves its receipt charged and double counts usage in
    // contract amendments. Route any financial evidence to contract review.
    const billingId = safeId(duplicate.data.billingEventId) || duplicate.id
    if (billing.has(billingId) || duplicate.data.billingStatus === 'charged' || duplicate.data.chargedAt
      || duplicate.data.billingEventId || duplicate.data.revenueRecognitionEntryId
      || attendanceRow?.data?.billingStatus === 'charged' || attendanceRow?.data?.revenueRecognitionEntryId) {
      quarantined.push({ key, reason: 'financial_evidence_requires_contract_reconciliation', duplicateSessionId: duplicate.id, canonicalSessionId: canonical.id })
      continue
    }
    if (!duplicate.updateTime || !canonical.updateTime || new Date(duplicate.updateTime) < new Date(canonical.updateTime)) {
      quarantined.push({ key, reason: 'unexpected_update_order', duplicateSessionId: duplicate.id, canonicalSessionId: canonical.id })
      continue
    }
    candidates.push({
      key,
      studentId: duplicate.data.studentId,
      studentName: studentNames.get(duplicate.data.studentId) || '',
      trainerId: duplicate.data.trainerId,
      contractId: duplicate.data.contractId,
      date: duplicateDate,
      hour: sessionHour(duplicate.data.hour, duplicate.id),
      scheduleEntryId: duplicate.data.scheduleEntryId,
      canonicalSessionId: canonical.id,
      canonicalUpdateTime: canonical.updateTime,
      duplicateSessionId: duplicate.id,
      duplicateUpdateTime: duplicate.updateTime,
      duplicateStatus: duplicate.data.status,
      duplicateBillingStatus: duplicate.data.billingStatus || '',
      duplicateRevision: Number.isSafeInteger(Number(duplicate.data.revision)) ? Number(duplicate.data.revision) : 0,
      attendanceId,
      attendanceUpdateTime: attendanceRow?.updateTime || null,
      attendanceLink,
    })
  }

  candidates.sort((left, right) => left.duplicateSessionId.localeCompare(right.duplicateSessionId))
  const digestInput = candidates.map((item) => ({
    key: item.key,
    canonicalSessionId: item.canonicalSessionId,
    canonicalUpdateTime: item.canonicalUpdateTime,
    duplicateSessionId: item.duplicateSessionId,
    duplicateUpdateTime: item.duplicateUpdateTime,
    duplicateStatus: item.duplicateStatus,
    duplicateBillingStatus: item.duplicateBillingStatus,
    duplicateRevision: item.duplicateRevision,
    attendanceId: item.attendanceId,
    attendanceUpdateTime: item.attendanceUpdateTime,
    attendanceLink: item.attendanceLink,
  }))
  const planDigest = sha256(canonicalJson({ version: PLAN_VERSION, target: TARGET, week, candidates: digestInput }))
  return { planDigest, candidates, quarantined, skipped, groups: groups.size, digestInput }
}

function reportPath(week, mode) {
  return path.join(REPORT_DIR, `firebase-pt-duplicate-session-repair-${week}-${mode}.json`)
}

function writeReport(week, mode, value) {
  fs.mkdirSync(REPORT_DIR, { recursive: true })
  const target = reportPath(week, mode)
  const temporary = `${target}.tmp`
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
  fs.renameSync(temporary, target)
}

function publicCandidate(item) {
  return {
    studentName: item.studentName,
    studentId: item.studentId,
    date: item.date,
    hour: item.hour,
    scheduleEntryId: item.scheduleEntryId,
    canonicalSessionId: item.canonicalSessionId,
    duplicateSessionId: item.duplicateSessionId,
    duplicateStatus: item.duplicateStatus,
    duplicateBillingStatus: item.duplicateBillingStatus,
    attendanceId: item.attendanceId,
    attendanceLink: item.attendanceLink,
  }
}

function sessionPatch(item) {
  return {
    status: 'cancelled',
    scheduleStatus: 'cancelled',
    billingStatus: 'exempt',
    attendanceStatus: null,
    cancellationReason: REASON,
    correctionReason: REASON,
    correctedBy: ACTOR,
    updatedBy: ACTOR,
    revision: item.duplicateRevision + 1,
    duplicateRepairVersion: 1,
  }
}

function attendancePatch() {
  return {
    type: 'cancelled',
    scheduleStatus: 'cancelled',
    billingStatus: 'exempt',
    attendanceStatus: 'cancelled',
    countsTowardContract: false,
    correctionReason: REASON,
    correctedBy: ACTOR,
    updatedBy: ACTOR,
    duplicateRepairVersion: 1,
  }
}

function updateWrite(collection, id, fields, updateTime) {
  return {
    update: {
      name: documentName(collection, id),
      fields: encodeFields(fields),
    },
    updateMask: { fieldPaths: Object.keys(fields) },
    currentDocument: { updateTime },
    updateTransforms: [
      { fieldPath: 'correctedAt', setToServerValue: 'REQUEST_TIME' },
      { fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' },
    ],
  }
}

function auditWrite(week, planDigest, candidates) {
  const id = `pt_duplicate_repair_${week.replaceAll('-', '')}_${planDigest.slice(0, 24)}`
  return {
    update: {
      name: documentName('ptOperationsAuditLogs', id),
      fields: encodeFields({
        schemaVersion: 1,
        action: 'pt_schedule.duplicate_sessions_repaired',
        actorUid: ACTOR,
        weekId: week,
        repairedCount: candidates.length,
        repairedSessionIds: candidates.map((item) => item.duplicateSessionId),
        preservedCanonicalSessionIds: candidates.map((item) => item.canonicalSessionId),
        reason: REASON,
        planDigest,
      }),
    },
    currentDocument: { exists: false },
    updateTransforms: [{ fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' }],
  }
}

function writesFor(week, plan) {
  const writes = []
  for (const item of plan.candidates) {
    writes.push(updateWrite('sessions', item.duplicateSessionId, sessionPatch(item), item.duplicateUpdateTime))
    if (item.attendanceLink === 'valid') writes.push(updateWrite('attendanceEvents', item.attendanceId, attendancePatch(), item.attendanceUpdateTime))
  }
  if (plan.candidates.length) writes.push(auditWrite(week, plan.planDigest, plan.candidates))
  return writes
}

async function applyWrites(token, week, plan) {
  const writes = writesFor(week, plan)
  for (let offset = 0; offset < writes.length; offset += MAX_WRITES_PER_COMMIT) {
    await requestJson(token, '/documents:commit', {
      method: 'POST',
      body: JSON.stringify({ writes: writes.slice(offset, offset + MAX_WRITES_PER_COMMIT) }),
    })
  }
  return writes.length
}

async function loadState(token, week) {
  const next = addDays(week, 7)
  const where = {
    compositeFilter: {
      op: 'AND',
      filters: [
        { fieldFilter: { field: { fieldPath: 'date' }, op: 'GREATER_THAN_OR_EQUAL', value: { stringValue: week } } },
        { fieldFilter: { field: { fieldPath: 'date' }, op: 'LESS_THAN', value: { stringValue: next } } },
      ],
    },
  }
  const [sessions, students] = await Promise.all([
    readCollection(token, 'sessions', where, 'date'),
    readCollection(token, 'students'),
  ])
  const preliminary = buildPlan({ week, sessions, students, attendance: new Map() })
  const [attendance, billing] = await Promise.all([
    readAttendanceDocuments(token, preliminary.candidates.map((item) => item.attendanceId)),
    readAttendanceDocuments(token, preliminary.candidates.map((item) => item.duplicateSessionId), 'sessionBillingEvents'),
  ])
  return { sessions, students, attendance, plan: buildPlan({ week, sessions, students, attendance, billing }) }
}

function makeReport({ mode, week, state, writesPerformed = false, approvedDryRunDigest = null, verified = null }) {
  const { sessions, students, attendance, plan } = state
  return {
    generatedAt: new Date().toISOString(),
    mode,
    target: TARGET,
    week,
    planVersion: PLAN_VERSION,
    planDigest: plan.planDigest,
    readScope: `sessions.date in [${week}, ${addDays(week, 7)}) plus students and linked attendanceEvents`,
    writeScope: mode === 'apply'
      ? 'active branch-scoped duplicate sessions -> cancelled/exempt; valid linked attendance -> cancelled/exempt; one audit log; no deletes'
      : 'none',
    inventory: { sessions: sessions.length, students: students.length, linkedAttendanceRead: attendance.size, duplicateIdentityGroups: plan.groups },
    eligibleCandidates: plan.candidates.length,
    attendanceUpdates: plan.candidates.filter((item) => item.attendanceLink === 'valid').length,
    candidates: plan.candidates.map(publicCandidate),
    quarantined: plan.quarantined,
    skippedIdentityRows: plan.skipped.length,
    writesPerformed,
    approvedDryRunDigest,
    verified,
    applyConfirmation: APPLY_CONFIRMATION,
  }
}

function loadDryRun(week, digest) {
  const file = reportPath(week, 'dry-run')
  if (!fs.existsSync(file)) throw new Error('Dry-run report is missing.')
  const report = JSON.parse(fs.readFileSync(file, 'utf8'))
  if (report?.mode !== 'dry-run' || report?.planVersion !== PLAN_VERSION || canonicalJson(report.target) !== canonicalJson(TARGET) || report.week !== week) throw new Error('Dry-run report is incompatible.')
  if (report.planDigest !== digest) throw new Error('Digest does not match the latest dry-run report.')
}

async function main() {
  const arguments_ = parseArguments(process.argv.slice(2))
  if (arguments_.help) return console.log(usage())
  assertTarget(arguments_)
  const token = await accessToken()
  const metadata = await requestJson(token, '')
  if (metadata?.name !== databaseName()) throw new Error('Live Firestore target mismatch.')

  if (arguments_.mode === 'apply') loadDryRun(arguments_.week, arguments_.digest)
  const before = await loadState(token, arguments_.week)

  if (arguments_.mode === 'dry-run') {
    const report = makeReport({ mode: 'dry-run', week: arguments_.week, state: before })
    writeReport(arguments_.week, 'dry-run', report)
    console.log(JSON.stringify({ mode: 'dry-run', week: arguments_.week, planDigest: before.plan.planDigest, eligibleCandidates: before.plan.candidates.length, attendanceUpdates: report.attendanceUpdates, candidates: report.candidates, quarantined: before.plan.quarantined.length, reportPath: reportPath(arguments_.week, 'dry-run') }, null, 2))
    return
  }

  if (arguments_.mode === 'apply') {
    if (before.plan.planDigest !== arguments_.digest) throw new Error('Target data changed after dry run; review a new report.')
    const writes = await applyWrites(token, arguments_.week, before.plan)
    const after = await loadState(token, arguments_.week)
    const verified = after.plan.candidates.length === 0
    const report = makeReport({ mode: 'apply', week: arguments_.week, state: after, writesPerformed: writes > 0, approvedDryRunDigest: arguments_.digest, verified })
    writeReport(arguments_.week, 'apply', report)
    console.log(JSON.stringify({ mode: 'apply', week: arguments_.week, writes, repairedSessions: before.plan.candidates.length, attendanceUpdates: before.plan.candidates.filter((item) => item.attendanceLink === 'valid').length, remainingCandidates: after.plan.candidates.length, verified, reportPath: reportPath(arguments_.week, 'apply') }, null, 2))
    if (!verified) process.exitCode = 2
    return
  }

  const verified = before.plan.candidates.length === 0
  const report = makeReport({ mode: 'verify', week: arguments_.week, state: before, verified })
  writeReport(arguments_.week, 'verify', report)
  console.log(JSON.stringify({ mode: 'verify', week: arguments_.week, remainingCandidates: before.plan.candidates.length, verified, quarantined: before.plan.quarantined.length, reportPath: reportPath(arguments_.week, 'verify') }, null, 2))
  if (!verified) process.exitCode = 2
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : 'PT duplicate-session repair failed.')
    process.exitCode = 1
  })
}

module.exports = { buildPlan, canonicalJson, sessionGroupKey }
