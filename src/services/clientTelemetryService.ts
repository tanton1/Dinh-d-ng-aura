import { firebaseAppCheckStatus, isFirebaseConfigured, useFirebaseEmulators } from '../lib/firebase'

export type ClientIssueArea = 'auth' | 'gemini' | 'openrouter' | 'apikey_fun' | 'firestore' | 'push' | 'ui'

interface ClientIssueContext {
  phase: string
  incidentId?: string
  route?: string
  host?: string
  provider?: 'google' | 'phone' | 'email' | 'password' | 'gemini' | 'openrouter' | 'apikey_fun'
  retryable?: boolean
}

const reportedIssueKeys = new Map<string, number>()
let clientTelemetryInitialized = false

function shouldReportIssue(key: string) {
  const now = Date.now()
  const previous = reportedIssueKeys.get(key) ?? 0
  if (now - previous < 30_000) return false
  reportedIssueKeys.set(key, now)
  if (reportedIssueKeys.size > 100) {
    for (const [entry, timestamp] of reportedIssueKeys) {
      if (now - timestamp > 5 * 60_000) reportedIssueKeys.delete(entry)
    }
  }
  return true
}

function safeErrorCode(error: unknown) {
  if (error && typeof error === 'object' && 'code' in error) {
    return String((error as { code?: unknown }).code ?? 'unknown')
      .replace(/^functions\//, '')
      .slice(0, 80)
  }
  if (error instanceof Error && /^[A-Z0-9_-]{2,80}$/.test(error.message)) {
    return error.message
  }
  return 'unknown'
}

export function reportClientIssue(
  area: ClientIssueArea,
  error: unknown,
  context: ClientIssueContext,
) {
  const code = safeErrorCode(error)
  const issueKey = `${context.phase}:${code}:${context.provider ?? ''}`
  if (!shouldReportIssue(issueKey)) return
  if (import.meta.env.DEV) {
    console.warn('Aura client issue', { area, code, ...context })
  }
  const payload: {
    area: ClientIssueArea
    code: string
    phase: string
    route: string
    host: string
    incidentId?: string
    provider?: ClientIssueContext['provider']
    retryable?: boolean
    release: string
  } = {
    area,
    code,
    phase: context.phase.slice(0, 80),
    route: (context.route || window.location.hash || '#/').slice(0, 160),
    host: (context.host || window.location.hostname || 'unknown').slice(0, 120),
    incidentId: context.incidentId?.slice(0, 80),
    provider: context.provider,
    retryable: context.retryable,
    release: (import.meta.env.VITE_APP_RELEASE || 'web').slice(0, 80),
  }

  // Error reporting must never add Firebase Functions to the first-paint
  // bundle. Load the transport only if an issue actually needs reporting.
  void Promise.all([
    import('firebase/functions'),
    import('../lib/firebaseFunctions'),
  ]).then(([{ httpsCallable }, { firebaseFunctions }]) => {
    if (!firebaseFunctions) return undefined
    const report = httpsCallable<typeof payload, { accepted: boolean }>(
      firebaseFunctions,
      'reportClientIssue',
      { timeout: 5_000 },
    )
    return report(payload)
  }).catch(() => undefined)
}

/**
 * Installs a small, privacy-safe last-resort monitor for errors that bypass
 * React/Auth/Firestore service boundaries. It intentionally records only a
 * normalized code and lifecycle phase; stack traces and health data stay in
 * the browser console.
 */
export function initializeClientTelemetry() {
  if (clientTelemetryInitialized || typeof window === 'undefined') return
  clientTelemetryInitialized = true

  const onWindowError = (event: ErrorEvent) => {
    const message = event.error instanceof Error ? event.error : new Error(event.message || 'window_error')
    reportClientIssue('ui', message, { phase: 'window_error', retryable: true })
  }
  const onUnhandledRejection = (event: PromiseRejectionEvent) => {
    const reason = event.reason instanceof Error ? event.reason : new Error('unhandled_rejection')
    reportClientIssue('ui', reason, { phase: 'unhandled_rejection', retryable: true })
  }

  window.addEventListener('error', onWindowError)
  window.addEventListener('unhandledrejection', onUnhandledRejection)

  if (isFirebaseConfigured && !useFirebaseEmulators && !['enabled', 'initializing', 'deferred'].includes(firebaseAppCheckStatus)) {
    let shouldReportAppCheck = true
    try {
      shouldReportAppCheck = window.sessionStorage.getItem('aura:app-check-telemetry') !== 'reported'
      if (shouldReportAppCheck) window.sessionStorage.setItem('aura:app-check-telemetry', 'reported')
    } catch {
      // Continue with the in-memory dedupe when storage is unavailable.
    }
    if (shouldReportAppCheck) {
      reportClientIssue('auth', new Error('app_check_unconfigured'), {
        phase: `app_check_${firebaseAppCheckStatus}`,
        retryable: false,
      })
    }
  }
}
