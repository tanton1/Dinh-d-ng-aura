import { httpsCallable } from 'firebase/functions'
import { firebaseFunctions } from '../lib/firebase'

export type ClientIssueArea = 'auth' | 'gemini' | 'firestore' | 'ui'

interface ClientIssueContext {
  phase: string
  incidentId?: string
  route?: string
  provider?: 'google' | 'phone' | 'email' | 'password' | 'gemini'
  retryable?: boolean
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
  if (import.meta.env.DEV) {
    console.warn('Aura client issue', { area, code, ...context })
  }
  if (!firebaseFunctions) return

  const report = httpsCallable<{
    area: ClientIssueArea
    code: string
    phase: string
    route: string
    incidentId?: string
    provider?: ClientIssueContext['provider']
    retryable?: boolean
    release: string
  }, { accepted: boolean }>(firebaseFunctions, 'reportClientIssue', { timeout: 5_000 })

  void report({
    area,
    code,
    phase: context.phase.slice(0, 80),
    route: (context.route || window.location.hash || '#/').slice(0, 160),
    incidentId: context.incidentId?.slice(0, 80),
    provider: context.provider,
    retryable: context.retryable,
    release: (import.meta.env.VITE_APP_RELEASE || 'web').slice(0, 80),
  }).catch(() => undefined)
}
