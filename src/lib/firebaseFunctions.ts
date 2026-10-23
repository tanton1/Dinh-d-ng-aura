import { connectFunctionsEmulator, getFunctions, type Functions } from 'firebase/functions'
import { firebaseApp, isFirebaseConfigured, useFirebaseEmulators } from './firebase'

export let firebaseFunctions: Functions | null = null
/** Dedicated region for high-volume student nutrition AI callables. */
export let firebaseNutritionFunctions: Functions | null = null
/** Dedicated overflow region for CPU-bounded scheduling and payroll services. */
export let firebaseScheduleOptimizerFunctions: Functions | null = null
/** Dedicated overflow region for schedule validation, publish and Admin edits. */
export let firebaseSchedulePublishFunctions: Functions | null = null
/** Dedicated overflow region for the low-volume hard-delete admin command. */
export let firebaseStudentManagementFunctions: Functions | null = null
/** Dedicated overflow region for Student 360 reads and contract operations. */
export let firebaseStudent360Functions: Functions | null = null
/** Read-only Academy overflow; no enrollment/progress writes are retried here. */
export let firebaseAcademyFunctions: Functions | null = null
/** Overflow region for read-only business reports and training history. */
export let firebaseBusinessReportingFunctions: Functions | null = null
/** Bounded asia-east1 overflow aliases for authentication bootstrap and telemetry. */
export let firebaseTelemetryFunctions: Functions | null = null
/** Bounded Aura Club / workout read aliases in the existing Jakarta pool. */
export let firebaseRegionalReadFunctions: Functions | null = null

if (isFirebaseConfigured && firebaseApp) {
  firebaseFunctions = getFunctions(firebaseApp, 'asia-southeast1')
  firebaseNutritionFunctions = getFunctions(firebaseApp, 'asia-southeast2')
  firebaseRegionalReadFunctions = firebaseNutritionFunctions
  firebaseScheduleOptimizerFunctions = getFunctions(firebaseApp, 'asia-east1')
  firebaseSchedulePublishFunctions = firebaseScheduleOptimizerFunctions
  firebaseStudentManagementFunctions = firebaseScheduleOptimizerFunctions
  firebaseStudent360Functions = firebaseScheduleOptimizerFunctions
  firebaseAcademyFunctions = firebaseScheduleOptimizerFunctions
  firebaseBusinessReportingFunctions = firebaseScheduleOptimizerFunctions
  firebaseTelemetryFunctions = firebaseScheduleOptimizerFunctions

  if (useFirebaseEmulators) {
    connectFunctionsEmulator(firebaseFunctions, '127.0.0.1', 5001)
    connectFunctionsEmulator(firebaseNutritionFunctions, '127.0.0.1', 5001)
    connectFunctionsEmulator(firebaseScheduleOptimizerFunctions, '127.0.0.1', 5001)
  }
}
