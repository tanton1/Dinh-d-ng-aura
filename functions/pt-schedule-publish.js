'use strict'

const { createHash } = require('node:crypto')
const { FieldValue } = require('firebase-admin/firestore')
const { HttpsError } = require('firebase-functions/v2/https')
const { trustedAccessContext, requireCapability } = require('./identity-access')

// Keep enough headroom for schedule/version/audit writes in the same atomic
// publish transaction. A paired session still occupies one trainer time slot,
// but each learner session is a separate Firestore write.
const MAX_SCHEDULE_ENTRIES = 440
const MAX_ENTRIES_PER_SLOT = 100
const MAX_TRANSACTION_WRITES = 450
const ACTIVE_SESSION_STATUSES = new Set(['scheduled', 'rescheduled'])
const DAY_OFFSETS = new Map([['T2', 0], ['T3', 1], ['T4', 2], ['T5', 3], ['T6', 4], ['T7', 5], ['CN', 6]])

function documentId(value, label) {
  const result = typeof value === 'string' ? value.trim() : ''
  if (!result || !/^[A-Za-z0-9_-]+$/.test(result)) throw new HttpsError('invalid-argument', `${label} không hợp lệ.`)
  return result
}

function weekId(value) {
  const result = typeof value === 'string' ? value.trim() : ''
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result)) throw new HttpsError('invalid-argument', 'Tuần lịch không hợp lệ.')
  const parsed = new Date(`${result}T00:00:00.000Z`)
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== result || parsed.getUTCDay() !== 1) {
    throw new HttpsError('invalid-argument', 'Tuần lịch phải bắt đầu vào thứ Hai.')
  }
  return result
}

function nextWeek(value) {
  const next = new Date(`${value}T00:00:00.000Z`)
  next.setUTCDate(next.getUTCDate() + 7)
  return next.toISOString().slice(0, 10)
}

function dateForSlot(week, dayCode) {
  const offset = DAY_OFFSETS.get(dayCode)
  if (typeof offset !== 'number') throw new HttpsError('invalid-argument', 'Ngày trong ô lịch không hợp lệ.')
  const value = new Date(`${week}T00:00:00.000Z`)
  value.setUTCDate(value.getUTCDate() + offset)
  return value.toISOString().slice(0, 10)
}

function storedDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : ''
}

function storedHour(value, sessionId) {
  if (Number.isInteger(value) && value >= 0 && value <= 23) return value
  const parsed = Number(String(sessionId || '').split('-')[1])
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= 23 ? parsed : null
}

function isImmutableSession(value = {}) {
  return value.billingStatus === 'charged'
    || ['completed', 'attended', 'no_show'].includes(value.status)
}

function deterministicSessionId(scheduleId, branchId, slotId, studentId) {
  const digest = createHash('sha256').update(`${scheduleId}|${branchId}|${slotId}|${studentId}`).digest('hex').slice(0, 40)
  return `pt_${digest}`
}

function entryKey(scheduleId, slotId, studentId) {
  return `${scheduleId}-${slotId}-${studentId}`
}

function normalizedCapacity(value) {
  const result = Number(value)
  return Number.isInteger(result) && result >= 1 && result <= 4 ? result : 2
}

function trainerAvailabilityMode(value = {}) {
  if (value?.availabilityMode === 'unrestricted') return 'unrestricted'
  if (value?.availabilityMode === 'configured') return 'configured'
  if (Array.isArray(value?.availableSlots) && value.availableSlots.length > 0) return 'configured'
  return 'unconfigured'
}

function trainerIsAvailable(value, slotId) {
  const mode = trainerAvailabilityMode(value)
  if (mode === 'unrestricted') return true
  if (mode !== 'configured') return false
  return Array.isArray(value?.availableSlots) && value.availableSlots.includes(slotId)
}

function trainerIsOnLeave(trainerId, date, trainerLeaves = []) {
  return trainerLeaves.some((leave) => {
    if (leave?.trainerId !== trainerId || leave?.status !== 'approved') return false
    const start = storedDate(leave.startDate)
    const end = storedDate(leave.endDate || leave.startDate)
    return Boolean(start && end && date >= start && date <= end)
  })
}

function scheduleError(code, message, details = {}) {
  return new HttpsError('failed-precondition', message, { issueCode: code, ...details })
}

function sameSession(left, right) {
  return left.studentId === right.studentId
    && left.trainerId === right.trainerId
    && left.contractId === right.contractId
    && left.branchId === right.branchId
    && storedDate(left.date) === right.date
    && storedHour(left.hour, left.id) === right.hour
}

function rawEntryBranch(entry, students, trainers) {
  if (!entry || typeof entry !== 'object') return ''
  return entry.branchId
    || students.get(entry.studentId)?.branchId
    || trainers.get(entry.trainerId)?.branchId
    || ''
}

function branchScheduleSnapshot(schedule, branchId, students, trainers) {
  const result = {}
  for (const [slotId, entries] of Object.entries(schedule || {})) {
    if (!Array.isArray(entries)) continue
    const scoped = entries
      .filter((entry) => rawEntryBranch(entry, students, trainers) === branchId)
      .map((entry) => ({
        studentId: entry.studentId,
        trainerId: entry.trainerId,
        branchId,
        type: entry.type === 'off' ? 'off' : 'training',
        ...(entry.isLocked === true ? { isLocked: true } : {}),
      }))
    if (scoped.length) result[slotId] = scoped
  }
  return result
}

function legacyBranchScheduleFromSessions(entries, branchId) {
  const result = {}
  for (const entry of Array.isArray(entries) ? entries : []) {
    if (entry?.branchId !== branchId || typeof entry.slotId !== 'string') continue
    if (!Array.isArray(result[entry.slotId])) result[entry.slotId] = []
    result[entry.slotId].push({
      studentId: entry.studentId,
      trainerId: entry.trainerId,
      branchId,
      type: 'training',
      isLocked: true,
    })
  }
  return result
}

