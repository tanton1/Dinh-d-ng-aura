'use strict'

const { createHash } = require('node:crypto')
const { FieldPath, FieldValue, Timestamp } = require('firebase-admin/firestore')
const { HttpsError } = require('firebase-functions/v2/https')
const { trustedAccessContext, requireCapability } = require('./identity-access')
const { withFunctionTelemetry } = require('./observability')

const RESOURCE_COLLECTION = 'operatingKnowledge'
const RECEIPT_COLLECTION = 'sopCommandReceipts'
const AUDIT_COLLECTION = 'sopAuditLogs'
const MAX_PAGE_SIZE = 100
const MAX_SCAN = 500
const MAX_PAYLOAD_BYTES = 850_000
const KINDS = new Set(['sop', 'skill', 'script', 'dialogue', 'objection', 'policy', 'variable', 'kpi', 'escalation', 'price', 'promotion', 'voice'])
const STATUSES = new Set(['draft', 'review', 'approved', 'live'])
const TRANSITIONS = {
  draft: new Set(['review']),
  review: new Set(['draft', 'approved']),
  approved: new Set(['draft', 'live']),
  live: new Set(['draft']),
}

function clean(value, maximum = 240, required = false, label = 'Giá trị') {
  const result = typeof value === 'string' ? value.trim().slice(0, maximum) : ''
  if (required && !result) throw new HttpsError('invalid-argument', `${label} không được để trống.`)
  return result
}

function cleanArray(value, maximumItems = 30, maximumLength = 120) {
  if (!Array.isArray(value)) return []
  return [...new Set(value.map((item) => clean(item, maximumLength)).filter(Boolean))].slice(0, maximumItems)
}

function cleanMetrics(value) {
  const metric = (key) => Math.max(0, Math.min(100_000, Math.floor(Number(value?.[key]) || 0)))
  return {
    phraseCount: metric('phraseCount'),
    situationCount: metric('situationCount'),
    variantCount: metric('variantCount'),
  }
}

function timestampIso(value) {
  if (value?.toDate) return value.toDate().toISOString()
  if (value instanceof Date) return value.toISOString()
  const date = new Date(String(value || ''))
  return Number.isNaN(date.getTime()) ? new Date(0).toISOString() : date.toISOString()
}

function normalizeSearch(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function jsonClone(value) {
  try {
    return JSON.parse(JSON.stringify(value ?? {}))
  } catch {
    throw new HttpsError('invalid-argument', 'Nội dung tài liệu không phải JSON hợp lệ.')
  }
}

function validatedPayload(value) {
  const payload = jsonClone(value)
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new HttpsError('invalid-argument', 'Nội dung tài liệu phải là một object.')
  }
  const bytes = Buffer.byteLength(JSON.stringify(payload), 'utf8')
  if (bytes > MAX_PAYLOAD_BYTES) throw new HttpsError('invalid-argument', 'Nội dung tài liệu vượt giới hạn 850 KB.')
  return payload
}

function contentHash(resource) {
  return createHash('sha256').update(JSON.stringify({
    kind: resource.kind,
    code: resource.code,
    title: resource.title,
    summary: resource.summary,
    ownerRole: resource.ownerRole,
    audiences: resource.audiences,
    branchScope: resource.branchScope,
    tags: resource.tags,
    relatedSopIds: resource.relatedSopIds,
    relatedSkillIds: resource.relatedSkillIds,
    contentMetrics: resource.contentMetrics,
    payload: resource.payload,
  })).digest('hex')
}

function commandReceiptId(actorUid, idempotencyKey) {
  const key = clean(idempotencyKey, 160, true, 'Khóa chống lặp')
  return createHash('sha256').update(`${actorUid}|${key}`).digest('hex')
}

function documentId(value, label = 'Mã tài liệu') {
  const result = clean(value, 180, true, label)
  if (!/^[A-Za-z0-9._:-]+$/.test(result) || result.includes('/')) {
    throw new HttpsError('invalid-argument', `${label} không hợp lệ.`)
  }
  return result
}

function nextVersionId(revision) {
  return `r${String(revision).padStart(6, '0')}`
}

