'use strict'

// Moves Pancake conversations into the CRM collections. One path serves the
// webhook processor, the 10-minute reconciliation and the 90-day backfill, so
// every source writes the same documents the same way and reruns are safe.

const { Timestamp } = require('firebase-admin/firestore')
const { PancakeApiError, createPancakeClient } = require('./crm-pancake-client')
const {
  ESCALATE_AFTER_DUE_MINUTES,
  INBOX_REPLY_SLA_MINUTES,
  REPLY_STEP_MAX_AGE_MS,
  STAGE_LABELS,
  STUDENT_REPLY_SLA_MINUTES,
  channelLinkId,
  conversationKey,
  customerIdForLink,
  decryptToken,
  messageDocId,
  normalizePancakeConversation,
  normalizePancakeMessage,
  normalizePhone,
  phonesInText,
  replyState,
  searchTokens,
  sha256,
  slaDueAt,
  text,
  vietnamDateKey,
  webhookRefs,
} = require('./crm-core')

const RECONCILE_LOOKBACK_MS = 15 * 60_000
const RECONCILE_MAX_WINDOW_MS = 24 * 60 * 60_000
const WEBHOOK_QUIET_MS = 15 * 60_000
const BACKFILL_WINDOW_MS = 7 * 24 * 60 * 60_000
const MAX_BACKFILL_DAYS = 90
const LIVE_MESSAGE_PAGES = 4
const BACKFILL_MESSAGE_PAGES = 12
const INBOUND_EVENT_TTL_DAYS = 30

function timestampMillis(value) {
  if (typeof value === 'number') return value
  if (value?.toMillis) return value.toMillis()
  if (value?.toDate) return value.toDate().getTime()
  if (typeof value?._seconds === 'number') return value._seconds * 1000
  const parsed = Date.parse(String(value || ''))
  return Number.isFinite(parsed) ? parsed : 0
}

function chunk(values, size) {
  const result = []
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size))
  return result
}

function createPageResolver({ db, tokenKey, clientFactory = createPancakeClient, ttlMs = 60_000, nowMs = () => Date.now() }) {
  const pages = new Map()
  const clients = new Map()
  async function page(pageId, { fresh = false } = {}) {
    const cached = pages.get(pageId)
    if (!fresh && cached && cached.expiresAt > nowMs()) return cached.value
    const snapshot = await db.doc(`crmPancakePages/${pageId}`).get()
    const value = snapshot.exists ? { ...snapshot.data(), pageId } : null
    pages.set(pageId, { value, expiresAt: nowMs() + Math.min(ttlMs, 30_000) })
    return value
  }
  async function client(pageId) {
    const cached = clients.get(pageId)
    if (cached && cached.expiresAt > nowMs()) return cached.value
    const secrets = await db.doc(`crmPancakePageSecrets/${pageId}`).get()
    if (!secrets.exists || !secrets.data().token) throw new PancakeApiError('Page chưa có token Pancake.', { reconnect: true })
    const value = clientFactory({ pageId, pageAccessToken: decryptToken(secrets.data().token, tokenKey()) })
    clients.set(pageId, { value, expiresAt: nowMs() + ttlMs })
    return value
  }
  function forget(pageId) {
    pages.delete(pageId)
    clients.delete(pageId)
  }
  return { page, client, forget }
}