function mergeRestoredBranchSchedule(currentSchedule, restoredBranchSchedule, branchId, students, trainers) {
  const result = {}
  const slotIds = new Set([
    ...Object.keys(currentSchedule || {}),
    ...Object.keys(restoredBranchSchedule || {}),
  ])
  for (const slotId of slotIds) {
    const retained = Array.isArray(currentSchedule?.[slotId])
      ? currentSchedule[slotId].filter((entry) => rawEntryBranch(entry, students, trainers) !== branchId)
      : []
    const restored = Array.isArray(restoredBranchSchedule?.[slotId])
      ? restoredBranchSchedule[slotId]
      : []
    if (retained.length || restored.length) result[slotId] = [...retained, ...restored]
  }
  return result
}

function isoTimestamp(value) {
  if (value && typeof value.toDate === 'function') return value.toDate().toISOString()
  if (value instanceof Date) return value.toISOString()
  return typeof value === 'string' ? value : null
}

function normalizedDraftSchedule(value, branchId) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new HttpsError('invalid-argument', 'Nội dung lịch nháp không hợp lệ.')
  }
  const result = {}
  let totalEntries = 0
  for (const [slotId, rawEntries] of Object.entries(value)) {
    if (!/^(T[2-7]|CN)-(?:[0-9]|1[0-9]|2[0-3])$/.test(slotId) || !Array.isArray(rawEntries)) {
      throw new HttpsError('invalid-argument', 'Lịch có khung giờ không hợp lệ.')
    }
    if (rawEntries.length > MAX_ENTRIES_PER_SLOT) throw new HttpsError('invalid-argument', 'Một khung giờ có quá nhiều dữ liệu.')
    const entries = rawEntries.map((entry) => {
      const trainerId = documentId(entry?.trainerId, 'Mã PT')
      const type = entry?.type === 'off' ? 'off' : 'training'
      const studentId = type === 'off' ? 'OFF' : documentId(entry?.studentId, 'Mã học viên')
      return {
        studentId,
        trainerId,
        branchId,
        type,
        ...(entry?.isLocked === true ? { isLocked: true } : {}),
      }
    })
    totalEntries += entries.length
    if (entries.length) result[slotId] = entries
  }
  if (totalEntries > MAX_SCHEDULE_ENTRIES) throw new HttpsError('invalid-argument', 'Lịch nháp vượt giới hạn an toàn.')
  return result
}

async function publisherActor(request, db, branchId) {
  const actor = await trustedAccessContext(request, db)
  if (['admin', 'super_admin'].includes(actor.accessRole)) {
    requireCapability(actor, 'pt.operations.manage')
    return actor
  }
  requireCapability(actor, 'pt.schedule.branch.publish')
  if (!actor.branchIds.includes(branchId)) throw new HttpsError('permission-denied', 'Bạn không được publish lịch của chi nhánh này.')
  return actor
}

