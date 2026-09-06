'use strict'

const { createHash } = require('node:crypto')
const { FieldValue } = require('firebase-admin/firestore')
const { HttpsError } = require('firebase-functions/v2/https')
const { trustedAccessContext, requireCapability } = require('./identity-access')
const {
  branchScheduleSnapshot,
  branchSlotCapacity,
  dateForSlot,
  documentId,
  nextWeek,
  normalizedCapacity,
  normalizedScheduleConfig,
  storedDate,
  trainerAvailabilityMode,
  trainerIsAvailable,
  weekId,
} = require('./pt-schedule-publish')
const {
  effectiveStudentAvailability,
  loadLatestSubmittedFallbacks,
  studentAvailabilityProfilePatch,
} = require('./student-availability')
const { summarizeContractUsage } = require('./contract-usage')

const MAX_STUDENTS = 500
const MAX_TRAINERS = 100
// Keep the whole publish diff below Firestore's 500-write transaction limit.
// Real Aura branches currently contain more than 180 entries per week, so the
// previous guard rejected valid migrated drafts before the workspace loaded.
const MAX_DRAFT_ENTRIES = 440
// OFF markers do not create learner sessions during publish. Keep a separate
// document guard so PT leave markers never consume the atomic session budget,
// while a malformed draft still cannot grow without bounds.
const MAX_DRAFT_DOCUMENT_ENTRIES = 700
const MAX_ENTRIES_PER_SLOT = 100
const DEFAULT_DAILY_SESSION_TARGET = 8
const OPTIMIZER_VERSION = 'optimizer-v12'
const MAX_DEEP_OPTIMIZATION_PASSES = 3
// A bounded repair search can relocate auto-generated sessions from earlier
// rounds. This closes the remaining gap between fair one-seat rounds and the
// maximum weekly coverage without making the callable response unpredictable.
const MAX_REPAIR_CHAIN_DEPTH = 4
const MAX_REPAIR_SEARCH_NODES = 12000
const MAX_CONTINUATION_SEARCH_NODES = 36000
const MAX_REPAIR_DIRECT_CANDIDATES = 80
const MAX_REPAIR_DISPLACEMENT_CANDIDATES = 120
const MAX_RESCUE_PLAN_CANDIDATES = 8
const MAX_RESCUE_LOOKAHEAD_STUDENTS = 120
const DAY_ORDER = new Map([['T2', 0], ['T3', 1], ['T4', 2], ['T5', 3], ['T6', 4], ['T7', 5], ['CN', 6]])
const STUDENT_AVAILABILITY_REASON_CODES = new Set(['AVAILABILITY_NOT_SUBMITTED', 'OUTSIDE_STUDENT_AVAILABILITY'])

function normalizedSearchText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'd')
    .toLocaleLowerCase('vi')
    .trim()
}

function draftId(branchId, week) {
  return `${branchId}_${week}`
}

function draftReference(db, branchId, week) {
  return db.doc(`ptScheduleDrafts/${draftId(branchId, week)}`)
}

function previousWeek(week) {
  const date = new Date(`${week}T00:00:00.000Z`)
  if (Number.isNaN(date.getTime())) return ''
  date.setUTCDate(date.getUTCDate() - 7)
  return date.toISOString().slice(0, 10)
}

function safeWeeklySessionTargets(value, allowedStudentIds = null) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const allowed = allowedStudentIds instanceof Set ? allowedStudentIds : null
  return Object.fromEntries(Object.entries(value)
    .filter(([studentId, target]) => (!allowed || allowed.has(studentId))
      && typeof studentId === 'string'
      && studentId.length > 0
      && studentId.length <= 200
      && Number.isInteger(Number(target))
      && Number(target) >= 0
      && Number(target) <= 7)
    .map(([studentId, target]) => [studentId, Number(target)]))
}

function weeklyTargetForStudent(defaultValue, overrideValue, eligibility) {
  const defaultSessionsPerWeek = Math.max(0, Math.min(7, Number(defaultValue || 0)))
  const weeklySessionTargetOverride = overrideValue === null || overrideValue === undefined
    ? null
    : Math.max(0, Math.min(7, Number(overrideValue || 0)))
  const maxWeeklySessions = Math.max(0, Math.min(7, Number(eligibility?.remainingSessions || 0)))
  const requestedSessions = weeklySessionTargetOverride ?? defaultSessionsPerWeek
  return {
    defaultSessionsPerWeek,
    weeklySessionTargetOverride,
    weeklySessionTargetOverridden: weeklySessionTargetOverride !== null,
    maxWeeklySessions,
    schedulableSessionsThisWeek: Math.max(0, Math.min(maxWeeklySessions, Array.isArray(eligibility?.validDates) ? eligibility.validDates.length : 0)),
    sessionsPerWeek: Math.min(requestedSessions, maxWeeklySessions),
  }
}

function normalizedScheduleAvailabilitySlots(value, config) {
  if (!Array.isArray(value) || value.length > 100) throw new HttpsError('invalid-argument', 'Ma trận thời gian rảnh không hợp lệ.')
  const allowed = new Set(config.workingDays.flatMap((day) => config.workingHours.map((hour) => `${day}-${hour}`)))
  const slots = [...new Set(value.map((slot) => typeof slot === 'string' ? slot.trim() : ''))]
  if (slots.some((slot) => !allowed.has(slot))) throw new HttpsError('invalid-argument', 'Có khung giờ nằm ngoài lịch hoạt động.')
  return slots.sort((left, right) => {
    const [leftDay, leftHour] = left.split('-')
    const [rightDay, rightHour] = right.split('-')
    return (DAY_ORDER.get(leftDay) ?? 99) - (DAY_ORDER.get(rightDay) ?? 99) || Number(leftHour) - Number(rightHour)
  })
}

function activeAdministrator(actor) {
  return actor.accessRole === 'admin' || actor.accessRole === 'super_admin'
}

async function scheduleActor(request, db, branchId) {
  const actor = await trustedAccessContext(request, db)
  if (activeAdministrator(actor)) {
    requireCapability(actor, 'pt.operations.manage')
    return actor
  }
  requireCapability(actor, 'pt.schedule.branch.publish')
  if (!actor.branchIds.includes(branchId)) throw new HttpsError('permission-denied', 'Chi nhánh nằm ngoài phạm vi được cấp.')
  return actor
}

function safeSchedule(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const result = {}
  let documentEntryCount = 0
  let trainingEntryCount = 0
  for (const [slotId, entries] of Object.entries(value)) {
    if (!/^(T[2-7]|CN)-(?:[0-9]|1[0-9]|2[0-3])$/.test(slotId) || !Array.isArray(entries)) continue
    if (entries.length > MAX_ENTRIES_PER_SLOT) throw new HttpsError('resource-exhausted', 'Một khung giờ có quá nhiều dữ liệu.')
    const normalized = entries.map((entry) => {
      const type = entry?.type === 'off' ? 'off' : 'training'
      const source = typeof entry?.source === 'string' ? entry.source.slice(0, 40) : ''
      const availabilityOverrideReason = STUDENT_AVAILABILITY_REASON_CODES.has(entry?.availabilityOverrideReason)
        ? entry.availabilityOverrideReason
        : ''
      const availabilityOverride = type === 'training'
        && source === 'manual_v2'
        && entry?.availabilityOverride === true
        && Boolean(availabilityOverrideReason)
      return {
        studentId: type === 'off' ? 'OFF' : String(entry?.studentId || ''),
        trainerId: String(entry?.trainerId || ''),
        branchId: String(entry?.branchId || ''),
        type,
        ...(entry?.contractId ? { contractId: String(entry.contractId) } : {}),
        ...(entry?.isLocked === true ? { isLocked: true } : {}),
        ...(entry?.trainerAssignmentWarning === true ? { trainerAssignmentWarning: true } : {}),
        ...(entry?.studentBranchWarning === true ? {
          studentBranchWarning: true,
          studentHomeBranchId: typeof entry?.studentHomeBranchId === 'string' ? entry.studentHomeBranchId.slice(0, 200) : '',
        } : {}),
        ...(source ? { source } : {}),
        ...(availabilityOverride ? {
          availabilityOverride: true,
          availabilityOverrideReason,
          availabilityOverrideBy: typeof entry?.availabilityOverrideBy === 'string' ? entry.availabilityOverrideBy.slice(0, 200) : '',
          availabilityOverrideAt: typeof entry?.availabilityOverrideAt === 'string' ? entry.availabilityOverrideAt.slice(0, 40) : '',
        } : {}),
      }
    }).filter((entry) => entry.trainerId && (entry.type === 'off' || entry.studentId))
    documentEntryCount += normalized.length
    trainingEntryCount += normalized.filter((entry) => entry.type !== 'off').length
    if (normalized.length) result[slotId] = normalized
  }
  if (documentEntryCount > MAX_DRAFT_DOCUMENT_ENTRIES || trainingEntryCount > MAX_DRAFT_ENTRIES) {
    throw new HttpsError('resource-exhausted', 'Draft vượt giới hạn an toàn.')
  }
  return result
}

function splitChunks(values, size = 30) {
  const result = []
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size))
  return result
}

async function contractsForStudents(db, studentIds) {
  if (!studentIds.length) return []
  // Load the complete bounded contract chain for each learner. A renewal that
  // starts later in the selected week is normally stored as `future`; hiding
  // it here creates an artificial gap between the source and next contract.
  const snapshots = await Promise.all(splitChunks(studentIds).map((ids) => db.collection('contracts')
    .where('studentId', 'in', ids)
    .get()))
  const unique = new Map()
  snapshots.flatMap((snapshot) => snapshot.docs).forEach((item) => unique.set(item.id, { id: item.id, ...item.data() }))
  return [...unique.values()]
}

async function exactAvailabilityForStudents(db, studentIds, week) {
  if (!studentIds.length) return []
  const snapshots = await Promise.all(splitChunks(studentIds, 100).map((ids) => db.getAll(
    ...ids.map((studentId) => db.doc(`ptAvailability/${studentId}_${week}`)),
  )))
  return snapshots.flat().filter((item) => item.exists)
}

async function exactAvailabilityForTrainers(db, trainerIds, week) {
  const ids = [...trainerIds]
  if (!ids.length) return []
  const snapshots = await Promise.all(splitChunks(ids, 100).map((chunk) => db.getAll(
    ...chunk.map((trainerId) => db.doc(`trainerAvailability/${trainerId}_${week}`)),
  )))
  return snapshots.flat().filter((item) => item.exists)
}

function trainerProfileForWeek(profile = {}, weekly = null, week = '') {
  if (!weekly || weekly.weekId !== week || !['submitted', 'locked'].includes(String(weekly.status || ''))) return profile
  const slots = Array.isArray(weekly.slots) ? weekly.slots.slice(0, 100) : []
  return {
    ...profile,
    availableSlots: slots,
    availabilityMode: slots.length ? 'configured' : 'unconfigured',
    availabilityRevision: Number(weekly.revision || 0),
    availabilitySource: 'weekly',
    availabilityWeekId: week,
    offDates: Array.isArray(weekly.offDates) ? weekly.offDates.slice(0, 6) : [],
  }
}

function leaveCovers(leave, trainerId, date) {
  if (leave?.status !== 'approved' || leave?.trainerId !== trainerId) return false
  const start = storedDate(leave.startDate)
  const end = storedDate(leave.endDate || leave.startDate)
  return Boolean(start && end && date >= start && date <= end)
}

async function loadBranchData(db, branchId, week) {
  const priorWeek = previousWeek(week)
  const [branch, legacySchedule, draft, students, trainers, weekSessions, previousWeekSessions, activeSessions, config, leaves] = await Promise.all([
    db.doc(`branches/${branchId}`).get(),
    db.doc(`schedules/schedule_${week}`).get(),
    draftReference(db, branchId, week).get(),
    db.collection('students').where('branchId', '==', branchId).limit(MAX_STUDENTS + 1).get(),
    db.collection('trainers').where('branchId', '==', branchId).limit(MAX_TRAINERS + 1).get(),
    db.collection('sessions').where('branchId', '==', branchId).where('date', '>=', week).where('date', '<', nextWeek(week)).limit(1001).get(),
    db.collection('sessions').where('branchId', '==', branchId).where('date', '>=', priorWeek).where('date', '<', week).limit(1001).get(),
    db.collection('sessions').where('branchId', '==', branchId).where('status', 'in', ['scheduled', 'rescheduled']).limit(3001).get(),
    db.doc('settings/scheduleConfig').get(),
    db.collection('leaveRequests').where('status', '==', 'approved').limit(1001).get(),
  ])
  if (!branch.exists || branch.data().status === 'archived') throw new HttpsError('failed-precondition', 'Chi nhánh không hoạt động.')
  if (students.size > MAX_STUDENTS || trainers.size > MAX_TRAINERS || weekSessions.size > 1000 || previousWeekSessions.size > 1000 || activeSessions.size > 3000 || leaves.size > 1000) {
    throw new HttpsError('resource-exhausted', 'Dữ liệu chi nhánh vượt giới hạn workspace an toàn.')
  }
  const studentIds = students.docs.map((item) => item.id)
  const trainerIds = new Set(trainers.docs.map((item) => item.id))
  const studentSet = new Set(studentIds)
  // Fetch exact weekly availability by deterministic document id. The old
  // week-wide query scanned every branch and could truncate before reaching
  // the selected branch when migrated data was large.
  const [contracts, availability, trainerAvailability] = await Promise.all([
    contractsForStudents(db, studentIds),
    exactAvailabilityForStudents(db, studentIds, week),
    exactAvailabilityForTrainers(db, trainerIds, week),
  ])
  const studentMap = new Map(students.docs.map((item) => [item.id, item.data()]))
  const trainerMap = new Map(trainers.docs.map((item) => [item.id, item.data()]))
  const sessionRowsById = new Map([...weekSessions.docs, ...activeSessions.docs]
    .map((item) => ({ id: item.id, ...item.data() }))
    .filter((item) => studentSet.has(item.studentId))
    .map((item) => [item.id, item]))
  const sessionRows = [...sessionRowsById.values()]
  const sessionsByContract = new Map()
  for (const session of sessionRows) {
    if (!session.contractId) continue
    if (!sessionsByContract.has(session.contractId)) sessionsByContract.set(session.contractId, [])
    sessionsByContract.get(session.contractId).push(session)
  }
  const previousWeekSessionCounts = new Map()
  previousWeekSessions.docs.forEach((item) => {
    const session = item.data()
    const status = String(session.status || '').toLowerCase()
    if (!studentSet.has(session.studentId) || ['cancelled', 'canceled', 'deleted', 'void'].includes(status)) return
    previousWeekSessionCounts.set(session.studentId, (previousWeekSessionCounts.get(session.studentId) || 0) + 1)
  })
  const weeklyAvailability = new Map(availability.map((item) => item.data()).filter((item) => studentSet.has(item.studentId)).map((item) => [item.studentId, item]))
  const weeklyTrainerAvailability = new Map(trainerAvailability.map((item) => item.data()).filter((item) => trainerIds.has(item.trainerId)).map((item) => [item.trainerId, item]))
  const legacy = legacySchedule.exists ? legacySchedule.data() : {}
  const draftData = draft.exists ? draft.data() : null
  const weeklySessionTargets = safeWeeklySessionTargets(draftData?.weeklySessionTargets, studentSet)
  const schedule = draftData
    ? safeSchedule(draftData.schedule)
    : branchScheduleSnapshot(legacy.schedule || {}, branchId, studentMap, trainerMap)
  const mappedContracts = contracts.map((contract) => {
    const contractSessions = sessionsByContract.get(contract.id) || []
    const usage = summarizeContractUsage(contract, contractSessions)
    const activeContractSessions = contractSessions.filter((session) => ['scheduled', 'rescheduled'].includes(String(session.status || '').toLowerCase())
      && session.billingStatus !== 'charged')
    const activeScheduledThisWeek = activeContractSessions.filter((session) => {
      const date = storedDate(session.date)
      return date >= week && date < nextWeek(week)
    }).length
    const remainingEntitlementSessions = usage.remainingSessions
    return {
    id: contract.id,
    studentId: contract.studentId,
    trainerId: contract.trainerId || '',
    trainerIds: Array.isArray(contract.trainerIds) ? contract.trainerIds.filter((id) => trainerIds.has(id)).slice(0, 10) : [],
    branchId: contract.branchId || '',
    packageId: contract.packageId || '',
    packageName: contract.packageName || contract.packageId || 'Gói tập chưa cập nhật',
    status: contract.status,
    startDate: contract.startDate,
    endDate: contract.endDate,
    pausePeriods: Array.isArray(contract.pausePeriods) ? contract.pausePeriods.slice(0, 20) : [],
    totalSessions: Number(contract.totalSessions || 0),
    usedSessions: usage.usedSessions,
    remainingEntitlementSessions,
    activeScheduledSessions: activeContractSessions.length,
    activeScheduledThisWeek,
    remainingSchedulableSessions: Math.max(0, remainingEntitlementSessions - activeContractSessions.length),
    packageSessions: Number(contract.packageSessions || 0),
    plannedCarryOverSessions: Number(contract.plannedCarryOverSessions || 0),
    carriedOverSessions: Number(contract.carriedOverSessions || 0),
    carryOverRequested: contract.carryOverRequested === true,
    carryOverPending: contract.carryOverPending === true,
    sourceContractId: contract.sourceContractId || '',
    renewedByContractId: contract.renewedByContractId || '',
    }
  })
  const mappedContractsByStudent = new Map()
  for (const contract of mappedContracts) {
    if (!mappedContractsByStudent.has(contract.studentId)) mappedContractsByStudent.set(contract.studentId, [])
    mappedContractsByStudent.get(contract.studentId).push(contract)
  }
  const scheduledStudentIds = new Set(Object.values(schedule).flat()
    .filter((entry) => entry.type !== 'off')
    .map((entry) => entry.studentId))
  const fallbackStudentMap = new Map([...studentMap.entries()].filter(([studentId, profile]) => {
    const inactive = ['inactive', 'archived', 'deleted'].includes(String(profile.status || '').toLowerCase())
    if (inactive) return false
    if (scheduledStudentIds.has(studentId) || previousWeekSessionCounts.has(studentId)) return true
    return studentWeekEligibility(mappedContractsByStudent.get(studentId) || [], studentId, branchId, week).eligible
  }))
  // Migrated profiles without the denormalized latest submission need a
  // bounded historical lookup. Only learners who can affect this workspace
  // are resolved, so old expired profiles no longer add hundreds of reads to
  // every initial load or branch/week switch.
  const inheritedAvailability = await loadLatestSubmittedFallbacks(db, fallbackStudentMap, weeklyAvailability, week)
  const mappedStudents = students.docs.map((item) => {
    const data = item.data()
    const weekly = weeklyAvailability.get(item.id)
    const effectiveAvailability = effectiveStudentAvailability({
      targetWeek: week,
      exact: weekly,
      inherited: inheritedAvailability.get(item.id),
      profile: data,
    })
    const availabilityStatus = effectiveAvailability.source === 'weekly'
      ? effectiveAvailability.status
      : effectiveAvailability.source === 'inherited_weekly'
        ? 'inherited'
        : effectiveAvailability.source === 'legacy_default' && effectiveAvailability.confirmed
          ? 'recurring'
          : 'missing'
    const studentContracts = mappedContractsByStudent.get(item.id) || []
    const eligibility = studentWeekEligibility(studentContracts, item.id, branchId, week)
    const studentInactive = ['inactive', 'archived', 'deleted'].includes(String(data.status || '').toLowerCase())
    const weeklySessionTargetOverride = Object.prototype.hasOwnProperty.call(weeklySessionTargets, item.id)
      ? weeklySessionTargets[item.id]
      : null
    // Weekly demand is a learner/profile setting. Do not silently shrink it
    // just because the current week has fewer future calendar days left.
    // Scheduling capacity is exposed separately so the UI can explain why a
    // target cannot yet be fulfilled.
    const target = weeklyTargetForStudent(data.sessionsPerWeek, weeklySessionTargetOverride, eligibility)
    const contractEndDates = studentContracts.map((contract) => storedDate(contract.endDate)).filter(Boolean).sort()
    const latestContractEndDate = contractEndDates[contractEndDates.length - 1] || null
    const contractStatus = eligibility.reasonCodes.includes('CONTRACT_PAUSED')
      ? 'paused'
      : eligibility.reasonCodes.includes('CONTRACT_SESSION_QUOTA_EXCEEDED') || eligibility.reasonCodes.includes('CONTRACT_QUOTA_EXHAUSTED')
        ? 'quota_exhausted'
        : eligibility.reasonCodes.includes('CONTRACT_EXPIRED_BEFORE_WEEK')
          ? 'expired'
          : eligibility.reasonCodes.includes('CONTRACT_EXPIRES_DURING_WEEK')
            ? 'expiring'
            : eligibility.reasonCodes.includes('CONTRACT_NOT_STARTED_IN_WEEK')
              ? 'not_started_or_ended'
              : !studentContracts.length || !eligibility.validDates.length
                ? 'missing'
                : latestContractEndDate && latestContractEndDate <= datesForWeek(week)[datesForWeek(week).length - 1]
                  ? 'expiring'
                  : 'valid'
    return {
      id: item.id,
      name: data.name || 'Chưa cập nhật tên',
      phone: data.phone || '',
      email: data.email || '',
      status: data.status || 'active',
      branchId,
      sessionsPerWeek: target.sessionsPerWeek,
      defaultSessionsPerWeek: target.defaultSessionsPerWeek,
      weeklySessionTargetOverride: target.weeklySessionTargetOverride,
      weeklySessionTargetOverridden: target.weeklySessionTargetOverridden,
      maxWeeklySessions: target.maxWeeklySessions,
      schedulableSessionsThisWeek: target.schedulableSessionsThisWeek,
      availableSlots: effectiveAvailability.slots.slice(0, 100),
      availabilityStatus,
      availabilityRevision: Number(effectiveAvailability.targetRevision || 0),
      availabilitySourceRevision: Number(effectiveAvailability.sourceRevision || 0),
      availabilitySourceWeekId: effectiveAvailability.sourceWeekId,
      availabilitySource: effectiveAvailability.source,
      isScheduleConfirmed: effectiveAvailability.confirmed === true,
      eligibleForWeek: !studentInactive && eligibility.eligible,
      eligibilityReasons: studentInactive
        ? ['STUDENT_NOT_ACTIVE', ...eligibility.reasonCodes]
        : eligibility.reasonCodes,
      eligibleContractIds: eligibility.eligibleContractIds,
      validScheduleDates: eligibility.validDates,
      pausedScheduleDates: eligibility.pausedDates,
      remainingEntitlementSessions: eligibility.remainingEntitlementSessions,
      activeScheduledSessions: eligibility.activeScheduledSessions,
      activeScheduledThisWeek: eligibility.activeScheduledThisWeek,
      remainingSchedulableSessions: eligibility.remainingSchedulableSessions,
      previousWeekScheduledSessions: previousWeekSessionCounts.get(item.id) || 0,
      hadSchedulePreviousWeek: (previousWeekSessionCounts.get(item.id) || 0) > 0,
      contractStatus,
      contractEndDate: latestContractEndDate,
    }
  })
  const mappedTrainers = trainers.docs.map((item) => {
    const data = trainerProfileForWeek(item.data(), weeklyTrainerAvailability.get(item.id), week)
    const schedulingPriority = Math.max(1, Math.min(999, Math.trunc(Number(data.schedulingPriority ?? data.priority ?? 100) || 100)))
    const dailySessionTarget = Math.max(1, Math.min(12, Math.trunc(Number(data.dailySessionTarget ?? DEFAULT_DAILY_SESSION_TARGET) || DEFAULT_DAILY_SESSION_TARGET)))
    return {
      id: item.id,
      name: data.name || 'PT chưa cập nhật tên',
      phone: data.phone || '',
      email: data.email || '',
      status: data.status || 'active',
      branchId,
      employmentType: ['full_time', 'part_time', 'collaborator'].includes(data.employmentType) ? data.employmentType : 'full_time',
      employmentLevel: ['probation', 'official', 'senior'].includes(data.employmentLevel) ? data.employmentLevel : 'official',
      availableSlots: Array.isArray(data.availableSlots) ? data.availableSlots.slice(0, 100) : [],
      availabilityMode: trainerAvailabilityMode(data),
      availabilityRevision: Number(data.availabilityRevision || 0),
      slotCapacity: normalizedCapacity(data.slotCapacity),
      schedulingPriority,
      dailySessionTarget,
    }
  })
  return {
    branch: { id: branchId, name: branch.data().name || branchId, status: branch.data().status || 'active' },
    draft: {
      exists: draft.exists,
      revision: Number(draftData?.revision ?? legacy.draftRevision ?? 0),
      status: draftData?.status || legacy.publishStatusByBranch?.[branchId] || 'draft',
      publishedVersion: Number(draftData?.publishedVersion || legacy.publishedVersions?.[branchId] || 0),
      publishedRevision: Number(draftData?.publishedRevision ?? legacy.publishedRevisions?.[branchId] ?? -1),
      updatedAt: draftData?.updatedAt?.toDate?.().toISOString?.() || null,
      updatedBy: draftData?.updatedBy || null,
      warnings: Array.isArray(draftData?.warnings) ? draftData.warnings.slice(0, 100) : [],
      optimizationSummary: draftData?.optimizationSummary && typeof draftData.optimizationSummary === 'object'
        ? draftData.optimizationSummary
        : {},
      unassignedEntries: Array.isArray(draftData?.unassignedEntries) ? draftData.unassignedEntries.slice(0, MAX_STUDENTS) : [],
    },
    schedule,
    students: mappedStudents,
    trainers: mappedTrainers,
    contracts: mappedContracts,
    availability: weeklyAvailability,
    sessions: sessionRows,
    leaves: leaves.docs.map((item) => ({ id: item.id, ...item.data() })).filter((item) => trainerIds.has(item.trainerId)),
    config: normalizedScheduleConfig(config.data()),
  }
}

