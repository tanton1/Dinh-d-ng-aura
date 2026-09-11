import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, Camera, Check, ImagePlus, Info, LoaderCircle, LockKeyhole, Ruler, Scale, Trash2 } from 'lucide-react'
import { safeLocalStorageSet } from '../../lib/safeStorage'
import { firebaseAuth } from '../../lib/firebase'
import { reportClientIssue } from '../../services/clientTelemetryService'
import {
  saveUserProgressCheckIn,
  deleteUploadedProgressPhotoAsset,
  uploadUserProgressPhoto,
  type ProgressCheckInAngle,
  type ProgressCheckInInput,
} from '../../services/firebaseService'
import type { BodyMeasurements, WeightRecord } from '../../types/progressTypes'
import './ProgressPhotoStudio.css'

interface PhotoDraft {
  file: File
  previewUrl: string
}

type PhotoDrafts = Partial<Record<ProgressCheckInAngle, PhotoDraft>>
type MeasurementKey = 'weightKg' | 'bodyFatPercentage' | 'muscleMassKg' | 'waistCm' | 'hipsCm' | 'thighCm' | 'armCm' | 'chestCm'
type SaveStage = 'idle' | 'preparing' | 'uploading' | 'saving' | 'done'

const photoAngles: Array<{ id: ProgressCheckInAngle; label: string; hint: string }> = [
  { id: 'front', label: 'Mặt trước', hint: 'Đứng thẳng, thả lỏng' },
  { id: 'back', label: 'Mặt sau', hint: 'Vai và hông cân bằng' },
  { id: 'left', label: 'Nghiêng trái', hint: 'Xoay người 90°' },
  { id: 'right', label: 'Nghiêng phải', hint: 'Xoay người 90°' },
]

const measurementFields: Array<{ id: MeasurementKey; label: string; unit: string; placeholder: string; min: number; max: number }> = [
  { id: 'weightKg', label: 'Cân nặng', unit: 'kg', placeholder: '55.5', min: 25, max: 300 },
  { id: 'bodyFatPercentage', label: 'Mỡ cơ thể', unit: '%', placeholder: '24', min: 2, max: 70 },
  { id: 'muscleMassKg', label: 'Khối lượng cơ', unit: 'kg', placeholder: '22', min: 5, max: 150 },
  { id: 'waistCm', label: 'Vòng eo', unit: 'cm', placeholder: '68', min: 30, max: 200 },
  { id: 'hipsCm', label: 'Vòng mông', unit: 'cm', placeholder: '92', min: 40, max: 220 },
  { id: 'thighCm', label: 'Vòng đùi', unit: 'cm', placeholder: '52', min: 20, max: 120 },
  { id: 'armCm', label: 'Bắp tay', unit: 'cm', placeholder: '26', min: 10, max: 80 },
  { id: 'chestCm', label: 'Vòng ngực', unit: 'cm', placeholder: '84', min: 40, max: 220 },
]

function todayKey() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

function fileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(new Error('Không thể đọc ảnh đã chọn.'))
    reader.readAsDataURL(file)
  })
}

async function imageSource(file: File) {
  if ('createImageBitmap' in window) {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
      return { source: bitmap as CanvasImageSource, width: bitmap.width, height: bitmap.height, dispose: () => bitmap.close() }
    } catch {
      // Safari can decode some camera formats through an image element even
      // when createImageBitmap rejects them, so continue with that fallback.
    }
  }
  const url = URL.createObjectURL(file)
  const image = new Image()
  image.decoding = 'async'
  image.src = url
  try {
    await image.decode()
    return { source: image as CanvasImageSource, width: image.naturalWidth, height: image.naturalHeight, dispose: () => URL.revokeObjectURL(url) }
  } catch {
    URL.revokeObjectURL(url)
    throw new Error('PROGRESS_IMAGE_UNSUPPORTED')
  }
}

/** Camera photos are normalized before upload so HEIC-capable browsers send
 * a Storage-compatible JPEG and four large originals never upload in series. */
