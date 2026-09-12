'use strict'

const { createHash } = require('node:crypto')
const { FieldValue } = require('firebase-admin/firestore')
const { HttpsError } = require('firebase-functions/v2/https')
const { trustedAccessContext, requireCapability } = require('./identity-access')
const { withFunctionTelemetry } = require('./observability')

const BRANCH_CAPABILITY = 'identity.staff_position.manage'

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

function validKey(value) {
  const normalized = clean(value, 120)
  if (!/^[A-Za-z0-9._:-]{8,120}$/.test(normalized)) throw new HttpsError('invalid-argument', 'Mã chống ghi trùng không hợp lệ.')
  return normalized
}

function revision(value) {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 1_000_000_000) throw new HttpsError('invalid-argument', 'Phiên bản chi nhánh không hợp lệ.')
  return parsed
}

function branchDraft(value = {}) {
  const name = clean(value.name, 160)
  const address = clean(value.address, 500)
  if (name.length < 2) throw new HttpsError('invalid-argument', 'Tên chi nhánh phải có ít nhất 2 ký tự.')
  if (address.length < 3) throw new HttpsError('invalid-argument', 'Địa chỉ chi nhánh phải có ít nhất 3 ký tự.')
  return { name, address }
}

function hash(value) {
  return createHash('sha256').update(value).digest('hex')
}

function commandReceiptId(actorUid, key) {
  return hash(`${actorUid}\n${key}`).slice(0, 48)
}

function createdBranchId(actorUid, key) {
  return `branch_${hash(`${actorUid}\ncreate-branch\n${key}`).slice(0, 28)}`
}

function readReceipt(snapshot, operation, payloadHash) {
  if (!snapshot.exists) return null
  const current = snapshot.data() || {}
  if (current.operation !== operation || current.payloadHash !== payloadHash) {
    throw new HttpsError('already-exists', 'Mã chống ghi trùng đã được dùng cho một nội dung khác.')
  }
  return { ...(current.result || {}), unchanged: true }
}

async function branchCommand({ db, actor, data, correlationId, operation }) {
  requireCapability(actor, BRANCH_CAPABILITY)
  const key = validKey(data.idempotencyKey)
  const expectedRevision = revision(data.expectedRevision)
  const suppliedId = clean(data.branchId, 200)
  const creating = operation === 'upsert' && !suppliedId
  const branchId = creating ? createdBranchId(actor.uid, key) : documentId(suppliedId, 'Mã chi nhánh')
  if (creating && expectedRevision !== 0) throw new HttpsError('invalid-argument', 'Chi nhánh mới phải bắt đầu từ phiên bản 0.')
  const draft = operation === 'upsert' ? branchDraft(data) : null
  const payloadHash = hash(JSON.stringify({ operation, branchId: creating ? null : branchId, expectedRevision, draft }))
  const receiptId = commandReceiptId(actor.uid, key)
  const branchReference = db.doc(`branches/${branchId}`)
  const receiptReference = db.doc(`branchCommandReceipts/${receiptId}`)
  const auditReference = db.doc(`auditLogs/branch_command_${receiptId}`)

  return db.runTransaction(async (transaction) => {
    const previousResult = readReceipt(await transaction.get(receiptReference), operation, payloadHash)
    if (previousResult) return previousResult
    const snapshot = await transaction.get(branchReference)
    if (creating && snapshot.exists) throw new HttpsError('already-exists', 'Chi nhánh đã tồn tại.')
    if (!creating && !snapshot.exists) throw new HttpsError('not-found', 'Không tìm thấy chi nhánh.')
    const current = snapshot.exists ? snapshot.data() || {} : {}
    const currentRevision = Number.isInteger(current.revision) && current.revision >= 0 ? current.revision : 0
    if (currentRevision !== expectedRevision) throw new HttpsError('aborted', 'Chi nhánh vừa được người khác cập nhật. Hãy tải lại rồi thử lại.')
    if (current.status === 'archived') throw new HttpsError('failed-precondition', 'Chi nhánh đã lưu trữ và không thể chỉnh sửa hoặc lưu trữ lần nữa.')

    const nextRevision = currentRevision + 1
    const now = FieldValue.serverTimestamp()
    if (creating) {
      transaction.create(branchReference, {
        schemaVersion: 1, id: branchId, ...draft, status: 'active', revision: nextRevision,
        createdAt: now, createdBy: actor.uid, updatedAt: now, updatedBy: actor.uid,
      })
    } else if (operation === 'upsert') {
      transaction.set(branchReference, { ...draft, status: 'active', revision: nextRevision, updatedAt: now, updatedBy: actor.uid }, { merge: true })
    } else {
      transaction.update(branchReference, { status: 'archived', revision: nextRevision, archivedAt: now, archivedBy: actor.uid, updatedAt: now, updatedBy: actor.uid })
    }
    const result = { schemaVersion: 1, branchId, status: operation === 'archive' ? 'archived' : 'active', revision: nextRevision, unchanged: false }
    transaction.create(receiptReference, { schemaVersion: 1, operation, actorUid: actor.uid, branchId, payloadHash, result, createdAt: now })
    transaction.create(auditReference, {
      schemaVersion: 1, action: operation === 'archive' ? 'branch.archived' : creating ? 'branch.created' : 'branch.updated',
      domain: 'identity', sourceType: 'branch', sourceId: branchId, branchId, revision: nextRevision,
      actorUid: actor.uid, correlationId: correlationId || null, createdAt: now,
    })
    return result
  })
}

function createBranchManagementFunctions({ db, onCall, accessContextResolver = trustedAccessContext }) {
  const upsertBranch = onCall(withFunctionTelemetry('upsertBranch', async (request) => {
    const actor = await accessContextResolver(request, db)
    return branchCommand({ db, actor, data: request.data || {}, correlationId: request.auraCorrelationId, operation: 'upsert' })
  }))
  const archiveBranch = onCall(withFunctionTelemetry('archiveBranch', async (request) => {
    const actor = await accessContextResolver(request, db)
    return branchCommand({ db, actor, data: request.data || {}, correlationId: request.auraCorrelationId, operation: 'archive' })
  }))
  return { upsertBranch, archiveBranch }
}

module.exports = { BRANCH_CAPABILITY, branchCommand, branchDraft, createBranchManagementFunctions, createdBranchId }