async function loadManualMutationData(db, branchId, week, trainerId, studentId, allowCrossBranchStudent = false, loadedBranchData = null) {
  const [branch, legacySchedule, draft, studentSnapshot, trainerSnapshot, exactAvailability, exactTrainerAvailability, config, leaves, contractSnapshot, sessionSnapshot] = await Promise.all([
    db.doc(`branches/${branchId}`).get(),
    db.doc(`schedules/schedule_${week}`).get(),
    draftReference(db, branchId, week).get(),
    db.doc(`students/${studentId}`).get(),
    db.doc(`trainers/${trainerId}`).get(),
    db.doc(`ptAvailability/${studentId}_${week}`).get(),
    db.doc(`trainerAvailability/${trainerId}_${week}`).get(),
    db.doc('settings/scheduleConfig').get(),
    db.collection('leaveRequests').where('trainerId', '==', trainerId).limit(1001).get(),
    db.collection('contracts').where('studentId', '==', studentId).get(),
    db.collection('sessions').where('studentId', '==', studentId).limit(1001).get(),
  ])
  if (!branch.exists || branch.data().status === 'archived') throw new HttpsError('failed-precondition', 'Chi nhánh không hoạt động.')
  if (!studentSnapshot.exists || (!allowCrossBranchStudent && studentSnapshot.data().branchId !== branchId)) throw new HttpsError('not-found', 'Không tìm thấy học viên trong phạm vi được phép.')
  if (!trainerSnapshot.exists || trainerSnapshot.data().branchId !== branchId) throw new HttpsError('not-found', 'Không tìm thấy PT trong chi nhánh.')
  if (leaves.size > 1000 || sessionSnapshot.size > 1000) throw new HttpsError('resource-exhausted', 'Dữ liệu hồ sơ vượt giới hạn chỉnh ca an toàn.')
  // A legacy-only week still needs the complete branch schedule so no other
  // learner is dropped while the first v2 draft document is created. Keep
  // that schedule, then use the exact learner/PT payload below for validation.
  const baseData = !draft.exists ? (loadedBranchData || await loadBranchData(db, branchId, week)) : null

  const rawStudent = studentSnapshot.data()
  const rawTrainer = trainerProfileForWeek(trainerSnapshot.data(), exactTrainerAvailability.exists ? exactTrainerAvailability.data() : null, week)
  const sessions = sessionSnapshot.docs.map((item) => ({ id: item.id, ...item.data() }))
  const contracts = contractSnapshot.docs.map((item) => {
    const contract = item.data()
    const usage = summarizeContractUsage(contract, sessions.filter((session) => session.contractId === item.id))
    const activeContractSessions = sessions.filter((session) => session.contractId === item.id
      && ['scheduled', 'rescheduled'].includes(String(session.status || '').toLowerCase())
      && session.billingStatus !== 'charged')
    const activeScheduledThisWeek = activeContractSessions.filter((session) => {
      const date = storedDate(session.date)
      return date >= week && date < nextWeek(week)
    }).length
    const remainingEntitlementSessions = usage.remainingSessions
    return {
      id: item.id,
      studentId: contract.studentId,
      trainerId: contract.trainerId || '',
      trainerIds: Array.isArray(contract.trainerIds) ? contract.trainerIds.slice(0, 10) : [],
      branchId: contract.branchId || '',
      packageId: contract.packageId || '',
      packageName: contract.packageName || contract.packageId || 'Gói tập chưa cập nhật',
      status: contract.status,
      startDate: contract.startDate,
      endDate: contract.endDate,
      pausePeriods: Array.isArray(contract.pausePeriods) ? contract.pausePeriods.slice(0, 20) : [],
      totalSessions: Number(contract.totalSessions || 0),
      usedSessions: usage.usedSessions,
      remainingEntitlementSessions,
      activeScheduledSessions: activeContractSessions.length,
      activeScheduledThisWeek,
      remainingSchedulableSessions: Math.max(0, remainingEntitlementSessions - activeContractSessions.length),
    }
  })
  const exactMap = new Map(exactAvailability.exists ? [[studentId, exactAvailability.data()]] : [])
  const profileMap = new Map([[studentId, rawStudent]])
  const inherited = await loadLatestSubmittedFallbacks(db, profileMap, exactMap, week)
  const effectiveAvailability = effectiveStudentAvailability({
    targetWeek: week,
    exact: exactAvailability.exists ? exactAvailability.data() : null,
    inherited: inherited.get(studentId),
    profile: rawStudent,
  })
  const availabilityStatus = effectiveAvailability.source === 'weekly'
    ? effectiveAvailability.status
    : effectiveAvailability.source === 'inherited_weekly'
      ? 'inherited'
      : effectiveAvailability.source === 'legacy_default' && effectiveAvailability.confirmed
        ? 'recurring'
        : 'missing'
  const eligibility = studentWeekEligibility(contracts, studentId, branchId, week, todayInHoChiMinh(), allowCrossBranchStudent)
  const studentInactive = ['inactive', 'archived', 'deleted'].includes(String(rawStudent.status || '').toLowerCase())
  const student = {
    id: studentId,
    name: rawStudent.name || 'Chưa cập nhật tên',
    phone: rawStudent.phone || '',
    status: rawStudent.status || 'active',
    branchId: rawStudent.branchId || '',
    ...weeklyTargetForStudent(rawStudent.sessionsPerWeek,
      safeWeeklySessionTargets(draft.data()?.weeklySessionTargets)[studentId] ?? null, eligibility),
    availableSlots: effectiveAvailability.slots.slice(0, 100),
    availabilityStatus,
    eligibleForWeek: !studentInactive && eligibility.eligible,
    eligibilityReasons: studentInactive ? ['STUDENT_NOT_ACTIVE', ...eligibility.reasonCodes] : eligibility.reasonCodes,
    eligibleContractIds: eligibility.eligibleContractIds,
    validScheduleDates: eligibility.validDates,
    pausedScheduleDates: eligibility.pausedDates,
  }
  const schedulingPriority = Math.max(1, Math.min(999, Math.trunc(Number(rawTrainer.schedulingPriority ?? rawTrainer.priority ?? 100) || 100)))
  const dailySessionTarget = Math.max(1, Math.min(12, Math.trunc(Number(rawTrainer.dailySessionTarget ?? DEFAULT_DAILY_SESSION_TARGET) || DEFAULT_DAILY_SESSION_TARGET)))
  const trainer = {
    id: trainerId,
    name: rawTrainer.name || 'PT chưa cập nhật tên',
    status: rawTrainer.status || 'active',
    branchId,
    employmentType: ['full_time', 'part_time', 'collaborator'].includes(rawTrainer.employmentType) ? rawTrainer.employmentType : 'full_time',
    employmentLevel: ['probation', 'official', 'senior'].includes(rawTrainer.employmentLevel) ? rawTrainer.employmentLevel : 'official',
    availableSlots: Array.isArray(rawTrainer.availableSlots) ? rawTrainer.availableSlots.slice(0, 100) : [],
    availabilityMode: trainerAvailabilityMode(rawTrainer),
    slotCapacity: normalizedCapacity(rawTrainer.slotCapacity),
    schedulingPriority,
    dailySessionTarget,
  }
  const draftData = draft.exists ? draft.data() : null
  const schedule = baseData?.schedule || safeSchedule(draftData.schedule)
  return {
    branch: baseData?.branch || { id: branchId, name: branch.data().name || branchId, status: branch.data().status || 'active' },
    draft: baseData?.draft || {
      exists: draft.exists,
      revision: Number(draftData?.revision ?? legacySchedule.data()?.draftRevision ?? 0),
    },
    schedule,
    students: [student],
    trainers: [trainer],
    contracts,
    sessions,
    leaves: leaves.docs.map((item) => ({ id: item.id, ...item.data() })).filter((item) => item.status === 'approved'),
    config: normalizedScheduleConfig(config.data()),
    allowCrossBranchStudentIds: allowCrossBranchStudent ? new Set([studentId]) : new Set(),
  }
}

function contractPaused(contract, date) {
  return Array.isArray(contract.pausePeriods) && contract.pausePeriods.some((period) => {
    const start = storedDate(period?.startDate)
    const end = storedDate(period?.endDate)
    return start && end && date >= start && date <= end
  })
}

function datesForWeek(week) {
  return [...DAY_ORDER.keys()].map((day) => dateForSlot(week, day))
}

