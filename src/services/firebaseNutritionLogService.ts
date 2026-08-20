import { collection, deleteDoc, doc, onSnapshot, serverTimestamp, setDoc, type Unsubscribe } from 'firebase/firestore'
import { firestoreDb } from '../lib/firebase'
import { readVersionedCache, writeVersionedCache } from '../dataSync/versionedCache'
import type { DataSyncState } from '../dataSync/profileSync'

function requireDb() {
  if (!firestoreDb) throw new Error('Firebase chưa được cấu hình. Hãy kiểm tra file .env.local.')
  return firestoreDb
}

function withoutUndefined<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => withoutUndefined(item)) as T
  if (value && typeof value === 'object') {
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) return value
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).flatMap(([key, item]) => item === undefined ? [] : [[key, withoutUndefined(item)]])) as T
  }
  return value
}

function nutritionCacheKey(cacheName: string, userId: string) {
  return `aura:nutrition-cache:v2:${cacheName}:${userId}`
}

function isLogArray(value: unknown): value is Record<string, unknown>[] {
  return Array.isArray(value) && value.length <= 2_000 && value.every((item) => Boolean(item) && typeof item === 'object' && typeof (item as { id?: unknown }).id === 'string')
}

export function compressBase64Image(dataUrl: string, maxDimension = 600, quality = 0.6): Promise<string> {
  return new Promise((resolve) => {
    if (!dataUrl?.startsWith('data:image') || dataUrl.length < 60000 || typeof window === 'undefined') return resolve(dataUrl || '')
    const image = new Image()
    image.crossOrigin = 'anonymous'
    image.onload = () => {
      let width = image.width
      let height = image.height
      if (width > maxDimension || height > maxDimension) {
        if (width > height) {
          height = Math.round((height * maxDimension) / width)
          width = maxDimension
        } else {
          width = Math.round((width * maxDimension) / height)
          height = maxDimension
        }
      }
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const context = canvas.getContext('2d')
      if (!context) return resolve(dataUrl)
      context.drawImage(image, 0, 0, width, height)
      resolve(canvas.toDataURL('image/jpeg', quality))
    }
    image.onerror = () => resolve(dataUrl)
    image.src = dataUrl
  })
}

export async function cleanMealForStorage<T extends Record<string, any>>(meal: T): Promise<T> {
  if (!meal || typeof meal !== 'object') return meal
  const cleaned: any = { ...meal }
  for (const key of ['image', 'imageUrl', 'img', 'fileName']) {
    if (typeof cleaned[key] !== 'string' || !cleaned[key].startsWith('data:image')) continue
    try {
      let compressed = await compressBase64Image(cleaned[key], 600, .6)
      if (compressed.length > 300000) compressed = await compressBase64Image(compressed, 400, .5)
      cleaned[key] = compressed
    } catch {
      // Keep the original meal payload when client-side compression is unavailable.
    }
  }
  return cleaned
}

async function saveUserLog(collectionName: 'mealLogs' | 'waterLogs' | 'activityLogs', userId: string, value: Record<string, unknown> & { id: string }) {
  const reference = doc(requireDb(), 'users', userId, collectionName, value.id)
  await setDoc(reference, withoutUndefined({ ...value, updatedAt: serverTimestamp(), createdAt: value.createdAt ?? serverTimestamp() }), { merge: true })
}

function subscribeToUserLog(collectionName: 'mealLogs' | 'waterLogs' | 'activityLogs', cacheName: string, userId: string, onData: (items: any[]) => void, onError?: (error: Error) => void, onSync?: (state: DataSyncState) => void): Unsubscribe {
  const key = nutritionCacheKey(cacheName, userId)
  const confirmedCache = () => readVersionedCache(key, userId, cacheName, isLogArray)
  return onSnapshot(collection(requireDb(), 'users', userId, collectionName), { includeMetadataChanges: true }, (snapshot) => {
    const items = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }))
    onData(items)
    const previous = confirmedCache()
    if (snapshot.metadata.hasPendingWrites) {
      onSync?.({ status: 'pending-local-change', revision: previous?.revision ?? 0, cachedAt: previous?.cachedAt ?? null })
    } else if (snapshot.metadata.fromCache) {
      onSync?.({
        status: typeof navigator !== 'undefined' && !navigator.onLine ? 'offline-readonly' : 'stale-cache',
        revision: previous?.revision ?? 0,
        cachedAt: previous?.cachedAt ?? null,
      })
    } else {
      const written = writeVersionedCache(key, userId, cacheName, items)
      onSync?.({ status: 'synced', revision: written?.revision ?? Date.now(), cachedAt: written?.cachedAt ?? null })
    }
  }, (error) => {
    const fallback = confirmedCache()
    onData(fallback?.value ?? [])
    onSync?.({
      status: typeof navigator !== 'undefined' && !navigator.onLine && fallback ? 'offline-readonly' : 'sync-failed',
      revision: fallback?.revision ?? 0,
      cachedAt: fallback?.cachedAt ?? null,
    })
    onError?.(error)
  })
}

export async function saveUserMealLog(userId: string, meal: Record<string, unknown> & { id: string }) {
  return saveUserLog('mealLogs', userId, await cleanMealForStorage(meal))
}
export async function deleteUserMealLog(userId: string, mealId: string) { await deleteDoc(doc(requireDb(), 'users', userId, 'mealLogs', mealId)) }
export function subscribeToUserMealLogs(userId: string, onData: (items: any[]) => void, onError?: (error: Error) => void, onSync?: (state: DataSyncState) => void) { return subscribeToUserLog('mealLogs', 'user_meal_logs', userId, onData, onError, onSync) }

export async function saveUserWaterLog(userId: string, entry: Record<string, unknown> & { id: string }) { return saveUserLog('waterLogs', userId, entry) }
export async function deleteUserWaterLog(userId: string, entryId: string) { await deleteDoc(doc(requireDb(), 'users', userId, 'waterLogs', entryId)) }
export function subscribeToUserWaterLogs(userId: string, onData: (items: any[]) => void, onError?: (error: Error) => void, onSync?: (state: DataSyncState) => void) { return subscribeToUserLog('waterLogs', 'user_water_logs', userId, onData, onError, onSync) }

export async function saveUserActivityLog(userId: string, activity: Record<string, unknown> & { id: string }) { return saveUserLog('activityLogs', userId, activity) }
export async function deleteUserActivityLog(userId: string, activityId: string) { await deleteDoc(doc(requireDb(), 'users', userId, 'activityLogs', activityId)) }
export function subscribeToUserActivityLogs(userId: string, onData: (items: any[]) => void, onError?: (error: Error) => void, onSync?: (state: DataSyncState) => void) { return subscribeToUserLog('activityLogs', 'user_activity_logs', userId, onData, onError, onSync) }
