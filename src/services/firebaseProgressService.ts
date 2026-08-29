import { collection, deleteDoc, doc, limit, onSnapshot, orderBy, query, serverTimestamp, setDoc, type Unsubscribe } from 'firebase/firestore'
import { getDownloadURL, ref as storageRef, uploadBytesResumable } from 'firebase/storage'
import { firebaseStorage, firestoreDb } from '../lib/firebase'
import { safeLocalStorageSet } from '../lib/safeStorage'

function requireDb() {
  if (!firestoreDb) throw new Error('Firebase chưa được cấu hình. Hãy kiểm tra file .env.local.')
  return firestoreDb
}

function clean<T>(value: T): T {
  if (Array.isArray(value)) return value.map(clean) as T
  if (value && typeof value === 'object') {
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) return value
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).flatMap(([key, item]) => item === undefined ? [] : [[key, clean(item)]])) as T
  }
  return value
}

function cacheKey(key: string) { return `aura:cache:${key}` }
function readCache<T>(key: string, fallback: T): T {
  try {
    const raw = typeof window !== 'undefined' ? window.localStorage.getItem(cacheKey(key)) : null
    return raw ? JSON.parse(raw) as T : fallback
  } catch { return fallback }
}
function writeCache(key: string, value: unknown) { safeLocalStorageSet(cacheKey(key), JSON.stringify(value)) }

async function saveProgressDocument(userId: string, collectionName: string, documentId: string, value: Record<string, unknown>, includeCreatedAt = false) {
  await setDoc(doc(requireDb(), 'users', userId, collectionName, documentId), clean({
    ...value,
    updatedAt: serverTimestamp(),
    ...(includeCreatedAt ? { createdAt: value.createdAt ?? serverTimestamp() } : {}),
  }), { merge: true })
}

function subscribeToDocument(userId: string, collectionName: string, documentId: string, cacheName: string, onData: (value: any) => void, onError?: (error: Error) => void): Unsubscribe {
  return onSnapshot(doc(requireDb(), 'users', userId, collectionName, documentId), (snapshot) => {
    const value = snapshot.exists() ? snapshot.data() : null
    writeCache(`${cacheName}:${userId}`, value)
    onData(value)
  }, (error) => {
    onData(readCache(`${cacheName}:${userId}`, null))
    onError?.(error)
  })
}

function subscribeToCollection(userId: string, collectionName: string, cacheName: string, onData: (items: any[]) => void, onError?: (error: Error) => void): Unsubscribe {
  return onSnapshot(collection(requireDb(), 'users', userId, collectionName), (snapshot) => {
    const items = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }))
    writeCache(`${cacheName}:${userId}`, items)
    onData(items)
  }, (error) => {
    onData(readCache(`${cacheName}:${userId}`, []))
    onError?.(error)
  })
}

export async function saveUserWeightLog(userId: string, record: Record<string, unknown> & { id: string }) { await saveProgressDocument(userId, 'weightLogs', record.id, record, true) }
export async function deleteUserWeightLog(userId: string, recordId: string) { await deleteDoc(doc(requireDb(), 'users', userId, 'weightLogs', recordId)) }
export function subscribeToUserWeightLogs(userId: string, onData: (records: any[]) => void, onError?: (error: Error) => void) {
  const reference = query(
    collection(requireDb(), 'users', userId, 'weightLogs'),
    orderBy('date', 'desc'),
    limit(365),
  )
  return onSnapshot(reference, (snapshot) => {
    const items = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }))
    writeCache(`user_weight_logs:${userId}`, items)
    onData(items)
  }, (error) => {
    onData(readCache(`user_weight_logs:${userId}`, []))
    onError?.(error)
  })
}

export async function saveUserBodyMeasurements(userId: string, measurements: Record<string, unknown>) { await saveProgressDocument(userId, 'bodyMeasurements', 'current', measurements) }
export function subscribeToUserBodyMeasurements(userId: string, onData: (value: any) => void, onError?: (error: Error) => void) { return subscribeToDocument(userId, 'bodyMeasurements', 'current', 'user_body_measurements', onData, onError) }

export async function saveUserGamification(userId: string, data: Record<string, unknown>) { await saveProgressDocument(userId, 'gamification', 'stats', data) }
export function subscribeToUserGamification(userId: string, onData: (value: any) => void, onError?: (error: Error) => void) { return subscribeToDocument(userId, 'gamification', 'stats', 'user_gamification', onData, onError) }

export async function saveUserProgressPhoto(userId: string, photo: Record<string, unknown> & { id: string }) { await saveProgressDocument(userId, 'progressPhotos', photo.id, photo, true) }
export async function deleteUserProgressPhoto(userId: string, photoId: string) { await deleteDoc(doc(requireDb(), 'users', userId, 'progressPhotos', photoId)) }
export function subscribeToUserProgressPhotos(userId: string, onData: (photos: any[]) => void, onError?: (error: Error) => void) { return subscribeToCollection(userId, 'progressPhotos', 'user_progress_photos', onData, onError) }

export async function uploadUserProgressPhoto(userId: string, file: File, onProgress?: (percent: number) => void): Promise<string> {
  if (!firebaseStorage) throw new Error('Firebase Storage is not initialized.')
  const extension = file.name.split('.').pop() ?? 'jpg'
  const reference = storageRef(firebaseStorage, `users/${userId}/progress-photos/${Date.now()}-${Math.random().toString(36).slice(2)}.${extension}`)
  return new Promise((resolve, reject) => {
    const task = uploadBytesResumable(reference, file)
    task.on('state_changed', (snapshot) => onProgress?.(Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100)), reject, async () => {
      try { resolve(await getDownloadURL(task.snapshot.ref)) } catch (error) { reject(error) }
    })
  })
}
