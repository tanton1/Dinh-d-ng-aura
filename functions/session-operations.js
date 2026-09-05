const { FieldValue, Timestamp } = require('firebase-admin/firestore')
const { HttpsError } = require('firebase-functions/v2/https')
const { createHash } = require('node:crypto')
const { trustedAccessContext, requireCapability } = require('./identity-access')
const { ptRevenueRecognitionWrite } = require('./finance-recognition')
const { serviceRevenueJournal } = require('./accounting-core')
const {
  addDateDays,
  assertSessionChangeDeadline,
  assertWeeklyOffDeadline,
  contractDurationMonths,
  inclusiveDateDays,
  normalizedPtOperationsPolicy,
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
const AUTO_ATTENDANCE_LOOKBACK_DAYS = 8
const BULK_ATTENDANCE_LIMIT = 30
const TEACHING_SHIFT_CORRECTION_LIMIT = 6
const NO_SHOW_GRACE_MINUTES = 15
const OPERATIONS_REQUEST_HISTORY_LIMIT = 500
const SESSION_CHANGE_SUGGESTION_LIMIT = 18
const SESSION_CHANGE_WINDOW_DAYS = 21
const SESSION_CHANGE_DATA_LIMIT = 2000
const ATTENDANCE_STATUSES = new Set(['present', 'late', 'no_show'])
const NO_SHOW_REASONS = new Set(['', 'busy', 'sick', 'forgot', 'unreachable', 'other'])
const BILLING_REVIEW_STATUS = 'review_required'

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
  const candidate = value instanceof Date ? value : new Date(value || fallbackValue || '')
  return Number.isNaN(candidate.getTime()) ? null : candidate
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

function sessionChangeCandidateId({ sessionId, revision, date: targetDate, hour: targetHour, trainerId }) {
  return createHash('sha256')
    .update(`${sessionId}|${revision}|${targetDate}|${targetHour}|${trainerId}`)
    .digest('hex')
    .slice(0, 32)
}

async function readOperationsPolicy(db) {
  const [snapshot] = await db.getAll(db.doc('settings/scheduleConfig'))
  return normalizedPtOperationsPolicy(snapshot?.exists ? snapshot.data() : {})
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
  const [trainersSnapshot, sessionsSnapshot, leavesSnapshot, ...availabilitySnapshots] = await Promise.all([
    db.collection('trainers').where('branchId', '==', branchId).limit(201).get(),
    db.collection('sessions').where('date', '>=', rangeStart).where('date', '<', addDateDays(rangeEnd, 1)).limit(SESSION_CHANGE_DATA_LIMIT + 1).get(),
    db.collection('leaveRequests').where('status', '==', 'approved').limit(1001).get(),
    ...availabilityReferences.map((reference) => db.getAll(reference).then((values) => values[0])),
  ])
  if (trainersSnapshot.size > 200 || leavesSnapshot.size > 1000) throw new HttpsError('resource-exhausted', 'Dữ liệu PT hoặc OFF vượt giới hạn gợi ý an toàn.')
  const sessions = activeSessionRows(sessionsSnapshot, sessionId)
  const availabilityByWeek = new Map(availabilitySnapshots.filter((item) => item?.exists).map((item) => [item.id.slice(-(10)), item.data()]))
  const assignedTrainerIds = new Set([
    session.trainerId,
    contract.trainerId,
    ...(Array.isArray(contract.trainerIds) ? contract.trainerIds : []),
  ].filter(Boolean))
  const trainers = trainersSnapshot.docs.map((item) => ({ id: item.id, ...item.data() }))
    .filter((trainer) => trainer.status !== 'inactive')
    .filter((trainer) => assignedTrainerIds.has(trainer.id) || trainerPolicy(trainer).employmentType === 'full_time')
  const studentTrainingDates = new Set(sessions.filter((item) => item.studentId === studentId).map((item) => storedDateKey(item.date, 'Ngày buổi liên quan')))
  const candidates = []

  for (let targetDate = rangeStart; targetDate <= rangeEnd; targetDate = addDateDays(targetDate, 1)) {
    if (pauseCoversDate(contract, targetDate)) continue
    const dayCode = dayCodeForDate(targetDate)
    if (dayCode === 'CN') continue
    const weekly = availabilityByWeek.get(mondayForDate(targetDate))
    const weeklyReady = weekly && ['submitted', 'locked', 'recurring'].includes(weekly.status)
    const studentSlots = weeklyReady && Array.isArray(weekly.slots)
      ? weekly.slots
      : student.isScheduleConfirmed === true && Array.isArray(student.availableSlots)
        ? student.availableSlots
        : []
    if (!studentSlots.length) continue

    for (const trainer of trainers) {
      const policyData = trainerPolicy(trainer)
      const trainerSlots = Array.isArray(trainer.availableSlots) ? trainer.availableSlots : []
      if (!trainerSlots.length) continue
      const trainerOnLeave = leavesSnapshot.docs.some((item) => {
        const leave = item.data()
        const start = typeof leave.startDate === 'string' ? leave.startDate.slice(0, 10) : ''
        const end = typeof leave.endDate === 'string' ? leave.endDate.slice(0, 10) : start
        return leave.trainerId === trainer.id && start && end && targetDate >= start && targetDate <= end
      })
      if (trainerOnLeave) continue
      const assigned = assignedTrainerIds.has(trainer.id)
      for (let targetHour = 0; targetHour <= 23; targetHour += 1) {
        const slotId = `${dayCode}-${targetHour}`
        if (!studentSlots.includes(slotId) || !trainerSlots.includes(slotId)) continue
        if (targetDate === storedDateKey(session.date, 'Ngày buổi gốc') && targetHour === storedSessionHour(session.hour, sessionId, 'Giờ buổi gốc') && trainer.id === session.trainerId) continue
        const slotStart = new Date(`${targetDate}T${String(targetHour).padStart(2, '0')}:00:00+07:00`)
        if (slotStart.getTime() - now.getTime() < policy.sessionChangeDeadlineHours * 60 * 60 * 1000) continue
        if (sessions.some((item) => item.studentId === studentId && storedDateKey(item.date, 'Ngày lịch học viên') === targetDate && storedSessionHour(item.hour, item.id, 'Giờ lịch học viên') === targetHour)) continue
        const sameTrainerDate = sessions.filter((item) => item.trainerId === trainer.id && storedDateKey(item.date, 'Ngày lịch PT') === targetDate)
        const atSlot = sameTrainerDate.filter((item) => storedSessionHour(item.hour, item.id, 'Giờ lịch PT') === targetHour)
        const occupancy = new Set(atSlot.map((item) => item.studentId)).size
        const capacity = normalizedTrainerCapacity(trainer.slotCapacity)
        if (occupancy >= capacity) continue
        const uniqueTeachingSlots = new Set(sameTrainerDate.map((item) => storedSessionHour(item.hour, item.id, 'Giờ lịch PT'))).size
        const pairsExistingSession = occupancy > 0
        const createsThreeConsecutiveDays = hasThreeConsecutiveTrainingDays(studentTrainingDates, targetDate)
        const daysFromStart = inclusiveDateDays(rangeStart, targetDate) - 1
        const score = (pairsExistingSession ? 20000 : 0)
          + (assigned ? 6000 : 0)
          + (trainer.id === session.trainerId ? 2500 : 0)
          + (policyData.employmentType === 'full_time' ? 1800 : 0)
          + Math.max(0, policyData.dailySessionTarget - uniqueTeachingSlots) * 180
          - policyData.schedulingPriority
          - uniqueTeachingSlots * 25
          - daysFromStart * 5
          - (createsThreeConsecutiveDays ? 3500 : 0)
        candidates.push({
          candidateId: sessionChangeCandidateId({ sessionId, revision, date: targetDate, hour: targetHour, trainerId: trainer.id }),
          date: targetDate,
          hour: targetHour,
          trainerId: trainer.id,
          trainerName: optionalText(trainer.name, 160) || 'PT chưa cập nhật tên',
          occupancy,
          capacity,
          pairsExistingSession,
          isAssignedTrainer: assigned,
          isCurrentTrainer: trainer.id === session.trainerId,
          employmentType: policyData.employmentType,
          dailyLoad: uniqueTeachingSlots,
          dailyTarget: policyData.dailySessionTarget,
          createsThreeConsecutiveDays,
          score,
        })
      }
    }
  }
  candidates.sort((left, right) => right.score - left.score || left.date.localeCompare(right.date) || left.hour - right.hour || left.trainerName.localeCompare(right.trainerName, 'vi'))
  return {
    policy,
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
    if (!contractSnapshot.exists) throw new HttpsError('failed-precondition', 'Hợp đồng liên kết không tồn tại.')
    const contract = contractSnapshot.data()
    if (contract.studentId !== session.studentId) throw new HttpsError('failed-precondition', 'Hợp đồng không thuộc học viên của buổi tập.')
    if (!['active', 'expired'].includes(contract.status)) throw new HttpsError('failed-precondition', 'Hợp đồng liên kết không ở trạng thái có thể đối soát.')
    const sessionDate = storedDateKey(session.date, 'Ngày của buổi tập')
    const contractStart = storedContractDate(contract.startDate, 'Ngày bắt đầu')
    const contractEnd = storedContractDate(contract.endDate, 'Ngày kết thúc')
    if (sessionDate < contractStart || sessionDate > contractEnd) {
      throw new HttpsError('failed-precondition', 'Ngày tập nằm ngoài thời hạn hợp đồng liên kết.')
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
      throw new HttpsError('already-exists', 'Buổi tập đã được tính trong hợp đồng nhưng thiếu sổ sự kiện. Cần đối soát trước khi thử lại.')
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
        throw new HttpsError('already-exists', 'Bản ghi hiện diện đã tồn tại nhưng chưa có sổ tính buổi. Cần đối soát trước khi thử lại.')
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
      if (!billingIssueSnapshot.exists) transaction.create(billingIssueReference, {
        schemaVersion: 1,
        status: 'open',
        issueCode: 'CONTRACT_QUOTA_EXHAUSTED',
        sessionId,
        studentId: session.studentId,
        trainerId: session.trainerId || '',
        contractId,
        scheduledAt: startsAtTimestamp,
        usedSessions: Number(contract.usedSessions || 0),
        totalSessions: Number(contract.totalSessions || 0),
        createdAt: FieldValue.serverTimestamp(),
        createdBy: actorUid,
      })
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
      throw new HttpsError('already-exists', 'Bản ghi hiện diện đã tồn tại nhưng chưa có sổ tính buổi. Cần đối soát trước khi thử lại.')
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

async function chargeDuePtSessions({ db, now = new Date(), logger = console, limit = AUTOMATIC_CHARGE_QUERY_LIMIT }) {
  const today = vietnamDateKey(now)
  const weekStart = vietnamWeekStartDateKey(now)
  const snapshot = await db.collection('sessions')
    .where('date', '>=', weekStart)
    .where('date', '<', nextDateKey(today))
    .limit(Math.min(AUTOMATIC_CHARGE_QUERY_LIMIT, Math.max(1, Number(limit) || AUTOMATIC_CHARGE_QUERY_LIMIT)))
    .get()
  const candidates = snapshot.docs.filter((item) => {
    const session = item.data()
    if (!isActiveSessionStatus(session.status) || isSessionCharged(session) || [BILLING_REVIEW_STATUS, 'exempt'].includes(session.billingStatus)) return false
    try { return sessionStartInstant(session, item.id).getTime() <= now.getTime() } catch { return false }
  })
  const summary = { weekStart, through: today, scanned: snapshot.size, due: candidates.length, charged: 0, reviewRequired: 0, unchanged: 0, failed: 0 }
  for (let index = 0; index < candidates.length; index += 25) {
    const batch = candidates.slice(index, index + 25)
    const outcomes = await Promise.allSettled(batch.map((item) => chargeSessionTransaction({
      db,
      sessionId: item.id,
      actorUid: 'system:auto-charge',
      now,
    })))
    outcomes.forEach((outcome, outcomeIndex) => {
      if (outcome.status === 'fulfilled') {
        if (outcome.value.unchanged) summary.unchanged += 1
        else if (outcome.value.billingReviewRequired) summary.reviewRequired += 1
        else summary.charged += 1
      } else {
        summary.failed += 1
        logger.warn?.('PT session automatic charge failed', {
          sessionId: batch[outcomeIndex].id,
          code: outcome.reason?.code || 'unknown',
        })
      }
    })
  }
  logger.info?.('PT automatic charge completed', summary)
  return summary
}

async function autoConfirmOverduePtAttendance({ db, now = new Date(), logger = console, limit = AUTOMATIC_CHARGE_QUERY_LIMIT }) {
  const today = vietnamDateKey(now)
  const from = addDateDays(today, -AUTO_ATTENDANCE_LOOKBACK_DAYS)
  const snapshot = await db.collection('sessions')
    .where('date', '>=', from)
    .where('date', '<', nextDateKey(today))
    .limit(Math.min(AUTOMATIC_CHARGE_QUERY_LIMIT, Math.max(1, Number(limit) || AUTOMATIC_CHARGE_QUERY_LIMIT)))
    .get()
  const candidates = snapshot.docs.filter((item) => {
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
    scanned: snapshot.size,
    overdue: candidates.length,
    confirmedPresent: 0,
    unchanged: 0,
    failed: 0,
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
        })
      }
    })
  }
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

function createSessionOperationFunctions({ db, onCall, authorizeAdmin = adminActor, authorizeStudent = studentActor, now = () => new Date() }) {
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
        type: item.type === 'cancel' ? 'cancel' : 'reschedule',
        sessionId: optionalText(item.sessionId, 128),
        sessionRevision: Number(session.revision || 0),
        trainerId,
        trainerName: optionalText(trainer.name, 160) || 'PT chưa xác định',
        requestedBy: item.requestedBy === 'trainer' ? 'trainer' : 'student',
        originalDate: optionalText(item.originalDate, 10),
        originalHour: Number.isInteger(item.originalHour) ? item.originalHour : Number.isInteger(session.hour) ? session.hour : null,
        newDate: optionalText(item.newDate, 10) || null,
        newHour: Number.isInteger(item.newHour) ? item.newHour : null,
        newTrainerId: newTrainerId || null,
        newTrainerName: newTrainerId ? optionalText(newTrainer.name, 160) || 'PT chưa xác định' : null,
        suggestionRank: Number(item.suggestionRank || 0) || null,
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
      schemaVersion: 2,
      sessionId,
      revision: expectedRevision,
      policyMonth: monthKey,
      policy: {
        ...result.policy,
        approvedChangeCancelCount: approvedCount,
        complimentaryRemaining: Math.max(0, result.policy.complimentaryChangeCancelPerMonth - approvedCount),
      },
      suggestions: result.suggestions,
      issueCodes: result.issueCodes,
    }
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
      const transactionPolicy = normalizedPtOperationsPolicy(configSnapshot.exists ? configSnapshot.data() : operationsPolicy)
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

  const correctTeachingShift = onCall(async (request) => {
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

    return db.runTransaction(async (transaction) => {
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
      if (sourceBranchIds.size > 1) {
        throw new HttpsError('failed-precondition', 'Ca nguồn đang chứa nhiều chi nhánh. Hãy đối soát từng buổi trước.', {
          issueCode: 'TEACHING_SHIFT_SOURCE_BRANCH_MISMATCH',
        })
      }
      const sourceBranchId = [...sourceBranchIds][0] || ''
      const targetTrainerBranchIds = new Set([targetTrainer.branchId, ...(Array.isArray(targetTrainer.branchIds) ? targetTrainer.branchIds : [])].map(normaliseSessionBranchId).filter(Boolean))
      if (sourceBranchId && !targetTrainerBranchIds.has(sourceBranchId)) {
        throw new HttpsError('failed-precondition', 'PT thực dạy không thuộc chi nhánh của ca.', {
          issueCode: 'TEACHING_SHIFT_TRAINER_BRANCH_MISMATCH', trainerId: targetTrainerId, branchId: sourceBranchId,
        })
      }
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
      if (existingTargetRows.some((session) => normaliseSessionBranchId(session.branchId) && normaliseSessionBranchId(session.branchId) !== targetBranchId)) {
        throw new HttpsError('failed-precondition', 'PT đã có ca cùng giờ tại chi nhánh khác.', {
          issueCode: 'TEACHING_SHIFT_CROSS_BRANCH_CONFLICT', date: targetDate, hour: targetHour, trainerId: targetTrainerId,
        })
      }
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
          if (session.item.attendanceStatus) Object.assign(attendancePatch, {
            type: session.item.attendanceStatus === 'no_show' ? 'no_show' : 'attended',
            attendanceStatus: session.item.attendanceStatus,
            lateMinutes: session.item.lateMinutes,
            noShowReason: session.item.noShowReason,
            confirmationSource: 'admin_correction',
            confirmedAt: FieldValue.serverTimestamp(),
            confirmedBy: actor.uid,
          })
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
            lateMinutes: session.item.lateMinutes,
            noShowReason: session.item.noShowReason,
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

  const cancelSession = onCall(async (request) => {
    const actor = await authorizeAdmin(request, db)
    const sessionId = id(request.data?.sessionId, 'Mã buổi tập')
    const expectedRevision = sessionRevision(request.data?.expectedRevision)
    const cancellationType = request.data?.type === 'trainer_cancelled' ? 'trainer_cancelled' : 'student_cancelled'
    const reason = typeof request.data?.reason === 'string' ? request.data.reason.trim().slice(0, 500) : ''
    const reference = db.doc(`sessions/${sessionId}`)
    return db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference)
      if (!snapshot.exists) throw new HttpsError('not-found', 'Không tìm thấy buổi tập.')
      const session = snapshot.data()
      const revision = Number(session.revision || 0)
      if (revision !== expectedRevision) throw new HttpsError('aborted', 'Buổi tập đã thay đổi. Hãy tải lại.')
      if (!isActiveSessionStatus(session.status)) throw new HttpsError('failed-precondition', 'Chỉ buổi đang lên lịch mới được hủy.')
      if (isSessionCharged(session)) throw new HttpsError('failed-precondition', 'Buổi đã được tính. Hãy dùng quy trình điều chỉnh có audit thay vì hủy trực tiếp.')
      transaction.update(reference, { status: cancellationType, scheduleStatus: 'cancelled', billingStatus: 'exempt', attendanceStatus: null, cancellationReason: reason, revision: revision + 1, cancelledAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(), updatedBy: actor.uid })
      transaction.create(db.collection('sessionEvents').doc(), { schemaVersion: 1, sessionId, type: cancellationType, reason, createdAt: FieldValue.serverTimestamp(), createdBy: actor.uid })
      return { revision: revision + 1 }
    })
  })

  const rescheduleSession = onCall(async (request) => {
    const actor = await authorizeAdmin(request, db)
    const sessionId = id(request.data?.sessionId, 'Mã buổi tập')
    const newDate = date(request.data?.newDate)
    const newHour = hour(request.data?.newHour)
    const trainerId = id(request.data?.trainerId, 'Mã HLV')
    const expectedRevision = sessionRevision(request.data?.expectedRevision)
    const reference = db.doc(`sessions/${sessionId}`)
    return db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference)
      if (!snapshot.exists) throw new HttpsError('not-found', 'Không tìm thấy buổi tập.')
      const session = snapshot.data()
      const revision = Number(session.revision || 0)
      if (revision !== expectedRevision) throw new HttpsError('aborted', 'Buổi tập đã thay đổi. Hãy tải lại.')
      if (!isActiveSessionStatus(session.status)) throw new HttpsError('failed-precondition', 'Chỉ có thể dời buổi đang lên lịch.')
      if (isSessionCharged(session)) throw new HttpsError('failed-precondition', 'Buổi đã được tính nên không thể dời trực tiếp.')
      const [trainerDay, studentDay] = await Promise.all([
        transaction.get(dailySessionsQuery(db, 'trainerId', trainerId, newDate)),
        transaction.get(dailySessionsQuery(db, 'studentId', session.studentId, newDate)),
      ])
      if (activeHourDocuments(trainerDay, newHour, [sessionId]).length >= 2) throw new HttpsError('resource-exhausted', 'Khung giờ của HLV đã đủ hai học viên.')
      if (activeHourDocuments(studentDay, newHour, [sessionId]).length > 0) throw new HttpsError('already-exists', 'Học viên đã có buổi tập khác trong khung giờ này.')
      transaction.update(reference, { previousSchedule: FieldValue.arrayUnion({ date: session.date, hour: session.hour ?? null, trainerId: session.trainerId, changedAt: new Date().toISOString() }), date: newDate, hour: newHour, trainerId, status: 'scheduled', scheduleStatus: 'rescheduled', billingStatus: 'pending', attendanceStatus: 'pending', rescheduledAt: FieldValue.serverTimestamp(), revision: revision + 1, updatedAt: FieldValue.serverTimestamp(), updatedBy: actor.uid })
      transaction.create(db.collection('sessionEvents').doc(), { schemaVersion: 1, sessionId, type: 'rescheduled', from: { date: session.date, hour: session.hour ?? null, trainerId: session.trainerId }, to: { date: newDate, hour: newHour, trainerId }, createdAt: FieldValue.serverTimestamp(), createdBy: actor.uid })
      return { revision: revision + 1 }
    })
  })

  const swapSessions = onCall(async (request) => {
    const actor = await authorizeAdmin(request, db)
    const firstId = id(request.data?.firstSessionId, 'Buổi thứ nhất')
    const secondId = id(request.data?.secondSessionId, 'Buổi thứ hai')
    const firstExpectedRevision = sessionRevision(request.data?.firstExpectedRevision)
    const secondExpectedRevision = sessionRevision(request.data?.secondExpectedRevision)
    if (firstId === secondId) throw new HttpsError('invalid-argument', 'Hai buổi tập phải khác nhau.')
    const firstReference = db.doc(`sessions/${firstId}`)
    const secondReference = db.doc(`sessions/${secondId}`)
    return db.runTransaction(async (transaction) => {
      const [first, second] = await Promise.all([transaction.get(firstReference), transaction.get(secondReference)])
      if (!first.exists || !second.exists) throw new HttpsError('not-found', 'Không tìm thấy đủ hai buổi tập.')
      const firstData = first.data()
      const secondData = second.data()
      if (!isActiveSessionStatus(firstData.status) || !isActiveSessionStatus(secondData.status)) throw new HttpsError('failed-precondition', 'Chỉ có thể đổi hai buổi đang lên lịch.')
      if (isSessionCharged(firstData) || isSessionCharged(secondData)) throw new HttpsError('failed-precondition', 'Không thể đổi buổi đã được hệ thống tính.')
      const firstRevision = Number(firstData.revision || 0)
      const secondRevision = Number(secondData.revision || 0)
      if (firstRevision !== firstExpectedRevision || secondRevision !== secondExpectedRevision) throw new HttpsError('aborted', 'Một buổi tập đã thay đổi. Hãy tải lại.')
      const firstSlot = { date: storedDateKey(firstData.date, 'Ngày buổi thứ nhất'), hour: storedSessionHour(firstData.hour, firstId, 'Giờ buổi thứ nhất'), trainerId: id(firstData.trainerId, 'HLV buổi thứ nhất') }
      const secondSlot = { date: storedDateKey(secondData.date, 'Ngày buổi thứ hai'), hour: storedSessionHour(secondData.hour, secondId, 'Giờ buổi thứ hai'), trainerId: id(secondData.trainerId, 'HLV buổi thứ hai') }
      const excludedIds = [firstId, secondId]
      const [firstTargetTrainerDay, firstTargetStudentDay, secondTargetTrainerDay, secondTargetStudentDay] = await Promise.all([
        transaction.get(dailySessionsQuery(db, 'trainerId', secondSlot.trainerId, secondSlot.date)),
        transaction.get(dailySessionsQuery(db, 'studentId', firstData.studentId, secondSlot.date)),
        transaction.get(dailySessionsQuery(db, 'trainerId', firstSlot.trainerId, firstSlot.date)),
        transaction.get(dailySessionsQuery(db, 'studentId', secondData.studentId, firstSlot.date)),
      ])
      if (activeHourDocuments(firstTargetTrainerDay, secondSlot.hour, excludedIds).length >= 2 || activeHourDocuments(secondTargetTrainerDay, firstSlot.hour, excludedIds).length >= 2) {
        throw new HttpsError('resource-exhausted', 'Một khung giờ của HLV đã đủ hai học viên.')
      }
      if (activeHourDocuments(firstTargetStudentDay, secondSlot.hour, excludedIds).length > 0 || activeHourDocuments(secondTargetStudentDay, firstSlot.hour, excludedIds).length > 0) {
        throw new HttpsError('already-exists', 'Một học viên đã có buổi tập khác trong khung giờ nhận đổi.')
      }
      transaction.update(firstReference, { ...secondSlot, status: 'scheduled', scheduleStatus: 'rescheduled', billingStatus: 'pending', attendanceStatus: 'pending', revision: firstRevision + 1, updatedAt: FieldValue.serverTimestamp(), updatedBy: actor.uid })
      transaction.update(secondReference, { ...firstSlot, status: 'scheduled', scheduleStatus: 'rescheduled', billingStatus: 'pending', attendanceStatus: 'pending', revision: secondRevision + 1, updatedAt: FieldValue.serverTimestamp(), updatedBy: actor.uid })
      transaction.create(db.collection('sessionEvents').doc(), { schemaVersion: 1, type: 'swapped', sessionIds: [firstId, secondId], createdAt: FieldValue.serverTimestamp(), createdBy: actor.uid })
      return { firstRevision: firstRevision + 1, secondRevision: secondRevision + 1 }
    })
  })

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

      const requestType = requestData.type === 'cancel' ? 'cancel' : requestData.type === 'reschedule' ? 'reschedule' : ''
      if (!requestType) throw new HttpsError('failed-precondition', 'Loại yêu cầu lịch không hợp lệ.')
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
      const operationsPolicy = normalizedPtOperationsPolicy(requestData.policySnapshot || (configSnapshot.exists ? configSnapshot.data() : {}))

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
      let trainerDay = null
      let studentDay = null
      let trainerSnapshot = null
      let studentSnapshot = null
      let availabilitySnapshot = null
      let trainerLeaves = null
      if (requestType === 'reschedule') {
        newDate = date(requestData.newDate)
        newHour = hour(requestData.newHour)
        trainerId = id(requestData.newTrainerId || session.trainerId, 'Mã HLV')
        if (Number(contract.usedSessions || 0) >= Number(contract.totalSessions || 0)) throw new HttpsError('failed-precondition', 'Hợp đồng đã hết buổi nên không thể xếp lịch bù.')
        if (newDate < contractStart || newDate > contractEnd) throw new HttpsError('failed-precondition', 'Lịch mới nằm ngoài thời hạn hợp đồng.')
        if (pauseCoversDate(contract, newDate)) throw new HttpsError('failed-precondition', 'Ngày đề xuất nằm trong thời gian OFF hoặc bảo lưu của hợp đồng.')
        ;[trainerDay, studentDay, trainerSnapshot, studentSnapshot, availabilitySnapshot, trainerLeaves] = await Promise.all([
          transaction.get(dailySessionsQuery(db, 'trainerId', trainerId, newDate)),
          transaction.get(dailySessionsQuery(db, 'studentId', session.studentId, newDate)),
          transaction.get(db.doc(`trainers/${trainerId}`)),
          transaction.get(db.doc(`students/${session.studentId}`)),
          transaction.get(db.doc(`ptAvailability/${session.studentId}_${mondayForDate(newDate)}`)),
          transaction.get(db.collection('leaveRequests').where('status', '==', 'approved').limit(1001)),
        ])
        if (!trainerSnapshot.exists || trainerSnapshot.data().status === 'inactive') throw new HttpsError('failed-precondition', 'PT của ca đề xuất không còn hoạt động.')
        if (!studentSnapshot.exists) throw new HttpsError('failed-precondition', 'Hồ sơ học viên không tồn tại.')
        const trainer = trainerSnapshot.data()
        const expectedBranchId = session.branchId || contract.branchId
        if (expectedBranchId && trainer.branchId !== expectedBranchId) throw new HttpsError('failed-precondition', 'PT của ca đề xuất không thuộc đúng chi nhánh.')
        const assignedTrainerIds = new Set([session.trainerId, contract.trainerId, ...(Array.isArray(contract.trainerIds) ? contract.trainerIds : [])].filter(Boolean))
        if (!assignedTrainerIds.has(trainerId) && trainerPolicy(trainer).employmentType !== 'full_time') {
          throw new HttpsError('failed-precondition', 'Ca thay thế ngoài PT phụ trách chỉ được chọn PT chính thức toàn thời gian.')
        }
        const slotId = `${dayCodeForDate(newDate)}-${newHour}`
        if (!Array.isArray(trainer.availableSlots) || !trainer.availableSlots.includes(slotId)) {
          throw new HttpsError('failed-precondition', 'Ca đề xuất không còn nằm trong lịch rảnh PT đã đăng ký.')
        }
        const weeklyAvailability = availabilitySnapshot.exists ? availabilitySnapshot.data() : null
        const studentData = studentSnapshot.data()
        const studentSlots = weeklyAvailability && ['submitted', 'locked', 'recurring'].includes(weeklyAvailability.status) && Array.isArray(weeklyAvailability.slots)
          ? weeklyAvailability.slots
          : studentData.isScheduleConfirmed === true && Array.isArray(studentData.availableSlots)
            ? studentData.availableSlots
            : []
        if (!studentSlots.includes(slotId)) throw new HttpsError('failed-precondition', 'Ca đề xuất không còn nằm trong lịch rảnh học viên.')
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
        if (activeHourDocuments(studentDay, newHour, [sessionId]).length > 0) throw new HttpsError('already-exists', 'Học viên đã có buổi tập khác trong khung giờ này.')
        transaction.update(sessionReference, {
          previousSchedule: FieldValue.arrayUnion({ date: session.date, hour: session.hour ?? null, trainerId: session.trainerId, changedAt: new Date().toISOString() }),
          date: newDate,
          hour: newHour,
          trainerId,
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
        transaction.create(eventReference, { schemaVersion: 2, sessionId, requestId, type: 'rescheduled', from: { date: session.date, hour: session.hour ?? null, trainerId: session.trainerId }, to: { date: newDate, hour: newHour, trainerId }, policyMonth: policyMonth || null, policySequence: policyDecision.sequence || null, previousSlotCountsTowardContract: policyDecision.countsTowardContract, loyaltyEntitlementId: loyaltyEntitlementReference?.id || null, createdAt: FieldValue.serverTimestamp(), createdBy: actor.uid })
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
      const operationsPolicy = normalizedPtOperationsPolicy(configSnapshot.exists ? configSnapshot.data() : {})
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
      const operationsPolicy = normalizedPtOperationsPolicy(requestData.policySnapshot || (configSnapshot.exists ? configSnapshot.data() : {}))
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
          title: data.type === 'cancel' ? 'Yêu cầu hủy ca chưa được duyệt' : 'Yêu cầu đổi ca chưa được duyệt',
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
  completeSessionAttendanceTransaction,
  createSessionOperationFunctions,
  recordSessionAttendanceTransaction,
  remindUnconfirmedPtAttendance,
}
