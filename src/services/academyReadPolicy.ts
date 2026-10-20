import { runReadOnlyWithFallback } from './readOnlyCallableService'

/** Fail over reads only. Authorization and content errors must never be bypassed. */
export async function runAcademyReadWithFallback<T>(primary: () => Promise<T>, fallback: () => Promise<T>): Promise<T> {
  return runReadOnlyWithFallback(primary, fallback, 0)
}
