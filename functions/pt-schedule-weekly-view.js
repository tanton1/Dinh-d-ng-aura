'use strict'

const { createHash } = require('node:crypto')
const { FieldValue } = require('firebase-admin/firestore')
const { HttpsError } = require('firebase-functions/v2/https')
const {
  loadBranchData,
  safeSchedule,
  scheduleConflictWarningsForWorkspace,
} = require('./pt-schedule-v2')

// A weekly view is deliberately a projection, not a second source of truth.
// It contains enough information to paint the schedule and warning center but
// never contains raw attendance, billing, or contract history rows.
const WEEKLY_VIEW_SCHEMA_VERSION = 1
const MAX_VIEW_SCHEDULE_ENTRIES = 700
const MAX_VIEW_STUDENTS = 600
const MAX_VIEW_TRAINERS = 120
const MAX_VIEW_WARNINGS = 160

function weeklyViewId(branchId, weekId) {
  return `${String(branchId || '').trim()}_${String(weekId || '').trim()}`
}

function weeklyViewReference(db, branchId, weekId) {
  return db.doc(`ptScheduleWeeklyViews/${weeklyViewId(branchId, weekId)}`)
}

function stringValue(value, max = 240) {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function isoValue(value) {
  if (!value) return null
  if (typeof value === 'string') return value
  if (typeof value.toDate === 'function') return value.toDate().toISOString()
  if (typeof value.toISOString === 'function') return value.toISOString()
  return null
}

function normalizedMissingFields(student = {}) {
  const missing = []
  if (!stringValue(student.name)) missing.push('name')
  if (!stringValue(student.phone)) missing.push('phone')
  if (!stringValue(student.email)) missing.push('email')
  if (!stringValue(student.branchId)) missing.push('branchId')
  if (!Number.isFinite(Number(student.sessionsPerWeek))) missing.push('sessionsPerWeek')
  if (!Array.isArray(student.eligibleContractIds) || student.eligibleContractIds.length === 0) missing.push('contract')
  if (!['submitted', 'locked', 'inherited', 'recurring'].includes(String(student.availabilityStatus || ''))) missing.push('availability')
  return missing
}

function compactStudent(student = {}, branchId = '', contract = null) {
  const missingFields = normalizedMissingFields(student)
  return {
    id: stringValue(student.id, 200),
    name: stringValue(student.name, 160) || 'Chưa cập nhật tên',
    phone: stringValue(student.phone, 60),
    email: stringValue(student.email, 180),
    status: stringValue(student.status, 40) || 'active',
    branchId: stringValue(student.branchId, 120) || branchId,
    homeBranchId: stringValue(student.studentHomeBranchId || student.branchId, 120),
    crossBranch: student.isCrossBranchDisplayOnly === true || (student.branchId && student.branchId !== branchId),
    sessionsPerWeek: Number.isFinite(Number(student.sessionsPerWeek)) ? Number(student.sessionsPerWeek) : 0,
    defaultSessionsPerWeek: Number.isFinite(Number(student.defaultSessionsPerWeek)) ? Number(student.defaultSessionsPerWeek) : 0,
    scheduledSessions: Number(student.activeScheduledThisWeek || 0),
    remainingSessions: Number(student.remainingSchedulableSessions || 0),
    availabilityStatus: stringValue(student.availabilityStatus, 40) || 'missing',
    availabilityRevision: Number(student.availabilityRevision || 0),
    contractStatus: stringValue(student.contractStatus, 40) || 'missing',
    eligibleContractIds: Array.isArray(student.eligibleContractIds) ? student.eligibleContractIds.slice(0, 20) : [],
    contract: contract ? {
      id: stringValue(contract.id, 200),
      packageName: stringValue(contract.packageName || contract.package || contract.name, 160),
      status: stringValue(contract.status, 40),
      endDate: stringValue(contract.endDate, 20),
      remainingQuota: Number(contract.remainingSessions ?? Math.max(0, Number(contract.totalSessions || 0) - Number(contract.usedSessions || 0))),
    } : null,
    missingFields,
    profileComplete: missingFields.length === 0,
  }
}

function compactTrainer(trainer = {}, branchId = '') {
  return {
    id: stringValue(trainer.id, 200),
    name: stringValue(trainer.name, 160) || 'PT chưa cập nhật tên',
    phone: stringValue(trainer.phone, 60),
    email: stringValue(trainer.email, 180),
    status: stringValue(trainer.status, 40) || 'active',
    branchId: stringValue(trainer.branchId, 120) || branchId,
    availabilityMode: stringValue(trainer.availabilityMode, 40) || 'unconfigured',
    availabilityRevision: Number(trainer.availabilityRevision || 0),
    slotCapacity: Number(trainer.slotCapacity || 2),
    schedulingPriority: Number(trainer.schedulingPriority || 100),
  }
}

function compactSchedule(schedule = {}) {
  const result = {}
  let count = 0
  for (const [slotId, entries] of Object.entries(safeSchedule(schedule))) {
    const compactEntries = []
    for (const entry of Array.isArray(entries) ? entries : []) {
      if (count >= MAX_VIEW_SCHEDULE_ENTRIES) break
      if (!entry || typeof entry !== 'object') continue
      compactEntries.push({
        studentId: stringValue(entry.studentId, 200),
        trainerId: stringValue(entry.trainerId, 200),
        branchId: stringValue(entry.branchId, 120),
        type: stringValue(entry.type, 30) || 'training',
        contractId: stringValue(entry.contractId, 200),
        source: stringValue(entry.source, 40),
        isLocked: entry.isLocked === true,
        ...(Array.isArray(entry.adminOverrideWarnings) && entry.adminOverrideWarnings.length
          ? { warningCodes: entry.adminOverrideWarnings.slice(0, 16) }
          : {}),
      })
      count += 1
    }
    if (compactEntries.length) result[slotId] = compactEntries
    if (count >= MAX_VIEW_SCHEDULE_ENTRIES) break
  }
  return result
}

function scheduleCounts(schedule = {}) {
  const counts = new Map()
  for (const entries of Object.values(safeSchedule(schedule))) {
    for (const entry of Array.isArray(entries) ? entries : []) {
      if (!entry || entry.type === 'off' || !entry.studentId) continue
      const row = counts.get(entry.studentId) || { scheduled: 0, slots: [] }
      row.scheduled += 1
      if (row.slots.length < 32) row.slots.push(entry)
      counts.set(entry.studentId, row)
    }
  }
  return counts
}

function compactCoverage({ students = [], schedule = {}, weeklySessionCoverage = {}, exact = false } = {}) {
  const counts = scheduleCounts(schedule)
  const rows = {}
  let totalTargetSessions = 0
  let scheduledEntries = 0
  let missingSessions = 0
  for (const student of students.slice(0, MAX_VIEW_STUDENTS)) {
    const target = Math.max(0, Math.min(7, Number(student.sessionsPerWeek || 0)))
    const own = counts.get(student.id)?.scheduled || 0
    const external = Number(weeklySessionCoverage?.[student.id]?.otherBranches || 0)
    const scheduled = own + external
    const missing = Math.max(0, target - scheduled)
    totalTargetSessions += target
    scheduledEntries += own
    missingSessions += missing
    rows[student.id] = {
      studentId: student.id,
      targetSessions: target,
      scheduledSessions: scheduled,
      draftSessions: own,
      otherBranchSessions: external,
      missingSessions: missing,
      status: exact ? 'verified' : 'estimated',
    }
  }
  return {
    status: exact ? 'verified' : 'estimated',
    verification: exact ? 'exact' : 'draft_only',
    verified: exact,
    totalTargetSessions,
    scheduledEntries,
    missingSessions,
    studentsWithAtLeastOne: Object.values(rows).filter((row) => row.scheduledSessions > 0).length,
    fullyScheduledStudents: Object.values(rows).filter((row) => row.missingSessions === 0 && row.targetSessions > 0).length,
    byStudent: rows,
  }
}

function warningCode(warning = {}) {
  return stringValue(warning.code || warning.reasonCode || warning.primaryReason, 80) || 'SCHEDULE_WARNING'
}

function enrichedWarnings({ data, branchId, coverage, exact = false }) {
  const students = new Map([...(data.students || []), ...(data.crossBranchStudents || [])].map((student) => [student.id, student]))
  const trainers = new Map((data.trainers || []).map((trainer) => [trainer.id, trainer]))
  const contracts = new Map()
  for (const contract of data.contracts || []) {
    const existing = contracts.get(contract.studentId)
    if (!existing || String(existing.endDate || '').localeCompare(String(contract.endDate || '')) < 0) contracts.set(contract.studentId, contract)
  }
  const sourceWarnings = [
    ...(Array.isArray(data.draft?.warnings) ? data.draft.warnings : []),
    ...scheduleConflictWarningsForWorkspace({ weekId: data.weekId, sessions: data.sessions || [] }),
  ]
  // Initial display mode intentionally omits contracts/evidence. Do not turn
  // those deferred fields into false operational warnings; exact rebuilds are
  // the point at which the profile and coverage warning set is authoritative.
  if (exact) {
    for (const student of students.values()) {
      const missingFields = normalizedMissingFields(student)
      if (missingFields.length) sourceWarnings.push({
        code: 'PROFILE_DATA_INCOMPLETE',
        studentId: student.id,
        missingFields,
      })
      const row = coverage.byStudent?.[student.id]
      if (row?.missingSessions > 0) sourceWarnings.push({
        code: 'STUDENT_MISSING_SESSIONS',
        studentId: student.id,
        missingSessions: row.missingSessions,
      })
    }
  }
  const result = []
  const seen = new Set()
  for (const warning of sourceWarnings) {
    if (!warning || typeof warning !== 'object') continue
    const student = warning.studentId ? students.get(warning.studentId) : null
    const trainer = warning.trainerId ? trainers.get(warning.trainerId) : null
    const contract = warning.contractId ? (data.contracts || []).find((item) => item.id === warning.contractId) : contracts.get(warning.studentId)
    const code = warningCode(warning)
    const key = `${code}|${warning.studentId || ''}|${warning.trainerId || ''}|${warning.slotId || ''}`
    if (seen.has(key)) continue
    seen.add(key)
    result.push({
      code,
      primaryReason: stringValue(warning.primaryReason || warning.message, 240),
      studentId: stringValue(warning.studentId, 200),
      studentName: stringValue(student?.name, 160) || (warning.studentId ? 'Chưa cập nhật tên' : ''),
      studentPhone: stringValue(student?.phone, 60),
      studentBranchId: stringValue(student?.branchId || student?.studentHomeBranchId, 120),
      crossBranch: Boolean(student?.branchId && student.branchId !== branchId),
      contractId: stringValue(warning.contractId || contract?.id, 200),
      packageName: stringValue(contract?.packageName || contract?.package || contract?.name, 160),
      contractStatus: stringValue(contract?.status || student?.contractStatus, 40),
      contractEndDate: stringValue(contract?.endDate, 20),
      remainingQuota: Number(contract?.remainingSessions ?? Math.max(0, Number(contract?.totalSessions || 0) - Number(contract?.usedSessions || 0))),
      trainerId: stringValue(warning.trainerId, 200),
      trainerName: stringValue(trainer?.name, 160),
      slotId: stringValue(warning.slotId, 30),
      date: stringValue(warning.date, 20),
      missingSessions: Number(warning.missingSessions || 0),
      missingFields: Array.isArray(warning.missingFields) ? warning.missingFields.slice(0, 16) : [],
      actionCode: stringValue(warning.actionCode, 80),
      source: 'weekly_view',
    })
    if (result.length >= MAX_VIEW_WARNINGS) break
  }
  return result
}

function canonicalSourcePayload({ branchId, weekId, data, schedule, coverage } = {}) {
  const stableSchedule = Object.fromEntries(Object.entries(schedule || {})
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([slotId, entries]) => [slotId, [...(entries || [])].sort((left, right) => `${left.studentId}|${left.trainerId}`.localeCompare(`${right.studentId}|${right.trainerId}`))]))
  const stableCoverage = Object.fromEntries(Object.entries(coverage?.byStudent || {}).sort(([left], [right]) => left.localeCompare(right)))
  return {
    branchId,
    weekId,
    draftRevision: Number(data.draft?.revision || 0),
    draftStatus: stringValue(data.draft?.status, 40),
    publishedVersion: Number(data.draft?.publishedVersion || 0),
    publishedRevision: Number(data.draft?.publishedRevision || -1),
    schedule: stableSchedule,
    coverage: { ...coverage, byStudent: stableCoverage },
    studentRevisions: (data.students || []).map((student) => [student.id, Number(student.availabilityRevision || 0), student.contractStatus || '']).sort(),
    trainerRevisions: (data.trainers || []).map((trainer) => [trainer.id, Number(trainer.availabilityRevision || 0)]).sort(),
  }
}

