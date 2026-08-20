const { FieldValue } = require('firebase-admin/firestore')
const { HttpsError } = require('firebase-functions/v2/https')
const { trustedAccessContext, requireCapability } = require('./identity-access')

function id(value, label) {
  const result = typeof value === 'string' ? value.trim() : ''
  if (!result || !/^[A-Za-z0-9_-]+$/.test(result)) throw new HttpsError('invalid-argument', `${label} không hợp lệ.`)
  return result
}

function date(value) {
  const result = typeof value === 'string' ? value.trim() : ''
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result)) throw new HttpsError('invalid-argument', 'Ngày không hợp lệ.')
  return result
}

function hour(value) {
  if (!Number.isInteger(value) || value < 0 || value > 23) throw new HttpsError('invalid-argument', 'Giờ không hợp lệ.')
  return value
}

async function adminActor(request, db) {
  const actor = await trustedAccessContext(request, db)
  requireCapability(actor, 'pt.operations.manage')
  return actor
}

function createSessionOperationFunctions({ db, onCall }) {
  const confirmSessionAttendance = onCall(async (request) => {
    const actor = await adminActor(request, db)
    const sessionId = id(request.data?.sessionId, 'Mã buổi tập')
    const expectedRevision = Number(request.data?.expectedRevision || 0)
    const sessionReference = db.doc(`sessions/${sessionId}`)
    return db.runTransaction(async (transaction) => {
      const sessionSnapshot = await transaction.get(sessionReference)
      if (!sessionSnapshot.exists) throw new HttpsError('not-found', 'Không tìm thấy buổi tập.')
      const session = sessionSnapshot.data()
      const revision = Number(session.revision || 0)
      if (revision !== expectedRevision) throw new HttpsError('aborted', 'Buổi tập đã thay đổi. Hãy tải lại.')
      if (session.status === 'completed' && session.attendanceEventId) return { unchanged: true, revision }
      if (session.status !== 'scheduled') throw new HttpsError('failed-precondition', 'Chỉ buổi đang lên lịch mới được xác nhận.')
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
    const actor = await adminActor(request, db)
    const sessionId = id(request.data?.sessionId, 'Mã buổi tập')
    const expectedRevision = Number(request.data?.expectedRevision || 0)
    const cancellationType = request.data?.type === 'trainer_cancelled' ? 'trainer_cancelled' : 'student_cancelled'
    const reason = typeof request.data?.reason === 'string' ? request.data.reason.trim().slice(0, 500) : ''
    const reference = db.doc(`sessions/${sessionId}`)
    return db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference)
      if (!snapshot.exists) throw new HttpsError('not-found', 'Không tìm thấy buổi tập.')
      const session = snapshot.data()
      const revision = Number(session.revision || 0)
      if (revision !== expectedRevision) throw new HttpsError('aborted', 'Buổi tập đã thay đổi. Hãy tải lại.')
      if (session.status === 'completed') throw new HttpsError('failed-precondition', 'Buổi đã hoàn thành phải dùng quy trình điều chỉnh, không được hủy.')
      transaction.update(reference, { status: cancellationType, cancellationReason: reason, revision: revision + 1, cancelledAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(), updatedBy: actor.uid })
      transaction.create(db.collection('sessionEvents').doc(), { schemaVersion: 1, sessionId, type: cancellationType, reason, createdAt: FieldValue.serverTimestamp(), createdBy: actor.uid })
      return { revision: revision + 1 }
    })
  })

  const rescheduleSession = onCall(async (request) => {
    const actor = await adminActor(request, db)
    const sessionId = id(request.data?.sessionId, 'Mã buổi tập')
    const newDate = date(request.data?.newDate)
    const newHour = hour(request.data?.newHour)
    const trainerId = id(request.data?.trainerId, 'Mã HLV')
    const expectedRevision = Number(request.data?.expectedRevision || 0)
    const reference = db.doc(`sessions/${sessionId}`)
    return db.runTransaction(async (transaction) => {
      const [snapshot, occupied] = await Promise.all([
        transaction.get(reference),
        transaction.get(db.collection('sessions').where('trainerId', '==', trainerId).where('date', '==', newDate).limit(20)),
      ])
      if (!snapshot.exists) throw new HttpsError('not-found', 'Không tìm thấy buổi tập.')
      const session = snapshot.data()
      const revision = Number(session.revision || 0)
      if (revision !== expectedRevision) throw new HttpsError('aborted', 'Buổi tập đã thay đổi. Hãy tải lại.')
      if (session.status === 'completed') throw new HttpsError('failed-precondition', 'Không thể dời buổi đã hoàn thành.')
      const collision = occupied.docs.filter((item) => item.id !== sessionId && !['student_cancelled', 'trainer_cancelled', 'cancelled'].includes(item.data().status) && Number(item.data().hour ?? String(item.id).split('-')[1]) === newHour)
      if (collision.length >= 2) throw new HttpsError('resource-exhausted', 'Khung giờ của HLV đã đủ hai học viên.')
      transaction.update(reference, { previousSchedule: FieldValue.arrayUnion({ date: session.date, hour: session.hour ?? null, trainerId: session.trainerId, changedAt: new Date().toISOString() }), date: newDate, hour: newHour, trainerId, status: 'rescheduled', revision: revision + 1, updatedAt: FieldValue.serverTimestamp(), updatedBy: actor.uid })
      transaction.create(db.collection('sessionEvents').doc(), { schemaVersion: 1, sessionId, type: 'rescheduled', from: { date: session.date, hour: session.hour ?? null, trainerId: session.trainerId }, to: { date: newDate, hour: newHour, trainerId }, createdAt: FieldValue.serverTimestamp(), createdBy: actor.uid })
      return { revision: revision + 1 }
    })
  })

  const swapSessions = onCall(async (request) => {
    const actor = await adminActor(request, db)
    const firstId = id(request.data?.firstSessionId, 'Buổi thứ nhất')
    const secondId = id(request.data?.secondSessionId, 'Buổi thứ hai')
    if (firstId === secondId) throw new HttpsError('invalid-argument', 'Hai buổi tập phải khác nhau.')
    const firstReference = db.doc(`sessions/${firstId}`)
    const secondReference = db.doc(`sessions/${secondId}`)
    return db.runTransaction(async (transaction) => {
      const [first, second] = await Promise.all([transaction.get(firstReference), transaction.get(secondReference)])
      if (!first.exists || !second.exists) throw new HttpsError('not-found', 'Không tìm thấy đủ hai buổi tập.')
      if (first.data().status !== 'scheduled' || second.data().status !== 'scheduled') throw new HttpsError('failed-precondition', 'Chỉ có thể đổi hai buổi đang lên lịch.')
      const firstRevision = Number(first.data().revision || 0)
      const secondRevision = Number(second.data().revision || 0)
      if (firstRevision !== Number(request.data?.firstExpectedRevision || 0) || secondRevision !== Number(request.data?.secondExpectedRevision || 0)) throw new HttpsError('aborted', 'Một buổi tập đã thay đổi. Hãy tải lại.')
      const firstSlot = { date: first.data().date, hour: first.data().hour ?? null, trainerId: first.data().trainerId }
      const secondSlot = { date: second.data().date, hour: second.data().hour ?? null, trainerId: second.data().trainerId }
      transaction.update(firstReference, { ...secondSlot, revision: firstRevision + 1, updatedAt: FieldValue.serverTimestamp(), updatedBy: actor.uid })
      transaction.update(secondReference, { ...firstSlot, revision: secondRevision + 1, updatedAt: FieldValue.serverTimestamp(), updatedBy: actor.uid })
      transaction.create(db.collection('sessionEvents').doc(), { schemaVersion: 1, type: 'swapped', sessionIds: [firstId, secondId], createdAt: FieldValue.serverTimestamp(), createdBy: actor.uid })
      return { firstRevision: firstRevision + 1, secondRevision: secondRevision + 1 }
    })
  })

  return { confirmSessionAttendance, cancelSession, rescheduleSession, swapSessions }
}

module.exports = { createSessionOperationFunctions }
