import { useEffect, useMemo, useRef, useState } from 'react'
import { getMyPtTrainingPlan, listMyPtWorkoutHistoryPage, type PersonalWorkoutHistoryPage, type PtTrainingProgram } from '../services/ptWorkoutTrackingService'
import { summarizeLoadedWorkouts } from '../utils/personalWorkoutHistory'
import { useWorkspaceSync } from './useWorkspaceSync'

const denied = (cause: unknown) => /(?:permission-denied|unauthenticated)$/.test(String((cause as { code?: string })?.code || ''))
const message = (cause: unknown, fallback: string) => cause instanceof Error ? cause.message : fallback

/** Mounted per account by StudentPtWorkoutPage. Each tab accepts its own
 * watermark; inactive tabs retain invalidations without fetching payloads. */
export function usePersonalWorkoutData(accountId: string, isDemo: boolean, tab: 'plan' | 'history' | 'library') {
  const enabled = !isDemo && Boolean(accountId) && accountId !== 'demo'
  const [program, setProgram] = useState<PtTrainingProgram | null>(null)
  const [page, setPage] = useState<PersonalWorkoutHistoryPage | null>(null)
  const [planLoading, setPlanLoading] = useState(enabled)
  const [historyLoading, setHistoryLoading] = useState(enabled)
  const [planError, setPlanError] = useState('')
  const [historyError, setHistoryError] = useState('')
  const alive = useRef(true)
  const planFlight = useRef<Promise<void> | null>(null)
  const historyFlight = useRef<Promise<void> | null>(null)
  const historyRefresh = useRef<Promise<void> | null>(null)
  const historyEpoch = useRef(0)
  const pageRef = useRef(page)
  pageRef.current = page
  useEffect(() => { alive.current = true; return () => { alive.current = false; historyEpoch.current += 1 } }, [])

  const loadPlan = (): Promise<void> => {
    if (planFlight.current) return planFlight.current
    setPlanLoading(true); setPlanError('')
    const task = Promise.resolve().then(async () => {
      try {
        const response = await getMyPtTrainingPlan()
        if (!alive.current) return
        setProgram(response.program)
        planSync.accept(response.syncState)
      } catch (cause) {
        if (!alive.current) return
        if (denied(cause)) setProgram(null)
        setPlanError(message(cause, 'Không thể tải giáo án.'))
        planSync.failed()
      } finally {
        planFlight.current = null
        if (alive.current) setPlanLoading(false)
      }
    })
    planFlight.current = task
    return task
  }
  const loadHistory = (): Promise<void> => {
    if (historyRefresh.current) return historyRefresh.current
    const epoch = ++historyEpoch.current
    const previous = historyFlight.current
    setHistoryLoading(true); setHistoryError('')
    const task = Promise.resolve(previous).then(async () => {
      if (!alive.current) return
      try {
        const response = await listMyPtWorkoutHistoryPage()
        if (!alive.current || epoch !== historyEpoch.current) return
        pageRef.current = response; setPage(response)
        historySync.accept(response.syncState)
      } catch (cause) {
        if (!alive.current || epoch !== historyEpoch.current) return
        if (denied(cause)) { pageRef.current = null; setPage(null) }
        setHistoryError(message(cause, 'Không thể tải lịch sử tập luyện.'))
        historySync.failed()
      } finally {
        historyRefresh.current = null
        if (historyFlight.current === task) historyFlight.current = null
        if (alive.current && epoch === historyEpoch.current) setHistoryLoading(false)
      }
    })
    historyFlight.current = task
    historyRefresh.current = task
    return task
  }
  const planSync = useWorkspaceSync({ accountId, domain: 'studentTrainingPlan', scopeKey: accountId, enabled, paused: tab !== 'plan', refresh: loadPlan })
  const historySync = useWorkspaceSync({ accountId, domain: 'studentWorkoutHistory', scopeKey: accountId, enabled, paused: tab !== 'history', refresh: loadHistory })

  const loadMore = () => {
    const current = pageRef.current
    if (!enabled || !current?.nextCursor || historyFlight.current || document.hidden || navigator.onLine === false) return
    const epoch = historyEpoch.current
    setHistoryLoading(true); setHistoryError('')
    const task = Promise.resolve().then(async () => {
      try {
        const response = await listMyPtWorkoutHistoryPage(current.nextCursor)
        if (!alive.current || epoch !== historyEpoch.current) return
        if (response.studentId !== current.studentId || response.syncState.version !== current.syncState.version) {
          historySync.retry(); return
        }
        const merged = { ...response, logs: [...new Map([...current.logs, ...response.logs].map((log) => [log.id, log])).values()] }
        pageRef.current = merged; setPage(merged)
        historySync.accept(response.syncState)
      } catch (cause) {
        if (!alive.current || epoch !== historyEpoch.current) return
        if ((cause as { details?: { issueCode?: string } })?.details?.issueCode === 'WORKOUT_HISTORY_CHANGED') {
          historySync.retry(); return
        }
        if (denied(cause)) { pageRef.current = null; setPage(null) }
        setHistoryError(message(cause, 'Không thể tải thêm lịch sử.'))
      } finally {
        if (historyFlight.current === task) historyFlight.current = null
        if (alive.current && epoch === historyEpoch.current) setHistoryLoading(false)
      }
    })
    historyFlight.current = task
  }
  const history = useMemo(() => page ? { studentId: page.studentId, logs: page.logs, analytics: summarizeLoadedWorkouts(page.logs) } : null, [page])
  return {
    program, history, planLoading, historyLoading, hasMore: page?.hasMore === true, loadMore,
    refreshPlan: planSync.retry, refreshHistory: historySync.retry,
    planError: planError || (planSync.error ? 'Chưa cập nhật được giáo án mới nhất. Hãy thử làm mới.' : ''),
    historyError: historyError || (historySync.error ? 'Chưa cập nhật được lịch sử mới nhất. Hãy thử làm mới.' : ''),
  }
}