function sourceRevisionFor(payload) {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex').slice(0, 24)
}

function buildPtScheduleWeeklyView({ branchId, weekId, data, previousView = null, now = new Date() } = {}) {
  if (!branchId || !weekId || !data) throw new Error('weekly view requires branchId, weekId and workspace data')
  const schedule = compactSchedule(data.schedule)
  const allStudents = [...(data.students || []), ...(data.crossBranchStudents || [])]
  const latestContractByStudent = new Map()
  for (const contract of data.contracts || []) {
    const existing = latestContractByStudent.get(contract.studentId)
    if (!existing || String(existing.endDate || '').localeCompare(String(contract.endDate || '')) < 0) latestContractByStudent.set(contract.studentId, contract)
  }
  const students = allStudents.slice(0, MAX_VIEW_STUDENTS).map((student) => compactStudent(student, branchId, latestContractByStudent.get(student.id)))
  const trainers = (data.trainers || []).slice(0, MAX_VIEW_TRAINERS).map((trainer) => compactTrainer(trainer, branchId))
  const exact = data.partial !== true && data.readMode !== 'display'
  const coverage = compactCoverage({ students, schedule, weeklySessionCoverage: data.weeklySessionCoverage, exact })
  const sourceRevision = sourceRevisionFor(canonicalSourcePayload({ branchId, weekId, data, schedule, coverage }))
  const previousRevision = Number(previousView?.viewRevision || 0)
  const changed = previousView?.sourceRevision !== sourceRevision
  const viewRevision = changed ? previousRevision + 1 : previousRevision || 1
  const warnings = enrichedWarnings({ data: { ...data, weekId }, branchId, coverage, exact })
  const generatedAt = now instanceof Date ? now.toISOString() : new Date().toISOString()
  return {
    schemaVersion: WEEKLY_VIEW_SCHEMA_VERSION,
    branchId,
    weekId,
    viewRevision,
    sourceRevision,
    freshness: exact ? 'verified' : 'display',
    verification: exact ? 'exact' : 'draft_only',
    dirty: false,
    generatedAt,
    draft: {
      revision: Number(data.draft?.revision || 0),
      status: stringValue(data.draft?.status, 40) || 'draft',
      publishedVersion: Number(data.draft?.publishedVersion || 0),
      publishedRevision: Number(data.draft?.publishedRevision || -1),
      updatedAt: isoValue(data.draft?.updatedAt),
      updatedBy: stringValue(data.draft?.updatedBy, 200),
    },
    schedule,
    students,
    trainers,
    coverage,
    warnings,
    summary: {
      students: students.length,
      trainers: trainers.length,
      scheduledEntries: coverage.scheduledEntries,
      totalTargetSessions: coverage.totalTargetSessions,
      missingSessions: coverage.missingSessions,
      warningCount: warnings.length,
      incompleteProfiles: students.filter((student) => !student.profileComplete).length,
    },
  }
}

