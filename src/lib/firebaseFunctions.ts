import { connectFunctionsEmulator, getFunctions, type Functions } from 'firebase/functions'
import { firebaseApp, isFirebaseConfigured, useFirebaseEmulators } from './firebase'

export let firebaseFunctions: Functions | null = null
/** Dedicated overflow region for CPU-bounded scheduling and payroll services. */
export let firebaseScheduleOptimizerFunctions: Functions | null = null

if (isFirebaseConfigured && firebaseApp) {
  firebaseFunctions = getFunctions(firebaseApp, 'asia-southeast1')
  firebaseScheduleOptimizerFunctions = getFunctions(firebaseApp, 'asia-east1')

  if (useFirebaseEmulators) {
    connectFunctionsEmulator(firebaseFunctions, '127.0.0.1', 5001)
    connectFunctionsEmulator(firebaseScheduleOptimizerFunctions, '127.0.0.1', 5001)
  }
}
