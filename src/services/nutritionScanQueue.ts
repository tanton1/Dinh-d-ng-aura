export type FoodScanQueueStatus = 'uploading' | 'queued' | 'processing'

export interface PendingFoodScan {
  ownerUid: string
  fingerprint: string
  createdAt: number
  upload: { scanId: string; storagePath: string; contentType: 'image/jpeg' | 'image/png' | 'image/webp'; size: number }
  mealType: 'breakfast' | 'lunch' | 'dinner' | 'snack' | 'other'
  mealDate?: string
  mealTime?: string
}

const storageKey = (ownerUid: string) => `aura:pending-food-scan:v1:${encodeURIComponent(ownerUid)}`
const memory = new Map<string, PendingFoodScan>()
export function readPendingFoodScan(ownerUid: string): PendingFoodScan | null {
  let value: PendingFoodScan | undefined
  try { value = JSON.parse(localStorage.getItem(storageKey(ownerUid)) || 'null') || memory.get(ownerUid) } catch { value = memory.get(ownerUid) }
  if (!value || value.ownerUid !== ownerUid || !/^[A-Za-z0-9_-]{8,80}$/.test(value.upload?.scanId || '')
    || !value.upload.storagePath?.startsWith(`nutrition-scans/${ownerUid}/${value.upload.scanId}/`)
    || Date.now() - value.createdAt > 7 * 86_400_000) return null
  return value
}
export function rememberPendingFoodScan(value: PendingFoodScan) {
  memory.set(value.ownerUid, value)
  // Only request identifiers, a hash, and meal date/type are stored here.
  // Photos, health context, notes, results and credentials stay off this key.
  try { localStorage.setItem(storageKey(value.ownerUid), JSON.stringify(value)) } catch { /* memory still supports a same-page retry */ }
}
export function clearPendingFoodScan(ownerUid: string, scanId?: string) {
  if (scanId && readPendingFoodScan(ownerUid)?.upload.scanId !== scanId) return
  memory.delete(ownerUid)
  try { localStorage.removeItem(storageKey(ownerUid)) } catch { /* storage may be blocked */ }
}

export async function foodScanFingerprint(image: Blob, context: unknown) {
  const imageBytes = new Uint8Array(await image.arrayBuffer())
  const contextBytes = new TextEncoder().encode(JSON.stringify(context))
  const input = new Uint8Array(imageBytes.length + contextBytes.length + 1)
  input.set(imageBytes)
  input.set(contextBytes, imageBytes.length + 1)
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', input)), byte => byte.toString(16).padStart(2, '0')).join('')
}

export interface ScanJobSnapshot {
  exists: boolean
  fromCache?: boolean
  data?: { status?: string; response?: unknown; error?: { code?: string; message?: string; kind?: string } }
}
const queueError = (code: string, message: string, kind?: string) => Object.assign(new Error(message), { code, details: { kind } })

/** One document listener, no periodic callable/read loop. A timeout only stops
 * observing; the server job and persisted request ID survive navigation. */
export function waitForFoodScanJob<T>({ ownerUid, currentOwnerUid, subscribe, subscribeOwner, signal, onStatus, timeoutMs = 16 * 60_000 }: {
  ownerUid: string
  currentOwnerUid: () => string | undefined
  subscribe: (next: (snapshot: ScanJobSnapshot) => void, error: (error: unknown) => void) => () => void
  subscribeOwner?: (changed: () => void) => () => void
  signal?: AbortSignal
  onStatus?: (status: FoodScanQueueStatus) => void
  timeoutMs?: number
}): Promise<T> {
  return new Promise((resolve, reject) => {
    let done = false
    let unsubscribe = () => {}
    let unsubscribeOwner = () => {}
    let timeout: ReturnType<typeof setTimeout> | undefined
    const finish = (error?: unknown, result?: T) => {
      if (done) return
      done = true
      unsubscribe()
      unsubscribeOwner()
      clearTimeout(timeout)
      signal?.removeEventListener('abort', abort)
      if (error) reject(error)
      else resolve(result as T)
    }
    const abort = () => finish(new DOMException('Đã ngừng theo dõi ảnh; yêu cầu vẫn được lưu.', 'AbortError'))
    const checkOwner = () => {
      if (currentOwnerUid() === ownerUid) return true
      finish(queueError('permission-denied', 'Tài khoản đã thay đổi. Vui lòng mở lại ảnh từ tài khoản đã gửi.'))
      return false
    }
    if (signal?.aborted) return abort()
    if (!checkOwner()) return
    signal?.addEventListener('abort', abort, { once: true })
    timeout = setTimeout(() => finish(queueError('deadline-exceeded', 'Ảnh vẫn được lưu trên máy chủ. Hãy mở lại trang để kiểm tra cùng yêu cầu này.')), timeoutMs)
    try {
      unsubscribeOwner = subscribeOwner?.(checkOwner) || (() => {})
      if (!done) unsubscribe = subscribe(snapshot => {
        if (done || !checkOwner()) return
        if (!snapshot.exists) {
          if (!snapshot.fromCache) finish(queueError('not-found', 'Ảnh chưa được đưa vào hàng đợi. Hãy chọn lại chính ảnh này để tiếp tục.'))
          return
        }
        const job = snapshot.data
        if (job?.status === 'completed') finish(undefined, job.response as T)
        else if (job?.status === 'failed') finish(queueError(job.error?.code || 'internal', job.error?.message || 'Không thể phân tích ảnh này.', job.error?.kind))
        else if (job?.status === 'queued' || job?.status === 'processing') onStatus?.(job.status)
      }, error => finish(error))
      // Test adapters and cache listeners may deliver synchronously.
      if (done) { unsubscribe(); unsubscribeOwner() }
    } catch (error) { finish(error) }
  })
}