function serializableWeeklyView(value = {}) {
  return {
    ...value,
    generatedAt: isoValue(value.generatedAt),
    draft: value.draft ? { ...value.draft, updatedAt: isoValue(value.draft.updatedAt) } : value.draft,
  }
}

async function rebuildPtScheduleWeeklyView({ db, branchId, weekId, branchData = loadBranchData, forceRefresh = true, now = new Date() } = {}) {
  const data = await branchData(db, branchId, weekId, { forceRefresh })
  data.weekId = weekId
  const reference = weeklyViewReference(db, branchId, weekId)
  const current = await reference.get()
  const previousView = current.exists ? current.data() : null
  const view = buildPtScheduleWeeklyView({ branchId, weekId, data, previousView, now })
  if (current.exists && current.data()?.sourceRevision === view.sourceRevision && current.data()?.dirty !== true) {
    return { ...serializableWeeklyView(current.data()), unchanged: true }
  }
  const write = {
    ...view,
    generatedAt: FieldValue.serverTimestamp(),
    dirty: false,
    updatedAt: FieldValue.serverTimestamp(),
  }
  if (current.exists) await reference.set(write, { merge: false })
  else await reference.create(write)
  return { ...view, unchanged: false }
}

async function markPtScheduleWeeklyViewDirty({ db, branchId, weekId, reason = 'source_changed', sourceRevision = '' } = {}) {
  const reference = weeklyViewReference(db, branchId, weekId)
  await reference.set({
    schemaVersion: WEEKLY_VIEW_SCHEMA_VERSION,
    branchId,
    weekId,
    freshness: 'stale',
    dirty: true,
    dirtyReason: stringValue(reason, 100) || 'source_changed',
    ...(sourceRevision ? { sourceRevision: stringValue(sourceRevision, 80) } : {}),
    dirtyAt: FieldValue.serverTimestamp(),
  }, { merge: true })
  return { branchId, weekId, dirty: true, freshness: 'stale' }
}

