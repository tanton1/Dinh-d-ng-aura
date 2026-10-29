'use strict'

const { Timestamp, FieldValue } = require('firebase-admin/firestore')
const { getFunctions } = require('firebase-admin/functions')
const { onCall, HttpsError } = require('firebase-functions/v2/https')
const { onDocumentCreated } = require('firebase-functions/v2/firestore')
const { onTaskDispatched } = require('firebase-functions/v2/tasks')
const { ENFORCE_AI_APP_CHECK, requireAiAppCheck, requireAiRequestOwner, requestFingerprint, quotaMutation, createNutritionAiRequests } = require('./nutrition-ai-requests')
const { APIKEY_FUN_API_KEY } = require('./apikey-fun')
const { OPENROUTER_API_KEY } = require('./openrouter')

const SCAN_QUEUE_REGION = 'asia-southeast2'
const SCAN_QUEUE_WORKER = 'processNutritionScanQueue'
// The deployed Gen 2 runtime identity; explicitly grant only this dispatcher
// identity access to enqueue tasks and invoke the private worker.
const SCAN_TASK_SERVICE_ACCOUNT = process.env.NUTRITION_SCAN_TASK_SERVICE_ACCOUNT || '607039870489-compute@developer.gserviceaccount.com'
const SCAN_JOB_TIMEOUT_MS = 15 * 60_000
const SCAN_JOB_TTL_MS = 7 * 24 * 60 * 60_000
const terminal = job => ['completed', 'failed'].includes(job?.status)
const jobReference = (db, uid, scanId) => {
  if (typeof uid !== 'string' || !uid || uid.includes('/') || typeof scanId !== 'string' || !/^[A-Za-z0-9_-]{8,80}$/.test(scanId)) {
    throw new HttpsError('invalid-argument', 'Mã ảnh không hợp lệ.')
  }
  return db.doc(`users/${uid}/nutritionScanJobs/${scanId}`)
}

function createNutritionScanQueue({ db, processScan, parseInput, enqueueTask, now = Date.now }) {
  const receipts = createNutritionAiRequests({ db, now })
  const submit = async ({ uid, input, callerRole = 'student' }) => {
    const reference = jobReference(db, uid, input.scanId)
    const fingerprint = requestFingerprint(input)
    return db.runTransaction(async transaction => {
      const existing = await transaction.get(reference)
      if (existing.exists) {
        if (existing.data().fingerprint !== fingerprint) throw new HttpsError('already-exists', 'Mã ảnh đã được dùng cho nội dung khác.')
        return { scanId: input.scanId, status: existing.data().status }
      }
      // Admission limits bound queue writes separately from the existing paid
      // AI quota, which is charged only once by the processor (cache excluded).
      const quotaRef = db.doc(`users/${uid}/aiRateLimits/foodScanQueue`)
      const quota = await transaction.get(quotaRef)
      const quotaWrite = quotaMutation(quota.data(), { windowLimit: 10, dayLimit: 100 }, now())
      transaction.set(reference, {
        schemaVersion: 1, uid, scanId: input.scanId, input, fingerprint,
        callerRole: ['student', 'coach', 'editor', 'admin', 'super_admin'].includes(callerRole) ? callerRole : 'student',
        status: 'queued', createdAt: now(), deadlineAt: now() + SCAN_JOB_TIMEOUT_MS,
        expiresAt: Timestamp.fromMillis(now() + SCAN_JOB_TTL_MS),
      })
      transaction.set(quotaRef, quotaWrite, { merge: true })
      return { scanId: input.scanId, status: 'queued' }
    })
  }
  const finish = async (reference, update) => db.runTransaction(async transaction => {
    const snapshot = await transaction.get(reference)
    if (!snapshot.exists || terminal(snapshot.data())) return
    transaction.set(reference, { ...update, input: FieldValue.delete(), finishedAt: now() }, { merge: true })
  })
  const fail = (reference, code, message, kind) => finish(reference, {
    status: 'failed', error: { code, message, kind: kind || 'nutrition_scan_failed' },
  })
  const dispatch = async (uid, scanId) => {
    const reference = jobReference(db, uid, scanId)
    const snapshot = await reference.get()
    const job = snapshot.data()
    if (!job || terminal(job)) return
    const taskId = requestFingerprint({ uid, scanId })
    // Firestore creation is the durable outbox. Deterministic Cloud Tasks IDs
    // make replay after a dispatcher crash harmless, including partial enqueue.
    const enqueue = async (suffix, options, deadlineCheck) => {
      try { await enqueueTask({ uid, scanId, deadlineCheck }, { id: `${taskId}_${suffix}`, dispatchDeadlineSeconds: 150, ...options }) }
      catch (error) { if (!['functions/task-already-exists', 'ALREADY_EXISTS', 6, 409].includes(error?.code)) throw error }
    }
    await enqueue('deadline', { scheduleTime: new Date(job.deadlineAt + 1000) }, true)
    await enqueue('work', {}, false)
  }
  const run = async ({ uid, scanId, deadlineCheck = false }) => {
    const reference = jobReference(db, uid, scanId)
    const snapshot = await reference.get()
    const job = snapshot.data()
    if (!job || terminal(job)) return
    const identity = { uid, operation: 'foodScan', requestId: scanId, fingerprint: job.fingerprint }
    try {
      // Heal the public job if a worker saved its paid result then crashed.
      const completed = await receipts.replay(identity)
      if (completed) return finish(reference, { status: 'completed', response: completed })
      if (now() >= job.deadlineAt) return fail(reference, 'deadline-exceeded', 'Ảnh chưa được xử lý trong thời gian chờ. Bạn có thể gửi lại sau.', 'nutrition_scan_expired')
      if (deadlineCheck) return
      if (Number(job.nextAttemptAt || 0) > now()) throw new HttpsError('unavailable', 'Đang chờ dịch vụ AI.', { kind: 'nutrition_provider_capacity' })
      const canStart = await db.runTransaction(async transaction => {
        const current = await transaction.get(reference)
        if (!current.exists || terminal(current.data())) return false
        if (current.data().status !== 'processing') {
          transaction.set(reference, { status: 'processing', startedAt: now() }, { merge: true })
        }
        return true
      })
      if (!canStart) return
      const input = parseInput(job.input, uid)
      // Persist only the signed admission role, never the ID token. The
      // processor still compares it with the current server-owned profile.
      const response = await processScan({ uid, input, requestId: scanId, claims: { role: job.callerRole }, queueMode: true, guard: async transaction => {
        const current = await transaction.get(reference)
        if (!current.exists || terminal(current.data()) || now() >= current.data().deadlineAt) {
          throw new HttpsError('failed-precondition', 'Ảnh đã hết thời gian chờ.', { kind: 'nutrition_scan_expired' })
        }
      } })
      await finish(reference, { status: 'completed', response })
    } catch (error) {
      const kind = error?.details?.kind
      if (kind === 'nutrition_ai_outcome_unknown') {
        return fail(reference, 'failed-precondition', 'Chưa xác định được kết quả phân tích trước. Aura giữ mã ảnh và không tự gửi lại để tránh tính phí trùng.', kind)
      }
      if (kind === 'nutrition_ai_processing') throw error
      if (['nutrition_provider_capacity', 'nutrition_provider_busy'].includes(kind) && now() < job.deadlineAt) {
        await db.runTransaction(async transaction => {
          const current = await transaction.get(reference)
          if (current.exists && !terminal(current.data())) transaction.set(reference, {
            status: 'queued', nextAttemptAt: Math.max(Number(current.data().nextAttemptAt) || 0, now() + Math.max(15_000, Math.min(15 * 60_000, Number(error.details.retryAfterMs) || 15_000))),
          }, { merge: true })
        })
        throw error
      }
      if (['invalid-argument', 'permission-denied', 'unauthenticated', 'not-found', 'resource-exhausted', 'failed-precondition'].includes(error?.code)) {
        return fail(reference, error.code, error instanceof HttpsError ? error.message : 'Không thể xử lý ảnh này.', kind)
      }
      // Infrastructure errors may be retried; the receipt fences any attempt
      // that already reached a provider, including a lost completion write.
      if (now() < job.deadlineAt) throw error
      return fail(reference, 'deadline-exceeded', 'Không thể hoàn tất ảnh trong thời gian chờ. Vui lòng kiểm tra lại sau.', kind)
    }
  }
  return { submit, dispatch, run }
}

