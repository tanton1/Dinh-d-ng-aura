import { collection, deleteDoc, doc, getDoc, limit, onSnapshot, orderBy, query, serverTimestamp, setDoc, writeBatch, type Unsubscribe } from 'firebase/firestore'
import { deleteObject, getDownloadURL, ref as storageRef, uploadBytes, uploadBytesResumable } from 'firebase/storage'
import { firestoreDb } from '../lib/firebaseFirestore'
import { firebaseStorage } from '../lib/firebaseStorage'
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

function subscribeToCollection(userId: string, collectionName: string, cacheName: string, onData: (items: any[], serverConfirmed: boolean) => void, onError?: (error: Error) => void): Unsubscribe {
  return onSnapshot(collection(requireDb(), 'users', userId, collectionName), { includeMetadataChanges: true }, (snapshot) => {
    const items = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }))
    const serverConfirmed = !snapshot.metadata.fromCache && !snapshot.metadata.hasPendingWrites
    if (serverConfirmed) writeCache(`${cacheName}:${userId}`, items)
    onData(items, serverConfirmed)
  }, (error) => {
    onData(readCache(`${cacheName}:${userId}`, []), false)
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

export type ProgressCheckInAngle = 'front' | 'back' | 'left' | 'right'

export interface ProgressCheckInPhotoInput {
  id: string
  angle: ProgressCheckInAngle
  imageUrl: string
}

export interface ProgressCheckInInput {
  id: string
  date: string
  weightKg?: number
  bodyFatPercentage?: number
  muscleMassKg?: number
  waistCm?: number
  hipsCm?: number
  thighCm?: number
  armCm?: number
  chestCm?: number
  measurementNote?: string
  photos: ProgressCheckInPhotoInput[]
}

export interface ProgressCheckInRecord extends ProgressCheckInInput {
  checkInId: string
  source?: 'student' | 'trainer' | 'admin' | 'legacy'
  verificationStatus?: 'self_reported' | 'verified'
  createdAt?: unknown
  updatedAt?: unknown
}

function assertProgressCheckInId(value: string, label: string) {
  if (!/^[A-Za-z0-9_-]{8,120}$/.test(value)) throw new Error(`${label} không hợp lệ.`)
}

/**
 * Persists one progress moment as a single Firestore batch. The current
 * measurement projection and legacy weight log remain available to existing
 * charts, while the dated document and grouped photos preserve the complete
 * historical check-in.
 */
export async function saveUserProgressCheckIn(userId: string, input: ProgressCheckInInput) {
  assertProgressCheckInId(input.id, 'Mã lần ghi nhận')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) throw new Error('Ngày ghi nhận không hợp lệ.')
  if (input.photos.length > 4) throw new Error('Mỗi lần ghi nhận hỗ trợ tối đa 4 góc ảnh.')

  const database = requireDb()
  const batch = writeBatch(database)
  const measuredValues = clean({
    checkInId: input.id,
    date: input.date,
    weightKg: input.weightKg,
    bodyFatPercentage: input.bodyFatPercentage,
    muscleMassKg: input.muscleMassKg,
    waistCm: input.waistCm,
    hipsCm: input.hipsCm,
    thighCm: input.thighCm,
    armCm: input.armCm,
    chestCm: input.chestCm,
    measurementNote: input.measurementNote,
    ...(input.bodyFatPercentage ? { bodyFatStatus: 'Đã cập nhật' } : {}),
    ...(input.muscleMassKg ? { muscleStatus: 'Đã cập nhật' } : {}),
    ...(input.waistCm ? { waistStatus: 'Đã cập nhật' } : {}),
    updatedAt: input.date,
    syncedAt: serverTimestamp(),
    schemaVersion: 2,
  })

  const measurementKeys = ['weightKg', 'bodyFatPercentage', 'muscleMassKg', 'waistCm', 'hipsCm', 'thighCm', 'armCm', 'chestCm'] as const
  const hasMeasurementValues = measurementKeys.some((key) => input[key] !== undefined)
  const canonicalPhotos = input.photos.map((photo) => {
    const storagePath = storagePathFromDownloadUrl(photo.imageUrl)
    return clean({ id: photo.id, angle: photo.angle, imageUrl: photo.imageUrl, storagePath })
  })
  batch.set(doc(database, 'users', userId, 'progressCheckIns', input.id), clean({
    ...measuredValues,
    id: input.id,
    checkInId: input.id,
    date: input.date,
    photos: canonicalPhotos,
    source: 'student',
    verificationStatus: 'self_reported',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    schemaVersion: 1,
  }), { merge: true })
  if (hasMeasurementValues) {
    batch.set(doc(database, 'users', userId, 'bodyMeasurements', 'current'), measuredValues, { merge: true })
    batch.set(doc(database, 'users', userId, 'bodyMeasurements', input.id), {
      ...measuredValues,
      createdAt: serverTimestamp(),
    }, { merge: true })
  }

  if (input.weightKg) {
    batch.set(doc(database, 'users', userId, 'weightLogs', input.id), {
      id: input.id,
      checkInId: input.id,
      date: input.date,
      label: input.date.slice(5).split('-').reverse().join('/'),
      weightKg: input.weightKg,
      trendKg: input.weightKg,
      note: input.measurementNote || '',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      schemaVersion: 2,
    }, { merge: true })
  }

  input.photos.forEach((photo) => {
    assertProgressCheckInId(photo.id, 'Mã ảnh')
    const storagePath = storagePathFromDownloadUrl(photo.imageUrl)
    batch.set(doc(database, 'users', userId, 'progressPhotos', photo.id), clean({
      id: photo.id,
      checkInId: input.id,
      date: input.date,
      recordedAt: input.date,
      angle: photo.angle,
      imageUrl: photo.imageUrl,
      storagePath,
      images: [{ ...(storagePath ? { storagePath } : { url: photo.imageUrl }), angle: photo.angle }],
      weightKg: input.weightKg,
      bodyFat: input.bodyFatPercentage,
      bodyFatPercentage: input.bodyFatPercentage,
      muscleMassKg: input.muscleMassKg,
      waistCm: input.waistCm,
      hipsCm: input.hipsCm,
      thighCm: input.thighCm,
      armCm: input.armCm,
      chestCm: input.chestCm,
      notes: input.measurementNote || '',
      note: input.measurementNote || '',
      privacy: 'private',
      isPrivate: true,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      schemaVersion: 3,
    }), { merge: true })
  })

  try {
    await batch.commit()
  } catch (error) {
    // Storage uploads happen before the metadata batch. If that batch fails,
    // remove only this new check-in's uploaded files so failed saves do not
    // leave private orphan assets behind.
    if (firebaseStorage) {
      const paths = input.photos.map((photo) => storagePathFromDownloadUrl(photo.imageUrl)).filter(Boolean)
      await Promise.allSettled(paths.map((path) => deleteObject(storageRef(firebaseStorage!, path))))
    }
    throw error
  }
}

