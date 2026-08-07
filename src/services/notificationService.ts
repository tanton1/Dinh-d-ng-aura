import { collection, doc, onSnapshot, orderBy, query, setDoc, updateDoc, serverTimestamp, getDocs, writeBatch, where } from 'firebase/firestore'
import { firestoreDb } from '../lib/firebase'
import type { AppNotification } from '../types'

export function subscribeToUserNotifications(
  userId: string,
  onData: (notifications: AppNotification[]) => void,
  onError?: (error: Error) => void
) {
  if (!firestoreDb) return () => {}
  
  const q = query(
    collection(firestoreDb, 'users', userId, 'notifications'),
    orderBy('createdAt', 'desc')
  )
  
  return onSnapshot(
    q,
    (snapshot) => {
      const items = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as AppNotification))
      onData(items)
    },
    (error) => {
      if (onError) onError(error)
    }
  )
}

export async function markNotificationAsRead(userId: string, notificationId: string) {
  if (!firestoreDb) return
  const ref = doc(firestoreDb, 'users', userId, 'notifications', notificationId)
  await updateDoc(ref, { read: true, updatedAt: serverTimestamp() })
}

export async function markAllNotificationsAsRead(userId: string) {
  if (!firestoreDb) return
  const q = query(
    collection(firestoreDb, 'users', userId, 'notifications'),
    where('read', '==', false)
  )
  const snap = await getDocs(q)
  if (snap.empty) return
  
  const batch = writeBatch(firestoreDb)
  snap.docs.forEach(d => {
    batch.update(d.ref, { read: true, updatedAt: serverTimestamp() })
  })
  await batch.commit()
}

export async function createNotification(userId: string, notification: Omit<AppNotification, 'id' | 'createdAt' | 'userId' | 'read'>) {
  if (!firestoreDb) return
  const ref = doc(collection(firestoreDb, 'users', userId, 'notifications'))
  await setDoc(ref, {
    id: ref.id,
    userId,
    ...notification,
    read: false,
    createdAt: serverTimestamp(),
  })
}
