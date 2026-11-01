'use strict'

const { observeEventRead, observeEventWrite, recordEventMetrics } = require('./event-operation-metrics')

const { createHash, randomUUID } = require('node:crypto')
const { isDeepStrictEqual } = require('node:util')
const { FieldPath, FieldValue } = require('firebase-admin/firestore')
const { HttpsError } = require('firebase-functions/v2/https')
const { projectionSourceChanged } = require('./projection-event-policy')
const {
  loadBranchData,
  safeSchedule,
  scheduleConflictWarningsForWorkspace,
} = require('./pt-schedule-v2')

// A weekly view is deliberately a projection, not a second source of truth.
// It contains enough information to paint the schedule and warning center but
// never contains raw attendance, billing, or contract history rows.
const WEEKLY_VIEW_SCHEMA_VERSION = 4
const MAX_VIEW_SCHEDULE_ENTRIES = 700
const MAX_VIEW_STUDENTS = 600
const MAX_VIEW_TRAINERS = 120
const MAX_VIEW_WARNINGS = 160
const VIEW_PAGE_SIZE = 100
const REBUILD_LEASE_MS = 180_000

function weeklyViewId(branchId, weekId) {
  return `${String(branchId || '').trim()}_${String(weekId || '').trim()}`
}

function weeklyViewReference(db, branchId, weekId) {
  return db.doc(`ptScheduleWeeklyViews/${weeklyViewId(branchId, weekId)}`)
}

function weeklyViewStateReference(db, branchId, weekId) {
  return db.doc(`ptScheduleWeeklyViewStates/${weeklyViewId(branchId, weekId)}`)
}

// The payload's generation includes all events consumed when it was published.
// A separate counter can start at zero without reading/backfilling a legacy
// payload. Only its unconsumed delta is added, so generations remain monotonic
// while old deployed writers still increment the payload directly.
function mergeWeeklyViewState(payload, state) {
  if (!payload) return null
  const generation = Number(state?.dirtyGeneration || 0)
  const baseline = Number(payload.controlGeneration || 0)
  const missingState = payload.controlSchemaVersion === 1 && !state
  const revisionMismatch = Boolean(state?.sourceRevision && state.sourceRevision !== payload.sourceRevision)
  const pending = missingState || generation < baseline || revisionMismatch
  const dirty = payload.dirty === true || state?.dirty === true || generation > baseline || pending
  return {
    ...payload,
    dirtyGeneration: Number(payload.dirtyGeneration || 0) + Math.max(0, generation - baseline),
    dirty,
    validationDirty: payload.validationDirty === true || state?.validationDirty === true || dirty,
    ...(dirty ? { freshness: 'stale' } : {}),
  }
}

function weekIdFromDate(value) {
  const raw = String(value || '').slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return ''
  const date = new Date(`${raw}T00:00:00Z`)
  if (Number.isNaN(date.getTime())) return ''
  const day = date.getUTCDay() || 7
  date.setUTCDate(date.getUTCDate() - day + 1)
  return date.toISOString().slice(0, 10)
}

function branchWeekFromDocumentId(value) {
  const match = String(value || '').match(/^(.+)_(\d{4}-\d{2}-\d{2})$/)
  return match ? { branchId: match[1], weekId: match[2] } : null
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
    weeklySessionTargetOverride: student.weeklySessionTargetOverride === null || student.weeklySessionTargetOverride === undefined
      ? null
      : Number(student.weeklySessionTargetOverride),
    weeklySessionTargetOverridden: student.weeklySessionTargetOverridden === true,
    scheduledSessions: Number(student.activeScheduledThisWeek || 0),
    activeScheduledSessions: Number(student.activeScheduledSessions || 0),
    activeScheduledThisWeek: Number(student.activeScheduledThisWeek || 0),
    remainingSessions: Number(student.remainingSchedulableSessions || 0),
    remainingEntitlementSessions: Number(student.remainingEntitlementSessions || 0),
    remainingSchedulableSessions: Number(student.remainingSchedulableSessions || 0),
    maxWeeklySessions: Number(student.maxWeeklySessions || 0),
    schedulableSessionsThisWeek: Number(student.schedulableSessionsThisWeek || 0),
    availabilityStatus: stringValue(student.availabilityStatus, 40) || 'missing',
    availabilitySource: stringValue(student.availabilitySource, 40) || 'none',
    availabilitySourceWeekId: stringValue(student.availabilitySourceWeekId, 20) || null,
    availabilityLocked: student.availabilityLocked === true,
    availabilityCutoffAt: isoValue(student.availabilityCutoffAt),
    availabilityReopenedUntil: isoValue(student.availabilityReopenedUntil),
    availabilityRevision: Number(student.availabilityRevision || 0),
    // Keep the read model bounded even for a large branch. The manual search
    // path still reads the authoritative availability document on demand.
    availableSlots: Array.isArray(student.availableSlots) ? student.availableSlots.slice(0, 48) : [],
    contractStatus: stringValue(student.contractStatus, 40) || 'missing',
    contractEndDate: stringValue(student.contractEndDate || contract?.endDate, 20),
    eligibleContractIds: Array.isArray(student.eligibleContractIds) ? student.eligibleContractIds.slice(0, 20) : [],
    eligibleForWeek: student.eligibleForWeek === true,
    eligibilityReasons: Array.isArray(student.eligibilityReasons) ? student.eligibilityReasons.slice(0, 24) : [],
    validScheduleDates: Array.isArray(student.validScheduleDates) ? student.validScheduleDates.slice(0, 14) : [],
    pausedScheduleDates: Array.isArray(student.pausedScheduleDates) ? student.pausedScheduleDates.slice(0, 14) : [],
    ...(Array.isArray(student.approvedOffScheduleDates) ? { approvedOffScheduleDates: student.approvedOffScheduleDates.slice(0, 7) } : {}),
    isScheduleConfirmed: student.isScheduleConfirmed === true,
    previousWeekScheduledSessions: Number(student.previousWeekScheduledSessions || 0),
    hadSchedulePreviousWeek: student.hadSchedulePreviousWeek === true,
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
    availableSlots: Array.isArray(trainer.availableSlots) ? trainer.availableSlots.slice(0, 100) : [],
    availabilitySource: ['weekly', 'inherited_weekly'].includes(trainer.availabilitySource) ? trainer.availabilitySource : 'recurring',
    availabilitySourceWeekId: stringValue(trainer.availabilitySourceWeekId, 10),
    availabilityWeekId: stringValue(trainer.availabilityWeekId, 10),
    offDates: Array.isArray(trainer.offDates) ? trainer.offDates.slice(0, 7) : [],
    slotCapacity: Number(trainer.slotCapacity || 2),
    schedulingPriority: Number(trainer.schedulingPriority || 100),
    dailySessionTarget: Number(trainer.dailySessionTarget || 0),
    employmentType: stringValue(trainer.employmentType, 30),
    employmentLevel: stringValue(trainer.employmentLevel, 30),
  }
}

