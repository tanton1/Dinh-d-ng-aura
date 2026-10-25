import type { User } from 'firebase/auth'
import { firebaseAuth } from '../lib/firebase'
import { firebaseAcademyFunctions, firebaseFunctions } from '../lib/firebaseFunctions'
import { runKeyedSingleFlight } from '../utils/singleFlight'
import { createClientCorrelationId } from './clientTelemetryService'
import { callReadOnlyFunction } from './readOnlyCallableService'
import { runAcademyReadWithFallback } from './academyReadPolicy'

type AcademyReadName = 'listAcademyCourses' | 'getCourseMediaUrl'
// Transport deduplication only. The chapter/media clients separately manage
// bounded memory leases scoped to a session, observed access and exact version.
const pendingBySession = new WeakMap<User, Map<string, Promise<unknown>>>()

export async function callAcademyReadFunction<Input, Output>(name: AcademyReadName, input: Input, accessRevision = ''): Promise<Output> {
  const owner = firebaseAuth?.currentUser
  const assertSession = () => {
    if (!owner || firebaseAuth?.currentUser !== owner) {
      throw Object.assign(new Error('Phiên đăng nhập đã thay đổi. Vui lòng mở lại khóa học.'), { code: 'functions/unauthenticated' })
    }
  }
  assertSession()
  if (!owner) throw new Error('Chưa đăng nhập Aura Academy.')
  let pending = pendingBySession.get(owner)
  if (!pending) {
    pending = new Map()
    pendingBySession.set(owner, pending)
  }
  const key = JSON.stringify([name, input, accessRevision])
  const result = await runKeyedSingleFlight(pending, key, async () => {
    const correlationId = createClientCorrelationId()
    const read = (regional: boolean) => {
      assertSession()
      return callReadOnlyFunction<Input, Output>(regional ? `${name}Regional` : name, input, {
        functionsClient: regional ? firebaseAcademyFunctions : firebaseFunctions,
        maximumAttempts: 2,
        timeoutMs: regional ? 12_000 : 20_000,
        baseDelayMs: 1_000,
        correlationId,
      })
    }
    // Singapore has exhausted its shared regional CPU quota during cold starts.
    // Both read endpoints execute exactly the same server authorization logic.
    return runAcademyReadWithFallback(() => read(true), () => read(false))
  })
  assertSession()
  return result as Output
}
