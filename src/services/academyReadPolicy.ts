import { callableCode, isRetryableReadOnlyCallableError } from './readOnlyCallableCore'

/** Fail over reads only. Authorization and content errors must never be bypassed. */
export async function runAcademyReadWithFallback<T>(primary: () => Promise<T>, fallback: () => Promise<T>): Promise<T> {
  try {
    return await primary()
  } catch (error) {
    let cause = error
    for (let depth = 0; depth < 4 && cause instanceof Error && cause.cause; depth += 1) cause = cause.cause
    if (['unauthenticated', 'permission-denied', 'not-found', 'failed-precondition', 'invalid-argument'].includes(callableCode(cause))
        || !isRetryableReadOnlyCallableError(cause)) throw error
    return fallback()
  }
}
