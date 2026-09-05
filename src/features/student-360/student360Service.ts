import { httpsCallable } from 'firebase/functions'
import { firebaseFunctions, firebaseStudent360Functions } from '../../lib/firebaseFunctions'
import { callReadOnlyFunction } from '../../services/readOnlyCallableService'
import type { Student360ContractMutation, Student360ContractWorkspace, Student360DirectoryItem, Student360Overview, Student360Photo, Student360TimelineEvent } from './types'

function functionError(cause: unknown, fallback: string) {
  const outer = cause && typeof cause === 'object' ? cause as { cause?: unknown } : {}
  const original = outer.cause && typeof outer.cause === 'object' ? outer.cause : cause
  const value = original && typeof original === 'object' ? original as { code?: unknown; message?: unknown } : {}
  const code = typeof value.code === 'string' ? value.code.replace(/^functions\//, '') : ''
  const message = typeof value.message === 'string' ? value.message.trim() : ''
  if (code === 'permission-denied') return new Error(message || 'Học viên không thuộc phạm vi được giao.')
  if (code === 'not-found') return new Error('Không tìm thấy hồ sơ học viên.')
  if (code === 'unauthenticated') return new Error('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.')
  if (['resource-exhausted', 'deadline-exceeded', 'unavailable', 'internal'].includes(code)) return new Error('Student 360 đang bận. Aura chưa thay đổi dữ liệu; vui lòng thử lại.')
  return new Error(message || fallback)
}

async function callStudent360Read<Input, Output>(
  name: string,
  input: Input,
  timeoutMs = 30_000,
): Promise<Output> {
  if (firebaseStudent360Functions) {
    try {
      return await callReadOnlyFunction<Input, Output>(`${name}Regional`, input, {
        functionsClient: firebaseStudent360Functions,
        timeoutMs,
        maximumAttempts: 2,
      })
    } catch {
      // Read-only calls can safely fall back while clients and regional
      // endpoints roll out at different times. Mutations never use this path.
    }
  }
  return callReadOnlyFunction<Input, Output>(name, input, { timeoutMs, maximumAttempts: 2 })
}

export async function getStudent360Overview(studentId: string, weekId?: string) {
  try {
    return await callStudent360Read<{ studentId: string; weekId?: string; forceRefresh?: boolean }, Student360Overview>(
      'getStudent360Overview',
      { studentId, ...(weekId ? { weekId } : {}) },
    )
  } catch (cause) {
    throw functionError(cause, 'Không thể tải Học viên 360.')
  }
}

export async function listStudent360Directory(input: {
  query?: string
  branchId?: string
  attention?: 'stable' | 'attention' | 'action_required'
  cursor?: string | null
  pageSize?: number
} = {}) {
  try {
    return await callStudent360Read<typeof input, { schemaVersion: 1; rows: Student360DirectoryItem[]; hasMore: boolean; nextCursor: string | null; totalMatched: number | null; scanned: number; truncated: boolean }>(
      'listStudent360Directory',
      input,
    )
  } catch (cause) {
    throw functionError(cause, 'Không thể tải danh mục Học viên 360.')
  }
}

export async function listStudent360Timeline(input: { studentId: string; types?: string[]; cursor?: number | null; pageSize?: number; fromMillis?: number }) {
  try {
    return await callStudent360Read<typeof input, { schemaVersion: 1; studentId: string; rows: Student360TimelineEvent[]; hasMore: boolean; nextCursor: number | null }>(
      'listStudent360Timeline',
      input,
    )
  } catch (cause) {
    throw functionError(cause, 'Không thể tải dòng hoạt động.')
  }
}

export async function getStudent360ProgressPhotos(studentId: string, cursor?: string | null) {
  try {
    return await callStudent360Read<{ studentId: string; cursor?: string }, { schemaVersion: 1; studentId: string; rows: Student360Photo[]; hasMore: boolean; nextCursor: string | null; hasLegacyImages: boolean; expiresInSeconds: number }>(
      'getStudent360ProgressPhotos',
      { studentId, ...(cursor ? { cursor } : {}) },
    )
  } catch (cause) {
    throw functionError(cause, 'Không thể tải ảnh tiến độ.')
  }
}

export async function createStudentCareActivity(input: {
  studentId: string
  type: 'call' | 'zalo' | 'note' | 'action_completed'
  note?: string
  actionId?: string
}) {
  const functionsClient = firebaseStudent360Functions || firebaseFunctions
  if (!functionsClient) throw new Error('Firebase Functions chưa được cấu hình.')
  try {
    const callableName = firebaseStudent360Functions ? 'createStudentCareActivityRegional' : 'createStudentCareActivity'
    const callable = httpsCallable<typeof input, { activityId: string; createdAt: string }>(functionsClient, callableName, { timeout: 30_000 })
    return (await callable(input)).data
  } catch (cause) {
    throw functionError(cause, 'Không thể ghi nhận hoạt động chăm sóc.')
  }
}

export async function refreshStudent360Projection(studentId: string) {
  const functionsClient = firebaseStudent360Functions || firebaseFunctions
  if (!functionsClient) throw new Error('Firebase Functions chưa được cấu hình.')
  try {
    const callableName = firebaseStudent360Functions ? 'refreshStudent360ProjectionRegional' : 'refreshStudent360Projection'
    const callable = httpsCallable<{ studentId: string }, { studentId: string; generatedAt: string }>(functionsClient, callableName, { timeout: 30_000 })
    return (await callable({ studentId })).data
  } catch (cause) {
    throw functionError(cause, 'Không thể đối soát Student 360.')
  }
}

export async function getStudent360ContractWorkspace(studentId: string) {
  try {
    return await callStudent360Read<{ studentId: string }, Student360ContractWorkspace>(
      'getStudent360ContractWorkspace',
      { studentId },
    )
  } catch (cause) {
    throw functionError(cause, 'Không thể tải nghiệp vụ hợp đồng.')
  }
}

export async function mutateStudent360Contract(input: Student360ContractMutation) {
  const functionsClient = firebaseStudent360Functions || firebaseFunctions
  if (!functionsClient) throw new Error('Firebase Functions chưa được cấu hình.')
  try {
    const callableName = firebaseStudent360Functions ? 'mutateStudent360ContractRegional' : 'mutateStudent360Contract'
    const callable = httpsCallable<Student360ContractMutation, { contractId: string; revision: number; action: string }>(functionsClient, callableName, { timeout: 30_000 })
    return (await callable(input)).data
  } catch (cause) {
    throw functionError(cause, 'Không thể cập nhật hợp đồng.')
  }
}
