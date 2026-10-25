import { createAcademySessionCache } from './sessionCache'
import { academyChapterCacheKey, academyChapterRequest, validateAcademyChapter, type AcademyChapterAccess } from './chapterDelivery'
import type { Course, CourseModuleDraft } from '../../types'

export const ACADEMY_CHAPTER_CACHE_TTL = 5 * 60_000
type Session = object & { uid: string }
export function createAcademyChapterClient(options: {
  session: () => Session | null; read: (payload: Record<string, unknown>, accessRevision: string) => Promise<unknown>; now?: () => number; ttlMs?: number
}) {
  const cache = createAcademySessionCache<CourseModuleDraft>({ ttlMs: options.ttlMs ?? ACADEMY_CHAPTER_CACHE_TTL,
    maxEntries: 24, maxBytes: 8 * 1024 * 1024, now: options.now })
  function scope(ownerId: string, accessRevision: string) {
    const user = options.session()
    const authorized = user?.uid === ownerId ? user : null
    cache.setScope(authorized, accessRevision)
    return authorized
  }
  const peek = (ownerId: string, accessRevision: string, course: Course, module: CourseModuleDraft, access: AcademyChapterAccess) => {
    if (!scope(ownerId, accessRevision)) return undefined
    return cache.peek(academyChapterCacheKey(course, module, access))
  }
  const load = async (ownerId: string, accessRevision: string, course: Course, module: CourseModuleDraft, lessonId: string, access: AcademyChapterAccess) => {
    const user = scope(ownerId, accessRevision)
    if (!user) throw Object.assign(new Error('Phiên đăng nhập đã thay đổi. Hãy đăng nhập lại.'), { code: 'functions/unauthenticated' })
    const input = academyChapterRequest(course, module, lessonId, access)
    const payload = { courseId: input.courseId, lessonId, courseRevision: input.courseRevision,
      ...(input.chapterVersion ? { chapterVersion: input.chapterVersion } : {}),
      ...(access === 'staff-preview' ? { authoringChapter: true } : { chapter: true }) }
    try {
      return await cache.read(academyChapterCacheKey(course, module, access), async () => {
        if (options.session() !== user) throw Object.assign(new Error('Phiên học đã thay đổi.'), { code: 'functions/unauthenticated' })
        const response = await options.read(payload, accessRevision)
        if (options.session() !== user) throw Object.assign(new Error('Phiên học đã thay đổi.'), { code: 'functions/unauthenticated' })
        return validateAcademyChapter(response, input, module)
      })
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error ? String(error.code).replace(/^functions\//, '') : ''
      if (cache.matchesScope(user, accessRevision) && options.session() === user
          && ['unauthenticated', 'permission-denied', 'aborted', 'not-found', 'failed-precondition'].includes(code)) cache.clear()
      throw error
    }
  }
  return { load, peek, clear: cache.clear }
}
