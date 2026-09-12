import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  where,
  type CollectionReference,
  type DocumentData,
  type Query,
  type Unsubscribe,
} from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage'
import { firebaseAuth } from '../lib/firebase'
import { firestoreDb } from '../lib/firebaseFirestore'
import { firebaseFunctions } from '../lib/firebaseFunctions'
import { firebaseStorage } from '../lib/firebaseStorage'
import { readVersionedCache, writeVersionedCache } from '../dataSync/versionedCache'
import type { DataSyncState } from '../dataSync/profileSync'

function requireDb() {
  if (!firestoreDb) throw new Error('Firebase chưa được cấu hình. Hãy kiểm tra file .env.local.')
  return firestoreDb
}

function requireNutritionCloud(userId: string) {
  const currentUser = firebaseAuth?.currentUser
  if (!currentUser || currentUser.uid !== userId) {
    throw new Error('Bạn cần đăng nhập đúng tài khoản học viên để cập nhật nhật ký dinh dưỡng.')
  }
  if (!firebaseFunctions) throw new Error('Firebase Functions chưa được cấu hình.')
  return firebaseFunctions
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

function dataUrlToBlob(dataUrl: string) {
  const [header, encoded] = dataUrl.split(',', 2)
  const contentType = /^data:(image\/(?:jpeg|png|webp));base64$/i.exec(header)?.[1]?.toLowerCase()
  if (!contentType || !encoded) throw new Error('Ảnh bữa ăn không hợp lệ.')
  const binary = atob(encoded)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return new Blob([bytes], { type: contentType })
}

const mealPhotoUrlCache = new Map<string, Promise<string>>()

export async function mealPhotoUrl(storagePath: string) {
  if (!firebaseStorage || !storagePath) return ''
  const ownerId = firebaseAuth?.currentUser?.uid
  if (!ownerId || !storagePath.startsWith(`users/${ownerId}/meal-photos/`)) return ''
  const key = `${ownerId}:${storagePath}`
  let pending = mealPhotoUrlCache.get(key)
  if (!pending) {
    pending = getDownloadURL(ref(firebaseStorage, storagePath)).catch((error) => {
      mealPhotoUrlCache.delete(key)
      throw error
    })
    if (mealPhotoUrlCache.size >= 200) mealPhotoUrlCache.delete(mealPhotoUrlCache.keys().next().value!)
    mealPhotoUrlCache.set(key, pending)
  }
  return pending
}

function normalizeMealLogs(items: Record<string, unknown>[]) {
  return items.map((item) => item.reviewStatus === 'reviewed' ? { ...item, reviewStatus: 'approved' } : item)
}

async function saveUserLog(collectionName: 'mealLogs' | 'waterLogs' | 'activityLogs', userId: string, value: Record<string, unknown> & { id: string }) {
  const reference = doc(requireDb(), 'users', userId, collectionName, value.id)
  await setDoc(reference, withoutUndefined({ ...value, updatedAt: serverTimestamp(), createdAt: value.createdAt ?? serverTimestamp() }), { merge: true })
}

type UserNutritionLogCollection = 'mealLogs' | 'waterLogs' | 'activityLogs'

interface UserLogSubscriptionScope {
  buildQuery?: (reference: CollectionReference<DocumentData>) => Query<DocumentData>
  filterCachedItems?: (item: Record<string, unknown>) => boolean
}

function subscribeToUserLog(
  collectionName: UserNutritionLogCollection,
  cacheName: string,
  userId: string,
  onData: (items: any[]) => void,
  onError?: (error: Error) => void,
  onSync?: (state: DataSyncState) => void,
  scope?: UserLogSubscriptionScope,
): Unsubscribe {
  const key = nutritionCacheKey(cacheName, userId)
  const confirmedCache = () => readVersionedCache(key, userId, cacheName, isLogArray)
  const reference = collection(requireDb(), 'users', userId, collectionName)
  const source = scope?.buildQuery ? scope.buildQuery(reference) : reference
  const filterItems = (items: Record<string, unknown>[]) => scope?.filterCachedItems
    ? items.filter(scope.filterCachedItems)
    : items

  return onSnapshot(source, { includeMetadataChanges: true }, (snapshot) => {
    const items = filterItems(snapshot.docs.map((item) => ({ id: item.id, ...item.data() })))
    if (collectionName === 'mealLogs') onData(normalizeMealLogs(items))
    else onData(items)
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
    const fallbackItems = filterItems(fallback?.value ?? [])
    if (collectionName === 'mealLogs') onData(normalizeMealLogs(fallbackItems))
    else onData(fallbackItems)
    onSync?.({
      status: typeof navigator !== 'undefined' && !navigator.onLine && fallback ? 'offline-readonly' : 'sync-failed',
      revision: fallback?.revision ?? 0,
      cachedAt: fallback?.cachedAt ?? null,
    })
    onError?.(error)
  })
}

async function loadUserLog(
  collectionName: UserNutritionLogCollection,
  cacheName: string,
  userId: string,
  onSync?: (state: DataSyncState) => void,
  scope?: UserLogSubscriptionScope,
): Promise<any[]> {
  const key = nutritionCacheKey(cacheName, userId)
  const filterItems = (items: Record<string, unknown>[]) => scope?.filterCachedItems
    ? items.filter(scope.filterCachedItems)
    : items
  try {
    const reference = collection(requireDb(), 'users', userId, collectionName)
    const source = scope?.buildQuery ? scope.buildQuery(reference) : reference
    const snapshot = await getDocs(source)
    const items = filterItems(snapshot.docs.map((item) => ({ id: item.id, ...item.data() })))
    const written = writeVersionedCache(key, userId, cacheName, items)
    onSync?.({ status: 'synced', revision: written?.revision ?? Date.now(), cachedAt: written?.cachedAt ?? null })
    return collectionName === 'mealLogs' ? normalizeMealLogs(items) : items
  } catch (error) {
    const fallback = readVersionedCache(key, userId, cacheName, isLogArray)
    onSync?.({
      status: typeof navigator !== 'undefined' && !navigator.onLine && fallback ? 'offline-readonly' : 'sync-failed',
      revision: fallback?.revision ?? 0,
      cachedAt: fallback?.cachedAt ?? null,
    })
    if (fallback) {
      const items = filterItems(fallback.value)
      return collectionName === 'mealLogs' ? normalizeMealLogs(items) : items
    }
    throw error
  }
}

export async function saveUserMealLog(
  userId: string,
  meal: Record<string, unknown> & { id: string },
  options: { idempotencyKey?: string } = {},
) {
  const functions = requireNutritionCloud(userId)
  const cleaned = await cleanMealForStorage(meal)
  const payload: Record<string, unknown> = { ...cleaned, id: meal.id }
  const rawImage = typeof payload.image === 'string' ? payload.image : ''
  if (rawImage.startsWith('data:image')) {
    if (!firebaseStorage) throw new Error('Firebase Storage chưa được cấu hình.')
    const compressed = await compressBase64Image(rawImage, 1_200, .78)
    const blob = dataUrlToBlob(compressed)
    if (blob.size > 8 * 1024 * 1024) throw new Error('Ảnh bữa ăn vượt quá giới hạn 8 MB.')
    const extension = blob.type === 'image/png' ? 'png' : blob.type === 'image/webp' ? 'webp' : 'jpg'
    const storagePath = `users/${userId}/meal-photos/${meal.id}/original.${extension}`
    const imageReference = ref(firebaseStorage, storagePath)
    const alreadyUploaded = await getDownloadURL(imageReference).then(() => true).catch(() => false)
    if (!alreadyUploaded) {
      await uploadBytes(imageReference, blob, {
        contentType: blob.type,
        cacheControl: 'private, max-age=300',
        customMetadata: {
          ownerUid: userId,
          mealId: meal.id,
          resourceKind: 'nutrition-meal-photo',
        },
      })
    }
    payload.imageStoragePath = storagePath
    delete payload.image
    mealPhotoUrlCache.delete(`${userId}:${storagePath}`)
  }
  if (typeof payload.imageStoragePath === 'string' && payload.imageStoragePath) delete payload.image
  const callable = httpsCallable<
    { meal: Record<string, unknown>; idempotencyKey?: string },
    { mealId: string; mealRevision: number; reviewInvalidated: boolean; unchanged?: boolean }
  >(functions, 'saveNutritionMealLog')
  return (await callable({
    meal: withoutUndefined(payload),
    ...(options.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : {}),
  })).data
}
export async function deleteUserMealLog(userId: string, mealId: string) {
  const functions = requireNutritionCloud(userId)
  const callable = httpsCallable<{ mealId: string }, { mealId: string; deleted: boolean }>(functions, 'deleteNutritionMealLog')
  await callable({ mealId })
}
export function subscribeToUserMealLogs(userId: string, onData: (items: any[]) => void, onError?: (error: Error) => void, onSync?: (state: DataSyncState) => void) { return subscribeToUserLog('mealLogs', 'user_meal_logs', userId, onData, onError, onSync) }
export function subscribeToUserMealLogsForDate(userId: string, date: string, onData: (items: any[]) => void, onError?: (error: Error) => void) {
  return subscribeToUserLog('mealLogs', 'user_meal_logs_day', userId, onData, onError, undefined, {
    buildQuery: (reference) => query(reference, where('date', '==', date), limit(100)),
    filterCachedItems: (item) => item.date === date,
  })
}
export function subscribeToRecentUserMealLogs(userId: string, fromDate: string, onData: (items: any[]) => void, onError?: (error: Error) => void, onSync?: (state: DataSyncState) => void) {
  return subscribeToUserLog('mealLogs', 'user_meal_logs_recent_90d', userId, onData, onError, onSync, {
    buildQuery: (reference) => query(reference, where('date', '>=', fromDate), orderBy('date', 'desc'), limit(1_000)),
    filterCachedItems: (item) => typeof item.date === 'string' && item.date >= fromDate,
  })
}
export function loadRecentUserMealLogs(userId: string, fromDate: string, onSync?: (state: DataSyncState) => void) {
  return loadUserLog('mealLogs', 'user_meal_logs_recent_90d', userId, onSync, {
    buildQuery: (reference) => query(reference, where('date', '>=', fromDate), orderBy('date', 'desc'), limit(1_000)),
    filterCachedItems: (item) => typeof item.date === 'string' && item.date >= fromDate,
  })
}

export async function saveUserWaterLog(userId: string, entry: Record<string, unknown> & { id: string }) { return saveUserLog('waterLogs', userId, entry) }
export async function deleteUserWaterLog(userId: string, entryId: string) { await deleteDoc(doc(requireDb(), 'users', userId, 'waterLogs', entryId)) }
export function subscribeToUserWaterLogs(userId: string, onData: (items: any[]) => void, onError?: (error: Error) => void, onSync?: (state: DataSyncState) => void) { return subscribeToUserLog('waterLogs', 'user_water_logs', userId, onData, onError, onSync) }
export function subscribeToUserWaterLogsForDate(userId: string, date: string, onData: (items: any[]) => void, onError?: (error: Error) => void) {
  return subscribeToUserLog('waterLogs', 'user_water_logs_day', userId, onData, onError, undefined, {
    buildQuery: (reference) => query(reference, where('date', '==', date), limit(100)),
    filterCachedItems: (item) => item.date === date,
  })
}
export function subscribeToRecentUserWaterLogs(userId: string, fromDate: string, onData: (items: any[]) => void, onError?: (error: Error) => void, onSync?: (state: DataSyncState) => void) {
  return subscribeToUserLog('waterLogs', 'user_water_logs_recent_90d', userId, onData, onError, onSync, {
    buildQuery: (reference) => query(reference, where('date', '>=', fromDate), orderBy('date', 'desc'), limit(1_000)),
    filterCachedItems: (item) => typeof item.date === 'string' && item.date >= fromDate,
  })
}
export function loadRecentUserWaterLogs(userId: string, fromDate: string, onSync?: (state: DataSyncState) => void) {
  return loadUserLog('waterLogs', 'user_water_logs_recent_90d', userId, onSync, {
    buildQuery: (reference) => query(reference, where('date', '>=', fromDate), orderBy('date', 'desc'), limit(1_000)),
    filterCachedItems: (item) => typeof item.date === 'string' && item.date >= fromDate,
  })
}

export async function saveUserActivityLog(userId: string, activity: Record<string, unknown> & { id: string }) { return saveUserLog('activityLogs', userId, activity) }
export async function deleteUserActivityLog(userId: string, activityId: string) { await deleteDoc(doc(requireDb(), 'users', userId, 'activityLogs', activityId)) }
export function subscribeToUserActivityLogs(userId: string, onData: (items: any[]) => void, onError?: (error: Error) => void, onSync?: (state: DataSyncState) => void) { return subscribeToUserLog('activityLogs', 'user_activity_logs', userId, onData, onError, onSync) }
export function subscribeToUserActivityLogsForDate(userId: string, date: string, onData: (items: any[]) => void, onError?: (error: Error) => void) {
  return subscribeToUserLog('activityLogs', 'user_activity_logs_day', userId, onData, onError, undefined, {
    buildQuery: (reference) => query(reference, where('date', '==', date), limit(100)),
    filterCachedItems: (item) => item.date === date,
  })
}
export function subscribeToRecentUserActivityLogs(userId: string, fromDate: string, onData: (items: any[]) => void, onError?: (error: Error) => void, onSync?: (state: DataSyncState) => void) {
  return subscribeToUserLog('activityLogs', 'user_activity_logs_recent_90d', userId, onData, onError, onSync, {
    buildQuery: (reference) => query(reference, where('date', '>=', fromDate), orderBy('date', 'desc'), limit(1_000)),
    filterCachedItems: (item) => typeof item.date === 'string' && item.date >= fromDate,
  })
}
export function loadRecentUserActivityLogs(userId: string, fromDate: string, onSync?: (state: DataSyncState) => void) {
  return loadUserLog('activityLogs', 'user_activity_logs_recent_90d', userId, onSync, {
    buildQuery: (reference) => query(reference, where('date', '>=', fromDate), orderBy('date', 'desc'), limit(1_000)),
    filterCachedItems: (item) => typeof item.date === 'string' && item.date >= fromDate,
  })
}
