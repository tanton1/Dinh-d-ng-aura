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

const MAX_STUDENTS = 500
const MAX_TRAINERS = 100
// Keep the whole publish diff below Firestore's 500-write transaction limit.
// Real Aura branches currently contain more than 180 entries per week, so the
// previous guard rejected valid migrated drafts before the workspace loaded.
const MAX_DRAFT_ENTRIES = 400
const MAX_ENTRIES_PER_SLOT = 100
const DAY_ORDER = new Map([['T2', 0], ['T3', 1], ['T4', 2], ['T5', 3], ['T6', 4], ['T7', 5], ['CN', 6]])

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
  let count = 0
  for (const [slotId, entries] of Object.entries(value)) {
    if (!/^(T[2-7]|CN)-(?:[0-9]|1[0-9]|2[0-3])$/.test(slotId) || !Array.isArray(entries)) continue
    if (entries.length > MAX_ENTRIES_PER_SLOT) throw new HttpsError('resource-exhausted', 'Một khung giờ có quá nhiều dữ liệu.')
    const normalized = entries.map((entry) => ({
      studentId: entry?.type === 'off' ? 'OFF' : String(entry?.studentId || ''),
      trainerId: String(entry?.trainerId || ''),
      branchId: String(entry?.branchId || ''),
      type: entry?.type === 'off' ? 'off' : 'training',
      ...(entry?.contractId ? { contractId: String(entry.contractId) } : {}),
      ...(entry?.isLocked === true ? { isLocked: true } : {}),
      ...(entry?.source ? { source: String(entry.source) } : {}),
    })).filter((entry) => entry.trainerId && (entry.type === 'off' || entry.studentId))
    count += normalized.length
    if (normalized.length) result[slotId] = normalized
  }
  if (count > MAX_DRAFT_ENTRIES) throw new HttpsError('resource-exhausted', 'Draft vượt giới hạn an toàn.')
  return result
}

function splitChunks(values, size = 30) {
  const result = []
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size))
  return result
}

