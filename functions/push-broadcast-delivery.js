'use strict'

const { createHash, randomUUID } = require('node:crypto')
const { FieldValue } = require('firebase-admin/firestore')
const { HttpsError } = require('firebase-functions/v2/https')

const COLLECTION = 'pushBroadcastRequests'
const LEGACY_WINDOW_MS = 24 * 60 * 60_000
const LEASE_MS = 150_000
const CHUNK_SIZE = 200
const terminal = state => ['completed', 'needs_review'].includes(state?.status)
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const chunks = values => {
  const pages = []; let page = [], bytes = 2
  for (const value of values) {
    const size = Buffer.byteLength(JSON.stringify(value)) + 1
    if (page.length && (page.length >= CHUNK_SIZE || bytes + size > 450_000)) { pages.push(page); page = []; bytes = 2 }
    page.push(value); bytes += size
  }
  if (page.length) pages.push(page)
  return pages
}
function pushRequestIdentity(actorId, requestId, payload) {
  if (requestId !== undefined && (typeof requestId !== 'string' || !/^[A-Za-z0-9_-]{8,120}$/.test(requestId))) {
    throw new HttpsError('invalid-argument', 'Mã lượt gửi không hợp lệ. Chưa gửi thông báo nào.')
  }
  if (Buffer.byteLength(JSON.stringify(payload)) > 600_000) throw new HttpsError('resource-exhausted', 'Nội dung và nhóm người nhận vượt giới hạn lượt gửi. Chưa gửi thông báo nào.')
  return { fingerprint: digest([actorId, payload]), explicitId: requestId ? digest([actorId, requestId]) : null }
}
function response(state, replayed = false, legacy = false) {
  return {
    sentCount: state.sentCount || 0, webPushSentCount: state.webPushSentCount || 0,
    webPushFailureCount: state.webPushFailureCount || 0, webPushUnknownCount: state.webPushUnknownCount || 0,
    filteredOutCount: state.filteredOutCount || 0, logId: state.id,
    status: state.status, complete: terminal(state), replayed,
    legacyDeduplicated: legacy && replayed,
    ...(!terminal(state) ? { retryAfterMs: state.leaseUntil > Date.now() ? 1500 : 0 } : {}),
  }
}
function logFields(state) {
  const { title, message, type, category, targetType, actionUrl } = state.payload
  return { id: state.id, title, message, type, category, targetType, actionUrl, targetValue: targetType,
    sentCount: state.sentCount, webPushSentCount: state.webPushSentCount, webPushFailureCount: state.webPushFailureCount,
    webPushUnknownCount: state.webPushUnknownCount, filteredOutCount: state.filteredOutCount,
    status: state.status, sentBy: state.actorId, createdAt: state.createdAt }
}