function compactContract(contract = {}) {
  return {
    id: stringValue(contract.id, 200),
    studentId: stringValue(contract.studentId, 200),
    trainerId: stringValue(contract.trainerId, 200),
    trainerIds: Array.isArray(contract.trainerIds) ? contract.trainerIds.slice(0, 10) : [],
    branchId: stringValue(contract.branchId, 120),
    packageId: stringValue(contract.packageId, 200),
    packageName: stringValue(contract.packageName || contract.packageId, 160),
    status: stringValue(contract.status, 40),
    startDate: stringValue(contract.startDate, 20),
    endDate: stringValue(contract.endDate, 20),
    totalSessions: Number(contract.totalSessions || 0),
    usedSessions: Number(contract.usedSessions || 0),
    remainingEntitlementSessions: Number(contract.remainingEntitlementSessions || 0),
    activeScheduledSessions: Number(contract.activeScheduledSessions || 0),
    activeScheduledThisWeek: Number(contract.activeScheduledThisWeek || 0),
    remainingSchedulableSessions: Number(contract.remainingSchedulableSessions || 0),
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
        ...(entry.studentOffConfirmedDate ? { studentOffConfirmedDate: entry.studentOffConfirmedDate } : {}),
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

function compactCoverage({ students = [], schedule = {}, weeklySessionCoverage = {}, exact = false, weekId = '' } = {}) {
  const { entryOnApprovedOff } = require('./schedule-entitlement-policy')
  const data = { students, weekId }
  const counts = scheduleCounts(Object.fromEntries(Object.entries(schedule).map(([slot, entries]) => [slot, entries.filter(entry => !entryOnApprovedOff(data, slot, entry))])))
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

function compactWeeklySessionCoverage(value = {}) {
  return Object.fromEntries(Object.entries(value || {}).slice(0, MAX_VIEW_STUDENTS).map(([studentId, row]) => [studentId, {
    total: Number(row?.total || 0),
    currentBranch: Number(row?.currentBranch || 0),
    otherBranches: Number(row?.otherBranches || 0),
    byBranch: row?.byBranch && typeof row.byBranch === 'object' ? Object.fromEntries(Object.entries(row.byBranch).slice(0, 12).map(([key, count]) => [key, Number(count || 0)])) : {},
    dates: Array.isArray(row?.dates) ? row.dates.slice(0, 14) : [],
    entries: Array.isArray(row?.entries) ? row.entries.slice(0, 32).map((entry) => ({
      id: stringValue(entry?.id, 200),
      branchId: stringValue(entry?.branchId, 120),
      date: stringValue(entry?.date, 20),
      hour: Number.isFinite(Number(entry?.hour)) ? Number(entry.hour) : null,
      trainerId: stringValue(entry?.trainerId, 200),
      trainerName: stringValue(entry?.trainerName, 160),
      branchName: stringValue(entry?.branchName, 160),
      ...(entry?.studentOffConfirmed === true ? { studentOffConfirmed: true } : {}),
    })) : [],
  }]))
}

const OPTIMIZATION_NUMBER_FIELDS = [
  'pairingMoves', 'refillAssignments', 'repairAssignments', 'repairRelocations',
  'repairSearchNodes', 'rescueAssignments', 'rescueRelocations', 'rescueSearchNodes',
  'rescueEvaluatedPlans', 'optimalityGap', 'optimizationPasses', 'totalTargetSessions',
  'scheduledEntries', 'missingSessions', 'searchBudgetUsed', 'completionFirstCohortSize',
  'completionFirstReservedSessions', 'completionFirstSeatBudget',
]

function compactOptimizationSummary(value = {}) {
  const result = {
    generationMode: stringValue(value.generationMode, 40),
    loadPolicyVersion: stringValue(value.loadPolicyVersion, 80),
    generatorVersion: stringValue(value.generatorVersion, 80),
    qualityVersion: stringValue(value.qualityVersion, 80),
    objectiveOrder: Array.isArray(value.objectiveOrder) ? value.objectiveOrder.slice(0, 16).map((item) => stringValue(item, 80)) : [],
    studentCoverage: value.studentCoverage && typeof value.studentCoverage === 'object' ? { ...value.studentCoverage } : {},
    studentFeasibility: Array.isArray(value.studentFeasibility) ? value.studentFeasibility.slice(0, MAX_VIEW_STUDENTS).map((item) => ({
      studentId: stringValue(item?.studentId, 200),
      studentName: stringValue(item?.studentName, 160),
      requestedSessions: Number(item?.requestedSessions || 0),
      maximumFeasibleSessions: Number(item?.maximumFeasibleSessions || 0),
      scheduledSessions: Number(item?.scheduledSessions || 0),
      missingSessions: Number(item?.missingSessions || 0),
      impossibleSessions: Number(item?.impossibleSessions || 0),
    })) : [],
    trainerLoads: Array.isArray(value.trainerLoads) ? value.trainerLoads.slice(0, MAX_VIEW_TRAINERS).map((item) => ({
      trainerId: stringValue(item?.trainerId, 200),
      trainerName: stringValue(item?.trainerName || item?.name, 160),
      teachingSlots: Number(item?.teachingSlots || item?.sessionCount || 0),
      target: Number(item?.target || item?.dailySessionTarget || 0),
      status: stringValue(item?.status, 40),
    })) : [],
    slotUtilization: value.slotUtilization && typeof value.slotUtilization === 'object' ? { ...value.slotUtilization } : {},
    swapTrace: Array.isArray(value.swapTrace) ? value.swapTrace.slice(0, 64).map((item) => ({
      studentId: stringValue(item?.studentId, 200),
      studentName: stringValue(item?.studentName, 160),
      fromSlotId: stringValue(item?.fromSlotId, 40) || null,
      fromTrainerId: stringValue(item?.fromTrainerId, 200) || null,
      toSlotId: stringValue(item?.toSlotId, 40),
      toTrainerId: stringValue(item?.toTrainerId, 200),
    })) : [],
  }
  for (const field of OPTIMIZATION_NUMBER_FIELDS) {
    if (value[field] !== undefined) result[field] = Number(value[field] || 0)
  }
  if (value.comparison && typeof value.comparison === 'object') result.comparison = value.comparison
  for (const field of ['capacityReached', 'capacityExhausted', 'completionFirst', 'rescueSearchLimitReached', 'repairSearchLimitReached']) {
    if (value[field] !== undefined) result[field] = value[field] === true
  }
  return result
}

function compactUnassignedEntry(value = {}) {
  const diagnostics = value.diagnostics && typeof value.diagnostics === 'object' ? value.diagnostics : {}
  return {
    studentId: stringValue(value.studentId, 200),
    studentName: stringValue(value.studentName, 160),
    missingSessions: Number(value.missingSessions || 0),
    blockerType: stringValue(value.blockerType, 40),
    primaryReasonCode: stringValue(value.primaryReasonCode, 80),
    blockerCategory: stringValue(value.blockerCategory, 60),
    actionCode: stringValue(value.actionCode, 80),
    reasonCodes: Array.isArray(value.reasonCodes) ? value.reasonCodes.slice(0, 16).map((item) => stringValue(item, 80)) : [],
    reasons: Array.isArray(value.reasons) ? value.reasons.slice(0, 16).map((item) => stringValue(item, 180)) : [],
    suggestedSlots: Array.isArray(value.suggestedSlots) ? value.suggestedSlots.slice(0, 12).map((item) => stringValue(item, 40)) : [],
    diagnostics: {
      ...Object.fromEntries(Object.entries(diagnostics).filter(([key, item]) => typeof item === 'number').map(([key, item]) => [key, Number(item || 0)])),
      contractStatus: stringValue(diagnostics.contractStatus, 40),
      nearestContractEndDate: stringValue(diagnostics.nearestContractEndDate, 20) || null,
      latestContractEndDate: stringValue(diagnostics.latestContractEndDate, 20) || null,
      validDates: Array.isArray(diagnostics.validDates) ? diagnostics.validDates.slice(0, 14).map((item) => stringValue(item, 20)) : [],
      weekStart: stringValue(diagnostics.weekStart, 20),
      weekEnd: stringValue(diagnostics.weekEnd, 20),
    },
    candidateSlots: Array.isArray(value.candidateSlots) ? value.candidateSlots.slice(0, 12).map((slot) => ({
      slotId: stringValue(slot?.slotId, 40),
      date: stringValue(slot?.date, 20),
      hour: Number(slot?.hour || 0),
      learnerAvailable: slot?.learnerAvailable === true,
      availableTrainerIds: Array.isArray(slot?.availableTrainerIds) ? slot.availableTrainerIds.slice(0, 16).map((item) => stringValue(item, 200)) : [],
      blockedTrainerIds: Array.isArray(slot?.blockedTrainerIds) ? slot.blockedTrainerIds.slice(0, 16).map((item) => stringValue(item, 200)) : [],
      blockerCodes: Array.isArray(slot?.blockerCodes) ? slot.blockerCodes.slice(0, 16).map((item) => stringValue(item, 80)) : [],
    })) : [],
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

function canonicalSourcePayload(value) {
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map(canonicalSourcePayload)
  if (typeof value.toDate === 'function') return value.toDate().toISOString()
  if (value instanceof Date) return value.toISOString()
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalSourcePayload(value[key])]))
}

function sourceRevisionFor(payload) {
  return createHash('sha256').update(JSON.stringify(canonicalSourcePayload(payload))).digest('hex').slice(0, 24)
}

const DEFERRED_STUDENT_FIELDS = [
  'scheduledSessions', 'activeScheduledSessions', 'activeScheduledThisWeek',
  'remainingSessions', 'remainingEntitlementSessions', 'remainingSchedulableSessions',
  'maxWeeklySessions', 'schedulableSessionsThisWeek', 'contractStatus',
  'eligibleContractIds', 'eligibleForWeek', 'eligibilityReasons', 'validScheduleDates',
  'pausedScheduleDates', 'approvedOffScheduleDates', 'previousWeekScheduledSessions', 'hadSchedulePreviousWeek', 'contract',
]

function retainedValidationSnapshot(value) {
  const snapshot = value?.validationSnapshot
  if (snapshot?.schemaVersion === 1 && snapshot.branchId === value.branchId && snapshot.weekId === value.weekId) {
    if (snapshot.storage === 'top_level' && value.verification === 'exact' && value.coverage?.verified === true && Array.isArray(value.warnings)) {
      return { ...snapshot, ...validationEvidence(value), storage: 'embedded' }
    }
    if (snapshot.storage === 'embedded' && snapshot.coverage?.verified === true && Array.isArray(snapshot.warnings)) return snapshot
  }
  // Legacy exact views already contain evidence. Wrap it without re-reading
  // sources; a display-only legacy view must never be promoted to exact here.
  if (value?.verification !== 'exact' || value.coverage?.verified !== true || !Array.isArray(value.warnings)) return null
  return { ...createValidationSnapshot(value, value.generatedAt), ...validationEvidence(value), storage: 'embedded' }
}

function validationEvidence(value) {
  return {
    coverage: value.coverage,
    summary: value.summary,
    warnings: value.warnings,
    unassignedEntries: value.unassignedEntries || [],
    weeklySessionCoverage: value.weeklySessionCoverage || {},
    contracts: value.contracts || [],
    optimizationSummary: value.optimizationSummary || {},
  }
}

function createValidationSnapshot(value, validatedAt) {
  const metadata = {
    schemaVersion: 1,
    branchId: value.branchId,
    weekId: value.weekId,
    draftRevision: Number(value.draft?.revision || 0),
    dirtyGeneration: Number(value.dirtyGeneration || 0),
  }
  // Exact evidence is already authoritative at the top level. Store only a
  // pointer so large rosters do not duplicate contracts/coverage/warnings in a
  // Firestore document. A light builder resolves this pointer before replacing
  // those top-level fields, embedding the retained evidence exactly once.
  return {
    ...metadata,
    storage: 'top_level',
    sourceRevision: sourceRevisionFor({ ...metadata, ...validationEvidence(value) }),
    validatedAt: isoValue(validatedAt),
  }
}

function validationMetadata(value) {
  const validationSnapshot = retainedValidationSnapshot(value)
  const validationDirty = value?.validationDirty === true || value?.dirty === true || !validationSnapshot
  const stored = value?.validationSnapshot
  const storedMatches = stored?.schemaVersion === 1 && stored.branchId === value.branchId && stored.weekId === value.weekId
    && (stored.storage === 'embedded' ? validationSnapshot === stored
      : stored.storage === 'top_level' && value.verification === 'exact' && value.coverage?.verified === true && Array.isArray(value.warnings))
  return {
    validationSnapshot: validationSnapshot ? storedMatches ? stored : createValidationSnapshot(value, value.generatedAt) : null,
    validationDirty,
    validationState: !validationSnapshot ? 'unknown' : validationDirty ? 'stale' : 'current',
  }
}

function retainStudentEvidence(student, previous) {
  if (!previous) return student
  const retained = Object.fromEntries(DEFERRED_STUDENT_FIELDS.filter((key) => previous[key] !== undefined).map((key) => [key, previous[key]]))
  // Contact/availability completeness comes from the newly read profile, while
  // contract completeness belongs to the retained validation plane.
  const missingFields = [...student.missingFields.filter((key) => key !== 'contract')]
  if (previous.missingFields?.includes('contract')) missingFields.push('contract')
  return { ...student, ...retained, missingFields, profileComplete: missingFields.length === 0 }
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
  const exact = data.partial !== true && data.readMode !== 'display'
  const previousValidation = retainedValidationSnapshot(previousView)
  const previousStudents = new Map((previousValidation ? previousView?.students || [] : []).map((student) => [student.id, student]))
  const students = allStudents.slice(0, MAX_VIEW_STUDENTS).map((student) => {
    const compact = compactStudent(student, branchId, latestContractByStudent.get(student.id))
    return exact ? compact : retainStudentEvidence(compact, previousStudents.get(compact.id))
  })
  const trainers = (data.trainers || []).slice(0, MAX_VIEW_TRAINERS).map((trainer) => compactTrainer(trainer, branchId))
  const contractIdsForView = new Set([...latestContractByStudent.values()].map((contract) => contract.id).filter(Boolean))
  Object.values(schedule).flat().forEach((entry) => {
    if (entry?.contractId) contractIdsForView.add(entry.contractId)
  })
  const contracts = (exact ? data.contracts || [] : [])
    .filter((contract) => contractIdsForView.has(contract.id))
    .slice(0, MAX_VIEW_STUDENTS + MAX_VIEW_SCHEDULE_ENTRIES)
    .map(compactContract)
  const coverage = compactCoverage({ students, schedule, weeklySessionCoverage: data.weeklySessionCoverage, exact, weekId })
  const weeklySessionCoverage = compactWeeklySessionCoverage(data.weeklySessionCoverage)
  const warnings = enrichedWarnings({ data: { ...data, weekId }, branchId, coverage, exact })
  const generatedAt = now instanceof Date ? now.toISOString() : new Date().toISOString()
  const view = {
    schemaVersion: WEEKLY_VIEW_SCHEMA_VERSION,
    branchId,
    weekId,
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
    contracts,
    scheduleConfig: data.config || {},
    weeklySessionCoverage,
    coverage,
    warnings,
    summary: {
      students: students.length,
      eligibleStudents: students.filter((student) => student.eligibleForWeek === true).length,
      trainers: trainers.length,
      scheduledEntries: coverage.scheduledEntries,
      totalTargetSessions: coverage.totalTargetSessions,
      missingSessions: coverage.missingSessions,
      warningCount: warnings.length,
      unassignedEntries: exact && Array.isArray(data.draft?.unassignedEntries) ? data.draft.unassignedEntries.length : 0,
      incompleteProfiles: students.filter((student) => !student.profileComplete).length,
    },
    unassignedEntries: exact && Array.isArray(data.draft?.unassignedEntries)
      ? data.draft.unassignedEntries.slice(0, MAX_VIEW_STUDENTS).map(compactUnassignedEntry)
      : [],
    optimizationSummary: compactOptimizationSummary(data.draft?.optimizationSummary || {}),
  }
  const validationSnapshot = exact
    ? createValidationSnapshot({ ...view, dirtyGeneration: Number(previousView?.dirtyGeneration || 0) }, generatedAt)
    : previousValidation
  view.validationSnapshot = validationSnapshot
  view.validationDirty = !exact
  view.validationState = exact ? 'current' : validationSnapshot ? 'stale' : 'unknown'
  // Hash the actual rendered payload, not a short list of source revisions.
  // Name/phone/config/warning changes must reach clients even when the draft
  // and availability revision numbers stay the same. Ignore only bookkeeping.
  const { generatedAt: ignoredGeneratedAt, dirty: ignoredDirty, ...semantic } = view
  const { updatedAt: ignoredUpdatedAt, ...semanticDraft } = view.draft
  const { validatedAt: ignoredValidatedAt, ...semanticValidation } = validationSnapshot || {}
  const sourceRevision = sourceRevisionFor({ ...semantic, draft: semanticDraft, validationSnapshot: validationSnapshot ? semanticValidation : null })
  const previousRevision = Number(previousView?.viewRevision || 0)
  return {
    ...view,
    sourceRevision,
    viewRevision: previousView?.sourceRevision !== sourceRevision ? previousRevision + 1 : previousRevision || 1,
    sourceStudentIds: [...new Set(students.map((student) => student.id).filter(Boolean))].sort(),
    sourceTrainerIds: [...new Set(trainers.map((trainer) => trainer.id).filter(Boolean))].sort(),
    sourceContractIds: [...new Set([...contracts, ...(!exact ? previousValidation?.contracts || [] : [])].map((contract) => contract.id).filter(Boolean))].sort(),
  }
}

function serializableWeeklyView(value = {}) {
  return {
    ...value,
    ...validationMetadata(value),
    generatedAt: isoValue(value.generatedAt),
    draft: value.draft ? { ...value.draft, updatedAt: isoValue(value.draft.updatedAt) } : value.draft,
  }
}

function completeWeeklyView(value) {
  return Boolean(value?.schedule && Array.isArray(value.students) && Array.isArray(value.trainers))
}

function pendingWeeklyView(value, status) {
  if (!completeWeeklyView(value)) {
    throw new HttpsError('unavailable', 'Lịch tuần đang được cập nhật. Vui lòng thử lại sau ít giây.', { retryAfterMs: 2000, rebuildStatus: status })
  }
  return { ...serializableWeeklyView(value), rebuilding: true, rebuildStatus: status }
}

function snapshotVersion(snapshot) {
  // updateTime also catches old deployed triggers that only set dirtyAt and do
  // not yet increment dirtyGeneration during a gradual rollout.
  const stamp = snapshot?.updateTime
  if (stamp && Number.isFinite(stamp.seconds)) return `${stamp.seconds}:${stamp.nanoseconds || 0}`
  return null
}

async function rebuildPtScheduleWeeklyView({ db, branchId, weekId, branchData = loadBranchData, forceRefresh = true, initialPaint = false, now = new Date(), clock = Date.now } = {}) {
  const reference = weeklyViewReference(db, branchId, weekId)
  const stateReference = weeklyViewStateReference(db, branchId, weekId)
  const leaseReference = db.doc(`systemJobs/ptScheduleWeeklyViewRebuild/views/${weeklyViewId(branchId, weekId)}`)
  const token = randomUUID()
  const acquired = await db.runTransaction(async (transaction) => {
    const [snapshot, state, lease] = await transaction.getAll(reference, stateReference, leaseReference)
    const previousView = mergeWeeklyViewState(snapshot.exists ? snapshot.data() : null, state.exists ? state.data() : null)
    if (Number(lease.data()?.leaseUntilMillis || 0) > clock()) return { busy: true, previousView }
    transaction.set(leaseReference, { token, leaseUntilMillis: clock() + REBUILD_LEASE_MS })
    return { previousView, generation: Number(previousView?.dirtyGeneration ?? state.data()?.dirtyGeneration ?? 0), version: snapshotVersion(snapshot),
      stateVersion: snapshotVersion(state), controlGeneration: Number(state.data()?.dirtyGeneration || 0) }
  })
  if (acquired.busy) return pendingWeeklyView(acquired.previousView, 'busy')
  try {
    // Acquire before loading sources: only one reader fans out for this week.
    const data = await branchData(db, branchId, weekId, { forceRefresh, initialPaint })
    data.weekId = weekId
    const view = buildPtScheduleWeeklyView({ branchId, weekId, data,
      previousView: acquired.previousView || { dirtyGeneration: acquired.generation }, now })
    return await db.runTransaction(async (transaction) => {
      const [snapshot, state, lease] = await transaction.getAll(reference, stateReference, leaseReference)
      const current = mergeWeeklyViewState(snapshot.exists ? snapshot.data() : null, state.exists ? state.data() : null)
      // An expired builder must never overwrite the replacement's snapshot or
      // release its lease. A dirty write during source reads also invalidates
      // the build, even if the source hash happens to match an older snapshot.
      if (lease.data()?.token !== token || Number(lease.data()?.leaseUntilMillis || 0) <= clock()) {
        return pendingWeeklyView(current, 'superseded')
      }
      transaction.delete(leaseReference)
      // A source event may queue a week before any payload exists. Use the
      // same state-only generation as acquisition, not an artificial zero.
      if (Number(current?.dirtyGeneration ?? state.data()?.dirtyGeneration ?? 0) !== acquired.generation || snapshotVersion(snapshot) !== acquired.version
        || snapshotVersion(state) !== acquired.stateVersion) {
        return pendingWeeklyView(current, 'superseded')
      }
      if (current?.schemaVersion === WEEKLY_VIEW_SCHEMA_VERSION && current?.sourceRevision === view.sourceRevision
        && current?.dirty !== true && current?.validationDirty !== true) {
        return { ...serializableWeeklyView(current), unchanged: true }
      }
      const result = { ...view, dirtyGeneration: acquired.generation, controlSchemaVersion: 1, controlGeneration: acquired.controlGeneration }
      transaction.set(reference, {
        ...result,
        generatedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      })
      transaction.set(stateReference, {
        schemaVersion: 1, branchId, weekId, dirty: false, validationDirty: view.validationDirty,
        dirtyGeneration: acquired.controlGeneration, sourceRevision: view.sourceRevision,
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true })
      return { ...result, unchanged: false }
    })
  } catch (error) {
    // Preserve dirty state on failures; the viewer/worker can retry. Release
    // only our token, never a newer worker's lease after expiry.
    await db.runTransaction(async (transaction) => {
      const lease = await transaction.get(leaseReference)
      if (lease.data()?.token === token) transaction.delete(leaseReference)
    }).catch(() => {})
    throw error
  }
}

async function paginatedViews(query) {
  const rows = []
  let last = null
  do {
    const page = await (last ? query.startAfter(last) : query).limit(VIEW_PAGE_SIZE).get()
    rows.push(...page.docs.map((document) => ({ ...document.data(), _documentId: document.id })))
    if (page.docs.length < VIEW_PAGE_SIZE) break
    last = page.docs[page.docs.length - 1]
  } while (last)
  return rows
}

function viewQuery(db) {
  return db.collection('ptScheduleWeeklyViews').orderBy(FieldPath.documentId())
}

function targetFromView(value) {
  const target = { branchId: String(value.branchId || ''), weekId: String(value.weekId || '') }
  return /^[A-Za-z0-9_-]+$/.test(target.branchId) && /^\d{4}-\d{2}-\d{2}$/.test(target.weekId) ? target : null
}

async function sourceEventTargets({ db, event, source } = {}) {
  const documentId = event?.params?.documentId || event?.params?.draftId || event?.params?.targetId || event?.params?.availabilityId || event?.params?.sessionId || event?.params?.studentId || event?.params?.trainerId || event?.params?.contractId || event?.params?.requestId || ''
  const states = [event?.data?.before, event?.data?.after].filter((snapshot) => snapshot?.exists).map((snapshot) => snapshot.data() || {})
  if (source === 'scheduleConfig') {
    return documentId === 'scheduleConfig'
      ? (await paginatedViews(viewQuery(db).select('branchId', 'weekId'))).map(targetFromView).filter(Boolean)
      : []
  }
  const direct = ['draft', 'target'].includes(source) ? branchWeekFromDocumentId(documentId) : null
  const targets = new Map()
  const add = (target) => {
    const valid = target && targetFromView(target)
    if (valid) targets.set(weeklyViewId(valid.branchId, valid.weekId), valid)
  }
  if (direct) add(direct)
  if (source === 'target') return [...targets.values()]
  const branchCache = new Map()
  const branchFor = async (id, collection) => {
    if (!id) return ''
    const path = `${collection}/${id}`
    if (!branchCache.has(path)) branchCache.set(path, db.doc(path).get().then((snapshot) => String(snapshot.data()?.branchId || '').trim()))
    return branchCache.get(path)
  }
  const branchViews = new Map()
  const viewsForBranch = async (branchId) => {
    if (!branchViews.has(branchId)) branchViews.set(branchId, paginatedViews(viewQuery(db).where('branchId', '==', branchId).select('branchId', 'weekId')))
    return branchViews.get(branchId)
  }
  const subjects = { sourceStudentIds: new Set(), sourceTrainerIds: new Set(), sourceContractIds: new Set() }
  const scopes = []
  const exactWeeks = new Set()
  for (const data of states) {
    let branchId = String(data.branchId || '').trim()
    let weekId = weekIdFromDate(data.date || data.weekId || data.startDate)
    let studentId = String(data.studentId || (source === 'student' ? documentId : ''))
    let trainerId = String(data.trainerId || (source === 'trainer' ? documentId : ''))
    if (source === 'availability' || source === 'trainerAvailability') {
      const match = String(documentId).match(/^(.+)_(\d{4}-\d{2}-\d{2})$/)
      if (match) {
        weekId = match[2]
        if (source === 'availability') studentId = studentId || match[1]
        else trainerId = trainerId || match[1]
      }
    }
    if (!branchId || branchId === 'all') {
      if (['contract', 'contractUsage'].includes(source)) branchId = await branchFor(documentId, 'contracts')
      if (!branchId || branchId === 'all') branchId = await branchFor(studentId || trainerId, studentId ? 'students' : 'trainers')
    }
    if (studentId) subjects.sourceStudentIds.add(studentId)
    if (trainerId) subjects.sourceTrainerIds.add(trainerId)
    if (['contract', 'contractUsage'].includes(source)) subjects.sourceContractIds.add(documentId)
    if (source === 'draft') {
      branchId = direct?.branchId || branchId
      weekId = direct?.weekId || weekId
      for (const entries of Object.values(safeSchedule(data.schedule || {}))) {
        for (const entry of Array.isArray(entries) ? entries : []) {
          if (entry?.studentId) subjects.sourceStudentIds.add(entry.studentId)
        }
      }
    }
    // Contract entitlement/history changes can affect every cached week, not
    // just startDate. Profile changes likewise affect all rendered weeks.
    const allWeeks = ['student', 'trainer', 'contract', 'contractUsage'].includes(source) || !weekId
    const endWeek = source === 'leave' ? weekIdFromDate(data.endDate || data.startDate) : weekId
    const inherited = source === 'availability' || source === 'trainerAvailability'
    const acceptsWeek = (value) => allWeeks || (value >= weekId && (inherited || value <= (endWeek || weekId)))
    scopes.push(acceptsWeek)
    if (!allWeeks && ['session', 'draft'].includes(source)) exactWeeks.add(weekId)
    if (branchId && branchId !== 'all') {
      if (weekId && !allWeeks) add({ branchId, weekId })
      if (allWeeks || inherited || source === 'leave') {
        for (const view of await viewsForBranch(branchId)) if (acceptsWeek(view.weekId)) add(view)
      }
    }
  }
  // Cross-branch display and coverage depend on the student/trainer, not only
  // their home branch. Version 2 stores small indexed dependency arrays.
  // Existing v1 views are checked during migration so no stale cross-branch
  // cards are silently left behind before their first v2 rebuild.
  const acceptsAnyWeek = (weekId) => scopes.some((accepts) => accepts(weekId))
  const referencesSubject = (view) => (
    (view.sourceStudentIds || []).some((id) => subjects.sourceStudentIds.has(id))
    || (view.sourceTrainerIds || []).some((id) => subjects.sourceTrainerIds.has(id))
    || (view.sourceContractIds || []).some((id) => subjects.sourceContractIds.has(id))
    || (view.students || []).some((row) => subjects.sourceStudentIds.has(row.id))
    || (view.trainers || []).some((row) => subjects.sourceTrainerIds.has(row.id))
    || (view.contracts || []).some((row) => subjects.sourceContractIds.has(row.id))
  )
  if (exactWeeks.size && ['session', 'draft'].includes(source)) {
    // Hot-path session/draft writes only inspect the affected week(s), not a
    // student's entire view history or every legacy view. Single-field indexes
    // support this without a new composite-index deployment prerequisite.
    for (const weekId of exactWeeks) {
      const views = await paginatedViews(viewQuery(db).where('weekId', '==', weekId)
        .select('branchId', 'weekId', 'sourceStudentIds', 'sourceTrainerIds', 'sourceContractIds', 'students', 'trainers', 'contracts'))
      for (const view of views) if (referencesSubject(view)) add(view)
    }
    return [...targets.values()]
  }
  let hasSubjects = false
  for (const [field, ids] of Object.entries(subjects)) {
    const values = [...ids]
    for (let offset = 0; offset < values.length; offset += 30) {
      hasSubjects = true
      const views = await paginatedViews(viewQuery(db).where(field, 'array-contains-any', values.slice(offset, offset + 30)).select('branchId', 'weekId'))
      for (const view of views) if (acceptsAnyWeek(view.weekId)) add(view)
    }
  }
  if (hasSubjects) {
    const legacy = await paginatedViews(viewQuery(db).where('schemaVersion', '==', 1).select('branchId', 'weekId', 'students', 'trainers', 'contracts'))
    for (const view of legacy) {
      if (!acceptsAnyWeek(view.weekId)) continue
      if (referencesSubject(view)) add(view)
    }
  }
  return [...targets.values()]
}

async function syncPtScheduleWeeklyViewSource({ db, event, source = 'source', logger = console } = {}) {
  if (source === 'contract' && !projectionSourceChanged(event, 'contracts')) {
    return { source, marked: 0, skipped: 'source_metadata_only' }
  }
  if (source === 'contractUsage' && !projectionSourceChanged(event, 'contractUsageViews')) {
    return { source, marked: 0, skipped: 'projection_timestamps_only' }
  }
  // These source updatedAt values are not consumed by the weekly display or
  // entitlement validation. Compare before any target discovery: one profile
  // timestamp touch otherwise scans and invalidates its whole view history.
  // Keep every other field significant, including future fields, revisions,
  // nested timestamps and all ownership/date changes. Creates/deletes always
  // propagate; draft/availability/session timestamps retain their own semantics.
  if (['student', 'trainer', 'contract'].includes(source) && event?.data?.before?.exists && event?.data?.after?.exists) {
    const { updatedAt: beforeUpdatedAt, ...before } = event.data.before.data() || {}
    const { updatedAt: afterUpdatedAt, ...after } = event.data.after.data() || {}
    if (isDeepStrictEqual(before, after)) return { source, marked: 0, skipped: 'source_metadata_only' }
  }
  const targets = await sourceEventTargets({ db, event, source })
  let marked = 0
  for (let offset = 0; offset < targets.length; offset += 20) {
    const chunk = targets.slice(offset, offset + 20)
    await Promise.all(chunk.map((target) => markPtScheduleWeeklyViewDirty({ db, ...target, reason: source })))
    marked += chunk.length
  }
  logger?.info?.('pt_schedule_weekly_view_marked_dirty', { source, marked })
  return { source, marked }
}

async function rebuildDirtyPtScheduleWeeklyViews({ db, limit = 8, branchData = loadBranchData, logger = console } = {}) {
  const maximum = Math.max(1, Math.min(20, Number(limit) || 8))
  const checkpoint = db.doc('systemJobs/ptScheduleWeeklyViewQueue')
  const progress = (await observeEventRead('document', () => checkpoint.get())).data() || {}
  const definitions = [
    ['stateValidation', 'ptScheduleWeeklyViewStates', 'validationDirty'],
    ['legacyMatrix', 'ptScheduleWeeklyViews', 'dirty'],
    ['stateMatrix', 'ptScheduleWeeklyViewStates', 'dirty'],
    ['legacyValidation', 'ptScheduleWeeklyViews', 'validationDirty'],
  ]
  // The hot queues now contain small control documents. Keep bounded, projected
  // legacy dirty queries until all older writers have been replaced; never scan
  // clean payloads or download the schedule/profile/evidence for queue discovery.
  const cursors = { ...(progress.cursors || {}) }
  const queues = await Promise.all(definitions.map(async ([key, collection, flag]) => {
    const base = db.collection(collection).where(flag, '==', true).orderBy(FieldPath.documentId())
      .select('branchId', 'weekId').limit(maximum)
    const cursor = stringValue(cursors[key], 400)
    let page = await observeEventRead('query', () => (cursor ? base.startAfter(cursor) : base).get())
    if (!page.docs.length && cursor) {
      cursors[key] = ''
      page = await observeEventRead('query', () => base.get())
    }
    return page
  }))
  const selected = new Map()
  const firstQueue = Math.floor(Math.abs(Number(progress.nextQueue) || 0)) % definitions.length
  for (let index = 0; index < maximum && selected.size < maximum; index += 1) {
    for (let offset = 0; offset < definitions.length && selected.size < maximum; offset += 1) {
      const queueIndex = (firstQueue + offset) % definitions.length
      const item = queues[queueIndex].docs[index]
      if (item) {
        selected.set(item.id, item)
        cursors[definitions[queueIndex][0]] = item.id
      }
    }
  }
  // Advance over selected failures as well as successes. They remain dirty and
  // are retried after wrap, rather than starving every later week forever.
  // Concurrent sweep checkpoints affect fairness only: per-view leases/CAS
  // still own correctness, and no cursor can remove a queued invalidation.
  if (selected.size) await observeEventWrite(() => checkpoint.set({ cursors, nextQueue: (firstQueue + 1) % definitions.length }, { merge: true }))
  else recordEventMetrics({ guardSkips: 1 })
  let rebuilt = 0
  let failed = 0
  for (const item of selected.values()) {
    const value = item.data() || {}
    const branchId = String(value.branchId || '')
    const weekId = String(value.weekId || '')
    if (!branchId || !/^\d{4}-\d{2}-\d{2}$/.test(weekId)) continue
    try {
      const result = await rebuildPtScheduleWeeklyView({ db, branchId, weekId, branchData, forceRefresh: true })
      if (result.rebuilding !== true) rebuilt += 1
    } catch (error) {
      failed += 1
      logger?.error?.('pt_schedule_weekly_view_rebuild_failed', { branchId, weekId, error: error?.message || String(error) })
    }
  }
  return { scanned: selected.size, rebuilt, failed }
}

async function markPtScheduleWeeklyViewDirty({ db, branchId, weekId, reason = 'source_changed', sourceRevision = '' } = {}) {
  const reference = weeklyViewStateReference(db, branchId, weekId)
  await reference.set({
    schemaVersion: 1,
    branchId,
    weekId,
    dirty: true,
    validationDirty: true,
    dirtyGeneration: FieldValue.increment(1),
    dirtyReason: stringValue(reason, 100) || 'source_changed',
    ...(sourceRevision ? { dirtySourceRevision: stringValue(sourceRevision, 80) } : {}),
    dirtyAt: FieldValue.serverTimestamp(),
  }, { merge: true })
  return { branchId, weekId, dirty: true, validationDirty: true, freshness: 'stale' }
}

async function queueMissingWeeklyValidation(db, reference, stateReference) {
  return db.runTransaction(async (transaction) => {
    const [snapshot, state] = await transaction.getAll(reference, stateReference)
    const current = mergeWeeklyViewState(snapshot.exists ? snapshot.data() : null, state.exists ? state.data() : null)
    if (!completeWeeklyView(current)) return current
    // Existing display-only snapshots have no exact evidence. Queue once with
    // a metadata write, not a broad source read or a fabricated zero-warning
    // validation result. The bounded worker provides the first exact snapshot.
    if (!retainedValidationSnapshot(current) && current.validationDirty !== true) {
      transaction.set(stateReference, {
        schemaVersion: 1, branchId: current.branchId, weekId: current.weekId,
        validationDirty: true, updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true })
      return { ...current, validationSnapshot: null, validationState: 'unknown', validationDirty: true }
    }
    return current
  })
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
    const reference = weeklyViewReference(db, branchId, weekId)
    const stateReference = weeklyViewStateReference(db, branchId, weekId)
    const [snapshot, state] = await Promise.all([reference.get(), stateReference.get()])
    let current = mergeWeeklyViewState(snapshot.exists ? snapshot.data() || {} : null, state.exists ? state.data() : null)
    // Source triggers may create a dirty marker before the first full view has
    // ever been materialized. Treat that marker like a cache miss; returning
    // the metadata-only document would leave the first paint without a matrix
    // and the client cannot safely distinguish it from a malformed snapshot.
    if (!snapshot.exists || !current?.schedule || !Array.isArray(current.students) || !Array.isArray(current.trainers)) {
      // Bootstrap only the requested branch/week. Subsequent page loads read
      // the materialized document and do not fan out across the roster.
      return rebuildPtScheduleWeeklyView({ db, branchId, weekId, branchData, forceRefresh: true, initialPaint: true })
    }
    // Schema migration is display-only. Exact evidence, if present, is retained
    // in its own plane; opening a page must never run full reconciliation.
    if (Number(current.schemaVersion || 0) < WEEKLY_VIEW_SCHEMA_VERSION) {
      return rebuildPtScheduleWeeklyView({ db, branchId, weekId, branchData, forceRefresh: true, initialPaint: true })
    }
    // A source trigger can leave a complete view marked dirty while the
    // coalescing worker is waiting for its next sweep. An active schedule page
    // explicitly requests a refresh, so rebuild this one branch/week now
    // rather than returning a stale matrix and making the user wait for the
    // background worker.
    if (current.dirty === true && (request.data?.initialPaint === true || request.data?.forceRefresh === true)) {
      return rebuildPtScheduleWeeklyView({ db, branchId, weekId, branchData, forceRefresh: true, initialPaint: true })
    }
    if (!retainedValidationSnapshot(current) && current.validationDirty !== true) {
      current = await queueMissingWeeklyValidation(db, reference, stateReference)
      if (!completeWeeklyView(current)) return pendingWeeklyView(current, 'superseded')
    }
    return serializableWeeklyView(current)
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
  weeklyViewStateReference,
  mergeWeeklyViewState,
  compactSchedule,
  compactCoverage,
  buildPtScheduleWeeklyView,
  rebuildPtScheduleWeeklyView,
  markPtScheduleWeeklyViewDirty,
  syncPtScheduleWeeklyViewSource,
  rebuildDirtyPtScheduleWeeklyViews,
  weekIdFromDate,
  branchWeekFromDocumentId,
  createPtScheduleWeeklyViewFunctions,
}
