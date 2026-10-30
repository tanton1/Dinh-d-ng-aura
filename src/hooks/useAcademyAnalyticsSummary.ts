import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { firebaseAuth } from '../lib/firebase'
import { useAcademySessionEpoch } from '../features/academy/useAcademySessionEpoch'
import type { AcademyAnalyticsSummary } from '../services/scopedReportingService'
import type { Course, CourseAnalytics } from '../types'

const EMPTY_ANALYTICS: CourseAnalytics[] = []
const LOAD_ERROR = 'Chưa tải được tổng hợp Academy. Các chỉ số được để trống, không thay bằng số 0.'
const INCOMPLETE = 'Chưa đủ dữ liệu để tổng hợp Academy. Các chỉ số được để trống; hãy thử tải lại hoặc kiểm tra dữ liệu nguồn.'

type Scope = {
  owner: object | null
  alive: boolean
  enabled: boolean
  dirty: boolean
  force: boolean
  revision: number
  running: boolean
  run: () => void
}
type Result = {
  scope: Scope
  summary: AcademyAnalyticsSummary | null
  loading: boolean
  message: string | null
}

/** One mounted view's read lifecycle; the catalog is presentation, not a summary invalidation signal. */
export function useAcademyAnalyticsSummary({ enabled, backendMode, accessRevision, courses }: {
  enabled: boolean
  backendMode: 'firebase' | 'demo'
  accessRevision: string
  courses: Course[]
}) {
  const sessionEpoch = useAcademySessionEpoch()
  const owner = firebaseAuth?.currentUser ?? null
  const scope = useMemo<Scope>(() => ({
    owner, alive: false, enabled: false, dirty: true, force: false,
    revision: 0, running: false, run: () => {},
  }), [owner, sessionEpoch, accessRevision, backendMode])
  const allowed = enabled && backendMode === 'firebase' && Boolean(owner)
  const current = useRef({ scope, allowed })
  current.current = { scope, allowed }
  const [result, setResult] = useState<Result | null>(null)

  useEffect(() => {
    scope.alive = true
    const isCurrent = () => scope.alive && current.current.scope === scope
      && firebaseAuth?.currentUser === scope.owner
    const run = () => {
      if (!isCurrent() || !scope.enabled || !current.current.allowed || !scope.dirty
        || scope.running || document.visibilityState !== 'visible') return
      scope.running = true
      scope.dirty = false
      const revision = scope.revision
      const refresh = scope.force
      setResult({ scope, summary: null, loading: true, message: 'Đang tải tổng hợp Academy…' })
      void import('../services/scopedReportingService')
        .then(({ getAcademyAnalyticsSummary }) => {
          // A lazy import can finish after logout, navigation or backgrounding.
          if (!isCurrent() || !scope.enabled || !current.current.allowed
            || document.visibilityState !== 'visible' || revision !== scope.revision) {
            scope.dirty = true
            return null
          }
          return getAcademyAnalyticsSummary(refresh)
        })
        .then((summary) => {
          if (!summary || !isCurrent() || revision !== scope.revision) return
          if (!summary.complete) {
            setResult({ scope, summary: null, loading: false, message: INCOMPLETE })
            return
          }
          // A failed/incomplete forced read must not consume the user's fresh-data intent.
          scope.force = false
          scope.dirty = false
          setResult({ scope, summary, loading: false,
            message: `Tổng hợp lúc ${new Date(summary.asOf).toLocaleString('vi-VN')}. Làm mới để xem thay đổi mới nhất.` })
        })
        .catch(() => {
          if (isCurrent() && revision === scope.revision) {
            setResult({ scope, summary: null, loading: false, message: LOAD_ERROR })
          }
        })
        .finally(() => {
          scope.running = false
          if (isCurrent()) {
            setResult(previous => previous?.scope === scope && previous.loading
              ? { ...previous, loading: false } : previous)
            run()
          }
        })
    }
    // Microtask scheduling lets StrictMode's setup/cleanup probe join the same read.
    scope.run = () => { queueMicrotask(run) }
    const resume = () => scope.run()
    document.addEventListener('visibilitychange', resume)
    window.addEventListener('online', resume)
    scope.run()
    return () => {
      scope.alive = false
      document.removeEventListener('visibilitychange', resume)
      window.removeEventListener('online', resume)
    }
  }, [scope])

  useEffect(() => {
    const opening = allowed && !scope.enabled
    scope.enabled = allowed
    if (opening) scope.dirty = true
    scope.run()
  }, [scope, allowed])

  const refresh = useCallback(() => {
    // A mutation begun by a previous account may settle after the scope has changed.
    if (current.current.scope !== scope || firebaseAuth?.currentUser !== scope.owner) return
    scope.force = true
    scope.dirty = true
    scope.revision += 1
    setResult(previous => previous?.scope === scope ? {
      ...previous, summary: null,
      message: 'Số liệu đã thay đổi. Đang chờ tải tổng hợp mới…',
    } : previous)
    scope.run()
  }, [scope])

  const visibleResult = allowed && result?.scope === scope ? result : null
  const summary = visibleResult?.summary ?? null
  const analytics = useMemo(() => {
    if (!summary?.complete) return EMPTY_ANALYTICS
    const byCourse = new Map(summary.courses.map(item => [item.courseId, item]))
    return courses.map(course => byCourse.get(String(course.id)) || {
      courseId: String(course.id), learners: 0, activeLearners: 0,
      completedLearners: 0, averageCompletion: 0, rating: null,
    })
  }, [summary, courses])

  return {
    analytics,
    message: visibleResult?.message ?? null,
    loading: allowed && (!visibleResult || visibleResult.loading),
    asOf: summary?.asOf ?? null,
    complete: summary?.complete === true,
    refresh,
    invalidate: refresh,
  }
}