async function contractsForStudents(db, studentIds) {
  if (!studentIds.length) return []
  const snapshots = await Promise.all(splitChunks(studentIds).map((ids) => db.collection('contracts')
    .where('studentId', 'in', ids)
    .where('status', '==', 'active')
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
  const [branch, legacySchedule, draft, students, trainers, availability, sessions, config, leaves] = await Promise.all([
    db.doc(`branches/${branchId}`).get(),
    db.doc(`schedules/schedule_${week}`).get(),
    draftReference(db, branchId, week).get(),
    db.collection('students').where('branchId', '==', branchId).limit(MAX_STUDENTS + 1).get(),
    db.collection('trainers').where('branchId', '==', branchId).limit(MAX_TRAINERS + 1).get(),
    db.collection('ptAvailability').where('weekId', '==', week).limit(MAX_STUDENTS + 1).get(),
    db.collection('sessions').where('date', '>=', week).where('date', '<', nextWeek(week)).limit(1001).get(),
    db.doc('settings/scheduleConfig').get(),
    db.collection('leaveRequests').where('status', '==', 'approved').limit(1001).get(),
  ])
  if (!branch.exists || branch.data().status === 'archived') throw new HttpsError('failed-precondition', 'Chi nhánh không hoạt động.')
  if (students.size > MAX_STUDENTS || trainers.size > MAX_TRAINERS || availability.size > MAX_STUDENTS || sessions.size > 1000 || leaves.size > 1000) {
    throw new HttpsError('resource-exhausted', 'Dữ liệu chi nhánh vượt giới hạn workspace an toàn.')
  }
  const studentIds = students.docs.map((item) => item.id)
  const trainerIds = new Set(trainers.docs.map((item) => item.id))
  const studentSet = new Set(studentIds)
  const contracts = await contractsForStudents(db, studentIds)
  const studentMap = new Map(students.docs.map((item) => [item.id, item.data()]))
  const trainerMap = new Map(trainers.docs.map((item) => [item.id, item.data()]))
  const weeklyAvailability = new Map(availability.docs.map((item) => item.data()).filter((item) => studentSet.has(item.studentId)).map((item) => [item.studentId, item]))
  const legacy = legacySchedule.exists ? legacySchedule.data() : {}
  const draftData = draft.exists ? draft.data() : null
  const weeklySessionTargets = safeWeeklySessionTargets(draftData?.weeklySessionTargets, studentSet)
  const schedule = draftData
    ? safeSchedule(draftData.schedule)
    : branchScheduleSnapshot(legacy.schedule || {}, branchId, studentMap, trainerMap)
  const mappedContracts = contracts.map((contract) => ({
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
  }))
  const mappedStudents = students.docs.map((item) => {
    const data = item.data()
    const weekly = weeklyAvailability.get(item.id)
    const recurringSlots = Array.isArray(data.availableSlots) ? data.availableSlots.slice(0, 100) : []
    const recurringConfirmed = !weekly && data.isScheduleConfirmed === true && recurringSlots.length > 0
    const availabilityStatus = weekly?.status || (recurringConfirmed ? 'recurring' : 'missing')
    const eligibility = studentWeekEligibility(mappedContracts, item.id, branchId, week)
    const studentInactive = ['inactive', 'archived', 'deleted'].includes(String(data.status || '').toLowerCase())
    const defaultSessionsPerWeek = Math.max(0, Math.min(7, Number(data.sessionsPerWeek || 0)))
    const weeklySessionTargetOverride = Object.prototype.hasOwnProperty.call(weeklySessionTargets, item.id)
      ? weeklySessionTargets[item.id]
      : null
    const maxWeeklySessions = Math.max(0, Math.min(7, eligibility.validDates.length, eligibility.remainingSessions))
    const requestedSessions = weeklySessionTargetOverride ?? defaultSessionsPerWeek
    const effectiveSessionsPerWeek = Math.min(requestedSessions, maxWeeklySessions)
    return {
      id: item.id,
      name: data.name || 'Chưa cập nhật tên',
      phone: data.phone || '',
      email: data.email || '',
      status: data.status || 'active',
      branchId,
      sessionsPerWeek: effectiveSessionsPerWeek,
      defaultSessionsPerWeek,
      weeklySessionTargetOverride,
      weeklySessionTargetOverridden: weeklySessionTargetOverride !== null,
      maxWeeklySessions,
      availableSlots: Array.isArray(weekly?.slots) ? weekly.slots.slice(0, 100) : recurringSlots,
      availabilityStatus,
      availabilitySource: weekly ? 'weekly' : recurringConfirmed ? 'legacy_recurring' : 'none',
      isScheduleConfirmed: ['submitted', 'locked', 'recurring'].includes(availabilityStatus),
      eligibleForWeek: !studentInactive && eligibility.eligible,
      eligibilityReasons: studentInactive
        ? ['STUDENT_NOT_ACTIVE', ...eligibility.reasonCodes]
        : eligibility.reasonCodes,
      eligibleContractIds: eligibility.eligibleContractIds,
      validScheduleDates: eligibility.validDates,
      pausedScheduleDates: eligibility.pausedDates,
    }
  })
  const mappedTrainers = trainers.docs.map((item) => {
    const data = item.data()
    return {
      id: item.id,
      name: data.name || 'PT chưa cập nhật tên',
      phone: data.phone || '',
      email: data.email || '',
      status: data.status || 'active',
      branchId,
      availableSlots: Array.isArray(data.availableSlots) ? data.availableSlots.slice(0, 100) : [],
      availabilityMode: trainerAvailabilityMode(data),
      availabilityRevision: Number(data.availabilityRevision || 0),
      slotCapacity: normalizedCapacity(data.slotCapacity),
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
    sessions: sessions.docs.map((item) => ({ id: item.id, ...item.data() })).filter((item) => item.branchId === branchId),
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

function studentWeekEligibility(contracts, studentId, branchId, week, referenceDate = todayInHoChiMinh()) {
  const reasons = new Set()
  const activeContracts = contracts.filter((contract) => contract.studentId === studentId && contract.status === 'active')
  if (!activeContracts.length) reasons.add('ACTIVE_CONTRACT_NOT_FOUND')

  const branchContracts = activeContracts.filter((contract) => {
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

  for (const contract of branchContracts) {
    const startDate = storedDate(contract.startDate)
    const endDate = storedDate(contract.endDate)
    if (!startDate || !endDate) continue
    const contractRemainingSessions = Math.max(0, Number(contract.totalSessions || 0) - Number(contract.usedSessions || 0))
    if (contractRemainingSessions > 0) hasRemainingSessions = true
    let contractUsableInWeek = false
    for (const date of dates) {
      if (date < startDate || date > endDate) continue
      overlapsWeek = true
      if (contractRemainingSessions < 1) continue
      if (contractPaused(contract, date)) {
        pausedDates.push(date)
        continue
      }
      validDates.push(date)
      eligibleContractIds.add(contract.id)
      contractUsableInWeek = true
    }
    if (contractUsableInWeek) remainingSessionQuota += contractRemainingSessions
  }

  if (branchContracts.length && !overlapsWeek) reasons.add('ACTIVE_CONTRACT_NOT_FOUND')
  if (branchContracts.length && !hasRemainingSessions) reasons.add('CONTRACT_SESSION_QUOTA_EXCEEDED')
  if (overlapsWeek && hasRemainingSessions && !validDates.length && pausedDates.length) reasons.add('CONTRACT_PAUSED')

  for (const date of [...new Set(validDates)]) {
    const matching = branchContracts.filter((contract) => Number(contract.totalSessions || 0) > Number(contract.usedSessions || 0)
      && storedDate(contract.startDate) <= date
      && storedDate(contract.endDate) >= date
      && !contractPaused(contract, date))
    if (matching.length > 1) reasons.add('AMBIGUOUS_ACTIVE_CONTRACT')
  }

  return {
    eligible: validDates.length > 0,
    reasonCodes: [...reasons],
    eligibleContractIds: [...eligibleContractIds],
    validDates: [...new Set(validDates)].sort(),
    pausedDates: [...new Set(pausedDates)].sort(),
    remainingSessions: remainingSessionQuota,
  }
}

function resolveContract(data, studentId, trainerId, date) {
  const dateCandidates = data.contracts.filter((contract) => contract.studentId === studentId
    && contract.status === 'active'
    && storedDate(contract.startDate) <= date
    && storedDate(contract.endDate) >= date)
  if (dateCandidates.some((contract) => !contract.branchId)) return { contract: null, reasons: ['CONTRACT_BRANCH_REQUIRED'] }
  const candidates = dateCandidates.filter((contract) => contract.branchId === data.branch.id)
  if (!candidates.length) return { contract: null, reasons: ['ACTIVE_CONTRACT_NOT_FOUND'] }
  if (candidates.length > 1) return { contract: null, reasons: ['AMBIGUOUS_ACTIVE_CONTRACT'] }
  const contract = candidates[0]
  if (contractPaused(contract, date)) return { contract: null, reasons: ['CONTRACT_PAUSED'] }
  const assigned = contract.trainerIds.length ? contract.trainerIds : contract.trainerId ? [contract.trainerId] : []
  if (assigned.length && !assigned.includes(trainerId)) return { contract: null, reasons: ['TRAINER_ASSIGNMENT_MISMATCH'] }
  const activeForContract = data.sessions.filter((session) => session.contractId === contract.id
    && ['scheduled', 'rescheduled'].includes(session.status)
    && session.billingStatus !== 'charged').length
  if (contract.usedSessions + activeForContract >= contract.totalSessions) return { contract: null, reasons: ['CONTRACT_SESSION_QUOTA_EXCEEDED'] }
  return { contract, reasons: [] }
}

function candidateForSlot(data, { student, trainer, slotId, schedule }) {
  const [day] = slotId.split('-')
  const date = dateForSlot(data.weekId, day)
  const reasons = []
  if (student.eligibleForWeek === false) {
    reasons.push(...(Array.isArray(student.eligibilityReasons) && student.eligibilityReasons.length
      ? student.eligibilityReasons
      : ['ACTIVE_CONTRACT_NOT_FOUND']))
  }
  if (Array.isArray(student.validScheduleDates) && !student.validScheduleDates.includes(date)) reasons.push('ACTIVE_CONTRACT_NOT_FOUND')
  if (student.status === 'inactive') reasons.push('STUDENT_NOT_ACTIVE')
  if (student.branchId !== data.branch.id) reasons.push('STUDENT_BRANCH_MISMATCH')
  if (trainer.status === 'inactive') reasons.push('TRAINER_NOT_ACTIVE')
  if (trainer.availabilityMode === 'unconfigured') reasons.push('TRAINER_AVAILABILITY_UNCONFIGURED')
  else if (!trainerIsAvailable(trainer, slotId)) reasons.push('OUTSIDE_TRAINER_AVAILABILITY')
  if (data.leaves.some((leave) => leaveCovers(leave, trainer.id, date))) reasons.push('TRAINER_ON_LEAVE')
  if (!['submitted', 'locked', 'recurring'].includes(student.availabilityStatus)) reasons.push('AVAILABILITY_NOT_SUBMITTED')
  else if (!student.availableSlots.includes(slotId)) reasons.push('OUTSIDE_STUDENT_AVAILABILITY')
  const contractResult = resolveContract(data, student.id, trainer.id, date)
  reasons.push(...contractResult.reasons)
  const entries = Object.entries(schedule || {})
  if (entries.some(([candidateSlot, values]) => candidateSlot.startsWith(day) && values.some((entry) => entry.type !== 'off' && entry.studentId === student.id))) reasons.push('STUDENT_MULTIPLE_SESSIONS_PER_DAY')
  const slotEntries = Array.isArray(schedule?.[slotId]) ? schedule[slotId] : []
  if (slotEntries.some((entry) => entry.type === 'off' && entry.trainerId === trainer.id)) reasons.push('TRAINER_OFF_CONFLICT')
  const trainerCount = slotEntries.filter((entry) => entry.type !== 'off' && entry.trainerId === trainer.id).length
  if (trainerCount >= trainer.slotCapacity) reasons.push('TRAINER_CAPACITY_EXCEEDED')
  return { eligible: reasons.length === 0, reasons: [...new Set(reasons)], contractId: contractResult.contract?.id || null, date }
}

function scheduleEntryCount(schedule) {
  return Object.values(schedule || {}).reduce((total, entries) => total + (Array.isArray(entries) ? entries.length : 0), 0)
}

function generationScore({ student, trainer, contract, slotId, schedule, targetDate }) {
  const end = Date.parse(`${storedDate(contract?.endDate)}T00:00:00Z`)
  const reference = Date.parse(`${targetDate}T00:00:00Z`)
  const urgency = Number.isFinite(end) && Number.isFinite(reference)
    ? Math.max(0, 365 - Math.floor((end - reference) / 86400000))
    : 0
  const scarcity = Math.max(0, 100 - student.availableSlots.length * 8)
  const assigned = contract?.trainerIds?.[0] === trainer.id || contract?.trainerId === trainer.id ? 80 : 0
  const load = (schedule[slotId] || []).filter((entry) => entry.trainerId === trainer.id && entry.type !== 'off').length
  return urgency + scarcity + assigned - load * 15
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
  let entryCount = scheduleEntryCount(schedule)
  let capacityReached = entryCount >= MAX_DRAFT_ENTRIES
  const students = [...data.students].sort((left, right) => left.availableSlots.length - right.availableSlots.length || left.name.localeCompare(right.name, 'vi'))
  for (const student of students) {
    if (student.status === 'inactive' || student.eligibleForWeek === false) continue
    const existing = Object.values(schedule).flat().filter((entry) => entry.type !== 'off' && entry.studentId === student.id).length
    let remaining = Math.max(0, student.sessionsPerWeek - existing)
    while (remaining > 0) {
      if (entryCount >= MAX_DRAFT_ENTRIES) {
        capacityReached = true
        break
      }
      const candidates = []
      for (const slotId of student.availableSlots) {
        for (const trainer of data.trainers) {
          const result = candidateForSlot(data, { student, trainer, slotId, schedule })
          if (!result.eligible) continue
          const contract = data.contracts.find((item) => item.id === result.contractId)
          candidates.push({
            slotId,
            trainer,
            contractId: result.contractId,
            score: generationScore({ student, trainer, contract, slotId, schedule, targetDate: result.date }),
          })
        }
      }
      candidates.sort((left, right) => right.score - left.score || left.slotId.localeCompare(right.slotId) || left.trainer.id.localeCompare(right.trainer.id))
      const selected = candidates[0]
      if (!selected) break
      schedule[selected.slotId] = [...(schedule[selected.slotId] || []), {
        studentId: student.id,
        trainerId: selected.trainer.id,
        contractId: selected.contractId,
        branchId: data.branch.id,
        type: 'training',
        source: 'auto_v2',
      }]
      entryCount += 1
      remaining -= 1
    }
    if (remaining > 0) warnings.push({ code: 'STUDENT_UNSCHEDULED', studentId: student.id, missingSessions: remaining })
  }
  if (capacityReached) warnings.unshift({ code: 'DRAFT_CAPACITY_REACHED', entryCount, maxEntries: MAX_DRAFT_ENTRIES })
  return { schedule, warnings }
}

function commandReceiptId(actorUid, branchId, week, idempotencyKey) {
  return createHash('sha256').update(`${actorUid}|${branchId}|${week}|${idempotencyKey}`).digest('hex')
}

function commandInput(value) {
  const supported = new Set(['add_student', 'remove_student', 'move_student', 'set_trainer_off', 'clear_trainer_off', 'lock_entry', 'unlock_entry', 'set_student_weekly_target'])
  const command = typeof value === 'string' ? value : ''
  if (!supported.has(command)) throw new HttpsError('invalid-argument', 'Lệnh chỉnh lịch không hợp lệ.')
  return command
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
        generatorVersion: 'greedy-v2',
        warnings: generated.warnings,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: actor.uid,
        createdAt: current.exists ? current.data().createdAt || FieldValue.serverTimestamp() : FieldValue.serverTimestamp(),
      }, { merge: true })
      transaction.create(db.collection('ptOperationsAuditLogs').doc(), { schemaVersion: 2, action: 'pt_schedule.generated', actorUid: actor.uid, branchId, weekId: week, previousDraftRevision: revision, nextDraftRevision: nextRevision, entryCount: scheduleEntryCount(generated.schedule), warnings: generated.warnings.slice(0, 100), createdAt: FieldValue.serverTimestamp() })
      return { draftRevision: nextRevision, schedule: generated.schedule, warnings: generated.warnings, generatorVersion: 'greedy-v2' }
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
      candidates: data.students.filter((student) => !search || student.name.toLocaleLowerCase('vi').includes(search) || student.phone.includes(search)).slice(0, 100).map((student) => ({
        studentId: student.id,
        name: student.name,
        phone: student.phone,
        ...candidateForSlot(data, { student, trainer, slotId, schedule: data.schedule }),
      })).sort((left, right) => Number(right.eligible) - Number(left.eligible) || left.name.localeCompare(right.name, 'vi')),
    }
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
    if (command !== 'set_student_weekly_target' && !slotPattern.test(slotId)) throw new HttpsError('invalid-argument', 'Ô lịch không hợp lệ.')
    if (command === 'move_student' && !slotPattern.test(fromSlotId)) throw new HttpsError('invalid-argument', 'Ô lịch nguồn không hợp lệ.')
    const trainerId = command === 'set_student_weekly_target' ? '' : documentId(payload.trainerId, 'Mã PT')
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
      throw new HttpsError('failed-precondition', `Tuần này chỉ có thể xếp tối đa ${targetStudent.maxWeeklySessions} buổi theo thời hạn và quota hợp đồng.`, { issueCode: 'WEEKLY_TARGET_EXCEEDS_QUOTA' })
    }
    const reference = draftReference(db, branchId, week)
    const receipt = db.doc(`ptScheduleCommandReceipts/${commandReceiptId(actor.uid, branchId, week, idempotencyKey)}`)
    let schedule = safeSchedule(data.schedule)
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
      const result = candidateForSlot(data, { student, trainer, slotId, schedule: candidateSchedule })
      if (!result.eligible) throw new HttpsError('failed-precondition', 'Học viên chưa đủ điều kiện vào ô lịch.', { issueCode: 'SLOT_CANDIDATE_REJECTED', errors: result.reasons })
    }
    return db.runTransaction(async (transaction) => {
      const [current, existingReceipt] = await Promise.all([transaction.get(reference), transaction.get(receipt)])
      if (existingReceipt.exists) return existingReceipt.data().result
      const revision = Number(current.exists ? current.data()?.revision || 0 : data.draft.revision)
      if (revision !== expectedRevision) throw new HttpsError('aborted', 'Draft đã thay đổi. Hãy tải lại trước khi chỉnh.')
      schedule = safeSchedule(current.exists ? current.data().schedule : data.schedule)
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
      if (command === 'add_student') values.push({ studentId, trainerId, branchId, type: 'training', contractId: resolveContract(data, studentId, trainerId, dateForSlot(week, slotId.split('-')[0])).contract?.id || '', source: 'manual_v2' })
      if (command === 'remove_student') schedule[slotId] = values.filter((entry) => !(entry.studentId === studentId && entry.trainerId === trainerId))
      if (command === 'move_student') {
        schedule[fromSlotId] = (schedule[fromSlotId] || []).filter((entry) => entry.studentId !== studentId)
        values.push({ studentId, trainerId, branchId, type: 'training', contractId: resolveContract(data, studentId, trainerId, dateForSlot(week, slotId.split('-')[0])).contract?.id || '', source: 'manual_v2' })
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
      if (scheduleEntryCount(schedule) > MAX_DRAFT_ENTRIES) throw new HttpsError('resource-exhausted', 'Draft vượt giới hạn an toàn.')
      const nextRevision = revision + 1
      const result = { draftRevision: nextRevision, schedule, weeklySessionTargets: currentWeeklyTargets }
      const currentUnassigned = Array.isArray(current.data()?.unassignedEntries) ? current.data().unassignedEntries : []
      const unassignedEntries = [...currentUnassigned, ...requeuedEntries].slice(-200)
      transaction.set(reference, {
        schemaVersion: 2,
        branchId,
        weekId: week,
        schedule,
        revision: nextRevision,
        status: 'draft',
        unassignedEntries,
        weeklySessionTargets: currentWeeklyTargets,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: actor.uid,
        createdAt: current.exists ? current.data().createdAt || FieldValue.serverTimestamp() : FieldValue.serverTimestamp(),
      }, { merge: true })
      transaction.create(receipt, { actorUid: actor.uid, branchId, weekId: week, command, idempotencyKey, result, createdAt: FieldValue.serverTimestamp() })
      transaction.create(db.collection('ptOperationsAuditLogs').doc(), { schemaVersion: 2, action: `pt_schedule.${command}`, actorUid: actor.uid, branchId, weekId: week, previousDraftRevision: revision, nextDraftRevision: nextRevision, affectedStudentCount: command === 'set_student_weekly_target' ? 1 : requeuedEntries.length, studentId: command === 'set_student_weekly_target' ? studentId : null, weeklyTarget: command === 'set_student_weekly_target' ? (resetWeeklyTarget ? null : weeklyTarget) : null, reason: typeof request.data?.reason === 'string' ? request.data.reason.trim().slice(0, 300) : '', createdAt: FieldValue.serverTimestamp() })
      return result
    })
  })

  return { listPtScheduleBranches, getPtScheduleWorkspace, generatePtScheduleDraft, getPtScheduleSlotCandidates, applyPtScheduleDraftCommand }
}

module.exports = {
  MAX_DRAFT_ENTRIES,
  createPtScheduleV2Functions,
  candidateForSlot,
  generateSchedule,
  resolveContract,
  safeSchedule,
  safeWeeklySessionTargets,
  studentWeekEligibility,
}
