'use strict'

const { createHash } = require('node:crypto')
const { FieldValue } = require('firebase-admin/firestore')
const { HttpsError } = require('firebase-functions/v2/https')
const { trustedAccessContext, requireCapability } = require('./identity-access')
const { withFunctionTelemetry } = require('./observability')

const PACKAGE_CAPABILITY = 'pt.operations.manage'
const PACKAGE_STATUS_ACTIVE = 'active'
const PACKAGE_STATUS_ARCHIVED = 'archived'

function clean(value, maximum = 200) {
  return typeof value === 'string' ? value.trim().slice(0, maximum) : ''
}

function validDocumentId(value, label) {
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

function integerInRange(value, label, minimum, maximum) {
  const normalized = Number(value)
  if (!Number.isInteger(normalized) || normalized < minimum || normalized > maximum) {
    throw new HttpsError('invalid-argument', `${label} phải là số nguyên từ ${minimum} đến ${maximum}.`)
  }
  return normalized
}

function normalizeExpectedRevision(value) {
  return integerInRange(value, 'Phiên bản dữ liệu', 0, 1_000_000_000)
}

function normalizePackageDraft(value = {}) {
  const name = clean(value.name, 160)
  if (name.length < 2) throw new HttpsError('invalid-argument', 'Tên gói tập phải có ít nhất 2 ký tự.')
  return {
    name,
    totalSessions: integerInRange(value.totalSessions, 'Số buổi tập', 1, 10_000),
    durationMonths: integerInRange(value.durationMonths, 'Thời hạn gói', 1, 120),
    price: integerInRange(value.price, 'Giá gói tập', 0, 1_000_000_000_000),
    branchId: value.branchId === null || value.branchId === undefined || clean(value.branchId) === ''
      ? null
      : validDocumentId(value.branchId, 'Mã chi nhánh'),
  }
}

function commandHash(value) {
  return createHash('sha256').update(value).digest('hex')
}

function receiptId(actorUid, idempotencyKey) {
  return commandHash(`${actorUid}\n${idempotencyKey}`).slice(0, 48)
}

function packageIdForCreate(actorUid, idempotencyKey) {
  return `pkg_${commandHash(`${actorUid}\ncreate-package\n${idempotencyKey}`).slice(0, 28)}`
}

function payloadHash(operation, payload) {
  return commandHash(JSON.stringify({ operation, ...payload }))
}

function isElevatedActor(actor) {
  return actor.accessRole === 'admin' || actor.accessRole === 'super_admin'
}

function assertPackageBranchScope(actor, nextBranchId, currentBranchId = null) {
  if (isElevatedActor(actor)) return
  const scope = new Set(Array.isArray(actor.branchIds) ? actor.branchIds : [])
  if (!nextBranchId) {
    throw new HttpsError('permission-denied', 'Chỉ Admin hệ thống mới có thể quản lý gói dùng cho mọi chi nhánh.')
  }
  if (!scope.has(nextBranchId) || (currentBranchId && !scope.has(currentBranchId))) {
    throw new HttpsError('permission-denied', 'Gói tập nằm ngoài phạm vi chi nhánh được cấp.')
  }
}

function normalizedCurrentRevision(value) {
  return Number.isInteger(value) && value >= 0 ? value : 0
}

function assertRevision(currentRevision, expectedRevision) {
  if (currentRevision !== expectedRevision) {
    throw new HttpsError('aborted', 'Gói tập vừa được người khác cập nhật. Hãy tải lại dữ liệu rồi thử lại.')
  }
}

function receiptResult(snapshot, operation, hash) {
  if (!snapshot.exists) return null
  const receipt = snapshot.data() || {}
  if (receipt.operation !== operation || receipt.payloadHash !== hash) {
    throw new HttpsError('already-exists', 'Mã chống ghi trùng đã được dùng cho một nội dung khác.')
  }
  if (!receipt.result || typeof receipt.result !== 'object') {
    throw new HttpsError('failed-precondition', 'Biên nhận thao tác không đầy đủ. Hãy liên hệ quản trị viên.')
  }
  return { ...receipt.result, unchanged: true }
}

async function validateBranch(transaction, db, branchId) {
  if (!branchId) return
  const branchSnapshot = await transaction.get(db.doc(`branches/${branchId}`))
  if (!branchSnapshot.exists || branchSnapshot.data()?.status === 'archived') {
    throw new HttpsError('failed-precondition', 'Chi nhánh không tồn tại hoặc đã ngừng hoạt động.')
  }
}

function auditDocument({ operation, actor, packageId, branchId, revision, correlationId }) {
  return {
    schemaVersion: 1,
    action: operation === 'upsert' ? 'training_package.upsert' : 'training_package.archive',
    domain: 'contract',
    sourceType: 'training_package',
    sourceId: packageId,
    packageId,
    branchId: branchId || null,
    revision,
    actorUid: actor.uid,
    correlationId: correlationId || null,
    createdAt: FieldValue.serverTimestamp(),
  }
}

async function upsertPackageCommand({ db, actor, data, correlationId }) {
  requireCapability(actor, PACKAGE_CAPABILITY)
  const draft = normalizePackageDraft(data)
  const expectedRevision = normalizeExpectedRevision(data.expectedRevision)
  const idempotencyKey = validIdempotencyKey(data.idempotencyKey)
  const suppliedPackageId = clean(data.packageId, 200)
  const creating = !suppliedPackageId
  if (creating && expectedRevision !== 0) {
    throw new HttpsError('invalid-argument', 'Gói mới phải bắt đầu từ phiên bản 0.')
  }
  const packageId = creating
    ? packageIdForCreate(actor.uid, idempotencyKey)
    : validDocumentId(suppliedPackageId, 'Mã gói tập')
  const operation = 'upsert'
  const hash = payloadHash(operation, { packageId: creating ? null : packageId, expectedRevision, ...draft })
  const commandReceiptId = receiptId(actor.uid, idempotencyKey)
  const packageReference = db.doc(`packages/${packageId}`)
  const receiptReference = db.doc(`packageCommandReceipts/${commandReceiptId}`)
  const auditReference = db.doc(`auditLogs/package_command_${commandReceiptId}`)

  return db.runTransaction(async (transaction) => {
    const existingReceipt = receiptResult(await transaction.get(receiptReference), operation, hash)
    if (existingReceipt) return existingReceipt

    const packageSnapshot = await transaction.get(packageReference)
    if (creating && packageSnapshot.exists) {
      throw new HttpsError('already-exists', 'Gói tập đã tồn tại. Hãy tải lại danh sách.')
    }
    if (!creating && !packageSnapshot.exists) throw new HttpsError('not-found', 'Không tìm thấy gói tập cần cập nhật.')
    const current = packageSnapshot.exists ? packageSnapshot.data() || {} : {}
    if (current.status === PACKAGE_STATUS_ARCHIVED) {
      throw new HttpsError('failed-precondition', 'Gói đã ngừng áp dụng và không thể chỉnh sửa hoặc kích hoạt lại âm thầm.')
    }
    if (!creating && !isElevatedActor(actor) && !current.branchId) {
      throw new HttpsError('permission-denied', 'Chỉ Admin hệ thống mới có thể sửa gói dùng cho mọi chi nhánh.')
    }
    const currentRevision = packageSnapshot.exists ? normalizedCurrentRevision(current.revision) : 0
    assertRevision(currentRevision, expectedRevision)
    assertPackageBranchScope(actor, draft.branchId, current.branchId || null)
    await validateBranch(transaction, db, draft.branchId)

    const revision = currentRevision + 1
    const now = FieldValue.serverTimestamp()
    const next = {
      schemaVersion: 1,
      id: packageId,
      ...draft,
      status: PACKAGE_STATUS_ACTIVE,
      revision,
      updatedAt: now,
      updatedBy: actor.uid,
      ...(creating ? {
        createdAt: now,
        createdBy: actor.uid,
        archivedAt: null,
        archivedBy: null,
      } : {}),
    }
    if (creating) transaction.create(packageReference, next)
    else transaction.set(packageReference, next, { merge: true })

    const result = { schemaVersion: 1, packageId, status: PACKAGE_STATUS_ACTIVE, revision, unchanged: false }
    transaction.create(receiptReference, {
      schemaVersion: 1,
      operation,
      actorUid: actor.uid,
      packageId,
      payloadHash: hash,
      result,
      createdAt: now,
    })
    transaction.create(auditReference, auditDocument({ operation, actor, packageId, branchId: draft.branchId, revision, correlationId }))
    return result
  })
}

async function archivePackageCommand({ db, actor, data, correlationId }) {
  requireCapability(actor, PACKAGE_CAPABILITY)
  const packageId = validDocumentId(data.packageId, 'Mã gói tập')
  const expectedRevision = normalizeExpectedRevision(data.expectedRevision)
  const idempotencyKey = validIdempotencyKey(data.idempotencyKey)
  const operation = 'archive'
  const hash = payloadHash(operation, { packageId, expectedRevision })
  const commandReceiptId = receiptId(actor.uid, idempotencyKey)
  const packageReference = db.doc(`packages/${packageId}`)
  const receiptReference = db.doc(`packageCommandReceipts/${commandReceiptId}`)
  const auditReference = db.doc(`auditLogs/package_command_${commandReceiptId}`)

  return db.runTransaction(async (transaction) => {
    const existingReceipt = receiptResult(await transaction.get(receiptReference), operation, hash)
    if (existingReceipt) return existingReceipt

    const packageSnapshot = await transaction.get(packageReference)
    if (!packageSnapshot.exists) throw new HttpsError('not-found', 'Không tìm thấy gói tập cần ngừng áp dụng.')
    const current = packageSnapshot.data() || {}
    if (current.status === PACKAGE_STATUS_ARCHIVED) {
      throw new HttpsError('failed-precondition', 'Gói tập đã ngừng áp dụng.')
    }
    if (!isElevatedActor(actor) && !current.branchId) {
      throw new HttpsError('permission-denied', 'Chỉ Admin hệ thống mới có thể ngừng áp dụng gói dùng cho mọi chi nhánh.')
    }
    const currentRevision = normalizedCurrentRevision(current.revision)
    assertRevision(currentRevision, expectedRevision)
    assertPackageBranchScope(actor, current.branchId || null, current.branchId || null)

    const revision = currentRevision + 1
    const now = FieldValue.serverTimestamp()
    transaction.update(packageReference, {
      status: PACKAGE_STATUS_ARCHIVED,
      revision,
      archivedAt: now,
      archivedBy: actor.uid,
      updatedAt: now,
      updatedBy: actor.uid,
    })
    const result = { schemaVersion: 1, packageId, status: PACKAGE_STATUS_ARCHIVED, revision, unchanged: false }
    transaction.create(receiptReference, {
      schemaVersion: 1,
      operation,
      actorUid: actor.uid,
      packageId,
      payloadHash: hash,
      result,
      createdAt: now,
    })
    transaction.create(auditReference, auditDocument({ operation, actor, packageId, branchId: current.branchId || null, revision, correlationId }))
    return result
  })
}

function createPackageManagementFunctions({ db, onCall, accessContextResolver = trustedAccessContext }) {
  const upsertTrainingPackage = onCall(withFunctionTelemetry('upsertTrainingPackage', async (request) => {
    const actor = await accessContextResolver(request, db)
    return upsertPackageCommand({ db, actor, data: request.data || {}, correlationId: request.auraCorrelationId })
  }))
  const archiveTrainingPackage = onCall(withFunctionTelemetry('archiveTrainingPackage', async (request) => {
    const actor = await accessContextResolver(request, db)
    return archivePackageCommand({ db, actor, data: request.data || {}, correlationId: request.auraCorrelationId })
  }))
  return { upsertTrainingPackage, archiveTrainingPackage }
}

module.exports = {
  PACKAGE_CAPABILITY,
  archivePackageCommand,
  assertPackageBranchScope,
  createPackageManagementFunctions,
  normalizePackageDraft,
  packageIdForCreate,
  upsertPackageCommand,
}
