const fixture = () => (window as any).nutritionFixture
export function request(name: string, input: any, value: any) {
  const item = { name, input, id: fixture().calls.length }
  fixture().calls.push(item)
  if (fixture().hold.includes(name)) return new Promise<any>((resolve, reject) => fixture().pending.set(item.id, { resolve, reject, value }))
  return Promise.resolve(value)
}
export function subscribe(kind: string, owner: string, date: string, receive: (items: any[]) => void, _: any, sync: any) {
  const item = { kind, owner, date, stopped: false, emit: () => { receive(fixture().dayMeals?.[owner]?.[date] ?? []); sync?.({ status: 'synced', revision: 1, cachedAt: 'server' }) } }
  fixture().listeners.push(item)
  queueMicrotask(() => { if (!item.stopped && !fixture().holdListenerOwners?.includes(owner)) item.emit() })
  return () => { item.stopped = true }
}
export const subscribeToUserMealLogsForDate = (...args: any[]) => (subscribe as any)('meals', ...args)
export const subscribeToUserWaterLogsForDate = (...args: any[]) => (subscribe as any)('water', ...args)
export const subscribeToUserActivityLogsForDate = (...args: any[]) => (subscribe as any)('activities', ...args)
function history(kind: string, owner: string, fromDate: string, sync: any, toDate: string) {
  sync?.({ status: 'synced', revision: 1, cachedAt: 'server' })
  return request(kind, { owner, fromDate, toDate }, [])
}
export const loadRecentUserMealLogs = (...args: any[]) => (history as any)('history-meals', ...args)
export const loadRecentUserWaterLogs = (...args: any[]) => (history as any)('history-water', ...args)
export const loadRecentUserActivityLogs = (...args: any[]) => (history as any)('history-activities', ...args)
export const getMyNutritionJournalSummary = (owner: string, fromDate: string, toDate: string, authority: string, forceRefresh: boolean, refreshAfter?: string) => request('summary', { owner, fromDate, toDate, authority, forceRefresh, refreshAfter }, { fromDate, toDate, coverage: fixture().coverage, items: [{ date: fromDate, mealCount: 2, calories: 432, protein: 25, waterMl: 600, activityCount: 1, reviewCount: 0 }] })
export const getMyNutritionPlanWorkspace = (week: string, options: any) => request('workspace', { week, options }, { plan: null, activePlan: null })
export const generateMyNutritionPlanDraft = (input: any) => request('generate-plan', input, null)
export const confirmMyNutritionPlan = async () => ({ plan: null, activePlan: null })
export const mutateMyNutritionPlanMeal = async () => null
export const nutritionPlanErrorMessage = (error: Error) => error.message
export const saveUserMealLog = async (_owner: string, meal: any) => ({ mealId: meal.id, mealRevision: (meal.mealRevision ?? 0) + 1 })
export const deleteUserMealLog = async () => ({})
export const saveUserWaterLog = async () => {}
export const deleteUserWaterLog = async () => {}
export const saveUserActivityLog = async () => {}
export const deleteUserActivityLog = async () => {}
export const submitMealReview = async () => {}
export const mealPhotoUrl = async () => ''
export const trackProductEvent = async () => {}
export const askAiCoach = (question: string) => request('assistant', { question }, `Answer ${question}`)
export const askAiCoachDetailed = (question: string) => request('assistant', { question }, { text: question, dataUsed: [] })
export const uploadAiCoachPhoto = async () => ({})
export const compressBase64Image = async (value: string) => value
