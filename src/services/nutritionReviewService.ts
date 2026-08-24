import { httpsCallable } from 'firebase/functions'
import { firebaseFunctions } from '../lib/firebase'

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
  slaMinutes: number
}

function functionsOrThrow() {
  if (!firebaseFunctions) throw new Error('Firebase Functions chưa được cấu hình.')
  return firebaseFunctions
}

export async function listNutritionMealReviews(
  input: {
    status?: NutritionReviewStatus | 'all'
    limit?: number
    cursor?: string | null
    coachId?: string
    query?: string
  } = {},
) {
  const callable = httpsCallable<
    {
      status: NutritionReviewStatus | 'all'
      limit: number
      cursor?: string | null
      coachId?: string
      query?: string
    },
    NutritionReviewListResult
  >(functionsOrThrow(), 'listNutritionMealReviews')
  return (await callable({
    status: input.status || 'all',
    limit: input.limit || 24,
    cursor: input.cursor,
    coachId: input.coachId,
    query: input.query,
  })).data
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
    reviewedAt: number
  }>(functionsOrThrow(), 'reviewNutritionMeal')
  return (await callable(input)).data
}
