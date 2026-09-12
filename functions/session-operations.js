const { FieldPath, FieldValue, Timestamp } = require('firebase-admin/firestore')
const { HttpsError } = require('firebase-functions/v2/https')
const { effectiveContractStatus } = require('./contract-status')
const { createHash } = require('node:crypto')
const { trustedAccessContext, requireCapability } = require('./identity-access')
const { ptRevenueRecognitionWrite } = require('./finance-recognition')
const { serviceRevenueJournal } = require('./accounting-core')
const {
  branchSlotCapacity,
  normalizedScheduleConfig,
  trainerIsAvailable,
  trainerProfileForWeek,
} = require('./pt-schedule-publish')
const {
  effectiveStudentAvailability,
  loadLatestSubmittedFallbacks,
  normalizedSubmittedAvailability,
} = require('./student-availability')
const { summarizeContractUsage } = require('./contract-usage')
const {
  addDateDays,
  assertSessionChangeDeadline,
  assertWeeklyOffDeadline,
  contractDurationMonths,
  inclusiveDateDays,
  ptOperationsPolicySnapshot,
  offRegistrationLimit,
  policyUsageDecision,
  storedDateShape,
  vietnamDateKey,
  vietnamMonthKey,
} = require('./pt-policy')

const DAILY_SESSION_QUERY_LIMIT = 200
const REQUEST_QUERY_LIMIT = 200
const PAUSE_SESSION_QUERY_LIMIT = 200
const AUTOMATIC_CHARGE_QUERY_LIMIT = 2000
const AUTO_ATTENDANCE_CONFIRM_HOURS = 48
// The frequent worker only needs a narrow recovery window. Older legacy
// sessions are reconciled by the daily catch-up worker instead of being
// re-read every few minutes.
const AUTO_ATTENDANCE_LOOKBACK_DAYS = 4
const AUTOMATION_PAGE_SIZE = 500
const BULK_ATTENDANCE_LIMIT = 30
const TEACHING_SHIFT_CORRECTION_LIMIT = 6
const NO_SHOW_GRACE_MINUTES = 15
const OPERATIONS_REQUEST_HISTORY_LIMIT = 500
const SESSION_CHANGE_SUGGESTION_LIMIT = 18
const SESSION_CHANGE_WINDOW_DAYS = 21
const SESSION_CHANGE_DATA_LIMIT = 2000
const SESSION_CHANGE_TRAINER_LIMIT = 400
const SESSION_CHANGE_BRANCH_LIMIT = 50
const ATTENDANCE_STATUSES = new Set(['present', 'late', 'no_show'])
const NO_SHOW_REASONS = new Set(['', 'busy', 'sick', 'forgot', 'unreachable', 'other'])
const BILLING_REVIEW_STATUS = 'review_required'
const AUTOMATIC_CHARGE_ISSUE_SOURCE = 'automatic_charge'

function id(value, label) {
  const result = typeof value === 'string' ? value.trim() : ''
  if (!result || !/^[A-Za-z0-9_-]+$/.test(result)) throw new HttpsError('invalid-argument', `${label} không hợp lệ.`)
  return result
}

function date(value) {
  const result = typeof value === 'string' ? value.trim() : ''
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result)) throw new HttpsError('invalid-argument', 'Ngày không hợp lệ.')
  const parsed = new Date(`${result}T00:00:00.000Z`)
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== result) throw new HttpsError('invalid-argument', 'Ngày không hợp lệ.')
  return result
}

function hour(value) {
  if (!Number.isInteger(value) || value < 0 || value > 23) throw new HttpsError('invalid-argument', 'Giờ không hợp lệ.')
  return value
}

function isActiveSessionStatus(status) {
  return status === 'scheduled' || status === 'rescheduled'
}

function sessionRevision(value) {
  const revision = value ?? 0
  if (!Number.isInteger(revision) || revision < 0) throw new HttpsError('invalid-argument', 'Phiên bản buổi tập không hợp lệ.')
  return revision
}

function storedDateKey(value, label) {
  const key = typeof value === 'string' ? value.trim().slice(0, 10) : ''
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) throw new HttpsError('failed-precondition', `${label} không hợp lệ.`)
  const parsed = new Date(`${key}T00:00:00.000Z`)
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== key) throw new HttpsError('failed-precondition', `${label} không hợp lệ.`)
  return key
}

function storedSessionHour(value, sessionId, label) {
  const fallback = Number(String(sessionId).split('-')[1])
  const result = Number.isInteger(value) ? value : fallback
  if (!Number.isInteger(result) || result < 0 || result > 23) throw new HttpsError('failed-precondition', `${label} không hợp lệ.`)
  return result
}

function nextDateKey(value) {
  const next = new Date(`${value}T00:00:00.000Z`)
  next.setUTCDate(next.getUTCDate() + 1)
  return next.toISOString().slice(0, 10)
}

function vietnamWeekStartDateKey(value = new Date()) {
  const current = vietnamDateKey(value)
  const parsed = new Date(`${current}T00:00:00.000Z`)
  const weekday = parsed.getUTCDay()
  return addDateDays(current, weekday === 0 ? -6 : 1 - weekday)
}

function dailySessionsQuery(db, ownerField, ownerId, targetDate) {
  return db.collection('sessions')
    .where(ownerField, '==', ownerId)
    .where('date', '>=', targetDate)
    .where('date', '<', nextDateKey(targetDate))
    .limit(DAILY_SESSION_QUERY_LIMIT)
}

function activeHourDocuments(snapshot, targetHour, excludedIds = []) {
  if (snapshot.size >= DAILY_SESSION_QUERY_LIMIT) {
    throw new HttpsError('resource-exhausted', 'Có quá nhiều buổi trong ngày để xác minh xung đột an toàn. Vui lòng liên hệ quản trị hệ thống.')
  }
  const excluded = new Set(excludedIds)
  return snapshot.docs.filter((item) => (
    !excluded.has(item.id)
    && isActiveSessionStatus(item.data().status)
    && storedSessionHour(item.data().hour, item.id, 'Giờ của buổi tập liên quan') === targetHour
  ))
}

function activeDayDocuments(snapshot, excludedIds = []) {
  if (snapshot.size >= DAILY_SESSION_QUERY_LIMIT) {
    throw new HttpsError('resource-exhausted', 'Có quá nhiều buổi trong ngày để xác minh xung đột an toàn. Vui lòng liên hệ quản trị hệ thống.')
  }
  const excluded = new Set(excludedIds)
  return snapshot.docs.filter((item) => !excluded.has(item.id) && isActiveSessionStatus(item.data().status))
}

function storedContractDate(value, label) {
  const raw = value && typeof value.toDate === 'function'
    ? value.toDate().toISOString()
    : value instanceof Date
      ? value.toISOString()
      : typeof value === 'string'
        ? value
        : ''
  const result = raw.slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result)) {
    throw new HttpsError('failed-precondition', `${label} của hợp đồng không hợp lệ.`)
  }
  return result
}

function linkedContractId(session) {
  const result = typeof session?.contractId === 'string' ? session.contractId.trim() : ''
  if (!result || !/^[A-Za-z0-9_-]+$/.test(result)) {
    throw new HttpsError(
      'failed-precondition',
      'Buổi tập chưa liên kết hợp đồng. Hãy chạy đối soát contractId trước khi điểm danh.',
      { issueCode: 'SESSION_CONTRACT_LINK_REQUIRED' },
    )
  }
  return result
}

function boundedReason(value, label = 'Lý do') {
  const result = typeof value === 'string' ? value.trim() : ''
  if (result.length < 3 || result.length > 500) throw new HttpsError('invalid-argument', `${label} phải từ 3 đến 500 ký tự.`)
  return result
}

function policyFailure(error) {
  return new HttpsError('failed-precondition', error?.message || 'Yêu cầu không đáp ứng chính sách vận hành.', {
    issueCode: error?.issueCode || 'PT_POLICY_REJECTED',
    deadlineAt: error?.deadlineAt || null,
  })
}

function requestInstant(value, fallbackValue) {
  if (value && typeof value.toDate === 'function') return value.toDate()
  const candidate = value instanceof Date ? value : new Date(value || '')
  if (!Number.isNaN(candidate.getTime())) return candidate
  const fallback = fallbackValue instanceof Date ? fallbackValue : new Date(fallbackValue || '')
  return Number.isNaN(fallback.getTime()) ? null : fallback
}

function optionalText(value, maximum = 500) {
  return typeof value === 'string' ? value.trim().slice(0, maximum) : ''
}

function storedInstantIso(value) {
  const instant = requestInstant(value)
  return instant ? instant.toISOString() : null
}

function timestampMillis(value, fallback = 0) {
  const instant = requestInstant(value)
  return instant ? instant.getTime() : fallback
}

async function documentsById(db, collectionName, values) {
  const ids = [...new Set(values.filter((value) => typeof value === 'string' && /^[A-Za-z0-9_-]+$/.test(value)))]
  const result = new Map()
  for (let offset = 0; offset < ids.length; offset += 100) {
    const references = ids.slice(offset, offset + 100).map((documentId) => db.doc(`${collectionName}/${documentId}`))
    if (!references.length) continue
    const snapshots = await db.getAll(...references)
    snapshots.forEach((snapshot) => {
      if (snapshot.exists) result.set(snapshot.id, snapshot.data())
    })
  }
  return result
}

function requestStatus(value) {
  return value === 'approved' || value === 'rejected' ? value : 'pending'
}

function linkedStudentId(actor) {
  const result = typeof actor?.legacyStaffId === 'string' && actor.legacyStaffId.trim()
    ? actor.legacyStaffId.trim()
    : actor?.uid
  return id(result, 'Mã hồ sơ học viên')
}

async function studentActor(request, db) {
  const actor = await trustedAccessContext(request, db)
  if (actor.accessRole !== 'student') throw new HttpsError('permission-denied', 'Chỉ học viên được gửi yêu cầu cho lịch của chính mình.')
  return actor
}

function policyUsageReference(db, studentId, monthKey) {
  return db.doc(`ptPolicyUsage/${studentId}_${monthKey}`)
}

function mondayForDate(value) {
  const parsed = new Date(`${storedDateKey(value, 'Ngày')}T00:00:00.000Z`)
  const weekday = parsed.getUTCDay()
  parsed.setUTCDate(parsed.getUTCDate() + (weekday === 0 ? -6 : 1 - weekday))
  return parsed.toISOString().slice(0, 10)
}

function dayCodeForDate(value) {
  const weekday = new Date(`${storedDateKey(value, 'Ngày')}T00:00:00.000Z`).getUTCDay()
  return weekday === 0 ? 'CN' : `T${weekday + 1}`
}

function normalizedTrainerCapacity(value) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 6 ? parsed : 2
}

function trainerPolicy(trainer = {}) {
  const dailyTarget = Number(trainer.dailySessionTarget)
  const priority = Number(trainer.schedulingPriority ?? trainer.priority)
  return {
    dailySessionTarget: Number.isInteger(dailyTarget) && dailyTarget >= 1 && dailyTarget <= 16 ? dailyTarget : 8,
    schedulingPriority: Number.isInteger(priority) && priority >= 1 && priority <= 999 ? priority : 100,
    employmentType: ['full_time', 'part_time', 'collaborator'].includes(trainer.employmentType) ? trainer.employmentType : 'full_time',
  }
}

function pauseCoversDate(contract, targetDate) {
  return Array.isArray(contract?.pausePeriods) && contract.pausePeriods.some((period) => {
    const start = typeof period?.startDate === 'string' ? period.startDate.slice(0, 10) : ''
    const end = typeof period?.endDate === 'string' ? period.endDate.slice(0, 10) : start
    return start && end && targetDate >= start && targetDate <= end
  })
}

function activeSessionRows(snapshot, excludedSessionId = '') {
  if (snapshot.size > SESSION_CHANGE_DATA_LIMIT) {
    throw new HttpsError('resource-exhausted', 'Dữ liệu lịch vượt giới hạn an toàn để gợi ý đổi ca.')
  }
  return snapshot.docs.map((item) => ({ id: item.id, ...item.data() }))
    .filter((item) => item.id !== excludedSessionId && isActiveSessionStatus(item.status))
}

function hasThreeConsecutiveTrainingDays(existingDates, candidateDate) {
  const values = new Set([...existingDates, candidateDate])
  const ordered = [...values].sort()
  for (const value of ordered) {
    if (values.has(addDateDays(value, 1)) && values.has(addDateDays(value, 2))) return true
  }
  return false
}

function sessionChangeCandidateId({ sessionId, revision, date: targetDate, hour: targetHour, trainerId, branchId = '' }) {
  return createHash('sha256')
    .update(`${sessionId}|${revision}|${targetDate}|${targetHour}|${trainerId}|${branchId}`)
    .digest('hex')
    .slice(0, 32)
}

async function loadSuggestionNetwork(db, homeBranchId, rangeStart, rangeEnd) {
  const [branchesSnapshot, trainersSnapshot, sessionsSnapshot] = await Promise.all([
    db.collection('branches').limit(SESSION_CHANGE_BRANCH_LIMIT + 1).get(),
    db.collection('trainers').limit(SESSION_CHANGE_TRAINER_LIMIT + 1).get(),
    db.collection('sessions').where('date', '>=', rangeStart).where('date', '<', addDateDays(rangeEnd, 1)).limit(SESSION_CHANGE_DATA_LIMIT + 1).get(),
  ])
  if (branchesSnapshot.size > SESSION_CHANGE_BRANCH_LIMIT || trainersSnapshot.size > SESSION_CHANGE_TRAINER_LIMIT || sessionsSnapshot.size > SESSION_CHANGE_DATA_LIMIT) {
    throw new HttpsError('resource-exhausted', 'Dữ liệu liên chi nhánh vượt giới hạn gợi ý an toàn.')
  }
  const knownBranchIds = new Set(branchesSnapshot.docs.map((item) => item.id))
  const branches = new Map(branchesSnapshot.docs
    .filter((item) => !['archived', 'inactive'].includes(String(item.data().status || '').toLowerCase()))
    .map((item) => [item.id, {
      id: item.id,
      name: optionalText(item.data().name, 160) || 'Chi nhánh Aura',
    }]))
  // Một số bộ dữ liệu cũ chưa có document branches. Vẫn cho gợi ý trong
  // phạm vi chi nhánh xuất hiện trên hồ sơ PT, nhưng không bịa tên cơ sở.
  if (!branches.size) {
    trainersSnapshot.docs.forEach((item) => {
      const trainerBranchId = optionalText(item.data().branchId, 128)
      if (trainerBranchId && !branches.has(trainerBranchId)) branches.set(trainerBranchId, { id: trainerBranchId, name: 'Chi nhánh Aura' })
    })
  }
  if (homeBranchId && !knownBranchIds.has(homeBranchId) && !branches.has(homeBranchId)) branches.set(homeBranchId, { id: homeBranchId, name: 'Chi nhánh Aura' })
  return { branches, trainersSnapshot, sessionsSnapshot }
}

async function readOperationsPolicy(db) {
  const [snapshot] = await db.getAll(db.doc('settings/scheduleConfig'))
  return ptOperationsPolicySnapshot(snapshot?.exists ? snapshot.data() : {})
}

async function getAllInChunks(db, references, chunkSize = 100) {
  const snapshots = []
  for (let index = 0; index < references.length; index += chunkSize) {
    snapshots.push(...await db.getAll(...references.slice(index, index + chunkSize)))
  }
  return snapshots
}

async function effectiveStudentAvailabilityByWeek({ db, studentId, student, weekIds, exactSnapshots }) {
  const exactByWeek = new Map(
    exactSnapshots
      .filter((snapshot) => snapshot?.exists)
      .map((snapshot) => [String(snapshot.data()?.weekId || snapshot.id.slice(-10)), snapshot.data()]),
  )
  const result = new Map()
  const orderedWeeks = [...weekIds].sort()
  if (!orderedWeeks.length) return result
  const firstWeek = orderedWeeks[0]
  const firstExact = exactByWeek.get(firstWeek)
  const initialFallback = await loadLatestSubmittedFallbacks(
    db,
    new Map([[studentId, student]]),
    new Map(firstExact ? [[studentId, firstExact]] : []),
    firstWeek,
  )
  let inherited = initialFallback.get(studentId)
  for (const targetWeek of orderedWeeks) {
    const exact = exactByWeek.get(targetWeek)
    result.set(targetWeek, effectiveStudentAvailability({
      targetWeek,
      exact,
      inherited,
      profile: student,
    }))
    inherited = normalizedSubmittedAvailability(exact, targetWeek) || inherited
  }
  return result
}

function weeklyTrainerAvailabilityMap(snapshots) {
  return new Map(snapshots.filter((snapshot) => snapshot?.exists).map((snapshot) => {
    const value = snapshot.data()
    return [`${value.trainerId}_${value.weekId}`, value]
  }))
}

function effectiveTrainerForWeek(trainer, weeklyAvailability, targetWeek) {
  return trainerProfileForWeek(trainer, weeklyAvailability.get(`${trainer.id}_${targetWeek}`), targetWeek)
}

function assertOperatingCalendar(configValue, targetDate, targetHour) {
  const config = normalizedScheduleConfig(configValue)
  const dayCode = dayCodeForDate(targetDate)
  if (!config.workingDays.includes(dayCode) || !config.workingHours.includes(targetHour)) {
    throw new HttpsError('failed-precondition', 'Ca đề xuất nằm ngoài ngày hoặc giờ hoạt động.', { issueCode: 'OUTSIDE_OPERATING_CALENDAR' })
  }
  if (config.holidays.includes(targetDate)) {
    throw new HttpsError('failed-precondition', 'Ca đề xuất rơi vào ngày nghỉ lễ.', { issueCode: 'SCHEDULE_HOLIDAY' })
  }
  return { config, dayCode, slotId: `${dayCode}-${targetHour}` }
}

async function buildSessionChangeSuggestions({ db, sessionId, expectedRevision, studentId, now }) {
  const sessionReference = db.doc(`sessions/${sessionId}`)
  const [sessionSnapshot, policy] = await Promise.all([
    db.getAll(sessionReference).then((values) => values[0]),
    readOperationsPolicy(db),
  ])
  if (!sessionSnapshot?.exists) throw new HttpsError('not-found', 'Không tìm thấy buổi tập.')
  const session = sessionSnapshot.data()
  const revision = Number(session.revision || 0)
  if (revision !== expectedRevision) throw new HttpsError('aborted', 'Buổi tập đã thay đổi. Hãy tải lại lịch mới nhất.')
  if (session.studentId !== studentId) throw new HttpsError('permission-denied', 'Bạn không thể đổi lịch của học viên khác.')
  if (!isActiveSessionStatus(session.status) || isSessionCharged(session)) throw new HttpsError('failed-precondition', 'Buổi này không còn đủ điều kiện đổi lịch.')

  const contractId = linkedContractId(session)
  const [contractSnapshot, studentSnapshot] = await db.getAll(db.doc(`contracts/${contractId}`), db.doc(`students/${studentId}`))
  if (!contractSnapshot.exists || !studentSnapshot.exists) throw new HttpsError('failed-precondition', 'Thiếu hợp đồng hoặc hồ sơ học viên để gợi ý ca.')
  const contract = contractSnapshot.data()
  const student = studentSnapshot.data()
  const branchId = id(session.branchId || contract.branchId || student.branchId, 'Mã chi nhánh')
  if (contract.status !== 'active' || contract.studentId !== studentId) throw new HttpsError('failed-precondition', 'Hợp đồng không còn hoạt động.')
  const contractStart = storedContractDate(contract.startDate, 'Ngày bắt đầu')
  const contractEnd = storedContractDate(contract.endDate, 'Ngày kết thúc')
  const earliest = addDateDays(vietnamDateKey(now), 1)
  const rangeStart = earliest < contractStart ? contractStart : earliest
  const rangeEndCandidate = addDateDays(rangeStart, SESSION_CHANGE_WINDOW_DAYS)
  const rangeEnd = rangeEndCandidate < contractEnd ? rangeEndCandidate : contractEnd
  if (rangeStart > rangeEnd) return { policy, suggestions: [], issueCodes: ['NO_CONTRACT_DATE_AVAILABLE'] }

  const weekIds = new Set()
  for (let targetDate = rangeStart; targetDate <= rangeEnd; targetDate = addDateDays(targetDate, 1)) weekIds.add(mondayForDate(targetDate))
  const availabilityReferences = [...weekIds].map((weekId) => db.doc(`ptAvailability/${studentId}_${weekId}`))
  const [network, studentSessionsSnapshot, leavesSnapshot, configSnapshot, ...availabilitySnapshots] = await Promise.all([
    loadSuggestionNetwork(db, branchId, rangeStart, rangeEnd),
    db.collection('sessions').where('studentId', '==', studentId).where('date', '>=', rangeStart).where('date', '<', addDateDays(rangeEnd, 1)).limit(SESSION_CHANGE_DATA_LIMIT + 1).get(),
    db.collection('leaveRequests').where('status', '==', 'approved').limit(1001).get(),
    db.getAll(db.doc('settings/scheduleConfig')).then((values) => values[0]),
    ...availabilityReferences.map((reference) => db.getAll(reference).then((values) => values[0])),
  ])
  const { branches, trainersSnapshot, sessionsSnapshot } = network
  if (studentSessionsSnapshot.size > SESSION_CHANGE_DATA_LIMIT || leavesSnapshot.size > 1000) throw new HttpsError('resource-exhausted', 'Dữ liệu PT, học viên hoặc OFF vượt giới hạn gợi ý an toàn.')
  const sessions = activeSessionRows(sessionsSnapshot, sessionId)
  const studentSessions = activeSessionRows(studentSessionsSnapshot, sessionId)
  const assignedTrainerIds = new Set([
    session.trainerId,
    contract.trainerId,
    ...(Array.isArray(contract.trainerIds) ? contract.trainerIds : []),
  ].filter(Boolean))
  const trainers = trainersSnapshot.docs.map((item) => ({ id: item.id, ...item.data() }))
    .filter((trainer) => trainer.status !== 'inactive')
    .filter((trainer) => trainer.branchId && branches.has(trainer.branchId))
    .filter((trainer) => assignedTrainerIds.has(trainer.id) || trainerPolicy(trainer).employmentType === 'full_time')
  const trainerAvailabilityReferences = trainers.flatMap((trainer) => [...weekIds].map((targetWeek) => db.doc(`trainerAvailability/${trainer.id}_${targetWeek}`)))
  const [studentAvailabilityByWeek, trainerAvailability] = await Promise.all([
    effectiveStudentAvailabilityByWeek({ db, studentId, student, weekIds, exactSnapshots: availabilitySnapshots }),
    getAllInChunks(db, trainerAvailabilityReferences).then(weeklyTrainerAvailabilityMap),
  ])
  const scheduleConfig = normalizedScheduleConfig(configSnapshot?.exists ? configSnapshot.data() : {})
  const studentTrainingDates = new Set(studentSessions.map((item) => storedDateKey(item.date, 'Ngày buổi liên quan')))
  const candidates = []

  for (let targetDate = rangeStart; targetDate <= rangeEnd; targetDate = addDateDays(targetDate, 1)) {
    if (pauseCoversDate(contract, targetDate)) continue
    const dayCode = dayCodeForDate(targetDate)
    if (!scheduleConfig.workingDays.includes(dayCode) || scheduleConfig.holidays.includes(targetDate)) continue
    if (studentTrainingDates.has(targetDate)) continue
    const targetWeek = mondayForDate(targetDate)
    const effectiveStudentAvailability = studentAvailabilityByWeek.get(targetWeek)
    const studentSlots = effectiveStudentAvailability?.confirmed ? effectiveStudentAvailability.slots : []
    if (!studentSlots.length) continue

    for (const baseTrainer of trainers) {
      const trainer = effectiveTrainerForWeek(baseTrainer, trainerAvailability, targetWeek)
      const targetBranchId = optionalText(trainer.branchId, 128)
      const targetBranchName = branches.get(targetBranchId)?.name || 'Chi nhánh Aura'
      const isCrossBranch = targetBranchId !== branchId
      const policyData = trainerPolicy(trainer)
      const trainerOnLeave = leavesSnapshot.docs.some((item) => {
        const leave = item.data()
        const start = typeof leave.startDate === 'string' ? leave.startDate.slice(0, 10) : ''
        const end = typeof leave.endDate === 'string' ? leave.endDate.slice(0, 10) : start
        return leave.trainerId === trainer.id && start && end && targetDate >= start && targetDate <= end
      })
      if (trainerOnLeave) continue
        const assigned = assignedTrainerIds.has(trainer.id)
        const isPrimaryTrainer = trainer.id === contract.trainerId
      for (let targetHour = 0; targetHour <= 23; targetHour += 1) {
        const slotId = `${dayCode}-${targetHour}`
        if (!scheduleConfig.workingHours.includes(targetHour)) continue
        if (!studentSlots.includes(slotId) || !trainerIsAvailable(trainer, slotId)) continue
        if (targetDate === storedDateKey(session.date, 'Ngày buổi gốc') && targetHour === storedSessionHour(session.hour, sessionId, 'Giờ buổi gốc') && trainer.id === session.trainerId) continue
        const slotStart = new Date(`${targetDate}T${String(targetHour).padStart(2, '0')}:00:00+07:00`)
        if (slotStart.getTime() - now.getTime() < policy.sessionChangeDeadlineHours * 60 * 60 * 1000) continue
        const sameTrainerDate = sessions.filter((item) => item.trainerId === trainer.id && storedDateKey(item.date, 'Ngày lịch PT') === targetDate)
        const atSlot = sameTrainerDate.filter((item) => storedSessionHour(item.hour, item.id, 'Giờ lịch PT') === targetHour)
        const occupancy = new Set(atSlot.map((item) => item.studentId)).size
        const capacity = normalizedTrainerCapacity(trainer.slotCapacity)
        if (occupancy >= capacity) continue
        const siteCapacity = branchSlotCapacity(scheduleConfig, targetBranchId, slotId)
        const siteOccupancy = sessions.filter((item) => storedDateKey(item.date, 'Ngày lịch chi nhánh') === targetDate && storedSessionHour(item.hour, item.id, 'Giờ lịch chi nhánh') === targetHour && item.branchId === targetBranchId).length
        if (siteCapacity !== null && siteOccupancy >= siteCapacity) continue
        const uniqueTeachingSlots = new Set(sameTrainerDate.map((item) => storedSessionHour(item.hour, item.id, 'Giờ lịch PT'))).size
        const pairsExistingSession = occupancy === 1 && capacity === 2
        const projectedTeachingSlots = uniqueTeachingSlots + (pairsExistingSession ? 0 : 1)
        const overTargetAfter = projectedTeachingSlots > policyData.dailySessionTarget
        const createsThreeConsecutiveDays = hasThreeConsecutiveTrainingDays(studentTrainingDates, targetDate)
        const daysFromStart = inclusiveDateDays(rangeStart, targetDate) - 1
        // Opportunity tiers are deliberately strict. A free seat in an
        // existing 1/2 class always wins; only then do we open a new slot
        // for the primary PT while they are below the soft daily target;
        // other available PT slots are the final fallback. The target is a
        // balancing hint, never a hard scheduling limit.
        const priorityTier = pairsExistingSession
          ? 1
          : isPrimaryTrainer && projectedTeachingSlots <= policyData.dailySessionTarget
            ? 2
            : 3
        const score = (4 - priorityTier) * 100000
          + (assigned ? 6000 : 0)
          + (trainer.id === session.trainerId ? 2500 : 0)
          + (isPrimaryTrainer ? 2200 : 0)
          + (policyData.employmentType === 'full_time' ? 1800 : 0)
          + (isCrossBranch ? -900 : 1400)
          + Math.max(0, policyData.dailySessionTarget - projectedTeachingSlots) * 180
          - policyData.schedulingPriority
          - projectedTeachingSlots * 25
          - daysFromStart * 5
          - (createsThreeConsecutiveDays ? 3500 : 0)
        candidates.push({
          candidateId: sessionChangeCandidateId({ sessionId, revision, date: targetDate, hour: targetHour, trainerId: trainer.id, branchId: targetBranchId }),
          date: targetDate,
          hour: targetHour,
          trainerId: trainer.id,
          trainerName: optionalText(trainer.name, 160) || 'PT chưa cập nhật tên',
          branchId: targetBranchId,
          branchName: targetBranchName,
          homeBranchId: branchId,
          homeBranchName: branches.get(branchId)?.name || 'Chi nhánh Aura',
          isCrossBranch,
          occupancy,
          capacity,
          pairsExistingSession,
          priorityTier,
          isPrimaryTrainer,
          isAssignedTrainer: assigned,
          isCurrentTrainer: trainer.id === session.trainerId,
          employmentType: policyData.employmentType,
          // `dailyLoad` remains as a compatibility alias for clients deployed
          // before soft-load v1. New clients show the projected value.
          dailyLoad: uniqueTeachingSlots,
          dailyLoadBefore: uniqueTeachingSlots,
          dailyLoadAfter: projectedTeachingSlots,
          dailyTarget: policyData.dailySessionTarget,
          overTargetAfter,
          loadPolicyVersion: 'soft-daily-target-v1',
          createsThreeConsecutiveDays,
          score,
        })
      }
    }
  }
  candidates.sort((left, right) => right.score - left.score || left.date.localeCompare(right.date) || left.hour - right.hour || left.trainerName.localeCompare(right.trainerName, 'vi'))
  return {
    policy,
    homeBranchId: branchId,
    homeBranchName: branches.get(branchId)?.name || 'Chi nhánh Aura',
    suggestions: candidates.slice(0, SESSION_CHANGE_SUGGESTION_LIMIT).map(({ score, ...candidate }, index) => ({ ...candidate, rank: index + 1 })),
    issueCodes: candidates.length ? [] : ['NO_MATCHING_SLOT'],
  }
}

