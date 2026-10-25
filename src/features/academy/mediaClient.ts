import { createAcademySessionCache } from './sessionCache'

export interface AcademyMediaContext {
  ownerId?: string
  accessRevision?: string
  chapterVersion?: string
  courseRevision?: number
  authoringPreview?: boolean
}
export interface AcademyMediaInput extends AcademyMediaContext { courseId: string; lessonId: string; storagePath: string }
export interface AcademyMediaLease { url: string; downloadUrl?: string; fileName?: string; contentType?: string; expiresAt: number }
const fail = (message: string, code = 'functions/failed-precondition'): never => { throw Object.assign(new Error(message), { code }) }

export function createAcademyMediaClient(options: {
  session: () => (object & { uid: string }) | null
  read: (payload: Record<string, unknown>, accessRevision: string) => Promise<unknown>
  safeUrl: (value: unknown) => string | null
  now?: () => number
}) {
  const now = options.now ?? Date.now
  // A server lease lasts five minutes. Revalidate before it expires, never
  // persist bearer links, and bound both cross-resource memory and entry count.
  const cache = createAcademySessionCache<AcademyMediaLease>({ ttlMs: 270_000, maxEntries: 24, maxBytes: 256 * 1024, now })
  const load = async (input: AcademyMediaInput): Promise<AcademyMediaLease> => {
    const owner = options.session()
    if (!owner || (input.ownerId && owner.uid !== input.ownerId)) return fail('Phiên đăng nhập đã thay đổi.', 'functions/unauthenticated')
    const access = input.accessRevision ?? ''
    cache.setScope(owner, access)
    if (!input.courseId || !input.lessonId || !input.storagePath.startsWith(`course-media/${input.courseId}/${input.lessonId}/`)) return fail('Đường dẫn media không thuộc bài học hiện tại.')
    const payload = { courseId: input.courseId, lessonId: input.lessonId, path: input.storagePath,
      ...(input.chapterVersion ? { chapterVersion: input.chapterVersion } : {}),
      ...(input.courseRevision !== undefined ? { courseRevision: input.courseRevision } : {}),
      ...(input.authoringPreview ? { authoringPreview: true } : {}) }
    const key = JSON.stringify(payload)
    const ready = cache.peek(key)
    if (ready && ready.value.expiresAt <= now() + 30_000) cache.remove(key)
    try {
      const { value } = await cache.read(key, async () => {
        if (options.session() !== owner) return fail('Phiên học đã thay đổi.', 'functions/unauthenticated')
        const raw = await options.read(payload, access)
        if (options.session() !== owner) return fail('Phiên học đã thay đổi.', 'functions/unauthenticated')
        if (!raw || typeof raw !== 'object') return fail('Phản hồi media chưa đầy đủ.')
        const data = raw as Record<string, unknown>
        if (data.path !== input.storagePath) return fail('Phản hồi media không khớp tài nguyên đã chọn.')
        if (input.chapterVersion || input.courseRevision !== undefined || input.authoringPreview) {
          if (data.courseId !== input.courseId || data.lessonId !== input.lessonId
              || (data.chapterVersion ?? null) !== (input.chapterVersion ?? null)
              || !Number.isSafeInteger(data.courseRevision)
              || Number(data.courseRevision) < (input.courseRevision ?? 0)
              || ((!input.chapterVersion || input.authoringPreview) && input.courseRevision !== undefined && data.courseRevision !== input.courseRevision)
              || (input.authoringPreview ? data.contentAccess !== 'staff-preview' : !['full', 'preview'].includes(String(data.contentAccess)))) {
            return fail('Chương đã thay đổi. Hãy tải lại chương để mở đúng media.', 'functions/aborted')
          }
        }
        const url = options.safeUrl(data.url)
        const expiresAt = typeof data.expiresAt === 'string' ? Date.parse(data.expiresAt) : data.expiresAt
        if (!url || typeof expiresAt !== 'number' || !Number.isFinite(expiresAt) || expiresAt <= now() + 30_000) return fail('Liên kết media không hợp lệ hoặc sắp hết hạn. Hãy thử lại.')
        const downloadUrl = options.safeUrl(data.downloadUrl)
        return { url, expiresAt,
          ...(downloadUrl ? { downloadUrl } : {}),
          ...(typeof data.fileName === 'string' && data.fileName.trim() ? { fileName: data.fileName.trim() } : {}),
          ...(typeof data.contentType === 'string' ? { contentType: data.contentType } : {}) }
      })
      return value
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error ? String(error.code).replace(/^functions\//, '') : ''
      if (cache.matchesScope(owner, access) && options.session() === owner
          && ['permission-denied', 'unauthenticated', 'aborted', 'not-found', 'failed-precondition'].includes(code)) cache.clear()
      throw error
    }
  }
  return { load, clear: cache.clear }
}
