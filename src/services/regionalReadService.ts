import { firebaseAuth } from '../lib/firebase'
import { firebaseRegionalReadFunctions } from '../lib/firebaseFunctions'
import { runKeyedSingleFlight } from '../utils/singleFlight'
import { createClientCorrelationId } from './clientTelemetryService'
import { callReadOnlyFunction, runReadOnlyWithFallback } from './readOnlyCallableService'
import { regionalReadAliases, type RegionalReadName } from './regionalReadPolicy'

const pendingReads = new Map<string, Promise<unknown>>()

/** No result cache: every settled read can immediately observe a new write.
 * Only simultaneous identical reads for the SAME account share a request.
 * Each region gets one attempt; a quota outage must not fan out six retries.
 */
export function callRegionalRead<Input, Output>(name: RegionalReadName, input: Input): Promise<Output> {
  const uid = firebaseAuth?.currentUser?.uid
  const execute = () => {
    const correlationId = createClientCorrelationId()
    const options = { correlationId, maximumAttempts: 1, timeoutMs: 30_000 }
    const legacy = () => callReadOnlyFunction<Input, Output>(name, input, options)
    if (!firebaseRegionalReadFunctions) return legacy()
    return runReadOnlyWithFallback(
      () => callReadOnlyFunction<Input, Output>(regionalReadAliases[name], input, {
        ...options, functionsClient: firebaseRegionalReadFunctions,
      }),
      legacy,
    )
  }
  // Do not coalesce anonymous/pre-auth requests across authentication changes.
  if (!uid) return execute()
  return runKeyedSingleFlight(pendingReads, JSON.stringify([uid, name, input]), execute) as Promise<Output>
}
