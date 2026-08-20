const { FieldValue, Timestamp } = require('firebase-admin/firestore')
const { HttpsError } = require('firebase-functions/v2/https')
const { trustedAccessContext, requireCapability } = require('./identity-access')

const TIME_ZONE = 'Asia/Ho_Chi_Minh'

function boundedString(value, label, maximum, required = true) {
  const result = typeof value === 'string' ? value.trim() : ''
  if ((required && !result) || result.length > maximum) throw new HttpsError('invalid-argument', `${label} không hợp lệ.`)
  return result
}

function documentId(value, label) {
  const result = boundedString(value, label, 200)
  if (!/^[A-Za-z0-9_-]+$/.test(result)) throw new HttpsError('invalid-argument', `${label} không hợp lệ.`)
  return result
}

function dateKey(value, label = 'Ngày') {
  const result = boundedString(value, label, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result) || Number.isNaN(Date.parse(`${result}T00:00:00+07:00`))) {
    throw new HttpsError('invalid-argument', `${label} không hợp lệ.`)
  }
  return result
}

function integer(value, fallback, minimum, maximum) {
  const result = Number.isInteger(value) ? value : fallback
  return Math.min(maximum, Math.max(minimum, result))
}

function serialize(value) {
  if (value instanceof Timestamp) return value.toDate().toISOString()
  if (Array.isArray(value)) return value.map(serialize)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, serialize(item)]))
  return value
}

async function assertPortalRollout(db, actor, portal) {
  if (['admin', 'super_admin'].includes(actor.accessRole)) return
  const snapshot = await db.doc('system/feature_flags').get()
  const flags = snapshot.data() || {}
  const enabled = portal === 'trainer' ? flags.trainerPortalEnabled === true : flags.salesPortalEnabled === true
  const canary = Array.isArray(flags.trainerSalesCanaryUids) && flags.trainerSalesCanaryUids.includes(actor.uid)
  if (!enabled && !canary) throw new HttpsError('failed-precondition', 'Portal đang được mở theo nhóm canary. Tài khoản của bạn chưa được kích hoạt.')
}

async function trainerActor(request, db) {
  const actor = await trustedAccessContext(request, db)
  await assertPortalRollout(db, actor, 'trainer')
  return actor
}

async function salesActor(request, db) {
  const actor = await trustedAccessContext(request, db)
  await assertPortalRollout(db, actor, 'sales')
  return actor
}

function contractAssignedTo(contract, actor) {
  const ids = new Set([actor.uid, actor.legacyStaffId].filter(Boolean))
  return ids.has(contract.trainerId)
    || (Array.isArray(contract.trainerIds) && contract.trainerIds.some((id) => ids.has(id)))
    || (Array.isArray(contract.nutritionPTIds) && contract.nutritionPTIds.some((id) => ids.has(id)))
}

async function assignedContracts(db, actor, limit = 200) {
  const actorIds = [...new Set([actor.uid, actor.legacyStaffId].filter(Boolean))]
  const snapshots = []
  for (const actorId of actorIds) {
    snapshots.push(await db.collection('contracts').where('trainerId', '==', actorId).limit(limit).get())
    snapshots.push(await db.collection('contracts').where('trainerIds', 'array-contains', actorId).limit(limit).get())
    snapshots.push(await db.collection('contracts').where('nutritionPTIds', 'array-contains', actorId).limit(limit).get())
  }
  const result = new Map()
  snapshots.forEach((snapshot) => snapshot.docs.forEach((doc) => result.set(doc.id, { id: doc.id, ...doc.data() })))
  return [...result.values()].filter((contract) => contractAssignedTo(contract, actor)).slice(0, limit)
}