export async function prepareProgressPhoto(file: File) {
  const decoded = await imageSource(file)
  try {
    const maximumSide = 1_600
    const scale = Math.min(1, maximumSide / Math.max(decoded.width, decoded.height))
    const width = Math.max(1, Math.round(decoded.width * scale))
    const height = Math.max(1, Math.round(decoded.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d', { alpha: false })
    if (!context) throw new Error('PROGRESS_IMAGE_PROCESSING_FAILED')
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, width, height)
    context.drawImage(decoded.source, 0, 0, width, height)
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', .84))
    canvas.width = 1
    canvas.height = 1
    if (!blob || blob.size <= 0 || blob.size > 9 * 1024 * 1024) throw new Error('PROGRESS_IMAGE_PROCESSING_FAILED')
    const stem = file.name.replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9_-]+/g, '-').slice(0, 70) || 'aura-progress'
    return new File([blob], `${stem}.jpg`, { type: 'image/jpeg', lastModified: Date.now() })
  } finally {
    decoded.dispose()
  }
}

function saveErrorMessage(cause: unknown, stage: SaveStage) {
  const code = cause && typeof cause === 'object' && 'code' in cause ? String((cause as { code?: unknown }).code || '') : ''
  const message = cause instanceof Error ? cause.message : ''
  if (message === 'PROGRESS_IMAGE_UNSUPPORTED') return 'Điện thoại chưa đọc được định dạng ảnh này. Hãy chọn ảnh JPG/PNG hoặc chụp lại bằng camera.'
  if (message === 'PROGRESS_IMAGE_PROCESSING_FAILED') return 'Chưa thể tối ưu ảnh đã chọn. Hãy chọn lại ảnh khác hoặc chụp lại.'
  if (message === 'PROGRESS_UPLOAD_TIMEOUT' || code.includes('retry-limit-exceeded')) return 'Tải ảnh quá lâu do kết nối yếu. Ảnh và số đo vẫn được giữ để bạn thử lại.'
  if (code.includes('unauthorized') || code.includes('permission-denied')) return 'Phiên đăng nhập chưa có quyền lưu tiến độ. Hãy tải lại ứng dụng, đăng nhập lại rồi thử lần nữa.'
  if (code.includes('network') || code.includes('unavailable') || message === 'PROGRESS_OFFLINE') return 'Mạng đang gián đoạn. Ảnh và số đo vẫn được giữ; hãy thử lại khi có kết nối.'
  if (stage === 'uploading') return 'Chưa tải được một trong các ảnh. Dữ liệu đã nhập vẫn được giữ để thử lại.'
  if (stage === 'saving') return 'Ảnh đã xử lý nhưng chưa ghi được số đo. Hãy bấm “Thử lưu lại”.'
  return message && !/firebase|internal/i.test(message) ? message : 'Chưa thể lưu tiến độ. Dữ liệu đã nhập vẫn được giữ để thử lại.'
}

