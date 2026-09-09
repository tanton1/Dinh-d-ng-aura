import { httpsCallable, type Functions } from 'firebase/functions'
import { firebaseAuth } from '../lib/firebase'
import { firebaseFunctions } from '../lib/firebaseFunctions'
import { createClientCorrelationId, reportClientIssue } from './clientTelemetryService'
import { runReadOnlyWithRetry } from './readOnlyCallableCore'

export interface ReadOnlyCallableOptions {
  signal?: AbortSignal
  timeoutMs?: number
  maximumAttempts?: number
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
  const correlationId = createClientCorrelationId()
  const correlatedInput = input && typeof input === 'object' && !Array.isArray(input)
    ? { ...input, correlationId } as Input
    : input
  const invoke = httpsCallable<Input, Output>(functionsClient, name, { timeout: options.timeoutMs ?? 18_000 })
  const currentUser = firebaseAuth?.currentUser
  return runReadOnlyWithRetry(async () => (await invoke(correlatedInput)).data, {
    signal: options.signal,
    maximumAttempts: options.maximumAttempts ?? 3,
    refreshAuth: currentUser ? () => currentUser.getIdToken(true) : undefined,
    onFinalFailure: (error, context) => {
      reportClientIssue('firestore', error, {
        phase: `read_callable_${name}_a${context.attempts}`.slice(0, 80),
        route: typeof window === 'undefined' ? '' : window.location.hash,
        retryable: context.retryable,
        correlationId,
      })
    },
  })
}