function createPtScheduleWeeklyViewFunctions({
  db,
  onCall,
  workspaceOnCall = onCall,
  actorForBranch,
  branchData = loadBranchData,
} = {}) {
  if (!db || !onCall || typeof actorForBranch !== 'function') throw new Error('weekly view functions require db, onCall and actorForBranch')
  const getPtScheduleWeeklyView = workspaceOnCall(async (request) => {
    const branchId = String(request.data?.branchId || '').trim()
    const weekId = String(request.data?.weekId || '').trim()
    if (!/^[A-Za-z0-9_-]+$/.test(branchId) || !/^\d{4}-\d{2}-\d{2}$/.test(weekId)) throw new HttpsError('invalid-argument', 'Chi nhánh hoặc tuần lịch không hợp lệ.')
    await actorForBranch(request, db, branchId)
    const snapshot = await weeklyViewReference(db, branchId, weekId).get()
    if (!snapshot.exists) return { schemaVersion: WEEKLY_VIEW_SCHEMA_VERSION, branchId, weekId, freshness: 'missing', dirty: true, viewRevision: 0, sourceRevision: '' }
    return serializableWeeklyView(snapshot.data())
  })

  const rebuildPtScheduleWeeklyViewCallable = workspaceOnCall(async (request) => {
    const branchId = String(request.data?.branchId || '').trim()
    const weekId = String(request.data?.weekId || '').trim()
    if (!/^[A-Za-z0-9_-]+$/.test(branchId) || !/^\d{4}-\d{2}-\d{2}$/.test(weekId)) throw new HttpsError('invalid-argument', 'Chi nhánh hoặc tuần lịch không hợp lệ.')
    await actorForBranch(request, db, branchId)
    return rebuildPtScheduleWeeklyView({ db, branchId, weekId, branchData, forceRefresh: true })
  })

  const markPtScheduleWeeklyViewDirtyCallable = workspaceOnCall(async (request) => {
    const branchId = String(request.data?.branchId || '').trim()
    const weekId = String(request.data?.weekId || '').trim()
    if (!/^[A-Za-z0-9_-]+$/.test(branchId) || !/^\d{4}-\d{2}-\d{2}$/.test(weekId)) throw new HttpsError('invalid-argument', 'Chi nhánh hoặc tuần lịch không hợp lệ.')
    await actorForBranch(request, db, branchId)
    return markPtScheduleWeeklyViewDirty({ db, branchId, weekId, reason: request.data?.reason })
  })
  return { getPtScheduleWeeklyView, rebuildPtScheduleWeeklyView: rebuildPtScheduleWeeklyViewCallable, markPtScheduleWeeklyViewDirty: markPtScheduleWeeklyViewDirtyCallable }
}

module.exports = {
  WEEKLY_VIEW_SCHEMA_VERSION,
  weeklyViewId,
  weeklyViewReference,
  compactSchedule,
  compactCoverage,
  buildPtScheduleWeeklyView,
  rebuildPtScheduleWeeklyView,
  markPtScheduleWeeklyViewDirty,
  createPtScheduleWeeklyViewFunctions,
}
