import { useCallback, useEffect, useRef } from 'react'
import { createForegroundRefresh, type ForegroundRefresh } from '../utils/foregroundRefresh'

const foreground = () => document.visibilityState !== 'hidden' && navigator.onLine !== false

export function useForegroundRefresh({ scopeKey, read, intervalMs, enabled = true }: {
  scopeKey: string
  read: (background: boolean, isCurrent: () => boolean) => Promise<void>
  intervalMs: number | null
  enabled?: boolean
}) {
  const controllerRef = useRef<ForegroundRefresh | null>(null)
  const scopeRef = useRef(scopeKey)
  const attemptedRef = useRef(false)
  scopeRef.current = scopeKey
  const readRef = useRef(read)
  readRef.current = read
  useEffect(() => {
    if (!enabled) return
    attemptedRef.current = false
    const controller = createForegroundRefresh((background, current) => {
      attemptedRef.current = true
      return readRef.current(background, () => current() && scopeRef.current === scopeKey)
    }, () => foreground() && scopeRef.current === scopeKey)
    controllerRef.current = controller
    void controller.refresh(false).catch(() => undefined)
    return () => {
      controller.dispose()
      if (controllerRef.current === controller) controllerRef.current = null
    }
  }, [scopeKey, enabled])

  useEffect(() => {
    if (!enabled) return
    let wasAvailable = foreground()
    const resume = () => {
      const available = foreground()
      if (available && !wasAvailable && (intervalMs !== null || !attemptedRef.current)) void controllerRef.current?.refresh(true).catch(() => undefined)
      wasAvailable = available
    }
    const timer = intervalMs === null ? null : window.setInterval(() => void controllerRef.current?.refresh(true).catch(() => undefined), intervalMs)
    document.addEventListener('visibilitychange', resume)
    window.addEventListener('online', resume)
    window.addEventListener('offline', resume)
    return () => {
      if (timer !== null) window.clearInterval(timer)
      document.removeEventListener('visibilitychange', resume)
      window.removeEventListener('online', resume)
      window.removeEventListener('offline', resume)
    }
  }, [scopeKey, enabled, intervalMs])

  const refresh = useCallback((background = true, afterMutation = false) => controllerRef.current?.refresh(background, afterMutation) ?? Promise.resolve(), [])
  const invalidate = useCallback(() => controllerRef.current?.invalidate(), [])
  return { refresh, invalidate }
}
