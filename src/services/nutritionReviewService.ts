import { httpsCallable } from 'firebase/functions'
import { firebaseAuth } from '../lib/firebase'
import { firebaseFunctions, firebaseScheduleOptimizerFunctions } from '../lib/firebaseFunctions'
import { runReadOnlyWithFallback } from './readOnlyCallableService'

export type NutritionReviewStatus = 'pending' | 'approved' | 'rejected'

export interface NutritionMealReview {
  id: string
  userId: string
  studentName: string
  studentGoal: string
  studentCondition: string
  assignedCoachId: string
  assignedCoachIds: string[]
  assignedCoachName: string
  createdAt: number
  slaDueAt: number
  waitMinutes: number
  overdueMinutes: number
  isOverdue: boolean
  time: string
  image: string
  imageStoragePath: string
  note: string
  mealType: string
  totalKcal: number
  totalProtein: number
  totalCarb: number
  totalFat: number
  fiber: number
  targetKcal: number
  targetProtein: number
  status: NutritionReviewStatus
  priority: 'high' | 'normal'
  aiScore: number
  confidence: 'low' | 'medium' | 'high'
  coachFeedback: string
  revision: number
  mealRevision: number
  snapshotHash: string
  calorieRange: { low: number; high: number } | null
  unresolvedQuestions: string[]
  nutrientSources: Record<string, unknown>
  items: Array<{ name: string; weight: number; kcal: number; protein: number }>
  suggestions: Array<{ type: 'pass' | 'warn'; text: string }>
  analysis: {
    quantityAndCookingAnalysis: string
    portionAndCalorieRationale: string
    goalAlignmentAssessment: string
    calorieOptimizationTip: string
    macroBalanceAssessment: string
    aiSuggestion: string
    aiFeedback: string
    coachFeedbackSuggestion: string
  }
}

export interface NutritionReviewListResult {
  reviews: NutritionMealReview[]
  coaches: Array<{ id: string; name: string; positions: string[]; branchIds: string[] }>
  scope: 'all' | 'assigned'
  assignmentCount: number
  hasMore: boolean
  nextCursor: string | null
  filteredCount: number
  summary: {
    total: number
    pending: number
    approved: number
    rejected: number
    overdue: number
    highPriority: number
    students: number
  }
  summaryTruncated: boolean
  summaryCountsTruncated?: boolean
  filteredCountExact?: boolean
  slaMinutes: number
  summaryIncluded?: boolean
  directoryIncluded?: boolean
  scopeTruncated?: boolean
  coachesHasMore?: boolean
  coachesNextCursor?: string | null
}

export type NutritionReviewDirectoryResult = Pick<NutritionReviewListResult, 'coaches' | 'scope' | 'coachesHasMore' | 'coachesNextCursor'>
const pendingReads = new Map<string, Promise<NutritionReviewListResult>>()

function functionsOrThrow() {
  if (!firebaseFunctions) throw new Error('Firebase Functions chưa được cấu hình.')
  return firebaseFunctions
}

function reviewError(cause: unknown) {
  const error = cause && typeof cause === 'object' ? cause as { code?: unknown; message?: unknown } : {}
  const code = typeof error.code === 'string' ? error.code.replace(/^functions\//, '') : ''
  const message = typeof error.message === 'string' ? error.message.trim() : ''
  if (['internal', 'resource-exhausted', 'unavailable', 'deadline-exceeded'].includes(code)) {
    return new Error('Dịch vụ duyệt món đang bận hoặc chưa trả kết quả. Hãy tải lại danh sách để kiểm tra trạng thái trước khi gửi lại.')
  }
  if (code === 'unauthenticated') return new Error('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.')
  return new Error(message || 'Không thể xử lý danh sách duyệt món.')
}

export async function listNutritionMealReviews(
  input: {
    status?: NutritionReviewStatus | 'all'
    limit?: number
    cursor?: string | null
    coachId?: string
    query?: string
    focus?: 'overdue' | 'all'
    forceRefresh?: boolean
    section?: 'page' | 'summary' | 'directory'
    directoryCursor?: string | null
  } = {},
  authorityKey = '',
) {
  const ownerId = firebaseAuth?.currentUser?.uid || ''
  if (!ownerId) throw new Error('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.')
  const payload = {
    status: input.status || 'all',
    limit: input.limit || 24,
    cursor: input.cursor,
    coachId: input.coachId,
    query: input.query,
    focus: input.focus,
    forceRefresh: input.forceRefresh,
    section: input.section,
    directoryCursor: input.directoryCursor,
  }
  const key = JSON.stringify([ownerId, authorityKey, payload])
  const existing = pendingReads.get(key)
  if (existing) return existing
  const assertOwner = () => {
    if (firebaseAuth?.currentUser?.uid !== ownerId) throw new Error('Tài khoản đã thay đổi. Hãy mở lại trang duyệt bữa ăn.')
  }
  const invoke = (client: NonNullable<typeof firebaseFunctions>, name: string) => {
    // Regional failover may run after a delayed failure/backoff. Never send
    // the previous account's filters or cursor with a new account's token.
    assertOwner()
    return httpsCallable<typeof payload, NutritionReviewListResult>(client, name, { timeout: 18_000 })(payload).then((result) => result.data)
  }
  const pending = (async () => {
    try {
      const regionalFunctions = firebaseScheduleOptimizerFunctions
      const result = regionalFunctions
        ? await runReadOnlyWithFallback(
          () => invoke(regionalFunctions, 'listNutritionMealReviewsRegional'),
          () => invoke(functionsOrThrow(), 'listNutritionMealReviews'),
        )
        : await invoke(functionsOrThrow(), 'listNutritionMealReviews')
      assertOwner()
      return result
    } catch (cause) {
      throw reviewError(cause)
    }
  })()
  pendingReads.set(key, pending)
  try { return await pending } finally { if (pendingReads.get(key) === pending) pendingReads.delete(key) }
}

export function getNutritionReviewSummary(authorityKey = '', forceRefresh = false, freshnessKey = '') {
  return listNutritionMealReviews({ section: 'summary', forceRefresh }, JSON.stringify([authorityKey, freshnessKey]))
}

export function getNutritionReviewCoaches(authorityKey = '', directoryCursor: string | null = null): Promise<NutritionReviewDirectoryResult> {
  return listNutritionMealReviews({ section: 'directory', directoryCursor }, authorityKey)
}

export async function reviewNutritionMeal(input: {
  reviewId: string
  action: 'approve' | 'reject' | 'feedback'
  feedback: string
  expectedRevision: number
}) {
  const callable = httpsCallable<typeof input, {
    reviewId: string
    status: NutritionReviewStatus
    revision: number
    reviewedAt: number | null
  }>(functionsOrThrow(), 'reviewNutritionMeal')
  try {
    return (await callable(input)).data
  } catch (cause) {
    throw reviewError(cause)
  }
}
