const { FieldValue } = require('firebase-admin/firestore')
const { HttpsError } = require('firebase-functions/v2/https')
const { trustedAccessContext, requireCapability } = require('./identity-access')
const { ptRevenueRecognitionWrite } = require('./finance-recognition')
const {
  addDateDays,
  assertSessionChangeDeadline,
  assertWeeklyOffDeadline,
  contractDurationMonths,
  inclusiveDateDays,
  offRegistrationLimit,
  policyUsageDecision,
  storedDateShape,
  vietnamDateKey,
  vietnamMonthKey,
} = require('./pt-policy')

const DAILY_SESSION_QUERY_LIMIT = 200
const REQUEST_QUERY_LIMIT = 200
const PAUSE_SESSION_QUERY_LIMIT = 200

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

async function completeSessionAttendanceTransaction({
  db,
  sessionId,
  expectedRevision,
  actorUid,
  assertSessionScope = () => {},
  timeZone = 'Asia/Ho_Chi_Minh',
}) {
  const sessionReference = db.doc(`sessions/${sessionId}`)
  return db.runTransaction(async (transaction) => {
    const sessionSnapshot = await transaction.get(sessionReference)
    if (!sessionSnapshot.exists) throw new HttpsError('not-found', 'Không tìm thấy buổi tập.')
    const session = sessionSnapshot.data()
    await assertSessionScope(session)
    const revision = Number(session.revision || 0)

    // A retry after a successful transaction is safe even when it carries the
    // previous revision. The completed session itself is the idempotency gate.
    if (session.status === 'completed' && session.attendanceEventId) {
      return { unchanged: true, revision, attendanceEventId: session.attendanceEventId }
    }
    if (revision !== expectedRevision) throw new HttpsError('aborted', 'Buổi tập đã thay đổi. Hãy tải lại.')
    if (!isActiveSessionStatus(session.status)) throw new HttpsError('failed-precondition', 'Chỉ buổi đang lên lịch mới được xác nhận.')

    const contractId = linkedContractId(session)
    const contractReference = db.doc(`contracts/${contractId}`)
    const attendanceReference = db.doc(`attendanceEvents/${sessionId}`)
    const recognitionReference = db.doc(`ledgerEntries/pt_session_${sessionId}`)
    const contractSnapshot = await transaction.get(contractReference)
    const attendanceSnapshot = await transaction.get(attendanceReference)
    const recognitionSnapshot = await transaction.get(recognitionReference)

    if (!contractSnapshot.exists) throw new HttpsError('failed-precondition', 'Hợp đồng liên kết không tồn tại.')
    const contract = contractSnapshot.data()
    if (contract.studentId !== session.studentId) throw new HttpsError('failed-precondition', 'Hợp đồng không thuộc học viên của buổi tập.')
    if (contract.status !== 'active') throw new HttpsError('failed-precondition', 'Hợp đồng liên kết không ở trạng thái hoạt động.')
    const sessionDate = storedDateKey(session.date, 'Ngày của buổi tập')
    const contractStart = storedContractDate(contract.startDate, 'Ngày bắt đầu')
    const contractEnd = storedContractDate(contract.endDate, 'Ngày kết thúc')
    if (sessionDate < contractStart || sessionDate > contractEnd) {
      throw new HttpsError('failed-precondition', 'Ngày tập nằm ngoài thời hạn hợp đồng liên kết.')
    }
    if (attendanceSnapshot.exists) {
      throw new HttpsError('already-exists', 'Sự kiện điểm danh đã tồn tại nhưng buổi tập chưa đồng bộ. Cần đối soát trước khi thử lại.')
    }
    const attendedClasses = Array.isArray(contract.attendedClasses) ? contract.attendedClasses : []
    if (attendedClasses.includes(sessionId)) throw new HttpsError('already-exists', 'Buổi tập đã được tính trong hợp đồng.')
    if (Number(contract.usedSessions || 0) >= Number(contract.totalSessions || 0)) throw new HttpsError('failed-precondition', 'Hợp đồng đã hết buổi.')

    const recognition = ptRevenueRecognitionWrite({
      sessionId,
      session,
      contractId,
      contract,
      attendanceEventId: attendanceReference.id,
      actorUid,
    })
    transaction.create(attendanceReference, {
      schemaVersion: 1,
      type: 'attended',
      sessionId,
      studentId: session.studentId,
      trainerId: session.trainerId,
      contractId,
      occurredAt: FieldValue.serverTimestamp(),
      createdAt: FieldValue.serverTimestamp(),
      createdBy: actorUid,
      timeZone,
    })
    transaction.update(sessionReference, {
      status: 'completed',
      attendanceEventId: attendanceReference.id,
      completedAt: FieldValue.serverTimestamp(),
      revision: revision + 1,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: actorUid,
    })
    transaction.update(contractReference, {
      usedSessions: FieldValue.increment(1),
      attendedClasses: FieldValue.arrayUnion(sessionId),
      updatedAt: FieldValue.serverTimestamp(),
    })
    if (recognition && !recognitionSnapshot.exists) transaction.create(recognitionReference, recognition)
    return {
      unchanged: false,
      revision: revision + 1,
      attendanceEventId: attendanceReference.id,
      recognitionEntryId: recognition && !recognitionSnapshot.exists ? recognitionReference.id : null,
    }
  })
}

