import { DEFAULT_DELIVERY_OPERATIONS_CONFIG } from '../../src/features/delivery/types'
const state = { reads: { driver: 0, dispatch: 0, tracking: 0 }, subscriptions: [] as string[], active: [] as string[], delayed: false, pending: [] as Array<() => void>, terminal: false }
Object.assign(window, { costState: state })
const job = { id: 'order-a', orderCode: 'ORDER-A', status: 'assigned', pickup: { name: 'Kitchen', addressLine: 'Kitchen address' }, dropoff: { name: 'Customer', addressLine: 'Destination' }, distanceMeters: 2000, routeDurationSeconds: 600, itemCount: 2, cashToCollect: 0 }
const driver = { id: 'driver', name: 'Test driver', available: true, activeJobCount: 1 }
const readiness = { dispatchReady: true, realtimeDatabaseReady: true, otpKeyAvailable: true }
const read = async (kind: keyof typeof state.reads) => {
  state.reads[kind]++
  if (state.delayed) await new Promise<void>(resolve => state.pending.push(resolve))
}
export const listMyEatCleanDeliveryJobs = async () => { await read('driver'); return { jobs: [{ ...job }], driver: { ...driver }, readiness } }
export const acceptEatCleanDelivery = async () => ({ ...job, status: 'accepted' })
export const updateEatCleanDeliveryMilestone = async (_id: string, status: string) => ({ ...job, status })
export const completeEatCleanDelivery = async () => ({ ...job, status: 'completed' })
export const setEatCleanDriverAvailability = async (available: boolean) => ({ ...driver, available })
export const getDeliveryServiceError = () => 'Fixture error'
export const useDriverLocationPublisher = () => ({ state: 'idle', message: '', stop() {}, start() {} })
export const listEatCleanDispatchSnapshot = async () => {
  await read('dispatch')
  return { jobs: [], drivers: [], config: { ...DEFAULT_DELIVERY_OPERATIONS_CONFIG }, readiness, signals: { mapsErrorsToday: 0, otpRejected: 0, otpLocked: 0, gpsStale: 0, lateOrders: 0 } }
}
export const assignEatCleanShipper = async () => ({ ...job })
export const saveEatCleanDeliveryOperationsConfig = async (value: unknown) => value
export const getEatCleanOrderTracking = async (id: string) => { await read('tracking'); return { orderId: id, status: state.terminal ? 'delivered' : 'delivering', shipper: { displayName: id } } }
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
