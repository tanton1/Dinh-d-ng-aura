'use strict'

// CRM callables. Three endpoints keep the Cloud Run footprint small:
//   crmQuery              reads (inbox, pipeline, customers, messages, steps)
//   crmCommand            customer, step, appointment and care-owner changes
//   crmIntegrationCommand Pancake page connection (admin only)
// Every collection behind them is closed to browsers by Firestore Rules.

const { FieldPath } = require('firebase-admin/firestore')
const { HttpsError } = require('firebase-functions/v2/https')
const { trustedAccessContext } = require('./identity-access')
const { withFunctionTelemetry } = require('./observability')
const { PancakeApiError, createPancakeClient } = require('./crm-pancake-client')
const { MAX_BACKFILL_DAYS } = require('./crm-sync')
const {
  ACTIVITY_OUTCOMES,
  ACTIVITY_TYPES,
  APPOINTMENT_KINDS,
  APPOINTMENT_STATUSES,
  CRM_STAGES,
  LOST_REASONS,
  PLATFORMS,
  STAGE_LABELS,
  branchAllowed,
  crmScope,
  customerAccess,
  displayPhone,
  encryptToken,
  localPhone,
  matchesSearch,
  newWebhookSecret,
  normalizePhone,
  pageIdValid,
  pancakeConversationUrl,
  phoneLookupVariants,
  platformForPage,
  searchQuery,
  searchTokens,
  sha256,
  stageIssue,
  text,
  usesCrm,
  webhookSecretHash,
} = require('./crm-core')

const DOCUMENT_ID = FieldPath.documentId()
const PAGE_SIZE = 30
const MAX_PAGE_SIZE = 50
const PIPELINE_ROWS = 20
const EARLY_STAGES = new Set(['new_inbox', 'qualified', 'consulting', 'trial_booked', 'trial_done'])
const SALES_POSITIONS = ['sales', 'branch_manager']
const CARE_POSITIONS = ['customer_care']

// ------------------------------------------------------------------ inputs

function id(value, label, maximum = 200) {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum || value.includes('/')) {
    throw new HttpsError('invalid-argument', `${label} không hợp lệ.`)
  }
  return value.trim()
}

function optionalId(value, label) {
  return value === undefined || value === null || value === '' ? '' : id(value, label)
}

function boundedText(value, label, maximum, { required = false } = {}) {
  if (value === undefined || value === null) {
    if (required) throw new HttpsError('invalid-argument', `${label} là bắt buộc.`)
    return ''
  }
  if (typeof value !== 'string' || value.length > maximum) throw new HttpsError('invalid-argument', `${label} tối đa ${maximum} ký tự.`)
  const result = value.trim()
  if (required && !result) throw new HttpsError('invalid-argument', `${label} là bắt buộc.`)
  return result
}

function oneOf(value, allowed, label) {
  if (!allowed.includes(value)) throw new HttpsError('invalid-argument', `${label} không hợp lệ.`)
  return value
}

function revision(value) {
  const number = Number(value)
  if (!Number.isSafeInteger(number) || number < 0) throw new HttpsError('invalid-argument', 'Phiên bản dữ liệu không hợp lệ.')
  return number
}

function timeInput(value, label) {
  const millis = typeof value === 'number' ? value : Date.parse(String(value || ''))
  if (!Number.isFinite(millis) || millis <= 0) throw new HttpsError('invalid-argument', `${label} không hợp lệ.`)
  return Math.round(millis)
}

function pageSize(value) {
  const number = Number(value)
  return Number.isInteger(number) ? Math.max(5, Math.min(MAX_PAGE_SIZE, number)) : PAGE_SIZE
}

function encodeCursor(value, documentId) {
  return Buffer.from(JSON.stringify([value, documentId])).toString('base64url')
}

function decodeCursor(cursor) {
  if (!cursor) return null
  try {
    const parsed = JSON.parse(Buffer.from(String(cursor), 'base64url').toString('utf8'))
    if (Array.isArray(parsed) && parsed.length === 2 && typeof parsed[1] === 'string') return parsed
  } catch { /* fall through */ }
  throw new HttpsError('invalid-argument', 'Con trỏ phân trang không hợp lệ.')
}

function denied(message = 'Bạn không có quyền xem khách hàng này.') {
  return new HttpsError('permission-denied', message)
}

function pancakeError(error) {
  if (error instanceof PancakeApiError) {
    return new HttpsError('failed-precondition', error.reconnect ? 'Token Pancake không hợp lệ hoặc thiếu quyền quản trị page.' : error.message)
  }
  return error
}

// ------------------------------------------------------------------- views

function iso(millis) {
  return millis ? new Date(millis).toISOString() : null
}

function customerView(documentId, value, access) {
  return {
    id: documentId,
    displayName: value.displayName || 'Khách chưa có tên',
    phones: (value.phones || []).map((phone) => ({ value: phone, display: displayPhone(phone) })),
    suggestedPhones: access.manage ? (value.suggestedPhones || []).map((phone) => ({ value: phone, display: displayPhone(phone) })) : [],
    emails: value.emails || [],
    branchId: value.branchId || null,
    stage: value.stage || 'new_inbox',
    stageLabel: STAGE_LABELS[value.stage] || STAGE_LABELS.new_inbox,
    stageChangedAt: iso(value.stageChangedAt),
    ownerUid: value.ownerUid || '',
    ownerName: value.ownerName || '',
    careOwnerUid: value.careOwnerUid || '',
    careOwnerName: value.careOwnerName || '',
    careOwnerKind: value.careOwnerKind || '',
    platform: value.source?.platform || '',
    pageName: value.source?.pageName || '',
    firstContactAt: iso(value.source?.firstContactAt),
    studentId: value.studentId || '',
    wonAt: iso(value.wonAt),
    quoteIds: access.presale ? value.quoteIds || [] : [],
    contractIds: value.contractIds || [],
    goal: value.goal || '',
    preferredSlots: value.preferredSlots || '',
    note: value.note || '',
    lostReason: value.lostReason || '',
    lostReasonLabel: LOST_REASONS[value.lostReason] || '',
    lostNote: value.lostNote || '',
    lastInboundAt: iso(value.lastInboundAt),
    lastOutboundAt: iso(value.lastOutboundAt),
    lastActivityAt: iso(value.lastActivityAt),
    firstResponseSeconds: Number.isFinite(value.firstResponseSeconds) ? value.firstResponseSeconds : null,
    nextStepAt: iso(value.nextStepAt),
    openStepCount: value.openStepCount || 0,
    fromBackfill: Boolean(value.fromBackfill),
    revision: value.revision || 0,
    createdAt: iso(value.createdAt),
    updatedAt: iso(value.updatedAt),
  }
}

function customerCard(documentId, value) {
  return {
    id: documentId,
    displayName: value.displayName || 'Khách chưa có tên',
    phone: value.phones?.[0] ? displayPhone(value.phones[0]) : '',
    stage: value.stage || 'new_inbox',
    ownerName: value.ownerName || '',
    careOwnerName: value.careOwnerName || '',
    platform: value.source?.platform || '',
    goal: value.goal || '',
    studentId: value.studentId || '',
    lastInboundAt: iso(value.lastInboundAt),
    nextStepAt: iso(value.nextStepAt),
    openStepCount: value.openStepCount || 0,
    updatedAt: iso(value.updatedAt),
    revision: value.revision || 0,
  }
}

function conversationView(documentId, value, { showPreview = true } = {}) {
  return {
    key: documentId,
    pageId: value.pageId,
    pageName: value.pageName || '',
    platform: value.platform || 'facebook',
    conversationId: value.conversationId,
    customerId: value.customerId || '',
    displayName: value.displayName || value.customerName || 'Khách Pancake',
    pancakeName: value.customerName || '',
    customerStage: value.customerStage || 'new_inbox',
    ownerUid: value.ownerUid || '',
    ownerName: value.ownerName || '',
    studentId: value.studentId || '',
    preview: showPreview ? value.preview || '' : '',
    lastMessageAt: iso(value.lastMessageAt),
    lastMessageFrom: value.lastMessageFrom || '',
    awaitingReply: Boolean(value.awaitingReply),
    awaitingSince: iso(value.awaitingSince),
    unread: Boolean(value.unread),
    messageCount: value.messageCount || 0,
    phoneHints: (value.phoneHints || []).length,
    pancakeUrl: pancakeConversationUrl(value.pageId, value.conversationId),
  }
}

function stepView(documentId, value) {
  return {
    id: documentId,
    customerId: value.customerId,
    customerName: value.customerName || '',
    studentId: value.studentId || '',
    kind: value.kind,
    title: value.title,
    note: value.note || '',
    status: value.status,
    ownerUid: value.ownerUid || '',
    ownerName: value.ownerName || '',
    ownerRole: value.ownerRole || '',
    dueAt: iso(value.dueAt),
    overdue: value.status === 'open' && Boolean(value.dueAt) && value.dueAt <= Date.now(),
    escalatedAt: iso(value.escalatedAt),
    outcome: value.outcome || '',
    completedAt: iso(value.completedAt),
    completedByName: value.completedByName || (value.completedBy === 'pancake' ? 'Pancake' : ''),
    autoClosed: Boolean(value.autoClosed),
    sopCode: value.sopCode || '',
    branchId: value.branchId || null,
    conversationKey: value.conversationKey || '',
  }
}

function activityView(documentId, value) {
  return {
    id: documentId,
    type: value.type,
    outcome: value.outcome || '',
    note: value.note || '',
    data: value.data || {},
    actorName: value.actorName || '',
    createdAt: iso(value.createdAt),
  }
}

function appointmentView(documentId, value) {
  return {
    id: documentId,
    kind: value.kind,
    status: value.status,
    startAt: iso(value.startAt),
    branchId: value.branchId || null,
    note: value.note || '',
    createdByName: value.createdByName || '',
  }
}

function messageView(documentId, value) {
  return {
    id: documentId,
    direction: value.direction,
    senderKind: value.senderKind,
    senderName: value.senderName || '',
    text: value.text || '',
    attachments: (value.attachments || []).map((item) => ({ type: item.type, url: item.url || '', name: item.name || '' })),
    sentAt: iso(value.sentAt),
  }
}

