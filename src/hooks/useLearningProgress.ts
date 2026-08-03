import { useEffect, useMemo, useState } from 'react'
import { isFirebaseConfigured } from '../lib/firebase'
import {
  subscribeToUserEnrollments,
  subscribeToUserProgress,
} from '../services/firebaseService'
import type { CourseProgress, Enrollment } from '../types'

export function useLearningProgress(userId: string | null | undefined, enabled = true) {
  const [progress, setProgress] = useState<CourseProgress[]>([])
  const [enrollments, setEnrollments] = useState<Enrollment[]>([])
  const [loading, setLoading] = useState(Boolean(userId && enabled && isFirebaseConfigured))
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!userId || !enabled || !isFirebaseConfigured) {
      setProgress([])
      setEnrollments([])
      setLoading(false)
      setError(null)
      return
    }

    setProgress([])
    setEnrollments([])
    let progressReady = false
    let enrollmentsReady = false
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
          setProgress(items)
          progressReady = true
          finishLoadingWhenReady()
        },
        (subscriptionError) => {
          progressReady = true
          setError(subscriptionError.message)
          finishLoadingWhenReady()
        },
      )

      unsubscribeEnrollments = subscribeToUserEnrollments(
        userId,
        (items) => {
          setEnrollments(items)
          enrollmentsReady = true
          finishLoadingWhenReady()
        },
        (subscriptionError) => {
          enrollmentsReady = true
          setError(subscriptionError.message)
          finishLoadingWhenReady()
        },
      )
    } catch (subscriptionError) {
      setLoading(false)
      setError(subscriptionError instanceof Error ? subscriptionError.message : 'Không thể tải tiến độ học tập.')
    }

    return () => {
      unsubscribeProgress?.()
      unsubscribeEnrollments?.()
    }
  }, [enabled, userId])

  const progressByCourseId = useMemo(
    () => new Map(progress.map((item) => [item.courseId, item])),
    [progress],
  )
  const enrollmentByCourseId = useMemo(
    () => new Map(enrollments.map((item) => [item.courseId, item])),
    [enrollments],
  )

  return {
    progress,
    enrollments,
    progressByCourseId,
    enrollmentByCourseId,
    loading,
    error,
  }
}