export function subscribeToUserProgressCheckIns(userId: string, onData: (records: ProgressCheckInRecord[]) => void, onError?: (error: Error) => void) {
  const reference = query(
    collection(requireDb(), 'users', userId, 'progressCheckIns'),
    orderBy('date', 'desc'),
    limit(120),
  )
  return onSnapshot(reference, (snapshot) => {
    const records = snapshot.docs.map((item) => ({ id: item.id, ...item.data() })) as ProgressCheckInRecord[]
    writeCache(`user_progress_checkins:${userId}`, records)
    onData(records)
  }, (error) => {
    onData(readCache<ProgressCheckInRecord[]>(`user_progress_checkins:${userId}`, []))
    onError?.(error)
  })
}

export async function saveUserGamification(userId: string, data: Record<string, unknown>) { await saveProgressDocument(userId, 'gamification', 'stats', data) }
export function subscribeToUserGamification(userId: string, onData: (value: any) => void, onError?: (error: Error) => void) { return subscribeToDocument(userId, 'gamification', 'stats', 'user_gamification', onData, onError) }

function storagePathFromDownloadUrl(value: unknown) {
  if (typeof value !== 'string' || !value.startsWith('https://')) return ''
  try {
    const match = new URL(value).pathname.match(/\/o\/([^/?]+)/)
    return match ? decodeURIComponent(match[1]) : ''
  } catch {
    return ''
  }
}

