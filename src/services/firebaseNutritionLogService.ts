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
  startAfter,
  where,
  type CollectionReference,
  type DocumentData,
  type Query,
  type QueryDocumentSnapshot,
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
import { createSharedNutritionSubscriptions, localNutritionDate } from '../features/nutrition/readLifecycle'

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
  return items.map((item) => ({ ...item,
    mealRevision: Number.isInteger(item.mealRevision) && Number(item.mealRevision) >= 1 ? item.mealRevision : 1,
    ...(item.reviewStatus === 'reviewed' ? { reviewStatus: 'approved' } : {}),
  }))
}

async function saveUserLog(collectionName: 'mealLogs' | 'waterLogs' | 'activityLogs', userId: string, value: Record<string, unknown> & { id: string }) {
  const reference = doc(requireDb(), 'users', userId, collectionName, value.id)
  await setDoc(reference, withoutUndefined({ ...value, updatedAt: serverTimestamp(), createdAt: value.createdAt ?? serverTimestamp() }), { merge: true })
}

type UserNutritionLogCollection = 'mealLogs' | 'waterLogs' | 'activityLogs'

interface UserLogSubscriptionScope {
  buildQuery?: (reference: CollectionReference<DocumentData>) => Query<DocumentData>
  filterCachedItems?: (item: Record<string, unknown>) => boolean
  pageSize?: number
}

