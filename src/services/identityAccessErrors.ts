type IdentityAccessOperation = 'invite' | 'profile' | 'assign' | 'suspend' | 'restore' | 'delete' | 'generic'

type ErrorRecord = {
  code?: unknown
  message?: unknown
  details?: unknown
  customData?: unknown
}

function recordOf(error: unknown): ErrorRecord {
  return error && typeof error === 'object' ? error as ErrorRecord : {}
}

function normalizeCode(value: unknown) {
  return typeof value === 'string' ? value.replace(/^functions\//, '').trim().toLowerCase() : ''
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {}
}

function messageIsOpaque(value: string) {
  return !value || /^(?:firebase:\s*)?(?:functions\/)?(?:internal|unknown|error)(?:\s*\(functions\/(?:internal|unknown)\))?\.?$/i.test(value)
}

function meaningfulMessage(error: unknown) {
  const source = recordOf(error)
  const value = typeof source.message === 'string' ? source.message.trim() : ''
  return messageIsOpaque(value) ? '' : value
}

function errorDetails(error: unknown) {
  const source = recordOf(error)
  const direct = recordValue(source.details)
  const custom = recordValue(source.customData)
  const nested = recordValue(custom.details)
  return Object.keys(direct).length > 0 ? direct : nested
}

function operationFallback(operation: IdentityAccessOperation, code: string) {
  if (operation === 'suspend') {
    if (code === 'deadline-exceeded') return 'Thao tác khóa tài khoản phản hồi quá thời gian. Hãy tải lại danh sách để kiểm tra trạng thái rồi thử lại nếu cần.'
    return 'Chưa thể xác nhận hoàn tất khóa tài khoản và thu hồi phiên đăng nhập. Hãy tải lại danh sách và thử khóa lại để hoàn tất đồng bộ.'
  }
  if (operation === 'restore') {
    if (code === 'deadline-exceeded') return 'Thao tác kích hoạt phản hồi quá thời gian. Hãy tải lại danh sách để kiểm tra trạng thái rồi thử lại nếu cần.'
    return 'Chưa thể xác nhận hoàn tất kích hoạt tài khoản. Hãy tải lại danh sách và thử kích hoạt lại để hoàn tất đồng bộ.'
  }
  if (operation === 'assign') return code === 'deadline-exceeded'
    ? 'Cập nhật quyền phản hồi quá thời gian. Hãy tải lại danh sách trước khi thử lại.'
    : 'Dịch vụ quyền tài khoản đang gián đoạn. Hãy tải lại danh sách trước khi thử lại.'
  if (operation === 'delete') return 'Dịch vụ tài khoản đang gián đoạn. Hãy tải lại danh sách rồi thử lại.'
  if (operation === 'invite') return 'Chưa nhận được kết quả tạo tài khoản. Tài khoản có thể đã được tạo; hãy tải lại danh sách và kiểm tra email hoặc số điện thoại trước khi thử lại.'
  if (operation === 'profile') return 'Chưa nhận được kết quả lưu hồ sơ. Hãy tải lại danh sách để kiểm tra thông tin trước khi thử lại.'
  return code === 'deadline-exceeded'
    ? 'Dịch vụ tài khoản phản hồi quá thời gian. Hãy thử lại sau ít phút.'
    : 'Dịch vụ tài khoản đang gián đoạn. Hãy thử lại sau ít phút.'
}

/** Convert callable transport errors into safe, operation-specific UI text. */
export function presentIdentityAccessError(error: unknown, operation: IdentityAccessOperation = 'generic') {
  const source = recordOf(error)
  const code = normalizeCode(source.code)
  const details = errorDetails(error)
  const detailCode = typeof details.errorCode === 'string' ? details.errorCode : ''
  const message = meaningfulMessage(error)

  if (detailCode === 'ACCESS_AUTH_SYNC_PENDING') {
    return new Error(operation === 'suspend'
      ? 'Quyền Aura đã được khóa, nhưng chưa xác nhận việc thu hồi phiên đăng nhập. Hãy thử khóa lại để hoàn tất, kể cả khi danh sách đã hiển thị “Đã khóa”.'
      : 'Quyền Aura đã thay đổi, nhưng chưa xác nhận đồng bộ phiên đăng nhập. Hãy tải lại danh sách rồi thử lại nếu cần.')
  }
  if (code === 'already-exists') return new Error('Số điện thoại hoặc email này đã được dùng cho một tài khoản Aura khác.')
  if (code === 'permission-denied') return new Error(message || 'Bạn chưa có quyền thực hiện thao tác này trong phạm vi hiện tại.')
  if (code === 'unauthenticated') return new Error('Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại rồi thử lại.')
  if (code === 'invalid-argument' || code === 'failed-precondition' || code === 'not-found' || code === 'aborted') {
    return new Error(message || (code === 'aborted'
      ? 'Quyền tài khoản vừa thay đổi. Hãy tải lại danh sách trước khi tiếp tục.'
      : 'Thông tin tài khoản chưa hợp lệ hoặc không còn tồn tại.'))
  }
  if (code === 'internal' || code === 'unavailable' || code === 'resource-exhausted' || code === 'deadline-exceeded') {
    return new Error(operationFallback(operation, code))
  }
  if (message) return new Error(message)
  if (error instanceof Error && !messageIsOpaque(error.message.trim())) return error
  return new Error(operationFallback(operation, code))
}

export type { IdentityAccessOperation }
