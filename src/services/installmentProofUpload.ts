// Loaded on demand by the payment sheet, so the Storage SDK only downloads
// when a student actually attaches a transfer receipt.
import { ref, uploadBytesResumable } from 'firebase/storage'
import { firebaseAuth } from '../lib/firebase'
import { firebaseStorage } from '../lib/firebaseStorage'

/** Same limits as storage.rules `installment-proofs` and the claim callable. */
export const PROOF_MAX_BYTES = 8 * 1024 * 1024
const MAX_DIMENSION = 1600
const QUALITY = 0.85

async function decode(file: Blob): Promise<{ source: CanvasImageSource; width: number; height: number; cleanup: () => void }> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
      return { source: bitmap, width: bitmap.width, height: bitmap.height, cleanup: () => bitmap.close() }
    } catch {
      // Older Safari rejects ImageBitmapOptions; the element path still honours EXIF.
    }
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const image = new Image()
    image.onload = () => resolve({ source: image, width: image.naturalWidth, height: image.naturalHeight, cleanup: () => URL.revokeObjectURL(url) })
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('decode')) }
    image.src = url
  })
}

/**
 * Re-encodes a receipt photo or screenshot as a JPEG of at most 1600px on the
 * long side, which keeps bank text legible at a few hundred kilobytes and
 * turns HEIC or other camera formats into a type Storage Rules accept.
 */
export async function prepareReceiptImage(file: File): Promise<Blob> {
  if (!file.type.startsWith('image/') && file.type !== '') throw new Error('Hãy chọn ảnh chụp biên lai hoặc ảnh màn hình chuyển khoản.')
  let decoded: Awaited<ReturnType<typeof decode>> | null = null
  try {
    decoded = await decode(file)
    const scale = Math.min(1, MAX_DIMENSION / Math.max(decoded.width, decoded.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(decoded.width * scale))
    canvas.height = Math.max(1, Math.round(decoded.height * scale))
    const context = canvas.getContext('2d')
    if (!context) throw new Error('canvas')
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.imageSmoothingQuality = 'high'
    context.drawImage(decoded.source, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', QUALITY))
    if (blob && blob.type === 'image/jpeg' && blob.size > 0 && blob.size <= PROOF_MAX_BYTES) return blob
  } catch {
    // Fall through to the original when the browser cannot re-encode it.
  } finally {
    decoded?.cleanup()
  }
  if (/^image\/(jpeg|png|webp)$/.test(file.type) && file.size > 0 && file.size <= PROOF_MAX_BYTES) return file
  throw new Error('Không đọc được ảnh này. Hãy chụp màn hình biên lai rồi chọn lại.')
}

/** Uploads the prepared receipt under the caller and claim; returns its Storage path. */
export async function uploadInstallmentProof(claimId: string, image: Blob, onProgress?: (percent: number) => void) {
  const user = firebaseAuth?.currentUser
  if (!user) throw new Error('Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại.')
  if (!firebaseStorage) throw new Error('Kho ảnh chưa sẵn sàng. Hãy tải lại trang.')
  if (!/^ipc_[0-9a-f]{40}$/.test(claimId)) throw new Error('Hãy tải lại trang thanh toán rồi thử lại.')
  const extension = image.type === 'image/png' ? 'png' : image.type === 'image/webp' ? 'webp' : 'jpg'
  const path = `installment-proofs/${user.uid}/${claimId}/proof-${Date.now()}.${extension}`
  const task = uploadBytesResumable(ref(firebaseStorage, path), image, {
    contentType: image.type || 'image/jpeg',
    cacheControl: 'private,max-age=300',
    customMetadata: { ownerUid: user.uid, claimId, resourceKind: 'installment-payment-proof' },
  })
  await new Promise<void>((resolve, reject) => task.on('state_changed', (snapshot) => {
    if (snapshot.totalBytes) onProgress?.(Math.round(snapshot.bytesTransferred / snapshot.totalBytes * 100))
  }, reject, () => resolve()))
  return path
}
