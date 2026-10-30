import { useCallback, useEffect, useRef, useState } from 'react'
import { courses as demoCourses } from '../data'
import { firebaseAuth, isFirebaseConfigured } from '../lib/firebase'
import { useAcademySessionEpoch } from '../features/academy/useAcademySessionEpoch'
import { academyDemoFallbackEnabled, subscribeToCourses } from '../services/firebaseService'
import type { Course } from '../types'
import { courseLoadErrorMessage } from '../features/academy/courseLoadError'

const EMPTY_COURSES: Course[] = []

export function useCourses(enabled: boolean, includeDrafts = false, refreshKey = '') {
  const sessionEpoch = useAcademySessionEpoch()
  const owner = firebaseAuth?.currentUser ?? null
  const [loadedScope, setLoadedScope] = useState<{ owner: object | null; epoch: number; access: string; drafts: boolean } | null>(null)
  const currentScope = !isFirebaseConfigured || (loadedScope?.owner === owner && loadedScope?.epoch === sessionEpoch
    && loadedScope?.access === refreshKey && loadedScope?.drafts === includeDrafts)
  const [items, setItems] = useState<Course[]>(isFirebaseConfigured || !academyDemoFallbackEnabled ? EMPTY_COURSES : demoCourses)
  const [source, setSource] = useState<'demo' | 'firebase'>(
    isFirebaseConfigured || !academyDemoFallbackEnabled ? 'firebase' : 'demo',
  )
  const [loading, setLoading] = useState(isFirebaseConfigured)
  const [error, setError] = useState<string | null>(null)
  const [refreshNonce, setRefreshNonce] = useState(0)
  const lastAutoRefreshAt = useRef(0)
  const readPending = useRef(false)
  const retry = useCallback(() => {
    if (!enabled || loading) return
    setError(null)
    setLoading(true)
    setRefreshNonce((value) => value + 1)
  }, [enabled, loading])

  useEffect(() => {
    if (!enabled || includeDrafts) return
    const refresh = () => {
      const now = Date.now()
      if (readPending.current || document.visibilityState !== 'visible' || now - lastAutoRefreshAt.current < 5 * 60_000) return
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
        setItems(EMPTY_COURSES)
        setError('Firebase Academy chưa được cấu hình cho môi trường production.')
      }
      setLoading(false)
      return
    }

    setLoading(true)
    setError(null)
    readPending.current = true
    lastAutoRefreshAt.current = Date.now()
    let active = true
    const current = () => active && firebaseAuth?.currentUser === owner
    const unsubscribe = subscribeToCourses(
      includeDrafts,
      (firebaseCourses) => {
        if (!current()) return
        setLoadedScope({ owner, epoch: sessionEpoch, access: refreshKey, drafts: includeDrafts })
        setItems(firebaseCourses)
        setSource('firebase')
        setError(null)
        setLoading(false)
        readPending.current = false
      },
      (subscriptionError) => {
        if (!current()) return
        setLoadedScope({ owner, epoch: sessionEpoch, access: refreshKey, drafts: includeDrafts })
        setError(courseLoadErrorMessage(subscriptionError))
        setItems(academyDemoFallbackEnabled ? demoCourses : EMPTY_COURSES)
        setSource('firebase')
        setLoading(false)
        readPending.current = false
      },
      refreshKey,
    )
    return () => { active = false; readPending.current = false; unsubscribe() }
  }, [enabled, includeDrafts, refreshKey, refreshNonce, owner, sessionEpoch])

  return { courses: enabled && currentScope ? items : EMPTY_COURSES, source, loading: enabled && (loading || !currentScope), error: currentScope ? error : null, retry }
}
