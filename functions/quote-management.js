'use strict'

const { createHash } = require('node:crypto')
const { FieldPath, FieldValue, Timestamp } = require('firebase-admin/firestore')
const { HttpsError } = require('firebase-functions/v2/https')
const { trustedAccessContext, requireCapability } = require('./identity-access')
const { normalizeMemberReferralCode } = require('./loyalty-core')
const { withFunctionTelemetry } = require('./observability')

const QUOTE_CAPABILITY = 'sales.operations.manage'
const MAX_PAGE_SIZE = 100
const MAX_SCAN = 500
const QUOTE_STATUSES = new Set(['pending', 'accepted', 'archived'])

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
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new HttpsError('invalid-argument', `${label} phải là số nguyên từ ${minimum.toLocaleString('vi-VN')} đến ${maximum.toLocaleString('vi-VN')}.`)
  }
  return parsed
}

function normalizedRevision(value) {
  return integerInRange(value, 'Phiên bản dữ liệu', 0, 1_000_000_000)
}

function normalizedPhone(value, required = false) {
  const original = clean(value, 30)
  const digits = original.replace(/\D/g, '')
  if ((required && !digits) || (digits && (digits.length < 9 || digits.length > 12))) {
    throw new HttpsError('invalid-argument', 'Số điện thoại không hợp lệ.')
  }
  if (!digits) return ''
  if (digits.startsWith('84')) return `+${digits}`
  if (digits.startsWith('0')) return `+84${digits.slice(1)}`
  return `+84${digits}`
}

function commandHash(value) {
  return createHash('sha256').update(value).digest('hex')
}

function receiptId(actorUid, idempotencyKey) {
  return commandHash(`${actorUid}\n${idempotencyKey}`).slice(0, 48)
}

function payloadHash(operation, payload) {
  return commandHash(JSON.stringify({ operation, ...payload }))
}

