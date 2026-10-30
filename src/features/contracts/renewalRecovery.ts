import type { RenewPtContractInput } from '../../services/contractRenewalService'

export interface PendingRenewalCommand {
  ownerUid: string
  createdAt: number
  input: RenewPtContractInput
}

const memory = new Map<string, PendingRenewalCommand>()
const storageKey = (ownerUid: string, caseId: string) => `aura:renewal-recovery:v1:${encodeURIComponent(ownerUid)}:${encodeURIComponent(caseId)}`

/** Session-only command recovery. No tokens, student profile or photo data.
 * Keep the exact command (including the cashier's note) until its outcome is
 * known; rebuilding it from current form defaults can change the payment. */
export function rememberRenewalCommand(command: PendingRenewalCommand) {
  const key = storageKey(command.ownerUid, command.input.caseId)
  const snapshot = JSON.parse(JSON.stringify(command)) as PendingRenewalCommand
  memory.set(key, snapshot)
  try { sessionStorage.setItem(key, JSON.stringify(snapshot)) } catch { /* Same-page recovery remains available. */ }
}

export function readRenewalCommand(ownerUid: string, caseId: string, sourceContractId: string): PendingRenewalCommand | null {
  if (!ownerUid) return null
  const key = storageKey(ownerUid, caseId)
  let value: PendingRenewalCommand | undefined
  try { value = JSON.parse(sessionStorage.getItem(key) || 'null') || memory.get(key) } catch { value = memory.get(key) }
  if (!value || value.ownerUid !== ownerUid || value.input?.caseId !== caseId || value.input.sourceContractId !== sourceContractId
    || typeof value.input.idempotencyKey !== 'string' || !value.input.idempotencyKey || !Array.isArray(value.input.installments)
    || !Number.isFinite(value.createdAt) || !Number.isFinite(value.input.initialPayment)) return null
  return value
}

export function clearRenewalCommand(ownerUid: string, caseId: string, idempotencyKey: string) {
  const key = storageKey(ownerUid, caseId)
  const current = memory.get(key)
  if (current && current.input.idempotencyKey !== idempotencyKey) return
  try {
    const stored = JSON.parse(sessionStorage.getItem(key) || 'null') as PendingRenewalCommand | null
    if (stored && stored.input.idempotencyKey !== idempotencyKey) return
    sessionStorage.removeItem(key)
  } catch { /* Storage may be unavailable. */ }
  memory.delete(key)
}

export function renewalOutcomeUnknown(error: unknown): boolean {
  const code = String((error as { code?: unknown })?.code || '').replace(/^functions\//, '')
  return !code || ['internal', 'resource-exhausted', 'unavailable', 'deadline-exceeded', 'cancelled', 'unknown'].includes(code)
}

/** A missing read result is not permission to create a fresh transaction:
 * another invocation may still be running. Retry only the frozen command. */
export async function reconcileRenewalCommand<T>(input: RenewPtContractInput, read: () => Promise<{ case: { sourceContractId: string; renewedContractId: string | null } }>, replay: (input: RenewPtContractInput) => Promise<T>): Promise<T | { contractId: string; unchanged: true }> {
  const detail = await read()
  if (detail.case.sourceContractId !== input.sourceContractId) throw new Error('Hồ sơ đối chiếu không khớp hợp đồng nguồn. Vui lòng tải lại.')
  if (detail.case.renewedContractId) return { contractId: detail.case.renewedContractId, unchanged: true }
  return replay(input)
}
