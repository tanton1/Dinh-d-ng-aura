export interface CallableErrorShape {
  code?: unknown
  message?: unknown
  status?: unknown
  customData?: unknown
}

export interface ReadOnlyRetryOptions {
  maximumAttempts?: number
  baseDelayMs?: number
  signal?: AbortSignal
  refreshAuth?: () => Promise<unknown>
  sleep?: (milliseconds: number) => Promise<void>
  random?: () => number
  onFinalFailure?: (error: unknown, context: { attempts: number; retryable: boolean; code: string }) => void
}

const transientCodes = new Set([
  'internal',
  'unavailable',
  'resource-exhausted',
  'deadline-exceeded',
  'unknown',
])

export function callableCode(error: unknown) {
  if (!error || typeof error !== 'object') return ''
  const value = (error as CallableErrorShape).code
  return typeof value === 'string' ? value.replace(/^functions\//, '').toLowerCase() : ''
}

export function callableMessage(error: unknown) {
  if (error instanceof Error) return error.message.trim()
  if (!error || typeof error !== 'object') return typeof error === 'string' ? error.trim() : ''
  const value = (error as CallableErrorShape).message
  return typeof value === 'string' ? value.trim() : ''
}

export function isRetryableReadOnlyCallableError(error: unknown) {
  const code = callableCode(error)
  if (transientCodes.has(code)) return true
  const message = callableMessage(error)
  return /(?:rate exceeded|too many requests|\b429\b|\b500\b|\b502\b|\b503\b|network(?: request)? failed|failed to fetch|load failed)/i.test(message)
}

export function friendlyReadOnlyCallableMessage(error: unknown) {
  const code = callableCode(error)
  const raw = callableMessage(error)
  if (code === 'unauthenticated') return 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.'
  if (code === 'permission-denied') return 'Tài khoản chưa có quyền xem dữ liệu này hoặc phạm vi chi nhánh chưa được đồng bộ.'
  if (code === 'not-found') return raw || 'Không tìm thấy dữ liệu cần xem.'
  if (code === 'resource-exhausted' || /rate exceeded|too many requests|\b429\b/i.test(raw)) {
    return 'Hệ thống Aura đang có nhiều lượt truy cập. Dữ liệu không bị thay đổi; vui lòng thử lại sau ít phút.'
  }
  if (isRetryableReadOnlyCallableError(error)) {
    return 'Dịch vụ Aura tạm gián đoạn. Hệ thống đã tự thử kết nối lại và dữ liệu không bị thay đổi; vui lòng tải lại sau ít phút.'
  }
  if (!raw || /^(?:firebase:\s*)?(?:functions\/)?(?:internal|unknown|error)(?:\s*\(functions\/(?:internal|unknown)\))?\.?$/i.test(raw)) {
    return 'Không thể tải dữ liệu lúc này. Mã lỗi đã được gửi để Aura đối soát.'
  }
  return raw
}

function abortError() {
  if (typeof DOMException !== 'undefined') return new DOMException('Yêu cầu đã được hủy.', 'AbortError')
  const error = new Error('Yêu cầu đã được hủy.')
  error.name = 'AbortError'
  return error
}

function defaultSleep(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds))
}

export async function runReadOnlyWithRetry<Output>(invoke: () => Promise<Output>, options: ReadOnlyRetryOptions = {}) {
  const maximumAttempts = Math.max(1, Math.min(4, options.maximumAttempts ?? 3))
  const baseDelayMs = Math.max(0, options.baseDelayMs ?? 300)
  const sleep = options.sleep ?? defaultSleep
  const random = options.random ?? Math.random
  let refreshedAuth = false
  let lastError: unknown = null

  for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
    if (options.signal?.aborted) throw abortError()
    try {
      const result = await invoke()
      if (options.signal?.aborted) throw abortError()
      return result
    } catch (error) {
      if ((error as { name?: unknown })?.name === 'AbortError') throw error
      lastError = error
      const code = callableCode(error)
      if (code === 'unauthenticated' && !refreshedAuth && options.refreshAuth && attempt < maximumAttempts) {
        refreshedAuth = true
        await options.refreshAuth()
        continue
      }
      const retryable = isRetryableReadOnlyCallableError(error)
      if (!retryable || attempt >= maximumAttempts) {
        options.onFinalFailure?.(error, { attempts: attempt, retryable, code })
        throw new Error(friendlyReadOnlyCallableMessage(error), { cause: error })
      }
      const jitter = 0.75 + Math.max(0, Math.min(1, random())) * 0.5
      await sleep(Math.round(baseDelayMs * (2 ** (attempt - 1)) * jitter))
    }
  }

  throw new Error(friendlyReadOnlyCallableMessage(lastError), { cause: lastError })
}
