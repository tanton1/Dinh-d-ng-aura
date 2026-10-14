import { httpsCallable } from 'firebase/functions'
import { firebaseFunctions, firebaseStudentManagementFunctions } from '../lib/firebaseFunctions'
import { createClientCorrelationId } from './clientTelemetryService'
import type { Student } from '../types/ptOperations'

export interface UpdateStudentProfileInput {
  studentId: string
  expectedRevision: number
  idempotencyKey: string
  updates: Partial<Pick<Student,
    | 'name'
    | 'phone'
    | 'email'
    | 'dob'
    | 'sessionsPerWeek'
    | 'status'
    | 'branchId'
    | 'nutritionNote'
    | 'availableSlots'
    | 'isScheduleConfirmed'
  >>
}

export interface UpdateStudentProfileResult {
  schemaVersion: 1
  studentId: string
  revision: number
  status: 'active' | 'inactive'
  unchanged: boolean
}

export interface HardDeleteStudentResult {
  studentId: string
  deleted: boolean
  preservedSessionCount: number
  preservedContractCount: number
  payrollEvidencePreserved: boolean
  deletedProfileDocuments: number
  auditLogId: string
  authPendingDelete: boolean
}

function functionsOrThrow() {
  if (!firebaseFunctions) throw new Error('Dịch vụ hồ sơ học viên chưa sẵn sàng.')
  return firebaseFunctions
}

function presentError(error: unknown) {
  const source = error && typeof error === 'object' ? error as { code?: unknown; message?: unknown } : {}
  const code = typeof source.code === 'string' ? source.code.replace(/^functions\//, '') : ''
  const message = typeof source.message === 'string' ? source.message.trim() : ''
  if (code === 'aborted') return new Error(message || 'Hồ sơ vừa được người khác cập nhật. Hãy tải lại rồi thử lại.')
  if (code === 'permission-denied') return new Error(message || 'Bạn không có quyền cập nhật hồ sơ học viên này.')
  if (code === 'unauthenticated') return new Error('Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại.')
  if (['invalid-argument', 'failed-precondition', 'not-found', 'already-exists'].includes(code)) {
    return new Error(message || 'Thông tin học viên chưa hợp lệ.')
  }
  if (['deadline-exceeded', 'internal', 'unavailable'].includes(code)) {
    return new Error('Dịch vụ hồ sơ học viên đang gián đoạn. Thay đổi chưa được xác nhận; vui lòng thử lại.')
  }
  return error instanceof Error ? error : new Error('Chưa thể cập nhật hồ sơ học viên.')
}

function hardDeleteFunctionsOrThrow() {
  if (!firebaseStudentManagementFunctions) throw new Error('Dịch vụ hồ sơ học viên chưa sẵn sàng.')
  return firebaseStudentManagementFunctions
}

function errorCode(error: unknown) {
  const value = error && typeof error === 'object' ? (error as { code?: unknown }).code : ''
  return typeof value === 'string' ? value.replace(/^functions\//, '') : ''
}

export function createStudentCommandKey() {
  return `student-${createClientCorrelationId()}`
}

export async function updateStudentProfile(input: UpdateStudentProfileInput) {
  const callable = httpsCallable<UpdateStudentProfileInput & { correlationId: string }, UpdateStudentProfileResult>(
    functionsOrThrow(),
    'updateStudentProfile',
    // Archive/edit commands are idempotent by design. A short retry absorbs a
    // cold-start or transient regional hiccup without duplicating the write.
    { timeout: 30_000 },
  )
  const payload = { ...input, correlationId: createClientCorrelationId() }
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return (await callable(payload)).data
    } catch (error) {
      const code = errorCode(error)
      const retryable = ['deadline-exceeded', 'internal', 'unavailable'].includes(code)
      if (!retryable || attempt === 1) throw presentError(error)
      await new Promise((resolve) => globalThis.setTimeout(resolve, 350 * (attempt + 1)))
    }
  }
  throw new Error('Chưa thể cập nhật hồ sơ học viên.')
}

export async function hardDeleteStudent(studentId: string, confirmation = 'XÓA VĨNH VIỄN'): Promise<HardDeleteStudentResult> {
  const callable = httpsCallable<
    { studentId: string; confirmation: string },
    HardDeleteStudentResult
  >(hardDeleteFunctionsOrThrow(), 'hardDeleteStudentRegional', { timeout: 60_000 })
  try {
    return (await callable({ studentId, confirmation })).data
  } catch (error) {
    throw presentError(error)
  }
}
