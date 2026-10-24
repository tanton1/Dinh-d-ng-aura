import { useCallback, useEffect, useRef, useState } from 'react'
import { getMyNutritionJournalSummary, type NutritionJournalDaySummary } from '../services/nutritionJournalSummaryService'
import { completeProgressSummary, progressSummaryRanges } from '../features/nutrition/progressDailySummary'

type SummaryState = { key: string; status: 'loading' | 'ready' | 'pending' | 'partial' | 'error'; items: NutritionJournalDaySummary[]; message?: string }
type Build = { key: string; items: NutritionJournalDaySummary[]; next: number; force: boolean; boundary?: string; blocked?: boolean }
const available = () => !document.hidden && navigator.onLine !== false

/** A daily report: no idle network timer and no raw-log fallback. Completed
 * chunks survive a bounded cold build or hidden tab, within one owner/range. */
export function useProgressNutritionSummary(ownerId: string, fromDate: string, toDate: string, enabled: boolean) {
  const key = JSON.stringify([ownerId, fromDate, toDate])
  const [state, setState] = useState<SummaryState>({ key, status: 'loading', items: [] })
  const [foreground, setForeground] = useState(available)
  const [reload, setReload] = useState(0)
  const buildRef = useRef<Build | null>(null)
  const runningRef = useRef<Build | null>(null)
  const readyRef = useRef<SummaryState | null>(null)
  const currentKey = useRef(key)
  const enabledRef = useRef(enabled)
  const mountedRef = useRef(false)
  currentKey.current = key
  enabledRef.current = enabled
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false } }, [])
  useEffect(() => {
    const update = () => setForeground(available())
    document.addEventListener('visibilitychange', update)
    window.addEventListener('online', update)
    window.addEventListener('offline', update)
    return () => { document.removeEventListener('visibilitychange', update); window.removeEventListener('online', update); window.removeEventListener('offline', update) }
  }, [])
  useEffect(() => {
    if (readyRef.current?.key !== key) readyRef.current = null
    if (buildRef.current?.key !== key) buildRef.current = null
  }, [key])
  useEffect(() => {
    if (!enabled || !foreground) return
    if (readyRef.current?.key === key) { setState(readyRef.current); return }
    const build: Build = buildRef.current?.key === key ? buildRef.current : { key, items: [], next: 0, force: false }
    buildRef.current = build
    if (runningRef.current === build || build.blocked) return
    const current = () => mountedRef.current && enabledRef.current && currentKey.current === key && buildRef.current === build
    runningRef.current = build
    setState({ key, status: 'loading', items: [] })
    const load = async () => {
      try {
        const ranges = progressSummaryRanges(fromDate, toDate)
        while (build.next < ranges.length && current() && available()) {
          const range = ranges[build.next]
          const response = await getMyNutritionJournalSummary(ownerId, range.fromDate, range.toDate, key, build.force && !build.boundary, build.boundary)
          if (!current()) return
          build.boundary = response.refreshAfter || build.boundary
          if (response.coverage !== 'ready') {
            build.blocked = true
            setState({ key, status: response.coverage, items: [], message: response.coverage === 'pending'
              ? 'Nhật ký trong kỳ đang được tổng hợp. Bấm Tiếp tục tổng hợp để hoàn tất.'
              : 'Chưa tổng hợp đủ nhật ký trong kỳ. Tỷ lệ sẽ hiển thị khi dữ liệu đầy đủ.' })
            return
          }
          if (!completeProgressSummary(response.items, range.fromDate, range.toDate)) throw new Error('Chưa có đủ dữ liệu bữa ăn cho báo cáo tiến độ. Vui lòng thử làm mới sau.')
          build.items = [...build.items, ...response.items]
          build.next++
          build.boundary = undefined
        }
        if (!current() || build.next !== ranges.length) return
        const result: SummaryState = { key, status: 'ready', items: build.items }
        readyRef.current = result
        setState(result)
      } catch (cause) {
        if (current()) {
          build.blocked = true
          setState({ key, status: 'error', items: [], message: cause instanceof Error ? cause.message : 'Chưa tải được báo cáo tiến độ.' })
        }
      } finally {
        if (runningRef.current === build) runningRef.current = null
      }
    }
    void load()
  }, [enabled, foreground, key, ownerId, fromDate, toDate, reload])
  const refresh = useCallback(() => {
    const resume = state.key === key && state.status === 'pending' && buildRef.current?.key === key
    if (!resume) buildRef.current = { key, items: [], next: 0, force: true }
    else buildRef.current!.blocked = false
    readyRef.current = null
    setState({ key, status: 'loading', items: [] })
    setReload(value => value + 1)
  }, [key, state])
  return { ...(state.key === key ? state : { key, status: 'loading' as const, items: [] }), refresh }
}
