'use strict'

const { createHash, randomUUID } = require('node:crypto')
const { Timestamp, FieldValue } = require('firebase-admin/firestore')
const { HttpsError } = require('firebase-functions/v2/https')

const RECEIPT_TTL_MS = 7 * 24 * 60 * 60 * 1000
const REQUEST_LEASE_MS = 150_000
const ENFORCE_AI_APP_CHECK = process.env.ENFORCE_APP_CHECK === 'true'
  || (process.env.ENFORCE_AI_APP_CHECK ?? process.env.ENFORCE_APP_CHECK ?? 'true') === 'true'
const canonical = value => Array.isArray(value) ? `[${value.map(canonical).join(',')}]`
  : value && typeof value === 'object' ? `{${Object.keys(value).filter(key => value[key] !== undefined).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
    : JSON.stringify(value)
const requestFingerprint = value => createHash('sha256').update(canonical(value)).digest('hex')
const millis = value => typeof value?.toMillis === 'function' ? value.toMillis() : value instanceof Date ? value.getTime() : Number(value || 0)

function requireAiAppCheck(request, enforced = ENFORCE_AI_APP_CHECK) {
  if (enforced && !request.app?.appId) throw new HttpsError('unauthenticated', 'Cần xác minh ứng dụng trước khi sử dụng AI.')
}

function requireAiRequestOwner(request, uid) {
  if (request.data?.expectedOwnerUid !== undefined && request.data.expectedOwnerUid !== uid) {
    throw new HttpsError('permission-denied', 'Tài khoản đã thay đổi. Hãy gửi lại yêu cầu từ tài khoản hiện tại.')
  }
}

function nutritionAiRequestId(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{8,120}$/.test(value)) throw new HttpsError('invalid-argument', 'Mã yêu cầu AI không hợp lệ.')
  return value
}

function requestState(value, fingerprint, requestId, now) {
  if (!value) return null
  if (value.fingerprint !== fingerprint) throw new HttpsError('already-exists', 'Mã yêu cầu AI đã được dùng cho nội dung khác.')
  if (value.status === 'completed' && value.response && typeof value.response === 'object') return value.response
  if (value.status === 'processing' && millis(value.leaseUntil) > now) {
    throw new HttpsError('aborted', 'Yêu cầu AI đang được xử lý. Hãy chờ kết quả hiện tại.', {
      kind: 'nutrition_ai_processing', requestId, retryAfterMs: Math.min(5000, Math.max(1000, millis(value.leaseUntil) - now)), maxPollAttempts: 12,
    })
  }
  // A timed-out worker may have reached the paid provider. Never automatically
  // repeat an ambiguous external side effect, even when its lease has expired.
  if (value.providerStartedAt) throw new HttpsError('failed-precondition', 'Chưa xác định được kết quả yêu cầu AI trước. Không tự động gửi lại để tránh tính phí trùng.', {
    kind: 'nutrition_ai_outcome_unknown', requestId, retryable: false,
  })
  return null
}

function quotaMutation(value = {}, quota, now) {
  const windowMs = quota.windowMs || 10 * 60 * 1000
  const dayMs = 24 * 60 * 60 * 1000
  const withinWindow = now - millis(value.windowStartedAt) < windowMs && millis(value.windowStartedAt) > 0
  const withinDay = now - millis(value.dayStartedAt) < dayMs && millis(value.dayStartedAt) > 0
  const windowCount = withinWindow ? Math.max(0, Number(value.windowCount) || 0) : 0
  const dayCount = withinDay ? Math.max(0, Number(value.dayCount) || 0) : 0
  if (windowCount >= quota.windowLimit || dayCount >= quota.dayLimit) throw new HttpsError('resource-exhausted', quota.message || 'Bạn đã đạt giới hạn yêu cầu AI. Hãy thử lại sau.', { kind: 'nutrition_ai_quota' })
  return {
    windowCount: windowCount + 1, dayCount: dayCount + 1,
    windowStartedAt: withinWindow ? value.windowStartedAt : Timestamp.fromMillis(now),
    dayStartedAt: withinDay ? value.dayStartedAt : Timestamp.fromMillis(now),
    updatedAt: Timestamp.fromMillis(now),
  }
}

function createNutritionAiRequests({ db, now = Date.now, token = randomUUID } = {}) {
  const references = ({ uid, operation, requestId, scopeKey }) => {
    if (!uid || uid.includes('/') || !/^[a-zA-Z][a-zA-Z0-9_-]{0,40}$/.test(operation) || !requestId) throw new HttpsError('invalid-argument', 'Thông tin yêu cầu AI không hợp lệ.')
    return {
      reference: db.doc(`users/${uid}/nutritionAiRequests/${operation}_${requestFingerprint(requestId)}`),
      lockReference: scopeKey ? db.doc(`users/${uid}/nutritionAiLocks/${operation}_${requestFingerprint(scopeKey)}`) : null,
    }
  }
  const replay = async input => {
    const { reference } = references(input)
    const snapshot = await reference.get()
    return requestState(snapshot.exists ? snapshot.data() : null, input.fingerprint, input.requestId, now())
  }
  const claim = async input => {
    const { reference, lockReference } = references(input)
    const claimedAt = now(), claimToken = token()
    const result = await db.runTransaction(async transaction => {
      const [snapshot, lockSnapshot] = await Promise.all([
        transaction.get(reference), lockReference ? transaction.get(lockReference) : null,
      ])
      const previous = snapshot.exists ? snapshot.data() : null
      const response = requestState(previous, input.fingerprint, input.requestId, claimedAt)
      if (response) return { response }
      const lock = lockSnapshot?.exists ? lockSnapshot.data() : null
      if (lock?.status === 'processing' && millis(lock.leaseUntil) > claimedAt) {
        throw new HttpsError('aborted', 'Một yêu cầu cùng nội dung đang được xử lý.', { kind: 'nutrition_ai_processing', requestId: input.requestId, retryAfterMs: 3000, maxPollAttempts: 12 })
      }
      // Guards and quota reads precede every write; callbacks never call AI.
      await input.guard?.(transaction)
      // Another worker may have populated the cache since the optimistic read.
      // Recheck under the content lock before charging quota or starting AI.
      const cache = await input.readCache?.(transaction)
      const quotaReference = input.quota && !cache ? db.doc(`users/${input.uid}/aiRateLimits/${input.quota.key}`) : null
      const quotaCharged = previous?.quotaCharged === true
      let quotaWrite = null
      if (quotaReference && !quotaCharged) {
        const quotaSnapshot = await transaction.get(quotaReference)
        quotaWrite = quotaMutation(quotaSnapshot.exists ? quotaSnapshot.data() : {}, input.quota, claimedAt)
      }
      const leaseUntil = Timestamp.fromMillis(claimedAt + REQUEST_LEASE_MS)
      const expiresAt = Timestamp.fromMillis(claimedAt + RECEIPT_TTL_MS)
      transaction.set(reference, {
        schemaVersion: 1, operation: input.operation, requestId: input.requestId, fingerprint: input.fingerprint,
        status: 'processing', token: claimToken, claimedAt, leaseUntil, expiresAt,
        quotaCharged: quotaCharged || Boolean(quotaWrite),
      })
      if (lockReference) transaction.set(lockReference, { status: 'processing', token: claimToken, requestPath: reference.path, leaseUntil, expiresAt })
      if (quotaWrite) transaction.set(quotaReference, quotaWrite, { merge: true })
      return { acquired: true, cache }
    })
    return { ...input, ...result, reference, lockReference, token: claimToken }
  }
  const assertOwner = async (transaction, acquired) => {
    const [snapshot, lockSnapshot] = await Promise.all([
      transaction.get(acquired.reference), acquired.lockReference ? transaction.get(acquired.lockReference) : null,
    ])
    const value = snapshot.exists ? snapshot.data() : null
    if (value?.status !== 'processing' || value.token !== acquired.token || millis(value.leaseUntil) <= now()
      || acquired.lockReference && lockSnapshot?.data()?.token !== acquired.token) {
      throw new HttpsError('aborted', 'Quyền xử lý yêu cầu AI đã hết hạn. Hãy kiểm tra kết quả trước khi gửi lại.', { kind: 'nutrition_ai_lease_lost', requestId: acquired.requestId })
    }
    return value
  }
  const startProvider = acquired => db.runTransaction(async transaction => {
    await assertOwner(transaction, acquired)
    transaction.set(acquired.reference, { providerStartedAt: Timestamp.fromMillis(now()) }, { merge: true })
  })
  // Only the caller that received an explicit first-attempt HTTP 429 may
  // clear provider admission. Network failures and lost responses cannot.
  const deferProvider = acquired => db.runTransaction(async transaction => {
    await assertOwner(transaction, acquired)
    transaction.set(acquired.reference, { status: 'deferred', providerStartedAt: FieldValue.delete(), leaseUntil: Timestamp.fromMillis(0) }, { merge: true })
    if (acquired.lockReference) transaction.set(acquired.lockReference, { status: 'released', token: null, leaseUntil: Timestamp.fromMillis(0) }, { merge: true })
  })
  const ownsLease = acquired => db.runTransaction(async transaction => {
    await assertOwner(transaction, acquired)
    return true
  }).catch(() => false)
  const writeCompletion = (transaction, acquired, response) => {
    if (Buffer.byteLength(JSON.stringify(response)) > 600_000) throw new HttpsError('internal', 'Kết quả AI vượt quá kích thước cho phép.')
    transaction.set(acquired.reference, { status: 'completed', response, token: null, leaseUntil: Timestamp.fromMillis(0), completedAt: Timestamp.fromMillis(now()) }, { merge: true })
    if (acquired.lockReference) transaction.set(acquired.lockReference, { status: 'released', token: null, leaseUntil: Timestamp.fromMillis(0) }, { merge: true })
  }
  const complete = (acquired, response) => db.runTransaction(async transaction => {
    await assertOwner(transaction, acquired)
    writeCompletion(transaction, acquired, response)
    return response
  })
  const markImageDeleted = acquired => db.runTransaction(async transaction => {
    const snapshot = await transaction.get(acquired.reference)
    const value = snapshot.data()
    if (value?.status !== 'completed' || value.fingerprint !== acquired.fingerprint) return
    transaction.set(acquired.reference, { response: { ...value.response, imageRetained: false } }, { merge: true })
  })
  const fail = (acquired, error) => db.runTransaction(async transaction => {
    const [snapshot, lockSnapshot] = await Promise.all([
      transaction.get(acquired.reference), acquired.lockReference ? transaction.get(acquired.lockReference) : null,
    ])
    if (snapshot.data()?.status !== 'processing' || snapshot.data()?.token !== acquired.token) return
    transaction.set(acquired.reference, { status: 'failed', errorCode: error instanceof HttpsError ? error.code : 'internal', leaseUntil: Timestamp.fromMillis(0), failedAt: Timestamp.fromMillis(now()) }, { merge: true })
    if (acquired.lockReference && lockSnapshot?.data()?.token === acquired.token) transaction.set(acquired.lockReference, { status: 'released', token: null, leaseUntil: Timestamp.fromMillis(0) }, { merge: true })
  }).catch(() => undefined)
  return { replay, claim, assertOwner, ownsLease, startProvider, deferProvider, writeCompletion, complete, markImageDeleted, fail }
}

function createAiProviderBudget({ totalMs, maxAttempts, perAttemptMs, now = Date.now }) {
  const deadlineAt = now() + totalMs
  let attempts = 0
  return {
    nextTimeout() {
      const remaining = deadlineAt - now() - 500
      if (attempts >= maxAttempts || remaining <= 1000) throw new HttpsError('deadline-exceeded', 'AI chưa hoàn tất trong thời gian cho phép. Hãy kiểm tra kết quả trước khi thử lại.')
      attempts += 1
      return Math.max(1, Math.min(perAttemptMs, remaining))
    },
    get attempts() { return attempts },
    deadlineAt,
  }
}

module.exports = { ENFORCE_AI_APP_CHECK, RECEIPT_TTL_MS, REQUEST_LEASE_MS, requireAiAppCheck, requireAiRequestOwner, nutritionAiRequestId, requestFingerprint, requestState, quotaMutation, createNutritionAiRequests, createAiProviderBudget }
