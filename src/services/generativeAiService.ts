import { httpsCallable } from 'firebase/functions'
import { firebaseAuth } from '../lib/firebase'
import { firebaseFunctions } from '../lib/firebaseFunctions'
import { runKeyedSingleFlight } from '../utils/singleFlight'
import { runContentAiRequest, type ContentAiReceiptResponse } from './contentAiRequest'

type AuraAiAction =
  | 'course-outline'
  | 'course-quiz'
  | 'course-memory'
  | 'lesson-summary'
  | 'recipe'
  | 'meal-plan'

export interface GenerateContentOptions { newDraft?: boolean }

function stableSerialize(value: unknown): string {
  if (value === undefined) return 'undefined'
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? String(value)
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableSerialize(record[key])}`).join(',')}}`
}

const inFlightContentRequests = new Map<string, Promise<unknown>>()

async function generateAuraContent<T>(action: AuraAiAction, payload: Record<string, unknown>, options: GenerateContentOptions = {}): Promise<T & { generationId: string }> {
  const functions = firebaseFunctions
  if (!functions) throw new Error('Firebase Functions chưa được cấu hình.')
  const ownerId = firebaseAuth?.currentUser?.uid
  if (!ownerId) throw new Error('Bạn cần đăng nhập để dùng AI.')
  const requestKey = `${ownerId}:${action}:${stableSerialize(payload)}`
  return runKeyedSingleFlight(inFlightContentRequests, requestKey, async () => {
    const callable = httpsCallable<
      Record<string, unknown>,
      ContentAiReceiptResponse<T>
    >(functions, 'generateAuraContent', { timeout: 60_000 })
    const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(requestKey))
    const fingerprint = Array.from(new Uint8Array(bytes), value => value.toString(16).padStart(2, '0')).join('')
    let storage: Storage | undefined
    try { storage = window.localStorage } catch { /* Default request identity remains deterministic on the server. */ }
    return runContentAiRequest<T>(action, payload, async input => (await callable(input)).data, {
      ownerUid: ownerId, currentOwnerUid: () => firebaseAuth?.currentUser?.uid,
      storageKey: `aura.content-ai.v1.${ownerId}.${fingerprint}`, defaultRequestId: `content_${fingerprint}`, storage, newDraft: options.newDraft,
    })
  }) as Promise<T & { generationId: string }>
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

export function generateCourseOutline(payload: { topic: string; audience: string; weeks: number }, options?: GenerateContentOptions) {
  return generateAuraContent<GeneratedCourseOutline>('course-outline', payload, options)
}

export function generateCourseQuiz(payload: { lessonTitle: string; lessonSummary: string }, options?: GenerateContentOptions) {
  return generateAuraContent<GeneratedCourseQuiz>('course-quiz', payload, options)
}

export function generateCourseMemory(payload: { lessonTitle: string; lessonSummary: string }, options?: GenerateContentOptions) {
  return generateAuraContent<GeneratedCourseMemory>('course-memory', payload, options)
}

export function summarizeLessonWithAi(payload: {
  courseTitle: string
  lessonTitle: string
  lessonContent: string
}, options?: GenerateContentOptions) {
  return generateAuraContent<GeneratedLessonSummary>('lesson-summary', payload, options)
}

export function generateRecipeWithAi(payload: { prompt: string; goal: string; mealType: string }, options?: GenerateContentOptions) {
  return generateAuraContent<GeneratedRecipe>('recipe', payload, options)
}

export function generateMealPlanWithAi(payload: {
  goal: string
  targetCalories: number
  targetProtein: number
}, options?: GenerateContentOptions) {
  return generateAuraContent<GeneratedMealPlan>('meal-plan', payload, options)
}
