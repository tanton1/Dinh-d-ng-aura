export interface ContentAiReceiptResponse<T> {
  action: string
  data: T
  receipt: { schemaVersion: 1; requestId: string; status: 'completed' }
}

export interface ContentAiRequestOptions {
  ownerUid: string
  currentOwnerUid: () => string | undefined
  storageKey: string
  defaultRequestId: string
  storage?: Pick<Storage, 'getItem' | 'setItem'>
  newDraft?: boolean
  now?: () => number
  nonce?: () => string
  wait?: (milliseconds: number) => Promise<void>
}

interface SavedRequest {
  schemaVersion: 1
  ownerUid: string
  requestId: string
  state: 'pending' | 'completed' | 'unclaimed'
  createdAt: number
}

const RETENTION_MS = 7 * 24 * 60 * 60 * 1000
const requestIdPattern = /^[A-Za-z0-9_-]{8,120}$/
const memory = new Map<string, SavedRequest>()
const errorInfo = (error: unknown) => error as { code?: string; details?: { kind?: string; requestId?: string; retryAfterMs?: number; maxPollAttempts?: number } }
const cancelled = () => Object.assign(new Error('Tài khoản đã thay đổi. Hãy mở lại tác vụ AI.'), { code: 'cancelled' })

// Stores identifiers only, never prompts or generated content. Every recovery
// request uses an action that older servers reject before contacting AI.
export async function runContentAiRequest<T>(action: string, payload: Record<string, unknown>,
  invoke: (input: Record<string, unknown>) => Promise<ContentAiReceiptResponse<T>>, options: ContentAiRequestOptions,
): Promise<T & { generationId: string }> {
  const now = options.now ?? Date.now
  const assertOwner = () => { if (!options.ownerUid || options.currentOwnerUid() !== options.ownerUid) throw cancelled() }
  const wait = options.wait ?? (milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)))
  assertOwner()
  let saved = memory.get(options.storageKey)
  let raw: string | null | undefined
  try { raw = options.storage?.getItem(options.storageKey) } catch { /* Storage access may be blocked; retain the deterministic default identity. */ }
  if (raw !== null && raw !== undefined) {
    try {
      const parsed = JSON.parse(raw) as SavedRequest | null
      if (!parsed || Array.isArray(parsed) || parsed.schemaVersion !== 1 || parsed.ownerUid !== options.ownerUid
        || !['pending', 'completed', 'unclaimed'].includes(parsed.state) || !Number.isFinite(parsed.createdAt) || parsed.createdAt <= 0
        || typeof parsed.requestId !== 'string' || !requestIdPattern.test(parsed.requestId)) throw new Error('Invalid saved request')
      saved = parsed
    } catch {
      // Corrupt JSON, including null or a missing identity, must not silently
      // become another paid job. Only an explicit new draft can replace it.
      if (!options.newDraft) throw new Error('Chưa đọc được yêu cầu AI trước. Chọn “Tạo bản khác” nếu bạn muốn gửi yêu cầu mới.')
    }
  }
  if (saved?.ownerUid !== options.ownerUid) saved = undefined
  const fresh = !saved || options.newDraft === true
  const record: SavedRequest = !saved || options.newDraft === true
    ? { schemaVersion: 1, ownerUid: options.ownerUid, state: 'pending', createdAt: now(),
      requestId: options.newDraft ? `content_${(options.nonce ?? (() => crypto.randomUUID().replaceAll('-', '')))()}` : options.defaultRequestId }
    : { ...saved }
  if (typeof record.requestId !== 'string' || !requestIdPattern.test(record.requestId)) throw new Error('Mã bản AI mới không hợp lệ.')
  const persist = (requireDurable = false) => {
    assertOwner()
    let durable = false
    try { if (options.storage) { options.storage.setItem(options.storageKey, JSON.stringify(record)); durable = true } } catch { /* Default requests retain the deterministic server identity. */ }
    if (requireDurable && !durable) throw new Error('Thiết bị chưa lưu được mã yêu cầu. Bật lưu trữ trình duyệt trước khi tạo bản AI khác.')
    memory.set(options.storageKey, { ...record })
  }
  let checking = !fresh && (record.state !== 'unclaimed' || now() - record.createdAt >= RETENTION_MS)
  if (!checking) record.state = 'pending'
  persist(options.newDraft === true)
  let remainingPolls = 12
  for (;;) {
    assertOwner()
    const input = { action: checking ? 'request-status' : action,
      ...(checking ? { targetAction: action } : {}), payload,
      requestId: record.requestId, expectedOwnerUid: options.ownerUid }
    try {
      const response = await invoke(input)
      assertOwner()
      if (response?.action !== action || response.receipt?.schemaVersion !== 1 || response.receipt.status !== 'completed'
        || response.receipt.requestId !== record.requestId
        || response.data === null || typeof response.data !== 'object' || Array.isArray(response.data)) {
        throw Object.assign(new Error('Dịch vụ AI chưa trả về kết quả có thể khôi phục. Hãy kiểm tra lại yêu cầu trước.'), { code: 'content-protocol-mismatch' })
      }
      record.requestId = response.receipt.requestId
      record.state = 'completed'
      persist()
      return { ...response.data, generationId: response.receipt.requestId }
    } catch (error) {
      assertOwner()
      const details = errorInfo(error)?.details, code = errorInfo(error)?.code?.replace(/^functions\//, '')
      if (details?.kind === 'content_ai_not_started') {
        if (record.state === 'completed') {
          throw new Error('Kết quả AI đã lưu không còn khả dụng. Chọn “Tạo bản khác” để gửi một yêu cầu mới.')
        }
        if (now() - record.createdAt >= RETENTION_MS) {
          throw new Error('Yêu cầu AI trước đã hết thời gian lưu. Chọn “Tạo bản khác” để gửi một yêu cầu mới.')
        }
        if (details.requestId !== record.requestId) throw new Error('Dịch vụ AI trả về mã yêu cầu khác. Hãy kiểm tra lại yêu cầu trước.')
        record.state = 'unclaimed'
        persist()
        throw new Error('Yêu cầu AI trước chưa bắt đầu. Bấm tạo bằng AI lần nữa để gửi lại cùng yêu cầu.')
      }
      if (details?.kind === 'content_ai_processing') {
        if (Number.isFinite(details.maxPollAttempts)) remainingPolls = Math.min(remainingPolls, Math.max(0, Math.floor(details.maxPollAttempts!)))
        if (remainingPolls-- <= 0) throw error
        checking = true
        await wait(Math.min(5_000, Math.max(1_000, Number(details.retryAfterMs) || 1_500)))
        continue
      }
      if (!checking && ['unavailable', 'deadline-exceeded', 'internal'].includes(code || '')) {
        // A timeout can occur after success. Only read status; never repeat
        // the generating action automatically or route it to another region.
        checking = true
        continue
      }
      throw error
    }
  }
}
