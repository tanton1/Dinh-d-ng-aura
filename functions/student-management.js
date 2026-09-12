'use strict'

const { createHash } = require('node:crypto')
const { FieldValue } = require('firebase-admin/firestore')
const { HttpsError } = require('firebase-functions/v2/https')
const { trustedAccessContext } = require('./identity-access')
const { withFunctionTelemetry } = require('./observability')

const PROFILE_FIELDS = new Set([
  'name',
  'phone',
  'email',
  'dob',
  'sessionsPerWeek',
  'status',
  'branchId',
  'nutritionNote',
  'availableSlots',
  'isScheduleConfirmed',
])
const SCHEDULING_FIELDS = new Set(['sessionsPerWeek', 'availableSlots', 'isScheduleConfirmed'])

function clean(value, maximum = 200) {
  return typeof value === 'string' ? value.trim().slice(0, maximum) : ''
}

function documentId(value, label) {
  const normalized = clean(value, 200)
  if (!normalized || normalized.includes('/') || !/^[A-Za-z0-9._:-]+$/.test(normalized)) {
    throw new HttpsError('invalid-argument', `${label} không hợp lệ.`)
  }
  return normalized
}

function validIdempotencyKey(value) {
  const normalized = clean(value, 120)
  if (!/^[A-Za-z0-9._:-]{8,120}$/.test(normalized)) {
    throw new HttpsError('invalid-argument', 'Mã chống ghi trùng không hợp lệ.')
  }
  return normalized
}

function expectedRevision(value) {
  const normalized = Number(value)
  if (!Number.isInteger(normalized) || normalized < 0 || normalized > 1_000_000_000) {
    throw new HttpsError('invalid-argument', 'Phiên bản hồ sơ không hợp lệ.')
  }
  return normalized
}

function currentRevision(value) {
  return Number.isInteger(value) && value >= 0 ? value : 0
}

function normalizeDate(value) {
  const normalized = clean(value, 10)
  if (!normalized) return ''
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized) || Number.isNaN(Date.parse(`${normalized}T00:00:00.000Z`))) {
    throw new HttpsError('invalid-argument', 'Ngày sinh không hợp lệ.')
  }
  return normalized
}

function normalizePhone(value) {
  const input = clean(value, 40)
  if (!input) return ''
  const digits = input.replace(/\D/g, '')
  const local = digits.startsWith('84') ? `0${digits.slice(2)}` : digits
  if (!/^0\d{8,10}$/.test(local)) throw new HttpsError('invalid-argument', 'Số điện thoại không hợp lệ.')
  return local
}

function normalizeEmail(value) {
  const normalized = clean(value, 320).toLowerCase()
  if (!normalized) return ''
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    throw new HttpsError('invalid-argument', 'Email không hợp lệ.')
  }
  return normalized
}

function normalizeSlots(value) {
  if (!Array.isArray(value)) throw new HttpsError('invalid-argument', 'Lịch rảnh không hợp lệ.')
  const slots = [...new Set(value.map((item) => clean(item, 20)).filter(Boolean))]
  if (slots.length > 100 || slots.some((slot) => !/^[A-Za-zÀ-ỹ0-9:_-]+$/u.test(slot))) {
    throw new HttpsError('invalid-argument', 'Lịch rảnh chứa khung giờ không hợp lệ.')
  }
  return slots
}

function normalizeStudentUpdates(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new HttpsError('invalid-argument', 'Nội dung cập nhật hồ sơ không hợp lệ.')
  }
  const suppliedKeys = Object.keys(value)
  if (!suppliedKeys.length || suppliedKeys.some((key) => !PROFILE_FIELDS.has(key))) {
    throw new HttpsError('invalid-argument', 'Hồ sơ chứa trường không được phép cập nhật.')
  }
  const result = {}
  if (Object.hasOwn(value, 'name')) {
    const name = clean(value.name, 160)
    if (name.length < 2) throw new HttpsError('invalid-argument', 'Tên học viên phải có ít nhất 2 ký tự.')
    result.name = name
  }
  if (Object.hasOwn(value, 'phone')) result.phone = normalizePhone(value.phone)
  if (Object.hasOwn(value, 'email')) result.email = normalizeEmail(value.email)
  if (Object.hasOwn(value, 'dob')) result.dob = normalizeDate(value.dob)
  if (Object.hasOwn(value, 'sessionsPerWeek')) {
    const sessionsPerWeek = Number(value.sessionsPerWeek)
    if (!Number.isInteger(sessionsPerWeek) || sessionsPerWeek < 1 || sessionsPerWeek > 14) {
      throw new HttpsError('invalid-argument', 'Số buổi mỗi tuần phải từ 1 đến 14.')
    }
    result.sessionsPerWeek = sessionsPerWeek
  }
  if (Object.hasOwn(value, 'status')) {
    if (!['active', 'inactive'].includes(value.status)) throw new HttpsError('invalid-argument', 'Trạng thái học viên không hợp lệ.')
    result.status = value.status
  }
  if (Object.hasOwn(value, 'branchId')) result.branchId = clean(value.branchId, 200) ? documentId(value.branchId, 'Mã chi nhánh') : ''
  if (Object.hasOwn(value, 'nutritionNote')) result.nutritionNote = clean(value.nutritionNote, 1_000)
  if (Object.hasOwn(value, 'availableSlots')) result.availableSlots = normalizeSlots(value.availableSlots)
  if (Object.hasOwn(value, 'isScheduleConfirmed')) {
    if (typeof value.isScheduleConfirmed !== 'boolean') throw new HttpsError('invalid-argument', 'Trạng thái xác nhận lịch không hợp lệ.')
    result.isScheduleConfirmed = value.isScheduleConfirmed
  }
  return result
}

