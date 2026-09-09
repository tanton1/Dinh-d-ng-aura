import { httpsCallable } from 'firebase/functions'
import { firebaseFunctions } from '../lib/firebaseFunctions'
import { createClientCorrelationId } from './clientTelemetryService'

interface BranchCommandResult {
  schemaVersion: 1
  branchId: string
  status: 'active' | 'archived'
  revision: number
  unchanged: boolean
}

interface UpsertBranchInput {
  branchId?: string
  expectedRevision: number
  idempotencyKey: string
  name: string
  address: string
}

interface ArchiveBranchInput {
  branchId: string
  expectedRevision: number
  idempotencyKey: string
}

function functionsOrThrow() {
  if (!firebaseFunctions) throw new Error('Dịch vụ chi nhánh chưa sẵn sàng.')
  return firebaseFunctions
}

function presentError(error: unknown) {
  const source = error && typeof error === 'object' ? error as { code?: unknown; message?: unknown } : {}
  const code = typeof source.code === 'string' ? source.code.replace(/^functions\//, '') : ''
  const message = typeof source.message === 'string' ? source.message.trim() : ''
  if (['aborted', 'already-exists', 'invalid-argument', 'failed-precondition', 'not-found', 'permission-denied'].includes(code)) return new Error(message || 'Chưa thể lưu chi nhánh.')
  if (code === 'unauthenticated') return new Error('Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại.')
  if (['deadline-exceeded', 'internal', 'unavailable'].includes(code)) return new Error('Dịch vụ chi nhánh đang gián đoạn. Thay đổi chưa được xác nhận; vui lòng thử lại.')
  return error instanceof Error ? error : new Error('Chưa thể lưu chi nhánh.')
}

export function createBranchCommandKey() {
  return `branch-${createClientCorrelationId()}`
}

export async function upsertBranch(input: UpsertBranchInput) {
  const callable = httpsCallable<UpsertBranchInput & { correlationId: string }, BranchCommandResult>(functionsOrThrow(), 'upsertBranch', { timeout: 20_000 })
  try { return (await callable({ ...input, correlationId: createClientCorrelationId() })).data } catch (error) { throw presentError(error) }
}

export async function archiveBranch(input: ArchiveBranchInput) {
  const callable = httpsCallable<ArchiveBranchInput & { correlationId: string }, BranchCommandResult>(functionsOrThrow(), 'archiveBranch', { timeout: 20_000 })
  try { return (await callable({ ...input, correlationId: createClientCorrelationId() })).data } catch (error) { throw presentError(error) }
}