function quoteIdForCreate(actorUid, idempotencyKey, now = new Date()) {
  const time = now.toISOString().replace(/\D/g, '').slice(0, 14)
  return `quote_${time}_${commandHash(`${actorUid}\ncreate-quote\n${idempotencyKey}`).slice(0, 20)}`
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

function isElevatedActor(actor) {
  return actor.accessRole === 'admin' || actor.accessRole === 'super_admin'
}

function assertBranchScope(actor, branchId) {
  if (isElevatedActor(actor)) return
  if (!Array.isArray(actor.branchIds) || !actor.branchIds.includes(branchId)) {
    throw new HttpsError('permission-denied', 'Báo giá nằm ngoài phạm vi chi nhánh được cấp.')
  }
}

function timestampMillis(value) {
  if (value?.toMillis) return value.toMillis()
  if (value?.toDate) return value.toDate().getTime()
  const parsed = value instanceof Date ? value.getTime() : Date.parse(String(value || ''))
  return Number.isFinite(parsed) ? parsed : 0
}

function iso(value) {
  const millis = timestampMillis(value)
  return millis ? new Date(millis).toISOString() : null
}

function publicQuote(id, value = {}, source = 'canonical') {
  const createdAt = iso(value.createdAt || value.date)
  const validUntil = iso(value.validUntil) || (typeof value.validUntil === 'string' ? value.validUntil : null)
  const rawStatus = clean(value.status, 30).toLowerCase()
  const status = QUOTE_STATUSES.has(rawStatus)
    ? rawStatus
    : ['rejected', 'cancelled', 'canceled', 'deleted'].includes(rawStatus) ? 'archived' : 'pending'
  return {
    id,
    source,
    code: clean(value.code, 80) || id.slice(0, 20),
    customerName: clean(value.customerName || value.displayName, 160),
    customerPhone: clean(value.customerPhone || value.phoneNumber, 30),
    normalizedPhone: clean(value.normalizedPhone, 30),
    branchId: clean(value.branchId, 200),
    packageId: clean(value.packageId, 200),
    packageName: clean(value.packageName, 160),
    originalPrice: Math.max(0, Number(value.originalPrice || 0)),
    discount: Math.max(0, Number(value.discount || 0)),
    finalPrice: Math.max(0, Number(value.finalPrice || 0)),
    status,
    revision: Number.isInteger(value.revision) && value.revision >= 0 ? value.revision : 0,
    memberReferralCode: clean(value.memberReferralCode || value.referralCode, 40) || null,
    assignedSalesId: clean(value.assignedSalesId, 200) || null,
    leadId: clean(value.leadId, 200) || null,
    approvalId: clean(value.approvalId, 200) || null,
    approvalStatus: clean(value.approvalStatus, 40) || null,
    createdAt,
    updatedAt: iso(value.updatedAt) || createdAt,
    validUntil,
  }
}

function encodeCursor(item) {
  if (!item?.createdAtMillis || !item?.id) return null
  return Buffer.from(JSON.stringify({ createdAtMillis: item.createdAtMillis, id: item.id }), 'utf8').toString('base64url')
}

function decodeCursor(value) {
  if (!value) return null
  try {
    const parsed = JSON.parse(Buffer.from(String(value), 'base64url').toString('utf8'))
    const createdAtMillis = Number(parsed.createdAtMillis)
    const id = clean(parsed.id, 200)
    if (!Number.isSafeInteger(createdAtMillis) || createdAtMillis <= 0 || !id) throw new Error('invalid')
    return { createdAtMillis, id }
  } catch {
    throw new HttpsError('invalid-argument', 'Con trỏ danh sách báo giá không hợp lệ.')
  }
}

function normalizeStatusFilter(value) {
  const status = clean(value, 30)
  if (!status || status === 'all') return null
  if (!QUOTE_STATUSES.has(status)) throw new HttpsError('invalid-argument', 'Trạng thái báo giá không hợp lệ.')
  return status
}

function normalizeLegacyQuotes(value) {
  return (Array.isArray(value) ? value : [])
    .slice(0, 200)
    .map((item, index) => publicQuote(clean(item?.id, 200) || `legacy-${index + 1}`, item, 'legacy'))
    .sort((left, right) => String(right.createdAt || '').localeCompare(String(left.createdAt || '')) || right.id.localeCompare(left.id))
}

async function listSalesQuotesQuery({ db, actor, data }) {
  requireCapability(actor, QUOTE_CAPABILITY)
  const pageSize = integerInRange(data.pageSize ?? 30, 'Số dòng mỗi trang', 1, MAX_PAGE_SIZE)
  const branchId = clean(data.branchId, 200)
  if (branchId) validDocumentId(branchId, 'Mã chi nhánh')
  if (branchId) assertBranchScope(actor, branchId)
  const status = normalizeStatusFilter(data.status)
  const cursor = decodeCursor(data.cursor)
  const accepted = []
  let scanned = 0
  let scanCursor = cursor
  let exhausted = false

  while (accepted.length <= pageSize && scanned < MAX_SCAN && !exhausted) {
    const batchSize = Math.min(100, MAX_SCAN - scanned)
    let query = db.collection('quotes')
      .orderBy('createdAt', 'desc')
      .orderBy(FieldPath.documentId(), 'desc')
    if (scanCursor) query = query.startAfter(Timestamp.fromMillis(scanCursor.createdAtMillis), scanCursor.id)
    const snapshot = await query.limit(batchSize).get()
    if (snapshot.empty) {
      exhausted = true
      break
    }
    scanned += snapshot.size
    exhausted = snapshot.size < batchSize
    for (const document of snapshot.docs) {
      const value = document.data() || {}
      const createdAtMillis = timestampMillis(value.createdAt)
      scanCursor = { createdAtMillis, id: document.id }
      if (!createdAtMillis) continue
      // Renewal quotes have a separate approval state machine and workspace.
      // Mixing them into this sales conversion queue would expose a misleading
      // "Gửi duyệt" action for statuses such as requires_approval/approved.
      if (value.type === 'renewal') continue
      if (branchId && value.branchId !== branchId) continue
      if (status && value.status !== status) continue
      if (!isElevatedActor(actor) && !(Array.isArray(actor.branchIds) && actor.branchIds.includes(value.branchId))) continue
      accepted.push({ ...publicQuote(document.id, value), createdAtMillis })
      if (accepted.length > pageSize) break
    }
  }

  const page = accepted.slice(0, pageSize)
  const hasMore = accepted.length > pageSize || !exhausted
  const last = page.at(-1)
  let legacyQuotes = []
  if (!cursor && data.includeLegacy === true) {
    const legacySnapshot = await db.doc('schedules/global_schedule').get()
    legacyQuotes = legacySnapshot.exists ? normalizeLegacyQuotes(legacySnapshot.data()?.quotes) : []
  }

  const [branchesSnapshot, packagesSnapshot] = !cursor ? await Promise.all([
    db.collection('branches').limit(100).get(),
    db.collection('packages').limit(200).get(),
  ]) : [{ docs: [] }, { docs: [] }]

  return {
    schemaVersion: 1,
    quotes: page.map(({ createdAtMillis: _createdAtMillis, ...item }) => item),
    legacyQuotes,
    nextCursor: hasMore && last ? encodeCursor(last) : null,
    catalog: {
      branches: branchesSnapshot.docs
        .map((document) => ({ id: document.id, name: clean(document.data()?.name, 160) || document.id, status: document.data()?.status || 'active' }))
        .filter((item) => item.status !== 'archived' && (isElevatedActor(actor) || (Array.isArray(actor.branchIds) && actor.branchIds.includes(item.id)))),
      packages: packagesSnapshot.docs
        .map((document) => ({ id: document.id, name: clean(document.data()?.name, 160) || document.id, price: Math.max(0, Number(document.data()?.price || 0)), branchId: clean(document.data()?.branchId, 200) || null, status: document.data()?.status || 'active' }))
        .filter((item) => !['archived', 'inactive'].includes(item.status) && (!item.branchId || isElevatedActor(actor) || (Array.isArray(actor.branchIds) && actor.branchIds.includes(item.branchId)))),
    },
    scan: { scanned, capped: scanned >= MAX_SCAN && !exhausted },
  }
}

function quoteAudit({ operation, actor, quoteId, branchId, revision, correlationId, approvalId = null }) {
  return {
    schemaVersion: 1,
    action: `sales_quote.${operation}`,
    domain: 'sales',
    sourceType: 'quote',
    sourceId: quoteId,
    quoteId,
    branchId,
    revision,
    approvalId,
    actorUid: actor.uid,
    correlationId: correlationId || null,
    createdAt: FieldValue.serverTimestamp(),
  }
}

async function createSalesQuoteCommand({ db, actor, data, correlationId, now = new Date() }) {
  requireCapability(actor, QUOTE_CAPABILITY)
  const customerName = clean(data.customerName, 160)
  if (customerName.length < 2) throw new HttpsError('invalid-argument', 'Tên khách hàng phải có ít nhất 2 ký tự.')
  const customerPhone = clean(data.customerPhone, 30)
  const phone = normalizedPhone(customerPhone, true)
  const branchId = validDocumentId(data.branchId, 'Mã chi nhánh')
  const packageId = validDocumentId(data.packageId, 'Mã gói tập')
  const idempotencyKey = validIdempotencyKey(data.idempotencyKey)
  const rawReferralCode = clean(data.memberReferralCode, 40)
  const memberReferralCode = normalizeMemberReferralCode(rawReferralCode)
  if (rawReferralCode && !memberReferralCode) throw new HttpsError('invalid-argument', 'Mã giới thiệu Aura không hợp lệ.')
  assertBranchScope(actor, branchId)
  const operation = 'create'
  const normalizedPayload = { customerName, customerPhone, normalizedPhone: phone, branchId, packageId, discount: Number(data.discount || 0), memberReferralCode: memberReferralCode || null }
  const hash = payloadHash(operation, normalizedPayload)
  const commandReceiptId = receiptId(actor.uid, idempotencyKey)
  const quoteId = quoteIdForCreate(actor.uid, idempotencyKey, now)
  const quoteReference = db.doc(`quotes/${quoteId}`)
  const receiptReference = db.doc(`quoteCommandReceipts/${commandReceiptId}`)
  const auditReference = db.doc(`auditLogs/quote_command_${commandReceiptId}`)

  return db.runTransaction(async (transaction) => {
    const existingReceipt = receiptResult(await transaction.get(receiptReference), operation, hash)
    if (existingReceipt) return existingReceipt
    const packageSnapshot = await transaction.get(db.doc(`packages/${packageId}`))
    const branchSnapshot = await transaction.get(db.doc(`branches/${branchId}`))
    const referralSnapshot = memberReferralCode ? await transaction.get(db.doc(`memberReferralCodes/${memberReferralCode}`)) : null
    const existingQuote = await transaction.get(quoteReference)
    if (existingQuote.exists) throw new HttpsError('already-exists', 'Báo giá đã tồn tại. Hãy tải lại danh sách.')
    if (!packageSnapshot.exists || ['archived', 'inactive'].includes(packageSnapshot.data()?.status)) {
      throw new HttpsError('failed-precondition', 'Gói tập không tồn tại hoặc đã ngừng áp dụng.')
    }
    if (!branchSnapshot.exists || branchSnapshot.data()?.status === 'archived') {
      throw new HttpsError('failed-precondition', 'Chi nhánh không tồn tại hoặc đã ngừng hoạt động.')
    }
    const packageValue = packageSnapshot.data() || {}
    if (packageValue.branchId && packageValue.branchId !== branchId) {
      throw new HttpsError('failed-precondition', 'Gói tập không áp dụng tại chi nhánh đã chọn.')
    }
    const originalPrice = integerInRange(packageValue.price || 0, 'Giá gói tập', 0, 1_000_000_000_000)
    const discount = integerInRange(data.discount || 0, 'Giảm giá', 0, Math.max(0, Math.round(originalPrice * 0.2)))
    let memberReferrerStudentId = null
    if (memberReferralCode) {
      if (!referralSnapshot?.exists || referralSnapshot.data()?.status !== 'active') {
        throw new HttpsError('not-found', 'Mã giới thiệu Aura không tồn tại hoặc đã ngừng hoạt động.')
      }
      memberReferrerStudentId = clean(referralSnapshot.data()?.studentId, 200) || null
      if (memberReferrerStudentId) {
        const referrerSnapshot = await transaction.get(db.doc(`students/${memberReferrerStudentId}`))
        const referrerPhone = normalizedPhone(referrerSnapshot.exists ? referrerSnapshot.data()?.phone || referrerSnapshot.data()?.phoneNumber : '')
        if (referrerPhone && referrerPhone === phone) throw new HttpsError('failed-precondition', 'Không thể dùng mã giới thiệu cho chính chủ mã.')
      }
    }
    const createdAt = Timestamp.fromDate(now)
    const validUntil = Timestamp.fromDate(new Date(now.getTime() + 7 * 86_400_000))
    const code = `AQ-${now.toISOString().slice(0, 10).replace(/-/g, '')}-${commandHash(quoteId).slice(0, 6).toUpperCase()}`
    const quote = {
      schemaVersion: 3,
      id: quoteId,
      code,
      customerName,
      customerPhone,
      normalizedPhone: phone,
      branchId,
      packageId,
      packageName: clean(packageValue.name, 160),
      packageSnapshot: {
        name: clean(packageValue.name, 160),
        totalSessions: Math.max(0, Number(packageValue.totalSessions || 0)),
        durationMonths: Math.max(0, Number(packageValue.durationMonths || 0)),
        price: originalPrice,
        revision: Number.isInteger(packageValue.revision) ? packageValue.revision : 0,
      },
      originalPrice,
      discount,
      finalPrice: originalPrice - discount,
      memberReferralCode: memberReferralCode || null,
      memberReferrerStudentId,
      assignedSalesId: actor.uid,
      status: 'pending',
      revision: 1,
      leadId: null,
      approvalId: null,
      approvalStatus: null,
      createdBy: actor.uid,
      createdAt,
      updatedBy: actor.uid,
      updatedAt: createdAt,
      validUntil,
    }
    transaction.create(quoteReference, quote)
    const result = { schemaVersion: 1, quote: publicQuote(quoteId, quote), unchanged: false }
    transaction.create(receiptReference, { schemaVersion: 1, operation, actorUid: actor.uid, quoteId, payloadHash: hash, result, createdAt })
    transaction.create(auditReference, quoteAudit({ operation, actor, quoteId, branchId, revision: 1, correlationId }))
    return result
  })
}

async function archiveSalesQuoteCommand({ db, actor, data, correlationId }) {
  requireCapability(actor, QUOTE_CAPABILITY)
  const quoteId = validDocumentId(data.quoteId, 'Mã báo giá')
  const expectedRevision = normalizedRevision(data.expectedRevision)
  const idempotencyKey = validIdempotencyKey(data.idempotencyKey)
  const operation = 'archive'
  const hash = payloadHash(operation, { quoteId, expectedRevision })
  const commandReceiptId = receiptId(actor.uid, idempotencyKey)
  const quoteReference = db.doc(`quotes/${quoteId}`)
  const receiptReference = db.doc(`quoteCommandReceipts/${commandReceiptId}`)
  const auditReference = db.doc(`auditLogs/quote_command_${commandReceiptId}`)

  return db.runTransaction(async (transaction) => {
    const existingReceipt = receiptResult(await transaction.get(receiptReference), operation, hash)
    if (existingReceipt) return existingReceipt
    const snapshot = await transaction.get(quoteReference)
    if (!snapshot.exists) throw new HttpsError('not-found', 'Không tìm thấy báo giá.')
    const quote = snapshot.data() || {}
    assertBranchScope(actor, quote.branchId)
    if (quote.status === 'archived') throw new HttpsError('failed-precondition', 'Báo giá đã được lưu trữ.')
    if (quote.status === 'accepted') throw new HttpsError('failed-precondition', 'Báo giá đã gửi duyệt hợp đồng và không thể lưu trữ.')
    const currentRevision = Number.isInteger(quote.revision) ? quote.revision : 0
    if (currentRevision !== expectedRevision) throw new HttpsError('aborted', 'Báo giá vừa được người khác cập nhật. Hãy tải lại dữ liệu.')
    const revision = currentRevision + 1
    const now = FieldValue.serverTimestamp()
    transaction.update(quoteReference, { status: 'archived', revision, archivedAt: now, archivedBy: actor.uid, updatedAt: now, updatedBy: actor.uid })
    const result = { schemaVersion: 1, quoteId, status: 'archived', revision, unchanged: false }
    transaction.create(receiptReference, { schemaVersion: 1, operation, actorUid: actor.uid, quoteId, payloadHash: hash, result, createdAt: now })
    transaction.create(auditReference, quoteAudit({ operation, actor, quoteId, branchId: quote.branchId, revision, correlationId }))
    return result
  })
}

async function acceptSalesQuoteCommand({ db, actor, data, correlationId }) {
  requireCapability(actor, QUOTE_CAPABILITY)
  const quoteId = validDocumentId(data.quoteId, 'Mã báo giá')
  const expectedRevision = normalizedRevision(data.expectedRevision)
  const idempotencyKey = validIdempotencyKey(data.idempotencyKey)
  const suppliedStudentId = clean(data.studentId, 200)
  const suppliedLeadId = clean(data.leadId, 200)
  if (suppliedStudentId && suppliedLeadId) throw new HttpsError('invalid-argument', 'Chỉ được liên kết một học viên hoặc một lead.')
  if (suppliedStudentId) validDocumentId(suppliedStudentId, 'Mã học viên')
  if (suppliedLeadId) validDocumentId(suppliedLeadId, 'Mã lead')
  const operation = 'accept'
  const hash = payloadHash(operation, { quoteId, expectedRevision, studentId: suppliedStudentId || null, leadId: suppliedLeadId || null })
  const commandReceiptId = receiptId(actor.uid, idempotencyKey)
  const quoteReference = db.doc(`quotes/${quoteId}`)
  const receiptReference = db.doc(`quoteCommandReceipts/${commandReceiptId}`)
  const auditReference = db.doc(`auditLogs/quote_command_${commandReceiptId}`)
  const generatedLeadId = `lead_${commandHash(`quote\n${quoteId}`).slice(0, 32)}`
  const leadReference = db.doc(`salesLeads/${suppliedLeadId || generatedLeadId}`)
  const approvalId = `quote_${commandHash(`approval\n${quoteId}`).slice(0, 36)}`
  const approvalReference = db.doc(`contractApprovals/${approvalId}`)

  return db.runTransaction(async (transaction) => {
    const existingReceipt = receiptResult(await transaction.get(receiptReference), operation, hash)
    if (existingReceipt) return existingReceipt
    const quoteSnapshot = await transaction.get(quoteReference)
    const leadSnapshot = await transaction.get(leadReference)
    const studentSnapshot = suppliedStudentId ? await transaction.get(db.doc(`students/${suppliedStudentId}`)) : null
    const approvalSnapshot = await transaction.get(approvalReference)
    if (!quoteSnapshot.exists) throw new HttpsError('not-found', 'Không tìm thấy báo giá.')
    const quote = quoteSnapshot.data() || {}
    assertBranchScope(actor, quote.branchId)
    if (quote.status !== 'pending') throw new HttpsError('failed-precondition', 'Chỉ báo giá đang chờ mới có thể gửi duyệt hợp đồng.')
    const currentRevision = Number.isInteger(quote.revision) ? quote.revision : 0
    if (currentRevision !== expectedRevision) throw new HttpsError('aborted', 'Báo giá vừa được người khác cập nhật. Hãy tải lại dữ liệu.')
    if (suppliedStudentId) {
      if (!studentSnapshot?.exists) throw new HttpsError('not-found', 'Không tìm thấy học viên được chọn.')
      if (studentSnapshot.data()?.branchId && studentSnapshot.data().branchId !== quote.branchId) {
        throw new HttpsError('failed-precondition', 'Học viên và báo giá không cùng chi nhánh.')
      }
    }
    if (suppliedLeadId) {
      if (!leadSnapshot.exists) throw new HttpsError('not-found', 'Không tìm thấy lead được chọn.')
      if (leadSnapshot.data()?.branchId !== quote.branchId) throw new HttpsError('failed-precondition', 'Lead và báo giá không cùng chi nhánh.')
    } else if (leadSnapshot.exists && leadSnapshot.data()?.sourceQuoteId !== quoteId) {
      throw new HttpsError('already-exists', 'Mã lead dành cho báo giá đã được dùng bởi dữ liệu khác.')
    }
    if (approvalSnapshot.exists) throw new HttpsError('already-exists', 'Báo giá đã có hồ sơ duyệt hợp đồng.')

    const now = FieldValue.serverTimestamp()
    const linkedStudentId = suppliedStudentId || clean(leadSnapshot.data()?.linkedStudentId, 200) || null
    if (!suppliedLeadId && !leadSnapshot.exists) {
      transaction.create(leadReference, {
        schemaVersion: 2,
        displayName: quote.customerName,
        phoneNumber: quote.customerPhone,
        normalizedPhone: quote.normalizedPhone || normalizedPhone(quote.customerPhone),
        branchId: quote.branchId,
        assignedSalesId: quote.assignedSalesId || actor.uid,
        linkedStudentId,
        sourceQuoteId: quoteId,
        status: 'contract_review',
        createdBy: actor.uid,
        createdAt: now,
        updatedBy: actor.uid,
        updatedAt: now,
      })
    } else {
      transaction.set(leadReference, { linkedStudentId, status: 'contract_review', sourceQuoteId: quoteId, updatedBy: actor.uid, updatedAt: now }, { merge: true })
    }
    transaction.create(approvalReference, {
      schemaVersion: 3,
      leadId: leadReference.id,
      linkedStudentId,
      quoteId,
      branchId: quote.branchId,
      assignedSalesId: quote.assignedSalesId || actor.uid,
      memberReferralCode: quote.memberReferralCode || null,
      memberReferrerStudentId: quote.memberReferrerStudentId || null,
      status: 'pending',
      submittedBy: actor.uid,
      createdBy: actor.uid,
      submittedAt: now,
      createdAt: now,
      updatedAt: now,
    })
    const revision = currentRevision + 1
    transaction.update(quoteReference, { status: 'accepted', revision, leadId: leadReference.id, approvalId, approvalStatus: 'pending', acceptedAt: now, acceptedBy: actor.uid, updatedAt: now, updatedBy: actor.uid })
    const result = { schemaVersion: 1, quoteId, status: 'accepted', revision, leadId: leadReference.id, approvalId, approvalStatus: 'pending', unchanged: false }
    transaction.create(receiptReference, { schemaVersion: 1, operation, actorUid: actor.uid, quoteId, payloadHash: hash, result, createdAt: now })
    transaction.create(auditReference, quoteAudit({ operation, actor, quoteId, branchId: quote.branchId, revision, correlationId, approvalId }))
    return result
  })
}

function createQuoteManagementFunctions({ db, onCall, accessContextResolver = trustedAccessContext }) {
  const listSalesQuotes = onCall(withFunctionTelemetry('listSalesQuotes', async (request) => {
    const actor = await accessContextResolver(request, db)
    return listSalesQuotesQuery({ db, actor, data: request.data || {} })
  }))
  const createSalesQuote = onCall(withFunctionTelemetry('createSalesQuote', async (request) => {
    const actor = await accessContextResolver(request, db)
    return createSalesQuoteCommand({ db, actor, data: request.data || {}, correlationId: request.auraCorrelationId })
  }))
  const archiveSalesQuote = onCall(withFunctionTelemetry('archiveSalesQuote', async (request) => {
    const actor = await accessContextResolver(request, db)
    return archiveSalesQuoteCommand({ db, actor, data: request.data || {}, correlationId: request.auraCorrelationId })
  }))
  const acceptSalesQuote = onCall(withFunctionTelemetry('acceptSalesQuote', async (request) => {
    const actor = await accessContextResolver(request, db)
    return acceptSalesQuoteCommand({ db, actor, data: request.data || {}, correlationId: request.auraCorrelationId })
  }))
  return { listSalesQuotes, createSalesQuote, archiveSalesQuote, acceptSalesQuote }
}

module.exports = {
  QUOTE_CAPABILITY,
  acceptSalesQuoteCommand,
  archiveSalesQuoteCommand,
  createQuoteManagementFunctions,
  createSalesQuoteCommand,
  decodeCursor,
  encodeCursor,
  normalizeLegacyQuotes,
  normalizedPhone,
  publicQuote,
  quoteIdForCreate,
}
