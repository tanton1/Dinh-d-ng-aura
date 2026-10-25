import { httpsCallable } from 'firebase/functions'
import { firebaseFunctions } from '../lib/firebaseFunctions'
import { callAcademyReadFunction } from './academyReadService'
import { onAuthStateChanged } from 'firebase/auth'
import { firebaseAuth } from '../lib/firebase'
import { createAcademyMediaClient, type AcademyMediaInput } from '../features/academy/mediaClient'
export type { AcademyMediaContext } from '../features/academy/mediaClient'

export type QuizAnswers = Record<string, number>

interface QuizAnswerPayload {
  questionId: string
  optionIndex: number
}

export interface QuizGradeResult {
  attemptId?: string
  correctCount: number
  totalQuestions: number
  percent: number
  passed: boolean
  mustPassPassed?: boolean
  attemptsRemaining?: number | null
  review?: Array<{
    questionId: string
    correct: boolean
    explanation: string
    remediationCardIds: string[]
  }>
}

export interface ResolvedCourseMedia {
  url: string
  /** A signed URL with an attachment disposition when the backend supports it. */
  downloadUrl?: string
  fileName?: string
  contentType?: string
  expiresAt?: number | null
}

function requireFunctions() {
  if (!firebaseFunctions) throw new Error('Dịch vụ học tập chưa được cấu hình.')
  return firebaseFunctions
}

function finiteNumber(value: unknown, fallback = 0) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function optionalFiniteNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/**
 * Only returns browser-safe course URLs. Private Firebase assets must first be
 * exchanged for a short-lived HTTPS URL by getCourseMediaUrl.
 */
export function safeCourseMediaUrl(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null
  try {
    const parsed = new URL(value.trim(), window.location.origin)
    const isLocalDevelopment = import.meta.env.DEV
      && (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1')
    if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && isLocalDevelopment)) return null
    return parsed.href
  } catch {
    return null
  }
}

export async function gradeCourseQuiz(input: {
  courseId: string
  lessonId: string
  answers: QuizAnswers
  requestId?: string
  chapterVersion?: string
}): Promise<QuizGradeResult> {
  const answerEntries = Object.entries(input.answers)
  if (!input.courseId.trim() || !input.lessonId.trim() || answerEntries.length === 0) {
    throw new Error('Bài kiểm tra chưa có đủ dữ liệu để chấm.')
  }
  if (answerEntries.some(([questionId, optionIndex]) => !questionId.trim() || !Number.isInteger(optionIndex) || optionIndex < 0)) {
    throw new Error('Lựa chọn trả lời không hợp lệ.')
  }
  const payload = {
    courseId: input.courseId,
    lessonId: input.lessonId,
    ...(input.requestId ? { requestId: input.requestId } : {}),
    ...(input.chapterVersion ? { chapterVersion: input.chapterVersion } : {}),
    answers: answerEntries.map(([questionId, optionIndex]): QuizAnswerPayload => ({
      questionId,
      optionIndex,
    })),
  }
  const callable = httpsCallable<typeof payload, unknown>(requireFunctions(), 'gradeCourseQuiz')
  const response = await callable(payload)
  if (!response.data || typeof response.data !== 'object') {
    throw new Error('Kết quả bài kiểm tra không hợp lệ.')
  }

  const data = response.data as Record<string, unknown>
  if (data.courseId !== input.courseId || data.lessonId !== input.lessonId) {
    throw new Error('Kết quả bài kiểm tra không khớp với bài học hiện tại.')
  }
  const totalQuestions = Math.max(0, Math.round(finiteNumber(data.totalQuestions, finiteNumber(data.total, 0))))
  const correctCount = Math.max(0, Math.round(finiteNumber(data.correctCount, finiteNumber(data.correctAnswers, finiteNumber(data.score, 0)))))
  const percent = Math.max(0, Math.min(100, finiteNumber(data.percent, finiteNumber(data.scorePercent, totalQuestions ? (correctCount / totalQuestions) * 100 : 0))))
  if (typeof data.passed !== 'boolean' || totalQuestions < 1) {
    throw new Error('Kết quả bài kiểm tra thiếu thông tin bắt buộc.')
  }

  return {
    attemptId: typeof data.attemptId === 'string' ? data.attemptId : undefined,
    correctCount: Math.min(correctCount, totalQuestions),
    totalQuestions,
    percent: Math.round(percent),
    passed: data.passed,
    mustPassPassed: typeof data.mustPassPassed === 'boolean' ? data.mustPassPassed : undefined,
    attemptsRemaining: data.attemptsRemaining === null
      ? null
      : optionalFiniteNumber(data.attemptsRemaining),
    review: Array.isArray(data.review)
      ? data.review.flatMap((item) => {
          if (!item || typeof item !== 'object') return []
          const value = item as Record<string, unknown>
          if (typeof value.questionId !== 'string' || typeof value.correct !== 'boolean') return []
          return [{
            questionId: value.questionId,
            correct: value.correct,
            explanation: typeof value.explanation === 'string' ? value.explanation : '',
            remediationCardIds: Array.isArray(value.remediationCardIds)
              ? value.remediationCardIds.filter((entry): entry is string => typeof entry === 'string').slice(0, 10)
              : [],
          }]
        })
      : undefined,
  }
}

const mediaClient = createAcademyMediaClient({ session: () => firebaseAuth?.currentUser ?? null,
  read: (payload, access) => callAcademyReadFunction('getCourseMediaUrl', payload, access), safeUrl: safeCourseMediaUrl })
let mediaOwner = firebaseAuth?.currentUser ?? null
if (firebaseAuth) onAuthStateChanged(firebaseAuth, (next) => {
  if (mediaOwner !== next) { mediaOwner = next; mediaClient.clear() }
})
export const getCourseMediaUrl = (input: AcademyMediaInput): Promise<ResolvedCourseMedia> => mediaClient.load(input)
export const clearAcademyMediaCache = mediaClient.clear