function pauseRequestType(value) {
  if (value === 'off' || value === 'preservation') return value
  throw new HttpsError('invalid-argument', 'Loại yêu cầu phải là OFF hoặc bảo lưu.')
}

function isOffPauseRequest(value) {
  if (value?.type === 'off') return true
  if (value?.type === 'preservation') return false
  try {
    return inclusiveDateDays(value?.startDate, value?.endDate) <= 14
  } catch {
    return false
  }
}

function sessionStartInstant(session, sessionId) {
  const sessionDate = storedDateKey(session.date, 'Ngày của buổi tập')
  const sessionHour = storedSessionHour(session.hour, sessionId, 'Giờ của buổi tập')
  const instant = new Date(`${sessionDate}T${String(sessionHour).padStart(2, '0')}:00:00+07:00`)
  if (Number.isNaN(instant.getTime())) throw new HttpsError('failed-precondition', 'Thời gian của buổi tập không hợp lệ.')
  return instant
}

function normalizedAttendanceStatus(value) {
  if (!ATTENDANCE_STATUSES.has(value)) {
    throw new HttpsError('invalid-argument', 'Trạng thái hiện diện phải là có tập, đi trễ hoặc không đến.')
  }
  return value
}

function normalizedLateMinutes(status, value) {
  if (status !== 'late') return null
  const result = Number(value)
  if (![5, 10, 15].includes(result)) throw new HttpsError('invalid-argument', 'Mốc đi trễ phải là 5, 10 hoặc 15+ phút.')
  return result
}

function normalizedNoShowReason(status, value) {
  if (status !== 'no_show') return ''
  const result = typeof value === 'string' ? value.trim() : ''
  if (!NO_SHOW_REASONS.has(result)) throw new HttpsError('invalid-argument', 'Lý do không đến không hợp lệ.')
  return result
}

function normalizedAttendanceNote(value) {
  const result = typeof value === 'string' ? value.trim() : ''
  if (result.length > 300) throw new HttpsError('invalid-argument', 'Ghi chú hiện diện tối đa 300 ký tự.')
  return result
}

// Build the same opportunity tiers for a learner who wants to add a session
// (there is no source session to reschedule). This intentionally mirrors the
// change-session policy so management and learner surfaces share one ordering:
// fill a 1/2 seat, then the primary trainer below the soft target, then any
// other valid trainer slot. The daily target is never a hard ceiling.
async function buildAdditionalSessionSuggestions({ db, studentId, now }) {
  const [policy, studentSnapshot, contractsSnapshot] = await Promise.all([
    readOperationsPolicy(db),
    db.getAll(db.doc(`students/${studentId}`)).then((values) => values[0]),
    db.collection('contracts').where('studentId', '==', studentId).limit(50).get(),
  ])
  if (!studentSnapshot?.exists) throw new HttpsError('not-found', 'Không tìm thấy hồ sơ học viên.')
  const student = studentSnapshot.data()
  const today = vietnamDateKey(now)
  const activeContracts = contractsSnapshot.docs.map((item) => ({ id: item.id, ...item.data() }))
    .filter((contract) => ['active', 'future'].includes(effectiveContractStatus(contract, today)))
    .filter((contract) => {
      try {
        const start = storedContractDate(contract.startDate, 'Ngày bắt đầu')
        const end = storedContractDate(contract.endDate, 'Ngày kết thúc')
        return start <= end && end >= today && Number(contract.usedSessions || 0) < Number(contract.totalSessions || 0)
      } catch { return false }
    })
    .sort((left, right) => String(left.endDate).localeCompare(String(right.endDate)) || left.id.localeCompare(right.id))
  const contract = activeContracts[0]
  if (!contract) return { policy, contractId: null, weeklyTarget: Number(student.sessionsPerWeek || 0), weeklyMaximum: Math.max(1, Number(student.maxWeeklySessions || 7)), suggestions: [], issueCodes: ['NO_ACTIVE_CONTRACT'] }
  const contractStart = storedContractDate(contract.startDate, 'Ngày bắt đầu')
  const contractEnd = storedContractDate(contract.endDate, 'Ngày kết thúc')
  const rangeStart = today < contractStart ? contractStart : addDateDays(today, 1)
  const rangeEndCandidate = addDateDays(rangeStart, SESSION_CHANGE_WINDOW_DAYS)
  const rangeEnd = rangeEndCandidate < contractEnd ? rangeEndCandidate : contractEnd
  if (rangeStart > rangeEnd) return { policy, contractId: contract.id, weeklyTarget: Number(student.sessionsPerWeek || 0), weeklyMaximum: Math.max(1, Number(student.maxWeeklySessions || 7)), suggestions: [], issueCodes: ['NO_CONTRACT_DATE_AVAILABLE'] }
  const branchId = id(contract.branchId || student.branchId, 'Mã chi nhánh')

  const weekIds = new Set()
  for (let targetDate = rangeStart; targetDate <= rangeEnd; targetDate = addDateDays(targetDate, 1)) weekIds.add(mondayForDate(targetDate))
  const availabilityReferences = [...weekIds].map((weekId) => db.doc(`ptAvailability/${studentId}_${weekId}`))
  const [network, leavesSnapshot, requestsSnapshot, contractSessionsSnapshot, studentSessionsSnapshot, configSnapshot, ...availabilitySnapshots] = await Promise.all([
    loadSuggestionNetwork(db, branchId, rangeStart, rangeEnd),
    db.collection('leaveRequests').where('status', '==', 'approved').limit(1001).get(),
    db.collection('sessionRequests').where('studentId', '==', studentId).limit(100).get(),
    db.collection('sessions').where('contractId', '==', contract.id).limit(SESSION_CHANGE_DATA_LIMIT + 1).get(),
    db.collection('sessions').where('studentId', '==', studentId).limit(SESSION_CHANGE_DATA_LIMIT + 1).get(),
    db.getAll(db.doc('settings/scheduleConfig')).then((values) => values[0]),
    ...availabilityReferences.map((reference) => db.getAll(reference).then((values) => values[0])),
  ])
  const { branches, trainersSnapshot, sessionsSnapshot } = network
  if (contractSessionsSnapshot.size > SESSION_CHANGE_DATA_LIMIT || studentSessionsSnapshot.size > SESSION_CHANGE_DATA_LIMIT || leavesSnapshot.size > 1000) {
    throw new HttpsError('resource-exhausted', 'Dữ liệu lịch vượt giới hạn an toàn để gợi ý ca bổ sung.')
  }
  if (requestsSnapshot.docs.some((item) => item.data().type === 'additional' && item.data().status === 'pending')) {
    return { policy, contractId: contract.id, weeklyTarget: Number(student.sessionsPerWeek || 0), weeklyMaximum: Math.max(1, Number(student.maxWeeklySessions || 7)), suggestions: [], issueCodes: ['ADDITIONAL_REQUEST_PENDING'] }
  }
  const sessions = activeSessionRows(sessionsSnapshot)
  const studentSessions = activeSessionRows(studentSessionsSnapshot)
  const contractSessionRows = contractSessionsSnapshot.docs.map((item) => ({ id: item.id, ...item.data() }))
  const contractScheduled = activeSessionRows(contractSessionsSnapshot).length
  const contractUsage = summarizeContractUsage(contract, contractSessionRows)
  if (contractScheduled >= contractUsage.remainingSessions) {
    return { policy, contractId: contract.id, weeklyTarget: Number(student.sessionsPerWeek || 0), weeklyMaximum: Math.max(1, Number(student.maxWeeklySessions || 7)), suggestions: [], issueCodes: ['CONTRACT_QUOTA_EXHAUSTED'] }
  }
  const assignedTrainerIds = new Set([contract.trainerId, ...(Array.isArray(contract.trainerIds) ? contract.trainerIds : [])].filter(Boolean))
  const trainers = trainersSnapshot.docs.map((item) => ({ id: item.id, ...item.data() }))
    .filter((trainer) => trainer.status !== 'inactive')
    .filter((trainer) => trainer.branchId && branches.has(trainer.branchId))
    .filter((trainer) => assignedTrainerIds.has(trainer.id) || trainerPolicy(trainer).employmentType === 'full_time')
  const trainerAvailabilityReferences = trainers.flatMap((trainer) => [...weekIds].map((targetWeek) => db.doc(`trainerAvailability/${trainer.id}_${targetWeek}`)))
  const [studentAvailabilityByWeek, trainerAvailability] = await Promise.all([
    effectiveStudentAvailabilityByWeek({ db, studentId, student, weekIds, exactSnapshots: availabilitySnapshots }),
    getAllInChunks(db, trainerAvailabilityReferences).then(weeklyTrainerAvailabilityMap),
  ])
  const scheduleConfig = normalizedScheduleConfig(configSnapshot?.exists ? configSnapshot.data() : {})
  const studentTrainingDates = new Set(studentSessions.map((item) => storedDateKey(item.date, 'Ngày buổi liên quan')))
  const candidates = []
  for (let targetDate = rangeStart; targetDate <= rangeEnd; targetDate = addDateDays(targetDate, 1)) {
    if (pauseCoversDate(contract, targetDate)) continue
    const dayCode = dayCodeForDate(targetDate)
    if (!scheduleConfig.workingDays.includes(dayCode) || scheduleConfig.holidays.includes(targetDate)) continue
    if (studentTrainingDates.has(targetDate)) continue
    const targetWeek = mondayForDate(targetDate)
    const studentAvailability = studentAvailabilityByWeek.get(targetWeek)
    const studentSlots = studentAvailability?.confirmed ? studentAvailability.slots : []
    if (!studentSlots.length) continue
    const weekStart = targetWeek
    const weekScheduled = studentSessions.filter((item) => storedDateKey(item.date, 'Ngày lịch học viên') >= weekStart && storedDateKey(item.date, 'Ngày lịch học viên') <= addDateDays(weekStart, 6)).length
    const weeklyMaximum = Math.max(1, Number(student.maxWeeklySessions || 7))
    if (weekScheduled >= weeklyMaximum) continue
    for (const baseTrainer of trainers) {
      const trainer = effectiveTrainerForWeek(baseTrainer, trainerAvailability, targetWeek)
      const targetBranchId = optionalText(trainer.branchId, 128)
      const targetBranchName = branches.get(targetBranchId)?.name || 'Chi nhánh Aura'
      const isCrossBranch = targetBranchId !== branchId
      const policyData = trainerPolicy(trainer)
      const trainerOnLeave = leavesSnapshot.docs.some((item) => {
        const leave = item.data()
        const start = typeof leave.startDate === 'string' ? leave.startDate.slice(0, 10) : ''
        const end = typeof leave.endDate === 'string' ? leave.endDate.slice(0, 10) : start
        return leave.trainerId === trainer.id && start && end && targetDate >= start && targetDate <= end
      })
      if (trainerOnLeave) continue
      const assigned = assignedTrainerIds.has(trainer.id)
      const isPrimaryTrainer = trainer.id === contract.trainerId
      for (const targetHour of Array.from({ length: 24 }, (_, value) => value)) {
        const slotId = `${dayCode}-${targetHour}`
        if (!scheduleConfig.workingHours.includes(targetHour)) continue
        if (!studentSlots.includes(slotId)) continue
        if (!trainerIsAvailable(trainer, slotId)) continue
        const sameTrainerDate = sessions.filter((item) => item.trainerId === trainer.id && storedDateKey(item.date, 'Ngày lịch PT') === targetDate)
        const atSlot = sameTrainerDate.filter((item) => storedSessionHour(item.hour, item.id, 'Giờ lịch PT') === targetHour)
        const occupancy = new Set(atSlot.map((item) => item.studentId)).size
        const capacity = normalizedTrainerCapacity(trainer.slotCapacity)
        if (occupancy >= capacity) continue
        const siteCapacity = branchSlotCapacity(scheduleConfig, targetBranchId, slotId)
        const siteOccupancy = sessions.filter((item) => storedDateKey(item.date, 'Ngày lịch chi nhánh') === targetDate && storedSessionHour(item.hour, item.id, 'Giờ lịch chi nhánh') === targetHour && item.branchId === targetBranchId).length
        if (siteCapacity !== null && siteOccupancy >= siteCapacity) continue
        const uniqueTeachingSlots = new Set(sameTrainerDate.map((item) => storedSessionHour(item.hour, item.id, 'Giờ lịch PT'))).size
        const pairsExistingSession = occupancy === 1 && capacity === 2
        const projectedTeachingSlots = uniqueTeachingSlots + (pairsExistingSession ? 0 : 1)
        const priorityTier = pairsExistingSession ? 1 : isPrimaryTrainer && projectedTeachingSlots <= policyData.dailySessionTarget ? 2 : 3
        const slotStart = new Date(`${targetDate}T${String(targetHour).padStart(2, '0')}:00:00+07:00`)
        if (slotStart.getTime() - now.getTime() < policy.sessionChangeDeadlineHours * 60 * 60 * 1000) continue
        const createsThreeConsecutiveDays = hasThreeConsecutiveTrainingDays(studentTrainingDates, targetDate)
        const daysFromStart = inclusiveDateDays(rangeStart, targetDate) - 1
        const score = (4 - priorityTier) * 100000 + (assigned ? 6000 : 0) + (isPrimaryTrainer ? 2200 : 0)
          + (policyData.employmentType === 'full_time' ? 1800 : 0) + (isCrossBranch ? -900 : 1400) + Math.max(0, policyData.dailySessionTarget - projectedTeachingSlots) * 180
          - policyData.schedulingPriority - projectedTeachingSlots * 25 - daysFromStart * 5 - (createsThreeConsecutiveDays ? 3500 : 0)
        candidates.push({
          candidateId: createHash('sha256').update(`additional|${contract.id}|${targetDate}|${targetHour}|${trainer.id}|${targetBranchId}`).digest('hex').slice(0, 32),
          contractId: contract.id, date: targetDate, hour: targetHour, trainerId: trainer.id,
          trainerName: optionalText(trainer.name, 160) || 'PT chưa cập nhật tên', occupancy, capacity,
          branchId: targetBranchId, branchName: targetBranchName, homeBranchId: branchId,
          homeBranchName: branches.get(branchId)?.name || 'Chi nhánh Aura', isCrossBranch,
          pairsExistingSession, priorityTier, isPrimaryTrainer, isAssignedTrainer: assigned,
          employmentType: policyData.employmentType, dailyLoad: uniqueTeachingSlots, dailyLoadBefore: uniqueTeachingSlots,
          dailyLoadAfter: projectedTeachingSlots, dailyTarget: policyData.dailySessionTarget,
          overTargetAfter: projectedTeachingSlots > policyData.dailySessionTarget, createsThreeConsecutiveDays,
          requiresManagerApproval: weekScheduled >= Number(student.sessionsPerWeek || 0), weeklyScheduled: weekScheduled,
          weeklyTarget: Number(student.sessionsPerWeek || 0), score,
        })
      }
    }
  }
  candidates.sort((left, right) => left.priorityTier - right.priorityTier || right.score - left.score || left.date.localeCompare(right.date) || left.hour - right.hour || left.trainerName.localeCompare(right.trainerName, 'vi'))
  return {
    policy,
    contractId: contract.id,
    contractName: optionalText(contract.packageName, 160) || null,
    homeBranchId: branchId,
    homeBranchName: branches.get(branchId)?.name || 'Chi nhánh Aura',
    weeklyTarget: Number(student.sessionsPerWeek || 0),
    weeklyMaximum: Math.max(1, Number(student.maxWeeklySessions || 7)),
    suggestions: candidates.slice(0, SESSION_CHANGE_SUGGESTION_LIMIT).map(({ score, ...candidate }, index) => ({ ...candidate, rank: index + 1 })),
    issueCodes: candidates.length ? [] : ['NO_MATCHING_SLOT'],
  }
}

async function readAutomationSessionPage({ db, jobId, lowerDate, upperDate, filters = [], limit = AUTOMATION_PAGE_SIZE }) {
  const pageSize = Math.max(1, Math.min(AUTOMATIC_CHARGE_QUERY_LIMIT, Math.floor(Number(limit) || AUTOMATION_PAGE_SIZE)))
  const stateReference = db.doc(`systemJobs/${jobId}`)
  let state = null
  try {
    if (typeof stateReference.get === 'function') {
      const snapshot = await stateReference.get()
      state = snapshot.exists ? snapshot.data() : null
    }
  } catch {
    state = null
  }
  let query = db.collection('sessions')
  filters.forEach(({ field, operator = '==', value }) => { query = query.where(field, operator, value) })
  query = query.where('date', '<', upperDate)
  if (lowerDate) query = query.where('date', '>=', lowerDate)
  const cursorDate = typeof state?.cursorDate === 'string' ? state.cursorDate : ''
  const cursorId = typeof state?.cursorId === 'string' ? state.cursorId : ''
  try {
    query = query.orderBy('date', 'asc').orderBy(FieldPath.documentId(), 'asc').limit(pageSize)
    if (cursorDate && cursorId) query = query.startAfter(cursorDate, cursorId)
  } catch {
    // The in-memory test adapter and older emulators do not expose ordering;
    // the bounded fallback still preserves the safety limit.
    query = db.collection('sessions')
    filters.forEach(({ field, operator = '==', value }) => { query = query.where(field, operator, value) })
    query = query.where('date', '<', upperDate)
    if (lowerDate) query = query.where('date', '>=', lowerDate)
    query = query.limit(pageSize)
  }
  const snapshot = await query.get()
  const docs = snapshot.docs || []
  const last = docs[docs.length - 1]
  const nextCursor = docs.length >= pageSize && last
    ? { date: last.data()?.date || '', id: last.id }
    : null
  return { docs, nextCursor, pageSize, stateReference }
}

async function commitAutomationSessionPage({ stateReference, nextCursor, pageSize }) {
  try {
    if (typeof stateReference.set === 'function') {
      await stateReference.set({
        cursorDate: nextCursor?.date || '',
        cursorId: nextCursor?.id || '',
        updatedAt: FieldValue.serverTimestamp(),
        pageSize,
      }, { merge: true })
    }
  } catch { /* checkpoint writes must not prevent billing retries */ }
}

function automaticChargeIssueCode(error) {
  const explicit = typeof error?.details?.issueCode === 'string' ? error.details.issueCode.trim() : ''
  if (explicit) return explicit.slice(0, 100)
  const message = typeof error?.message === 'string' ? error.message : ''
  if (message.includes('Hợp đồng liên kết không tồn tại')) return 'SESSION_CONTRACT_NOT_FOUND'
  if (message.includes('Hợp đồng không thuộc học viên')) return 'SESSION_CONTRACT_STUDENT_MISMATCH'
  if (message.includes('trạng thái có thể đối soát')) return 'SESSION_CONTRACT_STATUS_INVALID'
  if (message.includes('ngoài thời hạn hợp đồng')) return 'SESSION_OUTSIDE_CONTRACT_WINDOW'
  if (message.includes('sổ sự kiện')) return 'SESSION_BILLING_LEDGER_MISMATCH'
  if (message.includes('Bản ghi hiện diện đã tồn tại')) return 'SESSION_ATTENDANCE_LEDGER_MISMATCH'
  return 'AUTOMATIC_SESSION_CHARGE_FAILED'
}