function createNutritionScanQueueFunctions({ app, db, parseInput, processScan, databaseId }) {
  const tasks = getFunctions(app).taskQueue(`locations/${SCAN_QUEUE_REGION}/functions/${SCAN_QUEUE_WORKER}`)
  const queue = createNutritionScanQueue({ db, parseInput, processScan, enqueueTask: (data, options) => tasks.enqueue(data, options) })
  return {
    enqueueNutritionScan: onCall({ region: SCAN_QUEUE_REGION, invoker: 'public', timeoutSeconds: 30, memory: '256MiB', maxInstances: 3, concurrency: 20, enforceAppCheck: ENFORCE_AI_APP_CHECK }, async request => {
      const uid = request.auth?.uid
      if (!uid) throw new HttpsError('unauthenticated', 'Bạn cần đăng nhập để phân tích món ăn.')
      requireAiAppCheck(request)
      requireAiRequestOwner(request, uid)
      if (request.data?.resumeScanId) {
        const existing = await jobReference(db, uid, request.data.resumeScanId).get()
        if (!existing.exists) throw new HttpsError('not-found', 'Ảnh chưa được đưa vào hàng đợi. Hãy chọn lại chính ảnh này để tiếp tục.')
        return { scanId: request.data.resumeScanId, status: existing.data().status }
      }
      const input = parseInput(request.data, uid)
      if (request.data?.requestId !== input.scanId) throw new HttpsError('invalid-argument', 'Mã yêu cầu không khớp với ảnh.')
      return queue.submit({ uid, input, callerRole: request.auth.token.role })
    }),
    dispatchNutritionScan: onDocumentCreated({ region: SCAN_QUEUE_REGION, serviceAccount: SCAN_TASK_SERVICE_ACCOUNT, database: databaseId, document: 'users/{uid}/nutritionScanJobs/{scanId}', retry: true, timeoutSeconds: 60, memory: '256MiB', maxInstances: 2, concurrency: 20 }, event => queue.dispatch(event.params.uid, event.params.scanId)),
    processNutritionScanQueue: onTaskDispatched({
      region: SCAN_QUEUE_REGION, serviceAccount: SCAN_TASK_SERVICE_ACCOUNT, invoker: [SCAN_TASK_SERVICE_ACCOUNT], timeoutSeconds: 120, memory: '512MiB', minInstances: 0, maxInstances: 4, concurrency: 2,
      secrets: [APIKEY_FUN_API_KEY, OPENROUTER_API_KEY],
      rateLimits: { maxConcurrentDispatches: 8, maxDispatchesPerSecond: 4 },
      retryConfig: { maxAttempts: 100, maxRetrySeconds: 1800, minBackoffSeconds: 15, maxBackoffSeconds: 60, maxDoublings: 2 },
    }, request => queue.run(request.data)),
  }
}

module.exports = { SCAN_JOB_TIMEOUT_MS, SCAN_QUEUE_REGION, SCAN_QUEUE_WORKER, createNutritionScanQueue, createNutritionScanQueueFunctions }
