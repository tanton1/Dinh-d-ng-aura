'use strict'

const { createHash } = require('node:crypto')
const { FieldValue } = require('firebase-admin/firestore')
const { HttpsError } = require('firebase-functions/v2/https')
const { trustedAccessContext, requireCapability } = require('./identity-access')
const {
  branchScheduleSnapshot,
  dateForSlot,
  documentId,
  nextWeek,
  normalizedCapacity,
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
const DEFAULT_DAILY_SESSION_LIMIT = 10
const DAY_ORDER = new Map([['T2', 0], ['T3', 1], ['T4', 2], ['T5', 3], ['T6', 4], ['T7', 5], ['CN', 6]])
const STUDENT_AVAILABILITY_REASON_CODES = new Set(['AVAILABILITY_NOT_SUBMITTED', 'OUTSIDE_STUDENT_AVAILABILITY'])

function draftId(branchId, week) {
  return `${branchId}_${week}`
}

function draftReference(db, branchId, week) {
  return db.doc(`ptScheduleDrafts/${draftId(branchId, week)}`)
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

function leaveCovers(leave, trainerId, date) {
  if (leave?.status !== 'approved' || leave?.trainerId !== trainerId) return false
  const start = storedDate(leave.startDate)
  const end = storedDate(leave.endDate || leave.startDate)
  return Boolean(start && end && date >= start && date <= end)
}

async function loadBranchData(db, branchId, week) {
  const [branch, legacySchedule, draft, students, trainers, availability, weekSessions, activeSessions, config, leaves] = await Promise.all([
    db.doc(`branches/${branchId}`).get(),
    db.doc(`schedules/schedule_${week}`).get(),
    draftReference(db, branchId, week).get(),
    db.collection('students').where('branchId', '==', branchId).limit(MAX_STUDENTS + 1).get(),
    db.collection('trainers').where('branchId', '==', branchId).limit(MAX_TRAINERS + 1).get(),
    db.collection('ptAvailability').where('weekId', '==', week).limit(MAX_STUDENTS + 1).get(),
    db.collection('sessions').where('date', '>=', week).where('date', '<', nextWeek(week)).limit(1001).get(),
    db.collection('sessions').where('status', 'in', ['scheduled', 'rescheduled']).limit(3001).get(),
    db.doc('settings/scheduleConfig').get(),
    db.collection('leaveRequests').where('status', '==', 'approved').limit(1001).get(),
  ])
  if (!branch.exists || branch.data().status === 'archived') throw new HttpsError('failed-precondition', 'Chi nhánh không hoạt động.')
  if (students.size > MAX_STUDENTS || trainers.size > MAX_TRAINERS || availability.size > MAX_STUDENTS || weekSessions.size > 1000 || activeSessions.size > 3000 || leaves.size > 1000) {
    throw new HttpsError('resource-exhausted', 'Dữ liệu chi nhánh vượt giới hạn workspace an toàn.')
  }
  const studentIds = students.docs.map((item) => item.id)
  const trainerIds = new Set(trainers.docs.map((item) => item.id))
  const studentSet = new Set(studentIds)
  const contracts = await contractsForStudents(db, studentIds)
  const studentMap = new Map(students.docs.map((item) => [item.id, item.data()]))
  const trainerMap = new Map(trainers.docs.map((item) => [item.id, item.data()]))
  const sessionRowsById = new Map([...weekSessions.docs, ...activeSessions.docs]
    .map((item) => ({ id: item.id, ...item.data() }))
    .filter((item) => studentSet.has(item.studentId))
    .map((item) => [item.id, item]))
  const sessionRows = [...sessionRowsById.values()]
  const weeklyAvailability = new Map(availability.docs.map((item) => item.data()).filter((item) => studentSet.has(item.studentId)).map((item) => [item.studentId, item]))
  const inheritedAvailability = await loadLatestSubmittedFallbacks(db, studentMap, weeklyAvailability, week)
  const legacy = legacySchedule.exists ? legacySchedule.data() : {}
  const draftData = draft.exists ? draft.data() : null
  const weeklySessionTargets = safeWeeklySessionTargets(draftData?.weeklySessionTargets, studentSet)
  const schedule = draftData
    ? safeSchedule(draftData.schedule)
    : branchScheduleSnapshot(legacy.schedule || {}, branchId, studentMap, trainerMap)
  const mappedContracts = contracts.map((contract) => {
    const activeContractSessions = sessionRows.filter((session) => session.contractId === contract.id
      && ['scheduled', 'rescheduled'].includes(String(session.status || '').toLowerCase())
      && session.billingStatus !== 'charged')
    const activeScheduledThisWeek = activeContractSessions.filter((session) => {
      const date = storedDate(session.date)
      return date >= week && date < nextWeek(week)
    }).length
    const remainingEntitlementSessions = Math.max(0, Number(contract.totalSessions || 0) - Number(contract.usedSessions || 0))
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
    usedSessions: Number(contract.usedSessions || 0),
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
    const eligibility = studentWeekEligibility(mappedContracts, item.id, branchId, week)
    const studentInactive = ['inactive', 'archived', 'deleted'].includes(String(data.status || '').toLowerCase())
    const weeklySessionTargetOverride = Object.prototype.hasOwnProperty.call(weeklySessionTargets, item.id)
      ? weeklySessionTargets[item.id]
      : null
    // Weekly demand is a learner/profile setting. Do not silently shrink it
    // just because the current week has fewer future calendar days left.
    // Scheduling capacity is exposed separately so the UI can explain why a
    // target cannot yet be fulfilled.
    const target = weeklyTargetForStudent(data.sessionsPerWeek, weeklySessionTargetOverride, eligibility)
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
    }
  })
  const mappedTrainers = trainers.docs.map((item) => {
    const data = item.data()
    const schedulingPriority = Math.max(1, Math.min(999, Math.trunc(Number(data.schedulingPriority ?? data.priority ?? 100) || 100)))
    const dailySessionTarget = Math.max(1, Math.min(12, Math.trunc(Number(data.dailySessionTarget ?? DEFAULT_DAILY_SESSION_TARGET) || DEFAULT_DAILY_SESSION_TARGET)))
    const dailySessionLimit = Math.max(dailySessionTarget, Math.min(16, Math.trunc(Number(data.dailySessionLimit ?? DEFAULT_DAILY_SESSION_LIMIT) || DEFAULT_DAILY_SESSION_LIMIT)))
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
      dailySessionLimit,
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
    },
    schedule,
    students: mappedStudents,
    trainers: mappedTrainers,
    contracts: mappedContracts,
    availability: weeklyAvailability,
    sessions: sessionRows,
    leaves: leaves.docs.map((item) => ({ id: item.id, ...item.data() })).filter((item) => trainerIds.has(item.trainerId)),
    config: {
      workingDays: Array.isArray(config.data()?.workingDays) ? config.data().workingDays : [...DAY_ORDER.keys()],
      workingHours: Array.isArray(config.data()?.workingHours) ? config.data().workingHours.map(Number) : [],
      holidays: Array.isArray(config.data()?.holidays) ? config.data().holidays : [],
      branchCapacityBySlot: config.data()?.branchCapacityBySlot || {},
    },
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

function studentWeekEligibility(contracts, studentId, branchId, week, referenceDate = todayInHoChiMinh()) {
  const reasons = new Set()
  const operationalContracts = contracts.filter((contract) => contract.studentId === studentId
    && ['active', 'future'].includes(String(contract.status || 'active').toLowerCase()))
  if (!operationalContracts.length) reasons.add('ACTIVE_CONTRACT_NOT_FOUND')

  const branchContracts = operationalContracts.filter((contract) => {
    if (!contract.branchId) {
      reasons.add('CONTRACT_BRANCH_REQUIRED')
      return false
    }
    if (contract.branchId !== branchId) {
      reasons.add('STUDENT_BRANCH_MISMATCH')
      return false
    }
    return true
  })
  const dates = datesForWeek(week).filter((date) => date >= referenceDate)
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

  if (branchContracts.length && !overlapsWeek) reasons.add('ACTIVE_CONTRACT_NOT_FOUND')
  if (branchContracts.length && !hasRemainingSessions) reasons.add('CONTRACT_SESSION_QUOTA_EXCEEDED')
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

function resolveContract(data, studentId, trainerId, date, schedule = null) {
  const dateCandidates = data.contracts.filter((contract) => contract.studentId === studentId
    && contractCanServeScheduledDate(contract, date))
  if (dateCandidates.some((contract) => !contract.branchId)) return { contract: null, reasons: ['CONTRACT_BRANCH_REQUIRED'] }
  const candidates = dateCandidates.filter((contract) => contract.branchId === data.branch.id)
  if (!candidates.length) return { contract: null, reasons: ['ACTIVE_CONTRACT_NOT_FOUND'] }
  if (candidates.length > 1) return { contract: null, reasons: ['AMBIGUOUS_ACTIVE_CONTRACT'] }
  const contract = candidates[0]
  if (contractPaused(contract, date)) return { contract: null, reasons: ['CONTRACT_PAUSED'] }
  const assigned = assignedTrainerIds(contract)
  if (assigned.length && !assigned.includes(trainerId)) return { contract: null, reasons: ['TRAINER_ASSIGNMENT_MISMATCH'] }
  const activeForContract = data.sessions.filter((session) => session.contractId === contract.id
    && ['scheduled', 'rescheduled'].includes(session.status)
    && session.billingStatus !== 'charged').length
  const draftForContract = schedule && typeof schedule === 'object'
    ? Object.values(schedule).flat().filter((entry) => entry?.type !== 'off'
      && entry?.contractId === contract.id
      && entry?.source !== 'published_existing').length
    : 0
  if (contract.usedSessions + activeForContract + draftForContract >= contract.totalSessions) {
    return { contract: null, reasons: ['CONTRACT_SESSION_QUOTA_EXCEEDED'] }
  }
  return { contract, reasons: [] }
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
  const dailySessionLimit = Math.max(dailySessionTarget, Math.min(16, Math.trunc(Number(trainer?.dailySessionLimit ?? DEFAULT_DAILY_SESSION_LIMIT) || DEFAULT_DAILY_SESSION_LIMIT)))
  const employmentType = ['full_time', 'part_time', 'collaborator'].includes(trainer?.employmentType)
    ? trainer.employmentType
    : 'full_time'
  const employmentLevel = ['probation', 'official', 'senior'].includes(trainer?.employmentLevel)
    ? trainer.employmentLevel
    : 'official'
  return { schedulingPriority, dailySessionTarget, dailySessionLimit, employmentType, employmentLevel }
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
  const [day] = slotId.split('-')
  if (!state.studentDays.has(entry.studentId)) state.studentDays.set(entry.studentId, new Set())
  state.studentDays.get(entry.studentId).add(day)
  const trainerDayKey = `${entry.trainerId}|${day}`
  if (!state.trainerSlotsByDay.has(trainerDayKey)) state.trainerSlotsByDay.set(trainerDayKey, new Set())
  state.trainerSlotsByDay.get(trainerDayKey).add(slotId)
  const trainerSlotKey = `${entry.trainerId}|${slotId}`
  state.trainerSlotCounts.set(trainerSlotKey, (state.trainerSlotCounts.get(trainerSlotKey) || 0) + 1)
  state.trainerStudentSessions.set(entry.trainerId, (state.trainerStudentSessions.get(entry.trainerId) || 0) + 1)
  state.trainerStudentSessionsByDay.set(trainerDayKey, (state.trainerStudentSessionsByDay.get(trainerDayKey) || 0) + 1)
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
  if (student.eligibleForWeek === false) {
    reasons.push(...(Array.isArray(student.eligibilityReasons) && student.eligibilityReasons.length
      ? student.eligibilityReasons
      : ['ACTIVE_CONTRACT_NOT_FOUND']))
  }
  if (Array.isArray(student.validScheduleDates) && !student.validScheduleDates.includes(date)) reasons.push('ACTIVE_CONTRACT_NOT_FOUND')
  if (student.status === 'inactive') reasons.push('STUDENT_NOT_ACTIVE')
  if (student.branchId !== data.branch.id) reasons.push('STUDENT_BRANCH_MISMATCH')
  if (trainer.status === 'inactive') reasons.push('TRAINER_NOT_ACTIVE')
  if (policy.employmentType === 'collaborator') {
    if (!Array.isArray(trainer.availableSlots) || !trainer.availableSlots.length) reasons.push('TRAINER_AVAILABILITY_UNCONFIGURED')
    else if (!trainer.availableSlots.includes(slotId)) reasons.push('OUTSIDE_TRAINER_AVAILABILITY')
  } else if (trainer.availabilityMode === 'unconfigured') reasons.push('TRAINER_AVAILABILITY_UNCONFIGURED')
  else if (!trainerIsAvailable(trainer, slotId)) reasons.push('OUTSIDE_TRAINER_AVAILABILITY')
  if (data.leaves.some((leave) => leaveCovers(leave, trainer.id, date))) reasons.push('TRAINER_ON_LEAVE')
  if (!['submitted', 'locked', 'inherited', 'recurring'].includes(student.availabilityStatus)) reasons.push('AVAILABILITY_NOT_SUBMITTED')
  else if (!student.availableSlots.includes(slotId)) reasons.push('OUTSIDE_STUDENT_AVAILABILITY')
  const contractCacheKey = `${student.id}|${trainer.id}|${date}|${scheduleEntryCount(schedule)}`
  const contractResult = contractCache?.has(contractCacheKey)
    ? contractCache.get(contractCacheKey)
    : resolveContract(data, student.id, trainer.id, date, schedule)
  if (contractCache && !contractCache.has(contractCacheKey)) contractCache.set(contractCacheKey, contractResult)
  reasons.push(...contractResult.reasons)
  if (state.studentDays.get(student.id)?.has(day)) reasons.push('STUDENT_MULTIPLE_SESSIONS_PER_DAY')
  const trainerSlotKey = `${trainer.id}|${slotId}`
  if (state.offTrainerSlots.has(trainerSlotKey)) reasons.push('TRAINER_OFF_CONFLICT')
  const trainerCount = state.trainerSlotCounts.get(trainerSlotKey) || 0
  if (trainerCount >= trainer.slotCapacity) reasons.push('TRAINER_CAPACITY_EXCEEDED')
  const currentDailyLoad = state.trainerSlotsByDay.get(`${trainer.id}|${day}`)?.size || 0
  const opensTeachingSlot = trainerCount === 0
  const projectedDailyLoad = currentDailyLoad + (opensTeachingSlot ? 1 : 0)
  const consecutiveDayPenalty = createsThreeConsecutiveTrainingDays(state.studentDays.get(student.id), day) ? 1 : 0
  return {
    eligible: reasons.length === 0,
    reasons: [...new Set(reasons)],
    contractId: contractResult.contract?.id || null,
    date,
    currentDailyLoad,
    projectedDailyLoad,
    opensTeachingSlot,
    consecutiveDayPenalty,
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

function compareCandidates(left, right) {
  // Spacing is a soft preference: avoid three consecutive training days when
  // another valid slot exists, but never reject the only feasible option.
  if (left.consecutiveDayPenalty !== right.consecutiveDayPenalty) return left.consecutiveDayPenalty - right.consecutiveDayPenalty
  // Filling the second learner into an existing PT slot has zero additional
  // teaching-load cost. It wins even when the compatible PT is a secondary
  // assignment; a PT outside the contract assignment is still rejected by
  // candidateForSlot.
  if (left.opensTeachingSlot !== right.opensTeachingSlot) return Number(left.opensTeachingSlot) - Number(right.opensTeachingSlot)
  if (left.assignmentOrder !== right.assignmentOrder) return left.assignmentOrder - right.assignmentOrder
  const tierComparison = schedulingTier(left) - schedulingTier(right)
  if (tierComparison !== 0) return tierComparison
  const ratioComparison = left.projectedDailyLoad * right.dailySessionTarget - right.projectedDailyLoad * left.dailySessionTarget
  if (ratioComparison !== 0) return ratioComparison
  if (left.schedulingPriority !== right.schedulingPriority) {
    return left.schedulingPriority - right.schedulingPriority
  }
  if (left.score !== right.score) return right.score - left.score
  return compareSlots(left.slotId, right.slotId) || left.trainer.id.localeCompare(right.trainer.id)
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
    score: generationScore({ student, contract, targetDate: result.date }),
    currentDailyLoad: result.currentDailyLoad,
    projectedDailyLoad: result.projectedDailyLoad,
    dailySessionTarget: result.dailySessionTarget,
    schedulingPriority: result.schedulingPriority,
    employmentType: result.employmentType,
    employmentLevel: result.employmentLevel,
    opensTeachingSlot: result.opensTeachingSlot,
    consecutiveDayPenalty: result.consecutiveDayPenalty,
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
    }
    const targetKey = `${candidate.trainer.id}|${candidate.slotId}`
    assignments.set(studentId, candidate)
    occupantsByTarget.set(targetKey, [...(occupantsByTarget.get(targetKey) || []), studentId])
  }

  const tryAssign = (studentId, visitedStudents = new Set(), visitedTargets = new Set()) => {
    if (visitedStudents.has(studentId)) return false
    visitedStudents.add(studentId)
    for (const candidate of candidatesByStudent.get(studentId) || []) {
      const targetKey = `${candidate.trainer.id}|${candidate.slotId}`
      if (visitedTargets.has(targetKey) || (targetCapacity.get(targetKey) || 0) < 1) continue
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

function hasThreeConsecutiveTrainingDays(days) {
  const indexes = new Set([...(days || [])].map((day) => DAY_ORDER.get(day)).filter(Number.isInteger))
  return [...indexes].some((index) => indexes.has(index + 1) && indexes.has(index + 2))
}

function compactPairedSlots(data, inputSchedule) {
  const schedule = Object.fromEntries(Object.entries(inputSchedule).map(([slotId, entries]) => [slotId, [...entries]]))
  const studentsById = new Map(data.students.map((student) => [student.id, student]))
  let changed = true
  let moves = 0
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
          return beforeConsecutive || !hasThreeConsecutiveTrainingDays(nextDays)
        })
        .sort(compareCandidates)
      const selected = candidates[0]
      if (!selected) continue
      schedule[source.slotId] = temporary[source.slotId] || []
      if (!schedule[source.slotId].length) delete schedule[source.slotId]
      schedule[selected.slotId] = [...(temporary[selected.slotId] || []), {
        ...sourceEntry,
        trainerId: selected.trainer.id,
        contractId: selected.contractId,
      }]
      moves += 1
      changed = true
      break
    }
  }
  return { schedule, moves }
}

function blockersForStudent(data, student, schedule, schedulingState, contractCache, capacityReached) {
  const reasons = new Set()
  const suggestedSlots = new Set()
  if (!Array.isArray(student.availableSlots) || !student.availableSlots.length) {
    reasons.add('AVAILABILITY_NOT_SUBMITTED')
  } else {
    for (const slotId of [...student.availableSlots].sort(compareSlots)) {
      for (const trainer of [...data.trainers].sort((left, right) => left.id.localeCompare(right.id))) {
        const result = candidateForSlot(data, { student, trainer, slotId, schedule, schedulingState, contractCache })
        if (result.eligible) suggestedSlots.add(slotId)
        else result.reasons.forEach((reason) => reasons.add(reason))
      }
    }
  }
  if (capacityReached) reasons.add('DRAFT_CAPACITY_REACHED')
  return {
    reasonCodes: [...reasons].sort(),
    suggestedSlots: [...suggestedSlots].sort(compareSlots).slice(0, 5),
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
        && !contractPaused(contract, date)
        && (!assignedTrainerIds(contract).length || assignedTrainerIds(contract).includes(session.trainerId)))
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
    schedule[slotId] = [...values, {
      studentId: session.studentId,
      trainerId: session.trainerId,
      contractId,
      branchId: data.branch.id,
      type: 'training',
      source: 'published_existing',
      ...((session.billingStatus === 'charged' || ['completed', 'attended', 'no_show'].includes(session.status)) ? { isLocked: true } : {}),
    }]
  }
}

function generateSchedule(data) {
  const schedule = {}
  for (const [slotId, entries] of Object.entries(data.schedule || {})) {
    const retained = entries.filter((entry) => entry.type === 'off' || entry.isLocked === true)
    if (retained.length) schedule[slotId] = retained
  }
  const warnings = data.trainers
    .filter((trainer) => trainer.availabilityMode === 'unconfigured')
    .map((trainer) => ({ code: 'TRAINER_AVAILABILITY_UNCONFIGURED', trainerId: trainer.id }))
  // A previously published learner session is real workload. Keep it in the
  // next draft so it contributes once to coverage and to the PT's unique
  // trainer/date/hour load instead of being silently replaced or double-counted.
  mergePublishedSessions(data, schedule, warnings)
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
      schedule[candidate.slotId] = [...(schedule[candidate.slotId] || []), {
        studentId: student.id,
        trainerId: candidate.trainer.id,
        contractId: candidate.contractId,
        branchId: data.branch.id,
        type: 'training',
        source: 'auto_v4',
      }]
      scheduledCounts.set(student.id, (scheduledCounts.get(student.id) || 0) + 1)
      remainingByStudent.set(student.id, Math.max(0, (remainingByStudent.get(student.id) || 0) - 1))
      entryCount += 1
      committed += 1
    }
    return committed
  }

  // Maximum-cardinality first-session round. Augmenting paths can move a
  // flexible learner away from the only slot of a constrained learner.
  commitRound(students.filter((student) => (scheduledCounts.get(student.id) || 0) === 0
    && (remainingByStudent.get(student.id) || 0) > 0))

  // Later rounds remain fair (one seat per learner per round) while maximizing
  // the number of fulfilled weekly targets in each round.
  let progress = true
  while (!capacityReached && progress) {
    const roundStudents = students.filter((student) => (remainingByStudent.get(student.id) || 0) > 0)
    if (!roundStudents.length) break
    progress = commitRound(roundStudents) > 0
  }

  // A final safe compaction moves only mutable generated entries and strictly
  // reduces the number of teaching slots by filling compatible 1/2 classes.
  const compacted = compactPairedSlots(data, schedule)
  Object.keys(schedule).forEach((slotId) => delete schedule[slotId])
  Object.assign(schedule, compacted.schedule)
  const schedulingState = buildSchedulingState(schedule)
  const contractCache = new Map()

  const unassignedEntries = []
  for (const student of students) {
    const missingSessions = remainingByStudent.get(student.id) || 0
    if (missingSessions < 1) continue
    const blockers = blockersForStudent(data, student, schedule, schedulingState, contractCache, capacityReached)
    const unassigned = {
      studentId: student.id,
      studentName: student.name,
      missingSessions,
      blockerType: blockers.suggestedSlots.length ? 'optimizer_gap' : 'input_or_capacity',
      ...blockers,
    }
    unassignedEntries.push(unassigned)
    warnings.push({ code: 'STUDENT_UNSCHEDULED', ...unassigned })
  }
  if (capacityReached) warnings.unshift({ code: 'DRAFT_CAPACITY_REACHED', entryCount, maxEntries: MAX_DRAFT_ENTRIES })
  const optimizationSummary = {
    studentCoverage: studentCoverageForSchedule(data, schedule),
    trainerLoads: trainerLoadsForSchedule(data, schedule, schedulingState),
    slotUtilization: slotUtilizationForSchedule(data, schedule),
    pairingMoves: compacted.moves,
  }
  return { schedule, warnings, optimizationSummary, unassignedEntries }
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

function createPtScheduleV2Functions({ db, onCall }) {
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
    await scheduleActor(request, db, branchId)
    const data = await loadBranchData(db, branchId, week)
    const scheduledByStudent = new Map()
    for (const entry of Object.values(data.schedule).flat()) {
      if (entry.type === 'off') continue
      scheduledByStudent.set(entry.studentId, (scheduledByStudent.get(entry.studentId) || 0) + 1)
    }
    const eligibleStudents = data.students.filter((student) => student.eligibleForWeek === true)
    const missingSessions = eligibleStudents.reduce((total, student) => total + Math.max(0, student.sessionsPerWeek - (scheduledByStudent.get(student.id) || 0)), 0)
    const draftSnapshot = await draftReference(db, branchId, week).get()
    const draftData = draftSnapshot.exists ? draftSnapshot.data() : {}
    const workloadSchedule = safeSchedule(data.schedule)
    mergePublishedSessions({ ...data, weekId: week }, workloadSchedule, [])
    const calculatedOptimizationSummary = {
      studentCoverage: studentCoverageForSchedule({ ...data, weekId: week }, workloadSchedule),
      trainerLoads: trainerLoadsForSchedule({ ...data, weekId: week }, workloadSchedule),
      slotUtilization: slotUtilizationForSchedule({ ...data, weekId: week }, workloadSchedule),
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
      schedule: data.schedule,
      students: data.students,
      trainers: data.trainers,
      contracts: data.contracts,
      sessions: data.sessions,
      scheduleConfig: data.config,
      warnings: Array.isArray(draftData.warnings) ? draftData.warnings.slice(0, 100) : [],
      // Always derive live workload from the current draft and current trainer
      // policy. Stored summaries are audit snapshots and may predate a policy edit.
      optimizationSummary: calculatedOptimizationSummary,
      unassignedEntries: Array.isArray(draftData.unassignedEntries) ? draftData.unassignedEntries.slice(0, MAX_STUDENTS) : [],
      summary: {
        eligibleStudents: eligibleStudents.length,
        trainers: data.trainers.length,
        unconfiguredTrainers: data.trainers.filter((trainer) => trainer.availabilityMode === 'unconfigured').length,
        scheduledEntries: Object.values(data.schedule).flat().filter((entry) => entry.type !== 'off').length,
        missingSessions,
        unassignedEntries: Array.isArray(draftData.unassignedEntries) ? draftData.unassignedEntries.length : 0,
      },
    }
  })

  const generatePtScheduleDraft = onCall(async (request) => {
    const week = weekId(request.data?.weekId)
    const branchId = documentId(request.data?.branchId, 'Mã chi nhánh')
    const expectedRevision = Number(request.data?.expectedDraftRevision)
    if (!Number.isInteger(expectedRevision) || expectedRevision < 0) throw new HttpsError('invalid-argument', 'Phiên bản draft không hợp lệ.')
    const actor = await scheduleActor(request, db, branchId)
    const data = await loadBranchData(db, branchId, week)
    const generated = generateSchedule({ ...data, weekId: week })
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
        generatorVersion: 'optimizer-v4',
        warnings: generated.warnings,
        optimizationSummary: generated.optimizationSummary,
        unassignedEntries: generated.unassignedEntries,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: actor.uid,
        createdAt: current.exists ? current.data().createdAt || FieldValue.serverTimestamp() : FieldValue.serverTimestamp(),
      }, { merge: true })
      transaction.create(db.collection('ptOperationsAuditLogs').doc(), { schemaVersion: 2, action: 'pt_schedule.generated', actorUid: actor.uid, branchId, weekId: week, previousDraftRevision: revision, nextDraftRevision: nextRevision, entryCount: scheduleEntryCount(generated.schedule), studentCoverage: generated.optimizationSummary.studentCoverage, slotUtilization: generated.optimizationSummary.slotUtilization, unassignedCount: generated.unassignedEntries.length, warnings: generated.warnings.slice(0, 100), createdAt: FieldValue.serverTimestamp() })
      return { draftRevision: nextRevision, schedule: generated.schedule, warnings: generated.warnings, optimizationSummary: generated.optimizationSummary, unassignedEntries: generated.unassignedEntries, generatorVersion: 'optimizer-v4' }
    })
  })

  const getPtScheduleSlotCandidates = onCall(async (request) => {
    const week = weekId(request.data?.weekId)
    const branchId = documentId(request.data?.branchId, 'Mã chi nhánh')
    const trainerId = documentId(request.data?.trainerId, 'Mã PT')
    const slotId = typeof request.data?.slotId === 'string' ? request.data.slotId : ''
    if (!/^(T[2-7]|CN)-(?:[0-9]|1[0-9]|2[0-3])$/.test(slotId)) throw new HttpsError('invalid-argument', 'Ô lịch không hợp lệ.')
    await scheduleActor(request, db, branchId)
    const data = await loadBranchData(db, branchId, week)
    data.weekId = week
    const trainer = data.trainers.find((item) => item.id === trainerId)
    if (!trainer) throw new HttpsError('not-found', 'Không tìm thấy PT trong chi nhánh.')
    const search = typeof request.data?.search === 'string' ? request.data.search.trim().toLocaleLowerCase('vi').slice(0, 100) : ''
    return {
      schemaVersion: 2,
      candidates: data.students.filter((student) => !search || student.name.toLocaleLowerCase('vi').includes(search) || student.phone.includes(search)).map((student) => ({
        studentId: student.id,
        name: student.name,
        phone: student.phone,
        ...manualSlotCandidate(candidateForSlot(data, { student, trainer, slotId, schedule: data.schedule })),
      })).sort((left, right) => {
        const rank = (candidate) => candidate.eligible ? 0 : candidate.manualSelectable ? 1 : 2
        return rank(left) - rank(right) || left.name.localeCompare(right.name, 'vi')
      }).slice(0, 100),
    }
  })

  const savePtStudentAvailability = onCall(async (request) => {
    const week = weekId(request.data?.weekId)
    const branchId = documentId(request.data?.branchId, 'Mã chi nhánh')
    const studentId = documentId(request.data?.studentId, 'Mã học viên')
    const expectedRevision = Number(request.data?.expectedRevision)
    if (!Number.isInteger(expectedRevision) || expectedRevision < 0) throw new HttpsError('invalid-argument', 'Phiên bản lịch rảnh không hợp lệ.')
    const actor = await scheduleActor(request, db, branchId)
    const [studentSnapshot, configSnapshot] = await Promise.all([
      db.doc(`students/${studentId}`).get(),
      db.doc('settings/scheduleConfig').get(),
    ])
    if (!studentSnapshot.exists || studentSnapshot.data().branchId !== branchId) {
      throw new HttpsError('not-found', 'Không tìm thấy học viên trong chi nhánh đang xếp lịch.')
    }
    const config = {
      workingDays: Array.isArray(configSnapshot.data()?.workingDays) && configSnapshot.data().workingDays.length
        ? configSnapshot.data().workingDays.filter((day) => DAY_ORDER.has(day))
        : [...DAY_ORDER.keys()].filter((day) => day !== 'CN'),
      workingHours: Array.isArray(configSnapshot.data()?.workingHours) && configSnapshot.data().workingHours.length
        ? configSnapshot.data().workingHours.map(Number).filter((hour) => Number.isInteger(hour) && hour >= 0 && hour <= 23)
        : Array.from({ length: 15 }, (_, index) => index + 6),
    }
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
    const actor = await scheduleActor(request, db, branchId)
    const data = await loadBranchData(db, branchId, week)
    data.weekId = week
    const payload = request.data?.payload && typeof request.data.payload === 'object' ? request.data.payload : {}
    const slotId = typeof payload.slotId === 'string' ? payload.slotId : ''
    const fromSlotId = typeof payload.fromSlotId === 'string' ? payload.fromSlotId : ''
    const slotPattern = /^(T[2-7]|CN)-(?:[0-9]|1[0-9]|2[0-3])$/
    const commandWithoutSlot = command === 'set_student_weekly_target' || command === 'reset_draft'
    if (!commandWithoutSlot && !slotPattern.test(slotId)) throw new HttpsError('invalid-argument', 'Ô lịch không hợp lệ.')
    if (command === 'move_student' && !slotPattern.test(fromSlotId)) throw new HttpsError('invalid-argument', 'Ô lịch nguồn không hợp lệ.')
    const trainerId = commandWithoutSlot ? '' : documentId(payload.trainerId, 'Mã PT')
    const studentId = command.includes('student') || command.includes('entry') ? documentId(payload.studentId, 'Mã học viên') : ''
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
    const reference = draftReference(db, branchId, week)
    const receipt = db.doc(`ptScheduleCommandReceipts/${commandReceiptId(actor.uid, branchId, week, idempotencyKey)}`)
    let schedule = safeSchedule(data.schedule)
    let availabilityOverrideMetadata = null
    if (command === 'add_student' || command === 'move_student') {
      const trainer = data.trainers.find((item) => item.id === trainerId)
      const student = data.students.find((item) => item.id === studentId)
      if (!trainer || !student) throw new HttpsError('not-found', 'Không tìm thấy PT hoặc học viên trong phạm vi.')
      const candidateSchedule = command === 'move_student'
        ? Object.fromEntries(Object.entries(schedule).map(([key, entries]) => [
          key,
          key === fromSlotId ? entries.filter((entry) => entry.studentId !== studentId) : entries,
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
      const values = Array.isArray(schedule[slotId]) ? [...schedule[slotId]] : []
      const currentWeeklyTargets = safeWeeklySessionTargets(current.exists ? current.data()?.weeklySessionTargets : {}, new Set(data.students.map((item) => item.id)))
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
      if (command === 'add_student') values.push({ studentId, trainerId, branchId, type: 'training', contractId: resolveContract(data, studentId, trainerId, dateForSlot(week, slotId.split('-')[0])).contract?.id || '', source: 'manual_v2', ...(availabilityOverrideMetadata || {}) })
      if (command === 'remove_student') schedule[slotId] = values.filter((entry) => !(entry.studentId === studentId && entry.trainerId === trainerId))
      if (command === 'move_student') {
        schedule[fromSlotId] = (schedule[fromSlotId] || []).filter((entry) => entry.studentId !== studentId)
        values.push({ studentId, trainerId, branchId, type: 'training', contractId: resolveContract(data, studentId, trainerId, dateForSlot(week, slotId.split('-')[0])).contract?.id || '', source: 'manual_v2', ...(availabilityOverrideMetadata || {}) })
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
      transaction.create(db.collection('ptOperationsAuditLogs').doc(), { schemaVersion: 2, action: `pt_schedule.${command}`, actorUid: actor.uid, branchId, weekId: week, previousDraftRevision: revision, nextDraftRevision: nextRevision, affectedStudentCount: command === 'set_student_weekly_target' ? 1 : command === 'reset_draft' ? resetStudentIds.length : (command === 'add_student' || command === 'move_student') ? 1 : requeuedEntries.length, studentId: command.includes('student') ? studentId : null, weeklyTarget: command === 'set_student_weekly_target' ? (resetWeeklyTarget ? null : weeklyTarget) : null, availabilityOverride: Boolean(availabilityOverrideMetadata), availabilityOverrideReason: availabilityOverrideMetadata?.availabilityOverrideReason || null, reason: typeof request.data?.reason === 'string' ? request.data.reason.trim().slice(0, 300) : '', createdAt: FieldValue.serverTimestamp() })
      return result
    })
  })

  return { listPtScheduleBranches, getPtScheduleWorkspace, generatePtScheduleDraft, getPtScheduleSlotCandidates, savePtStudentAvailability, applyPtScheduleDraftCommand }
}

module.exports = {
  DEFAULT_DAILY_SESSION_LIMIT,
  DEFAULT_DAILY_SESSION_TARGET,
  MAX_DRAFT_ENTRIES,
  MAX_DRAFT_DOCUMENT_ENTRIES,
  createPtScheduleV2Functions,
  candidateForSlot,
  compactPairedSlots,
  createsThreeConsecutiveTrainingDays,
  generateSchedule,
  manualSlotCandidate,
  resetDraftSchedule,
  resolveContract,
  safeSchedule,
  safeWeeklySessionTargets,
  slotUtilizationForSchedule,
  studentWeekEligibility,
  trainerLoadsForSchedule,
  trainerSchedulingPolicy,
  weeklyTargetForStudent,
}
