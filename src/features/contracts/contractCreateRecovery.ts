import type { Student360ContractMutation } from '../student-360/types'
type CreateCommand = Extract<Student360ContractMutation, { action: 'create' }>
export interface PendingContractCreate { ownerUid: string; input: CreateCommand }
const memory = new Map<string, PendingContractCreate>()
const keyFor = (owner: string, student: string) => `aura:contract-create:v1:${encodeURIComponent(owner)}:${encodeURIComponent(student)}`

export function readContractCreate(ownerUid: string, studentId: string): PendingContractCreate | null {
  if (!ownerUid) return null
  const key = keyFor(ownerUid, studentId)
  let value: PendingContractCreate | undefined
  try { value = JSON.parse(sessionStorage.getItem(key) || 'null') || memory.get(key) } catch { value = memory.get(key) }
  if (!value || value.ownerUid !== ownerUid || value.input?.studentId !== studentId || value.input.action !== 'create'
    || typeof value.input.contractId !== 'string' || !value.input.contractId || !value.input.contract || typeof value.input.contract !== 'object') return null
  return structuredClone(value)
}

export function rememberContractCreate(value: PendingContractCreate) {
  const current = readContractCreate(value.ownerUid, value.input.studentId)
  if (current && JSON.stringify(current.input) !== JSON.stringify(value.input)) throw new Error('Cần kiểm tra yêu cầu tạo hợp đồng trước đó trước khi tạo yêu cầu mới.')
  const snapshot = structuredClone(value)
  const key = keyFor(value.ownerUid, value.input.studentId)
  memory.set(key, snapshot)
  try { sessionStorage.setItem(key, JSON.stringify(snapshot)) } catch { /* Keep the exact command for same-page recovery. */ }
}

export function clearContractCreate(ownerUid: string, studentId: string, contractId?: string) {
  if (readContractCreate(ownerUid, studentId)?.input.contractId !== contractId) return
  const key = keyFor(ownerUid, studentId)
  try { sessionStorage.removeItem(key) } catch { /* Storage may be unavailable. */ }
  memory.delete(key)
}
