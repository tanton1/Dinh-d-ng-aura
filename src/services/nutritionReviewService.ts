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
  assignedCoachName: string
  createdAt: number
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
}

export async function assignNutritionCoach(userId: string, coachUid: string) {
  const callable = httpsCallable<{ userId: string; coachUid: string }, {
    userId: string
    coachUid: string
    assigned: boolean
  }>(functionsOrThrow(), 'assignNutritionCoach')
  return (await callable({ userId, coachUid })).data
}

function functionsOrThrow() {
  if (!firebaseFunctions) throw new Error('Firebase Functions chưa được cấu hình.')
  return firebaseFunctions
}

export async function listNutritionMealReviews(
  status: NutritionReviewStatus | 'all' = 'all',
  limit = 24,
) {
  const callable = httpsCallable<
    { status: NutritionReviewStatus | 'all'; limit: number },
    NutritionReviewListResult
  >(functionsOrThrow(), 'listNutritionMealReviews')
  return (await callable({ status, limit })).data
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
