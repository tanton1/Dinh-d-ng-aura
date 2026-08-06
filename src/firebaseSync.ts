import {
  subscribeToAllMealReviews,
  updateMealReview,
} from './services/firebaseService'

export interface PendingMealItem {
  id: string
  userId?: string
  studentName: string
  studentGoal?: string
  studentCondition?: string
  time: string
  img: string
  note?: string
  items?: Array<{ name: string; weight?: number; kcal?: number; protein?: number }>
  totalKcal: number
  totalProtein: number
  totalCarb?: number
  totalFat?: number
  fiber?: number
  sodium?: number
  targetKcal?: number
  targetProtein?: number
  targetCarb?: number
  targetFat?: number
  targetFiber?: number
  targetSodium?: number
  status: 'pending' | 'approved' | 'rejected'
  priority?: 'high' | 'normal'
  isNew?: boolean
  mealType?: string
  aiScore?: number
  confidence?: 'low' | 'medium' | 'high'
  tags?: string[]
  ingredients?: Array<{ name: string; amount: string }>
  aiWarning?: { title: string; desc: string } | null
  aiSuggestions?: Array<{ type: 'pass' | 'warn'; text: string }>
  aiAnalysis?: {
    items?: Array<{ name: string; weight?: number; kcal?: number; protein?: number }>
    totalKcal?: number
    totalProtein?: number
    quantityAndCookingAnalysis?: string
    portionAndCalorieRationale?: string
    goalAlignmentAssessment?: string
    aiSuggestion?: string
    aiFeedback?: string
    coachFeedbackSuggestion?: string
  }
  aiFeedback?: string
  coachFeedbackSuggestion?: string
  coachFeedback?: string
}

export async function getPendingMealsFromFirestore(): Promise<PendingMealItem[]> {
  return new Promise((resolve) => {
    const unsub = subscribeToAllMealReviews((reviews) => {
      unsub()
      const meals = reviews.map((r) => mapDocToMeal(r))
      resolve(meals.filter((m) => m.status === 'pending'))
    }, () => resolve([]))
  })
}

export async function approveMealInFirestore(
  mealId: string,
  coachFeedback: string,
  approvedMealData?: any
): Promise<void> {
  await updateMealReview(mealId, {
    status: 'approved',
    coachFeedback,
    approvedMeal: approvedMealData,
  })
}

export function subscribeToRealtimeMeals(
  callback: (meals: PendingMealItem[]) => void
): () => void {
  return subscribeToAllMealReviews((reviews) => {
    const meals = reviews.map((r) => mapDocToMeal(r))
    callback(meals)
  })
}

function mapDocToMeal(r: any): PendingMealItem {
  const mealObj = r.meal || {}
  const rawImage =
    mealObj.image ||
    mealObj.imageUrl ||
    mealObj.img ||
    mealObj.fileName ||
    r.img ||
    r.image ||
    ''

  const rawKcal =
    typeof mealObj.calories === 'number'
      ? mealObj.calories
      : typeof mealObj.totalKcal === 'number'
      ? mealObj.totalKcal
      : mealObj.totals?.calories || r.totalKcal || 0

  const rawProtein =
    typeof mealObj.protein === 'number'
      ? mealObj.protein
      : typeof mealObj.totalProtein === 'number'
      ? mealObj.totalProtein
      : mealObj.totals?.protein || r.totalProtein || 0

  const rawNote =
    mealObj.description ||
    mealObj.note ||
    r.note ||
    mealObj.dishName ||
    mealObj.title ||
    ''

  const studentGoal =
    r.studentGoal ||
    mealObj.studentGoal ||
    mealObj.userGoal ||
    r.userGoal ||
    'Siết cơ giảm mỡ (Tăng cơ nạc, thâm hụt calo)'

  const studentCondition =
    r.studentCondition ||
    mealObj.studentCondition ||
    mealObj.userCondition ||
    r.userCondition ||
    'Tập gym 3-4 buổi/tuần (Chỉ số thể trạng theo nhật ký)'

  const formattedTime = mealObj.date && mealObj.time
    ? `${mealObj.date} ${mealObj.time}`
    : mealObj.mealDate
    ? `${mealObj.mealDate} ${mealObj.mealTime || ''}`
    : mealObj.time || (r.createdAt?.toDate
    ? new Date(r.createdAt.toDate()).toLocaleString('vi-VN')
    : 'Hôm nay')

  const rawCarb = typeof mealObj.carb === 'number' ? mealObj.carb : typeof mealObj.totalCarb === 'number' ? mealObj.totalCarb : r.totalCarb || mealObj.totals?.carb || 35
  const rawFat = typeof mealObj.fat === 'number' ? mealObj.fat : typeof mealObj.totalFat === 'number' ? mealObj.totalFat : r.totalFat || mealObj.totals?.fat || 12

  return {
    id: r.id,
    userId: r.userId,
    studentName: r.userName || mealObj.userName || 'Học viên Aura',
    studentGoal,
    studentCondition,
    time: formattedTime,
    img: rawImage || 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=600&auto=format&fit=crop&q=80',
    note: rawNote,
    items: mealObj.items || [],
    totalKcal: rawKcal,
    totalProtein: rawProtein,
    totalCarb: rawCarb,
    totalFat: rawFat,
    fiber: r.fiber || mealObj.fiber || 3.2,
    sodium: r.sodium || mealObj.sodium || 210,
    targetKcal: r.targetKcal || mealObj.targetKcal || 600,
    targetProtein: r.targetProtein || mealObj.targetProtein || 30,
    targetCarb: r.targetCarb || mealObj.targetCarb || 75,
    targetFat: r.targetFat || mealObj.targetFat || 20,
    targetFiber: r.targetFiber || mealObj.targetFiber || 25,
    targetSodium: r.targetSodium || mealObj.targetSodium || 1500,
    status: r.status || 'pending',
    priority: r.priority || mealObj.priority || 'normal',
    isNew: r.isNew ?? mealObj.isNew ?? false,
    mealType: r.mealType || mealObj.mealType || 'Bữa trưa',
    aiScore: r.aiScore || mealObj.aiScore || 85,
    confidence: r.confidence || mealObj.confidence || 'high',
    tags: r.tags || mealObj.tags || [],
    ingredients: r.ingredients || mealObj.ingredients || [],
    aiWarning: r.aiWarning || mealObj.aiWarning || null,
    aiSuggestions: r.aiSuggestions || mealObj.aiSuggestions || [],
    coachFeedback: r.coachFeedback || mealObj.coachFeedback,
    aiAnalysis: r.aiAnalysis || {
      items: mealObj.items || [],
      totalKcal: rawKcal,
      totalProtein: rawProtein,
      aiSuggestion: typeof mealObj.aiAnalysis === 'string' ? mealObj.aiAnalysis : 'Bữa ăn đã được đánh giá chỉ số dinh dưỡng.',
      coachFeedbackSuggestion: 'Bữa ăn đầy đủ dinh dưỡng, tiếp tục duy trì nhé!',
    },
    coachFeedbackSuggestion: 'Bữa ăn này rất tốt! Em cố gắng duy trì nhé.',
  }
}
