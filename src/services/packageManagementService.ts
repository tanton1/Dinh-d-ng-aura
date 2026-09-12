import { httpsCallable } from 'firebase/functions'
import { firebaseFunctions } from '../lib/firebaseFunctions'
import { createClientCorrelationId } from './clientTelemetryService'

export interface TrainingPackageCommandResult {
  schemaVersion: 1
  packageId: string
  status: 'active' | 'archived'
  revision: number
  unchanged: boolean
}

export interface UpsertTrainingPackageInput {
  packageId?: string
  expectedRevision: number
  idempotencyKey: string
  name: string
  totalSessions: number
  durationMonths: number
  price: number
  branchId?: string | null
}

export interface ArchiveTrainingPackageInput {
  packageId: string
  expectedRevision: number
  idempotencyKey: string
}

function functionsOrThrow() {
  if (!firebaseFunctions) throw new Error('Firebase Functions chưa sẵn sàng.')
  return firebaseFunctions
}

export function createPackageCommandKey() {
  return `package-${createClientCorrelationId()}`
}

export async function upsertTrainingPackage(input: UpsertTrainingPackageInput) {
  const callable = httpsCallable<UpsertTrainingPackageInput & { correlationId: string }, TrainingPackageCommandResult>(
    functionsOrThrow(),
    'upsertTrainingPackage',
    { timeout: 20_000 },
  )
  return (await callable({ ...input, correlationId: createClientCorrelationId() })).data
}

export async function archiveTrainingPackage(input: ArchiveTrainingPackageInput) {
  const callable = httpsCallable<ArchiveTrainingPackageInput & { correlationId: string }, TrainingPackageCommandResult>(
    functionsOrThrow(),
    'archiveTrainingPackage',
    { timeout: 20_000 },
  )
  return (await callable({ ...input, correlationId: createClientCorrelationId() })).data
}