async function adminActor(request, db) {
  const actor = await trustedAccessContext(request, db)
  requireCapability(actor, 'pt.operations.manage')
  return actor
}

function createSessionOperationFunctions({ db, onCall, authorizeAdmin = adminActor, authorizeStudent = studentActor, now = () => new Date() }) {
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

    return db.runTransaction(async (transaction) => {
      const [existingRequest, sessionSnapshot, requestsForSession, usageSnapshot] = await Promise.all([
        transaction.get(requestReference),
        transaction.get(sessionReference),
        transaction.get(db.collection('sessionRequests').where('sessionId', '==', sessionId).limit(20)),
        transaction.get(policyUsageReference(db, studentId, monthKey)),
      ])
      if (existingRequest.exists) {
        const existing = existingRequest.data()
        return {
          unchanged: true,
          requestId: existingRequest.id,
          status: existing.status,
          policyMonth: existing.policyMonth,
          expectedSequence: existing.expectedPolicySequence,
          expectedCountsTowardContract: existing.expectedCountsTowardContract === true,
        }
      }
      if (!sessionSnapshot.exists) throw new HttpsError('not-found', 'Không tìm thấy buổi tập.')
      const session = sessionSnapshot.data()
      const revision = Number(session.revision || 0)
      if (revision !== expectedRevision) throw new HttpsError('aborted', 'Buổi tập đã thay đổi. Hãy tải lại trước khi gửi yêu cầu.')
      if (!isActiveSessionStatus(session.status)) throw new HttpsError('failed-precondition', 'Chỉ buổi đang lên lịch mới được đổi hoặc hủy.')
      if (session.studentId !== studentId) throw new HttpsError('permission-denied', 'Bạn không thể thay đổi lịch của học viên khác.')
      if (requestsForSession.size >= 20) throw new HttpsError('resource-exhausted', 'Buổi tập có quá nhiều yêu cầu lịch sử để xác minh an toàn.')
      if (requestsForSession.docs.some((item) => item.data().status === 'pending')) {
        throw new HttpsError('already-exists', 'Buổi tập này đã có một yêu cầu đang chờ xử lý.')
      }

      const originalDate = storedDateKey(session.date, 'Ngày của buổi tập')
      const originalHour = storedSessionHour(session.hour, sessionId, 'Giờ của buổi tập')
      let deadlineAt
      try {
        deadlineAt = assertSessionChangeDeadline(originalDate, originalHour, submittedAt)
      } catch (error) {
        throw policyFailure(error)
      }

      let newDate = null
      let newHour = null
      if (requestType === 'reschedule') {
        newDate = date(request.data?.newDate)
        newHour = hour(request.data?.newHour)
        try {
          assertSessionChangeDeadline(newDate, newHour, submittedAt)
        } catch {
          throw new HttpsError('failed-precondition', 'Giờ tập mới phải còn ở tương lai ít nhất 12 giờ.')
        }
      }

      const contractId = linkedContractId(session)
      const approvedCount = Number(usageSnapshot.data()?.approvedChangeCancelCount || 0)
      const expectedDecision = policyUsageDecision(approvedCount)
      transaction.create(requestReference, {
        schemaVersion: 2,
        policyVersion: 'pt-change-cancel-v1',
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
        reason,
        status: 'pending',
        policyMonth: monthKey,
        deadlineAt: deadlineAt.toISOString(),
        submittedAtIso: submittedAt.toISOString(),
        expectedPolicySequence: expectedDecision.sequence,
        expectedCountsTowardContract: expectedDecision.countsTowardContract,
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
    })
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
      transaction.update(reference, { status: cancellationType, cancellationReason: reason, revision: revision + 1, cancelledAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(), updatedBy: actor.uid })
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
      const [trainerDay, studentDay] = await Promise.all([
        transaction.get(dailySessionsQuery(db, 'trainerId', trainerId, newDate)),
        transaction.get(dailySessionsQuery(db, 'studentId', session.studentId, newDate)),
      ])
      if (activeHourDocuments(trainerDay, newHour, [sessionId]).length >= 2) throw new HttpsError('resource-exhausted', 'Khung giờ của HLV đã đủ hai học viên.')
      if (activeHourDocuments(studentDay, newHour, [sessionId]).length > 0) throw new HttpsError('already-exists', 'Học viên đã có buổi tập khác trong khung giờ này.')
      transaction.update(reference, { previousSchedule: FieldValue.arrayUnion({ date: session.date, hour: session.hour ?? null, trainerId: session.trainerId, changedAt: new Date().toISOString() }), date: newDate, hour: newHour, trainerId, status: 'scheduled', rescheduledAt: FieldValue.serverTimestamp(), revision: revision + 1, updatedAt: FieldValue.serverTimestamp(), updatedBy: actor.uid })
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
      transaction.update(firstReference, { ...secondSlot, status: 'scheduled', revision: firstRevision + 1, updatedAt: FieldValue.serverTimestamp(), updatedBy: actor.uid })
      transaction.update(secondReference, { ...firstSlot, status: 'scheduled', revision: secondRevision + 1, updatedAt: FieldValue.serverTimestamp(), updatedBy: actor.uid })
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

      let policyMonth = ''
      let usageReference = null
      let usageSnapshot = null
      let policyDecision = { sequence: 0, complimentary: true, countsTowardContract: false }
      if (requestedBy === 'student') {
        const submittedAt = requestInstant(requestData.createdAt, requestData.submittedAtIso)
        if (!submittedAt) throw new HttpsError('failed-precondition', 'Yêu cầu cũ thiếu thời gian gửi. Hãy từ chối và để học viên tạo lại yêu cầu.')
        try {
          assertSessionChangeDeadline(originalDate, originalHour, submittedAt)
        } catch (error) {
          throw policyFailure(error)
        }
        policyMonth = /^\d{4}-\d{2}$/.test(requestData.policyMonth || '')
          ? requestData.policyMonth
          : vietnamMonthKey(submittedAt)
        usageReference = policyUsageReference(db, session.studentId, policyMonth)
        usageSnapshot = await transaction.get(usageReference)
        policyDecision = policyUsageDecision(Number(usageSnapshot.data()?.approvedChangeCancelCount || 0))
      }

      let newDate = ''
      let newHour = 0
      let trainerId = ''
      let trainerDay = null
      let studentDay = null
      if (requestType === 'reschedule') {
        newDate = date(requestData.newDate)
        newHour = hour(requestData.newHour)
        trainerId = id(session.trainerId, 'Mã HLV')
        if (Number(contract.usedSessions || 0) >= Number(contract.totalSessions || 0)) throw new HttpsError('failed-precondition', 'Hợp đồng đã hết buổi nên không thể xếp lịch bù.')
        if (newDate < contractStart || newDate > contractEnd) throw new HttpsError('failed-precondition', 'Lịch mới nằm ngoài thời hạn hợp đồng.')
        ;[trainerDay, studentDay] = await Promise.all([
          transaction.get(dailySessionsQuery(db, 'trainerId', trainerId, newDate)),
          transaction.get(dailySessionsQuery(db, 'studentId', session.studentId, newDate)),
        ])
      }

      let policyAttendanceReference = null
      let policyRecognitionReference = null
      let policyRecognition = null
      if (policyDecision.countsTowardContract) {
        if (Number(contract.usedSessions || 0) >= Number(contract.totalSessions || 0)) throw new HttpsError('failed-precondition', 'Hợp đồng đã hết buổi nên không thể ghi nhận thêm lượt đổi/hủy có tính buổi.')
        const chargeId = `policy_${requestId}`
        policyAttendanceReference = db.doc(`attendanceEvents/${chargeId}`)
        policyRecognitionReference = db.doc(`ledgerEntries/pt_policy_${requestId}`)
        const [attendanceSnapshot, recognitionSnapshot] = await Promise.all([
          transaction.get(policyAttendanceReference),
          transaction.get(policyRecognitionReference),
        ])
        if (attendanceSnapshot.exists || recognitionSnapshot.exists) throw new HttpsError('already-exists', 'Lượt tính buổi của yêu cầu đã tồn tại nhưng trạng thái chưa đồng bộ. Cần đối soát trước khi duyệt lại.')
        policyRecognition = ptRevenueRecognitionWrite({
          sessionId: chargeId,
          session: { ...session, date: originalDate },
          contractId,
          contract,
          attendanceEventId: chargeId,
          actorUid: actor.uid,
        })
        if (policyRecognition) {
          policyRecognition = {
            ...policyRecognition,
            recognitionPolicy: 'scheduled_change_charge_v1',
            sourceSessionId: sessionId,
            sessionRequestId: requestId,
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
        if (activeHourDocuments(trainerDay, newHour, [sessionId]).length >= 2) throw new HttpsError('resource-exhausted', 'Khung giờ của HLV đã đủ hai học viên.')
        if (activeHourDocuments(studentDay, newHour, [sessionId]).length > 0) throw new HttpsError('already-exists', 'Học viên đã có buổi tập khác trong khung giờ này.')
        transaction.update(sessionReference, {
          previousSchedule: FieldValue.arrayUnion({ date: session.date, hour: session.hour ?? null, trainerId: session.trainerId, changedAt: new Date().toISOString() }),
          date: newDate,
          hour: newHour,
          trainerId,
          status: 'scheduled',
          approvedRequestId: requestId,
          rescheduledAt: FieldValue.serverTimestamp(),
          revision: nextRevision,
          updatedAt: FieldValue.serverTimestamp(),
          updatedBy: actor.uid,
          policyMonth: policyMonth || null,
          policySequence: policyDecision.sequence || null,
          previousSlotCountsTowardContract: policyDecision.countsTowardContract,
        })
        transaction.create(eventReference, { schemaVersion: 2, sessionId, requestId, type: 'rescheduled', from: { date: session.date, hour: session.hour ?? null, trainerId: session.trainerId }, to: { date: newDate, hour: newHour, trainerId }, policyMonth: policyMonth || null, policySequence: policyDecision.sequence || null, previousSlotCountsTowardContract: policyDecision.countsTowardContract, createdAt: FieldValue.serverTimestamp(), createdBy: actor.uid })
      }

      if (requestedBy === 'student') {
        const usageWrite = {
          schemaVersion: 1,
          studentId: session.studentId,
          monthKey: policyMonth,
          approvedChangeCancelCount: policyDecision.sequence,
          complimentaryUsed: true,
          lastRequestId: requestId,
          updatedAt: FieldValue.serverTimestamp(),
          updatedBy: actor.uid,
        }
        if (usageSnapshot.exists) transaction.update(usageReference, usageWrite)
        else transaction.create(usageReference, { ...usageWrite, createdAt: FieldValue.serverTimestamp() })
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
          updatedAt: FieldValue.serverTimestamp(),
        })
        if (policyRecognition) transaction.create(policyRecognitionReference, policyRecognition)
      }

      transaction.update(requestReference, {
        status: 'approved',
        approvedAt: FieldValue.serverTimestamp(),
        approvedBy: actor.uid,
        requestedBy,
        policyVersion: 'pt-change-cancel-v1',
        policyMonth: policyMonth || null,
        policySequence: policyDecision.sequence || null,
        complimentary: policyDecision.complimentary,
        countsTowardContract: policyDecision.countsTowardContract,
        processedSessionRevision: nextRevision,
        revision: Number(requestData.revision || 0) + 1,
      })
      return {
        unchanged: false,
        status: 'approved',
        type: requestType,
        revision: nextRevision,
        policyMonth: policyMonth || null,
        policySequence: policyDecision.sequence || null,
        complimentary: policyDecision.complimentary,
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
    if (type === 'off' && durationDays > 14) throw new HttpsError('failed-precondition', 'OFF tối đa 14 ngày mỗi lần. Khoảng dài hơn phải đăng ký bảo lưu.', { issueCode: 'PRESERVATION_REQUIRED' })
    if (type === 'preservation' && durationDays <= 14) throw new HttpsError('failed-precondition', 'Khoảng nghỉ từ 14 ngày trở xuống hãy đăng ký OFF.', { issueCode: 'USE_OFF_REQUEST' })
    if (durationDays > 366) throw new HttpsError('invalid-argument', 'Một yêu cầu bảo lưu tối đa 366 ngày.')

    const submittedAt = now()
    if (startDate < vietnamDateKey(submittedAt)) throw new HttpsError('failed-precondition', 'Ngày bắt đầu OFF hoặc bảo lưu không được nằm trong quá khứ.')
    const requestReference = db.doc(`leaveRequests/student-${actor.uid}-${idempotencyKey}`)
    const contractReference = db.doc(`contracts/${contractId}`)
    return db.runTransaction(async (transaction) => {
      const [existingRequest, contractSnapshot] = await Promise.all([
        transaction.get(requestReference),
        transaction.get(contractReference),
      ])
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
      const offLimit = offRegistrationLimit(durationMonths)
      const offUsedOrPending = activeRequests.filter(isOffPauseRequest).length
      let cutoffAt = null
      if (type === 'off') {
        if (offUsedOrPending >= offLimit) throw new HttpsError('failed-precondition', `Hợp đồng ${durationMonths} tháng đã dùng hết ${offLimit} lượt OFF. Hãy đăng ký bảo lưu nếu cần nghỉ dài hơn.`, { issueCode: 'OFF_ALLOWANCE_EXHAUSTED' })
        try {
          cutoffAt = assertWeeklyOffDeadline(startDate, submittedAt).toISOString()
        } catch (error) {
          throw policyFailure(error)
        }
      }

      transaction.create(requestReference, {
        schemaVersion: 2,
        policyVersion: 'pt-contract-pause-v1',
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
      // Legacy leave requests did not store a type. Infer it conservatively from
      // the approved duration so old pending data remains processable.
      const type = requestData.type === 'off' || requestData.type === 'preservation'
        ? pauseRequestType(requestData.type)
        : durationDays <= 14 ? 'off' : 'preservation'
      if (type === 'off' && durationDays > 14) throw new HttpsError('failed-precondition', 'OFF vượt quá 14 ngày; yêu cầu phải được tạo lại dưới dạng bảo lưu.')
      if (type === 'preservation' && durationDays <= 14) throw new HttpsError('failed-precondition', 'Khoảng nghỉ này phải được tạo dưới dạng OFF.')
      if (type === 'off') {
        const submittedAt = requestInstant(requestData.createdAt, requestData.submittedAtIso)
        if (!submittedAt) throw new HttpsError('failed-precondition', 'Yêu cầu OFF cũ thiếu thời gian gửi. Hãy từ chối và để học viên tạo lại yêu cầu.')
        try {
          assertWeeklyOffDeadline(startDate, submittedAt)
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
      const offLimit = offRegistrationLimit(durationMonths)
      const approvedOffCount = otherApproved.filter(isOffPauseRequest).length
      if (type === 'off' && approvedOffCount >= offLimit) throw new HttpsError('failed-precondition', `Hợp đồng ${durationMonths} tháng đã đủ ${offLimit} lượt OFF.`)

      const oldEndDate = storedContractDate(contract.endDate, 'Ngày kết thúc')
      const nextEndDateKey = addDateDays(oldEndDate, durationDays)
      const newEndDate = storedDateShape(contract.endDate, nextEndDateKey)
      const activeSessions = sessionsSnapshot.docs.filter((item) => isActiveSessionStatus(item.data().status))
      activeSessions.forEach((item) => {
        const session = item.data()
        transaction.update(item.ref, {
          status: 'student_cancelled',
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
        policyVersion: 'pt-contract-pause-v1',
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
      return { unchanged: false, status: 'rejected' }
    })
  })

  return {
    createMySessionRequest,
    confirmSessionAttendance,
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

module.exports = { completeSessionAttendanceTransaction, createSessionOperationFunctions }