function createCrmSync({ db, pages, nowMs = () => Date.now(), logger = console }) {
  // ---------------------------------------------------------------- messages

  async function fetchMessages(client, { pageId, conversationId, pageCustomerId, externalCustomerId, stopBefore, maxPages }) {
    const seen = new Map()
    let customers = []
    let complete = false
    let loaded = 0
    for (let pageIndex = 0; pageIndex < maxPages; pageIndex += 1) {
      const result = await client.getMessages({ conversationId, customerId: pageCustomerId || undefined, currentCount: loaded || undefined })
      if (!customers.length && result.customers.length) customers = result.customers
      const external = externalCustomerId || text(customers[0]?.fb_id || customers[0]?.psid, 120)
      const rows = result.messages.map((raw) => normalizePancakeMessage(raw, { pageId, externalCustomerId: external })).filter(Boolean)
      if (!result.messages.length) { complete = true; break }
      const fresh = rows.filter((row) => !seen.has(row.messageId))
      // Only an empty page proves the start of the thread was reached.
      if (!fresh.length) break
      fresh.forEach((row) => seen.set(row.messageId, row))
      loaded += result.messages.length
      const oldest = Math.min(...fresh.map((row) => row.sentAt || Number.MAX_SAFE_INTEGER))
      if (stopBefore && oldest <= stopBefore) break
    }
    return {
      messages: [...seen.values()].sort((left, right) => left.sentAt - right.sentAt || left.messageId.localeCompare(right.messageId)),
      customers,
      complete,
    }
  }

  async function resolveCustomer(linkId, fallbackId) {
    const linkSnapshot = await db.doc(`crmChannelLinks/${linkId}`).get()
    let customerId = linkSnapshot.exists ? linkSnapshot.data().customerId : fallbackId
    if (!customerId) return { customerId: '', linkExists: false }
    // Follow a merge once; merges always point at a live record.
    const snapshot = await db.doc(`crmCustomers/${customerId}`).get()
    if (snapshot.exists && snapshot.data().status === 'merged' && snapshot.data().mergedInto) customerId = snapshot.data().mergedInto
    return { customerId, linkExists: linkSnapshot.exists }
  }

  function replyOwner(page, customer, assigneeIds) {
    if (customer?.studentId) {
      return {
        kind: 'student_reply', ownerRole: 'care_owner',
        ownerUid: customer.careOwnerUid || '', ownerStaffId: customer.careOwnerStaffId || '', ownerName: customer.careOwnerName || '',
      }
    }
    const mapped = assigneeIds.map((id) => page.staffMap?.[id]).find((entry) => entry?.uid)
    return {
      kind: 'inbox_reply', ownerRole: 'sales',
      ownerUid: mapped?.uid || customer?.ownerUid || '', ownerStaffId: '', ownerName: mapped?.name || customer?.ownerName || '',
    }
  }

  async function syncConversation({ page, client, conversationId, conversation = null, mode = 'live' }) {
    const pageId = page.pageId
    const platform = page.platform || 'facebook'
    const now = nowMs()
    const key = conversationKey(pageId, conversationId)
    const conversationReference = db.doc(`crmConversations/${key}`)
    const existingSnapshot = await conversationReference.get()
    const existing = existingSnapshot.exists ? existingSnapshot.data() : null
    let meta = conversation ? normalizePancakeConversation(conversation, pageId) : null
    // A webhook may carry only the conversation id; look the thread up once
    // to learn the customer's Pancake id and name.
    if ((!meta || !meta.pageCustomerId) && !existing?.pageCustomerId && mode !== 'backfill') {
      const recent = await client.listConversations({ since: now - 6 * 60 * 60_000, until: now })
      const found = recent.find((row) => String(row?.id) === conversationId)
      if (found) meta = normalizePancakeConversation(found, pageId)
    }
    if (meta && meta.type && meta.type !== 'INBOX') return { skipped: 'not_inbox', conversationKey: key }

    const fetched = await fetchMessages(client, {
      pageId,
      conversationId,
      pageCustomerId: meta?.pageCustomerId || existing?.pageCustomerId || '',
      externalCustomerId: meta?.externalCustomerId || existing?.externalCustomerId || '',
      stopBefore: mode === 'backfill' ? 0 : existing?.lastMessageAt || 0,
      maxPages: mode === 'backfill' ? BACKFILL_MESSAGE_PAGES : LIVE_MESSAGE_PAGES,
    })
    const responseCustomer = fetched.customers[0] || {}
    const externalCustomerId = meta?.externalCustomerId || existing?.externalCustomerId
      || text(responseCustomer.fb_id || responseCustomer.psid, 120)
      || (conversationId.startsWith(`${pageId}_`) ? conversationId.slice(pageId.length + 1) : '')
    const pageCustomerId = meta?.pageCustomerId || existing?.pageCustomerId || text(responseCustomer.id, 120)
    const customerName = meta?.customerName || existing?.customerName || text(responseCustomer.name, 160)
    const messages = fetched.messages
    const newest = messages.at(-1) || null

    // Messages first; they are idempotent by id, so a failed transaction
    // below is repaired by the next event or reconciliation.
    const previousLast = existing?.lastMessageAt || 0
    const toWrite = mode === 'backfill' || !existing ? messages : messages.filter((row) => row.sentAt >= previousLast - 1000)
    for (const group of chunk(toWrite, 400)) {
      const batch = db.batch()
      for (const row of group) {
        batch.set(db.doc(`crmMessages/${messageDocId(`${key}|${row.messageId}`)}`), {
          ...row, conversationKey: key, pageId, platform, source: mode, syncedAt: now,
        }, { merge: true })
      }
      await batch.commit()
    }
    const newMessages = messages.filter((row) => row.sentAt > previousLast)

    const linkId = channelLinkId({ platform, pageId, externalCustomerId, conversationId })
    const resolved = await resolveCustomer(linkId, existing?.customerId || '')
    const customerId = resolved.customerId || customerIdForLink(linkId)
    const state = replyState(messages)
    const assigneeIds = meta?.assigneeIds || existing?.assigneePancakeIds || []
    const phoneHints = [...new Set([
      ...(existing?.phoneHints || []),
      ...(meta?.phones || []),
      ...newMessages.filter((row) => row.direction === 'in').flatMap((row) => phonesInText(row.text)),
    ].map(normalizePhone).filter(Boolean))].slice(0, 5)

    const result = await db.runTransaction(async (transaction) => {
      const customerReference = db.doc(`crmCustomers/${customerId}`)
      const [currentConversationSnapshot, customerSnapshot] = await Promise.all([
        transaction.get(conversationReference),
        transaction.get(customerReference),
      ])
      const current = currentConversationSnapshot.exists ? currentConversationSnapshot.data() : null
      const customer = customerSnapshot.exists ? customerSnapshot.data() : null
      const lastMessageAt = Math.max(current?.lastMessageAt || 0, newest?.sentAt || 0, messages.length ? 0 : meta?.updatedAt || 0)
      // A slower sync that read fewer messages never rewinds a newer one.
      const stale = Boolean(current?.lastMessageAt) && newest && newest.sentAt < current.lastMessageAt
      let awaitingSince = current?.awaitingSince ?? null
      if (!stale && messages.length) {
        awaitingSince = state.awaitingSince
        const noReplyInView = !messages.some((row) => row.direction === 'out')
        if (awaitingSince !== null && noReplyInView && !fetched.complete && current?.awaitingReply && current.awaitingSince) {
          awaitingSince = Math.min(current.awaitingSince, awaitingSince)
        }
      }
      const awaitingReply = awaitingSince !== null
      const firstInboundAt = current?.firstInboundAt || (fetched.complete || mode === 'backfill' ? state.firstInboundAt : 0) || 0
      const firstResponseAt = current?.firstResponseAt || (firstInboundAt && state.firstResponseAt > firstInboundAt ? state.firstResponseAt : 0)
      const branchId = customer?.branchId || page.branchId || null

      const nextCustomer = customer ? {
        lastInboundAt: Math.max(customer.lastInboundAt || 0, state.lastInboundAt || 0),
        lastOutboundAt: Math.max(customer.lastOutboundAt || 0, state.lastOutboundAt || 0),
        suggestedPhones: [...new Set([...(customer.suggestedPhones || []), ...phoneHints])].filter((phone) => !(customer.phones || []).includes(phone)).slice(0, 5),
        updatedAt: now,
      } : null
      if (customer && customer.firstResponseSeconds == null && firstInboundAt && firstResponseAt) {
        nextCustomer.firstResponseSeconds = Math.max(0, Math.round((firstResponseAt - firstInboundAt) / 1000))
      }
      if (customer && !customer.displayName && customerName) nextCustomer.displayName = customerName

      const createdCustomer = customer ? null : {
        schemaVersion: 1,
        status: 'active',
        displayName: customerName || 'Khách Pancake',
        phones: [],
        suggestedPhones: phoneHints,
        emails: [],
        branchId,
        stage: 'new_inbox',
        stageChangedAt: now,
        ownerUid: '', ownerName: '',
        careOwnerUid: '', careOwnerStaffId: '', careOwnerKind: '', careOwnerName: '',
        source: { platform, pageId, pageName: page.name || '', conversationKey: key, firstContactAt: firstInboundAt || state.lastInboundAt || now },
        studentId: '', wonAt: 0, contractIds: [], quoteIds: [],
        goal: '', preferredSlots: '', note: '', lostReason: '', lostNote: '',
        lastInboundAt: state.lastInboundAt || 0,
        lastOutboundAt: state.lastOutboundAt || 0,
        lastActivityAt: now,
        firstResponseSeconds: firstInboundAt && firstResponseAt ? Math.max(0, Math.round((firstResponseAt - firstInboundAt) / 1000)) : null,
        openStepCount: 0,
        fromBackfill: mode === 'backfill',
        searchTokens: searchTokens(customerName, []),
        revision: 1,
        createdAt: now,
        updatedAt: now,
      }
      const effectiveCustomer = customer ? { ...customer, ...nextCustomer } : createdCustomer
      const owner = replyOwner(page, effectiveCustomer, assigneeIds)
      const assigneeUids = assigneeIds.map((id) => page.staffMap?.[id]?.uid).filter(Boolean)
      if (createdCustomer && owner.kind === 'inbox_reply' && assigneeUids[0]) {
        createdCustomer.ownerUid = assigneeUids[0]
        createdCustomer.ownerName = page.staffMap?.[assigneeIds[0]]?.name || ''
      }

      // Reply step: one per unanswered stretch of customer messages.
      const writes = []
      let openReplyStepId = stale ? current?.openReplyStepId || '' : ''
      if (!stale) {
        const previousStepId = current?.openReplyStepId || ''
        const wantStep = awaitingReply && mode !== 'backfill' && now - awaitingSince <= REPLY_STEP_MAX_AGE_MS
        const stepId = wantStep ? `r_${sha256(`${key}|${awaitingSince}`).slice(0, 32)}` : ''
        if (previousStepId && previousStepId !== stepId) {
          writes.push(['update-if-open', db.doc(`crmCareSteps/${previousStepId}`), {
            status: 'done', outcome: 'replied', autoClosed: true,
            completedAt: state.lastOutboundAt || now, completedBy: 'pancake', updatedAt: now,
          }])
        }
        if (stepId) {
          const returning = ['lost', 'nurture'].includes(effectiveCustomer.stage)
          const minutes = owner.kind === 'student_reply' ? STUDENT_REPLY_SLA_MINUTES : INBOX_REPLY_SLA_MINUTES
          const dueAt = slaDueAt(awaitingSince, minutes)
          writes.push(['create-if-missing', db.doc(`crmCareSteps/${stepId}`), {
            schemaVersion: 1,
            customerId,
            customerName: effectiveCustomer.displayName || customerName || '',
            studentId: effectiveCustomer.studentId || '',
            conversationKey: key,
            branchId,
            kind: owner.kind,
            title: owner.kind === 'student_reply'
              ? 'Trả lời học viên nhắn page'
              : returning ? 'Khách cũ nhắn lại · phản hồi' : 'Phản hồi inbox',
            note: (newest?.text || '').slice(0, 200),
            status: 'open',
            ownerRole: owner.ownerRole,
            ownerUid: owner.ownerUid,
            ownerStaffId: owner.ownerStaffId,
            ownerName: owner.ownerName,
            ownerKeys: [...new Set([owner.ownerUid, owner.ownerStaffId].filter(Boolean))],
            dueAt,
            escalateAt: dueAt + ESCALATE_AFTER_DUE_MINUTES * 60_000,
            sopCode: owner.kind === 'student_reply' ? '' : 'SOP-INBOX-01',
            createdAt: now,
            updatedAt: now,
          }])
          openReplyStepId = stepId
        }
      }

      const stepSnapshots = new Map()
      for (const [kind, reference] of writes) {
        if (kind === 'update-if-open' || kind === 'create-if-missing') stepSnapshots.set(reference.path, await transaction.get(reference))
      }

      const conversationDocument = {
        schemaVersion: 1,
        pageId,
        pageName: page.name || '',
        conversationId,
        platform,
        branchId,
        customerId,
        externalCustomerId,
        pageCustomerId,
        customerName,
        assigneePancakeIds: assigneeIds,
        assigneeUids,
        pancakeTagIds: meta?.tagIds || current?.pancakeTagIds || [],
        phoneHints,
        unread: meta ? meta.unread : current?.unread ?? awaitingReply,
        updatedAt: now,
        syncedAt: now,
        syncedConversationUpdatedAt: Math.max(current?.syncedConversationUpdatedAt || 0, meta?.updatedAt || 0),
        messageCount: (current?.messageCount || 0) + (stale ? 0 : newMessages.length),
        firstMessageAt: current?.firstMessageAt || messages[0]?.sentAt || 0,
        firstInboundAt,
        firstResponseAt,
        studentId: effectiveCustomer.studentId || '',
        // Mirrors read by the inbox list so it needs no customer reads.
        displayName: effectiveCustomer.displayName || customerName || '',
        customerStage: effectiveCustomer.stage || 'new_inbox',
        ownerUid: effectiveCustomer.ownerUid || '',
        ownerName: effectiveCustomer.ownerName || '',
      }
      if (!stale) {
        Object.assign(conversationDocument, {
          lastMessageAt,
          lastMessageFrom: newest ? (newest.direction === 'in' ? 'customer' : 'page') : current?.lastMessageFrom || '',
          preview: newest ? (newest.text || (newest.attachments[0] ? `[${newest.attachments[0].type}]` : '')).slice(0, 200) : current?.preview || meta?.snippet || '',
          lastInboundAt: Math.max(current?.lastInboundAt || 0, state.lastInboundAt || 0),
          lastOutboundAt: Math.max(current?.lastOutboundAt || 0, state.lastOutboundAt || 0),
          awaitingReply,
          awaitingSince: awaitingReply ? awaitingSince : null,
          openReplyStepId,
        })
      }
      transaction.set(conversationReference, conversationDocument, { merge: true })
      if (!resolved.linkExists) {
        transaction.set(db.doc(`crmChannelLinks/${linkId}`), {
          platform, pageId, conversationId, conversationKey: key, externalCustomerId, pageCustomerId,
          customerId, linkedBy: 'channel', linkedAt: now,
        }, { merge: true })
      }
      let stepDelta = 0
      for (const [kind, reference, value] of writes) {
        const snapshot = stepSnapshots.get(reference.path)
        if (kind === 'update-if-open' && snapshot?.exists && snapshot.data().status === 'open') {
          transaction.update(reference, value)
          stepDelta -= 1
        }
        if (kind === 'create-if-missing' && !snapshot?.exists) {
          transaction.set(reference, value)
          stepDelta += 1
        }
      }
      if (createdCustomer) {
        createdCustomer.openStepCount = Math.max(0, stepDelta)
        createdCustomer.nextStepAt = openReplyStepId ? slaDueAt(awaitingSince, owner.kind === 'student_reply' ? STUDENT_REPLY_SLA_MINUTES : INBOX_REPLY_SLA_MINUTES) : 0
        transaction.set(customerReference, createdCustomer)
      } else {
        if (stepDelta) nextCustomer.openStepCount = Math.max(0, (customer.openStepCount || 0) + stepDelta)
        if (newMessages.some((row) => row.direction === 'in') && ['lost', 'nurture'].includes(customer.stage) && mode === 'live') {
          nextCustomer.lastActivityAt = now
        }
        transaction.update(customerReference, nextCustomer)
      }
      return { customerId, createdCustomer: Boolean(createdCustomer), awaitingReply, stale, stepDelta }
    })
    return { conversationKey: key, messages: messages.length, written: toWrite.length, ...result }
  }

  // ------------------------------------------------------------ page health

  async function markPageError(pageId, error) {
    const now = nowMs()
    const patch = { lastError: { message: String(error?.message || 'Lỗi không rõ').slice(0, 200), code: String(error?.code || ''), at: now }, updatedAt: now }
    if (error instanceof PancakeApiError && error.reconnect) patch.status = 'needs_reconnect'
    await db.doc(`crmPancakePages/${pageId}`).set(patch, { merge: true })
    pages.forget(pageId)
  }

  // -------------------------------------------------------- inbound events

  async function processInboundEvent(eventId, event) {
    const reference = db.doc(`crmInboundEvents/${eventId}`)
    const finish = (status, extra = {}) => reference.set({ status, processedAt: nowMs(), attempts: (event.attempts || 0) + 1, ...extra }, { merge: true })
    const page = await pages.page(event.pageId)
    if (!page || page.enabled === false || page.status === 'disabled') return finish('ignored', { reason: 'page_disabled' })
    let payload = null
    try { payload = JSON.parse(event.payloadJson || 'null') } catch { return finish('ignored', { reason: 'invalid_json' }) }
    const refs = webhookRefs(payload)
    if (refs.topic.includes('connect')) {
      await db.doc(`crmPancakePages/${page.pageId}`).set({ lastConnectStatusAt: nowMs(), lastConnectStatus: text(JSON.stringify(payload?.data ?? payload), 300) }, { merge: true })
      return finish('processed', { topic: refs.topic })
    }
    if (!refs.conversationId) return finish('ignored', { reason: 'no_conversation', topic: refs.topic })
    try {
      const client = await pages.client(page.pageId)
      const outcome = await syncConversation({ page, client, conversationId: refs.conversationId, conversation: refs.conversation, mode: 'live' })
      return finish('processed', { topic: refs.topic, conversationKey: outcome.conversationKey, customerId: outcome.customerId || '' })
    } catch (error) {
      logger.warn?.('crm_inbound_event_failed', { eventId, pageId: page.pageId, message: String(error?.message || error).slice(0, 200) })
      if (error instanceof PancakeApiError) await markPageError(page.pageId, error)
      // Reconciliation picks the conversation up again; no trigger retry.
      return finish('failed', { error: String(error?.message || 'Lỗi xử lý').slice(0, 200) })
    }
  }

  // ---------------------------------------------------------- reconcile

  async function reconcilePage(page, client, { budgetMs = 60_000 } = {}) {
    const started = Date.now()
    const now = nowMs()
    const since = Math.max((page.lastReconcileAt || now - 60 * 60_000) - RECONCILE_LOOKBACK_MS, now - RECONCILE_MAX_WINDOW_MS)
    let lastConversationId
    let synced = 0
    let missedByWebhook = 0
    let exhausted = false
    for (let pageIndex = 0; pageIndex < 5 && !exhausted; pageIndex += 1) {
      const rows = await client.listConversations({ since, until: now, lastConversationId })
      if (!rows.length) break
      const metas = rows.map((row) => ({ raw: row, meta: normalizePancakeConversation(row, page.pageId) }))
        .filter((item) => item.meta && item.meta.type === 'INBOX')
      const snapshots = metas.length ? await db.getAll(...metas.map((item) => db.doc(`crmConversations/${conversationKey(page.pageId, item.meta.conversationId)}`))) : []
      for (let index = 0; index < metas.length; index += 1) {
        const stored = snapshots[index]?.exists ? snapshots[index].data() : null
        const { raw, meta } = metas[index]
        if (stored && meta.updatedAt && meta.updatedAt <= (stored.syncedConversationUpdatedAt || 0) + 1000) continue
        await syncConversation({ page, client, conversationId: meta.conversationId, conversation: raw, mode: 'reconcile' })
        synced += 1
        if (meta.updatedAt > (page.webhookLastReceivedAt || 0) + 60_000) missedByWebhook += 1
        if (Date.now() - started > budgetMs) { exhausted = true; break }
      }
      if (rows.length < 60) break
      lastConversationId = String(rows.at(-1).id)
    }
    const webhookQuiet = !page.webhookLastReceivedAt || now - page.webhookLastReceivedAt > WEBHOOK_QUIET_MS
    const suspected = missedByWebhook > 0 && webhookQuiet
    await db.doc(`crmPancakePages/${page.pageId}`).set({
      lastReconcileAt: exhausted ? page.lastReconcileAt || since : now,
      lastReconcileSynced: synced,
      webhookSuspectedDown: suspected,
      ...(page.status === 'needs_reconnect' ? { status: 'active' } : {}),
    }, { merge: true })
    return { synced, suspected, exhausted }
  }

  async function advanceBackfill(page, client, { budgetMs = 120_000 } = {}) {
    const backfill = page.backfill || {}
    if (backfill.status !== 'running') return { skipped: true }
    const started = Date.now()
    const sinceMs = backfill.sinceMs || nowMs() - MAX_BACKFILL_DAYS * 86_400_000
    let windowEnd = backfill.cursorUntil || nowMs()
    let lastConversationId = backfill.lastConversationId || undefined
    let conversations = backfill.conversations || 0
    let finished = false
    while (Date.now() - started < budgetMs) {
      const windowStart = Math.max(sinceMs, windowEnd - BACKFILL_WINDOW_MS)
      const rows = await client.listConversations({ since: windowStart, until: windowEnd, lastConversationId })
      let stoppedEarly = false
      for (const row of rows) {
        const meta = normalizePancakeConversation(row, page.pageId)
        if (meta && meta.type === 'INBOX') {
          await syncConversation({ page, client, conversationId: meta.conversationId, conversation: row, mode: 'backfill' })
          conversations += 1
        }
        lastConversationId = String(row.id)
        if (Date.now() - started > budgetMs) { stoppedEarly = true; break }
      }
      if (stoppedEarly) break
      if (rows.length < 60) {
        windowEnd = windowStart
        lastConversationId = undefined
        if (windowEnd <= sinceMs) { finished = true; break }
      }
    }
    await db.doc(`crmPancakePages/${page.pageId}`).set({
      backfill: {
        ...backfill,
        status: finished ? 'done' : 'running',
        sinceMs,
        cursorUntil: windowEnd,
        lastConversationId: lastConversationId || null,
        conversations,
        updatedAt: nowMs(),
        ...(finished ? { finishedAt: nowMs() } : {}),
      },
    }, { merge: true })
    return { conversations, finished }
  }

  // ---------------------------------------------------------- notifications

  async function notify(userId, payload) {
    if (!userId) return false
    const reference = db.doc(`users/${userId}/notifications/${payload.dedupeKey}`)
    try {
      await reference.create({
        id: reference.id,
        userId,
        title: payload.title,
        message: payload.message,
        type: 'crm',
        category: 'general',
        actionUrl: payload.actionUrl,
        dedupeKey: payload.dedupeKey,
        dateString: vietnamDateKey(nowMs()),
        read: false,
        createdAt: Timestamp.fromMillis(nowMs()),
      })
      return true
    } catch (error) {
      if (String(error?.code) === '6' || /already exists/i.test(String(error?.message))) return false
      throw error
    }
  }

  async function branchManagers(cache, branchId) {
    if (!branchId) return []
    if (!cache.managers) {
      const snapshot = await db.collection('roleAssignments').where('positions', 'array-contains', 'branch_manager').limit(200).get()
      cache.managers = snapshot.docs.map((document) => ({ uid: document.id, ...document.data() }))
        .filter((row) => row.status === 'active' && row.accessRole === 'staff')
    }
    return cache.managers.filter((row) => Array.isArray(row.branchIds) && row.branchIds.includes(branchId)).map((row) => row.uid)
  }

  async function escalateSteps({ limit = 200 } = {}) {
    const now = nowMs()
    const snapshot = await db.collection('crmCareSteps').where('status', '==', 'open').where('dueAt', '<=', now).orderBy('dueAt').limit(limit).get()
    const cache = {}
    let ownerNotices = 0
    let escalations = 0
    for (const document of snapshot.docs) {
      const step = document.data()
      const patch = {}
      const actionUrl = `#/staff-crm?focus=${encodeURIComponent(step.customerId)}`
      if (!step.ownerNotifiedAt) {
        const recipients = step.ownerUid ? [step.ownerUid] : await branchManagers(cache, step.branchId)
        for (const uid of recipients) {
          if (await notify(uid, { dedupeKey: `crm-due-${document.id}`.slice(0, 120), title: 'Bước chăm sóc đến hạn', message: `${step.title}${step.ownerName ? '' : ' · chưa có người nhận'}`, actionUrl })) ownerNotices += 1
        }
        Object.assign(patch, { ownerNotifiedAt: now, overdue: true })
      }
      if ((step.escalateAt || Infinity) <= now && !step.escalatedAt && step.kind !== 'handover') {
        for (const uid of await branchManagers(cache, step.branchId)) {
          if (uid === step.ownerUid) continue
          if (await notify(uid, { dedupeKey: `crm-esc-${document.id}`.slice(0, 120), title: 'Khách chờ quá lâu', message: `${step.title}${step.ownerName ? ` · ${step.ownerName}` : ''}`, actionUrl })) escalations += 1
        }
        patch.escalatedAt = now
      }
      if (Object.keys(patch).length) await document.ref.update({ ...patch, updatedAt: now })
    }
    return { scanned: snapshot.size, ownerNotices, escalations }
  }

  // --------------------------------------------------------- maintenance

  async function runMaintenance({ reconcileBudgetMs = 60_000, backfillBudgetMs = 120_000 } = {}) {
    const summary = { pages: 0, synced: 0, backfilled: 0, errors: 0 }
    const snapshot = await db.collection('crmPancakePages').where('enabled', '==', true).limit(20).get()
    for (const document of snapshot.docs) {
      const page = { ...document.data(), pageId: document.id }
      summary.pages += 1
      try {
        const client = await pages.client(page.pageId)
        const reconcile = await reconcilePage(page, client, { budgetMs: reconcileBudgetMs })
        summary.synced += reconcile.synced
        if (page.backfill?.status === 'running') summary.backfilled += (await advanceBackfill(page, client, { budgetMs: backfillBudgetMs })).conversations || 0
      } catch (error) {
        summary.errors += 1
        logger.warn?.('crm_reconcile_failed', { pageId: page.pageId, message: String(error?.message || error).slice(0, 200) })
        await markPageError(page.pageId, error)
      }
    }
    const steps = await escalateSteps()
    return { ...summary, ...steps }
  }

  // -------------------------------------------------------- tag mirroring

  // Aura owns the stage; the Pancake tag only reflects it for the inbox.
  async function mirrorStage(customerId, previousStage, nextStage) {
    const conversations = await db.collection('crmConversations').where('customerId', '==', customerId).limit(10).get()
    let mirrored = 0
    let failed = 0
    for (const document of conversations.docs) {
      const conversation = document.data()
      try {
        const page = await pages.page(conversation.pageId)
        const add = page?.tagMap?.[nextStage] || ''
        const remove = page?.tagMap?.[previousStage] || ''
        if (!page || page.enabled === false || (!add && !remove)) continue
        const client = await pages.client(conversation.pageId)
        if (remove && remove !== add) await client.setTag({ conversationId: conversation.conversationId, tagId: remove, action: 'remove' })
        if (add) await client.setTag({ conversationId: conversation.conversationId, tagId: add, action: 'add' })
        mirrored += 1
      } catch (error) {
        failed += 1
        logger.warn?.('crm_tag_mirror_failed', { pageId: conversation.pageId, message: String(error?.message || error).slice(0, 200) })
        if (error instanceof PancakeApiError && error.reconnect) await markPageError(conversation.pageId, error)
      }
    }
    return { mirrored, failed }
  }

  // Conversations carry a few customer fields so the inbox reads one
  // collection. Every change of those fields goes through here.
  async function refreshConversationMirrors(customerId, customer) {
    const snapshot = await db.collection('crmConversations').where('customerId', '==', customerId).limit(10).get()
    if (!snapshot.size) return 0
    const batch = db.batch()
    for (const document of snapshot.docs) {
      batch.update(document.ref, {
        displayName: customer.displayName || '',
        customerStage: customer.stage || 'new_inbox',
        ownerUid: customer.ownerUid || '',
        ownerName: customer.ownerName || '',
        studentId: customer.studentId || '',
        branchId: customer.branchId || document.data().branchId || null,
        updatedAt: nowMs(),
      })
    }
    await batch.commit()
    return snapshot.size
  }

  async function mirrorOwner(customerId, ownerUid) {
    const conversations = await db.collection('crmConversations').where('customerId', '==', customerId).limit(10).get()
    let mirrored = 0
    let failed = 0
    for (const document of conversations.docs) {
      const conversation = document.data()
      try {
        const page = await pages.page(conversation.pageId)
        const pancakeUserId = Object.entries(page?.staffMap || {}).find(([, entry]) => entry?.uid === ownerUid)?.[0]
        if (!page || page.enabled === false || !pancakeUserId) continue
        const client = await pages.client(conversation.pageId)
        await client.assign({ conversationId: conversation.conversationId, assigneeIds: [pancakeUserId] })
        mirrored += 1
      } catch (error) {
        failed += 1
        logger.warn?.('crm_assign_mirror_failed', { pageId: conversation.pageId, message: String(error?.message || error).slice(0, 200) })
      }
    }
    return { mirrored, failed }
  }

  // ------------------------------------------------- contract → customer won

  async function resolveTrainer(trainerId) {
    if (!trainerId) return { uid: '', staffId: '', name: '' }
    const [assignment, trainer] = await Promise.all([
      db.collection('roleAssignments').where('crmProfileId', '==', trainerId).limit(1).get(),
      db.doc(`trainers/${trainerId}`).get(),
    ])
    const uid = assignment.docs[0]?.id || ''
    return { uid, staffId: trainerId, name: text(trainer.exists ? trainer.data().name : '', 160) }
  }

  async function careOwnerFor(studentId, trainerId) {
    const assignment = await db.doc(`crmCareAssignments/${studentId}`).get()
    if (assignment.exists && assignment.data().careOwnerUid) {
      const value = assignment.data()
      return { kind: 'customer_care', uid: value.careOwnerUid, staffId: '', name: value.careOwnerName || '' }
    }
    const trainer = await resolveTrainer(trainerId)
    return trainer.uid || trainer.staffId ? { kind: 'trainer', ...trainer } : { kind: '', uid: '', staffId: '', name: '' }
  }

  async function reassignOpenCareSteps(customerId, owner) {
    const snapshot = await db.collection('crmCareSteps').where('customerId', '==', customerId).where('status', '==', 'open').limit(50).get()
    const batch = db.batch()
    let count = 0
    for (const document of snapshot.docs) {
      if (document.data().ownerRole !== 'care_owner') continue
      batch.update(document.ref, {
        ownerUid: owner.uid || '', ownerStaffId: owner.staffId || '', ownerName: owner.name || '',
        ownerKeys: [...new Set([owner.uid, owner.staffId].filter(Boolean))], ownerNotifiedAt: null, updatedAt: nowMs(),
      })
      count += 1
    }
    if (count) await batch.commit()
    return count
  }

  async function findCustomerForStudent(studentId) {
    const linked = await db.collection('crmCustomers').where('studentId', '==', studentId).limit(1).get()
    if (linked.docs[0]) return linked.docs[0]
    const student = await db.doc(`students/${studentId}`).get()
    const phone = normalizePhone(student.exists ? student.data().phone : '')
    if (!phone) return null
    const matches = await db.collection('crmCustomers').where('phones', 'array-contains', phone).limit(5).get()
    const candidates = matches.docs.filter((document) => document.data().status !== 'merged' && !document.data().studentId)
      .sort((left, right) => (right.data().updatedAt || 0) - (left.data().updatedAt || 0))
    return candidates[0] || null
  }

  async function syncContract(contractId, before, after) {
    if (!after) return { skipped: 'deleted' }
    const studentId = text(after.studentId || after.crmProfileId, 200)
    const created = !before
    const studentChanged = Boolean(before) && text(before.studentId || before.crmProfileId, 200) !== studentId
    const trainerChanged = Boolean(before) && text(before.trainerId, 200) !== text(after.trainerId, 200)
    if (!studentId || studentId.includes('/') || (!created && !studentChanged && !trainerChanged)) return { skipped: 'unchanged' }
    const customerDocument = await findCustomerForStudent(studentId)
    if (!customerDocument) return { skipped: 'no_crm_customer' }
    const owner = await careOwnerFor(studentId, text(after.trainerId, 200))
    const now = nowMs()
    const signedAt = timestampMillis(after.createdAt) || now
    const stepReference = db.doc(`crmCareSteps/handover__${contractId}`)
    const outcome = await db.runTransaction(async (transaction) => {
      // Firestore transactions read everything before the first write.
      const [snapshot, stepSnapshot] = await Promise.all([transaction.get(customerDocument.ref), transaction.get(stepReference)])
      if (!snapshot.exists) return { skipped: 'missing' }
      const customer = snapshot.data()
      const firstContract = !customer.studentId || !customer.wonAt
      const patch = {
        studentId,
        contractIds: [...new Set([...(customer.contractIds || []), contractId])].slice(-20),
        updatedAt: now,
        revision: (customer.revision || 0) + 1,
      }
      const stageChanged = customer.stage !== 'won'
      if (stageChanged) Object.assign(patch, { stage: 'won', stageChangedAt: now, lostReason: '', lostNote: '' })
      if (!customer.wonAt) patch.wonAt = Math.min(signedAt, now)
      if (owner.kind && (owner.kind === 'customer_care' || customer.careOwnerKind !== 'customer_care')) {
        Object.assign(patch, { careOwnerUid: owner.uid, careOwnerStaffId: owner.staffId, careOwnerKind: owner.kind, careOwnerName: owner.name })
      }
      const activityReference = db.doc(`crmActivities/a_${sha256(`contract|${contractId}|${created ? 'created' : 'updated'}|${studentId}|${after.trainerId || ''}`).slice(0, 32)}`)
      transaction.set(activityReference, {
        customerId: customerDocument.id, type: stageChanged ? 'stage_change' : 'note', outcome: '',
        note: created ? `Hợp đồng ${text(after.packageName, 120) || contractId} được tạo.` : 'Hợp đồng cập nhật PT chính.',
        data: stageChanged ? { fromStage: customer.stage, toStage: 'won' } : {},
        actorUid: 'system', actorName: 'Aura', channel: '', createdAt: now,
      })
      let stepCreated = false
      if (created && firstContract && (owner.uid || owner.staffId)) {
        if (!stepSnapshot.exists) {
          transaction.set(stepReference, {
            schemaVersion: 1, customerId: customerDocument.id, customerName: customer.displayName || '', studentId, conversationKey: '', branchId: customer.branchId || after.branchId || null,
            kind: 'handover', title: 'Nhận bàn giao học viên mới', note: `${customer.displayName || 'Học viên'} · ${text(after.packageName, 120)}`.slice(0, 200),
            status: 'open', ownerRole: 'care_owner', ownerUid: owner.uid, ownerStaffId: owner.staffId, ownerName: owner.name,
            ownerKeys: [...new Set([owner.uid, owner.staffId].filter(Boolean))],
            dueAt: now + 24 * 60 * 60_000, escalateAt: now + 48 * 60 * 60_000, sopCode: 'SOP-HANDOVER-01', createdAt: now, updatedAt: now,
          })
          patch.openStepCount = (customer.openStepCount || 0) + 1
          stepCreated = true
        }
      }
      transaction.update(customerDocument.ref, patch)
      return { customerId: customerDocument.id, previousStage: customer.stage, stageChanged, stepCreated, ownerChanged: Boolean(patch.careOwnerKind) && (patch.careOwnerUid !== customer.careOwnerUid || patch.careOwnerStaffId !== customer.careOwnerStaffId) }
    })
    if (outcome.skipped) return outcome
    if (outcome.ownerChanged) await reassignOpenCareSteps(outcome.customerId, owner)
    const fresh = await customerDocument.ref.get()
    if (fresh.exists) await refreshConversationMirrors(outcome.customerId, fresh.data())
    if (outcome.stageChanged) await mirrorStage(outcome.customerId, outcome.previousStage, 'won')
    return outcome
  }

  return {
    advanceBackfill,
    careOwnerFor,
    escalateSteps,
    markPageError,
    mirrorOwner,
    mirrorStage,
    notify,
    processInboundEvent,
    reassignOpenCareSteps,
    reconcilePage,
    refreshConversationMirrors,
    runMaintenance,
    syncContract,
    syncConversation,
  }
}

function inboundEventExpiry(nowMs) {
  return Timestamp.fromMillis(nowMs + INBOUND_EVENT_TTL_DAYS * 86_400_000)
}

module.exports = {
  BACKFILL_WINDOW_MS,
  MAX_BACKFILL_DAYS,
  STAGE_LABELS,
  createCrmSync,
  createPageResolver,
  inboundEventExpiry,
  timestampMillis,
}