function pageView(documentId, value, secrets = null) {
  return {
    pageId: documentId,
    name: value.name || documentId,
    platform: value.platform || 'facebook',
    branchId: value.branchId || null,
    enabled: value.enabled !== false,
    status: value.status || 'active',
    tagMap: value.tagMap || {},
    staffMap: value.staffMap || {},
    pancakeTags: value.pancakeTags || [],
    pancakeUsers: value.pancakeUsers || [],
    webhookLastReceivedAt: iso(value.webhookLastReceivedAt),
    webhookSuspectedDown: Boolean(value.webhookSuspectedDown),
    webhookSecretHint: secrets?.webhookSecretHint || '',
    lastReconcileAt: iso(value.lastReconcileAt),
    lastReconcileSynced: value.lastReconcileSynced || 0,
    lastError: value.lastError ? { message: value.lastError.message, at: iso(value.lastError.at) } : null,
    backfill: value.backfill ? {
      status: value.backfill.status,
      conversations: value.backfill.conversations || 0,
      since: iso(value.backfill.sinceMs),
      cursorUntil: iso(value.backfill.cursorUntil),
      startedAt: iso(value.backfill.startedAt),
      finishedAt: iso(value.backfill.finishedAt),
    } : null,
    revision: value.revision || 0,
    connectedAt: iso(value.createdAt),
    updatedAt: iso(value.updatedAt),
  }
}

// --------------------------------------------------------------- factory

