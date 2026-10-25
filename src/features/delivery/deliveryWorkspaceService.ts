import { doc, onSnapshot } from 'firebase/firestore'
import { firestoreDb } from '../../lib/firebaseFirestore'

/** Server-confirmed metadata only; cached snapshots cannot prove current access. */
export function subscribeDeliveryRevision(path: string, next: (version: string) => void, error: (error: unknown) => void) {
  if (!firestoreDb) { queueMicrotask(() => error(new Error('Delivery realtime is unavailable'))); return () => {} }
  return onSnapshot(doc(firestoreDb, path), { includeMetadataChanges: true }, snapshot => {
    if (snapshot.metadata.fromCache || snapshot.metadata.hasPendingWrites) return
    const version = snapshot.data()?.version
    next(typeof version === 'string' && /^\d{12}\.\d{9}$/.test(version) ? version : '0')
  }, error)
}

// Explicitly observe the actor as well: do not leave cached jobs visible while
// waiting for a changed result to cause marker-rule re-evaluation.
export function subscribeDeliveryAccess(accountId: string, next: (value: { role: string; disabled: boolean }) => void, error: (error: unknown) => void) {
  if (!firestoreDb) { queueMicrotask(() => error(new Error('Delivery access is unavailable'))); return () => {} }
  return onSnapshot(doc(firestoreDb, 'users', accountId), { includeMetadataChanges: true }, snapshot => {
    if (snapshot.metadata.fromCache || snapshot.metadata.hasPendingWrites) return
    next({ role: String(snapshot.data()?.role || ''), disabled: !snapshot.exists() || snapshot.data()?.disabled === true })
  }, error)
}

export interface DeliveryLiveLocation {
  binding: string
  latitude: number
  longitude: number
  updatedAt: number
  expiresAt: number
}

/** Exact-document GPS only. Authority is enforced against current canonical
 * documents by Rules; cached snapshots never authorize or restore a point. */
export function subscribeDeliveryLocation(orderId: string, next: (value: DeliveryLiveLocation | null) => void, error: (error: unknown) => void) {
  if (!firestoreDb) { queueMicrotask(() => error(new Error('Delivery location is unavailable'))); return () => {} }
  return onSnapshot(doc(firestoreDb, 'eatCleanLiveLocationViews', orderId), { includeMetadataChanges: true }, snapshot => {
    if (snapshot.metadata.fromCache || snapshot.metadata.hasPendingWrites) return
    const value = snapshot.data()
    const expiresAt = typeof value?.expiresAt?.toMillis === 'function' ? value.expiresAt.toMillis() : 0
    next(value?.active === true && typeof value.binding === 'string' && /^[a-f0-9]{64}$/.test(value.binding)
      && Number.isFinite(value.latitude) && Math.abs(value.latitude) <= 90
      && Number.isFinite(value.longitude) && Math.abs(value.longitude) <= 180
      && Number.isFinite(value.updatedAt) && value.updatedAt > 0 && expiresAt > Date.now()
      ? { binding: value.binding, latitude: value.latitude, longitude: value.longitude, updatedAt: value.updatedAt, expiresAt } : null)
  }, error)
}

export function subscribeDispatchDailySignals(day: string, next: (mapsErrorsToday: number) => void, error: (error: unknown) => void) {
  if (!firestoreDb || !/^\d{4}-\d{2}-\d{2}$/.test(day)) { queueMicrotask(() => error(new Error('Dispatch daily signals are unavailable'))); return () => {} }
  return onSnapshot(doc(firestoreDb, 'eatCleanOperationalSignals', day), { includeMetadataChanges: true }, snapshot => {
    if (snapshot.metadata.fromCache || snapshot.metadata.hasPendingWrites) return
    const counts = snapshot.data()?.counts || {}
    next(['maps_error', 'address_error', 'route_error'].reduce((sum, key) => sum + Math.max(0, Number(counts[key]) || 0), 0))
  }, error)
}