function publicResource(id, value) {
  const branchScope = cleanArray(value.branchScope)
  return {
    id,
    schemaVersion: 1,
    kind: value.kind,
    sourceId: clean(value.sourceId, 180) || id,
    code: clean(value.code, 120),
    title: clean(value.title, 240),
    summary: clean(value.summary, 2_000),
    status: STATUSES.has(value.status) ? value.status : 'draft',
    version: clean(value.version, 40) || '1.0',
    revision: Math.max(1, Number(value.revision || 1)),
    publishedVersionId: clean(value.publishedVersionId, 80) || null,
    ownerRole: clean(value.ownerRole, 80) || 'admin',
    audiences: cleanArray(value.audiences),
    branchScope: branchScope.length ? branchScope : ['all'],
    tags: cleanArray(value.tags, 40),
    relatedSopIds: cleanArray(value.relatedSopIds, 20, 80),
    relatedSkillIds: cleanArray(value.relatedSkillIds, 30, 40),
    contentMetrics: cleanMetrics(value.contentMetrics),
    searchText: clean(value.searchText, 45_000),
    sortKey: clean(value.sortKey, 360),
    sourceSystem: clean(value.sourceSystem, 120) || 'aura-admin',
    sourceReviewRequired: value.sourceReviewRequired === true,
    updatedAt: timestampIso(value.updatedAt),
    updatedBy: clean(value.updatedBy, 180),
    payload: jsonClone(value.payload),
  }
}

function publicSummary(id, value) {
  const { payload, searchText, ...summary } = publicResource(id, value)
  return summary
}

function publicVersion(id, value) {
  return {
    id,
    version: clean(value.version, 40),
    revision: Number(value.revision || 0),
    status: STATUSES.has(value.status) ? value.status : 'draft',
    note: clean(value.note, 600),
    contentHash: clean(value.contentHash, 64),
    createdAt: timestampIso(value.createdAt),
    createdBy: clean(value.createdBy, 180),
    snapshot: jsonClone(value.snapshot),
  }
}

function normalizeDraftInput(input, existing = {}) {
  const kind = clean(input?.kind, 40)
  if (!KINDS.has(kind)) throw new HttpsError('invalid-argument', 'Loại tài liệu không hợp lệ.')
  const title = clean(input?.title, 240, true, 'Tên tài liệu')
  const code = clean(input?.code, 120) || title
  const summary = clean(input?.summary, 2_000)
  const ownerRole = clean(input?.ownerRole, 80) || 'admin'
  const audiences = cleanArray(input?.audiences)
  const cleanBranchScope = cleanArray(input?.branchScope)
  const branchScope = cleanBranchScope.length ? cleanBranchScope : ['all']
  const tags = cleanArray(input?.tags, 40)
  const relatedSopIds = cleanArray(input?.relatedSopIds, 20, 80)
  const relatedSkillIds = cleanArray(input?.relatedSkillIds, 30, 40)
  const contentMetrics = cleanMetrics(input?.contentMetrics)
  const payload = validatedPayload(input?.payload)
  const searchable = normalizeSearch([code, title, summary, ownerRole, ...audiences, ...tags, JSON.stringify(payload)].join(' ')).slice(0, 45_000)
  return {
    schemaVersion: 1,
    kind,
    sourceId: clean(existing.sourceId, 180),
    code,
    title,
    summary,
    ownerRole,
    audiences,
    branchScope,
    tags,
    relatedSopIds,
    relatedSkillIds,
    contentMetrics,
    searchText: searchable,
    sortKey: `${kind}:${normalizeSearch(title)}`.slice(0, 360),
    sourceSystem: clean(existing.sourceSystem, 120) || 'aura-admin',
    sourceReviewRequired: existing.sourceReviewRequired === true,
    payload,
  }
}

function versionDocument(resource, versionId, actor, note, createdAt) {
  const snapshot = publicResource(resource.id, { ...resource, updatedAt: createdAt })
  return {
    resourceId: resource.id,
    version: resource.version,
    revision: resource.revision,
    status: resource.status,
    note: clean(note, 600),
    contentHash: contentHash(resource),
    createdAt,
    createdBy: actor.uid,
    snapshot,
    versionId,
  }
}

function auditDocument(resource, versionId, actor, action, note, createdAt) {
  return {
    schemaVersion: 1,
    resourceId: resource.id,
    resourceKind: resource.kind,
    revision: resource.revision,
    versionId,
    action,
    status: resource.status,
    note: clean(note, 600),
    actorUid: actor.uid,
    actorName: clean(actor.actorName, 160),
    createdAt,
  }
}

