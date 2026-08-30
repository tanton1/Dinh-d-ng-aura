import { httpsCallable } from 'firebase/functions'
import { firebaseFunctions } from '../lib/firebaseFunctions'

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
  attemptsRemaining?: number | null
}

export interface ResolvedCourseMedia {
  url: string
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

function toExpiryMillis(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    return Number.isNaN(parsed) ? null : parsed
  }
  return null
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
    attemptsRemaining: data.attemptsRemaining === null
      ? null
      : optionalFiniteNumber(data.attemptsRemaining),
  }
}

export async function getCourseMediaUrl(input: {
  courseId: string
  lessonId: string
  storagePath: string
}): Promise<ResolvedCourseMedia> {
  if (!input.courseId.trim() || !input.lessonId.trim() || !input.storagePath.trim()) {
    throw new Error('Tài nguyên media thiếu thông tin định danh.')
  }
  if (!input.storagePath.startsWith(`course-media/${input.courseId}/${input.lessonId}/`)) {
    throw new Error('Đường dẫn media không thuộc bài học hiện tại.')
  }
  const payload = { courseId: input.courseId, lessonId: input.lessonId, path: input.storagePath }
  const callable = httpsCallable<typeof payload, unknown>(requireFunctions(), 'getCourseMediaUrl')
  const response = await callable(payload)
  if (!response.data || typeof response.data !== 'object') {
    throw new Error('Phản hồi media không hợp lệ.')
  }

  const data = response.data as Record<string, unknown>
  if (data.path !== input.storagePath) {
    throw new Error('Phản hồi media không khớp với tài nguyên được yêu cầu.')
  }
  const url = safeCourseMediaUrl(data.url)
  if (!url) throw new Error('Aura không nhận được liên kết media an toàn.')
  return {
    url,
    contentType: typeof data.contentType === 'string' ? data.contentType : undefined,
    expiresAt: toExpiryMillis(data.expiresAt),
  }
}
