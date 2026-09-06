import { callableCode, callableMessage, friendlyReadOnlyCallableMessage } from '../../services/readOnlyCallableCore'

export function courseLoadErrorMessage(error: unknown) {
  const cause = error instanceof Error && error.cause ? error.cause : error
  const code = callableCode(cause)
  const raw = callableMessage(cause)
  if (code === 'unauthenticated') return 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại để mở khóa học.'
  if (code === 'permission-denied') return 'Tài khoản hiện chưa có quyền mở khóa học này. Hãy liên hệ Aura để kiểm tra ghi danh.'
  if (['internal', 'unavailable', 'deadline-exceeded', 'resource-exhausted', 'unknown'].includes(code)
      || /^(internal|unknown)$/i.test(raw) || /429|503|Failed to fetch|network/i.test(raw)) {
    return 'Dịch vụ khóa học Aura đang tạm gián đoạn hoặc quá tải. Đây là lỗi kết nối, không có nghĩa giáo trình đã bị xóa. Vui lòng thử lại sau ít phút.'
  }
  return friendlyReadOnlyCallableMessage(error)
}
