import { httpsCallable } from 'firebase/functions'
import { firebaseFunctions } from '../lib/firebase'

type AuraAiAction =
  | 'course-outline'
  | 'course-quiz'
  | 'course-memory'
  | 'lesson-summary'
  | 'recipe'
  | 'meal-plan'

interface AuraAiResponse<T> {
  action: AuraAiAction
  data: T
  model: string
  providerRequestId: string | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

async function generateAuraContent<T>(action: AuraAiAction, payload: Record<string, unknown>): Promise<T> {
  if (!firebaseFunctions) throw new Error('Firebase Functions chưa được cấu hình.')
  const callable = httpsCallable<
    { action: AuraAiAction; payload: Record<string, unknown> },
    AuraAiResponse<T>
  >(firebaseFunctions, 'generateAuraContent', { timeout: 60_000 })
  const response = await callable({ action, payload })
  if (response.data?.action !== action || !isRecord(response.data?.data)) {
    throw new Error('Phản hồi AI không hợp lệ.')
  }
  return response.data.data
}

export interface GeneratedCourseOutline {
  title: string
  description: string
  modules: Array<{ title: string; lessons: Array<{ title: string; summary: string }> }>
}

export interface GeneratedCourseQuiz {
  questions: Array<{
    question: string
    options: string[]
    correctIndex: number
    explanation: string
  }>
}

export interface GeneratedCourseMemory {
  minuteSummary: string
  keyTakeaways: string[]
  terms: Array<{ term: string; definition: string }>
  recallPrompts: Array<{ prompt: string; answer: string }>
  flashcards: Array<{ front: string; back: string; hint: string }>
}

export interface GeneratedLessonSummary {
  takeaways: string[]
  keyConcepts: Array<{ term: string; definition: string }>
}

export interface GeneratedRecipe {
  name: string
  meal: 'breakfast' | 'lunch' | 'dinner' | 'snack'
  goal: 'fat-loss' | 'muscle-gain' | 'maintenance'
  kcal: number
  protein: number
  carbs: number
  fat: number
  minutes: number
  diet: string
  badge: string
  description: string
  ingredients: string[]
  instructions: string[]
}

export interface GeneratedMealPlan {
  title: string
  summary: string
  recommendations: string[]
  sampleDays: Array<{
    dayName: string
    breakfast: string
    lunch: string
    snack: string
    dinner: string
    totalKcal: number
    totalProtein: number
  }>
}

export function generateCourseOutline(payload: { topic: string; audience: string; weeks: number }) {
  return generateAuraContent<GeneratedCourseOutline>('course-outline', payload)
}

export function generateCourseQuiz(payload: { lessonTitle: string; lessonSummary: string }) {
  return generateAuraContent<GeneratedCourseQuiz>('course-quiz', payload)
}

export function generateCourseMemory(payload: { lessonTitle: string; lessonSummary: string }) {
  return generateAuraContent<GeneratedCourseMemory>('course-memory', payload)
}

export function summarizeLessonWithAi(payload: {
  courseTitle: string
  lessonTitle: string
  lessonContent: string
}) {
  return generateAuraContent<GeneratedLessonSummary>('lesson-summary', payload)
}

export function generateRecipeWithAi(payload: { prompt: string; goal: string; mealType: string }) {
  return generateAuraContent<GeneratedRecipe>('recipe', payload)
}

export function generateMealPlanWithAi(payload: {
  goal: string
  targetCalories: number
  targetProtein: number
}) {
  return generateAuraContent<GeneratedMealPlan>('meal-plan', payload)
}
