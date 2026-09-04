import { httpsCallable } from 'firebase/functions'
import { firebaseFunctions } from '../../lib/firebaseFunctions'
import { callReadOnlyFunction } from '../../services/readOnlyCallableService'
import type { Student360DirectoryItem, Student360Overview, Student360Photo, Student360TimelineEvent } from './types'

function functionError(cause: unknown, fallback: string) {
  const value = cause && typeof cause === 'object' ? cause as { code?: unknown; message?: unknown } : {}
  const code = typeof value.code === 'string' ? value.code.replace(/^functions\//, '') : ''
  const message = typeof value.message === 'string' ? value.message.trim() : ''
  if (code === 'permission-denied') return new Error(message || 'Học viên không thuộc phạm vi được giao.')
  if (code === 'not-found') return new Error('Không tìm thấy hồ sơ học viên.')
  if (code === 'unauthenticated') return new Error('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.')
  if (['resource-exhausted', 'deadline-exceeded', 'unavailable', 'internal'].includes(code)) return new Error('Student 360 đang bận. Aura chưa thay đổi dữ liệu; vui lòng thử lại.')
  return new Error(message || fallback)
}

export async function getStudent360Overview(studentId: string, weekId?: string) {
  try {
    return await callReadOnlyFunction<{ studentId: string; weekId?: string; forceRefresh?: boolean }, Student360Overview>(
      'getStudent360Overview',
      { studentId, ...(weekId ? { weekId } : {}) },
      { timeoutMs: 30_000 },
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
    return await callReadOnlyFunction<typeof input, { schemaVersion: 1; rows: Student360DirectoryItem[]; hasMore: boolean; nextCursor: string | null; totalMatched: number }>(
      'listStudent360Directory',
      input,
      { timeoutMs: 30_000 },
    )
  } catch (cause) {
    throw functionError(cause, 'Không thể tải danh mục Học viên 360.')
  }
}

export async function listStudent360Timeline(input: { studentId: string; types?: string[]; cursor?: number | null; pageSize?: number }) {
  try {
    return await callReadOnlyFunction<typeof input, { schemaVersion: 1; studentId: string; rows: Student360TimelineEvent[]; hasMore: boolean; nextCursor: number | null }>(
      'listStudent360Timeline',
      input,
      { timeoutMs: 30_000 },
    )
  } catch (cause) {
    throw functionError(cause, 'Không thể tải dòng hoạt động.')
  }
}

export async function getStudent360ProgressPhotos(studentId: string, cursor?: string | null) {
  try {
    return await callReadOnlyFunction<{ studentId: string; cursor?: string }, { schemaVersion: 1; studentId: string; rows: Student360Photo[]; hasMore: boolean; nextCursor: string | null; hasLegacyImages: boolean; expiresInSeconds: number }>(
      'getStudent360ProgressPhotos',
      { studentId, ...(cursor ? { cursor } : {}) },
      { timeoutMs: 30_000 },
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
  if (!firebaseFunctions) throw new Error('Firebase Functions chưa được cấu hình.')
  try {
    const callable = httpsCallable<typeof input, { activityId: string; createdAt: string }>(firebaseFunctions, 'createStudentCareActivity')
    return (await callable(input)).data
  } catch (cause) {
    throw functionError(cause, 'Không thể ghi nhận hoạt động chăm sóc.')
  }
}

export async function refreshStudent360Projection(studentId: string) {
  if (!firebaseFunctions) throw new Error('Firebase Functions chưa được cấu hình.')
  try {
    const callable = httpsCallable<{ studentId: string }, { studentId: string; generatedAt: string }>(firebaseFunctions, 'refreshStudent360Projection')
    return (await callable({ studentId })).data
  } catch (cause) {
    throw functionError(cause, 'Không thể đối soát Student 360.')
  }
}
