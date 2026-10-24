import { httpsCallable } from 'firebase/functions'
import { firebaseFunctions } from '../lib/firebaseFunctions'
import { firebaseAuth } from '../lib/firebase'
import { runKeyedSingleFlight } from '../utils/singleFlight'
import { runNutritionAiRequest } from './nutritionAiRequest'

export type NutritionPlanStatus = 'draft' | 'active'
export type NutritionPlanSource = 'aura-catalog' | 'assigned'
export type NutritionPlanMealType = 'breakfast' | 'lunch' | 'snack' | 'dinner'

export interface NutritionPlanMeal {
  id: string
  catalogId: string
  dayId: string
  type: NutritionPlanMealType
  time: string
  title: string
  description: string
  calories: number
  protein: number
  carbs: number
  fat: number
  image: string
  source: string
  servingMultiplier: number
  rationale: string
}

export interface NutritionPlanRecord {
  schemaVersion: number
  weekStart: string
  status: NutritionPlanStatus
  revision: number
  source: NutritionPlanSource
  sourceTitle: string
  validationIssues?: string[]
  planner?: 'catalog' | 'gemini'
  targets: {
    calories?: number
    protein?: number
    carbs?: number
    fat?: number
    formulaVersion?: string
    mealsPerDay?: number
  }
  days: Array<{ id: string; meals: NutritionPlanMeal[] }>
  updatedAt: string | null
}

export interface NutritionPlanWorkspaceResponse {
  plan: NutritionPlanRecord | null
  activePlan: NutritionPlanRecord | null
  assignedPlanAvailable: boolean
}

function functionsClient() {
  if (!firebaseFunctions) throw new Error('Dịch vụ kế hoạch dinh dưỡng chưa sẵn sàng.')
  return firebaseFunctions
}

function callable<Input, Output>(name: string, timeout = 30_000) {
  return httpsCallable<Input, Output>(functionsClient(), name, { timeout })
}

const workspaceRequests = new Map<string, Promise<NutritionPlanWorkspaceResponse>>()

export function invalidateNutritionPlanWorkspace(weekStart: string, ownerId = firebaseAuth?.currentUser?.uid) {
  for (const key of workspaceRequests.keys()) {
    const [owner, week] = JSON.parse(key) as string[]
    if (owner === ownerId && week === weekStart) workspaceRequests.delete(key)
  }
}

export function getMyNutritionPlanWorkspace(weekStart: string, options: { authorityKey?: string; ownerId?: string; forceRefresh?: boolean } = {}) {
  const ownerId = firebaseAuth?.currentUser?.uid
  if (!ownerId || (options.ownerId && options.ownerId !== ownerId)) return Promise.reject(new Error('Phiên đăng nhập đã thay đổi. Hãy mở lại kế hoạch.'))
  const key = JSON.stringify([ownerId, weekStart, options.authorityKey ?? '', options.forceRefresh === true])
  if (!workspaceRequests.has(key) && workspaceRequests.size >= 64) workspaceRequests.delete(workspaceRequests.keys().next().value!)
  return runKeyedSingleFlight(workspaceRequests, key, async () => {
    if (firebaseAuth?.currentUser?.uid !== ownerId) throw new Error('Phiên đăng nhập đã thay đổi.')
    const invoke = callable<{ weekStart: string }, NutritionPlanWorkspaceResponse>('getMyNutritionPlanWorkspace')
    return (await invoke({ weekStart })).data
  })
}

export async function generateMyNutritionPlanDraft(input: {
  weekStart: string
  expectedRevision: number
  calorieGoal: number
  proteinGoal: number
  mealsPerDay: number
  goal: 'lose-fat' | 'gain-muscle' | 'maintain'
  allergies?: string
  dislikes?: string
  aiAssist?: boolean
  profile?: {
    age?: number
    biologicalSex?: string
    activityLevel?: string
    trainingSessions?: number
    eatingStyle?: string
    favoriteCuisine?: string
    budget?: string
    prepTime?: string
  }
}) {
  const ownerId = firebaseAuth?.currentUser?.uid
  if (!ownerId) throw new Error('Bạn cần đăng nhập để tạo kế hoạch dinh dưỡng.')
  const payload = { ...input, requestId: `nutrition-plan-${crypto.randomUUID()}`, expectedOwnerUid: ownerId }
  const invoke = callable<typeof payload, { plan: NutritionPlanRecord }>('generateMyNutritionPlanDraft', 120_000)
  invalidateNutritionPlanWorkspace(input.weekStart, ownerId)
  try { return (await runNutritionAiRequest(() => invoke(payload), { expectedOwnerUid: ownerId, currentOwnerUid: () => firebaseAuth?.currentUser?.uid })).data.plan }
  finally { invalidateNutritionPlanWorkspace(input.weekStart, ownerId) }
}

export async function mutateMyNutritionPlanMeal(input: {
  action: 'add' | 'replace' | 'remove'
  weekStart: string
  dayId: string
  mealId?: string
  catalogId?: string
  type: NutritionPlanMealType
  time: string
  servingMultiplier?: number
  expectedRevision: number
}) {
  const invoke = callable<typeof input, { plan: NutritionPlanRecord }>('mutateMyNutritionPlanMeal')
  const ownerId = firebaseAuth?.currentUser?.uid
  invalidateNutritionPlanWorkspace(input.weekStart, ownerId)
  try { return (await invoke(input)).data.plan }
  finally { invalidateNutritionPlanWorkspace(input.weekStart, ownerId) }
}

export async function confirmMyNutritionPlan(weekStart: string, expectedRevision: number) {
  const invoke = callable<{ weekStart: string; expectedRevision: number }, { plan: NutritionPlanRecord; activePlan: NutritionPlanRecord }>('confirmMyNutritionPlan')
  const ownerId = firebaseAuth?.currentUser?.uid
  invalidateNutritionPlanWorkspace(weekStart, ownerId)
  try { return (await invoke({ weekStart, expectedRevision })).data }
  finally { invalidateNutritionPlanWorkspace(weekStart, ownerId) }
}

export function nutritionPlanErrorMessage(error: unknown) {
  if (!error || typeof error !== 'object') return 'Không thể cập nhật kế hoạch. Hãy thử lại.'
  const value = error as { code?: unknown; message?: unknown }
  const code = String(value.code ?? '').replace(/^functions\//, '')
  if (code === 'aborted') return 'Kế hoạch vừa thay đổi ở thiết bị khác. Aura đã tải lại bản mới nhất.'
  if (code === 'unavailable' || code === 'deadline-exceeded') return 'Kết nối chưa ổn định. Hãy thử lại sau ít phút.'
  if (code === 'unauthenticated' || code === 'permission-denied') return 'Phiên đăng nhập không còn quyền mở kế hoạch này.'
  return typeof value.message === 'string' && value.message.trim()
    ? value.message.replace(/^Firebase:\s*/i, '').replace(/\s*\(functions\/[^)]+\)\.?$/i, '')
    : 'Không thể cập nhật kế hoạch. Hãy thử lại.'
}
