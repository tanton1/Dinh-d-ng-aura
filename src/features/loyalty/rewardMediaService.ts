import { getDownloadURL, ref, uploadBytesResumable } from 'firebase/storage'
import { firebaseAuth } from '../../lib/firebase'
import { firebaseStorage } from '../../lib/firebaseStorage'

export async function uploadRewardBanner(file: File, rewardId: string, onProgress: (percent: number) => void) {
  const owner = firebaseAuth?.currentUser
  if (!owner || !firebaseStorage) throw new Error('Đăng nhập lại để tải ảnh quà tặng.')
  if (!/^[A-Za-z0-9_-]{1,200}$/.test(rewardId)) throw new Error('Mã quà tặng không hợp lệ.')
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size === 0 || file.size > 5 * 1024 * 1024) {
    throw new Error('Chọn ảnh JPG, PNG hoặc WebP tối đa 5 MB.')
  }
  const image = new Image()
  const source = URL.createObjectURL(file)
  try {
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve()
      image.onerror = () => reject(new Error('Không đọc được ảnh. Hãy chọn ảnh khác.'))
      image.src = source
    })
    const scale = Math.min(1, 1600 / Math.max(image.naturalWidth, image.naturalHeight))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Trình duyệt không thể xử lý ảnh này.')
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', 0.85))
    if (!blob || blob.type !== 'image/webp' || blob.size > 5 * 1024 * 1024) throw new Error('Không thể tối ưu ảnh. Hãy chọn ảnh khác.')
    if (firebaseAuth?.currentUser?.uid !== owner.uid) throw new Error('Tài khoản đã thay đổi. Hãy mở lại quà tặng.')
    const bannerStoragePath = `public-assets/loyalty-rewards/${rewardId}/${crypto.randomUUID()}.webp`
    const task = uploadBytesResumable(ref(firebaseStorage, bannerStoragePath), blob, {
      contentType: 'image/webp', cacheControl: 'public,max-age=31536000,immutable',
      customMetadata: { rewardId, uploadedBy: owner.uid, resourceKind: 'loyalty-reward-banner' },
    })
    await new Promise<void>((resolve, reject) => task.on('state_changed', (snapshot) => {
      if (firebaseAuth?.currentUser?.uid !== owner.uid) { task.cancel(); return }
      onProgress(Math.round(snapshot.bytesTransferred / snapshot.totalBytes * 100))
    }, reject, resolve))
    const bannerUrl = await getDownloadURL(task.snapshot.ref)
    if (firebaseAuth?.currentUser?.uid !== owner.uid) throw new Error('Tài khoản đã thay đổi. Hãy mở lại quà tặng.')
    return { bannerUrl, bannerStoragePath }
  } finally {
    URL.revokeObjectURL(source)
  }
}