function desiredEntries({ scheduleId, week, branchId, schedule, trainers, students, contracts, availability, config, trainerLeaves = [] }) {
  const desired = new Map()
  const errors = []
  const warnings = []
  const studentDays = new Set()
  const trainerSlots = new Map()
  const offSlots = new Set()
  const workingDays = new Set(Array.isArray(config.workingDays) ? config.workingDays : [...DAY_OFFSETS.keys()])
  const workingHours = new Set(Array.isArray(config.workingHours) ? config.workingHours.map(Number) : [])
  const holidays = new Set(Array.isArray(config.holidays) ? config.holidays : [])

  for (const [slotId, rawEntries] of Object.entries(schedule || {})) {
    if (!Array.isArray(rawEntries)) continue
    const match = /^(T[2-7]|CN)-(\d{1,2})$/.exec(slotId)
    if (!match) {
      errors.push('INVALID_SLOT')
      continue
    }
    const day = match[1]
    const hour = Number(match[2])
    const date = dateForSlot(week, day)
    if (!workingDays.has(day) || (workingHours.size && !workingHours.has(hour)) || holidays.has(date)) {
      if (rawEntries.some((entry) => entry?.branchId === branchId)) errors.push('OUTSIDE_WORKING_CALENDAR')
      continue
    }
    for (const raw of rawEntries) {
      if (!raw) continue
      let trainerId
      try {
        trainerId = documentId(raw.trainerId, 'Mã PT')
      } catch {
        errors.push('TRAINER_REQUIRED')
        continue
      }
      const trainerSlot = `${date}|${hour}|${trainerId}`
      const trainer = trainers.get(trainerId)
      if (raw.type === 'off') {
        const offBranchId = raw.branchId || trainer?.branchId
        if (offBranchId !== branchId) continue
        if (!trainer || trainer.status === 'inactive') errors.push('TRAINER_NOT_ACTIVE')
        offSlots.add(trainerSlot)
        continue
      }
      let studentId
      try {
        studentId = documentId(raw.studentId, 'Mã học viên')
      } catch {
        errors.push('STUDENT_REQUIRED')
        continue
      }
      const student = students.get(studentId)
      // Old generated entries did not persist branchId. Resolve that legacy
      // omission only from canonical member/PT data; never treat the UI filter
      // value "all" as a writable branch identifier.
      const resolvedEntryBranchId = raw.branchId || student?.branchId || trainer?.branchId
      if (resolvedEntryBranchId && resolvedEntryBranchId !== branchId) continue
      if (!resolvedEntryBranchId) {
        errors.push('ENTRY_BRANCH_REQUIRED')
        continue
      }
      if (!trainer || trainer.status === 'inactive') errors.push('TRAINER_NOT_ACTIVE')
      if (!student || student.status === 'inactive') errors.push('STUDENT_NOT_ACTIVE')
      if (trainer?.branchId && trainer.branchId !== branchId) errors.push('TRAINER_BRANCH_MISMATCH')
      if (student?.branchId && student.branchId !== branchId) errors.push('STUDENT_BRANCH_MISMATCH')
      const availabilityMode = trainerAvailabilityMode(trainer)
      if (trainer?.employmentType === 'collaborator') {
        if (!Array.isArray(trainer.availableSlots) || !trainer.availableSlots.length) errors.push('TRAINER_AVAILABILITY_UNCONFIGURED')
        else if (!trainer.availableSlots.includes(slotId)) errors.push('OUTSIDE_TRAINER_AVAILABILITY')
      } else if (availabilityMode === 'unconfigured') errors.push('TRAINER_AVAILABILITY_UNCONFIGURED')
      else if (!trainerIsAvailable(trainer, slotId)) errors.push('OUTSIDE_TRAINER_AVAILABILITY')
      if (trainerIsOnLeave(trainerId, date, trainerLeaves)) errors.push('TRAINER_ON_LEAVE')

      const studentDay = `${studentId}|${date}`
      if (studentDays.has(studentDay)) errors.push('STUDENT_MULTIPLE_SESSIONS_PER_DAY')
      studentDays.add(studentDay)
      trainerSlots.set(trainerSlot, (trainerSlots.get(trainerSlot) || 0) + 1)

      const weekly = availability.get(studentId)
      const recurringSlots = Array.isArray(student?.availableSlots) ? student.availableSlots : []
      const recurringConfirmed = !weekly && student?.isScheduleConfirmed === true && recurringSlots.length > 0
      const slots = new Set(Array.isArray(weekly?.slots) ? weekly.slots : recurringConfirmed ? recurringSlots : [])
      if (!weekly && !recurringConfirmed) errors.push('AVAILABILITY_NOT_SUBMITTED')
      else if (weekly && !['submitted', 'locked'].includes(weekly.status)) errors.push('AVAILABILITY_NOT_SUBMITTED')
      else if (!slots.has(slotId)) errors.push('OUTSIDE_STUDENT_AVAILABILITY')
      if (recurringConfirmed) warnings.push('LEGACY_AVAILABILITY_FALLBACK')

      const dateCandidates = contracts.filter((contract) => contract.studentId === studentId
        && ['active', 'future'].includes(String(contract.status || 'active').toLowerCase())
        && storedDate(contract.startDate) <= date
        && storedDate(contract.endDate) >= date)
      if (dateCandidates.some((contract) => !contract.branchId)) errors.push('CONTRACT_BRANCH_REQUIRED')
      const contractCandidates = dateCandidates.filter((contract) => contract.branchId === branchId)
      if (contractCandidates.length !== 1) {
        errors.push(contractCandidates.length ? 'AMBIGUOUS_ACTIVE_CONTRACT' : 'ACTIVE_CONTRACT_NOT_FOUND')
        continue
      }
      const contract = contractCandidates[0]
      const assignedTrainerIds = Array.isArray(contract.trainerIds) && contract.trainerIds.length
        ? contract.trainerIds
        : contract.trainerId ? [contract.trainerId] : []
      if (assignedTrainerIds.length && !assignedTrainerIds.includes(trainerId)) {
        errors.push('TRAINER_ASSIGNMENT_MISMATCH')
        continue
      }
      const pauses = Array.isArray(contract.pausePeriods) ? contract.pausePeriods : []
      if (pauses.some((period) => {
        const pauseStart = storedDate(period?.startDate)
        const pauseEnd = storedDate(period?.endDate)
        return pauseStart && pauseEnd && date >= pauseStart && date <= pauseEnd
      })) {
        errors.push('CONTRACT_PAUSED')
        continue
      }
      const key = entryKey(scheduleId, slotId, studentId)
      if (desired.has(key)) {
        errors.push('DUPLICATE_SCHEDULE_ENTRY')
        continue
      }
      desired.set(key, {
        id: deterministicSessionId(scheduleId, branchId, slotId, studentId),
        scheduleEntryId: key,
        scheduleWeekId: week,
        slotId,
        studentId,
        trainerId,
        contractId: contract.id,
        branchId,
        date,
        hour,
        status: 'scheduled',
        scheduleStatus: 'scheduled',
        billingStatus: 'pending',
        attendanceStatus: 'pending',
      })
    }
  }

  for (const [key, count] of trainerSlots) {
    const trainerId = key.split('|').at(-1)
    if (offSlots.has(key)) errors.push('TRAINER_OFF_CONFLICT')
    if (count > normalizedCapacity(trainers.get(trainerId)?.slotCapacity)) errors.push('TRAINER_CAPACITY_EXCEEDED')
  }
  if (desired.size > MAX_SCHEDULE_ENTRIES) errors.push('SCHEDULE_TOO_LARGE')
  return { desired, errors: [...new Set(errors)], warnings: [...new Set(warnings)] }
}