async function recordAutomaticChargeFailureIssue({ db, item, error, now }) {
  const session = item.data()
  const reference = db.doc(`sessionBillingIssues/${item.id}`)
  const issueCode = automaticChargeIssueCode(error)
  const errorCode = typeof error?.code === 'string' ? error.code.slice(0, 100) : 'unknown'
  const message = typeof error?.message === 'string' && error.message.trim()
    ? error.message.trim().slice(0, 500)
    : 'Không thể tự động tính buổi.'
  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(reference)
    const existing = snapshot.exists ? snapshot.data() : {}
    const patch = {
      schemaVersion: 1,
      status: 'open',
      issueSource: AUTOMATIC_CHARGE_ISSUE_SOURCE,
      issueCode,
      errorCode,
      message,
      sessionId: item.id,
      studentId: session.studentId || '',
      trainerId: session.trainerId || '',
      contractId: session.contractId || '',
      scheduledAt: Timestamp.fromDate(sessionStartInstant(session, item.id)),
      attempts: Math.max(0, Number(existing.attempts || 0)) + 1,
      lastFailedAt: Timestamp.fromDate(now),
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: 'system:auto-charge',
    }
    if (snapshot.exists) transaction.update(reference, patch)
    else transaction.create(reference, {
      ...patch,
      firstFailedAt: Timestamp.fromDate(now),
      createdAt: FieldValue.serverTimestamp(),
      createdBy: 'system:auto-charge',
    })
  })
  return issueCode
}

// `all` was written by the legacy all-branch scheduler. It is a scope
// selector, not a physical branch, so it must not make a correction look like
// a cross-branch ca. We keep the original value in the audit trail and only
// canonicalise it while validating the target.
function normaliseSessionBranchId(value) {
  const result = typeof value === 'string' ? value.trim() : ''
  return result.toLowerCase() === 'all' ? '' : result
}

function teachingCorrectionItems(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > TEACHING_SHIFT_CORRECTION_LIMIT) {
    throw new HttpsError('invalid-argument', `Mỗi lần chỉ điều chỉnh từ 1 đến ${TEACHING_SHIFT_CORRECTION_LIMIT} buổi trong cùng ca.`)
  }
  const seen = new Set()
  return value.map((item) => {
    const sessionId = id(item?.sessionId, 'Mã buổi tập')
    if (seen.has(sessionId)) throw new HttpsError('invalid-argument', 'Danh sách điều chỉnh có buổi tập bị trùng.')
    seen.add(sessionId)
    const attendanceEventId = item?.attendanceEventId ? id(item.attendanceEventId, 'Mã điểm danh') : ''
    const attendanceStatus = item?.attendanceStatus ? normalizedAttendanceStatus(item.attendanceStatus) : ''
    return {
      sessionId,
      expectedRevision: sessionRevision(item?.expectedRevision),
      attendanceEventId,
      attendanceStatus,
      lateMinutes: attendanceStatus ? normalizedLateMinutes(attendanceStatus, item?.lateMinutes) : null,
      noShowReason: attendanceStatus ? normalizedNoShowReason(attendanceStatus, item?.noShowReason) : '',
    }
  })
}

function teachingOccupancyStatus(status) {
  return ['scheduled', 'rescheduled', 'completed', 'attended', 'no_show'].includes(status)
}

function isSessionCharged(session) {
  if (session?.billingStatus) return session.billingStatus === 'charged'
  return Boolean(session?.attendanceEventId && ['completed', 'attended', 'no_show'].includes(session?.status))
}

function serviceOrdinalForEvidence({ sessionId, session = {}, attendance = {}, billing = {}, contract = {} }) {
  for (const value of [billing.serviceOrdinal, attendance.serviceOrdinal, session.serviceOrdinal]) {
    const ordinal = Math.floor(Number(value || 0))
    if (ordinal > 0) return ordinal
  }
  const chargedSessionIds = Array.isArray(contract.chargedSessionIds) ? contract.chargedSessionIds : []
  const legacyIndex = chargedSessionIds.indexOf(sessionId)
  if (legacyIndex >= 0) return legacyIndex + 1
  return Math.max(1, Math.floor(Number(contract.usedSessions || 1)))
}

function ptRevenueJournalWrite({ recognition, contract, sessionId, actorUid }) {
  const advanceAccountCode = ['131', '3387'].includes(contract?.accountingAdvanceAccountCode)
    ? contract.accountingAdvanceAccountCode
    : '131'
  const journal = serviceRevenueJournal({
    amount: recognition.amount,
    paidAllocation: Math.max(0, -Number(recognition.deferredRevenueImpact || 0)),
    advanceAccountCode,
  })
  return {
    schemaVersion: 1,
    documentType: 'pt_revenue_recognition',
    documentId: `pt_session_${sessionId}`,
    referenceCode: `DT-PT-${String(sessionId).slice(0, 20).toUpperCase()}`,
    branchId: recognition.branchId || '',
    effectiveAt: recognition.effectiveAt,
    lines: journal.lines,
    totalDebit: journal.totalDebit,
    totalCredit: journal.totalCredit,
    status: 'posted',
    createdAt: FieldValue.serverTimestamp(),
    createdBy: actorUid,
  }
}

function assertSessionCanBeCharged(session) {
  if (!isActiveSessionStatus(session.status)) throw new HttpsError('failed-precondition', 'Chỉ buổi đang lên lịch mới được tự động tính buổi.')
  if (session.scheduleStatus === 'cancelled' || session.billingStatus === 'exempt') {
    throw new HttpsError('failed-precondition', 'Buổi đã hủy hợp lệ không bị tính vào hợp đồng.')
  }
}

async function chargeSessionTransaction({
  db,
  sessionId,
  expectedRevision = null,
  actorUid = 'system:auto-charge',
  assertSessionScope = () => {},
  now = new Date(),
  timeZone = 'Asia/Ho_Chi_Minh',
}) {
  const sessionReference = db.doc(`sessions/${sessionId}`)
  return db.runTransaction(async (transaction) => {
    const sessionSnapshot = await transaction.get(sessionReference)
    if (!sessionSnapshot.exists) throw new HttpsError('not-found', 'Không tìm thấy buổi tập.')
    const session = sessionSnapshot.data()
    await assertSessionScope(session)
    const revision = Number(session.revision || 0)
    const billingReference = db.doc(`sessionBillingEvents/${sessionId}`)
    const attendanceReference = db.doc(`attendanceEvents/${sessionId}`)
    const billingIssueReference = db.doc(`sessionBillingIssues/${sessionId}`)
    const billingSnapshot = await transaction.get(billingReference)

    if (billingSnapshot.exists || isSessionCharged(session)) {
      return {
        unchanged: true,
        revision,
        billingEventId: billingSnapshot.exists ? billingReference.id : session.billingEventId || '',
        attendanceEventId: session.attendanceEventId || attendanceReference.id,
      }
    }
    if (expectedRevision !== null && revision !== expectedRevision) {
      throw new HttpsError('aborted', 'Buổi tập đã thay đổi. Hãy tải lại.')
    }
    assertSessionCanBeCharged(session)
    const contractId = linkedContractId(session)
    const contractReference = db.doc(`contracts/${contractId}`)
    const [contractSnapshot, attendanceSnapshot, billingIssueSnapshot] = await Promise.all([
      transaction.get(contractReference),
      transaction.get(attendanceReference),
      transaction.get(billingIssueReference),
    ])
    if (!contractSnapshot.exists) throw new HttpsError('failed-precondition', 'Hợp đồng liên kết không tồn tại.', { issueCode: 'SESSION_CONTRACT_NOT_FOUND' })
    const contract = contractSnapshot.data()
    if (contract.studentId !== session.studentId) throw new HttpsError('failed-precondition', 'Hợp đồng không thuộc học viên của buổi tập.', { issueCode: 'SESSION_CONTRACT_STUDENT_MISMATCH' })
    if (!['active', 'expired'].includes(contract.status)) throw new HttpsError('failed-precondition', 'Hợp đồng liên kết không ở trạng thái có thể đối soát.', { issueCode: 'SESSION_CONTRACT_STATUS_INVALID' })
    const sessionDate = storedDateKey(session.date, 'Ngày của buổi tập')
    const contractStart = storedContractDate(contract.startDate, 'Ngày bắt đầu')
    const contractEnd = storedContractDate(contract.endDate, 'Ngày kết thúc')
    if (sessionDate < contractStart || sessionDate > contractEnd) {
      throw new HttpsError('failed-precondition', 'Ngày tập nằm ngoài thời hạn hợp đồng liên kết.', { issueCode: 'SESSION_OUTSIDE_CONTRACT_WINDOW' })
    }
    const startsAt = sessionStartInstant(session, sessionId)
    if (startsAt.getTime() > now.getTime()) {
      throw new HttpsError('failed-precondition', 'Chưa đến giờ tập nên buổi chưa được tính.', {
        issueCode: 'SESSION_NOT_STARTED',
        startsAt: startsAt.toISOString(),
      })
    }

    const chargedSessionIds = Array.isArray(contract.chargedSessionIds) ? contract.chargedSessionIds : []
    const attendedClasses = Array.isArray(contract.attendedClasses) ? contract.attendedClasses : []
    if (chargedSessionIds.includes(sessionId) || attendedClasses.includes(sessionId)) {
      throw new HttpsError('already-exists', 'Buổi tập đã được tính trong hợp đồng nhưng thiếu sổ sự kiện. Cần đối soát trước khi thử lại.', { issueCode: 'SESSION_BILLING_LEDGER_MISMATCH' })
    }
    const startsAtTimestamp = Timestamp.fromDate(startsAt)
    if (Number(contract.usedSessions || 0) >= Number(contract.totalSessions || 0)) {
      if (attendanceSnapshot.exists && session.billingStatus === BILLING_REVIEW_STATUS && attendanceSnapshot.data()?.billingStatus === BILLING_REVIEW_STATUS) {
        return {
          unchanged: true,
          revision,
          billingStatus: BILLING_REVIEW_STATUS,
          billingReviewRequired: true,
          attendanceEventId: attendanceReference.id,
        }
      }
      if (attendanceSnapshot.exists) {
        throw new HttpsError('already-exists', 'Bản ghi hiện diện đã tồn tại nhưng chưa có sổ tính buổi. Cần đối soát trước khi thử lại.', { issueCode: 'SESSION_ATTENDANCE_LEDGER_MISMATCH' })
      }
      transaction.create(attendanceReference, {
        schemaVersion: 3,
        type: 'pending_confirmation',
        sessionId,
        studentId: session.studentId,
        trainerId: session.trainerId || '',
        contractId,
        scheduleStatus: session.scheduleStatus || session.status,
        billingStatus: BILLING_REVIEW_STATUS,
        billingIssueCode: 'CONTRACT_QUOTA_EXHAUSTED',
        attendanceStatus: 'pending',
        scheduledAt: startsAtTimestamp,
        occurredAt: startsAtTimestamp,
        chargedAt: null,
        confirmedAt: null,
        confirmedBy: '',
        lateMinutes: null,
        noShowReason: '',
        note: '',
        createdAt: FieldValue.serverTimestamp(),
        createdBy: actorUid,
        timeZone,
      })
      transaction.update(sessionReference, {
        scheduleStatus: session.scheduleStatus || session.status,
        billingStatus: BILLING_REVIEW_STATUS,
        billingIssueCode: 'CONTRACT_QUOTA_EXHAUSTED',
        attendanceStatus: 'pending',
        attendanceEventId: attendanceReference.id,
        revision: revision + 1,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: actorUid,
      })
      const quotaIssue = {
        schemaVersion: 1,
        status: 'open',
        issueSource: AUTOMATIC_CHARGE_ISSUE_SOURCE,
        issueCode: 'CONTRACT_QUOTA_EXHAUSTED',
        sessionId,
        studentId: session.studentId,
        trainerId: session.trainerId || '',
        contractId,
        scheduledAt: startsAtTimestamp,
        usedSessions: Number(contract.usedSessions || 0),
        totalSessions: Number(contract.totalSessions || 0),
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: actorUid,
      }
      if (!billingIssueSnapshot.exists) transaction.create(billingIssueReference, {
        ...quotaIssue,
        createdAt: FieldValue.serverTimestamp(),
        createdBy: actorUid,
      })
      else transaction.update(billingIssueReference, quotaIssue)
      return {
        unchanged: false,
        revision: revision + 1,
        billingStatus: BILLING_REVIEW_STATUS,
        billingReviewRequired: true,
        attendanceEventId: attendanceReference.id,
        billingIssueId: billingIssueReference.id,
      }
    }
    if (attendanceSnapshot.exists) {
      throw new HttpsError('already-exists', 'Bản ghi hiện diện đã tồn tại nhưng chưa có sổ tính buổi. Cần đối soát trước khi thử lại.', { issueCode: 'SESSION_ATTENDANCE_LEDGER_MISMATCH' })
    }

    const serviceOrdinal = Math.max(1, Math.floor(Number(contract.usedSessions || 0)) + 1)
    transaction.create(billingReference, {
      schemaVersion: 2,
      type: 'session_charge',
      sessionId,
      studentId: session.studentId,
      trainerId: session.trainerId || '',
      contractId,
      scheduleStatus: session.scheduleStatus || session.status,
      billingStatus: 'charged',
      serviceOrdinal,
      scheduledAt: startsAtTimestamp,
      chargedAt: FieldValue.serverTimestamp(),
      createdAt: FieldValue.serverTimestamp(),
      createdBy: actorUid,
      timeZone,
    })
    transaction.create(attendanceReference, {
      schemaVersion: 3,
      type: 'pending_confirmation',
      sessionId,
      studentId: session.studentId,
      trainerId: session.trainerId || '',
      contractId,
      scheduleStatus: session.scheduleStatus || session.status,
      billingStatus: 'charged',
      attendanceStatus: 'pending',
      serviceOrdinal,
      scheduledAt: startsAtTimestamp,
      occurredAt: startsAtTimestamp,
      chargedAt: FieldValue.serverTimestamp(),
      confirmedAt: null,
      confirmedBy: '',
      lateMinutes: null,
      noShowReason: '',
      note: '',
      createdAt: FieldValue.serverTimestamp(),
      createdBy: actorUid,
      timeZone,
    })
    transaction.update(sessionReference, {
      scheduleStatus: session.scheduleStatus || session.status,
      billingStatus: 'charged',
      attendanceStatus: 'pending',
      billingEventId: billingReference.id,
      attendanceEventId: attendanceReference.id,
      serviceOrdinal,
      chargedAt: FieldValue.serverTimestamp(),
      revision: revision + 1,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: actorUid,
    })
    transaction.update(contractReference, {
      usedSessions: FieldValue.increment(1),
      // Keep the legacy projection until all old reports have migrated.
      attendedClasses: FieldValue.arrayUnion(sessionId),
      chargedSessionIds: FieldValue.arrayUnion(sessionId),
      updatedAt: FieldValue.serverTimestamp(),
    })
    if (billingIssueSnapshot.exists && billingIssueSnapshot.data()?.issueSource === AUTOMATIC_CHARGE_ISSUE_SOURCE) {
      transaction.update(billingIssueReference, {
        status: 'resolved',
        resolvedAt: FieldValue.serverTimestamp(),
        resolvedBy: actorUid,
        resolution: 'session_charged_after_contract_reconciliation',
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: actorUid,
      })
    }
    return {
      unchanged: false,
      revision: revision + 1,
      billingStatus: 'charged',
      billingEventId: billingReference.id,
      attendanceEventId: attendanceReference.id,
      serviceOrdinal,
      recognitionEntryId: null,
    }
  })
}

async function recordSessionAttendanceTransaction({
  db,
  sessionId,
  expectedRevision,
  actorUid,
  attendanceStatus,
  lateMinutes = null,
  noShowReason = '',
  note = '',
  assertSessionScope = () => {},
  now = new Date(),
  timeZone = 'Asia/Ho_Chi_Minh',
  confirmationSource = 'manual',
}) {
  const normalizedStatus = normalizedAttendanceStatus(attendanceStatus)
  const normalizedLate = normalizedLateMinutes(normalizedStatus, lateMinutes)
  const normalizedReason = normalizedNoShowReason(normalizedStatus, noShowReason)
  const normalizedNote = normalizedAttendanceNote(note)
  const sessionReference = db.doc(`sessions/${sessionId}`)
  const attendanceReference = db.doc(`attendanceEvents/${sessionId}`)
  return db.runTransaction(async (transaction) => {
    const [sessionSnapshot, attendanceSnapshot] = await Promise.all([
      transaction.get(sessionReference),
      transaction.get(attendanceReference),
    ])
    if (!sessionSnapshot.exists || !attendanceSnapshot.exists) {
      throw new HttpsError('failed-precondition', 'Buổi chưa được hệ thống tự động tính nên chưa thể xác nhận hiện diện.')
    }
    const session = sessionSnapshot.data()
    const attendance = attendanceSnapshot.data()
    await assertSessionScope(session)
    const revision = Number(session.revision || 0)
    const effectiveBillingStatus = isSessionCharged(session) && (!attendance.billingStatus || attendance.billingStatus === 'charged')
      ? 'charged'
      : session.billingStatus === BILLING_REVIEW_STATUS && attendance.billingStatus === BILLING_REVIEW_STATUS
        ? BILLING_REVIEW_STATUS
        : ''
    if (!effectiveBillingStatus) {
      throw new HttpsError('failed-precondition', 'Sổ tính buổi chưa hoàn tất. Hãy tải lại sau ít phút.')
    }

    const contractId = linkedContractId(session)
    const contractReference = db.doc(`contracts/${contractId}`)
    const billingReference = db.doc(`sessionBillingEvents/${sessionId}`)
    const recognitionReference = db.doc(`ledgerEntries/pt_session_${sessionId}`)
    const recognitionJournalReference = db.doc(`journalEntries/pt_session_${sessionId}`)
    const recognitionReviewReference = db.doc(`revenueRecognitionReviews/${sessionId}`)
    const periodId = String(session.date || '').slice(0, 7)
    const periodReference = db.doc(`financePeriods/${periodId}`)
    const [contractSnapshot, billingSnapshot, recognitionSnapshot, recognitionJournalSnapshot, recognitionReviewSnapshot, periodSnapshot] = await Promise.all([
      transaction.get(contractReference),
      transaction.get(billingReference),
      transaction.get(recognitionReference),
      transaction.get(recognitionJournalReference),
      transaction.get(recognitionReviewReference),
      transaction.get(periodReference),
    ])
    if (!contractSnapshot.exists) throw new HttpsError('failed-precondition', 'Hợp đồng liên kết không còn tồn tại.')
    const contract = contractSnapshot.data()
    const serviceOrdinal = serviceOrdinalForEvidence({ sessionId, session, attendance, billing: billingSnapshot.data?.() || {}, contract })
    const autoConfirmation = confirmationSource === 'auto_after_48h'
    const periodLocked = periodSnapshot.exists && periodSnapshot.data().status === 'locked'
    const recognitionAllowed = effectiveBillingStatus === 'charged' && !autoConfirmation && !periodLocked
    const recognition = recognitionAllowed && !recognitionSnapshot.exists
      ? ptRevenueRecognitionWrite({
        sessionId,
        session,
        contractId,
        contract,
        attendanceEventId: attendanceReference.id,
        actorUid,
        serviceOrdinal,
        evidenceStatus: normalizedStatus,
        confirmationSource,
      })
      : null
    const recognitionForJournal = recognition || (recognitionSnapshot.exists ? recognitionSnapshot.data() : null)
    const journal = recognitionAllowed && recognitionForJournal && !recognitionJournalSnapshot.exists
      ? ptRevenueJournalWrite({ recognition: recognitionForJournal, contract, sessionId, actorUid })
      : null
    const sameConfirmation = attendance.attendanceStatus === normalizedStatus
      && Number(attendance.lateMinutes || 0) === Number(normalizedLate || 0)
      && String(attendance.noShowReason || '') === normalizedReason
      && String(attendance.note || '') === normalizedNote
      && !(attendance.confirmationSource === 'auto_after_48h' && confirmationSource !== 'auto_after_48h')
    if (sameConfirmation && !recognition && !journal) {
      return { unchanged: true, revision, attendanceEventId: attendanceReference.id, attendanceStatus: normalizedStatus }
    }
    if (sameConfirmation && (recognition || journal)) {
      if (recognition) transaction.create(recognitionReference, { ...recognition, journalEntryId: recognitionJournalReference.id })
      if (journal) transaction.create(recognitionJournalReference, journal)
      transaction.update(attendanceReference, { revenueRecognitionEntryId: recognitionReference.id, revenueRecognitionJournalId: recognitionJournalReference.id, recognitionReviewRequired: false, updatedAt: FieldValue.serverTimestamp(), updatedBy: actorUid })
      transaction.update(sessionReference, { revenueRecognitionEntryId: recognitionReference.id, recognitionReviewRequired: false, updatedAt: FieldValue.serverTimestamp(), updatedBy: actorUid })
      if (recognitionReviewSnapshot.exists) transaction.update(recognitionReviewReference, { status: 'resolved', resolvedAt: FieldValue.serverTimestamp(), resolvedBy: actorUid, resolution: 'manual_evidence_confirmed' })
      return { unchanged: false, revision, attendanceEventId: attendanceReference.id, attendanceStatus: normalizedStatus, recognitionEntryId: recognitionReference.id }
    }
    if (revision !== expectedRevision) throw new HttpsError('aborted', 'Buổi tập đã thay đổi. Hãy tải lại.')
    const startsAt = sessionStartInstant(session, sessionId)
    if (now.getTime() < startsAt.getTime()) {
      throw new HttpsError('failed-precondition', 'Không thể xác nhận trước giờ tập.', { issueCode: 'ATTENDANCE_TOO_EARLY' })
    }
    if (normalizedStatus === 'no_show' && now.getTime() < startsAt.getTime() + NO_SHOW_GRACE_MINUTES * 60_000) {
      throw new HttpsError('failed-precondition', `Chỉ có thể xác nhận không đến sau ${NO_SHOW_GRACE_MINUTES} phút.`, {
        issueCode: 'NO_SHOW_GRACE_ACTIVE',
        availableAt: new Date(startsAt.getTime() + NO_SHOW_GRACE_MINUTES * 60_000).toISOString(),
      })
    }
    const beforeStatus = ATTENDANCE_STATUSES.has(attendance.attendanceStatus) ? attendance.attendanceStatus : 'pending'
    const auditReference = db.collection('attendanceAuditLogs').doc()
    const legacyStatus = normalizedStatus === 'no_show' ? 'no_show' : 'completed'
    const autoConfirmationPatch = autoConfirmation
      ? { autoConfirmedAt: FieldValue.serverTimestamp() }
      : {}
    const reviewRequired = effectiveBillingStatus === 'charged' && (autoConfirmation || periodLocked)
    const reviewIssueCode = autoConfirmation ? 'AUTO_CONFIRMATION_REQUIRES_REVIEW' : periodLocked ? 'FINANCE_PERIOD_LOCKED' : ''
    if (reviewRequired) {
      const reviewData = {
        schemaVersion: 1,
        status: 'open',
        issueCode: reviewIssueCode,
        sessionId,
        attendanceEventId: attendanceReference.id,
        contractId,
        studentId: session.studentId || '',
        trainerId: session.trainerId || '',
        serviceOrdinal,
        evidenceStatus: normalizedStatus,
        confirmationSource,
        financePeriodId: periodId,
        legacyRecognitionEntryId: recognitionSnapshot.exists ? recognitionReference.id : null,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: actorUid,
      }
      if (recognitionReviewSnapshot.exists) transaction.update(recognitionReviewReference, reviewData)
      else transaction.create(recognitionReviewReference, { ...reviewData, createdAt: FieldValue.serverTimestamp(), createdBy: actorUid })
    } else if (recognitionReviewSnapshot.exists) {
      transaction.update(recognitionReviewReference, { status: 'resolved', resolvedAt: FieldValue.serverTimestamp(), resolvedBy: actorUid, resolution: 'manual_evidence_confirmed' })
    }
    if (recognition) transaction.create(recognitionReference, { ...recognition, journalEntryId: recognitionJournalReference.id })
    if (journal) transaction.create(recognitionJournalReference, journal)
    transaction.update(attendanceReference, {
      type: normalizedStatus === 'no_show' ? 'no_show' : 'attended',
      attendanceStatus: normalizedStatus,
      lateMinutes: normalizedLate,
      noShowReason: normalizedReason,
      note: normalizedNote,
      confirmedAt: FieldValue.serverTimestamp(),
      confirmedBy: actorUid,
      confirmationSource,
      serviceOrdinal,
      revenueRecognitionEntryId: recognition || recognitionSnapshot.exists ? recognitionReference.id : null,
      revenueRecognitionJournalId: journal || recognitionJournalSnapshot.exists ? recognitionJournalReference.id : null,
      recognitionReviewRequired: reviewRequired,
      recognitionReviewIssueCode: reviewIssueCode || null,
      ...autoConfirmationPatch,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: actorUid,
    })
    transaction.update(sessionReference, {
      status: legacyStatus,
      scheduleStatus: session.scheduleStatus || 'scheduled',
      billingStatus: effectiveBillingStatus,
      attendanceStatus: normalizedStatus,
      confirmedAt: FieldValue.serverTimestamp(),
      confirmedBy: actorUid,
      confirmationSource,
      serviceOrdinal,
      revenueRecognitionEntryId: recognition || recognitionSnapshot.exists ? recognitionReference.id : null,
      recognitionReviewRequired: reviewRequired,
      recognitionReviewIssueCode: reviewIssueCode || null,
      ...autoConfirmationPatch,
      completedAt: normalizedStatus === 'no_show' ? null : FieldValue.serverTimestamp(),
      revision: revision + 1,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: actorUid,
    })
    transaction.create(auditReference, {
      schemaVersion: 1,
      sessionId,
      attendanceEventId: attendanceReference.id,
      studentId: session.studentId || '',
      trainerId: session.trainerId || '',
      contractId: session.contractId || '',
      beforeStatus,
      afterStatus: normalizedStatus,
      lateMinutes: normalizedLate,
      noShowReason: normalizedReason,
      note: normalizedNote,
      confirmationSource,
      changedAt: FieldValue.serverTimestamp(),
      changedBy: actorUid,
      timeZone,
    })
    return {
      unchanged: false,
      revision: revision + 1,
      attendanceEventId: attendanceReference.id,
      attendanceStatus: normalizedStatus,
      auditLogId: auditReference.id,
      recognitionEntryId: recognition || recognitionSnapshot.exists ? recognitionReference.id : null,
      recognitionReviewRequired: reviewRequired,
    }
  })
}

