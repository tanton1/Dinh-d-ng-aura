import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, Camera, Check, ImagePlus, Info, LoaderCircle, LockKeyhole, Ruler, Scale, Trash2 } from 'lucide-react'
import { safeLocalStorageSet } from '../../lib/safeStorage'
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
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

  useEffect(() => { photoDraftsRef.current = photos }, [photos])
  useEffect(() => () => {
    Object.values(photoDraftsRef.current).forEach((photo) => { if (photo) URL.revokeObjectURL(photo.previewUrl) })
  }, [])

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
    if (file.size > 10 * 1024 * 1024) return setError('Mỗi ảnh cần nhỏ hơn 10MB.')
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
    uploadedPhotosRef.current = []
    try {
      const values = parsedMeasurements()
      if (!selectedPhotoCount && !Object.keys(values).length) throw new Error('Hãy thêm ít nhất một ảnh hoặc một chỉ số trước khi lưu.')
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > todayKey()) throw new Error('Ngày ghi nhận không hợp lệ hoặc đang ở tương lai.')

      setSaving(true)
      const isCloudAccount = Boolean(ownerId && ownerId !== 'demo' && ownerId !== 'anonymous')
      const checkInId = `checkin-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      const entries = Object.entries(photos) as Array<[ProgressCheckInAngle, PhotoDraft]>
      const uploadedPhotos: ProgressCheckInInput['photos'] = []
      for (let index = 0; index < entries.length; index += 1) {
        const [angle, photo] = entries[index]
        const imageUrl = isCloudAccount
          ? await uploadUserProgressPhoto(ownerId, photo.file, (percent) => setUploadPercent(Math.round(((index + percent / 100) / Math.max(1, entries.length)) * 100)))
          : await fileAsDataUrl(photo.file)
        if (isCloudAccount) uploadedPhotosRef.current.push(imageUrl)
        uploadedPhotos.push({ id: `${checkInId}-${angle}`, angle, imageUrl })
      }

      const payload: ProgressCheckInInput = { id: checkInId, date, ...values, measurementNote: note.trim().slice(0, 240) || undefined, photos: uploadedPhotos }
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

      const localPhotoRows = uploadedPhotos.map((photo: ProgressCheckInInput['photos'][number]) => ({ ...photo, checkInId, date, recordedAt: date, weightKg: values.weightKg, bodyFat: values.bodyFatPercentage, waistCm: values.waistCm, hipsCm: values.hipsCm, thighCm: values.thighCm, armCm: values.armCm, chestCm: values.chestCm, notes: payload.measurementNote || '', isPrivate: true, createdAt: new Date().toISOString() }))
      const photoKey = `aura:progress-photos:${ownerId}`
      const nextPhotos = [...localPhotoRows, ...readList<Record<string, unknown>>(photoKey)]
      safeLocalStorageSet(photoKey, JSON.stringify(nextPhotos))
      safeLocalStorageSet(`aura:cache:user_progress_photos:${ownerId}`, JSON.stringify(nextPhotos))
      window.dispatchEvent(new Event('aura:progress-photos-updated'))

      setUploadPercent(100)
      uploadedPhotosRef.current = []
      setSaved(true)
      window.setTimeout(() => onNavigate('progress'), 450)
    } catch (cause) {
      // A failed metadata batch or upload should not leave newly uploaded
      // private assets behind. Existing assets are never touched.
      const currentUrls = Object.values(uploadedPhotosRef.current)
      if (currentUrls.length) await Promise.allSettled(currentUrls.map((url) => deleteUploadedProgressPhotoAsset(url)))
      setError(cause instanceof Error ? cause.message : 'Chưa thể lưu lần ghi nhận tiến độ.')
    } finally {
      setSaving(false)
    }
  }

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

        <section className="progress-checkin-section">
          <div className="progress-checkin-section__heading"><div><Camera /><span><h2>Bộ ảnh cơ thể</h2><p>Có thể chọn một hoặc đủ bốn góc. Nên chụp cùng vị trí và ánh sáng.</p></span></div><b>{selectedPhotoCount}/4 ảnh</b></div>
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
          <div className="progress-checkin-section__heading"><div><Ruler /><span><h2>Số đo cơ thể</h2><p>Không bắt buộc nhập hết. Ghi đúng các chỉ số đã đo hôm nay.</p></span></div><b>{completedMeasurementCount}/8 chỉ số</b></div>
          <label className="progress-checkin-date"><span>Ngày ghi nhận</span><input type="date" value={date} max={todayKey()} onChange={(event) => setDate(event.target.value)} /></label>
          <div className="progress-checkin-measurement-grid">
            {measurementFields.map((field) => <label key={field.id}><span>{field.label}</span><span className="progress-checkin-number"><input type="number" inputMode="decimal" step="0.1" min={field.min} max={field.max} placeholder={field.placeholder} value={measurements[field.id]} onChange={(event) => setMeasurements((current) => ({ ...current, [field.id]: event.target.value }))} /><small>{field.unit}</small></span></label>)}
          </div>
          <label className="progress-checkin-note"><span>Ghi chú <small>không bắt buộc</small></span><textarea rows={3} maxLength={240} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Ví dụ: đo buổi sáng, trước khi ăn…" /></label>
        </section>

        <aside className="progress-checkin-privacy"><LockKeyhole /><span><strong>Ảnh được bảo vệ</strong><small>Chỉ bạn và đội ngũ Aura có quyền chăm sóc hồ sơ mới xem được.</small></span></aside>
        <div className="progress-checkin-submit-wrap">
          <div><Info /><span>{saving ? `Đang tải và lưu dữ liệu${selectedPhotoCount ? ` · ${uploadPercent}%` : ''}` : 'Bạn có thể bổ sung các chỉ số còn thiếu vào lần sau.'}</span></div>
          <button type="submit" disabled={saving || saved}>{saving ? <LoaderCircle className="is-spinning" /> : <Scale />}{saving ? 'Đang lưu…' : saved ? 'Đã lưu' : 'Lưu lần ghi nhận'}</button>
        </div>
      </form>
    </main>
  )
}

export default ProgressPhotoStudio
