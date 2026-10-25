import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Course, CourseLessonDraft, CourseModuleDraft } from '../../types'
import { getCourseModules } from '../../utils/courseContent'
import { academyChapterCacheKey, type AcademyChapterAccess } from './chapterDelivery'
import { loadAcademyChapter, peekAcademyChapter, clearAcademyChapterCache } from '../../services/academyChapterService'
import { useAcademySessionEpoch } from './useAcademySessionEpoch'
import { callableCode } from '../../services/readOnlyCallableCore'

const millis = (value: unknown): number | null => {
  if (value && typeof value === 'object' && 'toMillis' in value && typeof value.toMillis === 'function') return value.toMillis()
  const n = value instanceof Date ? value.getTime() : typeof value === 'number' ? value : typeof value === 'string' ? Date.parse(value) : NaN
  return Number.isFinite(n) ? n : null
}
export function useAcademyChapterDelivery(input: {
  course?: Course; lessonId?: string | null; lastLessonId?: string; ownerId: string; accessRevision: string;
  enrolled: boolean; enrolledAt?: unknown; accessLocked: boolean; previewMode: boolean; demoMode: boolean;
  loading: boolean; accessError?: string | null; onRefreshCatalog?: () => void
}) {
  const { course, ownerId, accessRevision, onRefreshCatalog } = input
  const sessionEpoch = useAcademySessionEpoch()
  const [, setTick] = useState(0)
  const [attempt, setAttempt] = useState(0)
  const [readState, setReadState] = useState<{ key: string; error?: unknown }>({ key: '' })
  const active = useRef('')
  const modules = useMemo(() => course ? getCourseModules(course, input.demoMode) : [], [course, input.demoMode])
  const lessons = useMemo(() => modules.flatMap((module) => module.lessons), [modules])
  const requested = lessons.find((lesson) => lesson.id === input.lessonId)
    ?? lessons.find((lesson) => lesson.id === input.lastLessonId) ?? lessons[0]
  const selectedIndex = modules.findIndex((module) => module.lessons.some((lesson) => lesson.id === requested?.id))
  const metadata = modules[selectedIndex]
  const aura = modules.length === 20 && modules.every((module) => module.id.startsWith('nutrition-chapter-'))
  const selected = aura ? metadata?.lessons.find((lesson) => lesson.id.endsWith('-core')) ?? requested : requested
  const usesDelivery = !input.demoMode && course?.contentDelivery === 'catalog'
  const enrolledAt = millis(input.enrolledAt)
  useEffect(() => {
    if (!input.enrolled || input.previewMode || course?.settings?.dripSchedule !== 'weekly' || enrolledAt === null) return
    const next = modules.map((_, index) => enrolledAt + index * 7 * 86_400_000).find((time) => time > Date.now())
    if (!next) return
    const timer = window.setTimeout(() => setAttempt((value) => value + 1), Math.min(2_147_000_000, Math.max(25, next - Date.now() + 1)))
    return () => window.clearTimeout(timer)
  }, [input.enrolled, input.previewMode, course?.settings?.dripSchedule, enrolledAt, modules, attempt])
  const accessFor = useCallback((module: CourseModuleDraft, lesson: CourseLessonDraft): AcademyChapterAccess | null => {
    if (input.accessError) return null
    if (input.previewMode) return 'staff-preview'
    const index = modules.findIndex((item) => item.id === module.id)
    const dripLocked = course?.settings?.dripSchedule === 'weekly' && index > 0
      && (enrolledAt === null || Date.now() < enrolledAt + index * 7 * 86_400_000)
    if (input.enrolled && !input.accessLocked && !dripLocked) return 'full'
    return lesson.preview && course?.settings?.visibility === 'members' ? 'preview' : null
  }, [course?.settings?.dripSchedule, course?.settings?.visibility, enrolledAt, input.accessError, input.accessLocked, input.enrolled, input.previewMode, modules])
  const access = metadata && selected ? accessFor(metadata, selected) : null
  const requestKey = usesDelivery && course && metadata && selected && access
    ? JSON.stringify([ownerId, accessRevision, sessionEpoch, academyChapterCacheKey(course, metadata, access)]) : ''
  active.current = requestKey
  useEffect(() => {
    active.current = requestKey
    return () => { if (active.current === requestKey) active.current = '' }
  }, [requestKey])
  const cached = requestKey && course && metadata && access ? peekAcademyChapter(ownerId, accessRevision, course, metadata, access) : undefined
  const refreshRef = useRef(onRefreshCatalog)
  refreshRef.current = onRefreshCatalog
  const refreshedFailure = useRef('')
  useEffect(() => {
    if (!usesDelivery || input.loading || !requestKey || !course || !metadata || !selected || !access) return
    let current = true
    setReadState({ key: requestKey })
    void loadAcademyChapter(ownerId, accessRevision, course, metadata, selected.id, access).then(() => {
      if (current && active.current === requestKey) { refreshedFailure.current = ''; setTick((value) => value + 1) }
    }).catch((error) => {
      if (!current || active.current !== requestKey) return
      setReadState({ key: requestKey, error })
      if (['aborted', 'permission-denied', 'not-found', 'failed-precondition'].includes(callableCode(error)) && refreshedFailure.current !== requestKey) {
        refreshedFailure.current = requestKey
        refreshRef.current?.()
      }
    })
    return () => { current = false }
    // The exact cache key binds version, access and session. Catalog object
    // replacement or unrelated progress updates must not restart this read.
  }, [requestKey, input.loading, attempt])
  const retry = useCallback(() => {
    clearAcademyChapterCache(); setReadState({ key: requestKey }); setAttempt((value) => value + 1)
    if (input.accessError || (readState.error && ['aborted', 'permission-denied', 'not-found', 'failed-precondition'].includes(callableCode(readState.error)))) refreshRef.current?.()
  }, [requestKey, readState.error, input.accessError])
  const cacheEntries = modules.map((module) => {
    if (!usesDelivery || !course) return undefined
    // A preview may be the second lesson, not the module's first/core lesson.
    // The server projection still keeps every non-preview lesson metadata-only.
    const lesson = module.lessons.find((item) => accessFor(module, item) !== null)
    const scope = lesson && accessFor(module, lesson)
    return scope ? peekAcademyChapter(ownerId, accessRevision, course, module, scope) : undefined
  })
  const nextExpiry = Math.min(...cacheEntries.flatMap((entry) => entry ? [entry.expiresAt] : []))
  useEffect(() => {
    if (!usesDelivery || !Number.isFinite(nextExpiry) || input.loading) return
    // Expired portfolio/review definitions must disappear too, not just the
    // selected chapter. No background prefetch of those other chapters.
    const timer = window.setTimeout(() => { setReadState({ key: requestKey }); setAttempt((value) => value + 1) }, Math.max(25, nextExpiry - Date.now() + 1))
    return () => window.clearTimeout(timer)
  }, [usesDelivery, nextExpiry, input.loading, requestKey])
  const cachedModules = cacheEntries.map((entry) => entry?.value)
  const deliveredModules = modules.map((module, index) => cachedModules[index] ?? module)
  const loadedLessons = usesDelivery ? cachedModules.flatMap((module) => module?.lessons ?? []) : lessons
  const prepareReferenced = useCallback(async (lessonIds: string[]) => {
    if (!course || !usesDelivery) return lessons
    const expected = active.current
    const needed = modules.filter((module) => module.lessons.some((lesson) => lessonIds.includes(lesson.id)))
    if (lessonIds.some((id) => !needed.some((module) => module.lessons.some((lesson) => lesson.id === id)))) {
      throw new Error('Danh mục chưa có đủ chương cần đối chiếu. Hãy tải lại khóa học.')
    }
    const result: CourseLessonDraft[] = []
    // Explicit due-review or five-chapter portfolio only, two reads at a time.
    try { for (let index = 0; index < needed.length; index += 2) {
      if (active.current !== expected) throw Object.assign(new Error('Chương hoặc phiên học đã đổi. Hãy mở lại phần cần đối chiếu.'), { code: 'academy/cache-scope-changed' })
      const batch = await Promise.all(needed.slice(index, index + 2).map(async (module) => {
        const lesson = module.lessons.find((item) => lessonIds.includes(item.id))!
        if (accessFor(module, lesson) !== 'full') throw new Error('Có chương cần đối chiếu chưa được mở cho tài khoản này. Hãy kiểm tra thời điểm mở chương và quyền ghi danh.')
        return (await loadAcademyChapter(ownerId, accessRevision, course, module, lesson.id, 'full')).value.lessons
      }))
      if (active.current !== expected) throw Object.assign(new Error('Chương hoặc phiên học đã đổi. Hãy mở lại hàng đợi ôn.'), { code: 'academy/cache-scope-changed' })
      result.push(...batch.flat())
    }
      // A long queue can exceed the bounded LRU. Keep the selected chapter
      // deliverable even if it was evicted while collecting the due chapters.
      if (metadata && selected && access && !peekAcademyChapter(ownerId, accessRevision, course, metadata, access)) {
        await loadAcademyChapter(ownerId, accessRevision, course, metadata, selected.id, access)
        if (active.current !== expected) throw Object.assign(new Error('Phiên học đã thay đổi.'), { code: 'academy/cache-scope-changed' })
      }
    } catch (error) {
      if (active.current === expected) {
        // A transient queue failure must not hide the chapter already being read.
        // Permission/version failures invalidate the shared cache and require a
        // catalog refresh, just like a failure of the selected chapter itself.
        if (['unauthenticated', 'aborted', 'permission-denied', 'not-found', 'failed-precondition'].includes(callableCode(error))) {
          setReadState({ key: expected, error })
          if (refreshedFailure.current !== expected) { refreshedFailure.current = expected; refreshRef.current?.() }
        }
        setTick((value) => value + 1)
      }
      throw error
    }
    setTick((value) => value + 1)
    return result
  }, [course, usesDelivery, lessons, modules, ownerId, accessRevision, accessFor, metadata, selected, access])
  const preparePortfolio = useCallback(async (chapter: 5 | 10 | 15 | 20) => {
    if (![5, 10, 15, 20].includes(chapter)) throw new Error('Chặng portfolio không hợp lệ.')
    return prepareReferenced(Array.from({ length: 5 }, (_, index) => `chapter-${String(chapter - 4 + index).padStart(2, '0')}-core`))
  }, [prepareReferenced])
  return {
    course: usesDelivery && course ? { ...course, modules: deliveredModules } : course,
    loading: Boolean(requestKey && !cached && !(readState.key === requestKey && readState.error)),
    error: usesDelivery ? input.accessError || (readState.key === requestKey ? readState.error : undefined) : undefined,
    retry, usesDelivery, loadedLessons, prepareReview: prepareReferenced, preparePortfolio,
  }
}