async function completeSessionAttendanceTransaction({
  db,
  sessionId,
  expectedRevision,
  actorUid,
  assertSessionScope = () => {},
  timeZone = 'Asia/Ho_Chi_Minh',
  now = new Date(),
}) {
  const charge = await chargeSessionTransaction({
    db,
    sessionId,
    expectedRevision,
    actorUid,
    assertSessionScope,
    now,
    timeZone,
  })
  const confirmation = await recordSessionAttendanceTransaction({
    db,
    sessionId,
    expectedRevision: charge.revision,
    actorUid,
    attendanceStatus: 'present',
    assertSessionScope,
    now,
    timeZone,
  })
  return {
    ...confirmation,
    charged: charge.billingStatus === 'charged',
    billingStatus: charge.billingStatus || 'charged',
    billingEventId: charge.billingEventId,
    recognitionEntryId: charge.recognitionEntryId || null,
  }
}

async function chargeDuePtSessions({
  db,
  now = new Date(),
  logger = console,
  limit = AUTOMATIC_CHARGE_QUERY_LIMIT,
  includeRecent = true,
  includeCatchUp = true,
  pendingOnly = false,
}) {
  const today = vietnamDateKey(now)
  const weekStart = vietnamWeekStartDateKey(now)
  const scanLimit = Math.min(AUTOMATIC_CHARGE_QUERY_LIMIT, Math.max(1, Number(limit) || AUTOMATIC_CHARGE_QUERY_LIMIT))
  const [currentWeek, catchUp] = await Promise.all([
    includeRecent
      ? readAutomationSessionPage({
        db,
        jobId: 'ptSessionCharge',
        lowerDate: weekStart,
        upperDate: nextDateKey(today),
        filters: pendingOnly ? [{ field: 'billingStatus', value: 'pending' }] : [],
        limit: scanLimit,
      })
      : Promise.resolve(null),
    includeCatchUp
      ? readAutomationSessionPage({ db, jobId: 'ptSessionChargeCatchUp', upperDate: nextDateKey(today), limit: scanLimit })
      : Promise.resolve(null),
  ])
  const pages = [currentWeek, catchUp].filter(Boolean)
  const documents = [...new Map(pages.flatMap((page) => page.docs).map((item) => [item.id, item])).values()]
  const candidates = documents.filter((item) => {
    const session = item.data()
    if (!isActiveSessionStatus(session.status) || isSessionCharged(session) || [BILLING_REVIEW_STATUS, 'exempt'].includes(session.billingStatus)) return false
    try { return sessionStartInstant(session, item.id).getTime() <= now.getTime() } catch { return false }
  })
  const summary = { weekStart, through: today, scanned: documents.length, due: candidates.length, charged: 0, reviewRequired: 0, unchanged: 0, failed: 0, issuesQueued: 0, issueQueueFailed: 0, catchUpCursor: catchUp?.nextCursor || null }
  for (let index = 0; index < candidates.length; index += 25) {
    const batch = candidates.slice(index, index + 25)
    const outcomes = await Promise.allSettled(batch.map((item) => chargeSessionTransaction({
      db,
      sessionId: item.id,
      actorUid: 'system:auto-charge',
      now,
    })))
    const failures = []
    outcomes.forEach((outcome, outcomeIndex) => {
      if (outcome.status === 'fulfilled') {
        if (outcome.value.unchanged) summary.unchanged += 1
        else if (outcome.value.billingReviewRequired) summary.reviewRequired += 1
        else summary.charged += 1
      } else {
        summary.failed += 1
        failures.push({ item: batch[outcomeIndex], error: outcome.reason })
        logger.warn?.('PT session automatic charge failed', {
          sessionId: batch[outcomeIndex].id,
          code: outcome.reason?.code || 'unknown',
          issueCode: automaticChargeIssueCode(outcome.reason),
          message: typeof outcome.reason?.message === 'string' ? outcome.reason.message.slice(0, 500) : 'Unknown automatic charge failure',
        })
      }
    })
    const issueOutcomes = await Promise.allSettled(failures.map(({ item, error }) => recordAutomaticChargeFailureIssue({ db, item, error, now })))
    issueOutcomes.forEach((outcome) => {
      if (outcome.status === 'fulfilled') summary.issuesQueued += 1
      else summary.issueQueueFailed += 1
    })
  }
  // A permanently invalid legacy record must not pin every valid session
  // behind it. Failures are persisted in sessionBillingIssues and the daily
  // catch-up cursor advances independently from the narrow frequent worker.
  await Promise.all(pages.map(commitAutomationSessionPage))
  logger.info?.('PT automatic charge completed', summary)
  return summary
}

async function autoConfirmOverduePtAttendance({
  db,
  now = new Date(),
  logger = console,
  limit = AUTOMATIC_CHARGE_QUERY_LIMIT,
  includeRecent = true,
  includeCatchUp = true,
  pendingOnly = false,
}) {
  const today = vietnamDateKey(now)
  const from = addDateDays(today, -AUTO_ATTENDANCE_LOOKBACK_DAYS)
  const scanLimit = Math.min(AUTOMATIC_CHARGE_QUERY_LIMIT, Math.max(1, Number(limit) || AUTOMATIC_CHARGE_QUERY_LIMIT))
  const [recent, catchUp] = await Promise.all([
    includeRecent
      ? readAutomationSessionPage({
        db,
        jobId: 'ptAttendanceConfirmation',
        lowerDate: from,
        upperDate: nextDateKey(today),
        filters: pendingOnly ? [{ field: 'attendanceStatus', value: 'pending' }] : [],
        limit: scanLimit,
      })
      : Promise.resolve(null),
    includeCatchUp
      ? readAutomationSessionPage({ db, jobId: 'ptAttendanceConfirmationCatchUp', upperDate: nextDateKey(today), limit: scanLimit })
      : Promise.resolve(null),
  ])
  const pages = [recent, catchUp].filter(Boolean)
  const documents = [...new Map(pages.flatMap((page) => page.docs).map((item) => [item.id, item])).values()]
  const candidates = documents.filter((item) => {
    const session = item.data()
    if (!isActiveSessionStatus(session.status) || (!isSessionCharged(session) && session.billingStatus !== BILLING_REVIEW_STATUS) || session.billingStatus === 'exempt') return false
    if (session.attendanceStatus && session.attendanceStatus !== 'pending') return false
    try {
      const deadline = sessionStartInstant(session, item.id).getTime() + AUTO_ATTENDANCE_CONFIRM_HOURS * 60 * 60_000
      return deadline <= now.getTime()
    } catch {
      return false
    }
  })
  const summary = {
    from,
    through: today,
    confirmationAfterHours: AUTO_ATTENDANCE_CONFIRM_HOURS,
    scanned: documents.length,
    overdue: candidates.length,
    confirmedPresent: 0,
    unchanged: 0,
    failed: 0,
    catchUpCursor: catchUp?.nextCursor || null,
  }
  for (let index = 0; index < candidates.length; index += 25) {
    const batch = candidates.slice(index, index + 25)
    const outcomes = await Promise.allSettled(batch.map((item) => recordSessionAttendanceTransaction({
      db,
      sessionId: item.id,
      expectedRevision: Number(item.data().revision || 0),
      actorUid: 'system:auto-after-48h',
      attendanceStatus: 'present',
      note: 'Tự động xác nhận có tập sau 48 giờ chưa có phản hồi từ PT.',
      confirmationSource: 'auto_after_48h',
      now,
    })))
    outcomes.forEach((outcome, outcomeIndex) => {
      if (outcome.status === 'fulfilled') {
        if (outcome.value.unchanged) summary.unchanged += 1
        else summary.confirmedPresent += 1
      } else {
        summary.failed += 1
        logger.warn?.('PT attendance automatic confirmation failed', {
          sessionId: batch[outcomeIndex].id,
          code: outcome.reason?.code || 'unknown',
          issueCode: typeof outcome.reason?.details?.issueCode === 'string' ? outcome.reason.details.issueCode : 'AUTOMATIC_ATTENDANCE_CONFIRMATION_FAILED',
          message: typeof outcome.reason?.message === 'string' ? outcome.reason.message.slice(0, 500) : 'Unknown automatic attendance confirmation failure',
        })
      }
    })
  }
  await Promise.all(pages.map(commitAutomationSessionPage))
  logger.info?.('PT attendance automatic confirmation completed', summary)
  return summary
}

async function remindUnconfirmedPtAttendance({ db, now = new Date(), logger = console }) {
  const today = vietnamDateKey(now)
  const from = addDateDays(today, -2)
  const snapshot = await db.collection('sessions')
    .where('date', '>=', from)
    .where('date', '<', nextDateKey(today))
    .limit(2000)
    .get()
  const pendingByTrainer = new Map()
  snapshot.docs.forEach((item) => {
    const session = item.data()
    const pending = ['charged', BILLING_REVIEW_STATUS].includes(session.billingStatus)
      && (!session.attendanceStatus || session.attendanceStatus === 'pending')
      && isActiveSessionStatus(session.status)
    const trainerId = typeof session.trainerId === 'string' ? session.trainerId.trim() : ''
    if (!pending || !trainerId || !/^[A-Za-z0-9_-]+$/.test(trainerId)) return
    pendingByTrainer.set(trainerId, Number(pendingByTrainer.get(trainerId) || 0) + 1)
  })
  if (!pendingByTrainer.size) return { date: today, trainerCount: 0, pendingSessionCount: 0 }
  const batch = db.batch()
  let pendingSessionCount = 0
  for (const [trainerId, count] of pendingByTrainer) {
    pendingSessionCount += count
    const notificationReference = db.doc(`users/${trainerId}/notifications/pt-attendance-${today}`)
    batch.set(notificationReference, {
      schemaVersion: 1,
      userId: trainerId,
      type: 'pt_attendance_confirmation',
      title: 'Ca dạy đang chờ xác nhận',
      body: `Bạn còn ${count} buổi cần xác nhận Có tập hoặc Không đến trước mốc tự động 48 giờ.`,
      route: 'staff-schedule',
      read: false,
      date: today,
      pendingSessionCount: count,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true })
  }
  await batch.commit()
  const summary = { date: today, trainerCount: pendingByTrainer.size, pendingSessionCount }
  logger.info?.('PT unconfirmed attendance reminders created', summary)
  return summary
}

async function adminActor(request, db) {
  const actor = await trustedAccessContext(request, db)
  requireCapability(actor, 'pt.operations.manage')
  return actor
}

