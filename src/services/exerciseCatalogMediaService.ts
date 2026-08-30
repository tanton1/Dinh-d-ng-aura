import { getDownloadURL, ref, uploadBytesResumable } from 'firebase/storage'
import type { ExerciseCatalogMediaImage } from '../types'
import { firebaseAuth, firebaseStorage } from '../lib/firebase'

const MAX_SOURCE_BYTES = 10 * 1024 * 1024
const MAX_EDGE = 1_600

function safeExerciseId(value: string) {
  const normalized = value.trim()
  if (!/^[A-Za-z0-9_-]{1,160}$/.test(normalized)) throw new Error('Mã bài tập không hợp lệ để tải ảnh.')
  return normalized
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    const objectUrl = URL.createObjectURL(file)
    image.onload = () => { URL.revokeObjectURL(objectUrl); resolve(image) }
    image.onerror = () => { URL.revokeObjectURL(objectUrl); reject(new Error('Không thể đọc tệp ảnh đã chọn.')) }
    image.src = objectUrl
  })
}

async function optimizeExerciseImage(file: File) {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size < 1 || file.size > MAX_SOURCE_BYTES) {
    throw new Error('Ảnh phải là JPG, PNG hoặc WebP và không vượt quá 10MB.')
  }
  const image = await loadImage(file)
  const scale = Math.min(1, MAX_EDGE / Math.max(image.naturalWidth, image.naturalHeight))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Trình duyệt không thể tối ưu ảnh này.')
  context.drawImage(image, 0, 0, canvas.width, canvas.height)
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', 0.84))
  if (!blob) throw new Error('Không thể chuyển ảnh sang định dạng WebP.')
  return blob
}

export async function uploadExerciseCatalogImage(
  file: File,
  exerciseId: string,
  role: ExerciseCatalogMediaImage['role'],
  order: number,
  onProgress?: (percent: number) => void,
): Promise<ExerciseCatalogMediaImage> {
  const user = firebaseAuth?.currentUser
  if (!firebaseStorage || !user) throw new Error('Bạn cần đăng nhập để tải ảnh lên Firebase.')
  const normalizedExerciseId = safeExerciseId(exerciseId)
  const mediaId = crypto.randomUUID()
  const blob = await optimizeExerciseImage(file)
  const storagePath = `exercise-catalog/${normalizedExerciseId}/${mediaId}.webp`
  const imageReference = ref(firebaseStorage, storagePath)
  const task = uploadBytesResumable(imageReference, blob, {
    contentType: 'image/webp',
    cacheControl: 'public,max-age=31536000,immutable',
    customMetadata: {
      uploadedBy: user.uid,
      exerciseId: normalizedExerciseId,
      mediaId,
      resourceKind: 'exercise-image',
    },
  })
  const url = await new Promise<string>((resolve, reject) => {
    task.on('state_changed', (snapshot) => {
      if (snapshot.totalBytes > 0) onProgress?.(Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100))
    }, reject, () => { getDownloadURL(task.snapshot.ref).then(resolve).catch(reject) })
  })
  return { id: mediaId, url, storagePath, role, order, alt: '', mimeType: 'image/webp' }
}