function digest(value) {
  return createHash('sha256').update(value).digest('hex')
}

function receiptId(actorUid, key) {
  return digest(`${actorUid}\n${key}`).slice(0, 48)
}

function payloadHash(studentId, revision, updates) {
  return digest(JSON.stringify({ operation: 'update', studentId, revision, updates }))
}

function receiptResult(snapshot, hash) {
  if (!snapshot.exists) return null
  const receipt = snapshot.data() || {}
  if (receipt.operation !== 'update' || receipt.payloadHash !== hash) {
    throw new HttpsError('already-exists', 'Mã chống ghi trùng đã được dùng cho một nội dung khác.')
  }
  if (!receipt.result || typeof receipt.result !== 'object') {
    throw new HttpsError('failed-precondition', 'Biên nhận thao tác không đầy đủ. Hãy liên hệ quản trị viên.')
  }
  return { ...receipt.result, unchanged: true }
}

function isElevated(actor) {
  return actor.accessRole === 'admin' || actor.accessRole === 'super_admin'
}

function hasCapability(actor, capability) {
  return Array.isArray(actor.capabilities) && actor.capabilities.includes(capability)
}

function schedulingOnly(updates) {
  return Object.keys(updates).every((key) => SCHEDULING_FIELDS.has(key))
}

function contractAssignedToActor(contract, actor) {
  const ids = new Set([actor.uid, actor.legacyStaffId].filter(Boolean))
  return ids.has(contract.trainerId)
    || (Array.isArray(contract.trainerIds) && contract.trainerIds.some((id) => ids.has(id)))
}

async function assertAssignedTrainer(transaction, db, actor, studentId) {
  if (!hasCapability(actor, 'pt.session.self.manage')) {
    throw new HttpsError('permission-denied', 'Bạn không có quyền cập nhật hồ sơ học viên này.')
  }
  const query = db.collection('contracts').where('studentId', '==', studentId).limit(25)
  const snapshot = await transaction.get(query)
  if (!snapshot.docs.some((item) => contractAssignedToActor(item.data() || {}, actor))) {
    throw new HttpsError('permission-denied', 'Học viên không thuộc danh sách được phân công cho PT này.')
  }
}

function assertBranchScope(actor, currentBranchId, nextBranchId) {
  if (isElevated(actor)) return
  const scope = new Set(Array.isArray(actor.branchIds) ? actor.branchIds : [])
  if (!currentBranchId || !scope.has(currentBranchId) || (nextBranchId && !scope.has(nextBranchId))) {
    throw new HttpsError('permission-denied', 'Học viên nằm ngoài phạm vi chi nhánh được cấp.')
  }
}

