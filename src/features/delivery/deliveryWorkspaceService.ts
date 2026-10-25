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