function readList<T>(key: string): T[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || '[]')
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function ProgressPhotoStudio({ onNavigate, ownerId }: { onNavigate: (path: any) => void; ownerId: string }) {
  const [date, setDate] = useState(todayKey)
  const [photos, setPhotos] = useState<PhotoDrafts>({})
  const photoDraftsRef = useRef<PhotoDrafts>({})
  const uploadedPhotosRef = useRef<string[]>([])
  const [measurements, setMeasurements] = useState<Record<MeasurementKey, string>>({
    weightKg: '', bodyFatPercentage: '', muscleMassKg: '', waistCm: '', hipsCm: '', thighCm: '', armCm: '', chestCm: '',
  })
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [uploadPercent, setUploadPercent] = useState(0)
  const [saveStage, setSaveStage] = useState<SaveStage>('idle')
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

  useEffect(() => { photoDraftsRef.current = photos }, [photos])
  useEffect(() => () => {
    Object.values(photoDraftsRef.current).forEach((photo) => { if (photo) URL.revokeObjectURL(photo.previewUrl) })
  }, [])
  useEffect(() => {
    if (!saving) return undefined
    const keepFormOpen = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', keepFormOpen)
    return () => window.removeEventListener('beforeunload', keepFormOpen)
  }, [saving])

  const selectedPhotoCount = Object.keys(photos).length
  const completedMeasurementCount = Object.values(measurements).filter((value) => value.trim()).length
  const completionText = useMemo(() => {
    if (!selectedPhotoCount && !completedMeasurementCount) return 'Chưa nhập dữ liệu'
    return `${selectedPhotoCount} ảnh · ${completedMeasurementCount} chỉ số`
  }, [completedMeasurementCount, selectedPhotoCount])

  const selectPhoto = (angle: ProgressCheckInAngle, file?: File) => {
    setError('')
    if (!file) return
    if (!file.type.startsWith('image/')) return setError('Tệp đã chọn không phải hình ảnh.')
    if (file.size > 25 * 1024 * 1024) return setError('Ảnh gốc cần nhỏ hơn 25MB.')
    setPhotos((current) => {
      const previous = current[angle]
      if (previous) URL.revokeObjectURL(previous.previewUrl)
      return { ...current, [angle]: { file, previewUrl: URL.createObjectURL(file) } }
    })
  }

  const removePhoto = (angle: ProgressCheckInAngle) => {
    setPhotos((current) => {
      const previous = current[angle]
      if (previous) URL.revokeObjectURL(previous.previewUrl)
      const next = { ...current }
      delete next[angle]
      return next
    })
  }

  const parsedMeasurements = () => {
    const result: Partial<Record<MeasurementKey, number>> = {}
    for (const field of measurementFields) {
      const raw = measurements[field.id].trim().replace(',', '.')
      if (!raw) continue
      const value = Number(raw)
      if (!Number.isFinite(value) || value < field.min || value > field.max) {
        throw new Error(`${field.label} cần nằm trong khoảng ${field.min}–${field.max} ${field.unit}.`)
      }
      result[field.id] = Number(value.toFixed(1))
    }
    return result
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (saving) return
    setError('')
    setSaved(false)
    setUploadPercent(0)
    uploadedPhotosRef.current = []
    let failedStage: SaveStage = 'preparing'
    let completed = false
    try {
      const values = parsedMeasurements()
      if (!selectedPhotoCount && !Object.keys(values).length) throw new Error('Hãy thêm ít nhất một ảnh hoặc một chỉ số trước khi lưu.')
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > todayKey()) throw new Error('Ngày ghi nhận không hợp lệ hoặc đang ở tương lai.')

      setSaving(true)
      const isCloudAccount = Boolean(ownerId && ownerId !== 'demo' && ownerId !== 'anonymous')
      if (isCloudAccount && firebaseAuth?.currentUser?.uid !== ownerId) throw Object.assign(new Error('Phiên đăng nhập đã thay đổi.'), { code: 'permission-denied' })
      if (isCloudAccount && !navigator.onLine) throw new Error('PROGRESS_OFFLINE')
      const checkInId = `checkin-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      const entries = Object.entries(photos) as Array<[ProgressCheckInAngle, PhotoDraft]>
      setSaveStage('preparing')
      const preparedEntries: Array<[ProgressCheckInAngle, File]> = []
      for (let index = 0; index < entries.length; index += 1) {
        preparedEntries.push([entries[index][0], await prepareProgressPhoto(entries[index][1].file)])
        setUploadPercent(Math.round(((index + 1) / Math.max(1, entries.length)) * 18))
      }

      failedStage = 'uploading'
      setSaveStage('uploading')
      const photoProgress = preparedEntries.map(() => 0)
      const outcomes = await Promise.allSettled(preparedEntries.map(async ([angle, file], index) => {
        const imageUrl = isCloudAccount
          ? await uploadUserProgressPhoto(ownerId, file, (percent) => {
            photoProgress[index] = percent
            const average = photoProgress.reduce((sum, value) => sum + value, 0) / Math.max(1, photoProgress.length)
            setUploadPercent(Math.round(18 + average * .72))
          })
          : await fileAsDataUrl(file)
        if (isCloudAccount) uploadedPhotosRef.current.push(imageUrl)
        return { id: `${checkInId}-${angle}`, angle, imageUrl }
      }))
      const failedUpload = outcomes.find((outcome): outcome is PromiseRejectedResult => outcome.status === 'rejected')
      if (failedUpload) throw failedUpload.reason
      const uploadedPhotos: ProgressCheckInInput['photos'] = outcomes
        .filter((outcome): outcome is PromiseFulfilledResult<ProgressCheckInInput['photos'][number]> => outcome.status === 'fulfilled')
        .map((outcome) => outcome.value)

      const payload: ProgressCheckInInput = { id: checkInId, date, ...values, measurementNote: note.trim().slice(0, 240) || undefined, photos: uploadedPhotos }
      failedStage = 'saving'
      setSaveStage('saving')
      setUploadPercent(94)
      if (isCloudAccount) await saveUserProgressCheckIn(ownerId, payload)

      const metricsKey = `aura:progress:body-measurements:${ownerId}`
      if (Object.keys(values).length) {
        let previousMetrics: Partial<BodyMeasurements> = {}
        try { previousMetrics = JSON.parse(localStorage.getItem(metricsKey) || '{}') } catch { previousMetrics = {} }
        safeLocalStorageSet(metricsKey, JSON.stringify({ ...previousMetrics, ...values, measurementNote: payload.measurementNote, updatedAt: date }))
      }

      if (values.weightKg) {
        const weightKey = `aura:progress:weight-records:${ownerId}`
        const previous = readList<WeightRecord>(weightKey)
        const record: WeightRecord = { id: checkInId, date, label: date.slice(5).split('-').reverse().join('/'), weightKg: values.weightKg, trendKg: values.weightKg, note: payload.measurementNote }
        safeLocalStorageSet(weightKey, JSON.stringify([...previous.filter((item) => item.id !== checkInId), record]))
      }

      const localPhotoRows = uploadedPhotos.map((photo: ProgressCheckInInput['photos'][number]) => ({ ...photo, checkInId, date, recordedAt: date, weightKg: values.weightKg, bodyFat: values.bodyFatPercentage, muscleMassKg: values.muscleMassKg, waistCm: values.waistCm, hipsCm: values.hipsCm, thighCm: values.thighCm, armCm: values.armCm, chestCm: values.chestCm, notes: payload.measurementNote || '', isPrivate: true, createdAt: new Date().toISOString() }))
      const photoKey = `aura:progress-photos:${ownerId}`
      const nextPhotos = [...localPhotoRows, ...readList<Record<string, unknown>>(photoKey)]
      safeLocalStorageSet(photoKey, JSON.stringify(nextPhotos))
      safeLocalStorageSet(`aura:cache:user_progress_photos:${ownerId}`, JSON.stringify(nextPhotos))
      const canonicalKey = `aura:cache:user_progress_checkins:${ownerId}`
      const canonicalRow = { ...payload, checkInId, source: 'student', verificationStatus: 'self_reported', createdAt: new Date().toISOString() }
      safeLocalStorageSet(canonicalKey, JSON.stringify([canonicalRow, ...readList<Record<string, unknown>>(canonicalKey).filter((item) => item.id !== checkInId)]))
      window.dispatchEvent(new Event('aura:progress-photos-updated'))
      window.dispatchEvent(new Event('aura:progress-updated'))

      setUploadPercent(100)
      uploadedPhotosRef.current = []
      setSaveStage('done')
      setSaved(true)
      completed = true
      window.setTimeout(() => onNavigate('progress'), 250)
    } catch (cause) {
      // A failed metadata batch or upload should not leave newly uploaded
      // private assets behind. Existing assets are never touched.
      const currentUrls = Object.values(uploadedPhotosRef.current)
      if (currentUrls.length) await Promise.allSettled(currentUrls.map((url) => deleteUploadedProgressPhotoAsset(url)))
      reportClientIssue(failedStage === 'saving' ? 'firestore' : 'ui', cause, { phase: `progress_checkin_${failedStage}`, retryable: true })
      setError(saveErrorMessage(cause, failedStage))
    } finally {
      setSaving(false)
      if (!completed) setSaveStage('idle')
    }
  }

  const saveStatus = saveStage === 'preparing' ? 'Đang tối ưu ảnh trên thiết bị…'
    : saveStage === 'uploading' ? `Đang tải ảnh… ${uploadPercent}%`
      : saveStage === 'saving' ? 'Đang ghi số đo…'
        : saveStage === 'done' ? 'Đã lưu tiến độ' : error ? 'Dữ liệu vẫn được giữ để thử lại.' : 'Ảnh được tối ưu trước khi tải để lưu nhanh hơn.'

  return (
    <main className="progress-checkin-page">
      <header className="progress-checkin-header">
        <button type="button" onClick={() => onNavigate('progress')} aria-label="Quay lại trang tiến độ"><ArrowLeft /></button>
        <div><h1>Ảnh & số đo hôm nay</h1><p>Lưu cùng một lần để dễ đối chiếu.</p></div>
        <span>{completionText}</span>
      </header>

      <form className="progress-checkin-form" onSubmit={submit}>
        {error && <div className="progress-checkin-message is-error" role="alert">{error}</div>}
        {saved && <div className="progress-checkin-message is-success" role="status"><Check /> Đã lưu đầy đủ lần ghi nhận.</div>}

        <section className="progress-checkin-intro" aria-label="Ngày và dữ liệu ghi nhận">
          <label><span>Ngày ghi nhận</span><input type="date" value={date} max={todayKey()} onChange={(event) => setDate(event.target.value)} /></label>
          <div><strong>{completionText}</strong><small>Không cần nhập đủ tất cả mục.</small></div>
        </section>

        <section className="progress-checkin-section">
          <div className="progress-checkin-section__heading"><div><span className="progress-checkin-step">1</span><span><h2>Ảnh cơ thể</h2><p>Chọn các góc cần theo dõi. Nên chụp cùng vị trí và ánh sáng.</p></span></div><b>{selectedPhotoCount}/4 ảnh</b></div>
          <div className="progress-checkin-photo-grid">
            {photoAngles.map((angle) => {
              const photo = photos[angle.id]
              return <div className={`progress-checkin-photo-slot ${photo ? 'has-photo' : ''}`} key={angle.id}>
                <label>
                  {photo ? <img src={photo.previewUrl} alt={`Xem trước ${angle.label.toLowerCase()}`} /> : <span className="progress-checkin-photo-slot__empty"><ImagePlus /><strong>{angle.label}</strong><small>{angle.hint}</small></span>}
                  <input type="file" accept="image/*" onChange={(event) => selectPhoto(angle.id, event.target.files?.[0])} />
                </label>
                {photo && <><span className="progress-checkin-photo-slot__label">{angle.label}</span><button type="button" onClick={() => removePhoto(angle.id)} aria-label={`Xóa ảnh ${angle.label.toLowerCase()}`}><Trash2 /></button></>}
              </div>
            })}
          </div>
        </section>

        <section className="progress-checkin-section">
          <div className="progress-checkin-section__heading"><div><span className="progress-checkin-step">2</span><span><h2>Số đo cơ thể</h2><p>Chỉ nhập những chỉ số đã đo hôm nay.</p></span></div><b>{completedMeasurementCount}/8 chỉ số</b></div>
          <div className="progress-checkin-measurement-grid">
            {measurementFields.map((field) => <label key={field.id}><span>{field.label}</span><span className="progress-checkin-number"><input type="number" inputMode="decimal" step="0.1" min={field.min} max={field.max} placeholder={field.placeholder} value={measurements[field.id]} onChange={(event) => setMeasurements((current) => ({ ...current, [field.id]: event.target.value }))} /><small>{field.unit}</small></span></label>)}
          </div>
          <label className="progress-checkin-note"><span>Ghi chú <small>không bắt buộc</small></span><textarea rows={3} maxLength={240} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Ví dụ: đo buổi sáng, trước khi ăn…" /></label>
        </section>

        <aside className="progress-checkin-privacy"><LockKeyhole /><span><strong>Ảnh được bảo vệ</strong><small>Chỉ bạn và đội ngũ Aura có quyền chăm sóc hồ sơ mới xem được.</small></span></aside>
        <div className="progress-checkin-submit-wrap">
          <div><Info /><span>{saveStatus}</span></div>
          <span className="progress-checkin-save-progress" aria-hidden="true"><i style={{ width: `${saving || saved ? uploadPercent : 0}%` }} /></span>
          <button type="submit" disabled={saving || saved}>{saving ? <LoaderCircle className="is-spinning" /> : saved ? <Check /> : <Scale />}{saving ? 'Đang lưu…' : saved ? 'Đã lưu' : error ? 'Thử lưu lại' : 'Lưu tiến độ'}</button>
        </div>
      </form>
    </main>
  )
}

export default ProgressPhotoStudio
