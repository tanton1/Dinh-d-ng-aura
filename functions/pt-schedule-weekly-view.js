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
    eligibleContractIds: Array.isArray(student.eligibleContractIds) ? student.eligibleContractIds.slice(0, 20) : [],
    eligibleForWeek: student.eligibleForWeek === true,
    eligibilityReasons: Array.isArray(student.eligibilityReasons) ? student.eligibilityReasons.slice(0, 24) : [],
    validScheduleDates: Array.isArray(student.validScheduleDates) ? student.validScheduleDates.slice(0, 14) : [],
    pausedScheduleDates: Array.isArray(student.pausedScheduleDates) ? student.pausedScheduleDates.slice(0, 14) : [],
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
    availableSlots: Array.isArray(trainer.availableSlots) ? trainer.availableSlots.slice(0, 48) : [],
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
  const contractIdsForView = new Set([...latestContractByStudent.values()].map((contract) => contract.id).filter(Boolean))
  Object.values(schedule).flat().forEach((entry) => {
    if (entry?.contractId) contractIdsForView.add(entry.contractId)
  })
  const contracts = (data.contracts || [])
    .filter((contract) => contractIdsForView.has(contract.id))
    .slice(0, MAX_VIEW_STUDENTS + MAX_VIEW_SCHEDULE_ENTRIES)
    .map(compactContract)
  const exact = data.partial !== true && data.readMode !== 'display'
  const coverage = compactCoverage({ students, schedule, weeklySessionCoverage: data.weeklySessionCoverage, exact })
  const weeklySessionCoverage = compactWeeklySessionCoverage(data.weeklySessionCoverage)
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
}

function serializableWeeklyView(value = {}) {
  return {
    ...value,
    generatedAt: isoValue(value.generatedAt),
    draft: value.draft ? { ...value.draft, updatedAt: isoValue(value.draft.updatedAt) } : value.draft,
  }
}

async function rebuildPtScheduleWeeklyView({ db, branchId, weekId, branchData = loadBranchData, forceRefresh = true, initialPaint = false, now = new Date() } = {}) {
  const data = await branchData(db, branchId, weekId, { forceRefresh, initialPaint })
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

async function existingBranchWeeks(db, branchId) {
  if (!branchId) return []
  const snapshot = await db.collection('ptScheduleWeeklyViews').where('branchId', '==', branchId).limit(16).get()
  return snapshot.docs.map((item) => ({ branchId, weekId: String(item.data()?.weekId || '').slice(0, 10) })).filter((item) => /^\d{4}-\d{2}-\d{2}$/.test(item.weekId))
}

async function existingWeeklyViews(db) {
  const snapshot = await db.collection('ptScheduleWeeklyViews').limit(200).get()
  return snapshot.docs.map((item) => {
    const value = item.data() || {}
    return { branchId: String(value.branchId || ''), weekId: String(value.weekId || '') }
  }).filter((item) => /^[A-Za-z0-9_-]+$/.test(item.branchId) && /^\d{4}-\d{2}-\d{2}$/.test(item.weekId))
}

async function sourceEventTargets({ db, event, source } = {}) {
  const documentId = event?.params?.documentId || event?.params?.draftId || event?.params?.targetId || event?.params?.availabilityId || event?.params?.sessionId || event?.params?.studentId || event?.params?.contractId || ''
  const data = event?.data?.after?.exists ? event.data.after.data() : event?.data?.before?.exists ? event.data.before.data() : {}
  const direct = ['draft', 'target'].includes(source) ? branchWeekFromDocumentId(documentId) : null
  if (direct) return [direct]
  if (source === 'scheduleConfig') return documentId === 'scheduleConfig' ? existingWeeklyViews(db) : []

  const branchFor = async (id, collection) => {
    if (!id) return ''
    const snapshot = await db.doc(`${collection}/${id}`).get()
    return String(snapshot.data()?.branchId || '').trim()
  }

  let branchId = String(data?.branchId || '').trim()
  let weekId = weekIdFromDate(data?.date || data?.startDate || data?.weekId)
  if (source === 'availability' || source === 'trainerAvailability') {
    const match = String(documentId).match(/^(.+)_(\d{4}-\d{2}-\d{2})$/)
    if (match) {
      weekId = match[2]
      branchId = branchId || await branchFor(match[1], source === 'availability' ? 'students' : 'trainers')
    }
  }
  if (source === 'session') {
    weekId = weekId || weekIdFromDate(data?.date)
    if (branchId === 'all' || !branchId) branchId = await branchFor(data?.studentId || data?.trainerId, data?.studentId ? 'students' : 'trainers')
  }
  if (source === 'leave') {
    branchId = branchId || await branchFor(data?.trainerId, 'trainers')
  }
  if (!branchId && ['student', 'contract', 'contractUsage'].includes(source)) {
    // Contract and usage documents are keyed by contractId, even though the
    // payload also carries studentId. Resolving the branch from studentId here
    // would miss the contract document and silently skip invalidation.
    branchId = await branchFor(documentId, source === 'student' ? 'students' : 'contracts')
    if (!branchId && source !== 'student') branchId = await branchFor(data?.studentId, 'students')
  }
  if (!branchId) return []
  if (weekId) return [{ branchId, weekId }]
  return existingBranchWeeks(db, branchId)
}

async function syncPtScheduleWeeklyViewSource({ db, event, source = 'source', logger = console } = {}) {
  const targets = await sourceEventTargets({ db, event, source })
  let marked = 0
  for (const target of targets.slice(0, 16)) {
    await markPtScheduleWeeklyViewDirty({ db, ...target, reason: source })
    marked += 1
  }
  logger?.info?.('pt_schedule_weekly_view_marked_dirty', { source, marked })
  return { source, marked }
}

async function rebuildDirtyPtScheduleWeeklyViews({ db, limit = 8, logger = console } = {}) {
  const snapshot = await db.collection('ptScheduleWeeklyViews').where('dirty', '==', true).limit(Math.max(1, Math.min(20, Number(limit) || 8))).get()
  let rebuilt = 0
  let failed = 0
  for (const item of snapshot.docs) {
    const value = item.data() || {}
    const branchId = String(value.branchId || '')
    const weekId = String(value.weekId || '')
    if (!branchId || !/^\d{4}-\d{2}-\d{2}$/.test(weekId)) continue
    try {
      await rebuildPtScheduleWeeklyView({ db, branchId, weekId, forceRefresh: true })
      rebuilt += 1
    } catch (error) {
      failed += 1
      logger?.error?.('pt_schedule_weekly_view_rebuild_failed', { branchId, weekId, error: error?.message || String(error) })
    }
  }
  return { scanned: snapshot.size, rebuilt, failed }
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
    const current = snapshot.exists ? snapshot.data() || {} : null
    // Source triggers may create a dirty marker before the first full view has
    // ever been materialized. Treat that marker like a cache miss; returning
    // the metadata-only document would leave the first paint without a matrix
    // and the client cannot safely distinguish it from a malformed snapshot.
    if (!snapshot.exists || !current?.schedule || !Array.isArray(current.students) || !Array.isArray(current.trainers)) {
      // Bootstrap only the requested branch/week. Subsequent page loads read
      // the materialized document and do not fan out across the roster.
      return rebuildPtScheduleWeeklyView({ db, branchId, weekId, branchData, forceRefresh: true, initialPaint: true })
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
