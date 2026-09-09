import { httpsCallable } from 'firebase/functions'
import { firebaseFunctions } from '../lib/firebaseFunctions'
import { createClientCorrelationId } from './clientTelemetryService'

export type OperationalActionSeverity = 'critical' | 'warning' | 'info'
export type OperationalActionStatus = 'open' | 'in_progress' | 'resolved' | 'snoozed'

export interface OperationalAction {
  actionId: string
  sourceType: string
  sourceId: string
  actionType: string
  branchId: string | null
  studentId: string | null
  severity: OperationalActionSeverity
  status: OperationalActionStatus
  title: string
  redactedSummary: string
  dueAt: string | null
  assignedUid: string | null
  availableActions: string[]
  createdAt: string | null
  updatedAt: string | null
  claimedAt: string | null
  resolvedAt: string | null
}

export interface OperationalActionSummary {
  schemaVersion: 1
  total: number
  critical: number
  warning: number
  info: number
}

function functionsOrThrow() {
  if (!firebaseFunctions) throw new Error('Firebase Functions chưa sẵn sàng.')
  return firebaseFunctions
}

function correlated<T extends object>(input: T) {
  return { ...input, correlationId: createClientCorrelationId() }
}

export async function listOperationalActions(input: { pageSize?: number; cursor?: string | null; statuses?: OperationalActionStatus[] } = {}) {
  const callable = httpsCallable<typeof input, { schemaVersion: 1; rows: OperationalAction[]; hasMore: boolean; nextCursor: string | null }>(functionsOrThrow(), 'listOperationalActions', { timeout: 15_000 })
  return (await callable(correlated(input))).data
}

export async function getOperationalActionSummary() {
  const callable = httpsCallable<{ correlationId?: string }, OperationalActionSummary>(functionsOrThrow(), 'getOperationalActionSummary', { timeout: 15_000 })
  return (await callable(correlated({}))).data
}

export async function claimOperationalAction(actionId: string) {
  const callable = httpsCallable<{ actionId: string }, OperationalAction>(functionsOrThrow(), 'claimOperationalAction', { timeout: 15_000 })
  return (await callable(correlated({ actionId }))).data
}

export async function resolveOperationalAction(actionId: string, resolution = '') {
  const callable = httpsCallable<{ actionId: string; resolution?: string }, OperationalAction>(functionsOrThrow(), 'resolveOperationalAction', { timeout: 15_000 })
  return (await callable(correlated({ actionId, resolution }))).data
}

export async function snoozeOperationalAction(actionId: string, until: string) {
  const callable = httpsCallable<{ actionId: string; until: string }, OperationalAction>(functionsOrThrow(), 'snoozeOperationalAction', { timeout: 15_000 })
  return (await callable(correlated({ actionId, until }))).data
}
