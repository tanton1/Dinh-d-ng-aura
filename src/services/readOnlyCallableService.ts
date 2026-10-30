import { httpsCallable, type Functions } from 'firebase/functions'
import { firebaseAuth } from '../lib/firebase'
import { firebaseFunctions } from '../lib/firebaseFunctions'
import { createClientCorrelationId, reportClientIssue } from './clientTelemetryService'
import { callableCode, isRetryableReadOnlyCallableError, runReadOnlyWithRetry } from './readOnlyCallableCore'
import { createReadMetricBuffer } from './readMetrics'

// Weak ownership prevents diagnostics crossing account/session changes. One
// anonymous batch per 20 completed reads, at most 12 batches per sampled session.
const metricSessions = new WeakMap<object, { sampled: boolean; sent: number; buffer: ReturnType<typeof createReadMetricBuffer> }>()

export interface ReadOnlyCallableOptions {
  /** Reuse the same request identity across explicit regional failover. */
  correlationId?: string
  signal?: AbortSignal
  timeoutMs?: number
  maximumAttempts?: number
  /** Initial delay before a transient retry. Quota/instance outages need a
   * longer backoff than ordinary network jitter. */
  baseDelayMs?: number
  /** Override the default regional Functions client for overflow read endpoints. */
  functionsClient?: Functions | null
}

export async function callReadOnlyFunction<Input, Output>(
  name: string,
  input: Input,
  options: ReadOnlyCallableOptions = {},
): Promise<Output> {
  const functionsClient = options.functionsClient === undefined
    ? firebaseFunctions
    : options.functionsClient
  if (!functionsClient) throw new Error('Firebase Functions chưa sẵn sàng.')
  const correlationId = options.correlationId ?? createClientCorrelationId()
  const correlatedInput = input && typeof input === 'object' && !Array.isArray(input)
    ? { ...input, correlationId } as Input
    : input
  const invoke = httpsCallable<Input, Output>(functionsClient, name, { timeout: options.timeoutMs ?? 18_000 })
  const currentUser = firebaseAuth?.currentUser
  const startedAt = Date.now()
  let attempts = 0
  let failed = true
  try {
  const result = await runReadOnlyWithRetry(async () => {
    if (currentUser && firebaseAuth?.currentUser !== currentUser) throw Object.assign(new Error('Phiên đăng nhập đã thay đổi.'), { code: 'permission-denied' })
    attempts++
    const response = await invoke(correlatedInput)
    if (currentUser && firebaseAuth?.currentUser !== currentUser) throw Object.assign(new Error('Phiên đăng nhập đã thay đổi.'), { code: 'permission-denied' })
    return response.data
  }, {
    signal: options.signal,
    maximumAttempts: options.maximumAttempts ?? 3,
    baseDelayMs: options.baseDelayMs ?? 300,
    refreshAuth: currentUser ? () => {
      if (firebaseAuth?.currentUser !== currentUser) throw Object.assign(new Error('Phiên đăng nhập đã thay đổi.'), { code: 'permission-denied' })
      return currentUser.getIdToken(true)
    } : undefined,
    onFinalFailure: (error, context) => {
      reportClientIssue('firestore', error, {
        phase: `read_callable_${name}_a${context.attempts}`.slice(0, 80),
        route: typeof window === 'undefined' ? '' : window.location.hash,
        retryable: context.retryable,
        correlationId,
      })
    },
  })
  failed = false
  return result
  } finally {
    if (currentUser && firebaseAuth?.currentUser === currentUser) {
      let session = metricSessions.get(currentUser)
      if (!session) {
        session = { sampled: Math.random() < .1, sent: 0, buffer: createReadMetricBuffer() }
        metricSessions.set(currentUser, session)
      }
      const batch = session.buffer.record({ operation: name, durationMs: Date.now() - startedAt, attempts, failed })
      if (batch && session.sampled && session.sent < 12) {
        session.sent++
        void import('./analyticsService').then(({ trackProductEvent }) => {
          if (firebaseAuth?.currentUser === currentUser) return trackProductEvent('read_operation_batch', { ...batch, sampleRate: .1 })
        }).catch(() => undefined)
      }
    }
  }
}

/**
 * Try a read in the preferred region, then fail over once to a compatible
 * endpoint when the failure is transient. The caller owns the endpoint names
 * and must only use this for idempotent reads.
 */
export async function runReadOnlyWithFallback<Output>(
  primary: () => Promise<Output>,
  fallback: () => Promise<Output>,
  delayMs = 250,
): Promise<Output> {
  try {
    return await primary()
  } catch (error) {
    let cause = error
    for (let depth = 0; depth < 4 && cause instanceof Error && cause.cause; depth += 1) cause = cause.cause
    const code = callableCode(cause)
    if (['unauthenticated', 'permission-denied', 'not-found', 'failed-precondition', 'invalid-argument'].includes(code)
      || !isRetryableReadOnlyCallableError(cause)) throw error
    if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs))
    return fallback()
  }
}