type NutritionLogEvent = { items: any[]; state: DataSyncState; error?: Error; changed: boolean }
const sharedNutritionLogs = createSharedNutritionSubscriptions<NutritionLogEvent>()

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

  let delivered = false
  return sharedNutritionLogs(key, (emit) => {
    let latestItems: Record<string, unknown>[] | undefined
    let latestNormalized: any[] = []
    let confirmedItems: Record<string, unknown>[] | undefined
    return onSnapshot(source, { includeMetadataChanges: true }, (snapshot) => {
    const changed = !latestItems || snapshot.docChanges().length > 0
    const items = changed ? filterItems(snapshot.docs.map((item) => ({ id: item.id, ...item.data() }))) : latestItems!
    if (changed) latestNormalized = collectionName === 'mealLogs' ? normalizeMealLogs(items) : items
    latestItems = items
    const previous = confirmedCache()
    let state: DataSyncState
    if (snapshot.metadata.hasPendingWrites) {
      state = { status: 'pending-local-change', revision: previous?.revision ?? 0, cachedAt: previous?.cachedAt ?? null }
    } else if (snapshot.metadata.fromCache) {
      state = {
        status: typeof navigator !== 'undefined' && navigator.onLine === false ? 'offline-readonly' : 'stale-cache',
        revision: previous?.revision ?? 0,
        cachedAt: previous?.cachedAt ?? null,
      }
    } else {
      const written = confirmedItems === items ? confirmedCache() : writeVersionedCache(key, userId, cacheName, items)
      confirmedItems = items
      state = { status: 'synced', revision: written?.revision ?? Date.now(), cachedAt: written?.cachedAt ?? null }
    }
    emit({ items: latestNormalized, state, changed })
  }, (error) => {
    const fallback = confirmedCache()
    const fallbackItems = filterItems(fallback?.value ?? [])
    emit({ items: collectionName === 'mealLogs' ? normalizeMealLogs(fallbackItems) : fallbackItems, error, changed: true, state: {
      status: typeof navigator !== 'undefined' && navigator.onLine === false && fallback ? 'offline-readonly' : 'sync-failed',
      revision: fallback?.revision ?? 0,
      cachedAt: fallback?.cachedAt ?? null,
    } })
  })
  }, ({ items, state, error, changed }) => {
    if (!delivered || changed) onData(items)
    delivered = true
    onSync?.(state)
    if (error) onError?.(error)
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
    const records: Record<string, unknown>[] = []
    let cursor: QueryDocumentSnapshot<DocumentData> | undefined
    let fromCache = false
    let pendingWrites = false
    do {
      const page = await getDocs(scope?.pageSize ? query(source, ...(cursor ? [startAfter(cursor)] : []), limit(scope.pageSize)) : source)
      fromCache ||= page.metadata.fromCache
      pendingWrites ||= page.metadata.hasPendingWrites
      records.push(...page.docs.map((item) => ({ id: item.id, ...item.data() })))
      const next = page.docs.at(-1)
      if (!scope?.pageSize || page.docs.length < scope.pageSize) break
      if (!next || next.id === cursor?.id) throw new Error('Không thể tải tiếp nhật ký. Hãy tải lại để kiểm tra đủ dữ liệu.')
      cursor = next
    } while (cursor)
    const items = filterItems(records)
    const confirmed = !fromCache && !pendingWrites
    const written = confirmed ? writeVersionedCache(key, userId, cacheName, items) : readVersionedCache(key, userId, cacheName, isLogArray)
    onSync?.({ status: pendingWrites ? 'pending-local-change' : fromCache ? (typeof navigator !== 'undefined' && navigator.onLine === false ? 'offline-readonly' : 'stale-cache') : 'synced', revision: written?.revision ?? 0, cachedAt: written?.cachedAt ?? null })
    return collectionName === 'mealLogs' ? normalizeMealLogs(items) : items
  } catch (error) {
    const fallback = readVersionedCache(key, userId, cacheName, isLogArray)
    onSync?.({
      status: typeof navigator !== 'undefined' && navigator.onLine === false && fallback ? 'offline-readonly' : 'sync-failed',
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
  options: { idempotencyKey?: string; expectedMealRevision?: number } = {},
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
    { meal: Record<string, unknown>; idempotencyKey?: string; expectedMealRevision: number; expectedOwnerUid: string },
    { mealId: string; mealRevision: number; reviewInvalidated: boolean; unchanged?: boolean }
  >(functions, 'saveNutritionMealLog')
  requireNutritionCloud(userId)
  return (await callable({
    meal: withoutUndefined(payload),
    expectedOwnerUid: userId,
    expectedMealRevision: options.expectedMealRevision ?? (Number.isInteger(meal.mealRevision) ? Number(meal.mealRevision) : 0),
    ...(options.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : {}),
  })).data
}
export async function deleteUserMealLog(userId: string, mealId: string, expectedMealRevision: number) {
  const functions = requireNutritionCloud(userId)
  const callable = httpsCallable<{ mealId: string; expectedMealRevision: number; expectedOwnerUid: string }, { mealId: string; deleted: boolean; mealRevision: number }>(functions, 'deleteNutritionMealLog')
  return (await callable({ mealId, expectedMealRevision, expectedOwnerUid: userId })).data
}
export function subscribeToUserMealLogs(userId: string, onData: (items: any[]) => void, onError?: (error: Error) => void, onSync?: (state: DataSyncState) => void) { return subscribeToUserLog('mealLogs', 'user_meal_logs', userId, onData, onError, onSync) }
export function subscribeToUserMealLogsForDate(userId: string, date: string, onData: (items: any[]) => void, onError?: (error: Error) => void, onSync?: (state: DataSyncState) => void) {
  return subscribeToUserLog('mealLogs', `user_meal_logs_day:${date}`, userId, onData, onError, onSync, {
    buildQuery: (reference) => query(reference, where('date', '==', date)),
    filterCachedItems: (item) => item.date === date,
  })
}
export function subscribeToRecentUserMealLogs(userId: string, fromDate: string, onData: (items: any[]) => void, onError?: (error: Error) => void, onSync?: (state: DataSyncState) => void) {
  return subscribeToUserLog('mealLogs', 'user_meal_logs_recent_90d', userId, onData, onError, onSync, {
    buildQuery: (reference) => query(reference, where('date', '>=', fromDate), orderBy('date', 'desc'), limit(1_000)),
    filterCachedItems: (item) => typeof item.date === 'string' && item.date >= fromDate,
  })
}
export function loadRecentUserMealLogs(userId: string, fromDate: string, onSync?: (state: DataSyncState) => void, toDate = localNutritionDate()) {
  return loadUserLog('mealLogs', `user_meal_logs_range:${fromDate}:${toDate}`, userId, onSync, {
    buildQuery: (reference) => query(reference, where('date', '>=', fromDate), where('date', '<=', toDate), orderBy('date', 'desc')),
    filterCachedItems: (item) => typeof item.date === 'string' && item.date >= fromDate && item.date <= toDate,
    pageSize: 500,
  })
}

export async function saveUserWaterLog(userId: string, entry: Record<string, unknown> & { id: string }) { return saveUserLog('waterLogs', userId, entry) }
export async function deleteUserWaterLog(userId: string, entryId: string) { await deleteDoc(doc(requireDb(), 'users', userId, 'waterLogs', entryId)) }
export function subscribeToUserWaterLogs(userId: string, onData: (items: any[]) => void, onError?: (error: Error) => void, onSync?: (state: DataSyncState) => void) { return subscribeToUserLog('waterLogs', 'user_water_logs', userId, onData, onError, onSync) }
export function subscribeToUserWaterLogsForDate(userId: string, date: string, onData: (items: any[]) => void, onError?: (error: Error) => void, onSync?: (state: DataSyncState) => void) {
  return subscribeToUserLog('waterLogs', `user_water_logs_day:${date}`, userId, onData, onError, onSync, {
    buildQuery: (reference) => query(reference, where('date', '==', date)),
    filterCachedItems: (item) => item.date === date,
  })
}
export function subscribeToRecentUserWaterLogs(userId: string, fromDate: string, onData: (items: any[]) => void, onError?: (error: Error) => void, onSync?: (state: DataSyncState) => void) {
  return subscribeToUserLog('waterLogs', 'user_water_logs_recent_90d', userId, onData, onError, onSync, {
    buildQuery: (reference) => query(reference, where('date', '>=', fromDate), orderBy('date', 'desc'), limit(1_000)),
    filterCachedItems: (item) => typeof item.date === 'string' && item.date >= fromDate,
  })
}
export function loadRecentUserWaterLogs(userId: string, fromDate: string, onSync?: (state: DataSyncState) => void, toDate = localNutritionDate()) {
  return loadUserLog('waterLogs', `user_water_logs_range:${fromDate}:${toDate}`, userId, onSync, {
    buildQuery: (reference) => query(reference, where('date', '>=', fromDate), where('date', '<=', toDate), orderBy('date', 'desc')),
    filterCachedItems: (item) => typeof item.date === 'string' && item.date >= fromDate && item.date <= toDate,
    pageSize: 500,
  })
}

export async function saveUserActivityLog(userId: string, activity: Record<string, unknown> & { id: string }) { return saveUserLog('activityLogs', userId, activity) }
export async function deleteUserActivityLog(userId: string, activityId: string) { await deleteDoc(doc(requireDb(), 'users', userId, 'activityLogs', activityId)) }
export function subscribeToUserActivityLogs(userId: string, onData: (items: any[]) => void, onError?: (error: Error) => void, onSync?: (state: DataSyncState) => void) { return subscribeToUserLog('activityLogs', 'user_activity_logs', userId, onData, onError, onSync) }
export function subscribeToUserActivityLogsForDate(userId: string, date: string, onData: (items: any[]) => void, onError?: (error: Error) => void, onSync?: (state: DataSyncState) => void) {
  return subscribeToUserLog('activityLogs', `user_activity_logs_day:${date}`, userId, onData, onError, onSync, {
    buildQuery: (reference) => query(reference, where('date', '==', date)),
    filterCachedItems: (item) => item.date === date,
  })
}
export function subscribeToRecentUserActivityLogs(userId: string, fromDate: string, onData: (items: any[]) => void, onError?: (error: Error) => void, onSync?: (state: DataSyncState) => void) {
  return subscribeToUserLog('activityLogs', 'user_activity_logs_recent_90d', userId, onData, onError, onSync, {
    buildQuery: (reference) => query(reference, where('date', '>=', fromDate), orderBy('date', 'desc'), limit(1_000)),
    filterCachedItems: (item) => typeof item.date === 'string' && item.date >= fromDate,
  })
}
export function loadRecentUserActivityLogs(userId: string, fromDate: string, onSync?: (state: DataSyncState) => void, toDate = localNutritionDate()) {
  return loadUserLog('activityLogs', `user_activity_logs_range:${fromDate}:${toDate}`, userId, onSync, {
    buildQuery: (reference) => query(reference, where('date', '>=', fromDate), where('date', '<=', toDate), orderBy('date', 'desc')),
    filterCachedItems: (item) => typeof item.date === 'string' && item.date >= fromDate && item.date <= toDate,
    pageSize: 500,
  })
}