async function resultFromPointer(db, pointer) {
  const versionSnapshot = await db.doc(`${RESOURCE_COLLECTION}/${pointer.resourceId}/versions/${pointer.versionId}`).get()
  if (!versionSnapshot.exists) throw new HttpsError('internal', 'Không thể đọc phiên bản tài liệu vừa ghi.')
  return publicResource(pointer.resourceId, versionSnapshot.data().snapshot)
}

function normalizePageSize(value) {
  const number = Number(value)
  return Number.isInteger(number) ? Math.min(MAX_PAGE_SIZE, Math.max(1, number)) : 40
}

function createSopCenterFunctions({ db, onCall, logger = console }) {
  const listSopKnowledge = onCall(withFunctionTelemetry('listSopKnowledge', async (request) => {
    const actor = await trustedAccessContext(request, db)
    requireCapability(actor, 'sop.content.read')
    const pageSize = normalizePageSize(request.data?.pageSize)
    const cursor = clean(request.data?.cursor, 180)
    const kinds = new Set((Array.isArray(request.data?.kinds) ? request.data.kinds : []).filter((item) => KINDS.has(item)))
    const statuses = new Set((Array.isArray(request.data?.statuses) ? request.data.statuses : []).filter((item) => STATUSES.has(item)))
    const queryTokens = normalizeSearch(clean(request.data?.query, 240)).split(' ').filter(Boolean)
    let query = db.collection(RESOURCE_COLLECTION).orderBy(FieldPath.documentId()).limit(MAX_SCAN)
    if (cursor) query = query.startAfter(cursor)
    const snapshot = await query.get()
    const rows = []
    let lastProcessedId = ''
    let processed = 0
    for (const document of snapshot.docs) {
      processed += 1
      lastProcessedId = document.id
      const value = document.data()
      if (kinds.size && !kinds.has(value.kind)) continue
      if (statuses.size && !statuses.has(value.status)) continue
      const haystack = String(value.searchText || '')
      if (queryTokens.length && !queryTokens.every((token) => haystack.includes(token))) continue
      rows.push(publicSummary(document.id, value))
      if (rows.length >= pageSize) break
    }
    const hasMore = processed < snapshot.size || snapshot.size === MAX_SCAN
    logger.info?.('sop_knowledge_listed', { actorUid: actor.uid, rowCount: rows.length, pageSize })
    return { schemaVersion: 1, rows, total: rows.length, hasMore, nextCursor: hasMore ? lastProcessedId : null }
  }))

  const getSopKnowledge = onCall(withFunctionTelemetry('getSopKnowledge', async (request) => {
    const actor = await trustedAccessContext(request, db)
    requireCapability(actor, 'sop.content.read')
    const resourceId = documentId(request.data?.resourceId)
    const resourceRef = db.doc(`${RESOURCE_COLLECTION}/${resourceId}`)
    const [resourceSnapshot, versionsSnapshot] = await Promise.all([
      resourceRef.get(),
      resourceRef.collection('versions').orderBy('revision', 'desc').limit(30).get(),
    ])
    if (!resourceSnapshot.exists) throw new HttpsError('not-found', 'Không tìm thấy tài liệu SOP.')
    return {
      schemaVersion: 1,
      resource: publicResource(resourceId, resourceSnapshot.data()),
      versions: versionsSnapshot.docs.map((item) => publicVersion(item.id, item.data())),
    }
  }))

  const saveSopKnowledgeDraft = onCall(withFunctionTelemetry('saveSopKnowledgeDraft', async (request) => {
    const actor = await trustedAccessContext(request, db, { freshAssignment: true })
    requireCapability(actor, 'sop.content.edit')
    const receiptId = commandReceiptId(actor.uid, request.data?.idempotencyKey)
    const expectedRevision = Math.max(0, Number(request.data?.expectedRevision || 0))
    const suppliedId = clean(request.data?.resourceId, 180)
    const generatedId = `${clean(request.data?.resource?.kind, 40)}__${receiptId.slice(0, 18)}`
    const resourceId = documentId(suppliedId || generatedId)
    const resourceRef = db.doc(`${RESOURCE_COLLECTION}/${resourceId}`)
    const receiptRef = db.doc(`${RECEIPT_COLLECTION}/${receiptId}`)
    const pointer = await db.runTransaction(async (transaction) => {
      const receiptSnapshot = await transaction.get(receiptRef)
      if (receiptSnapshot.exists) return receiptSnapshot.data()
      const existingSnapshot = await transaction.get(resourceRef)
      const existing = existingSnapshot.exists ? existingSnapshot.data() : {}
      const currentRevision = existingSnapshot.exists ? Number(existing.revision || 0) : 0
      if (currentRevision !== expectedRevision) {
        throw new HttpsError('aborted', 'Tài liệu đã thay đổi. Hãy tải lại phiên bản mới nhất trước khi lưu.')
      }
      const normalized = normalizeDraftInput(request.data?.resource, existing)
      const revision = currentRevision + 1
      const versionId = nextVersionId(revision)
      const now = Timestamp.now()
      const versionLabel = `${Math.max(1, Number(String(existing.version || '0').split('.')[0]) || 1)}.${revision}`
      const resource = {
        id: resourceId,
        ...normalized,
        sourceId: normalized.sourceId || resourceId,
        status: 'draft',
        version: versionLabel,
        revision,
        publishedVersionId: clean(existing.publishedVersionId, 80) || null,
        updatedAt: now,
        updatedBy: actor.uid,
        createdAt: existing.createdAt || now,
        createdBy: existing.createdBy || actor.uid,
      }
      const version = versionDocument(resource, versionId, actor, request.data?.note || 'Lưu bản nháp', now)
      transaction.set(resourceRef, resource)
      transaction.create(resourceRef.collection('versions').doc(versionId), version)
      transaction.create(db.doc(`${AUDIT_COLLECTION}/${resourceId}__${versionId}`), auditDocument(resource, versionId, actor, 'draft.saved', request.data?.note, now))
      const result = { resourceId, versionId, revision, createdAt: now }
      transaction.create(receiptRef, { ...result, actorUid: actor.uid, command: 'saveSopKnowledgeDraft', expiresAt: Timestamp.fromMillis(Date.now() + 30 * 24 * 60 * 60 * 1000) })
      return result
    })
    return { schemaVersion: 1, resource: await resultFromPointer(db, pointer) }
  }))

  const transitionSopKnowledge = onCall(withFunctionTelemetry('transitionSopKnowledge', async (request) => {
    const actor = await trustedAccessContext(request, db, { freshAssignment: true })
    const resourceId = documentId(request.data?.resourceId)
    const targetStatus = clean(request.data?.targetStatus, 40)
    if (!STATUSES.has(targetStatus)) throw new HttpsError('invalid-argument', 'Trạng thái đích không hợp lệ.')
    const receiptId = commandReceiptId(actor.uid, request.data?.idempotencyKey)
    const expectedRevision = Math.max(1, Number(request.data?.expectedRevision || 0))
    const resourceRef = db.doc(`${RESOURCE_COLLECTION}/${resourceId}`)
    const receiptRef = db.doc(`${RECEIPT_COLLECTION}/${receiptId}`)
    const pointer = await db.runTransaction(async (transaction) => {
      const receiptSnapshot = await transaction.get(receiptRef)
      if (receiptSnapshot.exists) return receiptSnapshot.data()
      const resourceSnapshot = await transaction.get(resourceRef)
      if (!resourceSnapshot.exists) throw new HttpsError('not-found', 'Không tìm thấy tài liệu SOP.')
      const current = resourceSnapshot.data()
      if (Number(current.revision || 0) !== expectedRevision) {
        throw new HttpsError('aborted', 'Tài liệu đã thay đổi. Hãy tải lại trước khi duyệt.')
      }
      if (!TRANSITIONS[current.status]?.has(targetStatus)) {
        throw new HttpsError('failed-precondition', `Không thể chuyển từ ${current.status} sang ${targetStatus}.`)
      }
      const capability = targetStatus === 'live'
        ? 'sop.content.publish'
        : current.status === 'review' || targetStatus === 'approved'
          ? 'sop.content.review'
          : 'sop.content.edit'
      requireCapability(actor, capability)
      const revision = expectedRevision + 1
      const versionId = nextVersionId(revision)
      const now = Timestamp.now()
      const resource = {
        id: resourceId,
        ...current,
        status: targetStatus,
        revision,
        version: `${Math.max(1, Number(String(current.version || '1').split('.')[0]) || 1)}.${revision}`,
        publishedVersionId: targetStatus === 'live' ? versionId : (current.publishedVersionId || null),
        updatedAt: now,
        updatedBy: actor.uid,
      }
      const version = versionDocument(resource, versionId, actor, request.data?.note || `Chuyển sang ${targetStatus}`, now)
      transaction.set(resourceRef, resource)
      transaction.create(resourceRef.collection('versions').doc(versionId), version)
      transaction.create(db.doc(`${AUDIT_COLLECTION}/${resourceId}__${versionId}`), auditDocument(resource, versionId, actor, `status.${targetStatus}`, request.data?.note, now))
      const result = { resourceId, versionId, revision, createdAt: now }
      transaction.create(receiptRef, { ...result, actorUid: actor.uid, command: 'transitionSopKnowledge', expiresAt: Timestamp.fromMillis(Date.now() + 30 * 24 * 60 * 60 * 1000) })
      return result
    })
    return { schemaVersion: 1, resource: await resultFromPointer(db, pointer) }
  }))

  const restoreSopKnowledgeVersion = onCall(withFunctionTelemetry('restoreSopKnowledgeVersion', async (request) => {
    const actor = await trustedAccessContext(request, db, { freshAssignment: true })
    requireCapability(actor, 'sop.content.edit')
    const resourceId = documentId(request.data?.resourceId)
    const sourceVersionId = documentId(request.data?.versionId, 'Mã phiên bản')
    const expectedRevision = Math.max(1, Number(request.data?.expectedRevision || 0))
    const receiptId = commandReceiptId(actor.uid, request.data?.idempotencyKey)
    const resourceRef = db.doc(`${RESOURCE_COLLECTION}/${resourceId}`)
    const sourceVersionRef = resourceRef.collection('versions').doc(sourceVersionId)
    const receiptRef = db.doc(`${RECEIPT_COLLECTION}/${receiptId}`)
    const pointer = await db.runTransaction(async (transaction) => {
      const receiptSnapshot = await transaction.get(receiptRef)
      if (receiptSnapshot.exists) return receiptSnapshot.data()
      const [resourceSnapshot, sourceVersionSnapshot] = await Promise.all([
        transaction.get(resourceRef), transaction.get(sourceVersionRef),
      ])
      if (!resourceSnapshot.exists || !sourceVersionSnapshot.exists) throw new HttpsError('not-found', 'Không tìm thấy tài liệu hoặc phiên bản cần khôi phục.')
      const current = resourceSnapshot.data()
      if (Number(current.revision || 0) !== expectedRevision) throw new HttpsError('aborted', 'Tài liệu đã thay đổi. Hãy tải lại trước khi khôi phục.')
      const restored = sourceVersionSnapshot.data().snapshot
      const revision = expectedRevision + 1
      const versionId = nextVersionId(revision)
      const now = Timestamp.now()
      const resource = {
        id: resourceId,
        ...current,
        kind: restored.kind,
        code: restored.code,
        title: restored.title,
        summary: restored.summary,
        ownerRole: restored.ownerRole,
        audiences: restored.audiences,
        branchScope: restored.branchScope,
        tags: restored.tags,
        relatedSopIds: restored.relatedSopIds,
        relatedSkillIds: restored.relatedSkillIds,
        contentMetrics: restored.contentMetrics,
        searchText: restored.searchText,
        sortKey: restored.sortKey,
        payload: validatedPayload(restored.payload),
        status: 'draft',
        revision,
        version: `${Math.max(1, Number(String(current.version || '1').split('.')[0]) || 1)}.${revision}`,
        updatedAt: now,
        updatedBy: actor.uid,
      }
      const version = versionDocument(resource, versionId, actor, request.data?.note || `Khôi phục ${sourceVersionId}`, now)
      transaction.set(resourceRef, resource)
      transaction.create(resourceRef.collection('versions').doc(versionId), version)
      transaction.create(db.doc(`${AUDIT_COLLECTION}/${resourceId}__${versionId}`), auditDocument(resource, versionId, actor, 'version.restored', request.data?.note, now))
      const result = { resourceId, versionId, revision, createdAt: now }
      transaction.create(receiptRef, { ...result, actorUid: actor.uid, command: 'restoreSopKnowledgeVersion', expiresAt: Timestamp.fromMillis(Date.now() + 30 * 24 * 60 * 60 * 1000) })
      return result
    })
    return { schemaVersion: 1, resource: await resultFromPointer(db, pointer) }
  }))

  return { listSopKnowledge, getSopKnowledge, saveSopKnowledgeDraft, transitionSopKnowledge, restoreSopKnowledgeVersion }
}

module.exports = {
  createSopCenterFunctions,
  canTransitionSopStatus: (from, to) => Boolean(TRANSITIONS[from]?.has(to)),
  contentHash,
  normalizeSearch,
  publicResource,
}