async function updateStudentCommand({ db, actor, data, correlationId }) {
  const studentId = documentId(data.studentId, 'Mã học viên')
  const revision = expectedRevision(data.expectedRevision)
  const key = validIdempotencyKey(data.idempotencyKey)
  const updates = normalizeStudentUpdates(data.updates)
  const hash = payloadHash(studentId, revision, updates)
  const commandReceiptId = receiptId(actor.uid, key)
  const studentReference = db.doc(`students/${studentId}`)
  const receiptReference = db.doc(`studentCommandReceipts/${commandReceiptId}`)
  const auditReference = db.doc(`auditLogs/student_command_${commandReceiptId}`)

  return db.runTransaction(async (transaction) => {
    const existingReceipt = receiptResult(await transaction.get(receiptReference), hash)
    if (existingReceipt) return existingReceipt

    const snapshot = await transaction.get(studentReference)
    if (!snapshot.exists) throw new HttpsError('not-found', 'Không tìm thấy hồ sơ học viên.')
    const current = snapshot.data() || {}
    const operationManager = hasCapability(actor, 'pt.operations.manage') || hasCapability(actor, 'branch.students.manage')
    if (operationManager) {
      assertBranchScope(actor, current.branchId || '', updates.branchId ?? current.branchId ?? '')
    } else {
      if (!schedulingOnly(updates)) throw new HttpsError('permission-denied', 'PT chỉ được cập nhật thông tin phục vụ xếp lịch.')
      await assertAssignedTrainer(transaction, db, actor, studentId)
    }

    if (current.accountUid) {
      const contactChanged = (updates.phone !== undefined && updates.phone !== normalizePhone(current.phone))
        || (updates.email !== undefined && updates.email !== normalizeEmail(current.email))
      if (contactChanged) {
        throw new HttpsError('failed-precondition', 'Số điện thoại và email đăng nhập được quản lý ở hồ sơ tài khoản Aura. Hãy cập nhật từ luồng quản lý tài khoản để giữ đồng bộ Auth.')
      }
    }
    for (const [field, value] of [['phone', updates.phone], ['email', updates.email]]) {
      if (typeof value !== 'string' || !value || value === current[field]) continue
      const duplicateSnapshot = await transaction.get(db.collection('students').where(field, '==', value).limit(2))
      if (duplicateSnapshot.docs.some((item) => item.id !== studentId)) {
        throw new HttpsError('already-exists', `${field === 'phone' ? 'Số điện thoại' : 'Email'} đã tồn tại ở học viên khác.`)
      }
    }

    const storedRevision = currentRevision(current.revision)
    if (storedRevision !== revision) {
      throw new HttpsError('aborted', 'Hồ sơ học viên vừa được người khác cập nhật. Hãy tải lại rồi thử lại.')
    }
    if (updates.branchId) {
      const branch = await transaction.get(db.doc(`branches/${updates.branchId}`))
      if (!branch.exists || branch.data()?.status === 'archived') {
        throw new HttpsError('failed-precondition', 'Chi nhánh không tồn tại hoặc đã ngừng hoạt động.')
      }
    }

    const nextRevision = storedRevision + 1
    const now = FieldValue.serverTimestamp()
    transaction.update(studentReference, {
      ...updates,
      revision: nextRevision,
      schemaVersion: Math.max(1, Number(current.schemaVersion || 1)),
      updatedAt: now,
      updatedBy: actor.uid,
    })
    if (current.accountUid && (updates.name !== undefined || updates.branchId !== undefined)) {
      transaction.set(db.doc(`users/${documentId(current.accountUid, 'UID tài khoản')}`), {
        ...(updates.name !== undefined ? { name: updates.name, displayName: updates.name } : {}),
        ...(updates.branchId !== undefined ? { branchId: updates.branchId } : {}),
        updatedAt: now,
      }, { merge: true })
    }
    const result = { schemaVersion: 1, studentId, revision: nextRevision, status: updates.status || current.status || 'active', unchanged: false }
    transaction.create(receiptReference, {
      schemaVersion: 1,
      operation: 'update',
      actorUid: actor.uid,
      studentId,
      payloadHash: hash,
      result,
      createdAt: now,
    })
    transaction.create(auditReference, {
      schemaVersion: 1,
      action: updates.status === 'inactive' ? 'student.archived' : 'student.updated',
      domain: 'people',
      sourceType: 'student',
      sourceId: studentId,
      studentId,
      branchId: updates.branchId ?? current.branchId ?? null,
      revision: nextRevision,
      changedFields: Object.keys(updates).sort(),
      actorUid: actor.uid,
      correlationId: correlationId || null,
      createdAt: now,
    })
    return result
  })
}

function createStudentManagementFunctions({ db, onCall, accessContextResolver = trustedAccessContext }) {
  const updateStudentProfile = onCall(withFunctionTelemetry('updateStudentProfile', async (request) => {
    const actor = await accessContextResolver(request, db)
    return updateStudentCommand({ db, actor, data: request.data || {}, correlationId: request.auraCorrelationId })
  }))
  return { updateStudentProfile }
}

module.exports = {
  PROFILE_FIELDS,
  createStudentManagementFunctions,
  normalizeStudentUpdates,
  updateStudentCommand,
}