// An FCM call has no idempotency key. Persist 'sending' before transport;
// if acknowledgement is lost, expose unknown and NEVER repeat that chunk.
// Firestore inbox creation and progress, in contrast, commit atomically.
function createPushBroadcastDelivery({ db, messaging, publicPushActionUrl, now = Date.now, budgetMs = 35_000, leaseMs = LEASE_MS }) {
  async function dispatch({ actorId, requestId, payload, admit }) {
    const started = now()
    const { fingerprint, explicitId } = pushRequestIdentity(actorId, requestId, payload)
    const pointer = explicitId ? null : db.doc(`pushBroadcastLegacyIntents/${fingerprint}`)
    const candidateId = explicitId || randomUUID()
    const reusable = state => state && (!terminal(state) || state.webPushUnknownCount > 0 || now() - state.completedAtMillis < LEGACY_WINDOW_MS)
    const existingId = explicitId || (await pointer.get()).data()?.requestId
    const existing = existingId ? (await db.doc(`${COLLECTION}/${existingId}`).get()).data() : null
    if (existing && existing.fingerprint !== fingerprint) throw new HttpsError('failed-precondition', 'Lượt gửi đã gắn với nội dung khác. Hãy đối soát lượt trước trước khi tạo lượt mới.')
    let id = existing && (explicitId || reusable(existing)) ? existingId : null
    let replayed = Boolean(id)
    if (!id) {
      // All population/device checks finish before the FIRST durable write.
      const admitted = await admit()
      const recipientIds = [...new Set(admitted.eligibleUserIds)]
      const allowed = new Set(recipientIds)
      const deviceCounts = new Map()
      const devices = admitted.devices.map(device => {
        const match = /^users\/([^/]+)\/devices\/[^/]+$/.exec(device.reference.path)
        if (!match || !allowed.has(match[1]) || typeof device.token !== 'string' || device.token.length > 4096) {
          throw new HttpsError('failed-precondition', 'Chưa xác minh đầy đủ thiết bị người nhận. Chưa gửi thông báo nào.')
        }
        deviceCounts.set(match[1], (deviceCounts.get(match[1]) || 0) + 1)
        return { uid: match[1], token: device.token, path: device.reference.path }
      })
      const inboxChunks = chunks(recipientIds.map(uid => ({ uid, deviceCount: deviceCounts.get(uid) || 0 })))
      const deviceChunks = chunks(devices)
      if (recipientIds.length > 2000 || devices.length > 2000 || [...inboxChunks, ...deviceChunks].some(items => Buffer.byteLength(JSON.stringify(items)) > 600_000)) {
        throw new HttpsError('resource-exhausted', 'Nhóm vượt giới hạn lượt gửi. Chưa gửi thông báo nào.')
      }
      const initialized = await db.runTransaction(async transaction => {
        const link = pointer ? (await transaction.get(pointer)).data() : null
        const linkedId = explicitId || link?.requestId
        const linked = linkedId ? (await transaction.get(db.doc(`${COLLECTION}/${linkedId}`))).data() : null
        if (linked && linked.fingerprint !== fingerprint) throw new HttpsError('failed-precondition', 'Mã lượt gửi đã gắn với nội dung khác.')
        if (linked && (explicitId || reusable(linked))) return { id: linkedId, replayed: true }
        const reference = db.doc(`${COLLECTION}/${candidateId}`)
        const state = { id: candidateId, actorId, fingerprint, payload, status: 'pending',
          createdAt: FieldValue.serverTimestamp(), createdAtMillis: now(),
          recipientCount: recipientIds.length, deviceCount: devices.length,
          inboxChunkCount: inboxChunks.length, deviceChunkCount: deviceChunks.length,
          nextInboxChunk: 0, nextDeviceChunk: 0, sentCount: 0, webPushSentCount: 0,
          webPushFailureCount: 0, webPushUnknownCount: 0, filteredOutCount: admitted.filteredOutCount,
          owner: null, leaseUntil: 0, legacy: !explicitId }
        transaction.create(reference, state)
        transaction.create(db.doc(`system/push_broadcast_logs/logs/${candidateId}`), logFields(state))
        inboxChunks.forEach((items, index) => transaction.create(db.doc(`${reference.path}/inboxChunks/${index}`), { items, status: 'pending' }))
        deviceChunks.forEach((items, index) => transaction.create(db.doc(`${reference.path}/deviceChunks/${index}`), { items, status: 'pending' }))
        if (pointer) transaction.set(pointer, { requestId: candidateId })
        return { id: candidateId, replayed: false }
      })
      id = initialized.id; replayed = initialized.replayed
    }
    const reference = db.doc(`${COLLECTION}/${id}`)
    const owner = randomUUID()
    const claimed = await db.runTransaction(async transaction => {
      const state = (await transaction.get(reference)).data()
      if (!state || state.actorId !== actorId || state.fingerprint !== fingerprint) throw new HttpsError('permission-denied', 'Không thể tiếp tục lượt gửi này.')
      if (terminal(state) || state.leaseUntil > now()) return { state, acquired: false }
      transaction.update(reference, { owner, leaseUntil: now() + leaseMs, status: 'processing' })
      return { state: { ...state, owner, leaseUntil: now() + leaseMs, status: 'processing' }, acquired: true }
    })
    if (!claimed.acquired) return response(claimed.state, true, !explicitId)
    const checkOwner = state => {
      if (state.owner !== owner || state.leaseUntil <= now()) throw new HttpsError('aborted', 'Lượt gửi đang được đối soát. Hãy tiếp tục cùng lượt gửi.')
    }
    let state = claimed.state
    try {
      while (state.nextInboxChunk < state.inboxChunkCount && now() - started < budgetMs) {
        state = await db.runTransaction(async transaction => {
          const current = (await transaction.get(reference)).data(); checkOwner(current)
          const chunkRef = db.doc(`${reference.path}/inboxChunks/${current.nextInboxChunk}`)
          const chunk = (await transaction.get(chunkRef)).data()
          for (const item of chunk.items) {
            const notification = db.doc(`users/${item.uid}/notifications/${id}`)
            transaction.create(notification, { id, userId: item.uid,
              title: current.payload.title, message: current.payload.message, type: current.payload.type,
              category: current.payload.category, actionUrl: current.payload.actionUrl,
              read: false, createdAt: FieldValue.serverTimestamp() })
            transaction.create(db.doc(`${reference.path}/recipients/${item.uid}`), {
              inboxStatus: 'created', deviceCount: item.deviceCount, sent: 0, failed: 0, unknown: 0,
              pushStatus: item.deviceCount ? 'pending' : 'no_device',
            })
          }
          const next = { ...current, nextInboxChunk: current.nextInboxChunk + 1, sentCount: current.sentCount + chunk.items.length }
          transaction.update(chunkRef, { status: 'completed' })
          transaction.update(reference, { nextInboxChunk: next.nextInboxChunk, sentCount: next.sentCount })
          return next
        })
      }
      while (state.nextInboxChunk === state.inboxChunkCount && state.nextDeviceChunk < state.deviceChunkCount && now() - started < budgetMs) {
        const marked = await db.runTransaction(async transaction => {
          const current = (await transaction.get(reference)).data(); checkOwner(current)
          const chunkRef = db.doc(`${reference.path}/deviceChunks/${current.nextDeviceChunk}`)
          const chunk = (await transaction.get(chunkRef)).data()
          if (chunk.status === 'pending') transaction.update(chunkRef, { status: 'sending', owner, startedAtMillis: now() })
          return { current, chunkRef, chunk, send: chunk.status === 'pending' }
        })
        let outcomes = marked.chunk.items.map(() => 'unknown')
        let invalidIndexes = []
        if (marked.send) {
          try {
            const result = await messaging.sendEachForMulticast({
              tokens: marked.chunk.items.map(item => item.token),
              notification: { title: payload.title, body: payload.message },
              data: { actionUrl: payload.actionUrl, type: payload.type, category: payload.category, notificationId: id },
              webpush: { fcmOptions: { link: publicPushActionUrl(payload.actionUrl) } },
            })
            outcomes = marked.chunk.items.map((_, index) => result.responses?.[index]?.success === true ? 'sent'
              : result.responses?.[index]?.success === false ? 'failed' : 'unknown')
            invalidIndexes = marked.chunk.items.flatMap((_, index) => ['messaging/registration-token-not-registered', 'messaging/invalid-registration-token'].includes(result.responses?.[index]?.error?.code) ? [index] : [])
          } catch { /* Transport acceptance is unknown; no automatic resend. */ }
        }
        state = await db.runTransaction(async transaction => {
          const current = (await transaction.get(reference)).data(); checkOwner(current)
          const chunk = (await transaction.get(marked.chunkRef)).data()
          if (current.nextDeviceChunk !== marked.current.nextDeviceChunk || chunk.status !== 'sending') throw new HttpsError('aborted', 'Tiến độ lượt gửi đã thay đổi.')
          const byUser = new Map()
          marked.chunk.items.forEach((item, index) => {
            const count = byUser.get(item.uid) || { sent: 0, failed: 0, unknown: 0 }
            count[outcomes[index]]++; byUser.set(item.uid, count)
          })
          const recipients = []
          for (const [uid, counts] of byUser) {
            const ref = db.doc(`${reference.path}/recipients/${uid}`)
            recipients.push({ ref, counts, previous: (await transaction.get(ref)).data() })
          }
          const invalidDevices = []
          for (const index of invalidIndexes) {
            const item = marked.chunk.items[index], ref = db.doc(item.path)
            const device = await transaction.get(ref)
            // A newly registered token at the same path must survive cleanup.
            if (device.exists && device.data().token === item.token) invalidDevices.push(ref)
          }
          for (const { ref, counts, previous } of recipients) {
            const next = { ...previous, sent: previous.sent + counts.sent, failed: previous.failed + counts.failed, unknown: previous.unknown + counts.unknown }
            next.pushStatus = next.unknown ? 'needs_review' : next.sent + next.failed === next.deviceCount ? (next.failed ? 'failed_or_partial' : 'accepted') : 'pending'
            transaction.update(ref, next)
          }
          const next = { ...current, nextDeviceChunk: current.nextDeviceChunk + 1,
            webPushSentCount: current.webPushSentCount + outcomes.filter(item => item === 'sent').length,
            webPushFailureCount: current.webPushFailureCount + outcomes.filter(item => item === 'failed').length,
            webPushUnknownCount: current.webPushUnknownCount + outcomes.filter(item => item === 'unknown').length }
          transaction.update(marked.chunkRef, { status: 'completed', outcomes, completedAtMillis: now() })
          invalidDevices.forEach(ref => transaction.delete(ref))
          transaction.update(reference, { nextDeviceChunk: next.nextDeviceChunk, webPushSentCount: next.webPushSentCount,
            webPushFailureCount: next.webPushFailureCount, webPushUnknownCount: next.webPushUnknownCount })
          return next
        })
      }
      state = await db.runTransaction(async transaction => {
        const current = (await transaction.get(reference)).data(); checkOwner(current)
        const complete = current.nextInboxChunk === current.inboxChunkCount && current.nextDeviceChunk === current.deviceChunkCount
        const patch = { owner: null, leaseUntil: 0, status: complete ? (current.webPushUnknownCount ? 'needs_review' : 'completed') : 'pending',
          ...(complete ? { completedAtMillis: now() } : {}) }
        transaction.update(reference, patch)
        transaction.set(db.doc(`system/push_broadcast_logs/logs/${id}`), logFields({ ...current, ...patch }))
        return { ...current, ...patch }
      })
      return response(state, replayed, !explicitId)
    } catch (error) {
      // Unknown commit results retain their durable progress. A retry always
      // reads it first; a 'sending' chunk is resolved as unknown, never resent.
      await db.runTransaction(async transaction => {
        const current = (await transaction.get(reference)).data()
        if (current?.owner === owner) transaction.update(reference, { owner: null, leaseUntil: 0, status: 'pending' })
      }).catch(() => undefined)
      throw error
    }
  }
  return { dispatch }
}

module.exports = { createPushBroadcastDelivery, pushRequestIdentity, COLLECTION, LEGACY_WINDOW_MS, LEASE_MS }