function createCrmFunctions({
  db,
  onCall,
  sync,
  pages,
  tokenKey = () => '',
  webhookBaseUrl = '',
  accessContextResolver = trustedAccessContext,
  clientFactory = createPancakeClient,
  nowMs = () => Date.now(),
  readOptions = {},
  writeOptions = {},
  integrationOptions = {},
}) {
  const staffCache = new Map()

  async function scopeFor(request) {
    const actor = await accessContextResolver(request, db)
    const scope = crmScope(actor)
    if (!usesCrm(scope)) throw denied('Tài khoản chưa được cấp quyền CRM.')
    return scope
  }

  function listBranch(scope, requested) {
    const value = text(requested, 200)
    if (scope.admin) return value && value !== 'all' ? value : 'all'
    if (value && value !== 'all') {
      if (!scope.branchIds.includes(value)) throw denied('Chi nhánh nằm ngoài phạm vi truy cập.')
      return value
    }
    if (!scope.branchIds.length) throw new HttpsError('failed-precondition', 'Tài khoản chưa được gán chi nhánh.')
    return scope.branchIds.length === 1 ? scope.branchIds[0] : { in: scope.branchIds.slice(0, 10) }
  }

  function byBranch(query, branch) {
    if (branch === 'all') return query
    return typeof branch === 'object' ? query.where('branchId', 'in', branch.in) : query.where('branchId', '==', branch)
  }

  async function loadCustomer(customerId, scope, { requireManage = false, allowMerged = false } = {}) {
    const reference = db.doc(`crmCustomers/${customerId}`)
    const snapshot = await reference.get()
    if (!snapshot.exists) throw new HttpsError('not-found', 'Không tìm thấy khách hàng.')
    const value = snapshot.data()
    if (value.status === 'merged' && !allowMerged) {
      throw new HttpsError('failed-precondition', 'Hồ sơ này đã được gộp vào hồ sơ khác.', { mergedInto: value.mergedInto || '' })
    }
    const access = customerAccess(scope, value)
    if (!access.view) throw denied()
    if (requireManage && !access.manage) throw denied('Bạn chỉ được xem hồ sơ này.')
    return { reference, value, access }
  }

  async function staffMember(uid, { positions = null, branchId = '' } = {}) {
    const cacheKey = `${uid}|${(positions || []).join(',')}|${branchId}`
    const cached = staffCache.get(cacheKey)
    if (cached && cached.expiresAt > nowMs()) return cached.value
    const [assignment, user] = await db.getAll(db.doc(`roleAssignments/${uid}`), db.doc(`users/${uid}`))
    let value = null
    if (assignment.exists && user.exists && user.data().disabled !== true) {
      const data = assignment.data()
      const admin = ['admin', 'super_admin'].includes(data.accessRole)
      const active = (data.status || 'active') === 'active'
      const positionOk = admin || !positions || positions.some((position) => (data.positions || []).includes(position))
      const branchOk = admin || !branchId || (data.branchIds || []).includes(branchId)
      if (active && (admin || data.accessRole === 'staff') && positionOk && branchOk) {
        value = {
          uid,
          name: text(user.data().displayName || user.data().name, 160) || 'Nhân sự Aura',
          positions: data.positions || [],
          staffId: text(data.crmProfileId, 200) || uid,
        }
      }
    }
    staffCache.set(cacheKey, { value, expiresAt: nowMs() + 60_000 })
    if (staffCache.size > 300) staffCache.delete(staffCache.keys().next().value)
    return value
  }

  function activity(writer, customerId, scope, { type, outcome = '', note = '', data = {}, channel = '' }) {
    writer.set(db.collection('crmActivities').doc(), {
      customerId, type, outcome, note, data, channel,
      actorUid: scope.uid, actorName: scope.actorName, createdAt: nowMs(),
    })
  }

  async function updateCustomer(reference, expectedRevision, scope, build) {
    return db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference)
      if (!snapshot.exists) throw new HttpsError('not-found', 'Không tìm thấy khách hàng.')
      const current = snapshot.data()
      if (expectedRevision !== null && (current.revision || 0) !== expectedRevision) {
        throw new HttpsError('aborted', 'Hồ sơ vừa được người khác cập nhật. Hãy tải lại rồi thử lần nữa.', { reason: 'revision-conflict' })
      }
      const outcome = build(current, transaction)
      if (!outcome?.patch) return { revision: current.revision || 0, current, unchanged: true, ...outcome }
      const next = { ...outcome.patch, revision: (current.revision || 0) + 1, updatedAt: nowMs() }
      transaction.update(reference, next)
      return { revision: next.revision, current, next: { ...current, ...next }, ...outcome }
    })
  }

  async function afterCustomerChange(customerId, nextCustomer, { previousStage = '', ownerChanged = false } = {}) {
    const result = { mirroredConversations: 0, pancake: null }
    if (!nextCustomer) return result
    result.mirroredConversations = await sync.refreshConversationMirrors(customerId, nextCustomer)
    try {
      if (previousStage && previousStage !== nextCustomer.stage) result.pancake = await sync.mirrorStage(customerId, previousStage, nextCustomer.stage)
      if (ownerChanged && nextCustomer.ownerUid) result.pancake = { ...(result.pancake || {}), owner: await sync.mirrorOwner(customerId, nextCustomer.ownerUid) }
    } catch {
      result.pancake = { failed: 1 }
    }
    return result
  }

  // ======================================================= crmQuery

  async function inbox(scope, data) {
    if (!(scope.presale && scope.branchView)) throw denied('Hộp thư dành cho Sales và quản lý chi nhánh.')
    const branch = listBranch(scope, data.branchId)
    const filter = oneOf(data.filter || 'awaiting', ['awaiting', 'mine', 'new', 'all'], 'Bộ lọc')
    const size = pageSize(data.pageSize)
    let query = byBranch(db.collection('crmConversations'), branch)
    let field = 'lastMessageAt'
    let direction = 'desc'
    if (filter === 'awaiting') { query = query.where('awaitingReply', '==', true); field = 'awaitingSince'; direction = 'asc' }
    if (filter === 'mine') query = query.where('ownerUid', '==', scope.uid)
    if (filter === 'new') query = query.where('customerStage', '==', 'new_inbox')
    query = query.orderBy(field, direction).orderBy(DOCUMENT_ID, direction)
    const cursor = decodeCursor(data.cursor)
    if (cursor) query = query.startAfter(cursor[0], cursor[1])
    const snapshot = await query.limit(size + 1).get()
    const documents = snapshot.docs.slice(0, size)
    const last = documents.at(-1)
    return {
      schemaVersion: 1,
      filter,
      rows: documents.map((document) => conversationView(document.id, document.data())),
      hasMore: snapshot.docs.length > size,
      nextCursor: snapshot.docs.length > size && last ? encodeCursor(last.data()[field] ?? null, last.id) : null,
    }
  }

  async function pipeline(scope, data) {
    if (!scope.branchView) throw denied('Pipeline dành cho Sales và quản lý chi nhánh.')
    const branch = listBranch(scope, data.branchId)
    const mine = data.owner === 'me'
    const columns = await Promise.all(CRM_STAGES.map(async (stage) => {
      let query = byBranch(db.collection('crmCustomers'), branch).where('stage', '==', stage)
      if (mine) query = query.where('ownerUid', '==', scope.uid)
      const [rows, count] = await Promise.all([
        query.orderBy('updatedAt', 'desc').limit(PIPELINE_ROWS).get(),
        query.count().get(),
      ])
      return {
        stage,
        label: STAGE_LABELS[stage],
        count: count.data().count,
        rows: rows.docs.filter((document) => document.data().status !== 'merged').map((document) => customerCard(document.id, document.data())),
      }
    }))
    return { schemaVersion: 1, columns }
  }

  async function customers(scope, data) {
    const size = pageSize(data.pageSize)
    const stage = data.stage ? oneOf(data.stage, CRM_STAGES, 'Giai đoạn') : ''
    if (data.scope === 'care' || !scope.branchView) {
      // Customers this actor looks after as CSKH or main PT.
      const keys = scope.staffKeys.slice(0, 2)
      const snapshots = await Promise.all([
        db.collection('crmCustomers').where('careOwnerUid', '==', scope.uid).orderBy('updatedAt', 'desc').limit(100).get(),
        ...keys.filter((key) => key !== scope.uid).map((key) => db.collection('crmCustomers').where('careOwnerStaffId', '==', key).orderBy('updatedAt', 'desc').limit(100).get()),
      ])
      const seen = new Map()
      snapshots.flatMap((snapshot) => snapshot.docs).forEach((document) => seen.set(document.id, document))
      const parsedQuery = searchQuery(data.query)
      const rows = [...seen.values()]
        .filter((document) => document.data().status !== 'merged' && (!stage || document.data().stage === stage))
        .filter((document) => !parsedQuery || matchesSearch(document.data(), parsedQuery) || (parsedQuery.token && (document.data().searchTokens || []).includes(parsedQuery.token)))
        .sort((left, right) => (right.data().updatedAt || 0) - (left.data().updatedAt || 0))
        .slice(0, 100)
        .map((document) => customerCard(document.id, document.data()))
      return { schemaVersion: 1, rows, hasMore: false, nextCursor: null }
    }
    const branch = listBranch(scope, data.branchId)
    const parsedQuery = searchQuery(data.query)
    if (parsedQuery) {
      let query = byBranch(db.collection('crmCustomers'), branch).where('searchTokens', 'array-contains', parsedQuery.token)
      const snapshot = await query.limit(60).get()
      const rows = snapshot.docs
        .filter((document) => document.data().status !== 'merged' && (!stage || document.data().stage === stage) && matchesSearch(document.data(), parsedQuery))
        .sort((left, right) => (right.data().updatedAt || 0) - (left.data().updatedAt || 0))
        .slice(0, size)
        .map((document) => customerCard(document.id, document.data()))
      return { schemaVersion: 1, rows, hasMore: false, nextCursor: null }
    }
    let query = byBranch(db.collection('crmCustomers'), branch)
    if (stage) query = query.where('stage', '==', stage)
    query = query.orderBy('updatedAt', 'desc').orderBy(DOCUMENT_ID, 'desc')
    const cursor = decodeCursor(data.cursor)
    if (cursor) query = query.startAfter(cursor[0], cursor[1])
    const snapshot = await query.limit(size + 1).get()
    const documents = snapshot.docs.slice(0, size)
    const last = documents.at(-1)
    return {
      schemaVersion: 1,
      rows: documents.filter((document) => document.data().status !== 'merged').map((document) => customerCard(document.id, document.data())),
      hasMore: snapshot.docs.length > size,
      nextCursor: snapshot.docs.length > size && last ? encodeCursor(last.data().updatedAt ?? null, last.id) : null,
    }
  }

  async function customer(scope, data) {
    const customerId = id(data.customerId, 'Mã khách hàng')
    const { value, access } = await loadCustomer(customerId, scope, { allowMerged: true })
    if (value.status === 'merged') return { schemaVersion: 1, mergedInto: value.mergedInto || '' }
    const wonAt = value.wonAt || 0
    const [conversations, steps, activities, appointments, quotes, student] = await Promise.all([
      db.collection('crmConversations').where('customerId', '==', customerId).limit(10).get(),
      db.collection('crmCareSteps').where('customerId', '==', customerId).limit(60).get(),
      db.collection('crmActivities').where('customerId', '==', customerId).orderBy('createdAt', 'desc').limit(40).get(),
      access.presale ? db.collection('crmAppointments').where('customerId', '==', customerId).limit(20).get() : null,
      access.presale && value.quoteIds?.length ? db.getAll(...value.quoteIds.slice(-10).map((quoteId) => db.doc(`quotes/${quoteId}`))) : [],
      value.studentId ? db.doc(`students/${value.studentId}`).get() : null,
    ])
    const stepRows = steps.docs.map((document) => stepView(document.id, document.data()))
      .filter((step) => access.presale || step.kind !== 'inbox_reply')
    const activityRows = activities.docs
      .filter((document) => access.presale || (wonAt && (document.data().createdAt || 0) >= wonAt))
      .map((document) => activityView(document.id, document.data()))
    return {
      schemaVersion: 1,
      customer: customerView(customerId, value, access),
      access: { manage: Boolean(access.manage), presale: Boolean(access.presale), postsale: Boolean(access.postsale), care: Boolean(access.care), assignCare: scope.assignCare, erase: scope.erase },
      conversations: conversations.docs
        .map((document) => conversationView(document.id, document.data(), { showPreview: access.presale || (wonAt && (document.data().lastMessageAt || 0) >= wonAt) }))
        .sort((left, right) => String(right.lastMessageAt || '').localeCompare(String(left.lastMessageAt || ''))),
      openSteps: stepRows.filter((step) => step.status === 'open').sort((left, right) => String(left.dueAt || '').localeCompare(String(right.dueAt || ''))),
      doneSteps: stepRows.filter((step) => step.status !== 'open').sort((left, right) => String(right.completedAt || '').localeCompare(String(left.completedAt || ''))).slice(0, 20),
      activities: activityRows,
      appointments: appointments ? appointments.docs.map((document) => appointmentView(document.id, document.data())).sort((left, right) => String(right.startAt).localeCompare(String(left.startAt))) : [],
      quotes: quotes.filter((snapshot) => snapshot.exists).map((snapshot) => ({
        id: snapshot.id, code: snapshot.data().code || '', packageName: snapshot.data().packageName || '',
        finalPrice: Number(snapshot.data().finalPrice || 0), status: snapshot.data().status || '',
      })),
      student: student?.exists ? { id: student.id, name: student.data().name || '', branchId: student.data().branchId || null, status: student.data().status || 'active' } : null,
    }
  }

  async function messages(scope, data) {
    const customerId = id(data.customerId, 'Mã khách hàng')
    const { value, access } = await loadCustomer(customerId, scope)
    if (!access.presale && !access.postsale) throw denied('Bạn không có quyền đọc hội thoại.')
    let key = optionalId(data.conversationKey, 'Hội thoại')
    if (key) {
      const conversation = await db.doc(`crmConversations/${key}`).get()
      if (!conversation.exists || conversation.data().customerId !== customerId) throw new HttpsError('not-found', 'Không tìm thấy hội thoại của khách này.')
    } else {
      const latest = await db.collection('crmConversations').where('customerId', '==', customerId).orderBy('lastMessageAt', 'desc').limit(1).get()
      key = latest.docs[0]?.id || ''
    }
    const hiddenBefore = access.presale ? 0 : value.wonAt || 0
    if (!key || (!access.presale && !hiddenBefore)) return { schemaVersion: 1, conversationKey: key, rows: [], hasMore: false, nextCursor: null, hiddenBefore: iso(hiddenBefore), wonAt: iso(value.wonAt) }
    const size = pageSize(data.pageSize || 50)
    let query = db.collection('crmMessages').where('conversationKey', '==', key)
    if (hiddenBefore) query = query.where('sentAt', '>=', hiddenBefore)
    query = query.orderBy('sentAt', 'desc').orderBy(DOCUMENT_ID, 'desc')
    const cursor = decodeCursor(data.cursor)
    if (cursor) query = query.startAfter(cursor[0], cursor[1])
    const snapshot = await query.limit(size + 1).get()
    const documents = snapshot.docs.slice(0, size)
    const last = documents.at(-1)
    return {
      schemaVersion: 1,
      conversationKey: key,
      rows: documents.map((document) => messageView(document.id, document.data())),
      hasMore: snapshot.docs.length > size,
      nextCursor: snapshot.docs.length > size && last ? encodeCursor(last.data().sentAt, last.id) : null,
      hiddenBefore: iso(hiddenBefore),
      wonAt: iso(value.wonAt),
    }
  }

  async function steps(scope, data) {
    if (!scope.steps) throw denied('Bạn chưa được giao bước chăm sóc.')
    const status = oneOf(data.status || 'open', ['open', 'done'], 'Trạng thái')
    const view = oneOf(data.scope || 'mine', ['mine', 'branch'], 'Phạm vi')
    const order = status === 'open' ? ['dueAt', 'asc'] : ['completedAt', 'desc']
    let query = db.collection('crmCareSteps')
    if (view === 'mine') {
      query = query.where('ownerKeys', 'array-contains-any', scope.staffKeys.slice(0, 2))
    } else {
      if (!(scope.manager || scope.branchView)) throw denied('Chỉ quản lý và Sales xem bước của cả chi nhánh.')
      query = byBranch(query, listBranch(scope, data.branchId))
    }
    // Equality only: Firestore limits disjunctions next to array-contains-any.
    query = query.where('status', '==', status).orderBy(order[0], order[1]).orderBy(DOCUMENT_ID, order[1])
    const size = pageSize(data.pageSize)
    const cursor = decodeCursor(data.cursor)
    if (cursor) query = query.startAfter(cursor[0], cursor[1])
    const snapshot = await query.limit(size + 1).get()
    let documents = snapshot.docs.slice(0, size)
    // Branch view for Sales hides post-sale tasks of other owners.
    if (view === 'branch' && !scope.manager) documents = documents.filter((document) => document.data().ownerRole === 'sales' || scope.staffKeys.includes(document.data().ownerUid))
    const last = snapshot.docs.slice(0, size).at(-1)
    return {
      schemaVersion: 1,
      rows: documents.map((document) => stepView(document.id, document.data())),
      hasMore: snapshot.docs.length > size,
      nextCursor: snapshot.docs.length > size && last ? encodeCursor(last.data()[order[0]] ?? null, last.id) : null,
    }
  }

  async function staffDirectory(scope, data) {
    if (!(scope.branchView || scope.assignCare)) throw denied()
    const branchId = id(data.branchId, 'Chi nhánh')
    if (!branchAllowed(scope, branchId)) throw denied('Chi nhánh nằm ngoài phạm vi truy cập.')
    const snapshot = await db.collection('roleAssignments').where('branchIds', 'array-contains', branchId).limit(200).get()
    const rows = snapshot.docs.map((document) => ({ uid: document.id, ...document.data() }))
      .filter((row) => row.accessRole === 'staff' && (row.status || 'active') === 'active')
      .filter((row) => (row.positions || []).some((position) => [...SALES_POSITIONS, ...CARE_POSITIONS].includes(position)))
    const users = rows.length ? await db.getAll(...rows.map((row) => db.doc(`users/${row.uid}`))) : []
    return {
      schemaVersion: 1,
      staff: rows.map((row, index) => ({
        uid: row.uid,
        name: text(users[index]?.exists ? users[index].data().displayName || users[index].data().name : '', 160) || 'Nhân sự Aura',
        positions: (row.positions || []).filter((position) => [...SALES_POSITIONS, ...CARE_POSITIONS].includes(position)),
        disabled: users[index]?.exists ? users[index].data().disabled === true : true,
      })).filter((row) => !row.disabled).sort((left, right) => left.name.localeCompare(right.name, 'vi')),
    }
  }

  async function careAssignments(scope, data) {
    if (!scope.assignCare) throw denied('Chỉ quản lý chi nhánh giao học viên cho CSKH.')
    const branchId = id(data.branchId, 'Chi nhánh')
    if (!branchAllowed(scope, branchId)) throw denied('Chi nhánh nằm ngoài phạm vi truy cập.')
    const [students, assignments, staff] = await Promise.all([
      db.collection('students').where('branchId', '==', branchId).limit(400).get(),
      db.collection('crmCareAssignments').where('branchId', '==', branchId).limit(600).get(),
      staffDirectory({ ...scope, branchView: true }, { branchId }),
    ])
    const byStudent = new Map(assignments.docs.map((document) => [document.id, document.data()]))
    const query = searchQuery(data.query)
    const rows = students.docs
      .filter((document) => (document.data().status || 'active') !== 'inactive' && !document.data().accountDeletedAt)
      .map((document) => {
        const assignment = byStudent.get(document.id)
        return {
          studentId: document.id,
          name: document.data().name || 'Học viên',
          phone: normalizePhone(document.data().phone) ? displayPhone(normalizePhone(document.data().phone)) : '',
          careOwnerUid: assignment?.careOwnerUid || '',
          careOwnerName: assignment?.careOwnerName || '',
        }
      })
      .filter((row) => !query || matchesSearch({ displayName: row.name }, query) || (query.token && row.phone.replace(/\D/g, '').includes(query.token.replace(/\D/g, '') || '§')))
      .sort((left, right) => left.name.localeCompare(right.name, 'vi'))
    return {
      schemaVersion: 1,
      rows: rows.slice(0, 300),
      truncated: students.size >= 400,
      careStaff: staff.staff.filter((row) => row.positions.includes('customer_care')).map(({ uid, name }) => ({ uid, name })),
    }
  }

  async function linkTargets(scope, data) {
    if (!scope.manage) throw denied()
    const raw = boundedText(data.query, 'Từ khóa', 120, { required: true })
    const phone = normalizePhone(raw)
    let documents = []
    if (phone) {
      const snapshot = await db.collection('students').where('phone', 'in', phoneLookupVariants(phone).slice(0, 10)).limit(10).get()
      documents = snapshot.docs
    } else if (/^[A-Za-z0-9_-]{8,}$/.test(raw)) {
      const snapshot = await db.doc(`students/${raw}`).get()
      documents = snapshot.exists ? [snapshot] : []
    }
    if (!documents.length && !phone) {
      const snapshot = await db.collection('students').where('name', '>=', raw).where('name', '<=', `${raw}`).limit(10).get()
      documents = snapshot.docs
    }
    const linked = documents.length
      ? await db.collection('crmCustomers').where('studentId', 'in', documents.slice(0, 10).map((document) => document.id)).limit(10).get()
      : { docs: [] }
    const linkedByStudent = new Map(linked.docs.map((document) => [document.data().studentId, document.id]))
    return {
      schemaVersion: 1,
      rows: documents
        .filter((document) => scope.admin || scope.branchIds.includes(document.data().branchId))
        .map((document) => ({
          studentId: document.id,
          name: document.data().name || 'Học viên',
          phone: normalizePhone(document.data().phone) ? displayPhone(normalizePhone(document.data().phone)) : text(document.data().phone, 30),
          branchId: document.data().branchId || null,
          linkedCustomerId: linkedByStudent.get(document.id) || '',
        })),
    }
  }

  async function quoteCandidates(scope, data) {
    const customerId = id(data.customerId, 'Mã khách hàng')
    const { value, access } = await loadCustomer(customerId, scope, { requireManage: true })
    if (!access.presale) throw denied()
    const phone = value.phones?.[0]
    if (!phone) return { schemaVersion: 1, rows: [], reason: 'Lưu số điện thoại của khách để tìm báo giá đã tạo.' }
    const snapshot = await db.collection('quotes').where('customerPhone', 'in', phoneLookupVariants(phone).slice(0, 10)).limit(20).get()
    return {
      schemaVersion: 1,
      rows: snapshot.docs
        .filter((document) => scope.admin || scope.branchIds.includes(document.data().branchId))
        .map((document) => ({
          id: document.id,
          code: document.data().code || '',
          customerName: document.data().customerName || '',
          packageName: document.data().packageName || '',
          finalPrice: Number(document.data().finalPrice || 0),
          status: document.data().status || '',
          linked: (value.quoteIds || []).includes(document.id),
        })),
    }
  }

  async function integration(scope) {
    if (!scope.integration) throw denied('Chỉ quản trị viên quản lý kết nối Pancake.')
    const [snapshot, branches] = await Promise.all([
      db.collection('crmPancakePages').limit(30).get(),
      db.collection('branches').limit(50).get(),
    ])
    const secrets = snapshot.size ? await db.getAll(...snapshot.docs.map((document) => db.doc(`crmPancakePageSecrets/${document.id}`))) : []
    return {
      schemaVersion: 1,
      webhookBaseUrl,
      pages: snapshot.docs.map((document, index) => pageView(document.id, document.data(), secrets[index]?.exists ? secrets[index].data() : null)),
      branches: branches.docs.filter((document) => document.data().status !== 'archived').map((document) => ({ id: document.id, name: document.data().name || document.id })),
      stages: CRM_STAGES.map((stage) => ({ stage, label: STAGE_LABELS[stage] })),
    }
  }

  const queryActions = { inbox, pipeline, customers, customer, messages, steps, staff: staffDirectory, careAssignments, linkTargets, quoteCandidates, integration }

  // ======================================================= crmCommand

  async function updateStage(scope, data) {
    const customerId = id(data.customerId, 'Mã khách hàng')
    const stage = oneOf(data.stage, CRM_STAGES, 'Giai đoạn')
    const lostReason = stage === 'lost' ? text(data.lostReason, 40) : ''
    const note = boundedText(data.note, 'Ghi chú', 500)
    const { reference } = await loadCustomer(customerId, scope, { requireManage: true })
    const outcome = await updateCustomer(reference, revision(data.expectedRevision), scope, (current, transaction) => {
      if (current.stage === stage && stage !== 'lost') return { patch: null }
      const issue = stageIssue(current, stage, { lostReason })
      if (issue) throw new HttpsError('failed-precondition', issue)
      activity(transaction, customerId, scope, { type: 'stage_change', note, data: { fromStage: current.stage, toStage: stage, lostReason } })
      return {
        patch: {
          stage, stageChangedAt: nowMs(), lastActivityAt: nowMs(),
          lostReason, lostNote: stage === 'lost' ? note : '',
        },
      }
    })
    const mirror = outcome.unchanged ? null : await afterCustomerChange(customerId, outcome.next, { previousStage: outcome.current.stage })
    return { customerId, revision: outcome.revision, unchanged: Boolean(outcome.unchanged), pancake: mirror?.pancake || null }
  }

  async function updateProfile(scope, data) {
    const customerId = id(data.customerId, 'Mã khách hàng')
    const { reference } = await loadCustomer(customerId, scope, { requireManage: true })
    const patch = {}
    if (data.displayName !== undefined) patch.displayName = boundedText(data.displayName, 'Tên khách', 160, { required: true })
    if (data.phones !== undefined) {
      if (!Array.isArray(data.phones) || data.phones.length > 5) throw new HttpsError('invalid-argument', 'Tối đa 5 số điện thoại.')
      const phones = data.phones.map((value) => ({ raw: String(value || '').trim(), phone: normalizePhone(value) })).filter((item) => item.raw)
      const invalid = phones.find((item) => !item.phone)
      if (invalid) throw new HttpsError('invalid-argument', `Số điện thoại ${invalid.raw.slice(0, 20)} không hợp lệ.`)
      patch.phones = [...new Set(phones.map((item) => item.phone))]
    }
    if (data.emails !== undefined) {
      if (!Array.isArray(data.emails) || data.emails.length > 3) throw new HttpsError('invalid-argument', 'Tối đa 3 email.')
      patch.emails = data.emails.map((value) => boundedText(value, 'Email', 160).toLowerCase()).filter(Boolean)
      if (patch.emails.some((value) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))) throw new HttpsError('invalid-argument', 'Email không hợp lệ.')
    }
    if (data.goal !== undefined) patch.goal = boundedText(data.goal, 'Mục tiêu', 300)
    if (data.preferredSlots !== undefined) patch.preferredSlots = boundedText(data.preferredSlots, 'Khung giờ', 200)
    if (data.note !== undefined) patch.note = boundedText(data.note, 'Ghi chú', 1000)
    if (data.branchId !== undefined) {
      const branchId = id(data.branchId, 'Chi nhánh')
      if (!branchAllowed(scope, branchId)) throw denied('Chi nhánh nằm ngoài phạm vi truy cập.')
      patch.branchId = branchId
    }
    if (!Object.keys(patch).length) throw new HttpsError('invalid-argument', 'Không có thông tin nào thay đổi.')
    const outcome = await updateCustomer(reference, revision(data.expectedRevision), scope, (current, transaction) => {
      const next = { ...current, ...patch }
      const fields = Object.keys(patch)
      activity(transaction, customerId, scope, { type: 'note', note: `Cập nhật hồ sơ: ${fields.join(', ')}.`, data: { fields } })
      return {
        patch: {
          ...patch,
          searchTokens: searchTokens(next.displayName, next.phones || []),
          suggestedPhones: (current.suggestedPhones || []).filter((phone) => !(next.phones || []).includes(phone)),
          lastActivityAt: nowMs(),
        },
      }
    })
    await afterCustomerChange(customerId, outcome.next)
    // A saved phone that another record already holds is a merge proposal.
    const duplicates = []
    for (const phone of patch.phones || []) {
      const snapshot = await db.collection('crmCustomers').where('phones', 'array-contains', phone).limit(5).get()
      for (const document of snapshot.docs) {
        if (document.id === customerId || document.data().status === 'merged' || duplicates.some((item) => item.id === document.id)) continue
        if (!customerAccess(scope, document.data()).view) continue
        duplicates.push({ id: document.id, displayName: document.data().displayName || '', stage: document.data().stage, phone: displayPhone(phone) })
      }
    }
    return { customerId, revision: outcome.revision, duplicates }
  }

  async function assignOwner(scope, data) {
    const customerId = id(data.customerId, 'Mã khách hàng')
    const { reference, value } = await loadCustomer(customerId, scope, { requireManage: true })
    const ownerUid = optionalId(data.ownerUid, 'Người phụ trách')
    const owner = ownerUid ? await staffMember(ownerUid, { positions: SALES_POSITIONS, branchId: value.branchId || '' }) : null
    if (ownerUid && !owner) throw new HttpsError('failed-precondition', 'Người phụ trách phải là Sales hoặc quản lý đang hoạt động ở chi nhánh của khách.')
    const outcome = await updateCustomer(reference, revision(data.expectedRevision), scope, (current, transaction) => {
      if ((current.ownerUid || '') === ownerUid) return { patch: null }
      activity(transaction, customerId, scope, { type: 'assignment', note: owner ? `Giao cho ${owner.name}.` : 'Bỏ người phụ trách.', data: { fromUid: current.ownerUid || '', toUid: ownerUid } })
      return { patch: { ownerUid, ownerName: owner?.name || '', lastActivityAt: nowMs() } }
    })
    if (!outcome.unchanged) {
      const open = await db.collection('crmCareSteps').where('customerId', '==', customerId).where('status', '==', 'open').limit(50).get()
      const batch = db.batch()
      let count = 0
      for (const document of open.docs) {
        if (document.data().ownerRole !== 'sales') continue
        batch.update(document.ref, { ownerUid, ownerName: owner?.name || '', ownerStaffId: '', ownerKeys: ownerUid ? [ownerUid] : [], ownerNotifiedAt: null, updatedAt: nowMs() })
        count += 1
      }
      if (count) await batch.commit()
    }
    const mirror = outcome.unchanged ? null : await afterCustomerChange(customerId, outcome.next, { ownerChanged: true })
    return { customerId, revision: outcome.revision, unchanged: Boolean(outcome.unchanged), pancake: mirror?.pancake || null }
  }

  async function recordActivity(scope, data) {
    const customerId = id(data.customerId, 'Mã khách hàng')
    const { reference, access } = await loadCustomer(customerId, scope)
    if (!access.manage && !access.care) throw denied('Bạn chỉ được xem hồ sơ này.')
    const type = oneOf(data.type, ACTIVITY_TYPES, 'Loại hoạt động')
    const outcome = data.outcome ? oneOf(data.outcome, ACTIVITY_OUTCOMES, 'Kết quả') : ''
    const note = boundedText(data.note, 'Ghi chú', 1000)
    if (type === 'note' && note.length < 2) throw new HttpsError('invalid-argument', 'Ghi chú cần ít nhất 2 ký tự.')
    const batch = db.batch()
    activity(batch, customerId, scope, { type, outcome, note, channel: type === 'zalo' ? 'zalo' : type === 'call' ? 'phone' : '' })
    batch.update(reference, { lastActivityAt: nowMs(), updatedAt: nowMs() })
    await batch.commit()
    return { customerId, recorded: true }
  }

  async function createStep(scope, data) {
    const customerId = id(data.customerId, 'Mã khách hàng')
    const { reference, value, access } = await loadCustomer(customerId, scope)
    if (!access.manage && !access.care) throw denied('Bạn chỉ được xem hồ sơ này.')
    const title = boundedText(data.title, 'Việc cần làm', 160, { required: true })
    const dueAt = timeInput(data.dueAt, 'Hạn')
    if (dueAt < nowMs() - 86_400_000 || dueAt > nowMs() + 180 * 86_400_000) throw new HttpsError('invalid-argument', 'Hạn phải trong vòng 6 tháng tới.')
    const ownerUid = optionalId(data.ownerUid, 'Người nhận') || scope.uid
    const owner = ownerUid === scope.uid ? { uid: scope.uid, name: scope.actorName, staffId: scope.staffKeys[1] || '' } : await staffMember(ownerUid, { branchId: value.branchId || '' })
    if (!owner) throw new HttpsError('failed-precondition', 'Người nhận phải là nhân sự đang hoạt động ở chi nhánh của khách.')
    const care = Boolean(access.care) || Boolean(value.studentId && ownerUid !== value.ownerUid && (owner.uid === value.careOwnerUid))
    const stepReference = db.collection('crmCareSteps').doc()
    const batch = db.batch()
    batch.set(stepReference, {
      schemaVersion: 1, customerId, customerName: value.displayName || '', studentId: value.studentId || '', conversationKey: '',
      branchId: value.branchId || null, kind: 'manual', title, note: boundedText(data.note, 'Ghi chú', 500), status: 'open',
      ownerRole: care ? 'care_owner' : 'sales', ownerUid: owner.uid, ownerStaffId: owner.staffId && owner.staffId !== owner.uid ? owner.staffId : '', ownerName: owner.name,
      ownerKeys: [...new Set([owner.uid, owner.staffId].filter(Boolean))],
      dueAt, escalateAt: dueAt + 24 * 60 * 60_000, sopCode: text(data.sopCode, 40), createdBy: scope.uid, createdAt: nowMs(), updatedAt: nowMs(),
    })
    batch.update(reference, {
      openStepCount: (value.openStepCount || 0) + 1,
      nextStepAt: value.nextStepAt && value.nextStepAt < dueAt && value.openStepCount ? value.nextStepAt : dueAt,
      updatedAt: nowMs(),
    })
    await batch.commit()
    return { stepId: stepReference.id }
  }

  async function completeStep(scope, data) {
    const stepId = id(data.stepId, 'Bước chăm sóc')
    const status = oneOf(data.status || 'done', ['done', 'skipped'], 'Trạng thái')
    const outcomeNote = boundedText(data.note, 'Ghi chú', 500)
    const reference = db.doc(`crmCareSteps/${stepId}`)
    return db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference)
      if (!snapshot.exists) throw new HttpsError('not-found', 'Không tìm thấy bước chăm sóc.')
      const step = snapshot.data()
      const customerReference = db.doc(`crmCustomers/${step.customerId}`)
      const customerSnapshot = await transaction.get(customerReference)
      const owner = (step.ownerKeys || []).some((key) => scope.staffKeys.includes(key))
      const branchMember = branchAllowed(scope, step.branchId)
      const allowed = scope.admin || owner || (scope.manager && branchMember) || (!step.ownerUid && scope.branchView && branchMember && step.ownerRole === 'sales')
      if (!allowed) throw denied('Bước này đang giao cho người khác.')
      if (step.status !== 'open') return { stepId, status: step.status, unchanged: true }
      transaction.update(reference, {
        status, outcome: text(data.outcome, 40) || (status === 'done' ? 'done' : 'skipped'), outcomeNote,
        completedAt: nowMs(), completedBy: scope.uid, completedByName: scope.actorName, updatedAt: nowMs(),
      })
      if (customerSnapshot.exists) {
        transaction.update(customerReference, { openStepCount: Math.max(0, (customerSnapshot.data().openStepCount || 0) - 1), lastActivityAt: nowMs(), updatedAt: nowMs() })
        if (outcomeNote) activity(transaction, step.customerId, scope, { type: 'note', note: `${step.title}: ${outcomeNote}`, data: { stepId } })
      }
      return { stepId, status }
    })
  }

  async function createAppointment(scope, data) {
    const customerId = id(data.customerId, 'Mã khách hàng')
    const { reference, value } = await loadCustomer(customerId, scope, { requireManage: true })
    const kind = oneOf(data.kind || 'trial', APPOINTMENT_KINDS, 'Loại hẹn')
    const startAt = timeInput(data.startAt, 'Thời gian hẹn')
    if (startAt < nowMs() - 86_400_000 || startAt > nowMs() + 90 * 86_400_000) throw new HttpsError('invalid-argument', 'Lịch hẹn phải trong vòng 90 ngày tới.')
    const branchId = data.branchId ? id(data.branchId, 'Chi nhánh') : value.branchId || ''
    if (!branchAllowed(scope, branchId)) throw denied('Chi nhánh nằm ngoài phạm vi truy cập.')
    const note = boundedText(data.note, 'Ghi chú', 500)
    const appointmentReference = db.collection('crmAppointments').doc()
    const reminderReference = db.collection('crmCareSteps').doc()
    const label = kind === 'trial' ? 'tập thử' : kind === 'inbody' ? 'đo InBody' : 'tư vấn'
    const outcome = await updateCustomer(reference, null, scope, (current, transaction) => {
      transaction.set(appointmentReference, {
        customerId, branchId, kind, startAt, note, status: 'booked',
        createdBy: scope.uid, createdByName: scope.actorName, createdAt: nowMs(), updatedAt: nowMs(),
      })
      const ownerUid = current.ownerUid || scope.uid
      const ownerName = current.ownerUid ? current.ownerName || '' : scope.actorName
      const dueAt = Math.max(nowMs(), startAt - 24 * 60 * 60_000)
      transaction.set(reminderReference, {
        schemaVersion: 1, customerId, customerName: current.displayName || '', studentId: current.studentId || '', conversationKey: '',
        branchId, kind: 'manual', title: `Nhắc khách lịch ${label}`, note: new Date(startAt).toISOString(), status: 'open',
        ownerRole: 'sales', ownerUid, ownerStaffId: '', ownerName, ownerKeys: [ownerUid],
        dueAt, escalateAt: startAt, sopCode: 'SOP-TRIAL-01', appointmentId: appointmentReference.id, createdBy: scope.uid, createdAt: nowMs(), updatedAt: nowMs(),
      })
      activity(transaction, customerId, scope, { type: 'meeting', note: `Hẹn ${label}${note ? `: ${note}` : ''}.`, data: { appointmentId: appointmentReference.id, startAt } })
      const patch = { lastActivityAt: nowMs(), openStepCount: (current.openStepCount || 0) + 1 }
      if (kind === 'trial' && ['new_inbox', 'qualified', 'consulting'].includes(current.stage)) {
        Object.assign(patch, { stage: 'trial_booked', stageChangedAt: nowMs() })
        activity(transaction, customerId, scope, { type: 'stage_change', data: { fromStage: current.stage, toStage: 'trial_booked' } })
      }
      return { patch }
    })
    await afterCustomerChange(customerId, outcome.next, { previousStage: outcome.current.stage })
    return { appointmentId: appointmentReference.id, revision: outcome.revision, stage: outcome.next.stage }
  }

  async function updateAppointment(scope, data) {
    const appointmentId = id(data.appointmentId, 'Lịch hẹn')
    const status = oneOf(data.status, APPOINTMENT_STATUSES, 'Trạng thái hẹn')
    const appointmentReference = db.doc(`crmAppointments/${appointmentId}`)
    const appointment = await appointmentReference.get()
    if (!appointment.exists) throw new HttpsError('not-found', 'Không tìm thấy lịch hẹn.')
    const { reference } = await loadCustomer(appointment.data().customerId, scope, { requireManage: true })
    const customerId = appointment.data().customerId
    const followUpReference = db.collection('crmCareSteps').doc()
    const outcome = await updateCustomer(reference, null, scope, (current, transaction) => {
      transaction.update(appointmentReference, { status, note: boundedText(data.note, 'Ghi chú', 500) || appointment.data().note || '', updatedAt: nowMs(), updatedBy: scope.uid })
      const patch = { lastActivityAt: nowMs() }
      if (status === 'attended' && appointment.data().kind === 'trial' && EARLY_STAGES.has(current.stage) && current.stage !== 'trial_done') {
        Object.assign(patch, { stage: 'trial_done', stageChangedAt: nowMs() })
        activity(transaction, customerId, scope, { type: 'stage_change', data: { fromStage: current.stage, toStage: 'trial_done' } })
      }
      if (status === 'no_show') {
        const ownerUid = current.ownerUid || scope.uid
        transaction.set(followUpReference, {
          schemaVersion: 1, customerId, customerName: current.displayName || '', studentId: current.studentId || '', conversationKey: '',
          branchId: current.branchId || null, kind: 'manual', title: 'Gọi lại khách không đến hẹn', note: '', status: 'open',
          ownerRole: 'sales', ownerUid, ownerStaffId: '', ownerName: current.ownerUid ? current.ownerName || '' : scope.actorName, ownerKeys: [ownerUid],
          dueAt: nowMs() + 2 * 60 * 60_000, escalateAt: nowMs() + 24 * 60 * 60_000, sopCode: 'SOP-TRIAL-02', createdBy: scope.uid, createdAt: nowMs(), updatedAt: nowMs(),
        })
        patch.openStepCount = (current.openStepCount || 0) + 1
      }
      activity(transaction, customerId, scope, { type: 'meeting', note: `Lịch hẹn: ${status === 'attended' ? 'khách đã đến' : status === 'no_show' ? 'khách không đến' : status === 'cancelled' ? 'đã hủy' : 'đã đặt'}.`, data: { appointmentId, status } })
      return { patch }
    })
    await afterCustomerChange(customerId, outcome.next, { previousStage: outcome.current.stage })
    return { appointmentId, status, stage: outcome.next.stage, revision: outcome.revision }
  }

  async function linkStudent(scope, data) {
    const customerId = id(data.customerId, 'Mã khách hàng')
    const studentId = id(data.studentId, 'Học viên')
    const { reference } = await loadCustomer(customerId, scope, { requireManage: true })
    const [student, linked, contracts] = await Promise.all([
      db.doc(`students/${studentId}`).get(),
      db.collection('crmCustomers').where('studentId', '==', studentId).limit(2).get(),
      db.collection('contracts').where('studentId', '==', studentId).limit(10).get(),
    ])
    if (!student.exists) throw new HttpsError('not-found', 'Không tìm thấy học viên.')
    if (!scope.admin && !scope.branchIds.includes(student.data().branchId)) throw denied('Học viên thuộc chi nhánh khác.')
    const other = linked.docs.find((document) => document.id !== customerId && document.data().status !== 'merged')
    if (other) throw new HttpsError('already-exists', 'Học viên đã nối với một hồ sơ khác. Hãy gộp hai hồ sơ.', { customerId: other.id })
    const contractRows = contracts.docs.map((document) => ({ id: document.id, ...document.data() }))
      .sort((left, right) => String(right.startDate || '').localeCompare(String(left.startDate || '')))
    const owner = await sync.careOwnerFor(studentId, text(contractRows[0]?.trainerId, 200))
    const studentPhone = normalizePhone(student.data().phone)
    const outcome = await updateCustomer(reference, revision(data.expectedRevision), scope, (current, transaction) => {
      const patch = { studentId, lastActivityAt: nowMs() }
      if (contractRows.length) {
        const signedTimes = contractRows.map((row) => Date.parse(`${row.startDate || ''}T00:00:00+07:00`)).filter(Number.isFinite)
        Object.assign(patch, {
          stage: 'won', stageChangedAt: current.stage === 'won' ? current.stageChangedAt : nowMs(),
          wonAt: current.wonAt || Math.min(nowMs(), ...signedTimes),
          contractIds: [...new Set([...(current.contractIds || []), ...contractRows.map((row) => row.id)])].slice(-20),
          lostReason: '', lostNote: '',
        })
        if (owner.kind) Object.assign(patch, { careOwnerUid: owner.uid, careOwnerStaffId: owner.staffId, careOwnerKind: owner.kind, careOwnerName: owner.name })
      }
      if (studentPhone && !(current.phones || []).includes(studentPhone)) {
        patch.phones = [...(current.phones || []), studentPhone].slice(0, 5)
        patch.searchTokens = searchTokens(current.displayName, patch.phones)
      }
      activity(transaction, customerId, scope, { type: 'note', note: `Nối hồ sơ học viên ${student.data().name || studentId}.`, data: { studentId, fromStage: current.stage, toStage: patch.stage || current.stage } })
      return { patch }
    })
    await afterCustomerChange(customerId, outcome.next, { previousStage: outcome.current.stage })
    if (outcome.next.careOwnerKind) await sync.reassignOpenCareSteps(customerId, { uid: outcome.next.careOwnerUid, staffId: outcome.next.careOwnerStaffId, name: outcome.next.careOwnerName })
    return { customerId, revision: outcome.revision, stage: outcome.next.stage, contracts: contractRows.length }
  }

  async function linkQuote(scope, data) {
    const customerId = id(data.customerId, 'Mã khách hàng')
    const quoteId = id(data.quoteId, 'Báo giá')
    const { reference, value } = await loadCustomer(customerId, scope, { requireManage: true })
    const quote = await db.doc(`quotes/${quoteId}`).get()
    if (!quote.exists) throw new HttpsError('not-found', 'Không tìm thấy báo giá.')
    if (!scope.admin && !scope.branchIds.includes(quote.data().branchId)) throw denied('Báo giá thuộc chi nhánh khác.')
    if (value.branchId && quote.data().branchId && value.branchId !== quote.data().branchId && !scope.admin) throw new HttpsError('failed-precondition', 'Báo giá và khách thuộc hai chi nhánh khác nhau.')
    const outcome = await updateCustomer(reference, null, scope, (current, transaction) => {
      if ((current.quoteIds || []).includes(quoteId)) return { patch: null }
      const patch = { quoteIds: [...(current.quoteIds || []), quoteId].slice(-20), lastActivityAt: nowMs() }
      if (EARLY_STAGES.has(current.stage)) Object.assign(patch, { stage: 'quote_sent', stageChangedAt: nowMs() })
      activity(transaction, customerId, scope, { type: 'note', note: `Gắn báo giá ${quote.data().code || quoteId} · ${quote.data().packageName || ''}.`, data: { quoteId, fromStage: current.stage, toStage: patch.stage || current.stage } })
      return { patch }
    })
    if (!outcome.unchanged) await afterCustomerChange(customerId, outcome.next, { previousStage: outcome.current.stage })
    return { customerId, revision: outcome.revision, unchanged: Boolean(outcome.unchanged) }
  }

  async function moveDocuments(collection, field, sourceId, targetId, patchFor = () => ({})) {
    let moved = 0
    for (let round = 0; round < 5; round += 1) {
      const snapshot = await db.collection(collection).where(field, '==', sourceId).limit(200).get()
      if (!snapshot.size) break
      const batch = db.batch()
      snapshot.docs.forEach((document) => batch.update(document.ref, { [field]: targetId, ...patchFor(document.data()) }))
      await batch.commit()
      moved += snapshot.size
      if (snapshot.size < 200) break
    }
    return moved
  }

  async function merge(scope, data) {
    const sourceId = id(data.sourceCustomerId, 'Hồ sơ gộp đi')
    const targetId = id(data.targetCustomerId, 'Hồ sơ giữ lại')
    if (sourceId === targetId) throw new HttpsError('invalid-argument', 'Chọn hai hồ sơ khác nhau.')
    const [source, target] = await Promise.all([
      loadCustomer(sourceId, scope, { requireManage: true }),
      loadCustomer(targetId, scope, { requireManage: true }),
    ])
    if (source.value.studentId && target.value.studentId && source.value.studentId !== target.value.studentId) {
      throw new HttpsError('failed-precondition', 'Hai hồ sơ nối với hai học viên khác nhau, không thể gộp.')
    }
    const counts = {
      channelLinks: await moveDocuments('crmChannelLinks', 'customerId', sourceId, targetId, () => ({ linkedBy: 'merge', linkedAt: nowMs() })),
      conversations: await moveDocuments('crmConversations', 'customerId', sourceId, targetId),
      steps: await moveDocuments('crmCareSteps', 'customerId', sourceId, targetId, () => ({ customerName: target.value.displayName || '' })),
      activities: await moveDocuments('crmActivities', 'customerId', sourceId, targetId),
      appointments: await moveDocuments('crmAppointments', 'customerId', sourceId, targetId),
    }
    const result = await db.runTransaction(async (transaction) => {
      const [sourceSnapshot, targetSnapshot] = await Promise.all([transaction.get(source.reference), transaction.get(target.reference)])
      const from = sourceSnapshot.data()
      const into = targetSnapshot.data()
      const phones = [...new Set([...(into.phones || []), ...(from.phones || [])])].slice(0, 5)
      const patch = {
        phones,
        emails: [...new Set([...(into.emails || []), ...(from.emails || [])])].slice(0, 3),
        suggestedPhones: [...new Set([...(into.suggestedPhones || []), ...(from.suggestedPhones || [])])].filter((phone) => !phones.includes(phone)).slice(0, 5),
        quoteIds: [...new Set([...(into.quoteIds || []), ...(from.quoteIds || [])])].slice(-20),
        contractIds: [...new Set([...(into.contractIds || []), ...(from.contractIds || [])])].slice(-20),
        studentId: into.studentId || from.studentId || '',
        wonAt: [into.wonAt, from.wonAt].filter(Boolean).sort((left, right) => left - right)[0] || 0,
        goal: into.goal || from.goal || '',
        note: [into.note, from.note].filter(Boolean).join('\n').slice(0, 1000),
        ownerUid: into.ownerUid || from.ownerUid || '',
        ownerName: into.ownerUid ? into.ownerName || '' : from.ownerName || '',
        lastInboundAt: Math.max(into.lastInboundAt || 0, from.lastInboundAt || 0),
        lastOutboundAt: Math.max(into.lastOutboundAt || 0, from.lastOutboundAt || 0),
        openStepCount: (into.openStepCount || 0) + (from.openStepCount || 0),
        searchTokens: searchTokens(into.displayName, phones),
        revision: (into.revision || 0) + 1,
        updatedAt: nowMs(),
        lastActivityAt: nowMs(),
      }
      if (!into.studentId && from.studentId) Object.assign(patch, { stage: from.stage, careOwnerUid: from.careOwnerUid || '', careOwnerStaffId: from.careOwnerStaffId || '', careOwnerKind: from.careOwnerKind || '', careOwnerName: from.careOwnerName || '' })
      transaction.update(target.reference, patch)
      transaction.update(source.reference, { status: 'merged', mergedInto: targetId, mergedAt: nowMs(), mergedBy: scope.uid, revision: (from.revision || 0) + 1, updatedAt: nowMs(), searchTokens: [] })
      activity(transaction, targetId, scope, { type: 'note', note: `Gộp hồ sơ ${from.displayName || sourceId} vào hồ sơ này.`, data: { sourceCustomerId: sourceId, counts } })
      return { ...into, ...patch }
    })
    await afterCustomerChange(targetId, result)
    return { targetCustomerId: targetId, revision: result.revision, moved: counts }
  }

  async function assignCareOwner(scope, data) {
    if (!scope.assignCare) throw denied('Chỉ quản lý chi nhánh giao học viên cho CSKH.')
    if (!Array.isArray(data.studentIds) || !data.studentIds.length || data.studentIds.length > 50) throw new HttpsError('invalid-argument', 'Chọn từ 1 đến 50 học viên.')
    const studentIds = [...new Set(data.studentIds.map((value) => id(value, 'Học viên')))]
    const careOwnerUid = optionalId(data.careOwnerUid, 'CSKH')
    const students = await db.getAll(...studentIds.map((studentId) => db.doc(`students/${studentId}`)))
    const results = []
    for (const student of students) {
      if (!student.exists) { results.push({ studentId: student.id, ok: false, reason: 'Không tìm thấy học viên.' }); continue }
      const branchId = student.data().branchId || ''
      if (!branchAllowed(scope, branchId)) { results.push({ studentId: student.id, ok: false, reason: 'Học viên thuộc chi nhánh khác.' }); continue }
      const owner = careOwnerUid ? await staffMember(careOwnerUid, { positions: CARE_POSITIONS, branchId }) : null
      if (careOwnerUid && !owner) { results.push({ studentId: student.id, ok: false, reason: 'CSKH chưa được gán chi nhánh của học viên.' }); continue }
      const assignmentReference = db.doc(`crmCareAssignments/${student.id}`)
      if (owner) {
        await assignmentReference.set({ studentId: student.id, branchId, careOwnerUid: owner.uid, careOwnerName: owner.name, assignedBy: scope.uid, assignedByName: scope.actorName, assignedAt: nowMs() })
      } else {
        await assignmentReference.delete()
      }
      // Without a CSKH the main PT of the latest contract looks after the student.
      let effective = owner ? { kind: 'customer_care', uid: owner.uid, staffId: '', name: owner.name } : null
      const linked = await db.collection('crmCustomers').where('studentId', '==', student.id).limit(1).get()
      if (!effective && linked.docs[0]) {
        const contracts = await db.collection('contracts').where('studentId', '==', student.id).limit(10).get()
        const latest = contracts.docs.map((document) => document.data()).sort((left, right) => String(right.startDate || '').localeCompare(String(left.startDate || '')))[0]
        effective = await sync.careOwnerFor(student.id, text(latest?.trainerId, 200))
      }
      if (linked.docs[0] && effective) {
        const customerDocument = linked.docs[0]
        await customerDocument.ref.update({
          careOwnerUid: effective.uid || '', careOwnerStaffId: effective.staffId || '', careOwnerKind: effective.kind || '', careOwnerName: effective.name || '',
          revision: (customerDocument.data().revision || 0) + 1, updatedAt: nowMs(),
        })
        await sync.reassignOpenCareSteps(customerDocument.id, effective)
        const batch = db.batch()
        activity(batch, customerDocument.id, scope, { type: 'assignment', note: owner ? `Giao CSKH ${owner.name}.` : 'Bỏ CSKH, PT chính chăm sóc.', data: { careOwnerUid: owner?.uid || '' } })
        await batch.commit()
      }
      results.push({ studentId: student.id, ok: true })
    }
    return { schemaVersion: 1, results, assigned: results.filter((row) => row.ok).length }
  }

  async function erase(scope, data) {
    if (!scope.erase) throw denied('Chỉ quản trị viên được xóa dữ liệu khách hàng.')
    const customerId = id(data.customerId, 'Mã khách hàng')
    if (data.confirmation !== 'XOA') throw new HttpsError('invalid-argument', 'Nhập XOA để xác nhận xóa vĩnh viễn.')
    const reference = db.doc(`crmCustomers/${customerId}`)
    const snapshot = await reference.get()
    if (!snapshot.exists) throw new HttpsError('not-found', 'Không tìm thấy khách hàng.')
    const counts = { messages: 0, conversations: 0, channelLinks: 0, steps: 0, activities: 0, appointments: 0 }
    const deleteQuery = async (query, counter) => {
      for (let round = 0; round < 50; round += 1) {
        const page = await query.limit(400).get()
        if (!page.size) return
        const batch = db.batch()
        page.docs.forEach((document) => batch.delete(document.ref))
        await batch.commit()
        counts[counter] += page.size
        if (page.size < 400) return
      }
      throw new HttpsError('resource-exhausted', 'Hồ sơ quá lớn để xóa một lần. Hãy chạy lại lệnh xóa.', { counts })
    }
    const conversations = await db.collection('crmConversations').where('customerId', '==', customerId).limit(20).get()
    for (const document of conversations.docs) {
      await deleteQuery(db.collection('crmMessages').where('conversationKey', '==', document.id), 'messages')
    }
    await deleteQuery(db.collection('crmConversations').where('customerId', '==', customerId), 'conversations')
    await deleteQuery(db.collection('crmChannelLinks').where('customerId', '==', customerId), 'channelLinks')
    await deleteQuery(db.collection('crmCareSteps').where('customerId', '==', customerId), 'steps')
    await deleteQuery(db.collection('crmActivities').where('customerId', '==', customerId), 'activities')
    await deleteQuery(db.collection('crmAppointments').where('customerId', '==', customerId), 'appointments')
    await reference.delete()
    // The audit record proves the erasure without keeping who the person was.
    await db.collection('crmErasures').doc().set({ customerHash: sha256(customerId), counts, erasedBy: scope.uid, erasedByName: scope.actorName, erasedAt: nowMs(), reason: text(data.reason, 40) || 'customer_request' })
    return { erased: true, counts }
  }

  const commandActions = { updateStage, updateProfile, assignOwner, recordActivity, createStep, completeStep, createAppointment, updateAppointment, linkStudent, linkQuote, merge, assignCareOwner, erase }

  // ================================================ crmIntegrationCommand

  async function validatedClient(pageId, pageAccessToken) {
    const client = clientFactory({ pageId, pageAccessToken })
    try {
      const [tags, users] = await Promise.all([client.listTags(), client.listUsers()])
      return { tags: tags.slice(0, 200), users: users.slice(0, 200) }
    } catch (error) {
      throw pancakeError(error)
    }
  }

  function tokenInput(value) {
    const token = typeof value === 'string' ? value.trim() : ''
    if (token.length < 20 || token.length > 4000 || /\s/.test(token)) throw new HttpsError('invalid-argument', 'Token page Pancake không hợp lệ.')
    return token
  }

  function webhookUrl(pageId, secret) {
    return `${webhookBaseUrl.replace(/\/$/, '')}/${encodeURIComponent(pageId)}/${secret}`
  }

  async function connectPage(scope, data) {
    const pageId = text(data.pageId, 80)
    if (!pageIdValid(pageId)) throw new HttpsError('invalid-argument', 'Mã page Pancake không hợp lệ.')
    const token = tokenInput(data.pageAccessToken)
    const branchId = id(data.branchId, 'Chi nhánh')
    const branch = await db.doc(`branches/${branchId}`).get()
    if (!branch.exists) throw new HttpsError('not-found', 'Không tìm thấy chi nhánh.')
    const platform = platformForPage(pageId, text(data.platform, 20))
    const meta = await validatedClient(pageId, token)
    const secret = newWebhookSecret()
    const reference = db.doc(`crmPancakePages/${pageId}`)
    const existing = await reference.get()
    const now = nowMs()
    await reference.set({
      schemaVersion: 1,
      name: boundedText(data.name, 'Tên page', 120) || existing.data()?.name || pageId,
      platform,
      branchId,
      enabled: true,
      status: 'active',
      tagMap: existing.data()?.tagMap || {},
      staffMap: existing.data()?.staffMap || {},
      pancakeTags: meta.tags,
      pancakeUsers: meta.users,
      lastError: null,
      revision: (existing.data()?.revision || 0) + 1,
      createdAt: existing.data()?.createdAt || now,
      createdBy: existing.data()?.createdBy || scope.uid,
      updatedAt: now,
      updatedBy: scope.uid,
    }, { merge: true })
    await db.doc(`crmPancakePageSecrets/${pageId}`).set({
      token: encryptToken(token, tokenKey()),
      webhookSecretHash: webhookSecretHash(secret),
      webhookSecretHint: secret.slice(-4),
      rotatedAt: now,
      rotatedBy: scope.uid,
    })
    pages.forget(pageId)
    const page = await reference.get()
    return { page: pageView(pageId, page.data(), { webhookSecretHint: secret.slice(-4) }), webhookUrl: webhookUrl(pageId, secret), secretShownOnce: true }
  }

  async function loadPage(pageId) {
    if (!pageIdValid(pageId)) throw new HttpsError('invalid-argument', 'Mã page Pancake không hợp lệ.')
    const reference = db.doc(`crmPancakePages/${pageId}`)
    const snapshot = await reference.get()
    if (!snapshot.exists) throw new HttpsError('not-found', 'Page chưa được kết nối.')
    return { reference, value: snapshot.data() }
  }

  async function updatePage(scope, data) {
    const pageId = text(data.pageId, 80)
    const { reference, value } = await loadPage(pageId)
    if ((value.revision || 0) !== revision(data.expectedRevision)) throw new HttpsError('aborted', 'Cấu hình page vừa thay đổi. Hãy tải lại.')
    const patch = {}
    if (data.name !== undefined) patch.name = boundedText(data.name, 'Tên page', 120, { required: true })
    if (data.enabled !== undefined) {
      if (typeof data.enabled !== 'boolean') throw new HttpsError('invalid-argument', 'Trạng thái bật/tắt không hợp lệ.')
      patch.enabled = data.enabled
      patch.status = data.enabled ? 'active' : 'disabled'
    }
    if (data.platform !== undefined) patch.platform = oneOf(data.platform, PLATFORMS, 'Nền tảng')
    if (data.branchId !== undefined) {
      const branchId = id(data.branchId, 'Chi nhánh')
      if (!(await db.doc(`branches/${branchId}`).get()).exists) throw new HttpsError('not-found', 'Không tìm thấy chi nhánh.')
      patch.branchId = branchId
    }
    if (data.tagMap !== undefined) {
      if (!data.tagMap || typeof data.tagMap !== 'object' || Array.isArray(data.tagMap)) throw new HttpsError('invalid-argument', 'Bảng thẻ không hợp lệ.')
      const known = new Set((value.pancakeTags || []).map((tag) => tag.id))
      patch.tagMap = {}
      for (const [stage, tagId] of Object.entries(data.tagMap)) {
        oneOf(stage, CRM_STAGES, 'Giai đoạn')
        if (!tagId) continue
        if (!known.has(String(tagId))) throw new HttpsError('invalid-argument', `Thẻ ${String(tagId).slice(0, 20)} không có trên page.`)
        patch.tagMap[stage] = String(tagId)
      }
    }
    if (data.staffMap !== undefined) {
      if (!data.staffMap || typeof data.staffMap !== 'object' || Array.isArray(data.staffMap)) throw new HttpsError('invalid-argument', 'Bảng nhân viên không hợp lệ.')
      const known = new Set((value.pancakeUsers || []).map((user) => user.id))
      patch.staffMap = {}
      const entries = Object.entries(data.staffMap).slice(0, 100)
      for (const [pancakeUserId, uid] of entries) {
        if (!uid) continue
        if (!known.has(pancakeUserId)) throw new HttpsError('invalid-argument', 'Nhân viên Pancake không có trên page.')
        const member = await staffMember(id(uid, 'Tài khoản Aura'), { branchId: patch.branchId || value.branchId || '' })
        if (!member) throw new HttpsError('failed-precondition', 'Tài khoản Aura được gán phải là nhân sự đang hoạt động ở chi nhánh của page.')
        patch.staffMap[pancakeUserId] = { uid: member.uid, name: member.name }
      }
    }
    if (!Object.keys(patch).length) throw new HttpsError('invalid-argument', 'Không có cấu hình nào thay đổi.')
    await reference.update({ ...patch, revision: (value.revision || 0) + 1, updatedAt: nowMs(), updatedBy: scope.uid })
    pages.forget(pageId)
    const fresh = await reference.get()
    return { page: pageView(pageId, fresh.data()) }
  }

  async function rotateWebhookSecret(scope, data) {
    const pageId = text(data.pageId, 80)
    await loadPage(pageId)
    const secretReference = db.doc(`crmPancakePageSecrets/${pageId}`)
    const current = await secretReference.get()
    if (!current.exists) throw new HttpsError('failed-precondition', 'Page chưa có token. Hãy kết nối lại.')
    const secret = newWebhookSecret()
    await secretReference.set({ webhookSecretHash: webhookSecretHash(secret), webhookSecretHint: secret.slice(-4), rotatedAt: nowMs(), rotatedBy: scope.uid }, { merge: true })
    return { webhookUrl: webhookUrl(pageId, secret), secretShownOnce: true }
  }

  async function replaceToken(scope, data) {
    const pageId = text(data.pageId, 80)
    const { reference } = await loadPage(pageId)
    const token = tokenInput(data.pageAccessToken)
    const meta = await validatedClient(pageId, token)
    await db.doc(`crmPancakePageSecrets/${pageId}`).set({ token: encryptToken(token, tokenKey()), rotatedAt: nowMs(), rotatedBy: scope.uid }, { merge: true })
    await reference.set({ pancakeTags: meta.tags, pancakeUsers: meta.users, status: 'active', lastError: null, updatedAt: nowMs(), updatedBy: scope.uid }, { merge: true })
    pages.forget(pageId)
    return { page: pageView(pageId, (await reference.get()).data()) }
  }

  async function refreshPageMeta(scope, data) {
    const pageId = text(data.pageId, 80)
    const { reference } = await loadPage(pageId)
    let meta
    try {
      const client = await pages.client(pageId)
      const [tags, users] = await Promise.all([client.listTags(), client.listUsers()])
      meta = { tags: tags.slice(0, 200), users: users.slice(0, 200) }
    } catch (error) {
      if (error instanceof PancakeApiError) await sync.markPageError(pageId, error)
      throw pancakeError(error)
    }
    await reference.set({ pancakeTags: meta.tags, pancakeUsers: meta.users, updatedAt: nowMs(), updatedBy: scope.uid }, { merge: true })
    pages.forget(pageId)
    return { page: pageView(pageId, (await reference.get()).data()) }
  }

  async function startBackfill(scope, data) {
    const pageId = text(data.pageId, 80)
    const { reference, value } = await loadPage(pageId)
    const days = Number(data.days ?? MAX_BACKFILL_DAYS)
    if (!Number.isInteger(days) || days < 1 || days > MAX_BACKFILL_DAYS) throw new HttpsError('invalid-argument', `Số ngày lấy lại từ 1 đến ${MAX_BACKFILL_DAYS}.`)
    if (value.backfill?.status === 'running') throw new HttpsError('failed-precondition', 'Page đang lấy lại lịch sử.')
    const now = nowMs()
    await reference.set({
      backfill: { status: 'running', sinceMs: now - days * 86_400_000, cursorUntil: now, lastConversationId: null, conversations: 0, startedAt: now, startedBy: scope.uid },
      updatedAt: now,
    }, { merge: true })
    pages.forget(pageId)
    return { page: pageView(pageId, (await reference.get()).data()) }
  }

  async function disconnectPage(scope, data) {
    const pageId = text(data.pageId, 80)
    const { reference } = await loadPage(pageId)
    await reference.set({ enabled: false, status: 'disabled', updatedAt: nowMs(), updatedBy: scope.uid }, { merge: true })
    await db.doc(`crmPancakePageSecrets/${pageId}`).delete()
    pages.forget(pageId)
    return { page: pageView(pageId, (await reference.get()).data()) }
  }

  const integrationActions = { connectPage, updatePage, rotateWebhookSecret, replaceToken, refreshPageMeta, startBackfill, disconnectPage }

  function dispatcher(name, actions, guard = null) {
    return withFunctionTelemetry(name, async (request) => {
      const data = request.data && typeof request.data === 'object' ? request.data : {}
      const handler = actions[data.action]
      if (!handler) throw new HttpsError('invalid-argument', 'Thao tác CRM không hợp lệ.')
      const scope = await scopeFor(request)
      if (guard) guard(scope)
      return handler(scope, data)
    })
  }

  return {
    crmQuery: onCall(readOptions, dispatcher('crmQuery', queryActions)),
    crmCommand: onCall(writeOptions, dispatcher('crmCommand', commandActions)),
    crmIntegrationCommand: onCall(integrationOptions, dispatcher('crmIntegrationCommand', integrationActions, (scope) => {
      if (!scope.integration) throw denied('Chỉ quản trị viên quản lý kết nối Pancake.')
    })),
  }
}

module.exports = { createCrmFunctions, customerView, encodeCursor, decodeCursor, localPhone }
