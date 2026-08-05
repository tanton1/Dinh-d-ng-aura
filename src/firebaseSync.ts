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
  status: 'pending' | 'approved' | 'rejected'
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
    mealObj.userGoal ||
    mealObj.studentGoal ||
    r.userGoal ||
    'Siết cơ giảm mỡ (Tăng cơ nạc, thâm hụt calo nhẹ)'

  const studentCondition =
    r.studentCondition ||
    mealObj.userCondition ||
    mealObj.studentCondition ||
    r.userCondition ||
    'Nữ, 55kg, Chiều cao 162cm, TDEE 1800 kcal'

  const formattedTime = mealObj.date && mealObj.time
    ? `${mealObj.date} ${mealObj.time}`
    : mealObj.mealDate
    ? `${mealObj.mealDate} ${mealObj.mealTime || ''}`
    : mealObj.time || (r.createdAt?.toDate
    ? new Date(r.createdAt.toDate()).toLocaleString('vi-VN')
    : 'Hôm nay')

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
    status: r.status || 'pending',
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