function createSessionOperationFunctions({ db, onCall, authorizeAdmin = adminActor, authorizeStudent = studentActor, now = () => new Date(), logger = console }) {
  const listPtOperationsRequests = onCall(async (request) => {
    await authorizeAdmin(request, db)
    const kind = request.data?.kind === 'pause' ? 'pause' : request.data?.kind === 'session' ? 'session' : ''
    if (!kind) throw new HttpsError('invalid-argument', 'Nhóm yêu cầu không hợp lệ.')

    const collectionName = kind === 'pause' ? 'leaveRequests' : 'sessionRequests'
    const snapshot = await db.collection(collectionName).limit(OPERATIONS_REQUEST_HISTORY_LIMIT + 1).get()
    const truncated = snapshot.size > OPERATIONS_REQUEST_HISTORY_LIMIT
    const documents = snapshot.docs.slice(0, OPERATIONS_REQUEST_HISTORY_LIMIT).map((item) => ({ id: item.id, ...item.data() }))
    const studentIds = documents.map((item) => item.studentId)
    const contractIds = documents.map((item) => item.contractId)
    const sessionIds = kind === 'session' ? documents.map((item) => item.sessionId) : []
    const [students, contracts, sessions] = await Promise.all([
      documentsById(db, 'students', studentIds),
      documentsById(db, 'contracts', contractIds),
      documentsById(db, 'sessions', sessionIds),
    ])
    const trainerIds = documents.flatMap((item) => {
      const session = sessions.get(item.sessionId) || {}
      return [item.trainerId, item.newTrainerId, session.trainerId]
    })
    const trainers = await documentsById(db, 'trainers', trainerIds)

    const records = documents.map((item) => {
      const student = students.get(item.studentId) || {}
      const contract = contracts.get(item.contractId) || {}
      const session = sessions.get(item.sessionId) || {}
      const trainerId = optionalText(item.trainerId || session.trainerId, 128)
      const trainer = trainers.get(trainerId) || {}
      const newTrainerId = optionalText(item.newTrainerId, 128)
      const newTrainer = trainers.get(newTrainerId) || {}
      const createdAt = storedInstantIso(item.createdAt || item.submittedAtIso)
      const processedAt = storedInstantIso(item.approvedAt || item.rejectedAt || item.processedAt)
      const common = {
        id: item.id,
        kind,
        status: requestStatus(item.status),
        studentId: optionalText(item.studentId, 128),
        studentName: optionalText(student.name, 160) || 'Học viên chưa cập nhật tên',
        studentPhone: optionalText(student.phone, 40),
        contractId: optionalText(item.contractId, 128),
        packageName: optionalText(contract.packageName, 160) || 'Hợp đồng chưa cập nhật gói',
        reason: optionalText(item.reason),
        adminNote: optionalText(item.adminNote),
        createdAt,
        processedAt,
      }
      if (kind === 'pause') {
        let durationDays = Number(item.durationDays || 0)
        if (!Number.isFinite(durationDays) || durationDays < 1) {
          try { durationDays = inclusiveDateDays(item.startDate, item.endDate) } catch { durationDays = 0 }
        }
        const type = item.type === 'preservation' || (!item.type && durationDays > 14) ? 'preservation' : 'off'
        return {
          ...common,
          type,
          startDate: optionalText(item.startDate, 10),
          endDate: optionalText(item.endDate, 10),
          durationDays,
          offSequence: Number(item.offSequence || 0) || null,
          offLimit: Number(item.offLimit || 0) || null,
          newContractEndDate: optionalText(item.newContractEndDate, 10) || null,
          cancelledSessionCount: Number(item.cancelledSessionCount || 0),
        }
      }
      return {
        ...common,
        type: item.type === 'cancel' ? 'cancel' : item.type === 'additional' ? 'additional' : 'reschedule',
        sessionId: optionalText(item.sessionId, 128),
        sessionRevision: Number(session.revision || 0),
        trainerId,
        trainerName: optionalText(trainer.name, 160) || 'PT chưa xác định',
        requestedBy: item.requestedBy === 'trainer' ? 'trainer' : 'student',
        originalDate: optionalText(item.originalDate, 10) || null,
        originalHour: Number.isInteger(item.originalHour) ? item.originalHour : Number.isInteger(session.hour) ? session.hour : null,
        newDate: optionalText(item.newDate, 10) || null,
        newHour: Number.isInteger(item.newHour) ? item.newHour : null,
        newTrainerId: newTrainerId || null,
        newTrainerName: newTrainerId ? optionalText(newTrainer.name, 160) || 'PT chưa xác định' : null,
        newBranchId: optionalText(item.newBranchId, 128) || null,
        newBranchName: optionalText(item.newBranchName, 160) || null,
        crossBranchWarning: item.crossBranchWarning === true,
        suggestionRank: Number(item.suggestionRank || 0) || null,
        priorityTier: Number.isInteger(item.priorityTier) && item.priorityTier >= 1 && item.priorityTier <= 3 ? item.priorityTier : null,
        isPrimaryTrainer: item.isPrimaryTrainer === true,
        requiresManagerApproval: item.requiresManagerApproval === true,
        weeklyScheduled: Number(item.weeklyScheduled || 0),
        weeklyTarget: Number(item.weeklyTarget || 0),
        pairsExistingSession: item.pairsExistingSession === true,
        policyMonth: optionalText(item.policyMonth, 7) || null,
        policySequence: Number(item.policySequence || item.expectedPolicySequence || 0) || null,
        complimentaryLimit: Number(item.complimentaryLimit || 1),
        countsTowardContract: item.countsTowardContract === true || item.expectedCountsTowardContract === true,
      }
    }).sort((left, right) => String(right.createdAt || '').localeCompare(String(left.createdAt || '')) || right.id.localeCompare(left.id))

    const summary = records.reduce((result, item) => {
      result.total += 1
      result[item.status] += 1
      return result
    }, { total: 0, pending: 0, approved: 0, rejected: 0 })
    return { schemaVersion: 1, kind, summary, records, truncated }
  })

  const getMySessionChangeSuggestions = onCall(async (request) => {
    const actor = await authorizeStudent(request, db)
    const studentId = linkedStudentId(actor)
    const sessionId = id(request.data?.sessionId, 'Mã buổi tập')
    const expectedRevision = sessionRevision(request.data?.expectedRevision)
    const currentTime = now()
    const result = await buildSessionChangeSuggestions({ db, sessionId, expectedRevision, studentId, now: currentTime })
    const monthKey = vietnamMonthKey(currentTime)
    const [usageSnapshot] = await db.getAll(policyUsageReference(db, studentId, monthKey))
    const approvedCount = Number(usageSnapshot?.data()?.approvedChangeCancelCount || 0)
    return {
      schemaVersion: 3,
      sessionId,
      revision: expectedRevision,
      policyMonth: monthKey,
      policy: {
        ...result.policy,
        approvedChangeCancelCount: approvedCount,
        complimentaryRemaining: Math.max(0, result.policy.complimentaryChangeCancelPerMonth - approvedCount),
      },
      homeBranchId: result.homeBranchId || '',
      homeBranchName: result.homeBranchName || 'Chi nhánh Aura',
      suggestions: result.suggestions,
      issueCodes: result.issueCodes,
    }
  })

  const getMyAdditionalSessionSuggestions = onCall(async (request) => {
    const actor = await authorizeStudent(request, db)
    const studentId = linkedStudentId(actor)
    const result = await buildAdditionalSessionSuggestions({ db, studentId, now: now() })
    return {
      schemaVersion: 2,
      contractId: result.contractId || null,
      contractName: result.contractName || null,
      weeklyTarget: result.weeklyTarget || 0,
      weeklyMaximum: result.weeklyMaximum || 7,
      homeBranchId: result.homeBranchId || '',
      homeBranchName: result.homeBranchName || 'Chi nhánh Aura',
      policy: result.policy,
      suggestions: result.suggestions,
      issueCodes: result.issueCodes,
    }
  })

  const createMyAdditionalSessionRequest = onCall(async (request) => {
    const actor = await authorizeStudent(request, db)
    const studentId = linkedStudentId(actor)
    const reason = boundedReason(request.data?.reason, 'Lý do đăng ký thêm buổi')
    const idempotencyKey = id(request.data?.idempotencyKey, 'Khóa chống gửi trùng')
    const requestReference = db.doc(`sessionRequests/student-${actor.uid}-${idempotencyKey}`)
    const [existingBeforeSuggestion] = await db.getAll(requestReference)
    if (existingBeforeSuggestion?.exists) {
      const existing = existingBeforeSuggestion.data()
      return { unchanged: true, requestId: existingBeforeSuggestion.id, status: existing.status, type: 'additional' }
    }
    const submittedAt = now()
    const suggestionResult = await buildAdditionalSessionSuggestions({ db, studentId, now: submittedAt })
    const requestedCandidateId = optionalText(request.data?.candidateId, 64)
    const selectedSuggestion = suggestionResult.suggestions.find((candidate) => (
      (requestedCandidateId && candidate.candidateId === requestedCandidateId)
      || (!requestedCandidateId
        && candidate.date === request.data?.newDate
        && candidate.hour === request.data?.newHour
        && (!request.data?.newTrainerId || candidate.trainerId === request.data.newTrainerId))
    )) || null
    if (!selectedSuggestion) {
      throw new HttpsError('failed-precondition', 'Ca đăng ký thêm không còn phù hợp. Hãy tải lại danh sách ca trống.', { issueCode: 'ADDITIONAL_SESSION_SUGGESTION_STALE' })
    }
    const targetBranchId = id(selectedSuggestion.branchId || suggestionResult.homeBranchId, 'Mã chi nhánh ca đăng ký')
    const contractReference = db.doc(`contracts/${selectedSuggestion.contractId}`)
    const studentReference = db.doc(`students/${studentId}`)

    return db.runTransaction(async (transaction) => {
      const [existingRequest, contractSnapshot, studentSnapshot, requestsSnapshot, contractSessionsSnapshot] = await Promise.all([
        transaction.get(requestReference),
        transaction.get(contractReference),
        transaction.get(studentReference),
        transaction.get(db.collection('sessionRequests').where('studentId', '==', studentId).limit(100)),
        transaction.get(db.collection('sessions').where('contractId', '==', selectedSuggestion.contractId).limit(SESSION_CHANGE_DATA_LIMIT + 1)),
      ])
      if (existingRequest.exists) {
        const existing = existingRequest.data()
        return { unchanged: true, requestId: existingRequest.id, status: existing.status, type: 'additional' }
      }
      if (!contractSnapshot.exists || !studentSnapshot.exists) throw new HttpsError('failed-precondition', 'Thiếu hợp đồng hoặc hồ sơ học viên để tạo yêu cầu.')
      if (requestsSnapshot.size >= 100) throw new HttpsError('resource-exhausted', 'Học viên có quá nhiều yêu cầu lịch sử để xác minh an toàn.')
      if (requestsSnapshot.docs.some((item) => item.data().type === 'additional' && item.data().status === 'pending')) {
        throw new HttpsError('already-exists', 'Bạn đã có một yêu cầu đăng ký thêm buổi đang chờ xử lý.')
      }
      const contract = contractSnapshot.data()
      const student = studentSnapshot.data()
      if (contract.studentId !== studentId || contract.status !== 'active') throw new HttpsError('failed-precondition', 'Hợp đồng không còn hoạt động cho học viên này.')
      const contractStart = storedContractDate(contract.startDate, 'Ngày bắt đầu')
      const contractEnd = storedContractDate(contract.endDate, 'Ngày kết thúc')
      if (selectedSuggestion.date < contractStart || selectedSuggestion.date > contractEnd) throw new HttpsError('failed-precondition', 'Ca đăng ký nằm ngoài thời hạn hợp đồng.')
      if (pauseCoversDate(contract, selectedSuggestion.date)) throw new HttpsError('failed-precondition', 'Ngày đăng ký nằm trong thời gian OFF hoặc bảo lưu.')
      const contractSessionRows = contractSessionsSnapshot.docs.map((item) => ({ id: item.id, ...item.data() }))
      const contractSessions = activeSessionRows(contractSessionsSnapshot)
      const contractUsage = summarizeContractUsage(contract, contractSessionRows)
      if (contractSessionsSnapshot.size > SESSION_CHANGE_DATA_LIMIT || contractSessions.filter((item) => item.contractId === selectedSuggestion.contractId).length >= contractUsage.remainingSessions) {
        throw new HttpsError('failed-precondition', 'Hợp đồng đã hết số buổi có thể xếp.')
      }
      const targetWeek = mondayForDate(selectedSuggestion.date)
      const [trainerSnapshot, trainerDay, studentDay, availabilitySnapshot, trainerAvailabilitySnapshot, leavesSnapshot, studentSessionsSnapshot, configSnapshot, targetBranchSnapshot, branchDay] = await Promise.all([
        transaction.get(db.doc(`trainers/${selectedSuggestion.trainerId}`)),
        transaction.get(dailySessionsQuery(db, 'trainerId', selectedSuggestion.trainerId, selectedSuggestion.date)),
        transaction.get(dailySessionsQuery(db, 'studentId', studentId, selectedSuggestion.date)),
        transaction.get(db.doc(`ptAvailability/${studentId}_${targetWeek}`)),
        transaction.get(db.doc(`trainerAvailability/${selectedSuggestion.trainerId}_${targetWeek}`)),
        transaction.get(db.collection('leaveRequests').where('status', '==', 'approved').limit(1001)),
        transaction.get(db.collection('sessions').where('studentId', '==', studentId).limit(SESSION_CHANGE_DATA_LIMIT + 1)),
        transaction.get(db.doc('settings/scheduleConfig')),
        transaction.get(db.doc(`branches/${targetBranchId}`)),
        transaction.get(dailySessionsQuery(db, 'branchId', targetBranchId, selectedSuggestion.date)),
      ])
      if (!trainerSnapshot.exists || trainerSnapshot.data().status === 'inactive') throw new HttpsError('failed-precondition', 'PT của ca đăng ký không còn hoạt động.')
      if (leavesSnapshot.size > 1000 || studentSessionsSnapshot.size > SESSION_CHANGE_DATA_LIMIT) throw new HttpsError('resource-exhausted', 'Dữ liệu lịch vượt giới hạn xác minh an toàn.')
      const trainer = trainerProfileForWeek(trainerSnapshot.data(), trainerAvailabilitySnapshot.exists ? trainerAvailabilitySnapshot.data() : null, targetWeek)
      const expectedBranchId = contract.branchId || student.branchId
      if (trainer.branchId && trainer.branchId !== targetBranchId) throw new HttpsError('failed-precondition', 'PT không còn thuộc chi nhánh của ca đã chọn.')
      if (targetBranchSnapshot.exists && ['archived', 'inactive'].includes(String(targetBranchSnapshot.data().status || '').toLowerCase())) throw new HttpsError('failed-precondition', 'Chi nhánh của ca đã chọn không còn hoạt động.')
      if (targetBranchId !== expectedBranchId && !targetBranchSnapshot.exists) throw new HttpsError('failed-precondition', 'Không tìm thấy chi nhánh của ca tập khác cơ sở.')
      const assignedTrainerIds = new Set([contract.trainerId, ...(Array.isArray(contract.trainerIds) ? contract.trainerIds : [])].filter(Boolean))
      if (!assignedTrainerIds.has(selectedSuggestion.trainerId) && trainerPolicy(trainer).employmentType !== 'full_time') throw new HttpsError('failed-precondition', 'Ca ngoài PT phụ trách chỉ được chọn PT chính thức toàn thời gian.')
      const { slotId } = assertOperatingCalendar(configSnapshot.exists ? configSnapshot.data() : {}, selectedSuggestion.date, selectedSuggestion.hour)
      if (!trainerIsAvailable(trainer, slotId)) throw new HttpsError('failed-precondition', 'Ca đăng ký không còn nằm trong lịch rảnh PT tuần này.')
      const studentAvailability = effectiveStudentAvailability({
        targetWeek,
        exact: availabilitySnapshot.exists ? availabilitySnapshot.data() : null,
        inherited: null,
        profile: student,
      })
      if (!studentAvailability.confirmed || !studentAvailability.slots.includes(slotId)) throw new HttpsError('failed-precondition', 'Ca đăng ký không còn nằm trong lịch rảnh hiệu lực của học viên.')
      const trainerUnavailable = leavesSnapshot.docs.some((item) => {
        const leave = item.data()
        const start = typeof leave.startDate === 'string' ? leave.startDate.slice(0, 10) : ''
        const end = typeof leave.endDate === 'string' ? leave.endDate.slice(0, 10) : start
        return leave.trainerId === selectedSuggestion.trainerId && start && end && selectedSuggestion.date >= start && selectedSuggestion.date <= end
      })
      if (trainerUnavailable) throw new HttpsError('failed-precondition', 'PT đang OFF ở ngày đăng ký.')
      const targetCapacity = normalizedTrainerCapacity(trainer.slotCapacity)
      if (activeHourDocuments(trainerDay, selectedSuggestion.hour).length >= targetCapacity) throw new HttpsError('resource-exhausted', 'Khung giờ của PT đã đủ học viên.')
      if (activeDayDocuments(studentDay).length > 0) throw new HttpsError('already-exists', 'Học viên đã có một buổi tập trong ngày này.')
      const siteCapacity = branchSlotCapacity(normalizedScheduleConfig(configSnapshot.exists ? configSnapshot.data() : {}), targetBranchId, slotId)
      if (siteCapacity !== null && activeHourDocuments(branchDay, selectedSuggestion.hour).length >= siteCapacity) throw new HttpsError('resource-exhausted', 'Chi nhánh đã đủ sức chứa trong khung giờ này.')
      const weeklyStart = mondayForDate(selectedSuggestion.date)
      const weeklyScheduled = activeSessionRows(studentSessionsSnapshot).filter((item) => {
        const itemDate = storedDateKey(item.date, 'Ngày lịch học viên')
        return itemDate >= weeklyStart && itemDate <= addDateDays(weeklyStart, 6)
      }).length
      const weeklyMaximum = Math.max(1, Number(student.maxWeeklySessions || 7))
      if (weeklyScheduled >= weeklyMaximum) throw new HttpsError('failed-precondition', 'Bạn đã đạt số buổi tối đa trong tuần.')
      const operationsPolicy = ptOperationsPolicySnapshot(configSnapshot.exists ? configSnapshot.data() : {})
      try {
        assertSessionChangeDeadline(selectedSuggestion.date, selectedSuggestion.hour, submittedAt, operationsPolicy.sessionChangeDeadlineHours)
      } catch (error) {
        throw policyFailure(error)
      }
      const expectedCandidateId = createHash('sha256').update(`additional|${selectedSuggestion.contractId}|${selectedSuggestion.date}|${selectedSuggestion.hour}|${selectedSuggestion.trainerId}|${targetBranchId}`).digest('hex').slice(0, 32)
      if (selectedSuggestion.candidateId !== expectedCandidateId) throw new HttpsError('aborted', 'Ca đăng ký đã thay đổi. Hãy tải lại danh sách ca trống.')
      transaction.create(requestReference, {
        schemaVersion: 2,
        policyVersion: 'additional-session-v2',
        type: 'additional',
        sessionId: null,
        studentId,
        accountUid: actor.uid,
        contractId: selectedSuggestion.contractId,
        trainerId: selectedSuggestion.trainerId,
        newTrainerId: selectedSuggestion.trainerId,
        newBranchId: targetBranchId,
        newBranchName: selectedSuggestion.branchName || (targetBranchSnapshot.exists ? optionalText(targetBranchSnapshot.data().name, 160) : '') || 'Chi nhánh Aura',
        homeBranchId: expectedBranchId || '',
        homeBranchName: selectedSuggestion.homeBranchName || '',
        crossBranchWarning: targetBranchId !== expectedBranchId,
        newDate: selectedSuggestion.date,
        newHour: selectedSuggestion.hour,
        candidateId: expectedCandidateId,
        priorityTier: selectedSuggestion.priorityTier,
        isPrimaryTrainer: selectedSuggestion.isPrimaryTrainer === true,
        pairsExistingSession: selectedSuggestion.pairsExistingSession === true,
        weeklyScheduled,
        weeklyTarget: Number(student.sessionsPerWeek || 0),
        requiresManagerApproval: weeklyScheduled >= Number(student.sessionsPerWeek || 0),
        reason,
        status: 'pending',
        submittedAtIso: submittedAt.toISOString(),
        expectedSessionRevision: 0,
        idempotencyKey,
        revision: 0,
        createdAt: FieldValue.serverTimestamp(),
        createdBy: actor.uid,
      })
      return { unchanged: false, requestId: requestReference.id, status: 'pending', type: 'additional', candidateId: expectedCandidateId, priorityTier: selectedSuggestion.priorityTier, requiresManagerApproval: weeklyScheduled >= Number(student.sessionsPerWeek || 0) }
    })
  })

  const createMySessionRequest = onCall(async (request) => {
    const actor = await authorizeStudent(request, db)
    const studentId = linkedStudentId(actor)
    const sessionId = id(request.data?.sessionId, 'Mã buổi tập')
    const expectedRevision = sessionRevision(request.data?.expectedRevision)
    const requestType = request.data?.type === 'cancel' ? 'cancel' : request.data?.type === 'reschedule' ? 'reschedule' : ''
    if (!requestType) throw new HttpsError('invalid-argument', 'Loại yêu cầu đổi hoặc hủy lịch không hợp lệ.')
    const reason = boundedReason(request.data?.reason)
    const idempotencyKey = id(request.data?.idempotencyKey, 'Khóa chống gửi trùng')
    const requestReference = db.doc(`sessionRequests/student-${actor.uid}-${idempotencyKey}`)
    const sessionReference = db.doc(`sessions/${sessionId}`)
    const submittedAt = now()
    const monthKey = vietnamMonthKey(submittedAt)
    const operationsPolicy = await readOperationsPolicy(db)
    let selectedSuggestion = null
    if (requestType === 'reschedule') {
      const suggestionResult = await buildSessionChangeSuggestions({ db, sessionId, expectedRevision, studentId, now: submittedAt })
      const requestedCandidateId = optionalText(request.data?.candidateId, 64)
      selectedSuggestion = suggestionResult.suggestions.find((candidate) => (
        (requestedCandidateId && candidate.candidateId === requestedCandidateId)
        || (!requestedCandidateId
          && candidate.date === request.data?.newDate
          && candidate.hour === request.data?.newHour
          && (!request.data?.newTrainerId || candidate.trainerId === request.data.newTrainerId))
      )) || null
      if (!selectedSuggestion) {
        throw new HttpsError('failed-precondition', 'Ca đề xuất không còn phù hợp. Hãy tải lại danh sách gợi ý.', { issueCode: 'SESSION_CHANGE_SUGGESTION_STALE' })
      }
    }

    return db.runTransaction(async (transaction) => {
      const [existingRequest, sessionSnapshot, requestsForSession, usageSnapshot, configSnapshot] = await Promise.all([
        transaction.get(requestReference),
        transaction.get(sessionReference),
        transaction.get(db.collection('sessionRequests').where('sessionId', '==', sessionId).limit(20)),
        transaction.get(policyUsageReference(db, studentId, monthKey)),
        transaction.get(db.doc('settings/scheduleConfig')),
      ])
      const transactionPolicy = ptOperationsPolicySnapshot(configSnapshot.exists ? configSnapshot.data() : operationsPolicy)
      if (existingRequest.exists) {
        const existing = existingRequest.data()
        return {
          unchanged: true,
          requestId: existingRequest.id,
          status: existing.status,
          policyMonth: existing.policyMonth,
          expectedSequence: existing.expectedPolicySequence,
          expectedCountsTowardContract: existing.expectedCountsTowardContract === true,
          complimentaryLimit: Number(existing.complimentaryLimit || 1),
        }
      }
      if (!sessionSnapshot.exists) throw new HttpsError('not-found', 'Không tìm thấy buổi tập.')
      const session = sessionSnapshot.data()
      const revision = Number(session.revision || 0)
      if (revision !== expectedRevision) throw new HttpsError('aborted', 'Buổi tập đã thay đổi. Hãy tải lại trước khi gửi yêu cầu.')
      if (!isActiveSessionStatus(session.status)) throw new HttpsError('failed-precondition', 'Chỉ buổi đang lên lịch mới được đổi hoặc hủy.')
      if (isSessionCharged(session)) throw new HttpsError('failed-precondition', 'Buổi đã được hệ thống tính nên không thể tạo yêu cầu đổi/hủy mới.')
      if (session.studentId !== studentId) throw new HttpsError('permission-denied', 'Bạn không thể thay đổi lịch của học viên khác.')
      if (requestsForSession.size >= 20) throw new HttpsError('resource-exhausted', 'Buổi tập có quá nhiều yêu cầu lịch sử để xác minh an toàn.')
      if (requestsForSession.docs.some((item) => item.data().status === 'pending')) {
        throw new HttpsError('already-exists', 'Buổi tập này đã có một yêu cầu đang chờ xử lý.')
      }

      const originalDate = storedDateKey(session.date, 'Ngày của buổi tập')
      const originalHour = storedSessionHour(session.hour, sessionId, 'Giờ của buổi tập')
      let deadlineAt
      try {
        deadlineAt = assertSessionChangeDeadline(originalDate, originalHour, submittedAt, transactionPolicy.sessionChangeDeadlineHours)
      } catch (error) {
        throw policyFailure(error)
      }

      let newDate = null
      let newHour = null
      let newTrainerId = null
      if (requestType === 'reschedule') {
        newDate = date(selectedSuggestion.date)
        newHour = hour(selectedSuggestion.hour)
        newTrainerId = id(selectedSuggestion.trainerId, 'Mã HLV mới')
        try {
          assertSessionChangeDeadline(newDate, newHour, submittedAt, transactionPolicy.sessionChangeDeadlineHours)
        } catch {
          throw new HttpsError('failed-precondition', `Giờ tập mới phải còn ở tương lai ít nhất ${transactionPolicy.sessionChangeDeadlineHours} giờ.`)
        }
      }

      const contractId = linkedContractId(session)
      const approvedCount = Number(usageSnapshot.data()?.approvedChangeCancelCount || 0)
      const expectedDecision = policyUsageDecision(approvedCount, transactionPolicy.complimentaryChangeCancelPerMonth)
      transaction.create(requestReference, {
        schemaVersion: 3,
        policyVersion: 'pt-change-cancel-v2',
        sessionId,
        studentId,
        accountUid: actor.uid,
        contractId,
        trainerId: session.trainerId || '',
        requestedBy: 'student',
        originalDate,
        originalHour,
        originalSessionRevision: revision,
        type: requestType,
        newDate,
        newHour,
        newTrainerId,
        newBranchId: selectedSuggestion?.branchId || null,
        newBranchName: selectedSuggestion?.branchName || null,
        homeBranchId: selectedSuggestion?.homeBranchId || session.branchId || null,
        homeBranchName: selectedSuggestion?.homeBranchName || null,
        crossBranchWarning: selectedSuggestion?.isCrossBranch === true,
        candidateId: selectedSuggestion?.candidateId || null,
        suggestionRank: selectedSuggestion?.rank || null,
        pairsExistingSession: selectedSuggestion?.pairsExistingSession === true,
        reason,
        status: 'pending',
        policyMonth: monthKey,
        deadlineAt: deadlineAt.toISOString(),
        submittedAtIso: submittedAt.toISOString(),
        expectedPolicySequence: expectedDecision.sequence,
        expectedCountsTowardContract: expectedDecision.countsTowardContract,
        complimentaryLimit: expectedDecision.complimentaryLimit,
        policySnapshot: transactionPolicy,
        idempotencyKey,
        revision: 0,
        createdAt: FieldValue.serverTimestamp(),
        createdBy: actor.uid,
      })
      return {
        unchanged: false,
        requestId: requestReference.id,
        status: 'pending',
        policyMonth: monthKey,
        expectedSequence: expectedDecision.sequence,
        expectedCountsTowardContract: expectedDecision.countsTowardContract,
        complimentaryLimit: expectedDecision.complimentaryLimit,
        deadlineAt: deadlineAt.toISOString(),
      }
    })
  })

  const confirmSessionAttendance = onCall(async (request) => {
    const actor = await authorizeAdmin(request, db)
    const sessionId = id(request.data?.sessionId, 'Mã buổi tập')
    const expectedRevision = sessionRevision(request.data?.expectedRevision)
    return completeSessionAttendanceTransaction({
      db,
      sessionId,
      expectedRevision,
      actorUid: actor.uid,
      now: now(),
    })
  })

  const recordSessionAttendance = onCall(async (request) => {
    const actor = await authorizeAdmin(request, db)
    const sessionId = id(request.data?.sessionId, 'Mã buổi tập')
    const expectedRevision = sessionRevision(request.data?.expectedRevision)
    const status = normalizedAttendanceStatus(request.data?.attendanceStatus)
    const charge = await chargeSessionTransaction({
      db,
      sessionId,
      expectedRevision,
      actorUid: actor.uid,
      now: now(),
    })
    return recordSessionAttendanceTransaction({
      db,
      sessionId,
      expectedRevision: charge.revision,
      actorUid: actor.uid,
      attendanceStatus: status,
      lateMinutes: request.data?.lateMinutes,
      noShowReason: request.data?.noShowReason,
      note: request.data?.note,
      now: now(),
    })
  })

  const correctTeachingShift = onCall({
    memory: '512MiB',
    timeoutSeconds: 120,
    maxInstances: 3,
  }, async (request) => {
    const actor = await authorizeAdmin(request, db)
    if (!['admin', 'super_admin'].includes(actor.accessRole)) {
      throw new HttpsError('permission-denied', 'Chỉ Admin hoặc Super Admin được điều chỉnh ca đã ghi nhận.')
    }
    const items = teachingCorrectionItems(request.data?.items)
    const targetDate = date(request.data?.date)
    const targetHour = hour(request.data?.hour)
    const targetTrainerId = id(request.data?.trainerId, 'Mã PT thực dạy')
    const reason = boundedReason(request.data?.reason, 'Lý do điều chỉnh')
    const correctionInstant = now()

    try {
      return await db.runTransaction(async (transaction) => {
      const sessionReferences = items.map((item) => db.doc(`sessions/${item.sessionId}`))
      const sessionSnapshots = await Promise.all(sessionReferences.map((reference) => transaction.get(reference)))
      if (sessionSnapshots.some((snapshot) => !snapshot.exists)) {
        throw new HttpsError('not-found', 'Không tìm thấy đủ các buổi trong ca cần điều chỉnh.')
      }
      const sessions = sessionSnapshots.map((snapshot, index) => ({ id: items[index].sessionId, reference: sessionReferences[index], data: snapshot.data(), item: items[index] }))
      sessions.forEach((session) => {
        const revision = Number(session.data.revision || 0)
        if (revision !== session.item.expectedRevision) {
          throw new HttpsError('aborted', 'Một buổi trong ca đã thay đổi. Hãy tải lại lịch sử trước khi điều chỉnh.', {
            issueCode: 'TEACHING_SHIFT_REVISION_CONFLICT',
            sessionId: session.id,
            expectedRevision: session.item.expectedRevision,
            actualRevision: revision,
          })
        }
        if (!teachingOccupancyStatus(session.data.status)) {
          throw new HttpsError('failed-precondition', 'Ca đã hủy hoặc không còn trạng thái hợp lệ để điều chỉnh tại lịch sử ca dạy.', {
            issueCode: 'TEACHING_SHIFT_STATUS_NOT_EDITABLE', sessionId: session.id, status: session.data.status || '',
          })
        }
      })

      const sourceKeys = new Set(sessions.map((session) => {
        const sourceDate = storedDateKey(session.data.date, 'Ngày ca gốc')
        const sourceHour = storedSessionHour(session.data.hour, session.id, 'Giờ ca gốc')
        return `${sourceDate}|${sourceHour}|${session.data.trainerId || ''}`
      }))
      if (sourceKeys.size !== 1) {
        throw new HttpsError('failed-precondition', 'Các buổi được chọn không còn thuộc cùng một ca. Hãy tải lại và chọn từng ca riêng.', {
          issueCode: 'TEACHING_SHIFT_SOURCE_MISMATCH',
        })
      }

      const attendanceReferences = sessions.map((session) => db.doc(`attendanceEvents/${session.item.attendanceEventId || session.id}`))
      const [trainerSnapshot, ...attendanceSnapshots] = await Promise.all([
        transaction.get(db.doc(`trainers/${targetTrainerId}`)),
        ...attendanceReferences.map((reference) => transaction.get(reference)),
      ])
      if (!trainerSnapshot.exists || trainerSnapshot.data().status === 'inactive') {
        throw new HttpsError('failed-precondition', 'PT thực dạy không tồn tại hoặc đã ngừng hoạt động.', {
          issueCode: 'TEACHING_SHIFT_TRAINER_INACTIVE', trainerId: targetTrainerId,
        })
      }
      const targetTrainer = trainerSnapshot.data()
      const sourceBranchIds = new Set(sessions.map((session) => normaliseSessionBranchId(session.data.branchId)).filter(Boolean))
      // Branch is operational context, not a hard payroll/edit barrier. A
      // learner can train at another site and legacy rows may carry different
      // home branches. Keep the source values in the audit trail and use the
      // first concrete branch as the physical session branch.
      const sourceBranchId = [...sourceBranchIds][0] || ''
      const targetTrainerBranchIds = new Set([targetTrainer.branchId, ...(Array.isArray(targetTrainer.branchIds) ? targetTrainer.branchIds : [])].map(normaliseSessionBranchId).filter(Boolean))
      const targetBranchId = sourceBranchId || normaliseSessionBranchId(targetTrainer.branchId) || [...targetTrainerBranchIds][0] || ''
      if (!targetBranchId) throw new HttpsError('failed-precondition', 'Chưa xác định được chi nhánh của ca cần điều chỉnh.')

      attendanceSnapshots.forEach((snapshot, index) => {
        const item = sessions[index].item
        if (!item.attendanceStatus) return
        if (!snapshot.exists || snapshot.data().sessionId !== item.sessionId) {
          throw new HttpsError('failed-precondition', 'Buổi chưa có bản ghi điểm danh hợp lệ để sửa trạng thái.', {
            issueCode: 'TEACHING_SHIFT_ATTENDANCE_MISSING', sessionId: item.sessionId, attendanceEventId: item.attendanceEventId || item.sessionId,
          })
        }
      })

      const scheduleChanged = sessions.some((session) => (
        storedDateKey(session.data.date, 'Ngày ca gốc') !== targetDate
        || storedSessionHour(session.data.hour, session.id, 'Giờ ca gốc') !== targetHour
        || session.data.trainerId !== targetTrainerId
        || session.data.branchId !== targetBranchId
      ))
      const attendanceChanged = sessions.some((session, index) => {
        if (!session.item.attendanceStatus) return false
        const attendance = attendanceSnapshots[index].data()
        return attendance.attendanceStatus !== session.item.attendanceStatus
          || Number(attendance.lateMinutes || 0) !== Number(session.item.lateMinutes || 0)
          || String(attendance.noShowReason || '') !== session.item.noShowReason
      })
      if (!scheduleChanged && !attendanceChanged) {
        return { unchanged: true, revisions: Object.fromEntries(sessions.map((session) => [session.id, Number(session.data.revision || 0)])), invalidatedPayrollPeriods: [] }
      }

      const targetInstant = new Date(`${targetDate}T${String(targetHour).padStart(2, '0')}:00:00+07:00`)
      if ((attendanceChanged || attendanceSnapshots.some((snapshot) => snapshot.exists)) && targetInstant.getTime() > correctionInstant.getTime()) {
        throw new HttpsError('failed-precondition', 'Ca đã ghi nhận hiện diện không thể được điều chỉnh sang thời điểm trong tương lai.', {
          issueCode: 'TEACHING_SHIFT_FUTURE_ATTENDANCE', date: targetDate, hour: targetHour,
        })
      }
      const targetDateChanged = sessions.some((session) => storedDateKey(session.data.date, 'Ngày ca gốc') !== targetDate)
      if (targetDateChanged && sessions.some((session, index) => isSessionCharged(session.data) || attendanceSnapshots[index].exists) && storedDateKey(sessions[0].data.date, 'Ngày ca gốc').slice(0, 7) !== targetDate.slice(0, 7)) {
        throw new HttpsError('failed-precondition', 'Ca đã tính buổi không thể chuyển sang tháng khác. Hãy giữ kỳ gốc và dùng bù trừ nếu cần.', {
          issueCode: 'TEACHING_SHIFT_CROSS_PERIOD_CORRECTION', remediation: 'payroll_adjustment',
        })
      }

      const sourcePeriods = [...new Set(sessions.map((session) => storedDateKey(session.data.date, 'Ngày ca gốc').slice(0, 7)))]
      const affectedPeriods = [...new Set([...sourcePeriods, targetDate.slice(0, 7)])]
      const payrollReferences = affectedPeriods.map((periodId) => db.doc(`payrollRuns/${periodId}`))
      const financeReferences = affectedPeriods.map((periodId) => db.doc(`financePeriods/${periodId}`))
      const targetTrainerDayQuery = dailySessionsQuery(db, 'trainerId', targetTrainerId, targetDate)
      const studentIds = [...new Set(sessions.map((session) => id(session.data.studentId, 'Mã học viên của buổi tập')))]
      const studentDayQueries = studentIds.map((studentId) => dailySessionsQuery(db, 'studentId', studentId, targetDate))
      const correctionContractIds = targetDateChanged ? [...new Set(sessions.map((session) => linkedContractId(session.data)))] : []
      const correctionContractReferences = correctionContractIds.map((contractId) => db.doc(`contracts/${contractId}`))
      const [payrollSnapshots, financeSnapshots, targetTrainerDay, studentDaySnapshots, correctionContractSnapshots] = await Promise.all([
        Promise.all(payrollReferences.map((reference) => transaction.get(reference))),
        Promise.all(financeReferences.map((reference) => transaction.get(reference))),
        transaction.get(targetTrainerDayQuery),
        Promise.all(studentDayQueries.map((query) => transaction.get(query))),
        Promise.all(correctionContractReferences.map((reference) => transaction.get(reference))),
      ])

      const immutablePayroll = payrollSnapshots.find((snapshot) => snapshot.exists && snapshot.data().status !== 'draft')
      if (immutablePayroll) {
        throw new HttpsError('failed-precondition', `Kỳ lương ${immutablePayroll.id} đã ${immutablePayroll.data().status}. Không thể sửa chứng từ ca gốc; hãy tạo khoản bù trừ ở kỳ tiếp theo.`, {
          issueCode: 'PAYROLL_RUN_IMMUTABLE', periodId: immutablePayroll.id, payrollStatus: immutablePayroll.data().status, remediation: 'payroll_adjustment',
        })
      }
      const lockedFinance = financeSnapshots.find((snapshot) => snapshot.exists && snapshot.data().status === 'locked')
      if (lockedFinance) {
        throw new HttpsError('failed-precondition', `Kỳ tài chính ${lockedFinance.id} đã khóa. Không thể thay đổi bằng chứng ca dạy trực tiếp.`, {
          issueCode: 'FINANCE_PERIOD_LOCKED', periodId: lockedFinance.id, remediation: 'finance_adjustment',
        })
      }
      if (targetTrainerDay.size >= DAILY_SESSION_QUERY_LIMIT || studentDaySnapshots.some((snapshot) => snapshot.size >= DAILY_SESSION_QUERY_LIMIT)) {
        throw new HttpsError('resource-exhausted', 'Dữ liệu ca trong ngày vượt giới hạn xác minh an toàn.')
      }
      if (targetDateChanged) {
        const contractsById = new Map(correctionContractSnapshots.filter((snapshot) => snapshot.exists).map((snapshot) => [snapshot.id, snapshot.data()]))
        sessions.forEach((session) => {
          const contractId = linkedContractId(session.data)
          const contract = contractsById.get(contractId)
          if (!contract || contract.studentId !== session.data.studentId) {
            throw new HttpsError('failed-precondition', 'Không tìm thấy hợp đồng đúng học viên để xác minh ngày điều chỉnh.', {
              issueCode: 'TEACHING_SHIFT_CONTRACT_MISMATCH', sessionId: session.id, contractId,
            })
          }
          const contractStart = storedContractDate(contract.startDate, 'Ngày bắt đầu')
          const contractEnd = storedContractDate(contract.endDate, 'Ngày kết thúc')
          if (targetDate < contractStart || targetDate > contractEnd || pauseCoversDate(contract, targetDate)) {
            throw new HttpsError('failed-precondition', 'Ngày điều chỉnh nằm ngoài thời hạn hợp đồng hoặc trong thời gian OFF/bảo lưu.', {
              issueCode: 'TEACHING_SHIFT_CONTRACT_DATE_INVALID', sessionId: session.id, contractId, date: targetDate,
            })
          }
        })
      }

      const correctedIds = new Set(sessions.map((session) => session.id))
      const existingTargetRows = targetTrainerDay.docs
        .map((snapshot) => ({ id: snapshot.id, ...snapshot.data() }))
        .filter((session) => !correctedIds.has(session.id) && teachingOccupancyStatus(session.status))
        .filter((session) => storedSessionHour(session.hour, session.id, 'Giờ ca liên quan') === targetHour)
      // Two sessions at the same PT/time may carry different learner home
      // branches. This is a warning for the audit/reporting layer, not a
      // reason to lose an otherwise valid attendance correction.
      const targetStudentIds = new Set([...studentIds, ...existingTargetRows.map((session) => session.studentId).filter(Boolean)])
      if (targetStudentIds.size > normalizedTrainerCapacity(targetTrainer.slotCapacity)) {
        throw new HttpsError('resource-exhausted', 'Ca đích đã vượt sức chứa của PT.', {
          issueCode: 'TEACHING_SHIFT_CAPACITY_EXCEEDED', date: targetDate, hour: targetHour, trainerId: targetTrainerId,
        })
      }
      studentDaySnapshots.forEach((snapshot, index) => {
        const conflict = snapshot.docs
          .map((item) => ({ id: item.id, ...item.data() }))
          .find((session) => !correctedIds.has(session.id) && teachingOccupancyStatus(session.status))
        if (conflict) {
          throw new HttpsError('already-exists', 'Một học viên trong ca đã có buổi tập khác trong ngày đích.', {
            issueCode: 'TEACHING_SHIFT_STUDENT_DAY_CONFLICT', studentId: studentIds[index], date: targetDate, conflictingSessionId: conflict.id,
          })
        }
      })

      const targetStart = Timestamp.fromDate(targetInstant)
      const revisions = {}
      sessions.forEach((session, index) => {
        const attendanceSnapshot = attendanceSnapshots[index]
        const before = {
          date: storedDateKey(session.data.date, 'Ngày ca gốc'),
          hour: storedSessionHour(session.data.hour, session.id, 'Giờ ca gốc'),
          trainerId: session.data.trainerId || '',
          branchId: session.data.branchId || '',
          attendanceStatus: attendanceSnapshot.exists ? attendanceSnapshot.data().attendanceStatus || 'pending' : session.data.attendanceStatus || 'pending',
        }
        const nextAttendanceStatus = session.item.attendanceStatus || before.attendanceStatus
        const nextSessionStatus = session.item.attendanceStatus
          ? session.item.attendanceStatus === 'no_show' ? 'no_show' : 'completed'
          : session.data.status
        const nextRevision = Number(session.data.revision || 0) + 1
        revisions[session.id] = nextRevision
        transaction.update(session.reference, {
          previousSchedule: FieldValue.arrayUnion({ date: before.date, hour: before.hour, trainerId: before.trainerId, branchId: before.branchId, changedAt: correctionInstant.toISOString(), reason }),
          date: targetDate,
          hour: targetHour,
          trainerId: targetTrainerId,
          branchId: targetBranchId,
          status: nextSessionStatus,
          attendanceStatus: nextAttendanceStatus,
          correctedAt: FieldValue.serverTimestamp(),
          correctedBy: actor.uid,
          correctionReason: reason,
          ...(targetTrainerBranchIds.size && sourceBranchId && !targetTrainerBranchIds.has(sourceBranchId)
            ? { trainerBranchWarning: true }
            : {}),
          revision: nextRevision,
          updatedAt: FieldValue.serverTimestamp(),
          updatedBy: actor.uid,
        })
        if (attendanceSnapshot.exists) {
          const attendancePatch = {
            trainerId: targetTrainerId,
            scheduledAt: targetStart,
            occurredAt: targetStart,
            correctionReason: reason,
            correctedAt: FieldValue.serverTimestamp(),
            correctedBy: actor.uid,
            updatedAt: FieldValue.serverTimestamp(),
            updatedBy: actor.uid,
          }
          if (session.item.attendanceStatus) {
            Object.assign(attendancePatch, {
              type: session.item.attendanceStatus === 'no_show' ? 'no_show' : 'attended',
              attendanceStatus: session.item.attendanceStatus,
              // Always persist canonical nullable/string values. Older clients
              // omitted these fields, which could make the Admin SDK reject an
              // otherwise valid correction as a generic `internal` error.
              lateMinutes: session.item.attendanceStatus === 'late' ? session.item.lateMinutes : null,
              noShowReason: session.item.attendanceStatus === 'no_show' ? session.item.noShowReason : '',
              confirmationSource: 'admin_correction',
              confirmedAt: FieldValue.serverTimestamp(),
              confirmedBy: actor.uid,
            })
          }
          transaction.update(attendanceReferences[index], attendancePatch)
        }
        transaction.create(db.collection('sessionEvents').doc(), {
          schemaVersion: 2,
          sessionId: session.id,
          type: 'teaching_shift_corrected',
          reason,
          from: before,
          to: { date: targetDate, hour: targetHour, trainerId: targetTrainerId, branchId: targetBranchId, attendanceStatus: nextAttendanceStatus },
          correctedSessionIds: sessions.map((item) => item.id),
          createdAt: FieldValue.serverTimestamp(),
          createdBy: actor.uid,
        })
        if (session.item.attendanceStatus && before.attendanceStatus !== session.item.attendanceStatus) {
          transaction.create(db.collection('attendanceAuditLogs').doc(), {
            schemaVersion: 2,
            sessionId: session.id,
            attendanceEventId: attendanceReferences[index].id,
            studentId: session.data.studentId || '',
            trainerId: targetTrainerId,
            contractId: session.data.contractId || '',
            beforeStatus: before.attendanceStatus,
            afterStatus: session.item.attendanceStatus,
            lateMinutes: session.item.attendanceStatus === 'late' ? session.item.lateMinutes : null,
            noShowReason: session.item.attendanceStatus === 'no_show' ? session.item.noShowReason : '',
            note: reason,
            confirmationSource: 'admin_correction',
            changedAt: FieldValue.serverTimestamp(),
            changedBy: actor.uid,
            timeZone: 'Asia/Ho_Chi_Minh',
          })
        }
      })
      const invalidatedPayrollPeriods = []
      payrollSnapshots.forEach((snapshot, index) => {
        if (!snapshot.exists || snapshot.data().status !== 'draft') return
        invalidatedPayrollPeriods.push(affectedPeriods[index])
        transaction.update(payrollReferences[index], {
          requiresRebuild: true,
          sourceDataStale: true,
          sourceDataChangedAt: FieldValue.serverTimestamp(),
          sourceDataChangedBy: actor.uid,
          sourceDataChangeReason: reason,
          updatedAt: FieldValue.serverTimestamp(),
        })
      })
        return { unchanged: false, revisions, invalidatedPayrollPeriods }
      })
    } catch (cause) {
      if (cause instanceof HttpsError) throw cause
      const supportId = createHash('sha256')
        .update(`${actor.uid}|${targetDate}|${targetHour}|${targetTrainerId}|${Date.now()}|${cause?.message || cause?.code || 'unknown'}`)
        .digest('hex')
        .slice(0, 12)
        .toUpperCase()
      logger?.error?.('teaching_shift_correction_failed', {
        supportId,
        actorUid: actor.uid,
        targetDate,
        targetHour,
        targetTrainerId,
        sessionIds: items.map((item) => item.sessionId),
        code: cause?.code || '',
        message: cause?.message || String(cause || ''),
        stack: cause?.stack || '',
      })
      throw new HttpsError(
        'internal',
        `Không thể lưu điều chỉnh ca. Mã đối soát ${supportId}.`,
        { issueCode: 'TEACHING_SHIFT_SERVICE_FAILURE', supportId },
      )
    }
  })

  const bulkRecordSessionAttendance = onCall(async (request) => {
    const actor = await authorizeAdmin(request, db)
    const items = Array.isArray(request.data?.items) ? request.data.items : []
    if (!items.length || items.length > BULK_ATTENDANCE_LIMIT) {
      throw new HttpsError('invalid-argument', `Mỗi lần chỉ xác nhận từ 1 đến ${BULK_ATTENDANCE_LIMIT} buổi.`)
    }
    const results = []
    for (const item of items) {
      const sessionId = id(item?.sessionId, 'Mã buổi tập')
      try {
        const charge = await chargeSessionTransaction({ db, sessionId, expectedRevision: sessionRevision(item?.expectedRevision), actorUid: actor.uid, now: now() })
        const result = await recordSessionAttendanceTransaction({
          db,
          sessionId,
          expectedRevision: charge.revision,
          actorUid: actor.uid,
          attendanceStatus: 'present',
          now: now(),
        })
        results.push({ sessionId, ok: true, revision: result.revision, unchanged: result.unchanged })
      } catch (error) {
        results.push({ sessionId, ok: false, code: error?.code || 'internal' })
      }
    }
    return {
      total: results.length,
      confirmed: results.filter((item) => item.ok).length,
      failed: results.filter((item) => !item.ok).length,
      results,
    }
  })

  const disabledLegacySessionMutation = async (request) => {
    await authorizeAdmin(request, db)
    throw new HttpsError(
      'failed-precondition',
      'Thao tác lịch trực tiếp đã ngừng sử dụng. Hãy tạo yêu cầu Đổi/Hủy hoặc dùng Điều chỉnh ca có audit.',
      { issueCode: 'LEGACY_SESSION_MUTATION_DISABLED' },
    )
  }
  const cancelSession = onCall(disabledLegacySessionMutation)
  const rescheduleSession = onCall(disabledLegacySessionMutation)
  const swapSessions = onCall(disabledLegacySessionMutation)

  const approveSessionRequest = onCall(async (request) => {
    const actor = await authorizeAdmin(request, db)
    const requestId = id(request.data?.requestId, 'Mã yêu cầu')
    const expectedSessionRevision = sessionRevision(request.data?.expectedSessionRevision)

    const requestReference = db.doc(`sessionRequests/${requestId}`)
    return db.runTransaction(async (transaction) => {
      const requestSnapshot = await transaction.get(requestReference)
      if (!requestSnapshot.exists) throw new HttpsError('not-found', 'Không tìm thấy yêu cầu đổi hoặc hủy lịch.')

      const requestData = requestSnapshot.data()
      if (requestData.status === 'approved') {
        return {
          unchanged: true,
          status: 'approved',
          type: requestData.type,
          revision: Number(requestData.processedSessionRevision || 0),
          policyMonth: requestData.policyMonth || null,
          policySequence: Number(requestData.policySequence || 0),
          complimentary: requestData.complimentary === true,
          complimentaryLimit: Number(requestData.complimentaryLimit || 1),
          loyaltyEntitlementId: requestData.loyaltyEntitlementId || null,
          loyaltyEntitlementUsed: Boolean(requestData.loyaltyEntitlementId),
          countsTowardContract: requestData.countsTowardContract === true,
        }
      }
      if (requestData.status !== 'pending') throw new HttpsError('failed-precondition', 'Yêu cầu này không còn chờ duyệt.')

      const requestType = requestData.type === 'cancel' ? 'cancel' : requestData.type === 'reschedule' ? 'reschedule' : requestData.type === 'additional' ? 'additional' : ''
      if (!requestType) throw new HttpsError('failed-precondition', 'Loại yêu cầu lịch không hợp lệ.')

      // Additional-session requests do not have a source session to mutate.
      // They still use the same transactional collision and availability
      // checks as a reschedule, and only create one scheduled session after
      // an authorised manager approves the request.
      if (requestType === 'additional') {
        const studentId = id(requestData.studentId, 'Mã học viên')
        const contractId = id(requestData.contractId, 'Mã hợp đồng')
        const targetDate = date(requestData.newDate)
        const targetHour = hour(requestData.newHour)
        const trainerId = id(requestData.newTrainerId || requestData.trainerId, 'Mã HLV')
        const trainerSnapshot = await transaction.get(db.doc(`trainers/${trainerId}`))
        if (!trainerSnapshot.exists || trainerSnapshot.data().status === 'inactive') throw new HttpsError('failed-precondition', 'PT của ca đăng ký không còn hoạt động.')
        const targetBranchId = id(requestData.newBranchId || trainerSnapshot.data().branchId || requestData.homeBranchId || '', 'Mã chi nhánh ca đăng ký')
        const sessionId = `additional-${requestId}`
        const sessionReference = db.doc(`sessions/${sessionId}`)
        const targetWeek = mondayForDate(targetDate)
        const [contractSnapshot, studentSnapshot, trainerDay, studentDay, availabilitySnapshot, trainerAvailabilitySnapshot, leavesSnapshot, contractSessionsSnapshot, studentSessionsSnapshot, existingSession, configSnapshot, targetBranchSnapshot, branchDay] = await Promise.all([
          transaction.get(db.doc(`contracts/${contractId}`)),
          transaction.get(db.doc(`students/${studentId}`)),
          transaction.get(dailySessionsQuery(db, 'trainerId', trainerId, targetDate)),
          transaction.get(dailySessionsQuery(db, 'studentId', studentId, targetDate)),
          transaction.get(db.doc(`ptAvailability/${studentId}_${targetWeek}`)),
          transaction.get(db.doc(`trainerAvailability/${trainerId}_${targetWeek}`)),
          transaction.get(db.collection('leaveRequests').where('status', '==', 'approved').limit(1001)),
          transaction.get(db.collection('sessions').where('contractId', '==', contractId).limit(SESSION_CHANGE_DATA_LIMIT + 1)),
          transaction.get(db.collection('sessions').where('studentId', '==', studentId).limit(SESSION_CHANGE_DATA_LIMIT + 1)),
          transaction.get(sessionReference),
          transaction.get(db.doc('settings/scheduleConfig')),
          transaction.get(db.doc(`branches/${targetBranchId}`)),
          transaction.get(dailySessionsQuery(db, 'branchId', targetBranchId, targetDate)),
        ])
        if (existingSession.exists) throw new HttpsError('already-exists', 'Buổi đăng ký thêm đã được tạo; hãy tải lại danh sách yêu cầu.')
        if (!contractSnapshot.exists || !studentSnapshot.exists) throw new HttpsError('failed-precondition', 'Thiếu hợp đồng hoặc hồ sơ học viên.')
        const contract = contractSnapshot.data()
        const student = studentSnapshot.data()
        if (contract.studentId !== studentId || contract.status !== 'active') throw new HttpsError('failed-precondition', 'Hợp đồng không còn hoạt động cho học viên này.')
        const contractStart = storedContractDate(contract.startDate, 'Ngày bắt đầu')
        const contractEnd = storedContractDate(contract.endDate, 'Ngày kết thúc')
        if (targetDate < contractStart || targetDate > contractEnd) throw new HttpsError('failed-precondition', 'Ca đăng ký nằm ngoài thời hạn hợp đồng.')
        if (pauseCoversDate(contract, targetDate)) throw new HttpsError('failed-precondition', 'Ngày đăng ký nằm trong thời gian OFF hoặc bảo lưu.')
        if (contractSessionsSnapshot.size > SESSION_CHANGE_DATA_LIMIT || studentSessionsSnapshot.size > SESSION_CHANGE_DATA_LIMIT || leavesSnapshot.size > 1000) throw new HttpsError('resource-exhausted', 'Dữ liệu lịch vượt giới hạn xác minh an toàn.')
        const contractSessionRows = contractSessionsSnapshot.docs.map((item) => ({ id: item.id, ...item.data() }))
        const contractSessions = activeSessionRows(contractSessionsSnapshot)
        const contractUsage = summarizeContractUsage(contract, contractSessionRows)
        if (contractSessions.filter((item) => item.contractId === contractId).length >= contractUsage.remainingSessions) throw new HttpsError('failed-precondition', 'Hợp đồng đã hết số buổi có thể xếp.')
        const trainer = trainerProfileForWeek(trainerSnapshot.data(), trainerAvailabilitySnapshot.exists ? trainerAvailabilitySnapshot.data() : null, targetWeek)
        const expectedBranchId = contract.branchId || student.branchId
        if (trainer.branchId && trainer.branchId !== targetBranchId) throw new HttpsError('failed-precondition', 'PT không còn thuộc chi nhánh của ca đã chọn.')
        if (targetBranchSnapshot.exists && ['archived', 'inactive'].includes(String(targetBranchSnapshot.data().status || '').toLowerCase())) throw new HttpsError('failed-precondition', 'Chi nhánh của ca đã chọn không còn hoạt động.')
        if (targetBranchId !== expectedBranchId && !targetBranchSnapshot.exists) throw new HttpsError('failed-precondition', 'Không tìm thấy chi nhánh của ca tập khác cơ sở.')
        const assignedTrainerIds = new Set([contract.trainerId, ...(Array.isArray(contract.trainerIds) ? contract.trainerIds : [])].filter(Boolean))
        if (!assignedTrainerIds.has(trainerId) && trainerPolicy(trainer).employmentType !== 'full_time') throw new HttpsError('failed-precondition', 'Ca ngoài PT phụ trách chỉ được chọn PT chính thức toàn thời gian.')
        const { slotId } = assertOperatingCalendar(configSnapshot.exists ? configSnapshot.data() : {}, targetDate, targetHour)
        if (!trainerIsAvailable(trainer, slotId)) throw new HttpsError('failed-precondition', 'Ca đăng ký không còn nằm trong lịch rảnh PT tuần này.')
        const studentAvailability = effectiveStudentAvailability({
          targetWeek,
          exact: availabilitySnapshot.exists ? availabilitySnapshot.data() : null,
          inherited: null,
          profile: student,
        })
        if (!studentAvailability.confirmed || !studentAvailability.slots.includes(slotId)) throw new HttpsError('failed-precondition', 'Ca đăng ký không còn nằm trong lịch rảnh hiệu lực của học viên.')
        const trainerUnavailable = leavesSnapshot.docs.some((item) => {
          const leave = item.data()
          const start = typeof leave.startDate === 'string' ? leave.startDate.slice(0, 10) : ''
          const end = typeof leave.endDate === 'string' ? leave.endDate.slice(0, 10) : start
          return leave.trainerId === trainerId && start && end && targetDate >= start && targetDate <= end
        })
        if (trainerUnavailable) throw new HttpsError('failed-precondition', 'PT đang OFF ở ngày đăng ký.')
        if (activeHourDocuments(trainerDay, targetHour).length >= normalizedTrainerCapacity(trainer.slotCapacity)) throw new HttpsError('resource-exhausted', 'Khung giờ của PT đã đủ học viên.')
        if (activeDayDocuments(studentDay).length > 0) throw new HttpsError('already-exists', 'Học viên đã có một buổi tập trong ngày này.')
        const siteCapacity = branchSlotCapacity(normalizedScheduleConfig(configSnapshot.exists ? configSnapshot.data() : {}), targetBranchId, slotId)
        if (siteCapacity !== null && activeHourDocuments(branchDay, targetHour).length >= siteCapacity) throw new HttpsError('resource-exhausted', 'Chi nhánh đã đủ sức chứa trong khung giờ này.')
        const weeklyStart = mondayForDate(targetDate)
        const weeklyScheduled = activeSessionRows(studentSessionsSnapshot).filter((item) => {
          const itemDate = storedDateKey(item.date, 'Ngày lịch học viên')
          return itemDate >= weeklyStart && itemDate <= addDateDays(weeklyStart, 6)
        }).length
        const weeklyMaximum = Math.max(1, Number(student.maxWeeklySessions || 7))
        if (weeklyScheduled >= weeklyMaximum) throw new HttpsError('failed-precondition', 'Học viên đã đạt số buổi tối đa trong tuần.')
        const operationsPolicy = ptOperationsPolicySnapshot(configSnapshot.exists ? configSnapshot.data() : {})
        try {
          assertSessionChangeDeadline(targetDate, targetHour, now(), operationsPolicy.sessionChangeDeadlineHours)
        } catch (error) {
          throw policyFailure(error)
        }
        transaction.create(sessionReference, {
          schemaVersion: 1,
          studentId,
          accountUid: requestData.accountUid || null,
          trainerId,
          contractId,
          branchId: targetBranchId,
          ...(targetBranchId !== expectedBranchId ? { studentBranchWarning: true, studentHomeBranchId: expectedBranchId || student.branchId || '' } : {}),
          date: targetDate,
          hour: targetHour,
          status: 'scheduled',
          scheduleStatus: 'scheduled',
          billingStatus: 'pending',
          attendanceStatus: 'pending',
          source: 'student_additional_request',
          sessionRequestId: requestId,
          revision: 0,
          createdAt: FieldValue.serverTimestamp(),
          createdBy: actor.uid,
          updatedAt: FieldValue.serverTimestamp(),
          updatedBy: actor.uid,
        })
        transaction.create(db.collection('sessionEvents').doc(), {
          schemaVersion: 2,
          type: 'additional_session_approved',
          sessionId,
          requestId,
          studentId,
          trainerId,
          contractId,
          to: { date: targetDate, hour: targetHour, trainerId, branchId: targetBranchId },
          crossBranchWarning: targetBranchId !== expectedBranchId,
          priorityTier: Number(requestData.priorityTier || 3),
          createdAt: FieldValue.serverTimestamp(),
          createdBy: actor.uid,
        })
        transaction.update(requestReference, {
          status: 'approved',
          approvedAt: FieldValue.serverTimestamp(),
          approvedBy: actor.uid,
          processedSessionId: sessionId,
          processedSessionRevision: 0,
          revision: Number(requestData.revision || 0) + 1,
        })
        const notificationTargets = new Set([requestData.accountUid, trainerId])
        for (const targetUid of notificationTargets) {
          if (typeof targetUid !== 'string' || !/^[A-Za-z0-9_-]+$/.test(targetUid)) continue
          const notificationReference = db.doc(`users/${targetUid}/notifications/pt-session-request-${requestId}-approved`)
          transaction.create(notificationReference, {
            id: notificationReference.id,
            userId: targetUid,
            title: 'Đăng ký thêm buổi đã được duyệt',
            message: `${targetDate} · ${String(targetHour).padStart(2, '0')}:00 · lịch đã được thêm vào gói tập`,
            type: 'pt_schedule',
            category: 'workout',
            actionUrl: targetUid === requestData.accountUid ? '#/schedule' : '#/staff-schedule',
            dedupeKey: notificationReference.id,
            read: false,
            createdAt: FieldValue.serverTimestamp(),
          })
        }
        return { unchanged: false, status: 'approved', type: 'additional', sessionId, revision: 0, date: targetDate, hour: targetHour, trainerId }
      }
      const requestedBy = requestData.requestedBy === 'trainer' || (requestData.requestedBy !== 'student' && requestData.trainerId)
        ? 'trainer'
        : 'student'

      const sessionId = id(requestData.sessionId, 'Mã buổi tập')
      const sessionReference = db.doc(`sessions/${sessionId}`)
      const sessionSnapshot = await transaction.get(sessionReference)
      if (!sessionSnapshot.exists) throw new HttpsError('not-found', 'Không tìm thấy buổi tập cần xử lý.')

      const session = sessionSnapshot.data()
      const revision = Number(session.revision || 0)
      if (revision !== expectedSessionRevision) throw new HttpsError('aborted', 'Buổi tập đã thay đổi. Hãy tải lại trước khi duyệt.')
      if (Number.isInteger(requestData.originalSessionRevision) && revision !== requestData.originalSessionRevision) {
        throw new HttpsError('aborted', 'Buổi tập đã thay đổi kể từ khi yêu cầu được tạo. Hãy tạo yêu cầu mới.')
      }
      if (!isActiveSessionStatus(session.status)) throw new HttpsError('failed-precondition', 'Chỉ có thể xử lý buổi đang lên lịch.')
      if (isSessionCharged(session)) throw new HttpsError('failed-precondition', 'Buổi đã được tính nên yêu cầu đổi/hủy này không còn hợp lệ.')
      if (session.studentId !== requestData.studentId) throw new HttpsError('failed-precondition', 'Yêu cầu không khớp với học viên của buổi tập.')
      const currentDate = storedDateKey(session.date, 'Ngày hiện tại của buổi tập')
      const originalDate = storedDateKey(requestData.originalDate, 'Ngày gốc trong yêu cầu')
      const currentHour = storedSessionHour(session.hour, sessionId, 'Giờ hiện tại của buổi tập')
      const originalHour = storedSessionHour(requestData.originalHour, sessionId, 'Giờ gốc trong yêu cầu')
      if (currentDate !== originalDate || currentHour !== originalHour) throw new HttpsError('aborted', 'Buổi tập không còn ở lịch gốc của yêu cầu. Hãy tạo yêu cầu mới.')
      if (requestData.trainerId && requestData.trainerId !== session.trainerId) throw new HttpsError('aborted', 'HLV của buổi tập đã thay đổi. Hãy tạo yêu cầu mới.')

      const contractId = linkedContractId(session)
      if (requestData.contractId && requestData.contractId !== contractId) throw new HttpsError('aborted', 'Hợp đồng của yêu cầu không còn khớp với buổi tập.')
      const contractReference = db.doc(`contracts/${contractId}`)
      const contractSnapshot = await transaction.get(contractReference)
      if (!contractSnapshot.exists) throw new HttpsError('failed-precondition', 'Hợp đồng liên kết không tồn tại.')
      const contract = contractSnapshot.data()
      if (contract.studentId !== session.studentId) throw new HttpsError('failed-precondition', 'Hợp đồng không thuộc học viên của buổi tập.')
      if (contract.status !== 'active') throw new HttpsError('failed-precondition', 'Hợp đồng liên kết không ở trạng thái hoạt động.')
      const contractStart = storedContractDate(contract.startDate, 'Ngày bắt đầu')
      const contractEnd = storedContractDate(contract.endDate, 'Ngày kết thúc')
      if (originalDate < contractStart || originalDate > contractEnd) throw new HttpsError('failed-precondition', 'Buổi gốc nằm ngoài thời hạn hợp đồng.')
      const configSnapshot = await transaction.get(db.doc('settings/scheduleConfig'))
      const operationsPolicy = ptOperationsPolicySnapshot(requestData.policySnapshot || (configSnapshot.exists ? configSnapshot.data() : {}))

      let policyMonth = ''
      let usageReference = null
      let usageSnapshot = null
      let loyaltyEntitlementReference = null
      let policyDecision = { sequence: 0, complimentary: true, countsTowardContract: false, complimentaryLimit: operationsPolicy.complimentaryChangeCancelPerMonth }
      if (requestedBy === 'student') {
        const submittedAt = requestInstant(requestData.createdAt, requestData.submittedAtIso)
        if (!submittedAt) throw new HttpsError('failed-precondition', 'Yêu cầu cũ thiếu thời gian gửi. Hãy từ chối và để học viên tạo lại yêu cầu.')
        try {
          assertSessionChangeDeadline(originalDate, originalHour, submittedAt, operationsPolicy.sessionChangeDeadlineHours)
        } catch (error) {
          throw policyFailure(error)
        }
        policyMonth = /^\d{4}-\d{2}$/.test(requestData.policyMonth || '')
          ? requestData.policyMonth
          : vietnamMonthKey(submittedAt)
        usageReference = policyUsageReference(db, session.studentId, policyMonth)
        usageSnapshot = await transaction.get(usageReference)
        policyDecision = policyUsageDecision(
          Number(usageSnapshot.data()?.approvedChangeCancelCount || 0),
          operationsPolicy.complimentaryChangeCancelPerMonth,
        )
        if (requestType === 'reschedule' && policyDecision.countsTowardContract) {
          const entitlementSnapshot = await transaction.get(
            db.collection('loyaltyEntitlements')
              .where('studentId', '==', session.studentId)
              .where('type', '==', 'extra_reschedule')
              .where('status', '==', 'available')
              .limit(100),
          )
          const nowMillis = now().getTime()
          const availableEntitlement = entitlementSnapshot.docs
            .filter((item) => item.data().status === 'available' && (!item.data().expiresAt || timestampMillis(item.data().expiresAt) > nowMillis))
            .sort((left, right) => timestampMillis(left.data().expiresAt, Number.POSITIVE_INFINITY) - timestampMillis(right.data().expiresAt, Number.POSITIVE_INFINITY))[0]
          if (availableEntitlement) {
            loyaltyEntitlementReference = availableEntitlement.ref
            policyDecision = { ...policyDecision, complimentary: false, countsTowardContract: false, loyaltyEntitlementUsed: true }
          }
        }
      }

      let newDate = ''
      let newHour = 0
      let trainerId = ''
      let targetBranchId = ''
      let trainerDay = null
      let studentDay = null
      let trainerSnapshot = null
      let studentSnapshot = null
      let availabilitySnapshot = null
      let trainerAvailabilitySnapshot = null
      let trainerLeaves = null
      let branchDay = null
      let targetSiteCapacity = null
      let homeBranchId = ''
      if (requestType === 'reschedule') {
        newDate = date(requestData.newDate)
        newHour = hour(requestData.newHour)
        trainerId = id(requestData.newTrainerId || session.trainerId, 'Mã HLV')
        if (Number(contract.usedSessions || 0) >= Number(contract.totalSessions || 0)) throw new HttpsError('failed-precondition', 'Hợp đồng đã hết buổi nên không thể xếp lịch bù.')
        if (newDate < contractStart || newDate > contractEnd) throw new HttpsError('failed-precondition', 'Lịch mới nằm ngoài thời hạn hợp đồng.')
        if (pauseCoversDate(contract, newDate)) throw new HttpsError('failed-precondition', 'Ngày đề xuất nằm trong thời gian OFF hoặc bảo lưu của hợp đồng.')
        const targetWeek = mondayForDate(newDate)
        ;[trainerDay, studentDay, trainerSnapshot, studentSnapshot, availabilitySnapshot, trainerAvailabilitySnapshot, trainerLeaves] = await Promise.all([
          transaction.get(dailySessionsQuery(db, 'trainerId', trainerId, newDate)),
          transaction.get(dailySessionsQuery(db, 'studentId', session.studentId, newDate)),
          transaction.get(db.doc(`trainers/${trainerId}`)),
          transaction.get(db.doc(`students/${session.studentId}`)),
          transaction.get(db.doc(`ptAvailability/${session.studentId}_${targetWeek}`)),
          transaction.get(db.doc(`trainerAvailability/${trainerId}_${targetWeek}`)),
          transaction.get(db.collection('leaveRequests').where('status', '==', 'approved').limit(1001)),
        ])
        if (!trainerSnapshot.exists || trainerSnapshot.data().status === 'inactive') throw new HttpsError('failed-precondition', 'PT của ca đề xuất không còn hoạt động.')
        if (!studentSnapshot.exists) throw new HttpsError('failed-precondition', 'Hồ sơ học viên không tồn tại.')
        const trainer = trainerProfileForWeek(trainerSnapshot.data(), trainerAvailabilitySnapshot.exists ? trainerAvailabilitySnapshot.data() : null, targetWeek)
        homeBranchId = optionalText(contract.branchId || studentSnapshot.data().branchId || session.branchId, 128)
        const targetBranchCandidate = requestData.newBranchId || trainer.branchId || session.branchId || homeBranchId
        targetBranchId = targetBranchCandidate ? id(targetBranchCandidate, 'Mã chi nhánh ca thay thế') : ''
        if (trainer.branchId && trainer.branchId !== targetBranchId) throw new HttpsError('failed-precondition', 'PT không còn thuộc chi nhánh của ca đã chọn.')
        const targetBranchSnapshot = targetBranchId ? await transaction.get(db.doc(`branches/${targetBranchId}`)) : null
        if (targetBranchSnapshot?.exists && ['archived', 'inactive'].includes(String(targetBranchSnapshot.data().status || '').toLowerCase())) throw new HttpsError('failed-precondition', 'Chi nhánh của ca đã chọn không còn hoạt động.')
        if (targetBranchId && homeBranchId && targetBranchId !== homeBranchId && !targetBranchSnapshot?.exists) throw new HttpsError('failed-precondition', 'Không tìm thấy chi nhánh của ca tập khác cơ sở.')
        const assignedTrainerIds = new Set([session.trainerId, contract.trainerId, ...(Array.isArray(contract.trainerIds) ? contract.trainerIds : [])].filter(Boolean))
        if (!assignedTrainerIds.has(trainerId) && trainerPolicy(trainer).employmentType !== 'full_time') {
          throw new HttpsError('failed-precondition', 'Ca thay thế ngoài PT phụ trách chỉ được chọn PT chính thức toàn thời gian.')
        }
        const { slotId } = assertOperatingCalendar(configSnapshot.exists ? configSnapshot.data() : {}, newDate, newHour)
        if (!trainerIsAvailable(trainer, slotId)) throw new HttpsError('failed-precondition', 'Ca đề xuất không còn nằm trong lịch rảnh PT tuần này.')
        targetSiteCapacity = targetBranchId ? branchSlotCapacity(normalizedScheduleConfig(configSnapshot.exists ? configSnapshot.data() : {}), targetBranchId, slotId) : null
        if (targetSiteCapacity !== null) branchDay = await transaction.get(dailySessionsQuery(db, 'branchId', targetBranchId, newDate))
        const studentData = studentSnapshot.data()
        const studentAvailability = effectiveStudentAvailability({
          targetWeek,
          exact: availabilitySnapshot.exists ? availabilitySnapshot.data() : null,
          inherited: null,
          profile: studentData,
        })
        if (!studentAvailability.confirmed || !studentAvailability.slots.includes(slotId)) throw new HttpsError('failed-precondition', 'Ca đề xuất không còn nằm trong lịch rảnh hiệu lực của học viên.')
        if (trainerLeaves.size > 1000) throw new HttpsError('resource-exhausted', 'Danh sách OFF vượt giới hạn xác minh an toàn.')
        const trainerUnavailable = trainerLeaves.docs.some((item) => {
          const leave = item.data()
          const start = typeof leave.startDate === 'string' ? leave.startDate.slice(0, 10) : ''
          const end = typeof leave.endDate === 'string' ? leave.endDate.slice(0, 10) : start
          return leave.trainerId === trainerId && start && end && newDate >= start && newDate <= end
        })
        if (trainerUnavailable) throw new HttpsError('failed-precondition', 'PT đang OFF ở ngày đề xuất.')
      }

      let policyAttendanceReference = null
      let policyRecognitionReference = null
      let policyRecognitionJournalReference = null
      let policyRecognition = null
      let policyRecognitionJournal = null
      if (policyDecision.countsTowardContract) {
        const policyPeriodId = originalDate.slice(0, 7)
        const policyPeriod = await transaction.get(db.doc(`financePeriods/${policyPeriodId}`))
        if (policyPeriod.exists && policyPeriod.data().status === 'locked') {
          throw new HttpsError('failed-precondition', `Kỳ tài chính ${policyPeriodId} đã khóa; không thể ghi nhận lượt tính buổi vào kỳ này.`)
        }
        if (Number(contract.usedSessions || 0) >= Number(contract.totalSessions || 0)) throw new HttpsError('failed-precondition', 'Hợp đồng đã hết buổi nên không thể ghi nhận thêm lượt đổi/hủy có tính buổi.')
        const chargeId = `policy_${requestId}`
        policyAttendanceReference = db.doc(`attendanceEvents/${chargeId}`)
        policyRecognitionReference = db.doc(`ledgerEntries/pt_policy_${requestId}`)
        policyRecognitionJournalReference = db.doc(`journalEntries/pt_policy_${requestId}`)
        const [attendanceSnapshot, recognitionSnapshot, recognitionJournalSnapshot] = await Promise.all([
          transaction.get(policyAttendanceReference),
          transaction.get(policyRecognitionReference),
          transaction.get(policyRecognitionJournalReference),
        ])
        if (attendanceSnapshot.exists || recognitionSnapshot.exists || recognitionJournalSnapshot.exists) throw new HttpsError('already-exists', 'Lượt tính buổi của yêu cầu đã tồn tại nhưng trạng thái chưa đồng bộ. Cần đối soát trước khi duyệt lại.')
        policyRecognition = ptRevenueRecognitionWrite({
          sessionId: chargeId,
          session: { ...session, date: originalDate },
          contractId,
          contract,
          attendanceEventId: chargeId,
          actorUid: actor.uid,
          serviceOrdinal: Math.max(1, Math.floor(Number(contract.usedSessions || 0)) + 1),
          evidenceStatus: 'policy_charge',
          confirmationSource: 'approved_policy',
        })
        if (policyRecognition) {
          policyRecognition = {
            ...policyRecognition,
            recognitionPolicy: 'approved_policy_charge_v2',
            sourceSessionId: sessionId,
            sessionRequestId: requestId,
          }
          policyRecognitionJournal = {
            ...ptRevenueJournalWrite({ recognition: policyRecognition, contract, sessionId: chargeId, actorUid: actor.uid }),
            documentId: policyRecognitionReference.id,
            referenceCode: `DT-CS-${String(requestId).slice(0, 20).toUpperCase()}`,
          }
        }
      }

      const nextRevision = revision + 1
      const eventReference = db.collection('sessionEvents').doc()
      if (requestType === 'cancel') {
        const reason = typeof requestData.reason === 'string' ? requestData.reason.trim().slice(0, 500) : ''
        const cancellationType = requestedBy === 'trainer' ? 'trainer_cancelled' : 'student_cancelled'
        transaction.update(sessionReference, {
          status: cancellationType,
          scheduleStatus: 'cancelled',
          billingStatus: policyDecision.countsTowardContract ? 'charged' : 'exempt',
          attendanceStatus: policyDecision.countsTowardContract ? 'policy_charge' : null,
          cancellationReason: reason,
          approvedRequestId: requestId,
          revision: nextRevision,
          cancelledAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
          updatedBy: actor.uid,
          policyMonth: policyMonth || null,
          policySequence: policyDecision.sequence || null,
          countsTowardContract: policyDecision.countsTowardContract,
        })
        transaction.create(eventReference, { schemaVersion: 2, sessionId, requestId, type: cancellationType, requestedBy, reason, policyMonth: policyMonth || null, policySequence: policyDecision.sequence || null, countsTowardContract: policyDecision.countsTowardContract, createdAt: FieldValue.serverTimestamp(), createdBy: actor.uid })
      } else {
        const targetCapacity = normalizedTrainerCapacity(trainerSnapshot.data().slotCapacity)
        if (activeHourDocuments(trainerDay, newHour, [sessionId]).length >= targetCapacity) throw new HttpsError('resource-exhausted', 'Khung giờ của HLV đã đủ học viên.')
        if (activeDayDocuments(studentDay, [sessionId]).length > 0) throw new HttpsError('already-exists', 'Học viên đã có một buổi tập trong ngày này.')
        if (branchDay && activeHourDocuments(branchDay, newHour, [sessionId]).length >= targetSiteCapacity) throw new HttpsError('resource-exhausted', 'Chi nhánh đã đủ sức chứa trong khung giờ này.')
        const isCrossBranch = Boolean(targetBranchId && homeBranchId && targetBranchId !== homeBranchId)
        transaction.update(sessionReference, {
          previousSchedule: FieldValue.arrayUnion({ date: session.date, hour: session.hour ?? null, trainerId: session.trainerId, branchId: session.branchId || null, changedAt: new Date().toISOString() }),
          date: newDate,
          hour: newHour,
          trainerId,
          ...(targetBranchId ? { branchId: targetBranchId } : {}),
          studentBranchWarning: isCrossBranch,
          studentHomeBranchId: isCrossBranch ? homeBranchId : null,
          status: 'scheduled',
          scheduleStatus: 'rescheduled',
          billingStatus: 'pending',
          attendanceStatus: 'pending',
          approvedRequestId: requestId,
          rescheduledAt: FieldValue.serverTimestamp(),
          revision: nextRevision,
          updatedAt: FieldValue.serverTimestamp(),
          updatedBy: actor.uid,
          policyMonth: policyMonth || null,
          policySequence: policyDecision.sequence || null,
          previousSlotCountsTowardContract: policyDecision.countsTowardContract,
          changeSuggestionId: requestData.candidateId || null,
          loyaltyEntitlementId: loyaltyEntitlementReference?.id || null,
        })
        transaction.create(eventReference, { schemaVersion: 2, sessionId, requestId, type: 'rescheduled', from: { date: session.date, hour: session.hour ?? null, trainerId: session.trainerId, branchId: session.branchId || null }, to: { date: newDate, hour: newHour, trainerId, branchId: targetBranchId || null }, crossBranchWarning: isCrossBranch, policyMonth: policyMonth || null, policySequence: policyDecision.sequence || null, previousSlotCountsTowardContract: policyDecision.countsTowardContract, loyaltyEntitlementId: loyaltyEntitlementReference?.id || null, createdAt: FieldValue.serverTimestamp(), createdBy: actor.uid })
      }

      if (requestedBy === 'student') {
        const usageWrite = {
          schemaVersion: 1,
          studentId: session.studentId,
          monthKey: policyMonth,
          approvedChangeCancelCount: policyDecision.sequence,
          complimentaryUsed: policyDecision.complimentary === true,
          lastRequestId: requestId,
          updatedAt: FieldValue.serverTimestamp(),
          updatedBy: actor.uid,
        }
        if (usageSnapshot.exists) transaction.update(usageReference, usageWrite)
        else transaction.create(usageReference, { ...usageWrite, createdAt: FieldValue.serverTimestamp() })
      }
      if (loyaltyEntitlementReference) {
        transaction.update(loyaltyEntitlementReference, {
          status: 'consumed',
          consumedFor: 'session_reschedule',
          consumedRequestId: requestId,
          consumedSessionId: sessionId,
          consumedAt: FieldValue.serverTimestamp(),
          consumedBy: actor.uid,
        })
      }
      if (policyDecision.countsTowardContract) {
        const chargeId = `policy_${requestId}`
        transaction.create(policyAttendanceReference, {
          schemaVersion: 2,
          type: requestType === 'cancel' ? 'charged_cancellation' : 'charged_reschedule',
          attendanceStatus: 'policy_charge',
          sessionId,
          sessionRequestId: requestId,
          chargeId,
          studentId: session.studentId,
          trainerId: session.trainerId,
          contractId,
          occurredAt: FieldValue.serverTimestamp(),
          scheduledFor: originalDate,
          createdAt: FieldValue.serverTimestamp(),
          createdBy: actor.uid,
          timeZone: 'Asia/Ho_Chi_Minh',
        })
        transaction.update(contractReference, {
          usedSessions: FieldValue.increment(1),
          attendedClasses: FieldValue.arrayUnion(chargeId),
          // A cancelled session itself becomes the charged evidence. A
          // rescheduled session remains pending and must still be chargeable
          // when the replacement slot starts.
          ...(requestType === 'cancel' ? { chargedSessionIds: FieldValue.arrayUnion(sessionId) } : {}),
          updatedAt: FieldValue.serverTimestamp(),
        })
        if (policyRecognition) {
          transaction.create(policyRecognitionReference, { ...policyRecognition, journalEntryId: policyRecognitionJournalReference.id })
          transaction.create(policyRecognitionJournalReference, policyRecognitionJournal)
        }
      }

      transaction.update(requestReference, {
        status: 'approved',
        approvedAt: FieldValue.serverTimestamp(),
        approvedBy: actor.uid,
        requestedBy,
        policyVersion: 'pt-change-cancel-v2',
        policyMonth: policyMonth || null,
        policySequence: policyDecision.sequence || null,
        complimentary: policyDecision.complimentary,
        complimentaryLimit: policyDecision.complimentaryLimit,
        loyaltyEntitlementId: loyaltyEntitlementReference?.id || null,
        countsTowardContract: policyDecision.countsTowardContract,
        processedSessionRevision: nextRevision,
        revision: Number(requestData.revision || 0) + 1,
      })
      const notificationTargets = new Set([requestData.accountUid, session.trainerId, requestType === 'reschedule' ? trainerId : ''])
      for (const targetUid of notificationTargets) {
        if (typeof targetUid !== 'string' || !/^[A-Za-z0-9_-]+$/.test(targetUid)) continue
        const isStudentRecipient = targetUid === requestData.accountUid
        const notificationReference = db.doc(`users/${targetUid}/notifications/pt-session-request-${requestId}-approved`)
        transaction.create(notificationReference, {
          id: notificationReference.id,
          userId: targetUid,
          title: requestType === 'cancel' ? 'Yêu cầu hủy ca đã được duyệt' : 'Lịch đổi ca đã được xác nhận',
          message: requestType === 'cancel'
            ? `${originalDate} · ${String(originalHour).padStart(2, '0')}:00${policyDecision.countsTowardContract ? ' · có tính buổi theo chính sách' : ' · không tính buổi'}`
            : `${newDate} · ${String(newHour).padStart(2, '0')}:00${isStudentRecipient ? ' · lịch đã được chuyển an toàn' : ' · có học viên được xếp vào ca'}`,
          type: 'pt_schedule',
          category: 'workout',
          actionUrl: isStudentRecipient ? '#/schedule' : '#/staff-schedule',
          dedupeKey: notificationReference.id,
          read: false,
          createdAt: FieldValue.serverTimestamp(),
        })
      }
      return {
        unchanged: false,
        status: 'approved',
        type: requestType,
        revision: nextRevision,
        policyMonth: policyMonth || null,
        policySequence: policyDecision.sequence || null,
        complimentary: policyDecision.complimentary,
        complimentaryLimit: policyDecision.complimentaryLimit,
        loyaltyEntitlementId: loyaltyEntitlementReference?.id || null,
        loyaltyEntitlementUsed: Boolean(loyaltyEntitlementReference),
        countsTowardContract: policyDecision.countsTowardContract,
      }
    })
  })

  const createMyContractPauseRequest = onCall(async (request) => {
    const actor = await authorizeStudent(request, db)
    const studentId = linkedStudentId(actor)
    const contractId = id(request.data?.contractId, 'Mã hợp đồng')
    const type = pauseRequestType(request.data?.type)
    const startDate = date(request.data?.startDate)
    const endDate = date(request.data?.endDate)
    const reason = boundedReason(request.data?.reason)
    const idempotencyKey = id(request.data?.idempotencyKey, 'Khóa chống gửi trùng')
    let durationDays
    try {
      durationDays = inclusiveDateDays(startDate, endDate)
    } catch (error) {
      throw new HttpsError('invalid-argument', error.message)
    }
    if (durationDays > 366) throw new HttpsError('invalid-argument', 'Một yêu cầu bảo lưu tối đa 366 ngày.')

    const submittedAt = now()
    if (startDate < vietnamDateKey(submittedAt)) throw new HttpsError('failed-precondition', 'Ngày bắt đầu OFF hoặc bảo lưu không được nằm trong quá khứ.')
    const requestReference = db.doc(`leaveRequests/student-${actor.uid}-${idempotencyKey}`)
    const contractReference = db.doc(`contracts/${contractId}`)
    return db.runTransaction(async (transaction) => {
      const [existingRequest, contractSnapshot, configSnapshot] = await Promise.all([
        transaction.get(requestReference),
        transaction.get(contractReference),
        transaction.get(db.doc('settings/scheduleConfig')),
      ])
      const operationsPolicy = ptOperationsPolicySnapshot(configSnapshot.exists ? configSnapshot.data() : {})
      if (type === 'off' && durationDays > operationsPolicy.offMaxDaysPerRequest) throw new HttpsError('failed-precondition', `OFF tối đa ${operationsPolicy.offMaxDaysPerRequest} ngày mỗi lần. Khoảng dài hơn phải đăng ký bảo lưu.`, { issueCode: 'PRESERVATION_REQUIRED' })
      if (type === 'preservation' && durationDays <= operationsPolicy.offMaxDaysPerRequest) throw new HttpsError('failed-precondition', `Khoảng nghỉ từ ${operationsPolicy.offMaxDaysPerRequest} ngày trở xuống hãy đăng ký OFF.`, { issueCode: 'USE_OFF_REQUEST' })
      if (existingRequest.exists) {
        const existing = existingRequest.data()
        return {
          unchanged: true,
          requestId: existingRequest.id,
          status: existing.status,
          type: existing.type,
          durationDays: existing.durationDays,
          offLimit: existing.offLimit || null,
          offUsedOrPending: existing.offUsedOrPending || null,
        }
      }
      if (!contractSnapshot.exists) throw new HttpsError('not-found', 'Không tìm thấy hợp đồng.')
      const contract = contractSnapshot.data()
      if (contract.studentId !== studentId) throw new HttpsError('permission-denied', 'Hợp đồng không thuộc học viên đang đăng nhập.')
      if (!['active', 'frozen'].includes(contract.status)) throw new HttpsError('failed-precondition', 'Chỉ hợp đồng đang hoạt động mới được đăng ký OFF hoặc bảo lưu.')
      const contractStart = storedContractDate(contract.startDate, 'Ngày bắt đầu')
      const contractEnd = storedContractDate(contract.endDate, 'Ngày kết thúc')
      if (startDate < contractStart || startDate > contractEnd) throw new HttpsError('failed-precondition', 'Ngày bắt đầu nghỉ phải nằm trong thời hạn hợp đồng hiện tại.')

      const packageId = typeof contract.packageId === 'string' && /^[A-Za-z0-9_-]+$/.test(contract.packageId) ? contract.packageId : ''
      const [packageSnapshot, existingRequests] = await Promise.all([
        packageId ? transaction.get(db.doc(`packages/${packageId}`)) : Promise.resolve({ exists: false, data: () => ({}) }),
        transaction.get(db.collection('leaveRequests').where('studentId', '==', studentId).limit(REQUEST_QUERY_LIMIT)),
      ])
      if (existingRequests.size >= REQUEST_QUERY_LIMIT) throw new HttpsError('resource-exhausted', 'Có quá nhiều yêu cầu nghỉ để kiểm tra an toàn. Vui lòng liên hệ quản trị.')
      const activeRequests = existingRequests.docs
        .map((item) => ({ id: item.id, ...item.data() }))
        .filter((item) => item.id !== requestReference.id && item.contractId === contractId && ['pending', 'approved'].includes(item.status))
      const overlaps = activeRequests.some((item) => {
        const itemStart = typeof item.startDate === 'string' ? item.startDate.slice(0, 10) : ''
        const itemEnd = typeof item.endDate === 'string' ? item.endDate.slice(0, 10) : ''
        return itemStart && itemEnd && startDate <= itemEnd && endDate >= itemStart
      })
      if (overlaps) throw new HttpsError('already-exists', 'Khoảng thời gian này đang trùng với một yêu cầu OFF hoặc bảo lưu khác.')

      const durationMonths = contractDurationMonths(contract, packageSnapshot.exists ? packageSnapshot.data() : {})
      const offLimit = offRegistrationLimit(durationMonths, operationsPolicy)
      const offUsedOrPending = activeRequests.filter(isOffPauseRequest).length
      let cutoffAt = null
      if (type === 'off') {
        if (offUsedOrPending >= offLimit) throw new HttpsError('failed-precondition', `Hợp đồng ${durationMonths} tháng đã dùng hết ${offLimit} lượt OFF. Hãy đăng ký bảo lưu nếu cần nghỉ dài hơn.`, { issueCode: 'OFF_ALLOWANCE_EXHAUSTED' })
        try {
          cutoffAt = assertWeeklyOffDeadline(startDate, submittedAt, operationsPolicy.offRegistrationCutoffHour).toISOString()
        } catch (error) {
          throw policyFailure(error)
        }
      }

      transaction.create(requestReference, {
        schemaVersion: 3,
        policyVersion: 'pt-contract-pause-v2',
        policySnapshot: operationsPolicy,
        type,
        studentId,
        accountUid: actor.uid,
        contractId,
        startDate,
        endDate,
        durationDays,
        reason,
        status: 'pending',
        contractDurationMonths: durationMonths,
        offLimit,
        offUsedOrPending: type === 'off' ? offUsedOrPending + 1 : offUsedOrPending,
        cutoffAt,
        submittedAtIso: submittedAt.toISOString(),
        idempotencyKey,
        revision: 0,
        createdAt: FieldValue.serverTimestamp(),
        createdBy: actor.uid,
      })
      return {
        unchanged: false,
        requestId: requestReference.id,
        status: 'pending',
        type,
        durationDays,
        offLimit,
        offUsedOrPending: type === 'off' ? offUsedOrPending + 1 : offUsedOrPending,
        cutoffAt,
      }
    })
  })

  const approveContractPauseRequest = onCall(async (request) => {
    const actor = await authorizeAdmin(request, db)
    const requestId = id(request.data?.requestId, 'Mã yêu cầu')
    const requestReference = db.doc(`leaveRequests/${requestId}`)
    return db.runTransaction(async (transaction) => {
      const requestSnapshot = await transaction.get(requestReference)
      if (!requestSnapshot.exists) throw new HttpsError('not-found', 'Không tìm thấy yêu cầu OFF hoặc bảo lưu.')
      const requestData = requestSnapshot.data()
      if (requestData.status === 'approved') {
        return { unchanged: true, status: 'approved', type: requestData.type, durationDays: requestData.durationDays, newEndDate: requestData.newContractEndDate, cancelledSessionCount: requestData.cancelledSessionCount || 0 }
      }
      if (requestData.status !== 'pending') throw new HttpsError('failed-precondition', 'Yêu cầu này không còn chờ duyệt.')
      const studentId = id(requestData.studentId, 'Mã học viên')
      const contractId = id(requestData.contractId, 'Mã hợp đồng')
      const startDate = date(requestData.startDate)
      const endDate = date(requestData.endDate)
      const durationDays = inclusiveDateDays(startDate, endDate)
      const configSnapshot = await transaction.get(db.doc('settings/scheduleConfig'))
      const operationsPolicy = ptOperationsPolicySnapshot(requestData.policySnapshot || (configSnapshot.exists ? configSnapshot.data() : {}))
      // Legacy leave requests did not store a type. Infer it conservatively from
      // the approved duration so old pending data remains processable.
      const type = requestData.type === 'off' || requestData.type === 'preservation'
        ? pauseRequestType(requestData.type)
        : durationDays <= operationsPolicy.offMaxDaysPerRequest ? 'off' : 'preservation'
      if (type === 'off' && durationDays > operationsPolicy.offMaxDaysPerRequest) throw new HttpsError('failed-precondition', `OFF vượt quá ${operationsPolicy.offMaxDaysPerRequest} ngày; yêu cầu phải được tạo lại dưới dạng bảo lưu.`)
      if (type === 'preservation' && durationDays <= operationsPolicy.offMaxDaysPerRequest) throw new HttpsError('failed-precondition', 'Khoảng nghỉ này phải được tạo dưới dạng OFF.')
      if (type === 'off') {
        const submittedAt = requestInstant(requestData.createdAt, requestData.submittedAtIso)
        if (!submittedAt) throw new HttpsError('failed-precondition', 'Yêu cầu OFF cũ thiếu thời gian gửi. Hãy từ chối và để học viên tạo lại yêu cầu.')
        try {
          assertWeeklyOffDeadline(startDate, submittedAt, operationsPolicy.offRegistrationCutoffHour)
        } catch (error) {
          throw policyFailure(error)
        }
      }

      const contractReference = db.doc(`contracts/${contractId}`)
      const contractSnapshot = await transaction.get(contractReference)
      if (!contractSnapshot.exists) throw new HttpsError('not-found', 'Không tìm thấy hợp đồng.')
      const contract = contractSnapshot.data()
      if (contract.studentId !== studentId) throw new HttpsError('failed-precondition', 'Hợp đồng không thuộc học viên trong yêu cầu.')
      if (!['active', 'frozen'].includes(contract.status)) throw new HttpsError('failed-precondition', 'Hợp đồng không còn hoạt động.')

      const packageId = typeof contract.packageId === 'string' && /^[A-Za-z0-9_-]+$/.test(contract.packageId) ? contract.packageId : ''
      const [packageSnapshot, existingRequests, sessionsSnapshot] = await Promise.all([
        packageId ? transaction.get(db.doc(`packages/${packageId}`)) : Promise.resolve({ exists: false, data: () => ({}) }),
        transaction.get(db.collection('leaveRequests').where('studentId', '==', studentId).limit(REQUEST_QUERY_LIMIT)),
        transaction.get(db.collection('sessions').where('studentId', '==', studentId).where('date', '>=', startDate).where('date', '<', nextDateKey(endDate)).limit(PAUSE_SESSION_QUERY_LIMIT + 1)),
      ])
      if (existingRequests.size >= REQUEST_QUERY_LIMIT) throw new HttpsError('resource-exhausted', 'Có quá nhiều yêu cầu nghỉ để duyệt an toàn.')
      if (sessionsSnapshot.size > PAUSE_SESSION_QUERY_LIMIT) throw new HttpsError('resource-exhausted', 'Khoảng nghỉ có quá nhiều buổi tập để cập nhật trong một giao dịch.')

      const otherApproved = existingRequests.docs
        .map((item) => ({ id: item.id, ...item.data() }))
        .filter((item) => item.id !== requestId && item.contractId === contractId && item.status === 'approved')
      const overlaps = otherApproved.some((item) => {
        const itemStart = typeof item.startDate === 'string' ? item.startDate.slice(0, 10) : ''
        const itemEnd = typeof item.endDate === 'string' ? item.endDate.slice(0, 10) : ''
        return itemStart && itemEnd && startDate <= itemEnd && endDate >= itemStart
      })
      if (overlaps) throw new HttpsError('already-exists', 'Khoảng nghỉ trùng với một OFF hoặc bảo lưu đã được duyệt.')

      const durationMonths = contractDurationMonths(contract, packageSnapshot.exists ? packageSnapshot.data() : {})
      const offLimit = offRegistrationLimit(durationMonths, operationsPolicy)
      const approvedOffCount = otherApproved.filter(isOffPauseRequest).length
      if (type === 'off' && approvedOffCount >= offLimit) throw new HttpsError('failed-precondition', `Hợp đồng ${durationMonths} tháng đã đủ ${offLimit} lượt OFF.`)

      const oldEndDate = storedContractDate(contract.endDate, 'Ngày kết thúc')
      const nextEndDateKey = addDateDays(oldEndDate, durationDays)
      const newEndDate = storedDateShape(contract.endDate, nextEndDateKey)
      const activeSessions = sessionsSnapshot.docs.filter((item) => isActiveSessionStatus(item.data().status))
      if (activeSessions.some((item) => isSessionCharged(item.data()))) {
        throw new HttpsError('failed-precondition', 'Khoảng nghỉ có buổi đã được tính. Hãy điều chỉnh riêng buổi đó trước khi duyệt.')
      }
      activeSessions.forEach((item) => {
        const session = item.data()
        transaction.update(item.ref, {
          status: 'student_cancelled',
          scheduleStatus: 'cancelled',
          billingStatus: 'exempt',
          attendanceStatus: null,
          cancellationReason: type === 'off' ? 'OFF đã được duyệt' : 'Bảo lưu hợp đồng đã được duyệt',
          pauseRequestId: requestId,
          countsTowardContract: false,
          revision: Number(session.revision || 0) + 1,
          cancelledAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
          updatedBy: actor.uid,
        })
      })
      transaction.update(contractReference, {
        endDate: newEndDate,
        extensions: FieldValue.arrayUnion({
          id: `pause-request-${requestId}`,
          oldEndDate: contract.endDate,
          newEndDate,
          days: durationDays,
          type,
          reason: type === 'off' ? `Cộng ${durationDays} ngày OFF` : `Cộng ${durationDays} ngày bảo lưu`,
          createdAt: now().toISOString(),
          createdBy: actor.uid,
        }),
        pausePeriods: FieldValue.arrayUnion({ requestId, type, startDate, endDate, durationDays }),
        revision: Number(contract.revision || 0) + 1,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: actor.uid,
      })
      transaction.update(requestReference, {
        status: 'approved',
        policyVersion: 'pt-contract-pause-v2',
        contractDurationMonths: durationMonths,
        offLimit,
        offSequence: type === 'off' ? approvedOffCount + 1 : null,
        oldContractEndDate: contract.endDate,
        newContractEndDate: newEndDate,
        cancelledSessionCount: activeSessions.length,
        approvedAt: FieldValue.serverTimestamp(),
        approvedBy: actor.uid,
        revision: Number(requestData.revision || 0) + 1,
      })
      transaction.create(db.doc(`contractPauseEvents/${requestId}`), {
        schemaVersion: 1,
        requestId,
        contractId,
        studentId,
        type,
        startDate,
        endDate,
        durationDays,
        oldEndDate: contract.endDate,
        newEndDate,
        cancelledSessionIds: activeSessions.map((item) => item.id),
        createdAt: FieldValue.serverTimestamp(),
        createdBy: actor.uid,
      })
      if (typeof requestData.accountUid === 'string' && /^[A-Za-z0-9_-]+$/.test(requestData.accountUid)) {
        const notificationReference = db.doc(`users/${requestData.accountUid}/notifications/pt-pause-request-${requestId}-approved`)
        transaction.create(notificationReference, {
          id: notificationReference.id,
          userId: requestData.accountUid,
          title: type === 'off' ? 'Yêu cầu OFF đã được duyệt' : 'Yêu cầu bảo lưu đã được duyệt',
          message: `${startDate} → ${endDate} · hợp đồng được cộng ${durationDays} ngày`,
          type: 'pt_schedule',
          category: 'workout',
          actionUrl: '#/schedule',
          dedupeKey: notificationReference.id,
          read: false,
          createdAt: FieldValue.serverTimestamp(),
        })
      }
      return { unchanged: false, status: 'approved', type, durationDays, newEndDate, cancelledSessionCount: activeSessions.length, offSequence: type === 'off' ? approvedOffCount + 1 : null, offLimit }
    })
  })

  const rejectContractPauseRequest = onCall(async (request) => {
    const actor = await authorizeAdmin(request, db)
    const requestId = id(request.data?.requestId, 'Mã yêu cầu')
    const reason = boundedReason(request.data?.reason, 'Lý do từ chối')
    const requestReference = db.doc(`leaveRequests/${requestId}`)
    return db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(requestReference)
      if (!snapshot.exists) throw new HttpsError('not-found', 'Không tìm thấy yêu cầu OFF hoặc bảo lưu.')
      const data = snapshot.data()
      if (data.status === 'rejected') return { unchanged: true, status: 'rejected' }
      if (data.status !== 'pending') throw new HttpsError('failed-precondition', 'Yêu cầu này không còn chờ duyệt.')
      transaction.update(requestReference, { status: 'rejected', adminNote: reason, rejectedAt: FieldValue.serverTimestamp(), rejectedBy: actor.uid, revision: Number(data.revision || 0) + 1 })
      transaction.create(db.collection('contractPauseEvents').doc(), { schemaVersion: 1, requestId, contractId: data.contractId || '', studentId: data.studentId || '', type: 'rejected', reason, createdAt: FieldValue.serverTimestamp(), createdBy: actor.uid })
      if (typeof data.accountUid === 'string' && /^[A-Za-z0-9_-]+$/.test(data.accountUid)) {
        const notificationReference = db.doc(`users/${data.accountUid}/notifications/pt-pause-request-${requestId}-rejected`)
        transaction.create(notificationReference, {
          id: notificationReference.id,
          userId: data.accountUid,
          title: data.type === 'preservation' ? 'Yêu cầu bảo lưu chưa được duyệt' : 'Yêu cầu OFF chưa được duyệt',
          message: reason,
          type: 'pt_schedule',
          category: 'workout',
          actionUrl: '#/schedule',
          dedupeKey: notificationReference.id,
          read: false,
          createdAt: FieldValue.serverTimestamp(),
        })
      }
      return { unchanged: false, status: 'rejected' }
    })
  })

  const rejectSessionRequest = onCall(async (request) => {
    const actor = await authorizeAdmin(request, db)
    const requestId = id(request.data?.requestId, 'Mã yêu cầu')
    const reason = typeof request.data?.reason === 'string' ? request.data.reason.trim().slice(0, 500) : ''
    if (!reason) throw new HttpsError('invalid-argument', 'Vui lòng nhập lý do từ chối.')
    const requestReference = db.doc(`sessionRequests/${requestId}`)
    return db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(requestReference)
      if (!snapshot.exists) throw new HttpsError('not-found', 'Không tìm thấy yêu cầu đổi hoặc hủy lịch.')
      const data = snapshot.data()
      if (data.status === 'rejected') return { unchanged: true, status: 'rejected' }
      if (data.status !== 'pending') throw new HttpsError('failed-precondition', 'Yêu cầu này không còn chờ duyệt.')
      transaction.update(requestReference, {
        status: 'rejected',
        adminNote: reason,
        rejectedAt: FieldValue.serverTimestamp(),
        rejectedBy: actor.uid,
        revision: Number(data.revision || 0) + 1,
      })
      transaction.create(db.collection('sessionRequestEvents').doc(), {
        schemaVersion: 1,
        requestId,
        sessionId: typeof data.sessionId === 'string' ? data.sessionId : '',
        type: 'rejected',
        reason,
        createdAt: FieldValue.serverTimestamp(),
        createdBy: actor.uid,
      })
      if (typeof data.accountUid === 'string' && /^[A-Za-z0-9_-]+$/.test(data.accountUid)) {
        const notificationReference = db.doc(`users/${data.accountUid}/notifications/pt-session-request-${requestId}-rejected`)
        transaction.create(notificationReference, {
          id: notificationReference.id,
          userId: data.accountUid,
          title: data.type === 'additional' ? 'Yêu cầu thêm buổi chưa được duyệt' : data.type === 'cancel' ? 'Yêu cầu hủy ca chưa được duyệt' : 'Yêu cầu đổi ca chưa được duyệt',
          message: reason,
          type: 'pt_schedule',
          category: 'workout',
          actionUrl: '#/schedule',
          dedupeKey: notificationReference.id,
          read: false,
          createdAt: FieldValue.serverTimestamp(),
        })
      }
      return { unchanged: false, status: 'rejected' }
    })
  })

  return {
    listPtOperationsRequests,
    getMySessionChangeSuggestions,
    getMyAdditionalSessionSuggestions,
    createMyAdditionalSessionRequest,
    createMySessionRequest,
    confirmSessionAttendance,
    recordSessionAttendance,
    correctTeachingShift,
    bulkRecordSessionAttendance,
    cancelSession,
    rescheduleSession,
    swapSessions,
    approveSessionRequest,
    rejectSessionRequest,
    createMyContractPauseRequest,
    approveContractPauseRequest,
    rejectContractPauseRequest,
  }
}

module.exports = {
  autoConfirmOverduePtAttendance,
  chargeDuePtSessions,
  chargeSessionTransaction,
  commitAutomationSessionPage,
  completeSessionAttendanceTransaction,
  createSessionOperationFunctions,
  readAutomationSessionPage,
  recordSessionAttendanceTransaction,
  remindUnconfirmedPtAttendance,
}