function createPtSchedulePublishFunctions({ db, onCall }) {
  async function execute(request, validateOnly) {
    const week = weekId(request.data?.weekId)
    const branchId = documentId(request.data?.branchId, 'Mã chi nhánh')
    const expectedDraftRevision = Number(request.data?.expectedDraftRevision)
    if (!Number.isInteger(expectedDraftRevision) || expectedDraftRevision < 0) throw new HttpsError('invalid-argument', 'Phiên bản lịch nháp không hợp lệ.')
    const actor = await publisherActor(request, db, branchId)
    const scheduleId = `schedule_${week}`
    const scheduleReference = db.doc(`schedules/${scheduleId}`)
    const v2DraftReference = db.doc(`ptScheduleDrafts/${branchId}_${week}`)
    const branchReference = db.doc(`branches/${branchId}`)

    return db.runTransaction(async (transaction) => {
      const [scheduleSnapshot, v2DraftSnapshot, branchSnapshot, contractsSnapshot, studentsSnapshot, trainersSnapshot, availabilitySnapshot, weekSessionsSnapshot, activeSessionsSnapshot, configSnapshot, trainerLeavesSnapshot] = await Promise.all([
        transaction.get(scheduleReference),
        transaction.get(v2DraftReference),
        transaction.get(branchReference),
        transaction.get(db.collection('contracts').limit(1000)),
        transaction.get(db.collection('students').limit(1000)),
        transaction.get(db.collection('trainers').limit(500)),
        transaction.get(db.collection('ptAvailability').where('weekId', '==', week).limit(1000)),
        transaction.get(db.collection('sessions').where('date', '>=', week).where('date', '<', nextWeek(week)).limit(1001)),
        transaction.get(db.collection('sessions').where('status', 'in', ['scheduled', 'rescheduled']).limit(3001)),
        transaction.get(db.doc('settings/scheduleConfig')),
        transaction.get(db.collection('leaveRequests').where('status', '==', 'approved').limit(1001)),
      ])
      if (!scheduleSnapshot.exists && !v2DraftSnapshot.exists) throw new HttpsError('not-found', 'Không tìm thấy lịch nháp của tuần.')
      if (!branchSnapshot.exists || branchSnapshot.data().status === 'archived') throw new HttpsError('failed-precondition', 'Chi nhánh không hoạt động.')
      if (weekSessionsSnapshot.size > 1000 || activeSessionsSnapshot.size > 3000 || trainerLeavesSnapshot.size > 1000) throw new HttpsError('resource-exhausted', 'Dữ liệu lịch vượt giới hạn kiểm tra an toàn.')
      const scheduleData = scheduleSnapshot.exists ? scheduleSnapshot.data() : {}
      const activeDraftData = v2DraftSnapshot.exists ? v2DraftSnapshot.data() : scheduleData
      const draftRevision = Number(v2DraftSnapshot.exists ? activeDraftData.revision : scheduleData.draftRevision || 0)
      if (draftRevision !== expectedDraftRevision) throw new HttpsError('aborted', 'Lịch nháp đã thay đổi. Hãy tải lại trước khi publish.')
      const publishedRevision = v2DraftSnapshot.exists
        ? Number(activeDraftData.publishedRevision ?? -1)
        : Number(scheduleData.publishedRevisions?.[branchId] ?? -1)
      const currentPublishedVersion = v2DraftSnapshot.exists
        ? Number(activeDraftData.publishedVersion || scheduleData.publishedVersions?.[branchId] || 0)
        : Number(scheduleData.publishedVersions?.[branchId] || 0)
      if (!validateOnly && publishedRevision === draftRevision) {
        return { unchanged: true, draftRevision, version: currentPublishedVersion, diff: { create: 0, update: 0, cancel: 0, unchanged: 0 }, warnings: [] }
      }

      const contracts = contractsSnapshot.docs.map((item) => ({ id: item.id, ...item.data() }))
      const students = new Map(studentsSnapshot.docs.map((item) => [item.id, item.data()]))
      const trainers = new Map(trainersSnapshot.docs.map((item) => [item.id, item.data()]))
      const availability = new Map(availabilitySnapshot.docs.map((item) => [item.data().studentId, item.data()]))
      const prepared = desiredEntries({
        scheduleId,
        week,
        branchId,
        schedule: activeDraftData.schedule,
        trainers,
        students,
        contracts,
        availability,
        config: configSnapshot.data() || {},
        trainerLeaves: trainerLeavesSnapshot.docs.map((item) => item.data()),
      })
      if (prepared.errors.length) throw scheduleError('SCHEDULE_VALIDATION_FAILED', 'Lịch nháp còn xung đột và chưa thể publish.', { errors: prepared.errors })

      const existingScoped = weekSessionsSnapshot.docs.filter((item) => {
        const session = item.data()
        return session.branchId === branchId
          && (session.scheduleWeekId === week || String(session.scheduleEntryId || '').startsWith(`${scheduleId}-`))
      })
      const existingByEntry = new Map()
      for (const item of existingScoped) {
        const key = item.data().scheduleEntryId
        if (!key) continue
        if (existingByEntry.has(key)) throw scheduleError('DUPLICATE_DEPLOYED_SESSION', 'Có nhiều buổi tập cùng tham chiếu một ô lịch.')
        existingByEntry.set(key, item)
      }

      const desiredValues = [...prepared.desired.values()]
      const desiredStudentIds = new Set(desiredValues.map((item) => item.studentId))
      const scopedExistingIds = new Set(existingScoped.map((item) => item.id))
      for (const item of activeSessionsSnapshot.docs) {
        const session = item.data()
        if (!desiredStudentIds.has(session.studentId) || scopedExistingIds.has(item.id)) continue
        const date = storedDate(session.date)
        const hour = storedHour(session.hour, item.id)
        if (desiredValues.some((desired) => desired.studentId === session.studentId && desired.date === date)) {
          throw scheduleError('STUDENT_MULTIPLE_SESSIONS_PER_DAY', 'Học viên đã có một buổi khác trong ngày được chọn.')
        }
        if (desiredValues.some((desired) => desired.trainerId === session.trainerId && desired.date === date && desired.hour === hour)) {
          const externalCount = activeSessionsSnapshot.docs.filter((candidate) => {
            const value = candidate.data()
            return !scopedExistingIds.has(candidate.id) && value.trainerId === session.trainerId && storedDate(value.date) === date && storedHour(value.hour, candidate.id) === hour
          }).length
          const desiredCount = desiredValues.filter((desired) => desired.trainerId === session.trainerId && desired.date === date && desired.hour === hour).length
          if (externalCount + desiredCount > normalizedCapacity(trainers.get(session.trainerId)?.slotCapacity)) throw scheduleError('TRAINER_CAPACITY_EXCEEDED', 'Khung giờ PT đã vượt sức chứa.')
        }
      }

      const plannedByContract = new Map()
      for (const desired of desiredValues) {
        const existing = existingByEntry.get(desired.scheduleEntryId)
        if (existing && isImmutableSession(existing.data())) continue
        plannedByContract.set(desired.contractId, (plannedByContract.get(desired.contractId) || 0) + 1)
      }
      for (const [contractId, count] of plannedByContract) {
        const contract = contracts.find((item) => item.id === contractId)
        const otherPlanned = activeSessionsSnapshot.docs.filter((item) => {
          const value = item.data()
          return !scopedExistingIds.has(item.id)
            && value.contractId === contractId
            && ACTIVE_SESSION_STATUSES.has(value.status)
            && value.billingStatus !== 'charged'
        }).length
        if (Number(contract?.usedSessions || 0) + otherPlanned + count > Number(contract?.totalSessions || 0)) {
          throw scheduleError('CONTRACT_SESSION_QUOTA_EXCEEDED', 'Số buổi đã học và đang xếp vượt quá gói tập.')
        }
      }

      const currentVersion = currentPublishedVersion
      const nextVersion = currentVersion + 1
      const creates = []
      const updates = []
      const unchanged = []
      for (const [key, desired] of prepared.desired) {
        const existing = existingByEntry.get(key)
        if (!existing) creates.push(desired)
        else if (isImmutableSession(existing.data())) {
          if (!sameSession({ id: existing.id, ...existing.data() }, desired)) throw scheduleError('CHARGED_SESSION_IMMUTABLE', 'Lịch nháp đang thay đổi một buổi đã được tính hoặc xác nhận.')
          unchanged.push(existing)
        } else if (!ACTIVE_SESSION_STATUSES.has(existing.data().status)) {
          throw scheduleError('CANCELLED_SESSION_REINTRODUCED', 'Một ô lịch đã hủy đang được thêm lại. Hãy tạo yêu cầu điều chỉnh riêng.')
        } else if (sameSession({ id: existing.id, ...existing.data() }, desired)) unchanged.push(existing)
        else updates.push({ existing, desired })
      }
      const cancellations = existingScoped.filter((item) => ACTIVE_SESSION_STATUSES.has(item.data().status) && !isImmutableSession(item.data()) && !prepared.desired.has(item.data().scheduleEntryId))
      const immutableRemoved = existingScoped.filter((item) => isImmutableSession(item.data()) && !prepared.desired.has(item.data().scheduleEntryId))
      if (immutableRemoved.length) throw scheduleError('CHARGED_SESSION_IMMUTABLE', 'Không thể loại buổi đã được tính hoặc xác nhận khỏi lịch publish.')
      const diff = { create: creates.length, update: updates.length, cancel: cancellations.length, unchanged: unchanged.length }
      if (validateOnly) return { unchanged: false, validateOnly: true, draftRevision, version: nextVersion, diff, warnings: prepared.warnings }

      const writeCount = creates.length + updates.length + cancellations.length + (v2DraftSnapshot.exists ? 4 : 3)
      if (writeCount > MAX_TRANSACTION_WRITES) throw new HttpsError('resource-exhausted', 'Lịch có quá nhiều thay đổi để publish trong một giao dịch.')
      for (const desired of creates) {
        transaction.create(db.doc(`sessions/${desired.id}`), {
          ...desired,
          schemaVersion: 2,
          scheduleVersion: nextVersion,
          revision: 0,
          verifiedByStudent: false,
          createdAt: FieldValue.serverTimestamp(),
          createdBy: actor.uid,
          updatedAt: FieldValue.serverTimestamp(),
          updatedBy: actor.uid,
        })
      }
      for (const { existing, desired } of updates) {
        const previous = existing.data()
        transaction.update(existing.ref, {
          ...desired,
          scheduleVersion: nextVersion,
          status: 'scheduled',
          scheduleStatus: 'rescheduled',
          billingStatus: 'pending',
          attendanceStatus: 'pending',
          previousSchedule: FieldValue.arrayUnion({ date: previous.date, hour: previous.hour ?? null, trainerId: previous.trainerId, changedAt: new Date().toISOString(), reason: 'schedule_publish' }),
          revision: Number(previous.revision || 0) + 1,
          updatedAt: FieldValue.serverTimestamp(),
          updatedBy: actor.uid,
        })
      }
      for (const existing of cancellations) {
        transaction.update(existing.ref, {
          status: 'cancelled',
          scheduleStatus: 'cancelled',
          billingStatus: 'exempt',
          attendanceStatus: null,
          cancellationReason: 'Removed by schedule publish',
          scheduleVersion: nextVersion,
          revision: Number(existing.data().revision || 0) + 1,
          cancelledAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
          updatedBy: actor.uid,
        })
      }
      const versionReference = db.doc(`ptScheduleVersions/${scheduleId}_${branchId}_v${nextVersion}`)
      transaction.create(versionReference, {
        schemaVersion: 1,
        scheduleId,
        weekId: week,
        branchId,
        version: nextVersion,
        sourceDraftRevision: draftRevision,
        entries: desiredValues,
        branchSchedule: branchScheduleSnapshot(activeDraftData.schedule, branchId, students, trainers),
        diff,
        warnings: prepared.warnings,
        publishedAt: FieldValue.serverTimestamp(),
        publishedBy: actor.uid,
      })
      transaction.set(scheduleReference, {
        [`publishedVersions.${branchId}`]: nextVersion,
        [`publishedRevisions.${branchId}`]: draftRevision,
        [`publishStatusByBranch.${branchId}`]: 'published',
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true })
      if (v2DraftSnapshot.exists) {
        transaction.update(v2DraftReference, {
          status: 'published',
          publishedVersion: nextVersion,
          publishedRevision: draftRevision,
          publishedAt: FieldValue.serverTimestamp(),
          publishedBy: actor.uid,
          updatedAt: FieldValue.serverTimestamp(),
        })
      }
      transaction.create(db.collection('ptOperationsAuditLogs').doc(), {
        schemaVersion: 1,
        action: 'pt_schedule.published',
        actorUid: actor.uid,
        branchId,
        weekId: week,
        version: nextVersion,
        draftRevision,
        diff,
        createdAt: FieldValue.serverTimestamp(),
      })
      return { unchanged: false, draftRevision, version: nextVersion, diff, warnings: prepared.warnings }
    })
  }

  const listPtScheduleVersions = onCall(async (request) => {
    const week = weekId(request.data?.weekId)
    const branchId = documentId(request.data?.branchId, 'Mã chi nhánh')
    await publisherActor(request, db, branchId)
    const scheduleId = `schedule_${week}`
    const [scheduleSnapshot, v2DraftSnapshot] = await Promise.all([
      db.doc(`schedules/${scheduleId}`).get(),
      db.doc(`ptScheduleDrafts/${branchId}_${week}`).get(),
    ])
    if (!scheduleSnapshot.exists && !v2DraftSnapshot.exists) return { currentDraftRevision: 0, currentVersion: 0, versions: [] }
    const scheduleData = scheduleSnapshot.exists ? scheduleSnapshot.data() : {}
    const v2DraftData = v2DraftSnapshot.exists ? v2DraftSnapshot.data() : null
    const currentVersion = Number(v2DraftData?.publishedVersion || scheduleData.publishedVersions?.[branchId] || 0)
    const minimumVersion = Math.max(1, currentVersion - 19)
    const references = []
    for (let version = currentVersion; version >= minimumVersion; version -= 1) {
      references.push(db.doc(`ptScheduleVersions/${scheduleId}_${branchId}_v${version}`))
    }
    const snapshots = references.length ? await db.getAll(...references) : []
    return {
      currentDraftRevision: Number(v2DraftData?.revision ?? scheduleData.draftRevision ?? 0),
      currentVersion,
      versions: snapshots.filter((snapshot) => snapshot.exists).map((snapshot) => {
        const data = snapshot.data()
        return {
          version: Number(data.version || 0),
          sourceDraftRevision: Number(data.sourceDraftRevision || 0),
          entryCount: Array.isArray(data.entries) ? data.entries.length : 0,
          diff: data.diff || { create: 0, update: 0, cancel: 0, unchanged: 0 },
          warnings: Array.isArray(data.warnings) ? data.warnings.slice(0, 20) : [],
          publishedAt: isoTimestamp(data.publishedAt),
          publishedBy: typeof data.publishedBy === 'string' ? data.publishedBy : null,
        }
      }),
    }
  })

  const restorePtScheduleVersionToDraft = onCall(async (request) => {
    const week = weekId(request.data?.weekId)
    const branchId = documentId(request.data?.branchId, 'Mã chi nhánh')
    const version = Number(request.data?.version)
    const expectedDraftRevision = Number(request.data?.expectedDraftRevision)
    if (!Number.isInteger(version) || version < 1) throw new HttpsError('invalid-argument', 'Phiên bản lịch không hợp lệ.')
    if (!Number.isInteger(expectedDraftRevision) || expectedDraftRevision < 0) throw new HttpsError('invalid-argument', 'Phiên bản draft không hợp lệ.')
    const actor = await publisherActor(request, db, branchId)
    const scheduleId = `schedule_${week}`
    const scheduleReference = db.doc(`schedules/${scheduleId}`)
    const v2DraftReference = db.doc(`ptScheduleDrafts/${branchId}_${week}`)
    const versionReference = db.doc(`ptScheduleVersions/${scheduleId}_${branchId}_v${version}`)

    return db.runTransaction(async (transaction) => {
      const [scheduleSnapshot, v2DraftSnapshot, versionSnapshot, studentsSnapshot, trainersSnapshot] = await Promise.all([
        transaction.get(scheduleReference),
        transaction.get(v2DraftReference),
        transaction.get(versionReference),
        transaction.get(db.collection('students').limit(1000)),
        transaction.get(db.collection('trainers').limit(500)),
      ])
      if (!scheduleSnapshot.exists && !v2DraftSnapshot.exists) throw new HttpsError('not-found', 'Không tìm thấy lịch nháp của tuần.')
      if (!versionSnapshot.exists) throw new HttpsError('not-found', 'Không tìm thấy phiên bản lịch đã chọn.')
      const scheduleData = scheduleSnapshot.exists ? scheduleSnapshot.data() : {}
      const v2DraftData = v2DraftSnapshot.exists ? v2DraftSnapshot.data() : null
      const versionData = versionSnapshot.data()
      if (versionData.weekId !== week || versionData.branchId !== branchId || Number(versionData.version) !== version) {
        throw new HttpsError('failed-precondition', 'Phiên bản lịch không thuộc tuần hoặc chi nhánh này.')
      }
      const draftRevision = Number(v2DraftData?.revision ?? scheduleData.draftRevision ?? 0)
      if (draftRevision !== expectedDraftRevision) throw new HttpsError('aborted', 'Lịch nháp đã thay đổi. Hãy tải lại lịch sử trước khi khôi phục.')
      const students = new Map(studentsSnapshot.docs.map((item) => [item.id, item.data()]))
      const trainers = new Map(trainersSnapshot.docs.map((item) => [item.id, item.data()]))
      const restoredBranchSchedule = versionData.branchSchedule && typeof versionData.branchSchedule === 'object'
        ? versionData.branchSchedule
        : legacyBranchScheduleFromSessions(versionData.entries, branchId)
      const nextDraftRevision = draftRevision + 1
      if (v2DraftSnapshot.exists) {
        transaction.update(v2DraftReference, {
          schedule: normalizedDraftSchedule(restoredBranchSchedule, branchId),
          revision: nextDraftRevision,
          status: 'draft',
          restoredFromVersion: version,
          updatedAt: FieldValue.serverTimestamp(),
          updatedBy: actor.uid,
        })
      } else {
        const restoredSchedule = mergeRestoredBranchSchedule(scheduleData.schedule || {}, restoredBranchSchedule, branchId, students, trainers)
        transaction.update(scheduleReference, {
          schedule: restoredSchedule,
          draftRevision: nextDraftRevision,
          [`publishStatusByBranch.${branchId}`]: 'draft',
          [`restoredFromVersionByBranch.${branchId}`]: version,
          updatedAt: FieldValue.serverTimestamp(),
          updatedBy: actor.uid,
        })
      }
      transaction.create(db.collection('ptOperationsAuditLogs').doc(), {
        schemaVersion: 1,
        action: 'pt_schedule.version_restored_to_draft',
        actorUid: actor.uid,
        branchId,
        weekId: week,
        version,
        previousDraftRevision: draftRevision,
        nextDraftRevision,
        createdAt: FieldValue.serverTimestamp(),
      })
      return { version, draftRevision: nextDraftRevision }
    })
  })

  const getMyBranchScheduleWorkspace = onCall(async (request) => {
    const week = weekId(request.data?.weekId)
    const branchId = documentId(request.data?.branchId, 'Mã chi nhánh')
    await publisherActor(request, db, branchId)
    const scheduleId = `schedule_${week}`
    const [branchSnapshot, scheduleSnapshot, studentsSnapshot, trainersSnapshot, contractsSnapshot, availabilitySnapshot, sessionsSnapshot, configSnapshot] = await Promise.all([
      db.doc(`branches/${branchId}`).get(),
      db.doc(`schedules/${scheduleId}`).get(),
      db.collection('students').where('branchId', '==', branchId).limit(501).get(),
      db.collection('trainers').where('branchId', '==', branchId).limit(101).get(),
      db.collection('contracts').limit(1001).get(),
      db.collection('ptAvailability').where('weekId', '==', week).limit(1001).get(),
      db.collection('sessions').where('date', '>=', week).where('date', '<', nextWeek(week)).limit(1001).get(),
      db.doc('settings/scheduleConfig').get(),
    ])
    if (!branchSnapshot.exists || branchSnapshot.data().status === 'archived') throw new HttpsError('failed-precondition', 'Chi nhánh không hoạt động.')
    if (studentsSnapshot.size > 500 || trainersSnapshot.size > 100 || contractsSnapshot.size > 1000 || availabilitySnapshot.size > 1000 || sessionsSnapshot.size > 1000) {
      throw new HttpsError('resource-exhausted', 'Dữ liệu chi nhánh vượt giới hạn tải an toàn.')
    }
    const studentIds = new Set(studentsSnapshot.docs.map((item) => item.id))
    const trainerIds = new Set(trainersSnapshot.docs.map((item) => item.id))
    const weeklyAvailability = new Map(availabilitySnapshot.docs
      .map((item) => item.data())
      .filter((item) => studentIds.has(item.studentId))
      .map((item) => [item.studentId, item]))
    const students = new Map(studentsSnapshot.docs.map((item) => [item.id, item.data()]))
    const trainers = new Map(trainersSnapshot.docs.map((item) => [item.id, item.data()]))
    const scheduleData = scheduleSnapshot.exists ? scheduleSnapshot.data() : {}
    const contracts = contractsSnapshot.docs
      .map((item) => ({ id: item.id, ...item.data() }))
      .filter((item) => studentIds.has(item.studentId))
      .map((item) => ({
        id: item.id,
        studentId: item.studentId,
        trainerId: item.trainerId || '',
        trainerIds: Array.isArray(item.trainerIds) ? item.trainerIds.filter((id) => trainerIds.has(id)).slice(0, 10) : [],
        branchId: item.branchId || branchId,
        packageId: '',
        packageName: '',
        status: item.status,
        startDate: item.startDate,
        endDate: item.endDate,
        totalSessions: Number(item.totalSessions || 0),
        usedSessions: Number(item.usedSessions || 0),
        totalPrice: 0,
        paidAmount: 0,
      }))
    return {
      schemaVersion: 1,
      branch: { id: branchId, name: branchSnapshot.data().name || branchId, status: branchSnapshot.data().status || 'active' },
      weekId: week,
      draftRevision: Number(scheduleData.draftRevision || 0),
      publishedVersion: Number(scheduleData.publishedVersions?.[branchId] || 0),
      publishedRevision: Number(scheduleData.publishedRevisions?.[branchId] ?? -1),
      schedule: branchScheduleSnapshot(scheduleData.schedule || {}, branchId, students, trainers),
      students: studentsSnapshot.docs.map((item) => {
        const data = item.data()
        const availability = weeklyAvailability.get(item.id)
        return {
          id: item.id,
          name: data.name || 'Chưa cập nhật tên',
          phone: data.phone || '',
          email: data.email || '',
          status: data.status || 'active',
          branchId,
          sessionsPerWeek: Number(data.sessionsPerWeek || 0),
          availableSlots: Array.isArray(availability?.slots) ? availability.slots : [],
          isScheduleConfirmed: ['submitted', 'locked'].includes(availability?.status),
        }
      }),
      trainers: trainersSnapshot.docs.map((item) => {
        const data = item.data()
        return {
          id: item.id,
          name: data.name || 'PT chưa cập nhật tên',
          phone: data.phone || '',
          email: data.email || '',
          status: data.status || 'active',
          branchId,
          availableSlots: Array.isArray(data.availableSlots) ? data.availableSlots.slice(0, 100) : [],
          slotCapacity: normalizedCapacity(data.slotCapacity),
        }
      }),
      contracts,
      sessions: sessionsSnapshot.docs
        .map((item) => ({ id: item.id, ...item.data() }))
        .filter((item) => item.branchId === branchId && studentIds.has(item.studentId))
        .map((item) => ({
          id: item.id,
          studentId: item.studentId,
          trainerId: item.trainerId,
          contractId: item.contractId || '',
          branchId,
          date: storedDate(item.date),
          hour: storedHour(item.hour, item.id),
          status: item.status,
          scheduleWeekId: item.scheduleWeekId || '',
          scheduleVersion: Number(item.scheduleVersion || 0),
          revision: Number(item.revision || 0),
        })),
      scheduleConfig: {
        workingDays: Array.isArray(configSnapshot.data()?.workingDays) ? configSnapshot.data().workingDays : [...DAY_OFFSETS.keys()],
        workingHours: Array.isArray(configSnapshot.data()?.workingHours) ? configSnapshot.data().workingHours.map(Number) : [],
        holidays: Array.isArray(configSnapshot.data()?.holidays) ? configSnapshot.data().holidays : [],
        lockDayOfWeek: Number(configSnapshot.data()?.lockDayOfWeek ?? 6),
        lockHour: Number(configSnapshot.data()?.lockHour ?? 12),
      },
    }
  })

  const saveMyBranchScheduleDraft = onCall(async (request) => {
    const week = weekId(request.data?.weekId)
    const branchId = documentId(request.data?.branchId, 'Mã chi nhánh')
    const expectedDraftRevision = Number(request.data?.expectedDraftRevision)
    if (!Number.isInteger(expectedDraftRevision) || expectedDraftRevision < 0) throw new HttpsError('invalid-argument', 'Phiên bản draft không hợp lệ.')
    const scopedSchedule = normalizedDraftSchedule(request.data?.schedule, branchId)
    const actor = await publisherActor(request, db, branchId)
    const scheduleId = `schedule_${week}`
    const scheduleReference = db.doc(`schedules/${scheduleId}`)
    return db.runTransaction(async (transaction) => {
      const [scheduleSnapshot, branchSnapshot, studentsSnapshot, trainersSnapshot] = await Promise.all([
        transaction.get(scheduleReference),
        transaction.get(db.doc(`branches/${branchId}`)),
        transaction.get(db.collection('students').limit(1001)),
        transaction.get(db.collection('trainers').limit(501)),
      ])
      if (!branchSnapshot.exists || branchSnapshot.data().status === 'archived') throw new HttpsError('failed-precondition', 'Chi nhánh không hoạt động.')
      if (studentsSnapshot.size > 1000 || trainersSnapshot.size > 500) throw new HttpsError('resource-exhausted', 'Dữ liệu vận hành vượt giới hạn lưu an toàn.')
      const currentData = scheduleSnapshot.exists ? scheduleSnapshot.data() : {}
      const draftRevision = Number(currentData.draftRevision || 0)
      if (draftRevision !== expectedDraftRevision) throw new HttpsError('aborted', 'Lịch nháp đã thay đổi. Hãy tải lại trước khi lưu.')
      const students = new Map(studentsSnapshot.docs.map((item) => [item.id, item.data()]))
      const trainers = new Map(trainersSnapshot.docs.map((item) => [item.id, item.data()]))
      for (const entries of Object.values(scopedSchedule)) {
        for (const entry of entries) {
          const trainer = trainers.get(entry.trainerId)
          if (!trainer || trainer.status === 'inactive' || trainer.branchId !== branchId) throw new HttpsError('failed-precondition', 'Lịch chứa PT không thuộc chi nhánh.')
          if (entry.type !== 'off') {
            const student = students.get(entry.studentId)
            if (!student || student.status === 'inactive' || student.branchId !== branchId) throw new HttpsError('failed-precondition', 'Lịch chứa học viên không thuộc chi nhánh.')
          }
        }
      }
      const mergedSchedule = mergeRestoredBranchSchedule(currentData.schedule || {}, scopedSchedule, branchId, students, trainers)
      const nextDraftRevision = draftRevision + 1
      transaction.set(scheduleReference, {
        schedule: mergedSchedule,
        draftRevision: nextDraftRevision,
        publishStatusByBranch: { ...(currentData.publishStatusByBranch || {}), [branchId]: 'draft' },
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: actor.uid,
      }, { merge: true })
      transaction.create(db.collection('ptOperationsAuditLogs').doc(), {
        schemaVersion: 1,
        action: 'pt_schedule.branch_draft_saved',
        actorUid: actor.uid,
        branchId,
        weekId: week,
        previousDraftRevision: draftRevision,
        nextDraftRevision,
        entryCount: Object.values(scopedSchedule).reduce((total, entries) => total + entries.length, 0),
        createdAt: FieldValue.serverTimestamp(),
      })
      return { draftRevision: nextDraftRevision }
    })
  })

  const validatePtScheduleDraft = onCall((request) => execute(request, true))
  const publishPtSchedule = onCall((request) => execute(request, false))
  return {
    validatePtScheduleDraft,
    publishPtSchedule,
    listPtScheduleVersions,
    restorePtScheduleVersionToDraft,
    getMyBranchScheduleWorkspace,
    saveMyBranchScheduleDraft,
  }
}

module.exports = {
  createPtSchedulePublishFunctions,
  desiredEntries,
  branchScheduleSnapshot,
  mergeRestoredBranchSchedule,
  normalizedDraftSchedule,
  documentId,
  weekId,
  nextWeek,
  dateForSlot,
  storedDate,
  normalizedCapacity,
  trainerAvailabilityMode,
  trainerIsAvailable,
}