async function persistInlineProgressPhoto(userId: string, photoId: string, dataUrl: string) {
  if (!firebaseStorage) throw new Error('Firebase Storage is not initialized.')
  const response = await fetch(dataUrl)
  const blob = await response.blob()
  if (!blob.type.startsWith('image/') || blob.size <= 0 || blob.size > 10 * 1024 * 1024) throw new Error('Ảnh tiến độ không hợp lệ hoặc vượt quá 10MB.')
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())))
    .map((value) => value.toString(16).padStart(2, '0')).join('')
  const extension = blob.type === 'image/png' ? 'png' : blob.type === 'image/webp' ? 'webp' : 'jpg'
  const storagePath = `users/${userId}/progress-photos/${photoId}-${digest.slice(0, 16)}.${extension}`
  const reference = storageRef(firebaseStorage, storagePath)
  await uploadBytes(reference, blob, { contentType: blob.type, customMetadata: { ownerUid: userId, resourceKind: 'progress-photo', checksum: digest } })
  return { storagePath, checksum: digest, url: await getDownloadURL(reference) }
}

export async function saveUserProgressPhoto(userId: string, photo: Record<string, unknown> & { id: string }) {
  const imageUrl = typeof photo.imageUrl === 'string' ? photo.imageUrl : ''
  let asset = {
    storagePath: typeof photo.storagePath === 'string' ? photo.storagePath : storagePathFromDownloadUrl(imageUrl),
    checksum: typeof photo.checksum === 'string' ? photo.checksum : '',
    url: imageUrl,
  }
  if (imageUrl.startsWith('data:image/')) asset = await persistInlineProgressPhoto(userId, photo.id, imageUrl)
  await saveProgressDocument(userId, 'progressPhotos', photo.id, {
    ...photo,
    imageUrl: asset.url,
    storagePath: asset.storagePath,
    ...(asset.checksum ? { checksum: asset.checksum } : {}),
    images: [{ storagePath: asset.storagePath, ...(asset.checksum ? { checksum: asset.checksum } : {}), ...(asset.storagePath ? {} : { url: asset.url }) }],
    schemaVersion: 2,
  }, true)
}
export async function deleteUserProgressPhoto(userId: string, photoId: string) {
  const reference = doc(requireDb(), 'users', userId, 'progressPhotos', photoId)
  const snapshot = await getDoc(reference)
  const value = snapshot.exists() ? snapshot.data() : {}
  const paths = [...new Set([
    typeof value.storagePath === 'string' ? value.storagePath : '',
    ...(Array.isArray(value.images) ? value.images.map((item) => typeof item?.storagePath === 'string' ? item.storagePath : '') : []),
  ].filter(Boolean))]
  await deleteDoc(reference)
  if (firebaseStorage) await Promise.allSettled(paths.map((path) => deleteObject(storageRef(firebaseStorage!, path))))
}
export function subscribeToUserProgressPhotos(userId: string, onData: (photos: any[], serverConfirmed: boolean) => void, onError?: (error: Error) => void) { return subscribeToCollection(userId, 'progressPhotos', 'user_progress_photos', onData, onError) }

export async function deleteUploadedProgressPhotoAsset(imageUrl: string) {
  if (!firebaseStorage) return
  const path = storagePathFromDownloadUrl(imageUrl)
  if (path) await deleteObject(storageRef(firebaseStorage, path))
}

export async function uploadUserProgressPhoto(userId: string, file: File, onProgress?: (percent: number) => void): Promise<string> {
  if (!firebaseStorage) throw new Error('Firebase Storage is not initialized.')
  const extension = file.name.split('.').pop() ?? 'jpg'
  const reference = storageRef(firebaseStorage, `users/${userId}/progress-photos/${Date.now()}-${Math.random().toString(36).slice(2)}.${extension}`)
  return new Promise((resolve, reject) => {
    const task = uploadBytesResumable(reference, file, { contentType: file.type, customMetadata: { ownerUid: userId, resourceKind: 'progress-photo' } })
    task.on('state_changed', (snapshot) => onProgress?.(Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100)), reject, async () => {
      try { resolve(await getDownloadURL(task.snapshot.ref)) } catch (error) { reject(error) }
    })
  })
}