function todayInHoChiMinh() {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}`
}

function contractCanServeScheduledDate(contract, date) {
  const status = String(contract?.status || 'active').toLowerCase()
  if (!['active', 'future'].includes(status)) return false
  return storedDate(contract.startDate) <= date && storedDate(contract.endDate) >= date
}

function studentWeekEligibility(contracts, studentId, branchId, week, referenceDate = todayInHoChiMinh(), allowCrossBranch = false) {
  const reasons = new Set()
  const weekDates = datesForWeek(week)
  const weekStart = weekDates[0]
  const weekEnd = weekDates[weekDates.length - 1]
  const allStudentContracts = contracts.filter((contract) => contract.studentId === studentId)
  const operationalContracts = contracts.filter((contract) => contract.studentId === studentId
    && ['active', 'future'].includes(String(contract.status || 'active').toLowerCase()))
  if (!operationalContracts.length) {
    const datedContracts = allStudentContracts.map((contract) => ({
      status: String(contract.status || '').toLowerCase(),
      start: storedDate(contract.startDate),
      end: storedDate(contract.endDate),
    })).filter((contract) => contract.start && contract.end)
    if (datedContracts.length && datedContracts.every((contract) => contract.end < weekStart || contract.status === 'expired')) {
      reasons.add('ACTIVE_CONTRACT_NOT_FOUND')
      reasons.add(datedContracts.some((contract) => contract.end >= weekStart && contract.end <= weekEnd)
        ? 'CONTRACT_EXPIRES_DURING_WEEK'
        : 'CONTRACT_EXPIRED_BEFORE_WEEK')
    } else if (datedContracts.length && datedContracts.every((contract) => contract.start > weekEnd)) {
      reasons.add('CONTRACT_NOT_STARTED_IN_WEEK')
    } else reasons.add('ACTIVE_CONTRACT_NOT_FOUND')
  }

  const branchContracts = operationalContracts.filter((contract) => {
    if (!contract.branchId) {
      reasons.add('CONTRACT_BRANCH_REQUIRED')
      return false
    }
    if (contract.branchId !== branchId && !allowCrossBranch) {
      reasons.add('STUDENT_BRANCH_MISMATCH')
      return false
    }
    return true
  })
  const dates = weekDates.filter((date) => date >= referenceDate)
  const validDates = []
  const pausedDates = []
  const eligibleContractIds = new Set()
  let overlapsWeek = false
  let hasRemainingSessions = false
  let remainingSessionQuota = 0
  let remainingEntitlementSessions = 0
  let activeScheduledSessions = 0
  let activeScheduledThisWeek = 0
  let remainingSchedulableSessions = 0

  for (const contract of branchContracts) {
    const startDate = storedDate(contract.startDate)
    const endDate = storedDate(contract.endDate)
    if (!startDate || !endDate) continue
    const contractEntitlement = Math.max(0, Number(contract.remainingEntitlementSessions
      ?? (Number(contract.totalSessions || 0) - Number(contract.usedSessions || 0))))
    const contractActiveScheduled = Math.max(0, Number(contract.activeScheduledSessions || 0))
    const contractActiveThisWeek = Math.max(0, Number(contract.activeScheduledThisWeek || 0))
    const contractSchedulable = Math.max(0, Number(contract.remainingSchedulableSessions
      ?? (contractEntitlement - contractActiveScheduled)))
    const contractWeeklyCapacity = Math.min(contractEntitlement, contractSchedulable + contractActiveThisWeek)
    remainingEntitlementSessions += contractEntitlement
    activeScheduledSessions += contractActiveScheduled
    activeScheduledThisWeek += contractActiveThisWeek
    remainingSchedulableSessions += contractSchedulable
    if (contractWeeklyCapacity > 0) hasRemainingSessions = true
    let contractUsableInWeek = false
    for (const date of dates) {
      if (date < startDate || date > endDate) continue
      overlapsWeek = true
      if (contractWeeklyCapacity < 1) continue
      if (contractPaused(contract, date)) {
        pausedDates.push(date)
        continue
      }
      validDates.push(date)
      eligibleContractIds.add(contract.id)
      contractUsableInWeek = true
    }
    if (contractUsableInWeek) remainingSessionQuota += contractWeeklyCapacity
  }

  if (branchContracts.length && !overlapsWeek) {
    const latestEnd = branchContracts.map((contract) => storedDate(contract.endDate)).filter(Boolean).sort().pop()
    if (latestEnd && latestEnd < weekStart) {
      reasons.add('ACTIVE_CONTRACT_NOT_FOUND')
      reasons.add('CONTRACT_EXPIRED_BEFORE_WEEK')
    }
    else if (branchContracts.every((contract) => storedDate(contract.startDate) > weekEnd)) reasons.add('CONTRACT_NOT_STARTED_IN_WEEK')
    else reasons.add('ACTIVE_CONTRACT_NOT_FOUND')
  }
  if (branchContracts.length && !hasRemainingSessions) {
    reasons.add('CONTRACT_SESSION_QUOTA_EXCEEDED')
    reasons.add('CONTRACT_QUOTA_EXHAUSTED')
  }
  if (overlapsWeek && hasRemainingSessions && !validDates.length && pausedDates.length) reasons.add('CONTRACT_PAUSED')

  for (const date of [...new Set(validDates)]) {
    const matching = branchContracts.filter((contract) => {
      const entitlement = Math.max(0, Number(contract.remainingEntitlementSessions
        ?? (Number(contract.totalSessions || 0) - Number(contract.usedSessions || 0))))
      const activeScheduled = Math.max(0, Number(contract.activeScheduledSessions || 0))
      const schedulable = Math.max(0, Number(contract.remainingSchedulableSessions
        ?? (entitlement - activeScheduled)))
      const activeThisWeek = Math.max(0, Number(contract.activeScheduledThisWeek || 0))
      return Math.min(entitlement, schedulable + activeThisWeek) > 0
        && storedDate(contract.startDate) <= date
        && storedDate(contract.endDate) >= date
        && !contractPaused(contract, date)
    })
    if (matching.length > 1) reasons.add('AMBIGUOUS_ACTIVE_CONTRACT')
  }

  return {
    eligible: validDates.length > 0,
    reasonCodes: [...reasons],
    eligibleContractIds: [...eligibleContractIds],
    validDates: [...new Set(validDates)].sort(),
    pausedDates: [...new Set(pausedDates)].sort(),
    remainingSessions: remainingSessionQuota,
    remainingEntitlementSessions,
    activeScheduledSessions,
    activeScheduledThisWeek,
    remainingSchedulableSessions,
  }
}

function resolveContract(data, studentId, trainerId, date, schedule = null, schedulingState = null) {
  const dateCandidates = data.contracts.filter((contract) => contract.studentId === studentId
    && contractCanServeScheduledDate(contract, date))
  if (dateCandidates.some((contract) => !contract.branchId)) return { contract: null, reasons: ['CONTRACT_BRANCH_REQUIRED'] }
  const allowCrossBranch = data.allowCrossBranchStudentIds instanceof Set && data.allowCrossBranchStudentIds.has(studentId)
  const candidates = dateCandidates.filter((contract) => allowCrossBranch || contract.branchId === data.branch.id)
  if (!candidates.length) return { contract: null, reasons: ['ACTIVE_CONTRACT_NOT_FOUND'] }
  if (candidates.length > 1) return { contract: null, reasons: ['AMBIGUOUS_ACTIVE_CONTRACT'] }
  const contract = candidates[0]
  if (contractPaused(contract, date)) return { contract: null, reasons: ['CONTRACT_PAUSED'] }
  const assigned = assignedTrainerIds(contract)
  // PT chính/phụ là thứ tự ưu tiên vận hành, không phải khóa cứng. Khi cả hai
  // đều không thể nhận ca, mọi PT đang hoạt động trong cùng chi nhánh vẫn có
  // thể dạy để không bỏ sót quyền lợi của học viên. Entry sẽ mang cờ cảnh báo
  // để UI, publish và audit cùng nhận diện đây là ca PT hỗ trợ.
  const trainerAssignmentWarning = assigned.length > 0 && !assigned.includes(trainerId)
  const reservations = contractReservationCounts(data, schedule, schedulingState)
  const activeForContract = reservations.active.get(contract.id) || 0
  const draftForContract = reservations.draft.get(contract.id) || 0
  if (contract.usedSessions + activeForContract + draftForContract >= contract.totalSessions) {
    return { contract: null, reasons: ['CONTRACT_SESSION_QUOTA_EXCEEDED'] }
  }
  return { contract, reasons: [], trainerAssignmentWarning, assignedTrainerIds: assigned }
}

function contractReservationCounts(data, schedule, state) {
  if (state?.reservationCounts) return state.reservationCounts
  const active = new Map(), draft = new Map(), identities = new Set()
  for (const session of data.sessions || []) {
    if (['scheduled', 'rescheduled'].includes(session.status) && session.billingStatus !== 'charged') active.set(session.contractId, (active.get(session.contractId) || 0) + 1)
    if (session.branchId === data.branch.id && (['scheduled', 'rescheduled', 'completed', 'attended', 'no_show'].includes(session.status) || session.billingStatus === 'charged')) {
      identities.add(`${session.contractId}|${session.studentId}|${publishedSessionSlotId(data.weekId, session)}`)
    }
  }
  for (const [slotId, entries] of Object.entries(schedule || {})) for (const entry of entries) {
    if (entry.type === 'off' || !entry.contractId || identities.has(`${entry.contractId}|${entry.studentId}|${slotId}`)) continue
    draft.set(entry.contractId, (draft.get(entry.contractId) || 0) + 1)
  }
  const counts = { active, draft }
  if (state) state.reservationCounts = counts
  return counts
}

function assignedTrainerIds(contract) {
  return [...new Set([
    contract?.trainerId,
    ...(Array.isArray(contract?.trainerIds) ? contract.trainerIds : []),
  ].filter(Boolean))]
}

function trainerSchedulingPolicy(trainer) {
  const schedulingPriority = Math.max(1, Math.min(999, Math.trunc(Number(trainer?.schedulingPriority ?? trainer?.priority ?? 100) || 100)))
  const dailySessionTarget = Math.max(1, Math.min(12, Math.trunc(Number(trainer?.dailySessionTarget ?? DEFAULT_DAILY_SESSION_TARGET) || DEFAULT_DAILY_SESSION_TARGET)))
  const employmentType = ['full_time', 'part_time', 'collaborator'].includes(trainer?.employmentType)
    ? trainer.employmentType
    : 'full_time'
  const employmentLevel = ['probation', 'official', 'senior'].includes(trainer?.employmentLevel)
    ? trainer.employmentLevel
    : 'official'
  return { schedulingPriority, dailySessionTarget, employmentType, employmentLevel }
}

function schedulingTier(candidate) {
  // Full-time staff are filled to their daily target first. Part-time and CTV
  // are then used from their explicitly submitted availability. Once the
  // target is reached, extra sessions remain possible because it is a target,
  // never a business hard cap.
  if (candidate.employmentType === 'full_time' && candidate.currentDailyLoad < candidate.dailySessionTarget) return 0
  if (candidate.employmentType === 'part_time' && candidate.currentDailyLoad < candidate.dailySessionTarget) return 1
  if (candidate.employmentType === 'collaborator') return 2
  if (candidate.employmentType === 'part_time') return 3
  return 4
}

function createsThreeConsecutiveTrainingDays(existingDays, candidateDay) {
  const indexes = new Set([...(existingDays || []), candidateDay]
    .map((day) => DAY_ORDER.get(day))
    .filter((value) => Number.isInteger(value)))
  return [...indexes].some((index) => indexes.has(index + 1) && indexes.has(index + 2))
}

function buildSchedulingState(schedule) {
  const state = {
    studentDays: new Map(),
    studentSessionCounts: new Map(),
    branchSlotCounts: new Map(),
    trainerSlotsByDay: new Map(),
    trainerSlotCounts: new Map(),
    trainerStudentSessions: new Map(),
    trainerStudentSessionsByDay: new Map(),
    offTrainerSlots: new Set(),
  }
  for (const [slotId, entries] of Object.entries(schedule || {})) {
    const [day] = slotId.split('-')
    for (const entry of Array.isArray(entries) ? entries : []) {
      const trainerSlotKey = `${entry.trainerId}|${slotId}`
      if (entry.type === 'off') {
        state.offTrainerSlots.add(trainerSlotKey)
        continue
      }
      if (!state.studentDays.has(entry.studentId)) state.studentDays.set(entry.studentId, new Set())
      state.studentDays.get(entry.studentId).add(day)
      state.studentSessionCounts.set(entry.studentId, (state.studentSessionCounts.get(entry.studentId) || 0) + 1)
      state.branchSlotCounts.set(slotId, (state.branchSlotCounts.get(slotId) || 0) + 1)
      const trainerDayKey = `${entry.trainerId}|${day}`
      if (!state.trainerSlotsByDay.has(trainerDayKey)) state.trainerSlotsByDay.set(trainerDayKey, new Set())
      state.trainerSlotsByDay.get(trainerDayKey).add(slotId)
      state.trainerSlotCounts.set(trainerSlotKey, (state.trainerSlotCounts.get(trainerSlotKey) || 0) + 1)
      state.trainerStudentSessions.set(entry.trainerId, (state.trainerStudentSessions.get(entry.trainerId) || 0) + 1)
      state.trainerStudentSessionsByDay.set(trainerDayKey, (state.trainerStudentSessionsByDay.get(trainerDayKey) || 0) + 1)
    }
  }
  return state
}

function addEntryToSchedulingState(state, slotId, entry) {
  delete state.reservationCounts
  const [day] = slotId.split('-')
  if (!state.studentDays.has(entry.studentId)) state.studentDays.set(entry.studentId, new Set())
  state.studentDays.get(entry.studentId).add(day)
  state.studentSessionCounts.set(entry.studentId, (state.studentSessionCounts.get(entry.studentId) || 0) + 1)
  state.branchSlotCounts.set(slotId, (state.branchSlotCounts.get(slotId) || 0) + 1)
  const trainerDayKey = `${entry.trainerId}|${day}`
  if (!state.trainerSlotsByDay.has(trainerDayKey)) state.trainerSlotsByDay.set(trainerDayKey, new Set())
  state.trainerSlotsByDay.get(trainerDayKey).add(slotId)
  const trainerSlotKey = `${entry.trainerId}|${slotId}`
  state.trainerSlotCounts.set(trainerSlotKey, (state.trainerSlotCounts.get(trainerSlotKey) || 0) + 1)
  state.trainerStudentSessions.set(entry.trainerId, (state.trainerStudentSessions.get(entry.trainerId) || 0) + 1)
  state.trainerStudentSessionsByDay.set(trainerDayKey, (state.trainerStudentSessionsByDay.get(trainerDayKey) || 0) + 1)
}

function trainerBlockAffinity(state, trainerId, slotId) {
  const [day, rawHour] = slotId.split('-')
  const hour = Number(rawHour)
  const currentSlots = state.trainerSlotsByDay.get(`${trainerId}|${day}`) || new Set()
  const occupiedHours = new Set([...currentSlots]
    .map((value) => Number(String(value).split('-')[1]))
    .filter(Number.isFinite))
  occupiedHours.add(hour)

  let blockStart = hour
  let blockEnd = hour
  while (occupiedHours.has(blockStart - 1)) blockStart -= 1
  while (occupiedHours.has(blockEnd + 1)) blockEnd += 1
  const resultingBlockLength = blockEnd - blockStart + 1
  const adjacentTeachingSlots = Number(occupiedHours.has(hour - 1)) + Number(occupiedHours.has(hour + 1))
  return {
    adjacentTeachingSlots,
    // Aura wants compact blocks of two or three classes. Longer runs remain
    // useful, but they must not outrank the first 2/3-slot block or learner
    // coverage/pairing decisions made before this soft preference.
    preferredBlockLength: Math.min(3, resultingBlockLength),
    resultingBlockLength,
    isolatedTeachingSlot: currentSlots.size > 0 && adjacentTeachingSlots === 0,
  }
}

function candidateForSlot(data, { student, trainer, slotId, schedule, schedulingState = null, contractCache = null }) {
  const [day, rawHour] = slotId.split('-')
  const hour = Number(rawHour)
  const date = dateForSlot(data.weekId, day)
  const reasons = []
  const state = schedulingState || buildSchedulingState(schedule)
  const policy = trainerSchedulingPolicy(trainer)
  const workingDays = Array.isArray(data.config?.workingDays) ? data.config.workingDays : []
  const workingHours = Array.isArray(data.config?.workingHours) ? data.config.workingHours.map(Number) : []
  const holidays = Array.isArray(data.config?.holidays) ? data.config.holidays : []
  if ((workingDays.length && !workingDays.includes(day))
    || (workingHours.length && !workingHours.includes(hour))
    || holidays.includes(date)) reasons.push('OUTSIDE_WORKING_CALENDAR')
  if (data.referenceNow && slotIsPast(data.weekId, slotId, data.referenceNow)) reasons.push('OUTSIDE_WORKING_CALENDAR')
  if (student.eligibleForWeek === false) {
    reasons.push(...(Array.isArray(student.eligibilityReasons) && student.eligibilityReasons.length
      ? student.eligibilityReasons
      : ['ACTIVE_CONTRACT_NOT_FOUND']))
  }
  if (Array.isArray(student.validScheduleDates) && !student.validScheduleDates.includes(date)) reasons.push('ACTIVE_CONTRACT_NOT_FOUND')
  if (student.status === 'inactive') reasons.push('STUDENT_NOT_ACTIVE')
  const studentBranchWarning = student.branchId !== data.branch.id
  if (studentBranchWarning && !(data.allowCrossBranchStudentIds instanceof Set && data.allowCrossBranchStudentIds.has(student.id))) reasons.push('STUDENT_BRANCH_MISMATCH')
  if (trainer.status === 'inactive') reasons.push('TRAINER_NOT_ACTIVE')
  if (trainer.branchId !== data.branch.id) reasons.push('TRAINER_BRANCH_MISMATCH')
  if (policy.employmentType === 'collaborator') {
    if (!Array.isArray(trainer.availableSlots) || !trainer.availableSlots.length) reasons.push('TRAINER_AVAILABILITY_UNCONFIGURED')
    else if (!trainer.availableSlots.includes(slotId)) reasons.push('OUTSIDE_TRAINER_AVAILABILITY')
  } else if (trainer.availabilityMode === 'unconfigured') reasons.push('TRAINER_AVAILABILITY_UNCONFIGURED')
  else if (!trainerIsAvailable(trainer, slotId)) reasons.push('OUTSIDE_TRAINER_AVAILABILITY')
  if (data.leaves.some((leave) => leaveCovers(leave, trainer.id, date))) reasons.push('TRAINER_ON_LEAVE')
  if (!['submitted', 'locked', 'inherited', 'recurring'].includes(student.availabilityStatus)) reasons.push('AVAILABILITY_NOT_SUBMITTED')
  else if (!student.availableSlots.includes(slotId)) reasons.push('OUTSIDE_STUDENT_AVAILABILITY')
  const contractCacheKey = `${student.id}|${trainer.id}|${date}|${scheduleEntryCount(schedule)}`
  if (contractCache && contractCache.scheduleIdentity !== schedule) {
    contractCache.clear()
    contractCache.scheduleIdentity = schedule
  }
  const contractResult = contractCache?.has(contractCacheKey)
    ? contractCache.get(contractCacheKey)
    : resolveContract(data, student.id, trainer.id, date, schedule, state)
  if (contractCache && !contractCache.has(contractCacheKey)) contractCache.set(contractCacheKey, contractResult)
  reasons.push(...contractResult.reasons)
  if (state.studentDays.get(student.id)?.has(day)) reasons.push('STUDENT_MULTIPLE_SESSIONS_PER_DAY')
  const scheduledForStudent = state.studentSessionCounts.get(student.id) || 0
  if (Number(student.sessionsPerWeek || 0) >= 0 && scheduledForStudent >= Number(student.sessionsPerWeek || 0)) reasons.push('STUDENT_WEEKLY_TARGET_REACHED')
  const trainerSlotKey = `${trainer.id}|${slotId}`
  if (state.offTrainerSlots.has(trainerSlotKey)) reasons.push('TRAINER_OFF_CONFLICT')
  const trainerCount = state.trainerSlotCounts.get(trainerSlotKey) || 0
  if (trainerCount >= trainer.slotCapacity) reasons.push('TRAINER_CAPACITY_EXCEEDED')
  const configuredBranchCapacity = branchSlotCapacity(data.config, data.branch.id, slotId)
  if (configuredBranchCapacity !== null && (state.branchSlotCounts.get(slotId) || 0) >= configuredBranchCapacity) reasons.push('BRANCH_CAPACITY_REACHED')
  const currentDailyLoad = state.trainerSlotsByDay.get(`${trainer.id}|${day}`)?.size || 0
  const opensTeachingSlot = trainerCount === 0
  const projectedDailyLoad = currentDailyLoad + (opensTeachingSlot ? 1 : 0)
  const consecutiveDayPenalty = createsThreeConsecutiveTrainingDays(state.studentDays.get(student.id), day) ? 1 : 0
  const blockAffinity = trainerBlockAffinity(state, trainer.id, slotId)
  return {
    eligible: reasons.length === 0,
    reasons: [...new Set(reasons)],
    contractId: contractResult.contract?.id || null,
    trainerAssignmentWarning: contractResult.trainerAssignmentWarning === true,
    studentBranchWarning,
    assignedTrainerIds: contractResult.assignedTrainerIds || [],
    date,
    currentDailyLoad,
    projectedDailyLoad,
    opensTeachingSlot,
    consecutiveDayPenalty,
    ...blockAffinity,
    ...policy,
  }
}

function manualSlotCandidate(result) {
  const availabilityReasons = result.reasons.filter((reason) => STUDENT_AVAILABILITY_REASON_CODES.has(reason))
  const blockingReasons = result.reasons.filter((reason) => !STUDENT_AVAILABILITY_REASON_CODES.has(reason))
  return {
    ...result,
    matchesStudentAvailability: availabilityReasons.length === 0,
    manualSelectable: blockingReasons.length === 0,
    availabilityReason: availabilityReasons[0] || null,
  }
}

function scheduleEntryCount(schedule) {
  return Object.values(schedule || {}).reduce((total, entries) => total + (Array.isArray(entries)
    ? entries.filter((entry) => entry?.type !== 'off' && entry?.studentId !== 'OFF').length
    : 0), 0)
}

function scheduleDocumentEntryCount(schedule) {
  return Object.values(schedule || {}).reduce((total, entries) => total + (Array.isArray(entries) ? entries.length : 0), 0)
}

function generationScore({ student, contract, targetDate }) {
  const end = Date.parse(`${storedDate(contract?.endDate)}T00:00:00Z`)
  const reference = Date.parse(`${targetDate}T00:00:00Z`)
  const urgency = Number.isFinite(end) && Number.isFinite(reference)
    ? Math.max(0, 365 - Math.floor((end - reference) / 86400000))
    : 0
  const scarcity = Math.max(0, 100 - student.availableSlots.length * 8)
  return urgency + scarcity
}

function compareSlots(left, right) {
  const [leftDay, leftHour] = left.split('-')
  const [rightDay, rightHour] = right.split('-')
  return (DAY_ORDER.get(leftDay) ?? 99) - (DAY_ORDER.get(rightDay) ?? 99)
    || Number(leftHour) - Number(rightHour)
    || left.localeCompare(right)
}

function compareCandidatePriorities(left, right, leftOpensTeachingSlot, rightOpensTeachingSlot) {
  // Lexicographic objective after maximum-cardinality learner matching:
  // fill an existing 1/2 class before opening a new class. Spacing learner
  // days is a soft preference: a full weekly target and a paired class are
  // more valuable than leaving a valid seat empty. This keeps the optimizer
  // aligned with Aura's operating goal while still preferring non-consecutive
  // days whenever the utilization result is otherwise equal.
  if (leftOpensTeachingSlot !== rightOpensTeachingSlot) return Number(leftOpensTeachingSlot) - Number(rightOpensTeachingSlot)
  if (left.assignmentOrder !== right.assignmentOrder) return left.assignmentOrder - right.assignmentOrder
  const tierComparison = schedulingTier(left) - schedulingTier(right)
  if (tierComparison !== 0) return tierComparison
  // Compact a PT's day before balancing equally valid work across PTs. This
  // is deliberately a comparator only: an isolated slot is never rejected
  // when it is the remaining way to fulfil a learner's weekly target.
  if (leftOpensTeachingSlot && rightOpensTeachingSlot) {
    if (left.preferredBlockLength !== right.preferredBlockLength) return right.preferredBlockLength - left.preferredBlockLength
    if (left.adjacentTeachingSlots !== right.adjacentTeachingSlots) return right.adjacentTeachingSlots - left.adjacentTeachingSlots
    if (left.isolatedTeachingSlot !== right.isolatedTeachingSlot) return Number(left.isolatedTeachingSlot) - Number(right.isolatedTeachingSlot)
    if (left.resultingBlockLength !== right.resultingBlockLength) return right.resultingBlockLength - left.resultingBlockLength
  }
  const ratioComparison = left.projectedDailyLoad * right.dailySessionTarget - right.projectedDailyLoad * left.dailySessionTarget
  if (ratioComparison !== 0) return ratioComparison
  if (left.schedulingPriority !== right.schedulingPriority) {
    return left.schedulingPriority - right.schedulingPriority
  }
  if (left.consecutiveDayPenalty !== right.consecutiveDayPenalty) return left.consecutiveDayPenalty - right.consecutiveDayPenalty
  if (left.score !== right.score) return right.score - left.score
  return compareSlots(left.slotId, right.slotId) || left.trainer.id.localeCompare(right.trainer.id)
}

function compareCandidates(left, right) {
  return compareCandidatePriorities(left, right, left.opensTeachingSlot, right.opensTeachingSlot)
}

function scheduleStudentCounts(schedule) {
  const counts = new Map()
  for (const entry of Object.values(schedule || {}).flat()) {
    if (entry.type === 'off') continue
    counts.set(entry.studentId, (counts.get(entry.studentId) || 0) + 1)
  }
  return counts
}

function trainerLoadsForSchedule(data, schedule, schedulingState = null) {
  const state = schedulingState || buildSchedulingState(schedule)
  const workingDays = Array.isArray(data.config?.workingDays) && data.config.workingDays.length
    ? [...new Set(data.config.workingDays)].filter((day) => DAY_ORDER.has(day)).sort((left, right) => (DAY_ORDER.get(left) ?? 99) - (DAY_ORDER.get(right) ?? 99))
    : [...DAY_ORDER.keys()]
  return [...data.trainers]
    .sort((left, right) => trainerSchedulingPolicy(left).schedulingPriority - trainerSchedulingPolicy(right).schedulingPriority || left.id.localeCompare(right.id))
    .flatMap((trainer) => {
      const policy = trainerSchedulingPolicy(trainer)
      return workingDays.map((day) => {
        const teachingSlots = state.trainerSlotsByDay.get(`${trainer.id}|${day}`)?.size || 0
        return {
          trainerId: trainer.id,
          trainerName: trainer.name,
          schedulingPriority: policy.schedulingPriority,
          employmentType: policy.employmentType,
          employmentLevel: policy.employmentLevel,
          day,
          date: dateForSlot(data.weekId, day),
          teachingSlots,
          sessionCount: teachingSlots,
          studentSessions: state.trainerStudentSessionsByDay.get(`${trainer.id}|${day}`) || 0,
          target: policy.dailySessionTarget,
          dailySessionTarget: policy.dailySessionTarget,
          remainingToTarget: Math.max(0, policy.dailySessionTarget - teachingSlots),
          status: teachingSlots > policy.dailySessionTarget
              ? 'over_target'
              : teachingSlots === policy.dailySessionTarget
                ? 'target'
                : 'under_target',
        }
      })
    })
}

function studentCoverageForSchedule(data, schedule) {
  const counts = scheduleStudentCounts(schedule)
  const targetStudents = data.students.filter((student) => student.status !== 'inactive' && student.eligibleForWeek !== false && student.sessionsPerWeek > 0)
  const eligibleStudents = targetStudents.length
  const studentsWithAtLeastOne = targetStudents.filter((student) => (counts.get(student.id) || 0) > 0).length
  const fullyScheduledStudents = targetStudents.filter((student) => (counts.get(student.id) || 0) >= student.sessionsPerWeek).length
  const totalTargetSessions = targetStudents.reduce((total, student) => total + student.sessionsPerWeek, 0)
  const scheduledEntries = targetStudents.reduce((total, student) => total + Math.min(student.sessionsPerWeek, counts.get(student.id) || 0), 0)
  return {
    eligibleStudents,
    studentsWithAtLeastOne,
    fullyScheduledStudents,
    totalTargetSessions,
    scheduledEntries,
    missingSessions: Math.max(0, totalTargetSessions - scheduledEntries),
  }
}

function teachingSlotGroups(data, schedule) {
  const trainerMap = new Map(data.trainers.map((trainer) => [trainer.id, trainer]))
  const groups = []
  for (const [slotId, entries] of Object.entries(schedule || {}).sort(([left], [right]) => compareSlots(left, right))) {
    const byTrainer = new Map()
    for (const entry of Array.isArray(entries) ? entries : []) {
      if (entry.type === 'off') continue
      if (!byTrainer.has(entry.trainerId)) byTrainer.set(entry.trainerId, [])
      byTrainer.get(entry.trainerId).push(entry)
    }
    for (const [trainerId, trainingEntries] of [...byTrainer.entries()].sort(([left], [right]) => left.localeCompare(right))) {
      const trainer = trainerMap.get(trainerId)
      if (!trainer || !trainingEntries.length) continue
      groups.push({
        slotId,
        trainerId,
        trainer,
        entries: trainingEntries,
        capacity: Math.max(1, Number(trainer.slotCapacity || 1)),
      })
    }
  }
  return groups
}

function slotUtilizationForSchedule(data, schedule) {
  const groups = teachingSlotGroups(data, schedule)
  const desiredSeats = groups.reduce((total, group) => total + Math.min(2, group.capacity), 0)
  const occupiedDesiredSeats = groups.reduce((total, group) => total + Math.min(group.entries.length, Math.min(2, group.capacity)), 0)
  const pairedSlots = groups.filter((group) => group.entries.length >= 2).length
  const singleSlots = groups.filter((group) => group.entries.length === 1).length
  const fullSlots = groups.filter((group) => group.entries.length >= Math.min(2, group.capacity)).length
  return {
    teachingSlots: groups.length,
    studentSessions: groups.reduce((total, group) => total + group.entries.length, 0),
    pairedSlots,
    singleSlots,
    fullSlots,
    pairRatePercent: groups.length ? Math.round((pairedSlots / groups.length) * 1000) / 10 : 0,
    seatUtilizationPercent: desiredSeats ? Math.round((occupiedDesiredSeats / desiredSeats) * 1000) / 10 : 0,
  }
}

function candidateRecord(data, schedule, schedulingState, contractCache, student, trainer, slotId) {
  const result = candidateForSlot(data, { student, trainer, slotId, schedule, schedulingState, contractCache })
  if (!result.eligible) return null
  const contract = data.contracts.find((item) => item.id === result.contractId)
  const assigned = assignedTrainerIds(contract)
  const assignmentIndex = assigned.indexOf(trainer.id)
  return {
    slotId,
    trainer,
    contractId: result.contractId,
    assignmentOrder: assignmentIndex >= 0 ? assignmentIndex : 1000,
    trainerAssignmentWarning: result.trainerAssignmentWarning === true,
    score: generationScore({ student, contract, targetDate: result.date }),
    currentDailyLoad: result.currentDailyLoad,
    projectedDailyLoad: result.projectedDailyLoad,
    dailySessionTarget: result.dailySessionTarget,
    schedulingPriority: result.schedulingPriority,
    employmentType: result.employmentType,
    employmentLevel: result.employmentLevel,
    opensTeachingSlot: result.opensTeachingSlot,
    consecutiveDayPenalty: result.consecutiveDayPenalty,
    adjacentTeachingSlots: result.adjacentTeachingSlots,
    preferredBlockLength: result.preferredBlockLength,
    resultingBlockLength: result.resultingBlockLength,
    isolatedTeachingSlot: result.isolatedTeachingSlot,
  }
}

function feasibleCandidatesForStudent(data, schedule, schedulingState, contractCache, student) {
  const candidates = []
  for (const slotId of [...new Set(student.availableSlots || [])].sort(compareSlots)) {
    for (const trainer of [...data.trainers].sort((left, right) => left.id.localeCompare(right.id))) {
      const candidate = candidateRecord(data, schedule, schedulingState, contractCache, student, trainer, slotId)
      if (candidate) candidates.push(candidate)
    }
  }
  return candidates.sort(compareCandidates)
}

/**
 * Estimate the maximum number of sessions a learner can receive in this week
 * from the current protected workload. This is intentionally a fast,
 * optimistic preflight rather than a second global solver: it uses the
 * learner's registered slots, concrete contract dates, PT availability,
 * leave/OFF markers and live slot capacity, then enforces one session/day.
 *
 * The value is used for diagnostics only. It never reduces the requested
 * weekly target and never blocks generation, so a soft scheduling preference
 * cannot turn into a hard operational failure.
 */
function feasibilitySlotIndex(data, schedule, state = buildSchedulingState(schedule)) {
  const workingDays = Array.isArray(data.config?.workingDays) ? data.config.workingDays : []
  const workingHours = Array.isArray(data.config?.workingHours) ? data.config.workingHours.map(Number) : []
  const holidays = Array.isArray(data.config?.holidays) ? data.config.holidays : []
  const slots = new Set(data.students.flatMap((student) => Array.isArray(student.availableSlots) ? student.availableSlots : []))
  const feasible = new Set()
  for (const slotId of slots) {
    const [day, rawHour] = String(slotId).split('-')
    const hour = Number(rawHour)
    const date = dateForSlot(data.weekId, day)
    if ((workingDays.length && !workingDays.includes(day))
      || (workingHours.length && !workingHours.includes(hour))
      || holidays.includes(date)) continue
    const configuredBranchCapacity = branchSlotCapacity(data.config, data.branch.id, slotId)
    if (configuredBranchCapacity !== null && (state.branchSlotCounts.get(slotId) || 0) >= configuredBranchCapacity) continue
    if (data.trainers.some((trainer) => {
      if (!trainer || trainer.status === 'inactive' || trainer.branchId !== data.branch.id) return false
      if (trainer.employmentType === 'collaborator') {
        if (!Array.isArray(trainer.availableSlots) || !trainer.availableSlots.length || !trainer.availableSlots.includes(slotId)) return false
      } else if (trainer.availabilityMode === 'unconfigured' || !trainerIsAvailable(trainer, slotId)) return false
      if (data.leaves.some((leave) => leaveCovers(leave, trainer.id, date))) return false
      const trainerSlotKey = `${trainer.id}|${slotId}`
      if (state.offTrainerSlots.has(trainerSlotKey)) return false
      return (state.trainerSlotCounts.get(trainerSlotKey) || 0) < Math.max(1, Number(trainer.slotCapacity || 1))
    })) feasible.add(slotId)
  }
  return feasible
}

function maximumFeasibleSessionsForStudent(data, student, schedule, prebuiltState = null, feasibleSlotIds = null) {
  if (!student || student.status === 'inactive' || student.eligibleForWeek === false) return 0
  const state = prebuiltState || buildSchedulingState(schedule)
  const existingEntries = Object.values(schedule || {}).flat().filter((entry) => entry.type !== 'off' && entry.studentId === student.id)
  const existingCount = existingEntries.length
  const existingDays = state.studentDays.get(student.id) || new Set()
  const configuredDates = Array.isArray(student.validScheduleDates) && student.validScheduleDates.length
    ? new Set(student.validScheduleDates)
    : new Set(datesForWeek(data.weekId).filter((date) => data.contracts.some((contract) => contract.studentId === student.id
      && contractCanServeScheduledDate(contract, date)
      && contract.branchId === data.branch.id
      && !contractPaused(contract, date))))
  const availableDates = new Map()
  for (const slotId of [...new Set(student.availableSlots || [])].sort(compareSlots)) {
    const [day] = slotId.split('-')
    const date = dateForSlot(data.weekId, day)
    if (!configuredDates.has(date) || existingDays.has(day)) continue
    if (feasibleSlotIds ? !feasibleSlotIds.has(slotId) : !feasibilitySlotIndex(data, schedule, state).has(slotId)) continue
    availableDates.set(date, (availableDates.get(date) || 0) + 1)
  }
  // Every date has at most one session for a learner. Sorting by the number
  // of options gives a small maximum-cardinality matching for date choices.
  const additional = [...availableDates.entries()]
    .sort((left, right) => left[1] - right[1] || left[0].localeCompare(right[0]))
    .length
  const quota = Math.max(existingCount, Number(student.maxWeeklySessions || student.sessionsPerWeek || 7))
  return Math.min(7, quota, existingCount + additional)
}

function studentFeasibilityForSchedule(data, schedule, baseSchedule = schedule) {
  const counts = scheduleStudentCounts(schedule)
  const state = buildSchedulingState(baseSchedule)
  const feasibleSlotIds = feasibilitySlotIndex(data, baseSchedule, state)
  return data.students
    .filter((student) => student.status !== 'inactive' && student.eligibleForWeek !== false && Number(student.sessionsPerWeek || 0) > 0)
    .map((student) => {
      const scheduledSessions = counts.get(student.id) || 0
      const maximumFeasibleSessions = maximumFeasibleSessionsForStudent(data, student, baseSchedule, state, feasibleSlotIds)
      return {
        studentId: student.id,
        studentName: student.name,
        requestedSessions: Number(student.sessionsPerWeek || 0),
        maximumFeasibleSessions,
        scheduledSessions,
        missingSessions: Math.max(0, Number(student.sessionsPerWeek || 0) - scheduledSessions),
        impossibleSessions: Math.max(0, Number(student.sessionsPerWeek || 0) - maximumFeasibleSessions),
      }
    })
}

function matchSchedulingRound(data, schedule, students) {
  const state = buildSchedulingState(schedule)
  const contractCache = new Map()
  const candidatesByStudent = new Map(students.map((student) => [
    student.id,
    feasibleCandidatesForStudent(data, schedule, state, contractCache, student),
  ]))
  // Real feasible edges, not the raw number of submitted availability cells,
  // define scarcity. Contract end urgency breaks ties globally.
  const orderedStudents = [...students].sort((left, right) => {
    const leftCandidates = candidatesByStudent.get(left.id) || []
    const rightCandidates = candidatesByStudent.get(right.id) || []
    const leftUrgency = leftCandidates.reduce((score, candidate) => Math.max(score, candidate.score), 0)
    const rightUrgency = rightCandidates.reduce((score, candidate) => Math.max(score, candidate.score), 0)
    return leftCandidates.length - rightCandidates.length
      || rightUrgency - leftUrgency
      || left.name.localeCompare(right.name, 'vi')
      || left.id.localeCompare(right.id)
  })
  const priorityIndex = new Map(orderedStudents.map((student, index) => [student.id, index]))
  const assignments = new Map()
  const occupantsByTarget = new Map()
  const assignedStudentsByBranchSlot = new Map()
  const targetCapacity = new Map()

  for (const candidates of candidatesByStudent.values()) {
    for (const candidate of candidates) {
      const targetKey = `${candidate.trainer.id}|${candidate.slotId}`
      if (!targetCapacity.has(targetKey)) {
        const occupied = state.trainerSlotCounts.get(targetKey) || 0
        targetCapacity.set(targetKey, Math.max(0, Number(candidate.trainer.slotCapacity || 1) - occupied))
      }
    }
  }

  const setAssignment = (studentId, candidate) => {
    const previous = assignments.get(studentId)
    if (previous) {
      const previousKey = `${previous.trainer.id}|${previous.slotId}`
      occupantsByTarget.set(previousKey, (occupantsByTarget.get(previousKey) || []).filter((id) => id !== studentId))
      assignedStudentsByBranchSlot.set(previous.slotId, (assignedStudentsByBranchSlot.get(previous.slotId) || []).filter((id) => id !== studentId))
    }
    const targetKey = `${candidate.trainer.id}|${candidate.slotId}`
    assignments.set(studentId, candidate)
    occupantsByTarget.set(targetKey, [...(occupantsByTarget.get(targetKey) || []), studentId])
    assignedStudentsByBranchSlot.set(candidate.slotId, [...(assignedStudentsByBranchSlot.get(candidate.slotId) || []), studentId])
  }

  const tryAssign = (studentId, visitedStudents = new Set(), visitedTargets = new Set()) => {
    if (visitedStudents.has(studentId)) return false
    visitedStudents.add(studentId)
    // Re-rank with assignments already made in this round. Without this live
    // occupancy check, two learners evaluated from the same empty snapshot can
    // unnecessarily open two 1/2 classes instead of sharing one class.
    const rankedCandidates = [...(candidatesByStudent.get(studentId) || [])].sort((left, right) => {
      const liveOpensSlot = (candidate) => {
        const targetKey = `${candidate.trainer.id}|${candidate.slotId}`
        return (state.trainerSlotCounts.get(targetKey) || 0) + (occupantsByTarget.get(targetKey) || []).length === 0
      }
      return compareCandidatePriorities(left, right, liveOpensSlot(left), liveOpensSlot(right))
    })
    for (const candidate of rankedCandidates) {
      const targetKey = `${candidate.trainer.id}|${candidate.slotId}`
      if (visitedTargets.has(targetKey) || (targetCapacity.get(targetKey) || 0) < 1) continue
      const configuredBranchCapacity = branchSlotCapacity(data.config, data.branch.id, candidate.slotId)
      const previous = assignments.get(studentId)
      const alreadyUsesBranchSlot = previous?.slotId === candidate.slotId
      const projectedBranchLoad = (state.branchSlotCounts.get(candidate.slotId) || 0)
        + (assignedStudentsByBranchSlot.get(candidate.slotId) || []).length
        + (alreadyUsesBranchSlot ? 0 : 1)
      if (configuredBranchCapacity !== null && projectedBranchLoad > configuredBranchCapacity) continue
      const occupants = occupantsByTarget.get(targetKey) || []
      if (occupants.length < targetCapacity.get(targetKey)) {
        setAssignment(studentId, candidate)
        return true
      }
      const movable = [...occupants].sort((left, right) => {
        const flexibility = (candidatesByStudent.get(right)?.length || 0) - (candidatesByStudent.get(left)?.length || 0)
        return flexibility || (priorityIndex.get(right) || 0) - (priorityIndex.get(left) || 0) || right.localeCompare(left)
      })
      for (const occupantId of movable) {
        if (visitedStudents.has(occupantId)) continue
        const nextVisitedTargets = new Set(visitedTargets)
        nextVisitedTargets.add(targetKey)
        if (!tryAssign(occupantId, visitedStudents, nextVisitedTargets)) continue
        setAssignment(studentId, candidate)
        return true
      }
    }
    return false
  }

  for (const student of orderedStudents) tryAssign(student.id, new Set(), new Set())
  return orderedStudents
    .filter((student) => assignments.has(student.id))
    .map((student) => ({ student, candidate: assignments.get(student.id) }))
}

function autoEntryForCandidate(data, student, candidate, template = null) {
  return {
    studentId: student.id,
    trainerId: candidate.trainer.id,
    contractId: candidate.contractId,
    branchId: data.branch.id,
    type: 'training',
    source: template?.source || 'auto_v4',
    ...(candidate.trainerAssignmentWarning ? { trainerAssignmentWarning: true } : {}),
  }
}

function scheduleWithEntry(schedule, slotId, entry) {
  return { ...schedule, [slotId]: [...(schedule[slotId] || []), entry] }
}

function scheduleWithoutEntry(schedule, slotId, entry) {
  const values = schedule[slotId] || []
  const index = values.indexOf(entry)
  if (index < 0) return schedule
  const remaining = [...values.slice(0, index), ...values.slice(index + 1)]
  if (remaining.length) return { ...schedule, [slotId]: remaining }
  const next = { ...schedule }
  delete next[slotId]
  return next
}

function repairTargetKey(candidate) {
  return `${candidate.trainer.id}|${candidate.slotId}`
}

function boundedRepairCandidates(data, student, schedule, forbiddenTargets, budget) {
  const candidates = []
  const state = buildSchedulingState(schedule)
  const contractCache = new Map()
  const trainers = [...data.trainers].sort((left, right) => trainerSchedulingPolicy(left).schedulingPriority - trainerSchedulingPolicy(right).schedulingPriority || left.id.localeCompare(right.id))
  const slots = [...new Set(student.availableSlots || [])].sort(compareSlots)
  const offset = Number(budget.offset || 0) % Math.max(1, slots.length)
  search: for (const slotId of [...slots.slice(offset), ...slots.slice(0, offset)]) {
    for (const trainer of trainers) {
      if (budget.nodes >= budget.limit) break search
      budget.nodes += 1
      const candidate = candidateRecord(data, schedule, state, contractCache, student, trainer, slotId)
      if (!candidate || forbiddenTargets.has(repairTargetKey(candidate))) continue
      candidates.push(candidate)
      // Direct seats are only an escape route for a displaced entry. A bounded
      // best-candidate set keeps repair latency stable on large branches.
      // Keep the best candidates across the whole bounded scan, not just the
      // first 80 chronological cells (which starved late-week opportunities).
      if (candidates.length > MAX_REPAIR_DIRECT_CANDIDATES * 2) {
        candidates.sort(compareCandidates)
        candidates.length = MAX_REPAIR_DIRECT_CANDIDATES
      }
    }
  }
  return candidates.sort(compareCandidates).slice(0, MAX_REPAIR_DIRECT_CANDIDATES)
}

/**
 * Place one more learner session by relocating only mutable auto-generated
 * entries. Every recursive step removes an existing entry before validating
 * its replacement, so quota, one-session-per-day, PT availability, leave/OFF,
 * exact contract dates and branch rules continue to be enforced by the same
 * candidateForSlot path used by normal generation.
 */
function repairMove(student, origin, candidate) {
  return {
    studentId: student.id,
    studentName: student.name || '',
    fromSlotId: origin?.slotId || null,
    fromTrainerId: origin?.entry?.trainerId || null,
    toSlotId: candidate.slotId,
    toTrainerId: candidate.trainer.id,
  }
}

function studentHistoricalDeficit(student) {
  return Math.max(0, Number(
    student?.consecutiveMissingWeeks
      ?? student?.missingWeeks
      ?? student?.priorWeekMissingSessions
      ?? 0,
  ) || 0)
}

function studentContractUrgency(data, student) {
  const reference = Date.parse(`${data.weekId}T00:00:00.000Z`)
  const endDates = data.contracts
    .filter((contract) => contract.studentId === student.id
      && contract.branchId === data.branch.id
      && ['active', 'future'].includes(String(contract.status || 'active').toLowerCase()))
    .map((contract) => Date.parse(`${storedDate(contract.endDate)}T00:00:00.000Z`))
    .filter(Number.isFinite)
  if (!endDates.length || !Number.isFinite(reference)) return Number.MAX_SAFE_INTEGER
  return Math.max(0, Math.floor((Math.min(...endDates) - reference) / 86400000))
}

function orderedRescueStudents(data, schedule, students, localRemaining) {
  const counts = scheduleStudentCounts(schedule)
  const state = buildSchedulingState(schedule)
  const feasibleSlotIds = feasibilitySlotIndex(data, schedule, state)
  return students
    .filter((student) => (localRemaining.get(student.id) || 0) > 0)
    .map((student) => {
      const scheduled = counts.get(student.id) || 0
      const maximumFeasible = maximumFeasibleSessionsForStudent(data, student, schedule, state, feasibleSlotIds)
      return {
        student,
        scheduled,
        missing: localRemaining.get(student.id) || 0,
        feasibleAdditional: Math.max(0, maximumFeasible - scheduled),
        historicalDeficit: studentHistoricalDeficit(student),
        contractUrgency: studentContractUrgency(data, student),
      }
    })
    .sort((left, right) => Number(left.scheduled > 0) - Number(right.scheduled > 0)
      || right.missing - left.missing
      || left.feasibleAdditional - right.feasibleAdditional
      || right.historicalDeficit - left.historicalDeficit
      || left.contractUrgency - right.contractUrgency
      || (left.student.availableSlots?.length || 0) - (right.student.availableSlots?.length || 0)
      || left.student.name.localeCompare(right.student.name, 'vi')
      || left.student.id.localeCompare(right.student.id))
    .map((profile) => profile.student)
}

function rescueOutcomeScore(data, schedule, students, remainingByStudent, relocations) {
  const state = buildSchedulingState(schedule)
  const counts = scheduleStudentCounts(schedule)
  const feasibleSlotIds = feasibilitySlotIndex(data, schedule, state)
  const lookahead = orderedRescueStudents(data, schedule, students, remainingByStudent)
    .slice(0, MAX_RESCUE_LOOKAHEAD_STUDENTS)
  let futureRescuableSessions = 0
  let futureCompletableStudents = 0
  let uncoveredStudentsWithAPath = 0
  for (const student of lookahead) {
    const remaining = Math.max(0, Number(remainingByStudent.get(student.id) || 0))
    if (!remaining) continue
    const scheduled = counts.get(student.id) || 0
    const maximumFeasible = maximumFeasibleSessionsForStudent(data, student, schedule, state, feasibleSlotIds)
    const feasibleAdditional = Math.max(0, maximumFeasible - scheduled)
    futureRescuableSessions += Math.min(remaining, feasibleAdditional)
    if (feasibleAdditional >= remaining) futureCompletableStudents += 1
    if (scheduled === 0 && feasibleAdditional > 0) uncoveredStudentsWithAPath += 1
  }
  const utilization = slotUtilizationForSchedule(data, schedule)
  const supportAssignments = Object.values(schedule).flat().filter((entry) => entry.type !== 'off' && entry.trainerAssignmentWarning === true).length
  return [
    uncoveredStudentsWithAPath,
    futureRescuableSessions,
    futureCompletableStudents,
    utilization.pairedSlots,
    -utilization.singleSlots,
    -supportAssignments,
    -relocations,
  ]
}

function compareScoreVectors(left, right) {
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const difference = Number(right[index] || 0) - Number(left[index] || 0)
    if (difference) return difference
  }
  return 0
}

function repairAlternativesForStudent(data, studentMap, student, schedule, budget) {
  const alternatives = []
  const forbiddenRootTargets = new Set()
  while (alternatives.length < MAX_RESCUE_PLAN_CANDIDATES && budget.nodes < budget.limit) {
    const repaired = tryRepairPlacement(
      data,
      studentMap,
      student,
      schedule,
      null,
      MAX_REPAIR_CHAIN_DEPTH,
      new Set(),
      forbiddenRootTargets,
      budget,
    )
    if (!repaired) break
    alternatives.push(repaired)
    const rootMove = [...repaired.moves].reverse().find((move) => move.studentId === student.id)
    if (!rootMove?.toSlotId || !rootMove?.toTrainerId) break
    const targetKey = `${rootMove.toTrainerId}|${rootMove.toSlotId}`
    if (forbiddenRootTargets.has(targetKey)) break
    forbiddenRootTargets.add(targetKey)
  }
  return alternatives
}

function tryRepairPlacement(data, studentMap, student, schedule, origin, depth, visitedStudents, forbiddenTargets, budget) {
  if (!student || visitedStudents.has(student.id) || budget.nodes >= budget.limit) return null
  const nextVisitedStudents = new Set(visitedStudents)
  nextVisitedStudents.add(student.id)

  const directCandidates = boundedRepairCandidates(data, student, schedule, forbiddenTargets, budget)
  for (const candidate of directCandidates) {
    return {
      schedule: scheduleWithEntry(schedule, candidate.slotId, autoEntryForCandidate(data, student, candidate, origin?.entry || null)),
      relocations: 0,
      moves: [repairMove(student, origin, candidate)],
    }
  }
  if (depth < 1) return null

  const displacementAttempts = []
  const displacementContractCache = new Map()
  displacementSearch: for (const slotId of [...new Set(student.availableSlots || [])].sort(compareSlots)) {
    for (const trainer of [...data.trainers].sort((left, right) => left.id.localeCompare(right.id))) {
      if (budget.nodes >= budget.limit) break displacementSearch
      const targetKey = `${trainer.id}|${slotId}`
      if (forbiddenTargets.has(targetKey)) continue
      const branchEntries = (schedule[slotId] || []).filter((entry) => entry.type !== 'off')
      const trainerEntries = branchEntries.filter((entry) => entry.trainerId === trainer.id)
      const branchCapacity = branchSlotCapacity(data.config, data.branch.id, slotId)
      const branchFull = branchCapacity !== null && branchEntries.length >= branchCapacity
      if (!branchFull && trainerEntries.length < Math.max(1, Number(trainer.slotCapacity || 1))) continue
      const movableEntries = (branchFull ? branchEntries : trainerEntries).filter((entry) => entry.source === 'auto_v4'
        && entry.isLocked !== true
        && studentMap.has(entry.studentId)
        && !nextVisitedStudents.has(entry.studentId))
      for (const occupantEntry of movableEntries) {
        if (budget.nodes >= budget.limit) break displacementSearch
        const withoutOccupant = scheduleWithoutEntry(schedule, slotId, occupantEntry)
        budget.nodes += 1
        const candidate = candidateRecord(data, withoutOccupant, buildSchedulingState(withoutOccupant), displacementContractCache, student, trainer, slotId)
        if (!candidate) continue
        displacementAttempts.push({
          candidate,
          occupantEntry,
          occupantStudent: studentMap.get(occupantEntry.studentId),
          schedule: withoutOccupant,
        })
      }
    }
  }

  displacementAttempts.sort((left, right) => compareCandidates(left.candidate, right.candidate)
    || (right.occupantStudent.availableSlots?.length || 0) - (left.occupantStudent.availableSlots?.length || 0)
    || left.occupantStudent.id.localeCompare(right.occupantStudent.id))

  for (const attempt of displacementAttempts.slice(0, MAX_REPAIR_DISPLACEMENT_CANDIDATES)) {
    if (budget.nodes >= budget.limit) break
    const targetKey = repairTargetKey(attempt.candidate)
    const nextForbiddenTargets = new Set(forbiddenTargets)
    nextForbiddenTargets.add(targetKey)
    const relocated = tryRepairPlacement(
      data,
      studentMap,
      attempt.occupantStudent,
      // Reserve the newly freed seat BEFORE moving its occupant. Otherwise
      // the relocation can consume the same branch capacity via another PT.
      scheduleWithEntry(attempt.schedule, attempt.candidate.slotId, autoEntryForCandidate(data, student, attempt.candidate, origin?.entry || null)),
      { entry: attempt.occupantEntry, slotId: attempt.candidate.slotId },
      depth - 1,
      nextVisitedStudents,
      nextForbiddenTargets,
      budget,
    )
    if (!relocated) continue
    return {
      schedule: relocated.schedule,
      relocations: relocated.relocations + 1,
      moves: [...relocated.moves, repairMove(student, origin, attempt.candidate)],
    }
  }
  return null
}

function repairCoverageWithRelocations(data, inputSchedule, students, remainingByStudent, options = {}) {
  let schedule = Object.fromEntries(Object.entries(inputSchedule).map(([slotId, entries]) => [slotId, [...entries]]))
  const studentMap = new Map(students.map((student) => [student.id, student]))
  const localRemaining = new Map(students.map((student) => [student.id, Math.max(0, Number(remainingByStudent.get(student.id) || 0))]))
  const maxAssignments = Math.max(0, Number(options.maxAssignments ?? MAX_DRAFT_ENTRIES))
  const budget = { nodes: 0, limit: Math.max(1, Number(options.maxSearchNodes || MAX_REPAIR_SEARCH_NODES)), offset: Number(options.searchOffset || 0) }
  const assignedStudentIds = []
  const swapTrace = []
  let relocations = 0
  let evaluatedPlans = 0
  let learnerSearchLimitReached = false
  let progress = true

  while (progress && assignedStudentIds.length < maxAssignments && budget.nodes < budget.limit) {
    progress = false
    const missingStudents = orderedRescueStudents(data, schedule, students, localRemaining)
    const offset = budget.offset % Math.max(1, missingStudents.length)
    const fairStudents = [...missingStudents.slice(offset), ...missingStudents.slice(0, offset)]
      .sort((a, b) => Number((scheduleStudentCounts(schedule).get(a.id) || 0) > 0) - Number((scheduleStudentCounts(schedule).get(b.id) || 0) > 0))
    for (const student of fairStudents) {
      if (assignedStudentIds.length >= maxAssignments || budget.nodes >= budget.limit) break
      // Allocate a per-learner slice, leaving search for other missing people.
      const localBudget = { nodes: 0, limit: Math.min(budget.limit - budget.nodes, Math.max(600, Math.floor(budget.limit / Math.max(1, fairStudents.length)))), offset: budget.offset }
      const alternatives = repairAlternativesForStudent(data, studentMap, student, schedule, localBudget)
      budget.nodes += localBudget.nodes
      learnerSearchLimitReached ||= localBudget.nodes >= localBudget.limit
      evaluatedPlans += alternatives.length
      const nextRemaining = new Map(localRemaining)
      nextRemaining.set(student.id, Math.max(0, (nextRemaining.get(student.id) || 0) - 1))
      const repaired = alternatives
        .map((alternative) => ({
          ...alternative,
          rescueScore: rescueOutcomeScore(data, alternative.schedule, students, nextRemaining, alternative.relocations),
        }))
        .sort((left, right) => compareScoreVectors(left.rescueScore, right.rescueScore)
          || JSON.stringify(left.moves).localeCompare(JSON.stringify(right.moves)))[0]
      if (!repaired) continue
      schedule = repaired.schedule
      localRemaining.set(student.id, Math.max(0, (localRemaining.get(student.id) || 0) - 1))
      assignedStudentIds.push(student.id)
      relocations += repaired.relocations
      swapTrace.push(...repaired.moves)
      progress = true
    }
  }

  return {
    schedule,
    assignedStudentIds,
    assignments: assignedStudentIds.length,
    relocations,
    searchNodes: budget.nodes,
    searchLimitReached: budget.nodes >= budget.limit || learnerSearchLimitReached,
    evaluatedPlans,
    swapTrace,
  }
}

function hasThreeConsecutiveTrainingDays(days) {
  const indexes = new Set([...(days || [])].map((day) => DAY_ORDER.get(day)).filter(Number.isInteger))
  return [...indexes].some((index) => indexes.has(index + 1) && indexes.has(index + 2))
}

function compactPairedSlots(data, inputSchedule) {
  const schedule = Object.fromEntries(Object.entries(inputSchedule).map(([slotId, entries]) => [slotId, [...entries]]))
  const studentsById = new Map(data.students.map((student) => [student.id, student]))
  let changed = true
  let moves = 0
  let commonSearchNodes = 0
  while (changed && moves < MAX_DRAFT_ENTRIES) {
    changed = false
    const groups = teachingSlotGroups(data, schedule)
    const sources = groups.filter((group) => group.entries.length === 1
      && group.entries[0].source === 'auto_v4'
      && group.entries[0].isLocked !== true)
    const targets = groups.filter((group) => group.entries.length === 1 && group.capacity >= 2)
    for (const source of sources) {
      const sourceEntry = source.entries[0]
      const student = studentsById.get(sourceEntry.studentId)
      if (!student) continue
      const beforeDays = buildSchedulingState(schedule).studentDays.get(student.id) || new Set()
      const beforeConsecutive = hasThreeConsecutiveTrainingDays(beforeDays)
      const temporary = Object.fromEntries(Object.entries(schedule).map(([slotId, entries]) => [
        slotId,
        entries.filter((entry) => !(slotId === source.slotId
          && entry.studentId === sourceEntry.studentId
          && entry.trainerId === sourceEntry.trainerId
          && entry.source === 'auto_v4')),
      ]).filter(([, entries]) => entries.length))
      const temporaryState = buildSchedulingState(temporary)
      const candidates = targets
        .filter((target) => target.slotId !== source.slotId || target.trainerId !== source.trainerId)
        .map((target) => candidateRecord(data, temporary, temporaryState, new Map(), student, target.trainer, target.slotId))
        .filter(Boolean)
        .filter((candidate) => {
          const nextDays = new Set(temporaryState.studentDays.get(student.id) || [])
          nextDays.add(candidate.slotId.split('-')[0])
          // Pairing is a strong preference, but compaction never creates an
          // avoidable third consecutive training day. The regular assignment
          // pass can still use one when it is the only way to fulfil demand.
          return beforeConsecutive || !hasThreeConsecutiveTrainingDays(nextDays)
        })
        .sort(compareCandidates)
      const selected = candidates[0]
      if (!selected) continue
      schedule[source.slotId] = temporary[source.slotId] || []
      if (!schedule[source.slotId].length) delete schedule[source.slotId]
      schedule[selected.slotId] = [...(temporary[selected.slotId] || []), autoEntryForCandidate(data, student, selected, sourceEntry)]
      moves += 1
      changed = true
      break
    }
    // Two singles may share a third, currently empty, slot even when neither
    // learner can attend the other's original slot. Explore that intersection.
    if (!changed) {
      commonSearch: for (let i = 0; i < sources.length; i += 1) for (let j = i + 1; j < sources.length; j += 1) {
        if (commonSearchNodes >= 3000) break commonSearch
        const left = sources[i], right = sources[j]
        const a = studentsById.get(left.entries[0].studentId), b = studentsById.get(right.entries[0].studentId)
        if (!a || !b || a.id === b.id) continue
        const temp = scheduleWithoutEntry(scheduleWithoutEntry(schedule, left.slotId, left.entries[0]), right.slotId, right.entries[0])
        const commonSlots = (a.availableSlots || []).filter((slot) => (b.availableSlots || []).includes(slot)).sort(compareSlots)
        for (const slotId of commonSlots) for (const trainer of data.trainers) {
          commonSearchNodes += 1
          if (commonSearchNodes > 3000) break commonSearch
          if (trainer.slotCapacity < 2 || (temp[slotId] || []).some((entry) => entry.trainerId === trainer.id)) continue
          const state = buildSchedulingState(temp)
          const ca = candidateRecord(data, temp, state, new Map(), a, trainer, slotId)
          if (!ca) continue
          const withA = scheduleWithEntry(temp, slotId, autoEntryForCandidate(data, a, ca))
          const cb = candidateRecord(data, withA, buildSchedulingState(withA), new Map(), b, trainer, slotId)
          if (!cb) continue
          const oldState = buildSchedulingState(schedule)
          if ([a, b].some((student) => !hasThreeConsecutiveTrainingDays(oldState.studentDays.get(student.id))
            && hasThreeConsecutiveTrainingDays(new Set([...(state.studentDays.get(student.id) || []), slotId.split('-')[0]])))) continue
          const merged = scheduleWithEntry(withA, slotId, autoEntryForCandidate(data, b, cb))
          Object.keys(schedule).forEach((key) => delete schedule[key])
          Object.assign(schedule, merged)
          moves += 2
          changed = true
          break commonSearch
        }
      }
    }
  }
  return { schedule, moves }
}

function blockersForStudent(data, student, schedule, schedulingState, contractCache, capacityReached) {
  const reasons = new Set()
  const suggestedSlots = new Set()
  const compatibleSlotIds = new Set()
  const pairedOpportunitySlotIds = new Set()
  const trainers = [...data.trainers].sort((left, right) => left.id.localeCompare(right.id))
  const rawSlots = Array.isArray(student.availableSlots) ? [...new Set(student.availableSlots)].sort(compareSlots) : []
  const diagnostics = {
    candidateSlotCount: rawSlots.length,
    learnerAvailabilityCount: 0,
    contractValidDateCount: 0,
    trainerCompatibleSlotCount: 0,
    pairedSeatOpportunityCount: 0,
    blockedByTrainerOffCount: 0,
    blockedByTrainerAvailabilityCount: 0,
    blockedByTrainerLeaveCount: 0,
    blockedByTrainerCapacityCount: 0,
    blockedByBranchCapacityCount: 0,
    blockedByLearnerDayCount: 0,
  }
  const candidateSlots = []
  const weekDates = datesForWeek(data.weekId)
  const weekStart = weekDates[0]
  const weekEnd = weekDates[weekDates.length - 1]
  const contracts = data.contracts.filter((contract) => contract.studentId === student.id)
  const branchContracts = contracts.filter((contract) => !contract.branchId || contract.branchId === data.branch.id)
  const operationalContracts = branchContracts.filter((contract) => ['active', 'future'].includes(String(contract.status || 'active').toLowerCase()))
  const validDates = new Set(Array.isArray(student.validScheduleDates) && student.validScheduleDates.length
    ? student.validScheduleDates
    : weekDates.filter((date) => operationalContracts.some((contract) => contractCanServeScheduledDate(contract, date) && !contractPaused(contract, date))))
  const nearestEndDate = branchContracts
    .map((contract) => storedDate(contract.endDate))
    .filter(Boolean)
    .sort()[0] || null
  const latestEndDate = branchContracts
    .map((contract) => storedDate(contract.endDate))
    .filter(Boolean)
    .sort()
    .pop() || null
  const contractQuotaRemaining = branchContracts.reduce((total, contract) => total + Math.max(0, Number(contract.remainingEntitlementSessions
    ?? (Number(contract.totalSessions || 0) - Number(contract.usedSessions || 0)))), 0)
  const contractStatus = !branchContracts.length
    ? 'missing'
    : branchContracts.every((contract) => {
      const status = String(contract.status || '').toLowerCase()
      const end = storedDate(contract.endDate)
      return status === 'expired' || (end && end < weekStart)
    })
      ? 'expired'
      : !contractQuotaRemaining
        ? 'quota_exhausted'
        : !validDates.size
          ? (branchContracts.some((contract) => contractPaused(contract, weekStart)) ? 'paused' : 'not_started_or_ended')
          : latestEndDate && latestEndDate <= weekEnd ? 'expiring' : 'valid'

  if (student.availabilityStatus && ['submitted', 'locked', 'inherited', 'recurring'].includes(student.availabilityStatus)) {
    diagnostics.learnerAvailabilityCount = rawSlots.length
  } else if (!rawSlots.length) {
    reasons.add('AVAILABILITY_NOT_SUBMITTED')
  } else {
    reasons.add('AVAILABILITY_NOT_SUBMITTED')
  }

  for (const slotId of rawSlots) {
    const [day, rawHour] = String(slotId).split('-')
    const date = dateForSlot(data.weekId, day)
    if (validDates.has(date)) diagnostics.contractValidDateCount += 1
    const slotResult = {
      slotId,
      date,
      hour: Number(rawHour),
      learnerAvailable: true,
      availableTrainerIds: [],
      blockedTrainerIds: [],
      blockerCodes: [],
    }
    for (const trainer of trainers) {
      const result = candidateForSlot(data, { student, trainer, slotId, schedule, schedulingState, contractCache })
      if (result.eligible) {
        slotResult.availableTrainerIds.push(trainer.id)
        suggestedSlots.add(slotId)
        compatibleSlotIds.add(slotId)
        const currentCount = schedulingState.trainerSlotCounts.get(`${trainer.id}|${slotId}`) || 0
        if (currentCount === 1 && Number(trainer.slotCapacity || 1) >= 2) pairedOpportunitySlotIds.add(slotId)
      } else {
        slotResult.blockedTrainerIds.push(trainer.id)
        result.reasons.forEach((reason) => {
          reasons.add(reason)
          slotResult.blockerCodes.push(reason)
          if (reason === 'TRAINER_OFF_CONFLICT') diagnostics.blockedByTrainerOffCount += 1
          if (reason === 'TRAINER_AVAILABILITY_UNCONFIGURED' || reason === 'OUTSIDE_TRAINER_AVAILABILITY') diagnostics.blockedByTrainerAvailabilityCount += 1
          if (reason === 'TRAINER_ON_LEAVE') diagnostics.blockedByTrainerLeaveCount += 1
          if (reason === 'TRAINER_CAPACITY_EXCEEDED') diagnostics.blockedByTrainerCapacityCount += 1
          if (reason === 'BRANCH_CAPACITY_REACHED') diagnostics.blockedByBranchCapacityCount += 1
          if (reason === 'STUDENT_MULTIPLE_SESSIONS_PER_DAY') diagnostics.blockedByLearnerDayCount += 1
        })
      }
    }
    slotResult.availableTrainerIds = [...new Set(slotResult.availableTrainerIds)].slice(0, 5)
    slotResult.blockedTrainerIds = [...new Set(slotResult.blockedTrainerIds)].slice(0, 5)
    slotResult.blockerCodes = [...new Set(slotResult.blockerCodes)].sort()
    candidateSlots.push(slotResult)
  }
  diagnostics.trainerCompatibleSlotCount = compatibleSlotIds.size
  diagnostics.pairedSeatOpportunityCount = pairedOpportunitySlotIds.size

  if (rawSlots.length && !diagnostics.contractValidDateCount) {
    reasons.add('NO_LEARNER_SLOT_ON_VALID_CONTRACT_DATE')
    if (contractStatus === 'expired') reasons.add(latestEndDate && latestEndDate >= weekStart ? 'CONTRACT_EXPIRES_DURING_WEEK' : 'CONTRACT_EXPIRED_BEFORE_WEEK')
    if (contractStatus === 'quota_exhausted') reasons.add('CONTRACT_SESSION_QUOTA_EXCEEDED')
  }
  if (diagnostics.learnerAvailabilityCount > 0 && diagnostics.trainerCompatibleSlotCount === 0 && diagnostics.contractValidDateCount > 0) {
    if (diagnostics.blockedByBranchCapacityCount > 0 && diagnostics.blockedByBranchCapacityCount >= diagnostics.blockedByTrainerCapacityCount) reasons.add('BRANCH_CAPACITY_REACHED')
    else if (diagnostics.blockedByTrainerOffCount > 0 && diagnostics.blockedByTrainerOffCount >= diagnostics.blockedByTrainerCapacityCount) reasons.add('ALL_TRAINERS_OFF')
    else if (diagnostics.blockedByTrainerCapacityCount > 0) reasons.add('ALL_MATCHING_TRAINERS_FULL')
    else if (diagnostics.blockedByTrainerLeaveCount > 0 && diagnostics.blockedByTrainerLeaveCount >= diagnostics.blockedByTrainerAvailabilityCount) reasons.add('TRAINER_ON_LEAVE')
    else if (diagnostics.blockedByTrainerAvailabilityCount > 0) reasons.add('NO_AVAILABLE_TRAINER_IN_LEARNER_SLOTS')
  }
  if (capacityReached) reasons.add('DRAFT_CAPACITY_REACHED')

  let primaryReasonCode = 'STUDENT_UNSCHEDULED'
  let blockerCategory = 'optimizer'
  let actionCode = 'RERUN_OPTIMIZER'
  if (!diagnostics.learnerAvailabilityCount) {
    primaryReasonCode = 'AVAILABILITY_NOT_SUBMITTED'
    blockerCategory = 'learner_availability'
    actionCode = 'EDIT_STUDENT_AVAILABILITY'
  } else if (!diagnostics.contractValidDateCount) {
    primaryReasonCode = reasons.has('CONTRACT_SESSION_QUOTA_EXCEEDED') ? 'CONTRACT_SESSION_QUOTA_EXCEEDED'
      : reasons.has('CONTRACT_EXPIRES_DURING_WEEK') ? 'CONTRACT_EXPIRES_DURING_WEEK'
        : reasons.has('CONTRACT_EXPIRED_BEFORE_WEEK') ? 'CONTRACT_EXPIRED_BEFORE_WEEK'
          : reasons.has('CONTRACT_PAUSED') ? 'CONTRACT_PAUSED' : 'ACTIVE_CONTRACT_NOT_FOUND'
    blockerCategory = 'contract'
    actionCode = primaryReasonCode === 'CONTRACT_SESSION_QUOTA_EXCEEDED' ? 'REVIEW_CONTRACT_QUOTA' : 'REVIEW_CONTRACT_DATES'
  } else if (diagnostics.trainerCompatibleSlotCount === 0) {
    primaryReasonCode = reasons.has('BRANCH_CAPACITY_REACHED') ? 'BRANCH_CAPACITY_REACHED'
      : reasons.has('ALL_TRAINERS_OFF') ? 'ALL_TRAINERS_OFF'
        : reasons.has('ALL_MATCHING_TRAINERS_FULL') ? 'ALL_MATCHING_TRAINERS_FULL'
          : reasons.has('TRAINER_ON_LEAVE') ? 'TRAINER_ON_LEAVE'
            : reasons.has('TRAINER_AVAILABILITY_UNCONFIGURED') ? 'TRAINER_AVAILABILITY_UNCONFIGURED'
              : 'NO_AVAILABLE_TRAINER_IN_LEARNER_SLOTS'
    blockerCategory = primaryReasonCode === 'BRANCH_CAPACITY_REACHED' ? 'branch_capacity' : 'trainer_capacity'
    actionCode = primaryReasonCode === 'BRANCH_CAPACITY_REACHED' ? 'OPEN_OTHER_SLOT' : 'ADD_TRAINER_AVAILABILITY'
  } else if (suggestedSlots.size > 0) {
    primaryReasonCode = 'OPTIMIZER_GAP'
    blockerCategory = 'optimizer'
    actionCode = 'RERUN_OPTIMIZER'
  }

  const candidateRank = (slot) => (slot.availableTrainerIds.length ? 0 : slot.blockerCodes.length ? 1 : 2)
  candidateSlots.sort((left, right) => candidateRank(left) - candidateRank(right) || compareSlots(left.slotId, right.slotId))
  return {
    reasonCodes: [...reasons].sort(),
    suggestedSlots: [...suggestedSlots].sort(compareSlots).slice(0, 5),
    primaryReasonCode,
    blockerCategory,
    actionCode,
    diagnostics: {
      ...diagnostics,
      contractStatus,
      nearestContractEndDate: nearestEndDate,
      latestContractEndDate: latestEndDate,
      contractQuotaRemaining,
      validDates: [...validDates].sort(),
      weekStart,
      weekEnd,
    },
    candidateSlots: candidateSlots.slice(0, 8),
  }
}

function publishedSessionSlotId(week, session) {
  const date = storedDate(session?.date)
  const storedSessionHour = Number(session?.hour)
  const legacyIdHour = Number(String(session?.id || '').split('-')[1])
  const hour = Number.isInteger(storedSessionHour) && storedSessionHour >= 0 && storedSessionHour <= 23
    ? storedSessionHour
    : legacyIdHour
  if (!date || !Number.isInteger(hour) || hour < 0 || hour > 23) return null
  const start = Date.parse(`${week}T00:00:00.000Z`)
  const target = Date.parse(`${date}T00:00:00.000Z`)
  const dayIndex = Math.floor((target - start) / 86400000)
  const day = [...DAY_ORDER.keys()][dayIndex]
  return day && dateForSlot(week, day) === date ? `${day}-${hour}` : null
}

function slotIsPast(week, slotId, now = Date.now()) {
  const [day, hour] = String(slotId).split('-')
  return Date.parse(`${dateForSlot(week, day)}T${String(hour).padStart(2, '0')}:00:00+07:00`) < now
}

function protectedFromOptimizer(entry) {
  return entry.type === 'off' || entry.isLocked === true || entry.source === 'manual_v2'
    || entry.source === 'published_existing' || entry.availabilityOverride === true
}

function mergePublishedSessions(data, schedule, warnings) {
  const retainedStatuses = new Set(['scheduled', 'rescheduled', 'completed', 'attended', 'no_show'])
  for (const session of [...(data.sessions || [])].sort((left, right) => String(left.id || '').localeCompare(String(right.id || '')))) {
    if (!retainedStatuses.has(String(session.status || '').toLowerCase()) && session.billingStatus !== 'charged') continue
    const slotId = publishedSessionSlotId(data.weekId, session)
    if (!slotId || !session.studentId || !session.trainerId) continue
    const values = schedule[slotId] || []
    if (values.some((entry) => entry.type !== 'off' && entry.studentId === session.studentId)) continue
    let contractId = session.contractId || ''
    if (!contractId) {
      const date = storedDate(session.date)
      const matches = data.contracts.filter((contract) => contract.studentId === session.studentId
        && contract.branchId === data.branch.id
        && contractCanServeScheduledDate(contract, date)
        && !contractPaused(contract, date))
      if (matches.length === 1) contractId = matches[0].id
    }
    if (!contractId) {
      warnings.push({ code: 'PUBLISHED_SESSION_CONTRACT_REQUIRED', sessionId: session.id, studentId: session.studentId })
      continue
    }
    if (scheduleEntryCount(schedule) >= MAX_DRAFT_ENTRIES || scheduleDocumentEntryCount(schedule) >= MAX_DRAFT_DOCUMENT_ENTRIES) {
      warnings.push({ code: 'DRAFT_CAPACITY_REACHED', entryCount: scheduleEntryCount(schedule), maxEntries: MAX_DRAFT_ENTRIES })
      break
    }
    const resolvedContract = data.contracts.find((contract) => contract.id === contractId)
    const assigned = assignedTrainerIds(resolvedContract)
    const trainerAssignmentWarning = session.trainerAssignmentWarning === true
      || (assigned.length > 0 && !assigned.includes(session.trainerId))
    schedule[slotId] = [...values, {
      studentId: session.studentId,
      trainerId: session.trainerId,
      contractId,
      branchId: data.branch.id,
      type: 'training',
      source: 'published_existing',
      ...(trainerAssignmentWarning ? { trainerAssignmentWarning: true } : {}),
      ...((session.billingStatus === 'charged' || ['completed', 'attended', 'no_show'].includes(session.status)) ? { isLocked: true } : {}),
    }]
  }
}

function generateScheduleAttempt(data) {
  const mode = data.generationMode || 'optimize'
  const schedule = {}
  for (const [slotId, entries] of Object.entries(data.schedule || {})) {
    const retained = mode === 'supplement' || mode === 'continue' ? entries : entries.filter(protectedFromOptimizer)
    if (retained.length) schedule[slotId] = retained
  }
  const warnings = data.trainers
    .filter((trainer) => trainer.availabilityMode === 'unconfigured')
    .map((trainer) => ({ code: 'TRAINER_AVAILABILITY_UNCONFIGURED', trainerId: trainer.id }))
  // A previously published learner session is real workload. Keep it in the
  // next draft so it contributes once to coverage and to the PT's unique
  // trainer/date/hour load instead of being silently replaced or double-counted.
  mergePublishedSessions(data, schedule, warnings)
  // This protected snapshot is used only for diagnostics. It lets the UI
  // explain whether a missing session is caused by input capacity or by the
  // optimizer, without counting newly generated entries as "available" slots.
  const feasibilityBaseSchedule = Object.fromEntries(Object.entries(schedule).map(([slotId, entries]) => [slotId, [...entries]]))
  let entryCount = scheduleEntryCount(schedule)
  let capacityReached = entryCount >= MAX_DRAFT_ENTRIES || scheduleDocumentEntryCount(schedule) >= MAX_DRAFT_DOCUMENT_ENTRIES
  const scheduledCounts = scheduleStudentCounts(schedule)
  const students = [...data.students]
    .filter((student) => student.status !== 'inactive' && student.eligibleForWeek !== false && student.sessionsPerWeek > 0)
    .sort((left, right) => left.name.localeCompare(right.name, 'vi') || left.id.localeCompare(right.id))
  const remainingByStudent = new Map(students.map((student) => [student.id, Math.max(0, student.sessionsPerWeek - (scheduledCounts.get(student.id) || 0))]))

  const commitRound = (roundStudents) => {
    const assignments = matchSchedulingRound(data, schedule, roundStudents)
    let committed = 0
    for (const { student, candidate } of assignments) {
      if (entryCount >= MAX_DRAFT_ENTRIES || scheduleDocumentEntryCount(schedule) >= MAX_DRAFT_DOCUMENT_ENTRIES) {
        capacityReached = true
        break
      }
      schedule[candidate.slotId] = [...(schedule[candidate.slotId] || []), autoEntryForCandidate(data, student, candidate)]
      scheduledCounts.set(student.id, (scheduledCounts.get(student.id) || 0) + 1)
      remainingByStudent.set(student.id, Math.max(0, (remainingByStudent.get(student.id) || 0) - 1))
      entryCount += 1
      committed += 1
    }
    return committed
  }

  const fillRemainingSessions = () => {
    let committedTotal = 0
    // Maximum-cardinality first-session round. Augmenting paths can move a
    // flexible learner away from the only slot of a constrained learner.
    committedTotal += commitRound(students.filter((student) => (scheduledCounts.get(student.id) || 0) === 0
      && (remainingByStudent.get(student.id) || 0) > 0))

    // Later rounds remain fair (one seat per learner per round) while maximizing
    // the number of fulfilled weekly targets in each round.
    let progress = true
    while (!capacityReached && progress) {
      const roundStudents = students.filter((student) => (remainingByStudent.get(student.id) || 0) > 0)
      if (!roundStudents.length) break
      const committed = commitRound(roundStudents)
      committedTotal += committed
      progress = committed > 0
    }
    return committedTotal
  }

  fillRemainingSessions()

  // Deep improvement runs compaction, regular coverage and bounded relocation.
  // Compaction can move a
  // flexible learner from a capacity-1 class into an existing 1/2 class. That
  // newly empty class is then retried for learners still missing a weekly
  // session. Relocation then opens a seat held by a flexible learner from an
  // earlier round, which closes global coverage gaps without moving protected
  // workload. Repeating the cycle catches pairing opportunities created by the
  // repair itself.
  let pairingMoves = 0
  let refillAssignments = 0
  let rescueAssignments = 0
  let rescueRelocations = 0
  let rescueSearchNodes = 0
  let rescueEvaluatedPlans = 0
  let rescueSearchLimitReached = false
  const swapTrace = []
  let optimizationPasses = 1
  for (let pass = 0; mode !== 'supplement' && pass < MAX_DEEP_OPTIMIZATION_PASSES; pass += 1) {
    const compacted = compactPairedSlots(data, schedule)
    if (compacted.moves > 0) {
      Object.keys(schedule).forEach((slotId) => delete schedule[slotId])
      Object.assign(schedule, compacted.schedule)
      pairingMoves += compacted.moves
    }
    // Reaching the draft-entry guard only disables adding more sessions. A
    // compaction pass still has value because it can turn two 1/2 classes into
    // one 2/2 class without increasing the number of entries.
    const refilled = capacityReached ? 0 : fillRemainingSessions()
    refillAssignments += refilled
    const repairCapacity = Math.max(0, Math.min(
      MAX_DRAFT_ENTRIES - entryCount,
      MAX_DRAFT_DOCUMENT_ENTRIES - scheduleDocumentEntryCount(schedule),
    ))
    const repaired = capacityReached || repairCapacity < 1
      ? { assignments: 0, relocations: 0, searchNodes: 0, evaluatedPlans: 0, searchLimitReached: false, assignedStudentIds: [], swapTrace: [], schedule }
      : repairCoverageWithRelocations(data, schedule, students, remainingByStudent, {
        maxAssignments: repairCapacity,
        maxSearchNodes: mode === 'continue' ? MAX_CONTINUATION_SEARCH_NODES : MAX_REPAIR_SEARCH_NODES,
        searchOffset: Number(data.searchOffset || 0) + pass,
      })
    if (repaired.assignments > 0) {
      Object.keys(schedule).forEach((slotId) => delete schedule[slotId])
      Object.assign(schedule, repaired.schedule)
      for (const studentId of repaired.assignedStudentIds) {
        scheduledCounts.set(studentId, (scheduledCounts.get(studentId) || 0) + 1)
        remainingByStudent.set(studentId, Math.max(0, (remainingByStudent.get(studentId) || 0) - 1))
      }
      entryCount += repaired.assignments
      rescueAssignments += repaired.assignments
      rescueRelocations += repaired.relocations
      swapTrace.push(...repaired.swapTrace)
      capacityReached = entryCount >= MAX_DRAFT_ENTRIES || scheduleDocumentEntryCount(schedule) >= MAX_DRAFT_DOCUMENT_ENTRIES
    }
    rescueSearchNodes += repaired.searchNodes
    rescueEvaluatedPlans += repaired.evaluatedPlans
    rescueSearchLimitReached ||= repaired.searchLimitReached
    optimizationPasses += 1
    if (compacted.moves === 0 && refilled === 0 && repaired.assignments === 0) break
  }
  const schedulingState = buildSchedulingState(schedule)
  const contractCache = new Map()

  // Assignment warnings are derived from the final schedule. Earlier rounds
  // may have moved an entry back to an assigned PT (or to a support PT), so
  // retaining incremental warnings would leave stale audit information.
  for (const [slotId, entries] of Object.entries(schedule)) {
    for (const entry of entries) {
      if (entry.type === 'off' || entry.trainerAssignmentWarning !== true) continue
      warnings.push({
        code: 'TRAINER_ASSIGNMENT_MISMATCH',
        studentId: entry.studentId,
        trainerId: entry.trainerId,
        slotId,
      })
    }
  }

  const finalFeasibility = studentFeasibilityForSchedule(data, schedule, feasibilityBaseSchedule)
  const feasibilityByStudent = new Map(finalFeasibility.map((item) => [item.studentId, item]))
  const unassignedEntries = []
  for (const student of students) {
    const missingSessions = remainingByStudent.get(student.id) || 0
    if (missingSessions < 1) continue
    const blockers = blockersForStudent(data, student, schedule, schedulingState, contractCache, capacityReached)
    const feasibility = feasibilityByStudent.get(student.id)
    const optimizerCouldStillImprove = blockers.suggestedSlots.length > 0
      || Number(feasibility?.maximumFeasibleSessions || 0) > Number(feasibility?.scheduledSessions || 0)
    const blockerType = rescueSearchLimitReached && optimizerCouldStillImprove
      ? 'search_limit_reached'
      : optimizerCouldStillImprove
        ? 'optimizer_gap'
        : 'input_or_capacity'
    const reasonCodes = blockerType === 'search_limit_reached'
      ? [...new Set(['SEARCH_LIMIT_REACHED', ...blockers.reasonCodes])]
      : blockers.reasonCodes
    const unassigned = {
      studentId: student.id,
      studentName: student.name,
      missingSessions,
      blockerType,
      ...blockers,
      primaryReasonCode: blockerType === 'search_limit_reached' ? 'SEARCH_LIMIT_REACHED' : blockers.primaryReasonCode,
      actionCode: blockerType === 'search_limit_reached' ? 'RERUN_OPTIMIZER' : blockers.actionCode,
      reasonCodes,
    }
    unassignedEntries.push(unassigned)
    warnings.push({ code: 'STUDENT_UNSCHEDULED', ...unassigned })
  }
  if (capacityReached) warnings.unshift({ code: 'DRAFT_CAPACITY_REACHED', entryCount, maxEntries: MAX_DRAFT_ENTRIES })
  const optimizationSummary = {
    objectiveOrder: ['learner_coverage', 'weekly_target_fulfilment', 'pairing', 'trainer_assignment', 'trainer_consecutive_blocks', 'soft_load_balance', 'learner_spacing'],
    loadPolicyVersion: 'soft-consecutive-blocks-v2',
    studentCoverage: studentCoverageForSchedule(data, schedule),
    studentFeasibility: finalFeasibility,
    trainerLoads: trainerLoadsForSchedule(data, schedule, schedulingState),
    slotUtilization: slotUtilizationForSchedule(data, schedule),
    pairingMoves,
    refillAssignments,
    rescueAssignments,
    rescueRelocations,
    rescueSearchNodes,
    rescueEvaluatedPlans,
    rescueSearchLimitReached,
    // Backward-compatible aliases for clients deployed before optimizer v10.
    repairAssignments: rescueAssignments,
    repairRelocations: rescueRelocations,
    repairSearchNodes: rescueSearchNodes,
    repairSearchLimitReached: rescueSearchLimitReached,
    swapTrace: swapTrace.slice(0, 500),
    optimizationPasses,
    generatorVersion: OPTIMIZER_VERSION,
    generationMode: mode,
  }
  return { schedule, warnings, optimizationSummary, unassignedEntries }
}

function scheduleOutcome(data, schedule) {
  const counts = scheduleStudentCounts(schedule)
  const students = data.students.filter((student) => student.eligibleForWeek !== false && student.sessionsPerWeek > 0)
  const utilization = slotUtilizationForSchedule(data, schedule)
  return [students.filter((s) => (counts.get(s.id) || 0) > 0).length,
    students.reduce((sum, s) => sum + Math.min(s.sessionsPerWeek, counts.get(s.id) || 0), 0),
    students.filter((s) => (counts.get(s.id) || 0) >= s.sessionsPerWeek).length,
    utilization.pairedSlots, -utilization.singleSlots]
}

function generateSchedule(data) {
  let result = generateScheduleAttempt(data)
  const baseline = safeSchedule(data.schedule)
  if ((data.generationMode || 'optimize') === 'optimize' && compareScoreVectors(scheduleOutcome(data, baseline), scheduleOutcome(data, result.schedule)) < 0) {
    // Retain the incumbent only when its mutable entries remain valid under
    // today's input. Invalid old auto entries must not bypass revalidation.
    const valid = Object.entries(baseline).every(([slotId, entries]) => entries.every((entry) => {
      if (protectedFromOptimizer(entry)) return true
      const student = data.students.find((s) => s.id === entry.studentId), trainer = data.trainers.find((t) => t.id === entry.trainerId)
      return student && trainer && candidateForSlot(data, { student, trainer, slotId, schedule: scheduleWithoutEntry(baseline, slotId, entry) }).eligible
    }))
    if (valid) result = generateScheduleAttempt({ ...data, generationMode: 'continue' })
  }
  const before = scheduleOutcome(data, baseline), after = scheduleOutcome(data, result.schedule)
  const oldLocations = new Map(Object.entries(baseline).flatMap(([slotId, entries]) => entries.filter((e) => e.type !== 'off').map((e) => [`${e.studentId}|${slotId}|${e.trainerId}`, e])))
  const changedEntries = Object.entries(result.schedule).reduce((sum, [slotId, entries]) => sum + entries.filter((e) => e.type !== 'off' && !oldLocations.has(`${e.studentId}|${slotId}|${e.trainerId}`)).length, 0)
  result.optimizationSummary.comparison = { before: { covered: before[0], sessions: before[1], complete: before[2], paired: before[3], singles: -before[4] }, after: { covered: after[0], sessions: after[1], complete: after[2], paired: after[3], singles: -after[4] }, addedSessions: after[1] - before[1], changedEntries }
  return result
}

function commandReceiptId(actorUid, branchId, week, idempotencyKey) {
  return createHash('sha256').update(`${actorUid}|${branchId}|${week}|${idempotencyKey}`).digest('hex')
}

function commandInput(value) {
  const supported = new Set(['add_student', 'remove_student', 'move_student', 'set_trainer_off', 'clear_trainer_off', 'lock_entry', 'unlock_entry', 'set_student_weekly_target', 'reset_draft'])
  const command = typeof value === 'string' ? value : ''
  if (!supported.has(command)) throw new HttpsError('invalid-argument', 'Lệnh chỉnh lịch không hợp lệ.')
  return command
}

function resetDraftSchedule(data, currentSchedule) {
  const schedule = {}
  for (const [slotId, entries] of Object.entries(safeSchedule(currentSchedule))) {
    const retained = entries.filter((entry) => entry.type === 'off' || entry.isLocked === true || entry.source === 'published_existing')
    if (retained.length) schedule[slotId] = retained
  }
  // Rehydrate every real published session even when the draft predates V2.
  mergePublishedSessions(data, schedule, [])
  return schedule
}

function createPtScheduleV2Functions({ db, onCall, actorForBranch = scheduleActor, branchData = loadBranchData, manualData = loadManualMutationData }) {
  const listPtScheduleBranches = onCall(async (request) => {
    const actor = await trustedAccessContext(request, db)
    requireCapability(actor, 'pt.schedule.branch.publish')
    const snapshot = await db.collection('branches').limit(100).get()
    return {
      schemaVersion: 2,
      branches: snapshot.docs.map((item) => ({ id: item.id, name: item.data().name || item.id, status: item.data().status || 'active' }))
        .filter((branch) => branch.status !== 'archived' && (activeAdministrator(actor) || actor.branchIds.includes(branch.id)))
        .sort((left, right) => left.name.localeCompare(right.name, 'vi')),
    }
  })

  const getPtScheduleWorkspace = onCall(async (request) => {
    const week = weekId(request.data?.weekId)
    const branchId = documentId(request.data?.branchId, 'Mã chi nhánh')
    const actor = await actorForBranch(request, db, branchId)
    const data = await branchData(db, branchId, week)
    const eligibleStudents = data.students.filter((student) => student.eligibleForWeek === true)
    const workloadSchedule = safeSchedule(data.schedule)
    mergePublishedSessions({ ...data, weekId: week }, workloadSchedule, [])
    const calculatedOptimizationSummary = {
      studentCoverage: studentCoverageForSchedule({ ...data, weekId: week }, workloadSchedule),
      studentFeasibility: studentFeasibilityForSchedule({ ...data, weekId: week }, workloadSchedule),
      trainerLoads: trainerLoadsForSchedule({ ...data, weekId: week }, workloadSchedule),
      slotUtilization: slotUtilizationForSchedule({ ...data, weekId: week }, workloadSchedule),
    }
    const responseContractIds = new Set(Object.values(workloadSchedule).flat()
      .map((entry) => entry.contractId)
      .filter(Boolean))
    const latestContractByStudent = new Map()
    for (const contract of data.contracts) {
      const current = latestContractByStudent.get(contract.studentId)
      if (!current || String(current.endDate || '').localeCompare(String(contract.endDate || '')) < 0) {
        latestContractByStudent.set(contract.studentId, contract)
      }
    }
    for (const student of data.students) {
      ;(student.eligibleContractIds || []).forEach((contractId) => responseContractIds.add(contractId))
      const latestContract = latestContractByStudent.get(student.id)
      if (latestContract) responseContractIds.add(latestContract.id)
    }
    return {
      schemaVersion: 2,
      branch: data.branch,
      weekId: week,
      draftRevision: data.draft.revision,
      draftStatus: data.draft.status,
      publishedVersion: data.draft.publishedVersion,
      publishedRevision: data.draft.publishedRevision,
      updatedAt: data.draft.updatedAt,
      updatedBy: data.draft.updatedBy,
      schedule: workloadSchedule,
      students: data.students,
      trainers: data.trainers,
      // The UI needs date-valid contracts, contracts bound to draft entries,
      // and one latest contract for compact diagnostics. Older renewal-chain
      // rows stay server-side and no longer inflate every workspace response.
      contracts: data.contracts.filter((contract) => responseContractIds.has(contract.id)),
      // Session rows have already been folded into contract quota and the
      // protected schedule above. The workspace UI never reads the raw rows;
      // omitting them removes the largest repeated network payload.
      sessions: [],
      scheduleConfig: data.config,
      warnings: data.draft.warnings,
      // Always derive live workload from the current draft and current trainer
      // policy. Keep generator diagnostics (including the relocation trace)
      // from the audit snapshot, but never reuse its stale live metrics.
      optimizationSummary: {
        ...data.draft.optimizationSummary,
        ...calculatedOptimizationSummary,
      },
      unassignedEntries: data.draft.unassignedEntries,
      summary: {
        eligibleStudents: eligibleStudents.length,
        trainers: data.trainers.length,
        unconfiguredTrainers: data.trainers.filter((trainer) => trainer.availabilityMode === 'unconfigured').length,
        scheduledEntries: calculatedOptimizationSummary.studentCoverage.scheduledEntries,
        missingSessions: calculatedOptimizationSummary.studentCoverage.missingSessions,
        unassignedEntries: data.draft.unassignedEntries.length,
      },
    }
  })

  const generatePtScheduleDraft = onCall(async (request) => {
    const week = weekId(request.data?.weekId)
    const branchId = documentId(request.data?.branchId, 'Mã chi nhánh')
    const expectedRevision = Number(request.data?.expectedDraftRevision)
    if (!Number.isInteger(expectedRevision) || expectedRevision < 0) throw new HttpsError('invalid-argument', 'Phiên bản draft không hợp lệ.')
    const actor = await actorForBranch(request, db, branchId)
    const data = await branchData(db, branchId, week)
    if (data.draft.revision !== expectedRevision) throw new HttpsError('aborted', 'Draft đã thay đổi. Hãy tải lại trước khi tối ưu.')
    const mode = request.data?.mode || 'optimize'
    if (!['optimize', 'supplement', 'continue'].includes(mode)) throw new HttpsError('invalid-argument', 'Chế độ xếp lịch không hợp lệ.')
    const generated = generateSchedule({ ...data, weekId: week, generationMode: mode, searchOffset: expectedRevision, referenceNow: Date.now() })
    const reference = draftReference(db, branchId, week)
    return db.runTransaction(async (transaction) => {
      const current = await transaction.get(reference)
      const revision = Number(current.exists ? current.data()?.revision || 0 : data.draft.revision)
      if (revision !== expectedRevision) throw new HttpsError('aborted', 'Draft đã thay đổi. Hãy tải lại trước khi xếp tự động.')
      const nextRevision = revision + 1
      transaction.set(reference, {
        schemaVersion: 2,
        branchId,
        weekId: week,
        schedule: generated.schedule,
        revision: nextRevision,
        status: 'draft',
        generatorVersion: OPTIMIZER_VERSION,
        warnings: generated.warnings,
        optimizationSummary: generated.optimizationSummary,
        unassignedEntries: generated.unassignedEntries,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: actor.uid,
        createdAt: current.exists ? current.data().createdAt || FieldValue.serverTimestamp() : FieldValue.serverTimestamp(),
      }, { merge: true })
      transaction.create(db.collection('ptOperationsAuditLogs').doc(), { schemaVersion: 2, action: 'pt_schedule.generated', actorUid: actor.uid, branchId, weekId: week, previousDraftRevision: revision, nextDraftRevision: nextRevision, entryCount: scheduleEntryCount(generated.schedule), studentCoverage: generated.optimizationSummary.studentCoverage, slotUtilization: generated.optimizationSummary.slotUtilization, unassignedCount: generated.unassignedEntries.length, warnings: generated.warnings.slice(0, 100), createdAt: FieldValue.serverTimestamp() })
      return { draftRevision: nextRevision, schedule: generated.schedule, warnings: generated.warnings, optimizationSummary: generated.optimizationSummary, unassignedEntries: generated.unassignedEntries, generatorVersion: OPTIMIZER_VERSION }
    })
  })

  const getPtScheduleSlotCandidates = onCall(async (request) => {
    const week = weekId(request.data?.weekId)
    const branchId = documentId(request.data?.branchId, 'Mã chi nhánh')
    const trainerId = documentId(request.data?.trainerId, 'Mã PT')
    const slotId = typeof request.data?.slotId === 'string' ? request.data.slotId : ''
    if (!/^(T[2-7]|CN)-(?:[0-9]|1[0-9]|2[0-3])$/.test(slotId)) throw new HttpsError('invalid-argument', 'Ô lịch không hợp lệ.')
    const actor = await actorForBranch(request, db, branchId)
    const data = await branchData(db, branchId, week)
    data.weekId = week
    const trainer = data.trainers.find((item) => item.id === trainerId)
    if (!trainer) throw new HttpsError('not-found', 'Không tìm thấy PT trong chi nhánh.')
    const rawSearch = typeof request.data?.search === 'string' ? request.data.search.trim().slice(0, 100) : ''
    const search = normalizedSearchText(rawSearch)
    const scheduledCounts = scheduleStudentCounts(data.schedule)
    const studentsById = new Map(data.students.map((student) => [student.id, student]))
    const branchCandidates = data.students.filter((student) => !search
      || normalizedSearchText(student.name).includes(search)
      || normalizedSearchText(student.phone).includes(search)).map((student) => ({
      studentId: student.id,
      name: student.name,
      phone: student.phone,
      ...manualSlotCandidate(candidateForSlot(data, { student, trainer, slotId, schedule: data.schedule })),
    }))

    // Tìm học viên khác cơ sở chỉ khi admin chủ động nhập từ khóa.
    // Mỗi kết quả được nạp lại bằng hồ sơ, hợp đồng, lịch rảnh và
    // session chính xác trước khi trả về; staff chi nhánh không nhìn thấy dữ liệu này.
    let crossBranchCandidates = []
    if (activeAdministrator(actor) && search.length >= 2) {
      const globalStudents = await db.collection('students').limit((MAX_STUDENTS * 3) + 1).get()
      const externalMatches = globalStudents.docs
        .filter((item) => item.data().branchId !== branchId)
        .filter((item) => {
          const profile = item.data()
          return normalizedSearchText(profile.name).includes(search)
            || normalizedSearchText(profile.phone).includes(search)
            || normalizedSearchText(profile.email).includes(search)
        })
        .slice(0, 12)
      const enriched = await Promise.all(externalMatches.map(async (item) => {
        try {
          const exactData = await manualData(db, branchId, week, trainerId, item.id, true, data)
          exactData.weekId = week
          const student = exactData.students[0]
          const result = manualSlotCandidate(candidateForSlot(exactData, { student, trainer: exactData.trainers[0], slotId, schedule: exactData.schedule }))
          return {
            studentId: student.id,
            name: student.name,
            phone: student.phone,
            studentBranchWarning: true,
            studentHomeBranchId: student.branchId || '',
            ...result,
          }
        } catch {
          return null
        }
      }))
      crossBranchCandidates = enriched.filter(Boolean)
    }
    const allCandidates = [...branchCandidates, ...crossBranchCandidates]
    return {
      schemaVersion: 2,
      candidates: allCandidates.sort((left, right) => {
        const rank = (candidate) => candidate.eligible ? 0 : candidate.manualSelectable ? 1 : 2
        const leftStudent = studentsById.get(left.studentId)
        const rightStudent = studentsById.get(right.studentId)
        const leftMissing = Math.max(0, Number(leftStudent?.sessionsPerWeek || 0) - (scheduledCounts.get(left.studentId) || 0))
        const rightMissing = Math.max(0, Number(rightStudent?.sessionsPerWeek || 0) - (scheduledCounts.get(right.studentId) || 0))
        return rank(left) - rank(right)
          || Number(Boolean(left.trainerAssignmentWarning)) - Number(Boolean(right.trainerAssignmentWarning))
          || rightMissing - leftMissing
          || Number(leftStudent?.availableSlots?.length || 0) - Number(rightStudent?.availableSlots?.length || 0)
          || left.name.localeCompare(right.name, 'vi')
      }).slice(0, 100),
    }
  })

  const savePtStudentAvailability = onCall(async (request) => {
    const week = weekId(request.data?.weekId)
    const branchId = documentId(request.data?.branchId, 'Mã chi nhánh')
    const studentId = documentId(request.data?.studentId, 'Mã học viên')
    const expectedRevision = Number(request.data?.expectedRevision)
    if (!Number.isInteger(expectedRevision) || expectedRevision < 0) throw new HttpsError('invalid-argument', 'Phiên bản lịch rảnh không hợp lệ.')
    const actor = await actorForBranch(request, db, branchId)
    const [studentSnapshot, configSnapshot] = await Promise.all([
      db.doc(`students/${studentId}`).get(),
      db.doc('settings/scheduleConfig').get(),
    ])
    if (!studentSnapshot.exists || studentSnapshot.data().branchId !== branchId) {
      throw new HttpsError('not-found', 'Không tìm thấy học viên trong chi nhánh đang xếp lịch.')
    }
    const config = normalizedScheduleConfig(configSnapshot.data())
    const slots = normalizedScheduleAvailabilitySlots(request.data?.availableSlots, config)
    const requiredSessions = Math.max(1, Math.min(7, Number(studentSnapshot.data().sessionsPerWeek || 1)))
    const minimumSlots = Math.max(5, requiredSessions)
    if (slots.length < minimumSlots) throw new HttpsError('failed-precondition', `Hãy chọn ít nhất ${minimumSlots} khung giờ rảnh.`)
    const reference = db.doc(`ptAvailability/${studentId}_${week}`)
    const studentReference = db.doc(`students/${studentId}`)
    const cutoff = Date.parse(`${week}T00:00:00+07:00`) - 14 * 60 * 60 * 1000
    const availabilityStatus = Date.now() >= cutoff ? 'locked' : 'submitted'
    const submittedAtIso = new Date().toISOString()
    const nextRevision = await db.runTransaction(async (transaction) => {
      const [current, currentProfile] = await Promise.all([
        transaction.get(reference),
        transaction.get(studentReference),
      ])
      if (!currentProfile.exists || currentProfile.data().branchId !== branchId) throw new HttpsError('not-found', 'Không tìm thấy học viên trong chi nhánh đang xếp lịch.')
      const revision = Number(current.data()?.revision || 0)
      if (revision !== expectedRevision) throw new HttpsError('aborted', 'Lịch rảnh đã thay đổi. Hãy tải lại trước khi lưu.', { issueCode: 'REVISION_CONFLICT', currentRevision: revision })
      const next = {
        schemaVersion: 1,
        studentId,
        accountUid: current.data()?.accountUid || null,
        weekId: week,
        slots,
        requiredSessions,
        minimumSlots,
        status: availabilityStatus,
        revision: revision + 1,
        submittedAt: current.data()?.submittedAt || FieldValue.serverTimestamp(),
        updatedBy: actor.uid,
        updatedAt: FieldValue.serverTimestamp(),
      }
      if (current.exists) transaction.update(reference, next)
      else transaction.create(reference, { ...next, createdAt: FieldValue.serverTimestamp() })
      const profilePatch = studentAvailabilityProfilePatch(currentProfile.data(), {
        weekId: week,
        slots,
        requiredSessions,
        minimumSlots,
        status: availabilityStatus,
        revision: revision + 1,
        submittedAt: submittedAtIso,
      })
      if (Object.keys(profilePatch).length) transaction.update(studentReference, {
        ...profilePatch,
        latestAvailabilityUpdatedBy: actor.uid,
        latestAvailabilityUpdatedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      })
      transaction.create(db.collection('ptOperationsAuditLogs').doc(), {
        schemaVersion: 2,
        action: 'student_availability.admin_updated',
        actorUid: actor.uid,
        studentId,
        branchId,
        weekId: week,
        beforeSlotCount: Array.isArray(current.data()?.slots) ? current.data().slots.length : 0,
        afterSlotCount: slots.length,
        previousRevision: revision,
        nextRevision: revision + 1,
        latestFallbackAdvanced: Boolean(profilePatch.latestSubmittedAvailability),
        createdAt: FieldValue.serverTimestamp(),
      })
      return revision + 1
    })
    return { schemaVersion: 1, availableSlots: slots, availabilityRevision: nextRevision, availabilityStatus }
  })

  const applyPtScheduleDraftCommand = onCall(async (request) => {
    const week = weekId(request.data?.weekId)
    const branchId = documentId(request.data?.branchId, 'Mã chi nhánh')
    const expectedRevision = Number(request.data?.expectedDraftRevision)
    if (!Number.isInteger(expectedRevision) || expectedRevision < 0) throw new HttpsError('invalid-argument', 'Phiên bản draft không hợp lệ.')
    const command = commandInput(request.data?.command)
    const idempotencyKey = typeof request.data?.idempotencyKey === 'string' ? request.data.idempotencyKey.trim() : ''
    if (!/^[A-Za-z0-9:_-]{8,200}$/.test(idempotencyKey)) throw new HttpsError('invalid-argument', 'Khóa chống lặp không hợp lệ.')
    const actor = await actorForBranch(request, db, branchId)
    const payload = request.data?.payload && typeof request.data.payload === 'object' ? request.data.payload : {}
    const reference = draftReference(db, branchId, week)
    const receipt = db.doc(`ptScheduleCommandReceipts/${commandReceiptId(actor.uid, branchId, week, idempotencyKey)}`)
    const priorReceipt = await receipt.get()
    if (priorReceipt.exists) return priorReceipt.data().result
    const slotId = typeof payload.slotId === 'string' ? payload.slotId : ''
    const fromSlotId = typeof payload.fromSlotId === 'string' ? payload.fromSlotId : ''
    const slotPattern = /^(T[2-7]|CN)-(?:[0-9]|1[0-9]|2[0-3])$/
    const commandWithoutSlot = command === 'set_student_weekly_target' || command === 'reset_draft'
    if (!commandWithoutSlot && !slotPattern.test(slotId)) throw new HttpsError('invalid-argument', 'Ô lịch không hợp lệ.')
    if (command === 'move_student' && !slotPattern.test(fromSlotId)) throw new HttpsError('invalid-argument', 'Ô lịch nguồn không hợp lệ.')
    const trainerId = commandWithoutSlot ? '' : documentId(payload.trainerId, 'Mã PT')
    const fromTrainerId = command === 'move_student' ? documentId(payload.fromTrainerId || trainerId, 'Mã PT nguồn') : trainerId
    const studentId = command.includes('student') || command.includes('entry') ? documentId(payload.studentId, 'Mã học viên') : ''
    // Adding/moving one learner previously scanned the complete branch and all
    // active sessions. Scope the hot path to the selected learner/PT while
    // preserving the same canonical contract, availability and audit checks.
    const crossBranchConfirmed = activeAdministrator(actor) && payload.confirmCrossBranchStudent === true
    const data = command === 'add_student' || command === 'move_student'
      ? await manualData(db, branchId, week, trainerId, studentId, crossBranchConfirmed)
      : await branchData(db, branchId, week)
    data.weekId = week
    if (Number(data.draft.revision) !== expectedRevision) throw new HttpsError('aborted', 'Draft đã thay đổi. Hãy tải lại trước khi chỉnh.')
    if (['add_student', 'move_student', 'set_trainer_off'].includes(command) && slotIsPast(week, slotId)) throw new HttpsError('failed-precondition', 'Ca đã qua giờ. Hãy dùng chức năng điều chỉnh lịch sử có audit.')
    if (command === 'move_student') {
      const source = (data.schedule[fromSlotId] || []).filter((entry) => entry.studentId === studentId && entry.trainerId === fromTrainerId && entry.type !== 'off')
      if (source.length !== 1) throw new HttpsError('failed-precondition', 'Không tìm thấy duy nhất một ca nguồn để chuyển.')
      if (fromSlotId === slotId && fromTrainerId === trainerId) throw new HttpsError('invalid-argument', 'Ca đích trùng ca nguồn.')
    }
    const targetStudent = command === 'set_student_weekly_target'
      ? data.students.find((item) => item.id === studentId)
      : null
    if (command === 'set_student_weekly_target' && !targetStudent) throw new HttpsError('not-found', 'Không tìm thấy học viên trong chi nhánh.')
    const resetWeeklyTarget = command === 'set_student_weekly_target' && payload.resetToDefault === true
    const weeklyTarget = resetWeeklyTarget ? null : Number(payload.targetSessions)
    if (command === 'set_student_weekly_target' && (!resetWeeklyTarget && (!Number.isInteger(weeklyTarget) || weeklyTarget < 0 || weeklyTarget > 7))) {
      throw new HttpsError('invalid-argument', 'Mục tiêu tuần phải từ 0 đến 7 buổi.')
    }
    if (command === 'set_student_weekly_target' && !resetWeeklyTarget && weeklyTarget > targetStudent.maxWeeklySessions) {
      throw new HttpsError('failed-precondition', `Mục tiêu tuần không thể vượt ${targetStudent.maxWeeklySessions} buổi còn lại theo quota hợp đồng.`, { issueCode: 'WEEKLY_TARGET_EXCEEDS_QUOTA' })
    }
    let schedule = safeSchedule(data.schedule)
    let availabilityOverrideMetadata = null
    let selectedManualContractId = ''
    let trainerAssignmentWarningMetadata = null
    let studentBranchWarningMetadata = null
    if (command === 'add_student' || command === 'move_student') {
      const trainer = data.trainers.find((item) => item.id === trainerId)
      const student = data.students.find((item) => item.id === studentId)
      if (!trainer || !student) throw new HttpsError('not-found', 'Không tìm thấy PT hoặc học viên trong phạm vi.')
      const candidateSchedule = command === 'move_student'
        ? Object.fromEntries(Object.entries(schedule).map(([key, entries]) => [
          key,
          key === fromSlotId ? entries.filter((entry) => !(entry.studentId === studentId && entry.trainerId === fromTrainerId)) : entries,
        ]))
        : schedule
      const result = manualSlotCandidate(candidateForSlot(data, { student, trainer, slotId, schedule: candidateSchedule }))
      const allowAvailabilityOverride = payload.allowOutsideStudentAvailability === true
      if (!result.eligible && !(result.manualSelectable && allowAvailabilityOverride)) {
        throw new HttpsError('failed-precondition', 'Học viên chưa đủ điều kiện vào ô lịch.', { issueCode: 'SLOT_CANDIDATE_REJECTED', errors: result.reasons })
      }
      if (!result.eligible) {
        availabilityOverrideMetadata = {
          availabilityOverride: true,
          availabilityOverrideReason: result.availabilityReason,
          availabilityOverrideBy: actor.uid,
          availabilityOverrideAt: new Date().toISOString(),
        }
      }
      selectedManualContractId = result.contractId || ''
      if (result.trainerAssignmentWarning) trainerAssignmentWarningMetadata = { trainerAssignmentWarning: true }
      if (result.studentBranchWarning) {
        if (!crossBranchConfirmed) throw new HttpsError('failed-precondition', 'Học viên thuộc cơ sở khác. Admin cần xác nhận ngoại lệ trước khi xếp tay.', { issueCode: 'STUDENT_BRANCH_CONFIRMATION_REQUIRED' })
        studentBranchWarningMetadata = { studentBranchWarning: true, studentHomeBranchId: student.branchId || '' }
      }
    }
    return db.runTransaction(async (transaction) => {
      const [current, existingReceipt] = await Promise.all([transaction.get(reference), transaction.get(receipt)])
      if (existingReceipt.exists) return existingReceipt.data().result
      const revision = Number(current.exists ? current.data()?.revision || 0 : data.draft.revision)
      if (revision !== expectedRevision) throw new HttpsError('aborted', 'Draft đã thay đổi. Hãy tải lại trước khi chỉnh.')
      schedule = safeSchedule(current.exists ? current.data().schedule : data.schedule)
      const resetRemovedEntries = command === 'reset_draft'
        ? Object.values(schedule).flat().filter((entry) => entry.type !== 'off' && entry.isLocked !== true && entry.source !== 'published_existing')
        : []
      if (command === 'reset_draft') schedule = resetDraftSchedule({ ...data, weekId: week }, schedule)
      const destructiveSlot = command === 'move_student' ? fromSlotId : slotId
      const destructiveTrainer = command === 'move_student' ? fromTrainerId : trainerId
      if (['move_student', 'remove_student', 'set_trainer_off', 'unlock_entry'].includes(command)) {
        const affected = (schedule[destructiveSlot] || []).filter((entry) => entry.type !== 'off' && entry.trainerId === destructiveTrainer
          && (command === 'set_trainer_off' || entry.studentId === studentId))
        const protectedEntry = affected.find((entry) => entry.source === 'published_existing'
          || entry.isLocked === true && command !== 'unlock_entry'
          || data.sessions.some((session) => session.studentId === entry.studentId && session.trainerId === entry.trainerId
            && publishedSessionSlotId(week, session) === destructiveSlot
            && (session.billingStatus === 'charged' || ['scheduled', 'rescheduled', 'completed', 'attended', 'no_show'].includes(session.status)))
          || slotIsPast(week, destructiveSlot))
        if (protectedEntry) throw new HttpsError('failed-precondition', 'Ca đã khóa, đã publish hoặc đã qua giờ. Hãy mở khóa ca nháp, hoặc dùng luồng điều chỉnh lịch sử cho ca đã publish.', { issueCode: 'PROTECTED_SESSION', studentId: protectedEntry.studentId, trainerId: destructiveTrainer, slotId: destructiveSlot })
      }
      if (command === 'move_student') schedule[fromSlotId] = (schedule[fromSlotId] || []).filter((entry) => !(entry.studentId === studentId && entry.trainerId === fromTrainerId))
      const values = Array.isArray(schedule[slotId]) ? [...schedule[slotId]] : []
      // A scoped add/move only loads one learner. Never filter other learners'
      // weekly overrides using that partial data set.
      const currentWeeklyTargets = safeWeeklySessionTargets(current.exists ? current.data()?.weeklySessionTargets : {})
      if (command === 'set_student_weekly_target') {
        const scheduledCount = Object.values(schedule).flat().filter((entry) => entry.type !== 'off' && entry.studentId === studentId).length
        const nextTarget = resetWeeklyTarget
          ? Math.min(targetStudent.defaultSessionsPerWeek, targetStudent.maxWeeklySessions)
          : weeklyTarget
        if (nextTarget < scheduledCount) {
          throw new HttpsError('failed-precondition', `Học viên đã có ${scheduledCount} buổi trong draft. Hãy gỡ bớt lịch trước khi hạ mục tiêu tuần.`, { issueCode: 'WEEKLY_TARGET_BELOW_SCHEDULED' })
        }
        if (resetWeeklyTarget) delete currentWeeklyTargets[studentId]
        else currentWeeklyTargets[studentId] = weeklyTarget
      }
      if (command === 'add_student') values.push({ studentId, trainerId, branchId, type: 'training', contractId: selectedManualContractId, source: 'manual_v2', ...(trainerAssignmentWarningMetadata || {}), ...(studentBranchWarningMetadata || {}), ...(availabilityOverrideMetadata || {}) })
      if (command === 'remove_student') schedule[slotId] = values.filter((entry) => !(entry.studentId === studentId && entry.trainerId === trainerId))
      if (command === 'move_student') {
        values.push({ studentId, trainerId, branchId, type: 'training', contractId: selectedManualContractId, source: 'manual_v2', ...(trainerAssignmentWarningMetadata || {}), ...(studentBranchWarningMetadata || {}), ...(availabilityOverrideMetadata || {}) })
        schedule[slotId] = values
      }
      let requeuedEntries = []
      if (command === 'set_trainer_off') {
        const affected = values.filter((entry) => entry.trainerId === trainerId && entry.type !== 'off')
        if (affected.length && payload.disposition !== 'requeue') throw new HttpsError('failed-precondition', 'Ca đang có học viên. Hãy chọn cách xử lý trước khi cho PT nghỉ.', { issueCode: 'TRAINER_OFF_REQUIRES_DISPOSITION', affectedStudentIds: affected.map((entry) => entry.studentId) })
        requeuedEntries = affected.map((entry) => ({
          ...entry,
          originalSlotId: slotId,
          reason: 'trainer_off',
          queuedAt: new Date().toISOString(),
        }))
        schedule[slotId] = [...values.filter((entry) => entry.trainerId !== trainerId), { studentId: 'OFF', trainerId, branchId, type: 'off', isLocked: true, source: 'manual_v2' }]
      }
      if (command === 'clear_trainer_off') schedule[slotId] = values.filter((entry) => !(entry.trainerId === trainerId && entry.type === 'off'))
      if (command === 'lock_entry' || command === 'unlock_entry') schedule[slotId] = values.map((entry) => entry.studentId === studentId && entry.trainerId === trainerId ? { ...entry, isLocked: command === 'lock_entry' } : entry)
      if (command === 'add_student') schedule[slotId] = values
      for (const [key, entries] of Object.entries(schedule)) if (!entries.length) delete schedule[key]
      if (scheduleEntryCount(schedule) > MAX_DRAFT_ENTRIES || scheduleDocumentEntryCount(schedule) > MAX_DRAFT_DOCUMENT_ENTRIES) {
        throw new HttpsError('resource-exhausted', 'Draft vượt giới hạn an toàn.')
      }
      const nextRevision = revision + 1
      const result = { draftRevision: nextRevision, schedule, weeklySessionTargets: currentWeeklyTargets }
      // Generated missing-session diagnostics become stale after any manual
      // mutation. Retain only entries requeued by this command.
      const resetStudentIds = [...new Set(resetRemovedEntries.map((entry) => entry.studentId).filter(Boolean))]
      const unassignedEntries = command === 'reset_draft'
        ? resetStudentIds.slice(0, MAX_STUDENTS).map((removedStudentId) => ({ studentId: removedStudentId, missingSessions: 1, reasonCodes: ['DRAFT_RESET'], suggestedSlots: [] }))
        : requeuedEntries.slice(-200)
      transaction.set(reference, {
        schemaVersion: 2,
        branchId,
        weekId: week,
        schedule,
        revision: nextRevision,
        status: 'draft',
        unassignedEntries,
        weeklySessionTargets: currentWeeklyTargets,
        optimizationSummary: FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: actor.uid,
        createdAt: current.exists ? current.data().createdAt || FieldValue.serverTimestamp() : FieldValue.serverTimestamp(),
      }, { merge: true })
      transaction.create(receipt, { actorUid: actor.uid, branchId, weekId: week, command, idempotencyKey, result, createdAt: FieldValue.serverTimestamp() })
      transaction.create(db.collection('ptOperationsAuditLogs').doc(), { schemaVersion: 2, action: `pt_schedule.${command}`, actorUid: actor.uid, branchId, weekId: week, previousDraftRevision: revision, nextDraftRevision: nextRevision, affectedStudentCount: command === 'set_student_weekly_target' ? 1 : command === 'reset_draft' ? resetStudentIds.length : (command === 'add_student' || command === 'move_student') ? 1 : requeuedEntries.length, studentId: command.includes('student') ? studentId : null, weeklyTarget: command === 'set_student_weekly_target' ? (resetWeeklyTarget ? null : weeklyTarget) : null, availabilityOverride: Boolean(availabilityOverrideMetadata), availabilityOverrideReason: availabilityOverrideMetadata?.availabilityOverrideReason || null, trainerAssignmentWarning: Boolean(trainerAssignmentWarningMetadata), studentBranchWarning: Boolean(studentBranchWarningMetadata), studentHomeBranchId: studentBranchWarningMetadata?.studentHomeBranchId || null, reason: typeof request.data?.reason === 'string' ? request.data.reason.trim().slice(0, 300) : '', createdAt: FieldValue.serverTimestamp() })
      return result
    })
  })

  return { listPtScheduleBranches, getPtScheduleWorkspace, generatePtScheduleDraft, getPtScheduleSlotCandidates, savePtStudentAvailability, applyPtScheduleDraftCommand }
}

module.exports = {
  DEFAULT_DAILY_SESSION_TARGET,
  OPTIMIZER_VERSION,
  MAX_DRAFT_ENTRIES,
  MAX_DRAFT_DOCUMENT_ENTRIES,
  createPtScheduleV2Functions,
  loadManualMutationData,
  candidateForSlot,
  compactPairedSlots,
  createsThreeConsecutiveTrainingDays,
  generateSchedule,
  manualSlotCandidate,
  maximumFeasibleSessionsForStudent,
  repairCoverageWithRelocations,
  studentFeasibilityForSchedule,
  resetDraftSchedule,
  previousWeek,
  resolveContract,
  safeSchedule,
  safeWeeklySessionTargets,
  slotUtilizationForSchedule,
  studentWeekEligibility,
  trainerProfileForWeek,
  trainerLoadsForSchedule,
  trainerSchedulingPolicy,
  weeklyTargetForStudent,
}
