const { FieldValue } = require('firebase-admin/firestore')
const { HttpsError } = require('firebase-functions/v2/https')
const { trustedAccessContext, requireCapability } = require('./identity-access')

const DAILY_SESSION_QUERY_LIMIT = 200

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

async function adminActor(request, db) {
  const actor = await trustedAccessContext(request, db)
  requireCapability(actor, 'pt.operations.manage')
  return actor
}

function createSessionOperationFunctions({ db, onCall, authorizeAdmin = adminActor }) {
  const confirmSessionAttendance = onCall(async (request) => {
    const actor = await authorizeAdmin(request, db)
    const sessionId = id(request.data?.sessionId, 'Mã buổi tập')
    const expectedRevision = sessionRevision(request.data?.expectedRevision)
    const sessionReference = db.doc(`sessions/${sessionId}`)
    return db.runTransaction(async (transaction) => {
      const sessionSnapshot = await transaction.get(sessionReference)
      if (!sessionSnapshot.exists) throw new HttpsError('not-found', 'Không tìm thấy buổi tập.')
      const session = sessionSnapshot.data()
      const revision = Number(session.revision || 0)
      if (revision !== expectedRevision) throw new HttpsError('aborted', 'Buổi tập đã thay đổi. Hãy tải lại.')
      if (session.status === 'completed' && session.attendanceEventId) return { unchanged: true, revision }
      if (!isActiveSessionStatus(session.status)) throw new HttpsError('failed-precondition', 'Chỉ buổi đang lên lịch mới được xác nhận.')
      const contracts = await transaction.get(db.collection('contracts').where('studentId', '==', session.studentId).where('status', '==', 'active').limit(5))
      const contract = contracts.docs[0]
      if (!contract) throw new HttpsError('failed-precondition', 'Không có hợp đồng hoạt động.')
      const contractData = contract.data()
      if (Number(contractData.usedSessions || 0) >= Number(contractData.totalSessions || 0)) throw new HttpsError('failed-precondition', 'Hợp đồng đã hết buổi.')
      if (Array.isArray(contractData.attendedClasses) && contractData.attendedClasses.includes(sessionId)) throw new HttpsError('already-exists', 'Buổi tập đã được tính.')
      const eventReference = db.collection('attendanceEvents').doc()
      transaction.create(eventReference, { schemaVersion: 1, type: 'attended', sessionId, studentId: session.studentId, trainerId: session.trainerId, contractId: contract.id, occurredAt: FieldValue.serverTimestamp(), createdAt: FieldValue.serverTimestamp(), createdBy: actor.uid })
      transaction.update(sessionReference, { status: 'completed', verifiedByStudent: true, attendanceEventId: eventReference.id, revision: revision + 1, updatedAt: FieldValue.serverTimestamp(), updatedBy: actor.uid })
      transaction.update(contract.ref, { usedSessions: FieldValue.increment(1), attendedClasses: FieldValue.arrayUnion(sessionId), updatedAt: FieldValue.serverTimestamp() })
      return { unchanged: false, revision: revision + 1 }
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
    const extensionDays = request.data?.extensionDays ?? 0
    if (!Number.isInteger(extensionDays) || extensionDays < 0 || extensionDays > 365) {
      throw new HttpsError('invalid-argument', 'Số ngày gia hạn phải từ 0 đến 365.')
    }

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
        }
      }
      if (requestData.status !== 'pending') throw new HttpsError('failed-precondition', 'Yêu cầu này không còn chờ duyệt.')

      const requestType = requestData.type === 'cancel' ? 'cancel' : requestData.type === 'reschedule' ? 'reschedule' : ''
      if (!requestType) throw new HttpsError('failed-precondition', 'Loại yêu cầu lịch không hợp lệ.')
      if (requestType !== 'cancel' && extensionDays > 0) throw new HttpsError('invalid-argument', 'Chỉ yêu cầu hủy lịch mới được gia hạn hợp đồng.')
      const requestedBy = requestData.requestedBy === 'trainer' || (requestData.requestedBy !== 'student' && requestData.trainerId)
        ? 'trainer'
        : 'student'
      if (requestedBy === 'trainer' && extensionDays > 0) throw new HttpsError('invalid-argument', 'Yêu cầu do HLV tạo không được tự động gia hạn hợp đồng.')

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

      let newDate = ''
      let newHour = 0
      let trainerId = ''
      let trainerDay = null
      let studentDay = null
      if (requestType === 'reschedule') {
        newDate = date(requestData.newDate)
        newHour = hour(requestData.newHour)
        trainerId = id(session.trainerId, 'Mã HLV')
        ;[trainerDay, studentDay] = await Promise.all([
          transaction.get(dailySessionsQuery(db, 'trainerId', trainerId, newDate)),
          transaction.get(dailySessionsQuery(db, 'studentId', session.studentId, newDate)),
        ])
      }

      let contractSnapshot = null
      if (requestType === 'cancel' && extensionDays > 0) {
        const contractId = id(requestData.contractId, 'Mã hợp đồng')
        const activeContracts = await transaction.get(db.collection('contracts').where('studentId', '==', session.studentId).where('status', '==', 'active').limit(20))
        if (activeContracts.size >= 20) throw new HttpsError('resource-exhausted', 'Có quá nhiều hợp đồng hoạt động để xác định hợp đồng gia hạn an toàn.')
        const coveringContracts = activeContracts.docs.filter((item) => {
          const contract = item.data()
          const contractStartDate = storedDateKey(contract.startDate, 'Ngày bắt đầu hợp đồng')
          const contractEndDate = storedDateKey(contract.endDate, 'Ngày kết thúc hợp đồng')
          return originalDate >= contractStartDate && originalDate <= contractEndDate
        })
        if (coveringContracts.length !== 1 || coveringContracts[0].id !== contractId) {
          throw new HttpsError('failed-precondition', 'Không thể xác định duy nhất hợp đồng hoạt động bao phủ buổi tập để gia hạn.')
        }
        contractSnapshot = coveringContracts[0]
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
        })
        transaction.create(eventReference, { schemaVersion: 1, sessionId, requestId, type: cancellationType, requestedBy, reason, createdAt: FieldValue.serverTimestamp(), createdBy: actor.uid })

        if (contractSnapshot) {
          const contract = contractSnapshot.data()
          const oldEndDate = new Date(contract.endDate)
          if (Number.isNaN(oldEndDate.getTime())) throw new HttpsError('failed-precondition', 'Ngày kết thúc hợp đồng không hợp lệ.')
          oldEndDate.setUTCDate(oldEndDate.getUTCDate() + extensionDays)
          const newEndDate = oldEndDate.toISOString()
          transaction.update(contractSnapshot.ref, {
            endDate: newEndDate,
            extensions: FieldValue.arrayUnion({
              id: `session-request-${requestId}`,
              oldEndDate: contract.endDate,
              newEndDate,
              reason: `Bù ${extensionDays} ngày theo yêu cầu hủy buổi tập ${sessionId}`,
              createdAt: new Date().toISOString(),
              createdBy: actor.uid,
            }),
            updatedAt: FieldValue.serverTimestamp(),
          })
        }
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
        })
        transaction.create(eventReference, { schemaVersion: 1, sessionId, requestId, type: 'rescheduled', from: { date: session.date, hour: session.hour ?? null, trainerId: session.trainerId }, to: { date: newDate, hour: newHour, trainerId }, createdAt: FieldValue.serverTimestamp(), createdBy: actor.uid })
      }

      transaction.update(requestReference, {
        status: 'approved',
        approvedAt: FieldValue.serverTimestamp(),
        approvedBy: actor.uid,
        requestedBy,
        extensionDays,
        processedSessionRevision: nextRevision,
        revision: Number(requestData.revision || 0) + 1,
      })
      return { unchanged: false, status: 'approved', type: requestType, revision: nextRevision }
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

  return { confirmSessionAttendance, cancelSession, rescheduleSession, swapSessions, approveSessionRequest, rejectSessionRequest }
}

module.exports = { createSessionOperationFunctions }
