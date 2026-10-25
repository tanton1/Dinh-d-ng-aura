import { useCallback, useEffect, useMemo, useState } from 'react'
import { isFirebaseConfigured } from '../lib/firebase'
import {
  subscribeToUserEnrollments,
  subscribeToUserProgress,
} from '../services/firebaseService'
import type { CourseProgress, Enrollment } from '../types'
import { useAcademySessionEpoch } from '../features/academy/useAcademySessionEpoch'

export function useLearningProgress(userId: string | null | undefined, enabled = true) {
  const [progress, setProgress] = useState<CourseProgress[]>([])
  const [enrollments, setEnrollments] = useState<Enrollment[]>([])
  const [loading, setLoading] = useState(Boolean(userId && enabled && isFirebaseConfigured))
  const [error, setError] = useState<string | null>(null)
  const [retryNonce, setRetryNonce] = useState(0)
  const sessionEpoch = useAcademySessionEpoch()
  const scope = JSON.stringify([userId, enabled, sessionEpoch, retryNonce])
  const [loadedScope, setLoadedScope] = useState('')
  const retry = useCallback(() => setRetryNonce((value) => value + 1), [])

  useEffect(() => {
    setLoadedScope(scope)
    if (!userId || !enabled || !isFirebaseConfigured) {
      setProgress([])
      setEnrollments([])
      setLoading(false)
      setError(null)
      return
    }

    setProgress([])
    setEnrollments([])
    let active = true
    let progressReady = false
    let enrollmentsReady = false
    const errors = { progress: '', enrollments: '' }
    const updateError = (field: keyof typeof errors, message: string) => { errors[field] = message; setError(errors.progress || errors.enrollments || null) }
    let unsubscribeProgress: (() => void) | undefined
    let unsubscribeEnrollments: (() => void) | undefined

    const finishLoadingWhenReady = () => {
      if (progressReady && enrollmentsReady) setLoading(false)
    }

    setLoading(true)
    setError(null)

    try {
      unsubscribeProgress = subscribeToUserProgress(
        userId,
        (items) => {
          if (!active) return
          setProgress(items)
          updateError('progress', '')
          progressReady = true
          finishLoadingWhenReady()
        },
        (subscriptionError) => {
          if (!active) return
          setProgress([])
          progressReady = true
          updateError('progress', subscriptionError.message)
          finishLoadingWhenReady()
        },
      )

      unsubscribeEnrollments = subscribeToUserEnrollments(
        userId,
        (items) => {
          if (!active) return
          setEnrollments(items)
          updateError('enrollments', '')
          enrollmentsReady = true
          finishLoadingWhenReady()
        },
        (subscriptionError) => {
          if (!active) return
          setEnrollments([])
          enrollmentsReady = true
          updateError('enrollments', subscriptionError.message)
          finishLoadingWhenReady()
        },
      )
    } catch (subscriptionError) {
      active = false
      unsubscribeProgress?.()
      unsubscribeEnrollments?.()
      setProgress([])
      setEnrollments([])
      setLoading(false)
      setError(subscriptionError instanceof Error ? subscriptionError.message : 'Không thể tải tiến độ học tập.')
    }

    return () => {
      active = false
      unsubscribeProgress?.()
      unsubscribeEnrollments?.()
    }
  }, [enabled, userId, scope])

  const visibleProgress = useMemo(() => enabled && loadedScope === scope ? progress : [], [enabled, loadedScope, scope, progress])
  const visibleEnrollments = useMemo(() => enabled && loadedScope === scope ? enrollments : [], [enabled, loadedScope, scope, enrollments])

  const progressByCourseId = useMemo(
    () => new Map(visibleProgress.map((item) => [item.courseId, item])),
    [visibleProgress],
  )
  const enrollmentByCourseId = useMemo(
    () => new Map(visibleEnrollments.map((item) => [item.courseId, item])),
    [visibleEnrollments],
  )

  return {
    progress: visibleProgress,
    enrollments: visibleEnrollments,
    progressByCourseId,
    enrollmentByCourseId,
    loading: Boolean(enabled && userId && isFirebaseConfigured && (loadedScope !== scope || loading)),
    error: enabled && loadedScope === scope ? error : null,
    retry,
  }
}
