import { useEffect, useRef, useState } from 'react'
import { courses as demoCourses } from '../data'
import { isFirebaseConfigured } from '../lib/firebase'
import { academyDemoFallbackEnabled, subscribeToCourses } from '../services/firebaseService'
import type { Course } from '../types'

export function useCourses(enabled: boolean, includeDrafts = false, refreshKey = '') {
  const [items, setItems] = useState<Course[]>(isFirebaseConfigured || !academyDemoFallbackEnabled ? [] : demoCourses)
  const [source, setSource] = useState<'demo' | 'firebase'>(
    isFirebaseConfigured || !academyDemoFallbackEnabled ? 'firebase' : 'demo',
  )
  const [loading, setLoading] = useState(isFirebaseConfigured)
  const [error, setError] = useState<string | null>(null)
  const [refreshNonce, setRefreshNonce] = useState(0)
  const lastAutoRefreshAt = useRef(0)

  useEffect(() => {
    if (!enabled || includeDrafts) return
    const refresh = () => {
      const now = Date.now()
      if (now - lastAutoRefreshAt.current < 60_000) return
      lastAutoRefreshAt.current = now
      setRefreshNonce((value) => value + 1)
    }
    const onVisibility = () => { if (document.visibilityState === 'visible') refresh() }
    window.addEventListener('online', refresh)
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('online', refresh)
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [enabled, includeDrafts])

  useEffect(() => {
    if (!enabled || !isFirebaseConfigured) {
      if (enabled && !isFirebaseConfigured && !academyDemoFallbackEnabled) {
        setItems([])
        setError('Firebase Academy chưa được cấu hình cho môi trường production.')
      }
      setLoading(false)
      return
    }

    setLoading(true)
    lastAutoRefreshAt.current = Date.now()
    return subscribeToCourses(
      includeDrafts,
      (firebaseCourses) => {
        setItems(firebaseCourses)
        setSource('firebase')
        setError(null)
        setLoading(false)
      },
      (subscriptionError) => {
        setError(subscriptionError.message)
        setItems(academyDemoFallbackEnabled ? demoCourses : [])
        setSource('firebase')
        setLoading(false)
      },
    )
  }, [enabled, includeDrafts, refreshKey, refreshNonce])

  return { courses: items, source, loading, error }
}
