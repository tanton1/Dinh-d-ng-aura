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

function scheduleConfigError(cause: unknown) {
  const raw = cause && typeof cause === 'object' ? cause as { code?: unknown; message?: unknown } : {}
  const code = typeof raw.code === 'string' ? raw.code : ''
  const rawMessage = typeof raw.message === 'string' && raw.message.trim()
    ? raw.message.replace(/^FirebaseError:\s*/i, '').trim()
    : cause instanceof Error ? cause.message : ''
  let message = rawMessage || 'Không thể lưu chính sách lịch.'
  if (/functions\/internal$|functions\/unavailable$|functions\/deadline-exceeded$/i.test(code)) {
    message = 'Dịch vụ lưu chính sách đang tạm thời gặp lỗi hạ tầng. Dữ liệu chưa được lưu; hãy thử lại sau ít phút.'
  } else if (/functions\/unauthenticated$/i.test(code)) {
    message = 'Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại rồi lưu chính sách.'
  } else if (/functions\/permission-denied$/i.test(code)) {
    message = 'Tài khoản không có quyền cập nhật chính sách lịch.'
  }
  return Object.assign(new Error(message), { code, cause })
}

export function createScheduleConfigCommandKey() {
  return `schedule-config-${createClientCorrelationId()}`
}

export async function saveScheduleConfig(input: { config: ScheduleConfig; expectedRevision: number; idempotencyKey: string }) {
  const callable = httpsCallable<typeof input & { correlationId: string }, SaveScheduleConfigResult>(functionsOrThrow(), 'saveScheduleConfig', { timeout: 20_000 })
  try {
    return (await callable({ ...input, correlationId: createClientCorrelationId() })).data
  } catch (cause) {
    throw scheduleConfigError(cause)
  }
}
