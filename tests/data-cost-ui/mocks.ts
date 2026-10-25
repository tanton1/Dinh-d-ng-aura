import { DEFAULT_DELIVERY_OPERATIONS_CONFIG } from '../../src/features/delivery/types'
import { runKeyedSingleFlight } from '../../src/utils/singleFlight'
const state = { reads: { driver: 0, dispatch: 0, tracking: 0 }, subscriptions: [] as string[], active: [] as string[], delayed: false, pending: [] as Array<() => void>, terminal: false }
Object.assign(state, { gpsCalls: [], gpsDelayed: false, gpsPending: [], gpsError: '' })
Object.assign(state, { summaryCalls: [], summaryPending: [], summaryHold: false, summaryCoverage: 'ready', ...(window as any).costInitial })
Object.assign(window, { costState: state })
const deliveryState = state as any
Object.assign(deliveryState, { driverAccount: 'driver', driverScope: 'shipper', deliveryVersions: {}, deliveryObservers: [], gpsStops: 0 })
const deliveryVersion = (n: number) => n ? `${String(n).padStart(12, '0')}.000000000` : '0'
export const subscribeDeliveryRevision = (path: string, next: (value: string) => void, error: (error: unknown) => void) => {
  const observer = { path, next, error, active: true }
  deliveryState.deliveryObservers.push(observer)
  queueMicrotask(() => { if (observer.active) next(deliveryVersion(deliveryState.deliveryVersions[path] || 0)) })
  return () => { observer.active = false }
}
export const subscribeDeliveryAccess = (account: string, next: (value: any) => void, error: (error: unknown) => void) => {
  const observer = { path: `users/${account}`, next, error, active: true }
  deliveryState.deliveryObservers.push(observer)
  queueMicrotask(() => { if (observer.active) next({ role: deliveryState.driverScope === 'dispatch' ? 'admin' : 'shipper', disabled: false }) })
  return () => { observer.active = false }
}
Object.assign(window, { emitDeliveryRevision(path: string, n: number) {
  deliveryState.deliveryVersions[path] = n
  deliveryState.deliveryObservers.filter((item: any) => item.active && item.path === path).forEach((item: any) => item.next(deliveryVersion(n)))
}, failDeliveryRevision(code: string) {
  deliveryState.deliveryObservers.filter((item: any) => item.active).forEach((item: any) => item.error({ code }))
} })
const job = { id: 'order-a', orderCode: 'ORDER-A', status: 'assigned', pickup: { name: 'Kitchen', addressLine: 'Kitchen address' }, dropoff: { name: 'Customer', addressLine: 'Destination' }, distanceMeters: 2000, routeDurationSeconds: 600, itemCount: 2, cashToCollect: 0 }
const driver = { id: 'driver', name: 'Test driver', available: true, activeJobCount: 1 }
const readiness = { dispatchReady: true, realtimeDatabaseReady: true, otpKeyAvailable: true }
const read = async (kind: keyof typeof state.reads) => {
  state.reads[kind]++
  if (state.delayed) await new Promise<void>(resolve => state.pending.push(resolve))
}
export const listMyEatCleanDeliveryJobs = async () => {
  const accountId = deliveryState.driverAccount, scope = deliveryState.driverScope
  const path = scope === 'dispatch' ? 'eatCleanWorkspaceChanges/dispatch' : `eatCleanDriverChanges/${accountId}`
  const result = { jobs: [{ ...job, orderCode: deliveryState.jobCode || job.orderCode, status: deliveryState.jobStatus || job.status,
    promisedAt: deliveryState.slaMillis ? new Date(Date.now() + deliveryState.slaMillis).toISOString() : undefined }], driver: { ...driver, id: accountId }, readiness,
    workspaceSync: deliveryState.omitSync ? undefined : { schemaVersion: 1, accountId, scope, version: 'fixture', userVersion: deliveryVersion(deliveryState.deliveryVersions[path] || 0), policyVersion: deliveryVersion(deliveryState.deliveryVersions['eatCleanWorkspaceChanges/config'] || 0) } }
  await read('driver')
  if (deliveryState.driverError) throw Object.assign(new Error(deliveryState.driverError), { code: deliveryState.driverError })
  return result
}
const deliveryMutation = async (status: string) => {
  deliveryState.jobStatus = status
  if (deliveryState.holdMutation) await new Promise<void>(resolve => deliveryState.mutationPending = resolve)
  return { ...job, status }
}
export const acceptEatCleanDelivery = async () => deliveryMutation('accepted')
export const updateEatCleanDeliveryMilestone = async (_id: string, status: string) => deliveryMutation(status)
export const completeEatCleanDelivery = async () => deliveryMutation('completed')
export const setEatCleanDriverAvailability = async (available: boolean) => ({ ...driver, available })
export const getDeliveryServiceError = () => 'Fixture error'
export const useDriverLocationPublisher = () => ({ state: 'idle', message: '', stop() { deliveryState.gpsStops++ }, start() {} })
export const publishEatCleanDriverLocation = async (deliveryId: string, driverId: string, position: GeolocationPosition) => {
  const gps = state as any
  gps.gpsCalls.push({ deliveryId, driverId, position, at: Date.now() })
  if (gps.gpsDelayed) await new Promise<void>(resolve => gps.gpsPending.push(resolve))
  if (gps.gpsError) throw Object.assign(new Error('GPS test error'), { code: gps.gpsError })
  return { accepted: true }
}
export const listEatCleanDispatchSnapshot = async () => {
  await read('dispatch')
  return { jobs: [], drivers: [], config: { ...DEFAULT_DELIVERY_OPERATIONS_CONFIG }, readiness, signals: { mapsErrorsToday: 0, otpRejected: 0, otpLocked: 0, gpsStale: 0, lateOrders: 0 } }
}
export const assignEatCleanShipper = async () => ({ ...job })
export const saveEatCleanDeliveryOperationsConfig = async (value: unknown) => value
export const getEatCleanOrderTracking = async (id: string) => {
  const error = deliveryState.trackingError
  await read('tracking')
  if (error) throw Object.assign(new Error('Tracking fixture failure'), { code: error })
  return { orderId: id, status: state.terminal ? 'delivered' : 'delivering', shipper: { displayName: id },
    ...(deliveryState.trackingSensitive ? { deliveryOtp: '1234', shipperLocation: { latitude: 16, longitude: 108 } } : {}) }
}
export const googleMapsConfigured = () => false
export const loadGoogleMaps = async () => null
export const loadGooglePlaces = async () => null
export const getGoogleMapsClientHealth = () => ({})
export const googleMapsClientMessage = () => ''
export const firebaseAuth = { currentUser: { uid: 'student-a' } }
export const getMyLoyaltyDashboard = async () => null
export const demoLoyaltyDashboard = () => null
export const AiCoachBottomSheet = () => null
export const prewarmAiCoachAppCheck = () => {}
const unused = async () => { throw new Error('Unexpected progress mutation') }
export const saveUserProgressPhoto = unused, deleteUserProgressPhoto = unused, saveUserGamification = unused
export const subscribeToUserGamification = () => () => {}
const subscribe = (name: string, owner: string, callback: (value: any) => void, value: unknown = []) => {
  const key = `${name}:${owner}`
  state.subscriptions.push(key); state.active.push(key)
  let active = true
  queueMicrotask(() => { if (active) callback(value) })
  return () => { if (active) { active = false; state.active.splice(state.active.indexOf(key), 1) } }
}
export const subscribeToUserWeightLogs = (owner: string, callback: any) => subscribe('weight', owner, callback)
export const subscribeToUserBodyMeasurements = (owner: string, callback: any) => subscribe('body', owner, callback, null)
export const subscribeToUserProgressCheckIns = (owner: string, callback: any) => subscribe('checkins', owner, callback)
export const subscribeToUserProgressPhotos = (owner: string, callback: any) => subscribe('photos', owner, callback)
export const subscribeToRecentUserActivityLogs = (owner: string, _date: string, callback: any) => subscribe('activity', owner, callback)
export const subscribeToRecentUserMealLogs = (owner: string, _date: string, callback: any) => subscribe('meals', owner, callback)
export const subscribeToRecentUserWaterLogs = (owner: string, _date: string, callback: any) => subscribe('water', owner, callback)
const summaries = new Map<string, Promise<any>>()
export const getMyNutritionJournalSummary = (owner: string, fromDate: string, toDate: string, authority: string, forceRefresh: boolean, refreshAfter?: string) => runKeyedSingleFlight(summaries, JSON.stringify([owner, fromDate, toDate, authority, forceRefresh, refreshAfter]), async () => {
  const config = state as any
  const index = config.summaryCalls.push({ owner, fromDate, toDate, forceRefresh, refreshAfter }) - 1
  const dates = []
  for (let day = Date.parse(`${fromDate}T00:00:00Z`); day <= Date.parse(`${toDate}T00:00:00Z`); day += 86_400_000) dates.push(new Date(day).toISOString().slice(0, 10))
  const response = { fromDate, toDate, coverage: config.summaryCoverageByFrom?.[fromDate] ?? config.summaryCoverage,
    ...(forceRefresh || refreshAfter ? { refreshAfter: refreshAfter || new Date().toISOString() } : {}),
    items: dates.map(date => ({ date, mealCount: 5, calories: 1800, protein: 100, carbs: 200, fat: 60, waterMl: 3000, activityCount: 1, activityMinutes: 30, reviewCount: 0, revision: 1, updatedAt: new Date().toISOString(),
      ...(config.summaryOldSchema ? {} : { mealOccasions: { breakfast: true, lunch: true, dinner: true, snackCount: 2 } }) })) }
  if (config.summaryMissingDay) response.items.pop()
  config.summaryCalls[index].responseRefreshAfter = response.refreshAfter
  if (config.summaryHold) return new Promise((resolve, reject) => { config.summaryPending[index] = (error?: string) => error ? reject(new Error(error)) : resolve(response) })
  if (config.summaryError) throw new Error(config.summaryError)
  return response
})