function createPtOperationsV2Functions({ db, onCall }) {
  const listMyAssignedStudents = onCall(async (request) => {
    const actor = await trainerActor(request, db)
    requireCapability(actor, 'pt.students.assigned.view')
    const limit = integer(request.data?.limit, 100, 1, 200)
    const contracts = await assignedContracts(db, actor, limit)
    const studentIds = [...new Set(contracts.map((item) => item.studentId).filter(Boolean))]
    const studentSnapshots = studentIds.length ? await db.getAll(...studentIds.map((id) => db.doc(`students/${id}`))) : []
    const activeContractByStudent = new Map(contracts.filter((item) => item.status === 'active').map((item) => [item.studentId, item]))
    const students = studentSnapshots.filter((snapshot) => snapshot.exists).map((snapshot) => {
      const student = snapshot.data()
      const contract = activeContractByStudent.get(snapshot.id) || contracts.find((item) => item.studentId === snapshot.id)
      return serialize({
        id: snapshot.id, name: student.name || 'Học viên Aura', phone: student.phone || '', email: student.email || '',
        branchId: student.branchId || contract?.branchId || '', status: student.status || 'active', sessionsPerWeek: student.sessionsPerWeek || 0,
        contract: contract ? { id: contract.id, status: contract.status, startDate: contract.startDate, endDate: contract.endDate, totalSessions: contract.totalSessions || 0, usedSessions: contract.usedSessions || 0 } : null,
      })
    })
    return { schemaVersion: 1, students, hasMore: contracts.length >= limit }
  })

  const listMyTrainerSchedule = onCall(async (request) => {
    const actor = await trainerActor(request, db)
    requireCapability(actor, 'pt.schedule.self.view')
    const from = dateKey(request.data?.from, 'Ngày bắt đầu')
    const to = dateKey(request.data?.to, 'Ngày kết thúc')
    if (from > to || Date.parse(`${to}T00:00:00+07:00`) - Date.parse(`${from}T00:00:00+07:00`) > 62 * 86400000) throw new HttpsError('invalid-argument', 'Khoảng lịch tối đa là 62 ngày.')
    const limit = integer(request.data?.limit, 300, 1, 500)
    const actorIds = [...new Set([actor.uid, actor.legacyStaffId].filter(Boolean))]
    const snapshots = []
    for (const actorId of actorIds) snapshots.push(await db.collection('sessions').where('trainerId', '==', actorId).where('date', '>=', from).where('date', '<=', to).limit(limit).get())
    const sessions = new Map()
    snapshots.forEach((snapshot) => snapshot.docs.forEach((doc) => sessions.set(doc.id, serialize({ id: doc.id, ...doc.data(), timeZone: TIME_ZONE }))))
    return { schemaVersion: 1, sessions: [...sessions.values()].sort((a, b) => `${a.date}-${a.hour || 0}`.localeCompare(`${b.date}-${b.hour || 0}`)) }
  })

  const getMyTrainerStudentDetail = onCall(async (request) => {
    const actor = await trainerActor(request, db)
    requireCapability(actor, 'pt.students.assigned.view')
    const studentId = documentId(request.data?.studentId, 'Mã học viên')
    const contracts = await assignedContracts(db, actor, 300)
    const studentContracts = contracts.filter((item) => item.studentId === studentId)
    if (!studentContracts.length) throw new HttpsError('permission-denied', 'Học viên không thuộc phạm vi được giao.')
    const [studentSnapshot, logsSnapshot] = await Promise.all([
      db.doc(`students/${studentId}`).get(), db.collection('workoutLogs').where('studentId', '==', studentId).limit(100).get(),
    ])
    if (!studentSnapshot.exists) throw new HttpsError('not-found', 'Không tìm thấy học viên.')
    return { schemaVersion: 1, student: serialize({ id: studentId, ...studentSnapshot.data() }), contracts: serialize(studentContracts), workoutLogs: logsSnapshot.docs.map((doc) => serialize({ id: doc.id, ...doc.data() })) }
  })

  const confirmMySession = onCall(async (request) => {
    const actor = await trainerActor(request, db)
    requireCapability(actor, 'pt.session.self.manage')
    const sessionId = documentId(request.data?.sessionId, 'Mã buổi tập')
    const expectedRevision = integer(request.data?.expectedRevision, 0, 0, 1000000)
    const sessionReference = db.doc(`sessions/${sessionId}`)
    return db.runTransaction(async (transaction) => {
      const sessionSnapshot = await transaction.get(sessionReference)
      if (!sessionSnapshot.exists) throw new HttpsError('not-found', 'Không tìm thấy buổi tập.')
      const session = sessionSnapshot.data()
      if (![actor.uid, actor.legacyStaffId].includes(session.trainerId)) throw new HttpsError('permission-denied', 'Buổi tập không thuộc lịch của bạn.')
      const currentRevision = Number(session.revision || 0)
      if (currentRevision !== expectedRevision) throw new HttpsError('aborted', 'Buổi tập đã thay đổi. Hãy tải lại.')
      if (session.status === 'completed' && session.attendanceEventId) return { unchanged: true, revision: currentRevision }
      if (session.status !== 'scheduled') throw new HttpsError('failed-precondition', 'Chỉ buổi đang lên lịch mới được xác nhận.')
      const contractsSnapshot = await transaction.get(db.collection('contracts').where('studentId', '==', session.studentId).where('status', '==', 'active').limit(10))
      const contractSnapshot = contractsSnapshot.docs.find((item) => contractAssignedTo(item.data(), actor))
      if (!contractSnapshot) throw new HttpsError('failed-precondition', 'Không tìm thấy hợp đồng đang hoạt động phù hợp.')
      const contract = contractSnapshot.data()
      const attendedClasses = Array.isArray(contract.attendedClasses) ? contract.attendedClasses : []
      if (attendedClasses.includes(sessionId)) throw new HttpsError('already-exists', 'Buổi tập đã được tính trước đó.')
      if (Number(contract.usedSessions || 0) >= Number(contract.totalSessions || 0)) throw new HttpsError('failed-precondition', 'Hợp đồng đã sử dụng hết số buổi.')
      const attendanceReference = db.collection('attendanceEvents').doc()
      transaction.create(attendanceReference, { schemaVersion: 1, sessionId, studentId: session.studentId, trainerId: session.trainerId, contractId: contractSnapshot.id, type: 'attended', occurredAt: FieldValue.serverTimestamp(), createdBy: actor.uid, createdAt: FieldValue.serverTimestamp(), timeZone: TIME_ZONE })
      transaction.update(sessionReference, { status: 'completed', revision: currentRevision + 1, attendanceEventId: attendanceReference.id, completedAt: FieldValue.serverTimestamp(), updatedBy: actor.uid, updatedAt: FieldValue.serverTimestamp() })
      transaction.update(contractSnapshot.ref, { usedSessions: FieldValue.increment(1), attendedClasses: FieldValue.arrayUnion(sessionId), updatedAt: FieldValue.serverTimestamp() })
      return { unchanged: false, revision: currentRevision + 1, attendanceEventId: attendanceReference.id }
    })
  })

  const submitWorkoutNote = onCall(async (request) => {
    const actor = await trainerActor(request, db)
    requireCapability(actor, 'pt.workout_note.create')
    const studentId = documentId(request.data?.studentId, 'Mã học viên')
    const contracts = await assignedContracts(db, actor, 300)
    if (!contracts.some((item) => item.studentId === studentId)) throw new HttpsError('permission-denied', 'Học viên không thuộc phạm vi được giao.')
    const reference = db.collection('workoutLogs').doc()
    await reference.create({ schemaVersion: 1, studentId, trainerId: actor.legacyStaffId || actor.uid, sessionId: request.data?.sessionId ? documentId(request.data.sessionId, 'Mã buổi tập') : '', exerciseName: boundedString(request.data?.exerciseName, 'Bài tập', 160), note: boundedString(request.data?.note, 'Ghi chú', 2000, false), date: dateKey(request.data?.date), sets: Array.isArray(request.data?.sets) ? request.data.sets.slice(0, 30) : [], createdBy: actor.uid, createdAt: FieldValue.serverTimestamp() })
    return { logId: reference.id }
  })

  const requestSessionChange = onCall(async (request) => {
    const actor = await trainerActor(request, db)
    requireCapability(actor, 'pt.session.self.manage')
    const sessionId = documentId(request.data?.sessionId, 'Mã buổi tập')
    const session = await db.doc(`sessions/${sessionId}`).get()
    if (!session.exists || ![actor.uid, actor.legacyStaffId].includes(session.data().trainerId)) throw new HttpsError('permission-denied', 'Buổi tập không thuộc lịch của bạn.')
    const type = request.data?.type === 'cancel' ? 'cancel' : 'reschedule'
    const requestedHour = Number(request.data?.newHour)
    if (type === 'reschedule' && (!Number.isInteger(requestedHour) || requestedHour < 0 || requestedHour > 23)) {
      throw new HttpsError('invalid-argument', 'Giờ mới không hợp lệ.')
    }
    const reference = db.collection('sessionRequests').doc()
    await reference.create({ schemaVersion: 1, sessionId, trainerId: session.data().trainerId, studentId: session.data().studentId, contractId: boundedString(request.data?.contractId, 'Mã hợp đồng', 200), type, originalDate: session.data().date, originalHour: session.data().hour || null, newDate: type === 'reschedule' ? dateKey(request.data?.newDate, 'Ngày mới') : null, newHour: type === 'reschedule' ? requestedHour : null, reason: boundedString(request.data?.reason, 'Lý do', 500), status: 'pending', createdBy: actor.uid, createdAt: FieldValue.serverTimestamp() })
    return { requestId: reference.id }
  })

  const listMyQuotes = onCall(async (request) => {
    const actor = await salesActor(request, db)
    requireCapability(actor, 'sales.quotes.self.manage')
    const limit = integer(request.data?.limit, 100, 1, 200)
    const snapshots = [await db.collection('quotes').where('assignedSalesId', '==', actor.uid).limit(limit).get()]
    for (const branchId of actor.branchIds) snapshots.push(await db.collection('quotes').where('branchId', '==', branchId).limit(limit).get())
    const quotes = new Map()
    snapshots.forEach((snapshot) => snapshot.docs.forEach((doc) => {
      const quote = doc.data()
      if (quote.assignedSalesId === actor.uid || actor.branchIds.includes(quote.branchId)) quotes.set(doc.id, serialize({ id: doc.id, ...quote }))
    }))
    return { schemaVersion: 1, quotes: [...quotes.values()].slice(0, limit) }
  })

  const getMySalesCatalog = onCall(async (request) => {
    const actor = await salesActor(request, db)
    requireCapability(actor, 'sales.quotes.self.manage')
    const [branchSnapshots, packageSnapshot] = await Promise.all([
      actor.branchIds.length ? db.getAll(...actor.branchIds.map((id) => db.doc(`branches/${id}`))) : [],
      db.collection('packages').limit(100).get(),
    ])
    const branches = branchSnapshots.filter((item) => item.exists).map((item) => ({ id: item.id, name: item.data().name || item.id }))
    const packages = packageSnapshot.docs
      .filter((item) => item.data().status !== 'inactive')
      .map((item) => ({ id: item.id, name: item.data().name || item.id, price: Number(item.data().price || 0), branchId: item.data().branchId || '' }))
      .filter((item) => !item.branchId || actor.branchIds.includes(item.branchId))
    return { schemaVersion: 1, branches, packages }
  })

  const createQuote = onCall(async (request) => {
    const actor = await salesActor(request, db)
    requireCapability(actor, 'sales.quotes.self.manage')
    const packageId = documentId(request.data?.packageId, 'Mã gói tập')
    const branchId = documentId(request.data?.branchId, 'Mã chi nhánh')
    if (!actor.branchIds.includes(branchId)) throw new HttpsError('permission-denied', 'Bạn không phụ trách chi nhánh này.')
    const packageSnapshot = await db.doc(`packages/${packageId}`).get()
    if (!packageSnapshot.exists) throw new HttpsError('not-found', 'Không tìm thấy gói tập.')
    const originalPrice = Number(packageSnapshot.data().price || 0)
    const discount = integer(request.data?.discount, 0, 0, Math.round(originalPrice * 0.2))
    const reference = db.collection('quotes').doc()
    const code = `AQ-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${reference.id.slice(0, 6).toUpperCase()}`
    await reference.create({ schemaVersion: 1, code, customerName: boundedString(request.data?.customerName, 'Tên khách hàng', 160), customerPhone: boundedString(request.data?.customerPhone, 'Số điện thoại', 30), branchId, packageId, packageName: packageSnapshot.data().name || '', originalPrice, discount, finalPrice: originalPrice - discount, assignedSalesId: actor.uid, status: 'pending', createdBy: actor.uid, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() })
    return { quoteId: reference.id, code, finalPrice: originalPrice - discount }
  })

  const createStudentDraft = onCall(async (request) => {
    const actor = await salesActor(request, db)
    requireCapability(actor, 'sales.student_draft.create')
    const branchId = documentId(request.data?.branchId, 'Mã chi nhánh')
    if (!actor.branchIds.includes(branchId)) throw new HttpsError('permission-denied', 'Bạn không phụ trách chi nhánh này.')
    const reference = db.collection('salesLeads').doc()
    await reference.create({ schemaVersion: 1, displayName: boundedString(request.data?.displayName, 'Tên khách hàng', 160), phoneNumber: boundedString(request.data?.phoneNumber, 'Số điện thoại', 30), email: boundedString(request.data?.email, 'Email', 320, false), branchId, assignedSalesId: actor.uid, status: 'draft', createdBy: actor.uid, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() })
    return { leadId: reference.id }
  })

  const submitContractForApproval = onCall(async (request) => {
    const actor = await salesActor(request, db)
    requireCapability(actor, 'sales.contract.submit')
    const leadId = documentId(request.data?.leadId, 'Mã khách hàng nháp')
    const quoteId = documentId(request.data?.quoteId, 'Mã báo giá')
    const [lead, quote] = await Promise.all([db.doc(`salesLeads/${leadId}`).get(), db.doc(`quotes/${quoteId}`).get()])
    if (!lead.exists || !quote.exists || lead.data().assignedSalesId !== actor.uid || quote.data().assignedSalesId !== actor.uid) throw new HttpsError('permission-denied', 'Hồ sơ hoặc báo giá không thuộc phạm vi của bạn.')
    const reference = db.collection('contractApprovals').doc()
    await reference.create({ schemaVersion: 1, leadId, quoteId, branchId: quote.data().branchId, assignedSalesId: actor.uid, status: 'pending', submittedBy: actor.uid, submittedAt: FieldValue.serverTimestamp(), createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() })
    return { approvalId: reference.id, status: 'pending' }
  })

  return { listMyAssignedStudents, listMyTrainerSchedule, getMyTrainerStudentDetail, confirmMySession, submitWorkoutNote, requestSessionChange, listMyQuotes, getMySalesCatalog, createQuote, createStudentDraft, submitContractForApproval }
}

module.exports = { createPtOperationsV2Functions }
