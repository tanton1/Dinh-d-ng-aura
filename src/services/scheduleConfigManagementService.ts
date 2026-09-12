import { httpsCallable } from 'firebase/functions'
import type { ScheduleConfig } from '../types'
import { firebaseFunctions } from '../lib/firebaseFunctions'
import { createClientCorrelationId } from './clientTelemetryService'

export interface SaveScheduleConfigResult {
  schemaVersion: 1
  revision: number
  config: ScheduleConfig
  unchanged: boolean
}

function functionsOrThrow() {
  if (!firebaseFunctions) throw new Error('Firebase Functions chưa sẵn sàng.')
  return firebaseFunctions
}

export function createScheduleConfigCommandKey() {
  return `schedule-config-${createClientCorrelationId()}`
}

export async function saveScheduleConfig(input: { config: ScheduleConfig; expectedRevision: number; idempotencyKey: string }) {
  const callable = httpsCallable<typeof input & { correlationId: string }, SaveScheduleConfigResult>(functionsOrThrow(), 'saveScheduleConfig', { timeout: 20_000 })
  return (await callable({ ...input, correlationId: createClientCorrelationId() })).data
}
