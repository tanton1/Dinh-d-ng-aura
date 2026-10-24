import type { NutritionMealReview, NutritionReviewListResult } from '../../src/services/nutritionReviewService'
export type { NutritionMealReview, NutritionReviewStatus } from '../../src/services/nutritionReviewService'

const record = (id: string, overdue: boolean): NutritionMealReview => ({
  id, userId: `student-${id}`, studentName: overdue ? 'Học viên An' : 'Học viên Bình', studentGoal: 'Ăn cân bằng, vận động đều đặn', studentCondition: '',
  assignedCoachId: 'coach', assignedCoachIds: ['coach'], assignedCoachName: 'Coach Aura',
  createdAt: Date.now() - (overdue ? 180 : 20) * 60_000, slaDueAt: Date.now() - (overdue ? 60 : -100) * 60_000,
  waitMinutes: overdue ? 180 : 20, overdueMinutes: overdue ? 60 : 0, isOverdue: overdue, time: '12:00',
  image: '', imageStoragePath: '', note: 'Cơm gà, rau xanh và canh', mealType: 'Bữa trưa',
  totalKcal: 430, totalProtein: 32, totalCarb: 48, totalFat: 13, fiber: 5, targetKcal: 1800, targetProtein: 110,
  status: 'pending', priority: 'normal', aiScore: 0, confidence: 'medium', coachFeedback: '', revision: 1, mealRevision: 1,
  snapshotHash: 'test', calorieRange: null, unresolvedQuestions: [], nutrientSources: {}, items: [], suggestions: [],
  analysis: { quantityAndCookingAnalysis: '', portionAndCalorieRationale: '', goalAlignmentAssessment: '', calorieOptimizationTip: '', macroBalanceAssessment: '', aiSuggestion: '', aiFeedback: '', coachFeedbackSuggestion: '' },
})

const rows = [record('old', true), record('recent', false)]
export const control = {
  reads: [] as Record<string, unknown>[], writes: [] as Record<string, unknown>[],
  summaryReads: [] as unknown[], directoryReads: [] as unknown[],
  failSummary: false, holdSummary: false, releaseSummary: () => {},
  failNext: false, failMutation: false, holdMutation: false, holdRead: false,
  readName: '',
  releaseMutation: () => {}, releaseRead: () => {},
}
Object.assign(window, { reviewTest: control })

export async function listNutritionMealReviews(input: Record<string, unknown>): Promise<NutritionReviewListResult> {
  control.reads.push(input)
  const readName = control.readName
  if (control.holdRead) await new Promise<void>((resolve) => { control.releaseRead = resolve })
  if (control.failNext) { control.failNext = false; throw new Error('Dịch vụ đang bận. Hãy tải lại.') }
  const result = resultFor(input)
  return readName ? { ...result, reviews: result.reviews.map((row) => ({ ...row, studentName: readName })) } : result
}

function resultFor(input: Record<string, unknown>): NutritionReviewListResult {
  const reviews = rows.filter((row) => (!input.status || input.status === 'all' || row.status === input.status)
    && (input.focus !== 'overdue' || (row.status === 'pending' && row.isOverdue))
    && (!input.query || row.studentName.includes(String(input.query))))
  return {
    reviews, coaches: [{ id: 'coach', name: 'Coach Aura', positions: [], branchIds: [] }], scope: 'all', assignmentCount: 2,
    hasMore: false, nextCursor: null, filteredCount: reviews.length, filteredCountExact: !input.query,
    summary: { total: 2, pending: rows.filter((row) => row.status === 'pending').length, approved: rows.filter((row) => row.status === 'approved').length, rejected: 0, overdue: rows.filter((row) => row.isOverdue && row.status === 'pending').length, highPriority: 0, students: 2 },
    summaryTruncated: false, slaMinutes: 120,
  }
}

export async function getNutritionReviewSummary(authorityKey: string, forceRefresh: boolean) {
  control.summaryReads.push({ authorityKey, forceRefresh })
  const result = resultFor({})
  if (control.holdSummary) await new Promise<void>((resolve) => { control.releaseSummary = resolve })
  if (control.failSummary) { control.failSummary = false; throw new Error('Tổng quan đang bận.') }
  return result
}

export async function getNutritionReviewCoaches(authorityKey: string, directoryCursor: string | null) {
  control.directoryReads.push({ authorityKey, directoryCursor })
  return { coaches: resultFor({}).coaches, scope: 'all', coachesHasMore: false, coachesNextCursor: null }
}

export async function reviewNutritionMeal(input: Record<string, unknown>) {
  control.writes.push(input)
  if (control.failMutation) { control.failMutation = false; throw new Error('Chưa nhận được kết quả. Hãy tải lại để kiểm tra trạng thái.') }
  if (control.holdMutation) await new Promise<void>((resolve) => { control.releaseMutation = resolve })
  const item = rows.find((row) => row.id === input.reviewId)!
  item.status = input.action === 'approve' ? 'approved' : input.action === 'reject' ? 'rejected' : item.status
  item.isOverdue = item.status === 'pending' && item.isOverdue
  item.revision += 1
  return { reviewId: item.id, status: item.status, revision: item.revision, reviewedAt: Date.now() }
}
