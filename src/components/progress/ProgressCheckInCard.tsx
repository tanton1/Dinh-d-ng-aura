import { useEffect, useMemo, useState } from 'react'
import { Camera, ChevronRight, Image as ImageIcon, Ruler, Scale } from 'lucide-react'
import { safeLocalStorageSet } from '../../lib/safeStorage'
import { subscribeToUserProgressPhotos } from '../../services/firebaseService'
import type { BodyMeasurements } from '../../types/progressTypes'
import './ProgressCheckInCard.css'

type PhotoAngle = 'front' | 'back' | 'left' | 'right'

interface ProgressPhotoRow {
  id: string
  checkInId?: string
  date?: string
  recordedAt?: string
  angle?: string
  imageUrl?: string
  weightKg?: number
  bodyFat?: number
  bodyFatPercentage?: number
  waistCm?: number
  hipsCm?: number
  thighCm?: number
  armCm?: number
}

interface ProgressCheckInCardProps {
  ownerId: string
  metrics: BodyMeasurements
  currentWeightKg: number
  onOpenCheckIn: () => void
}

const angleOrder: PhotoAngle[] = ['front', 'back', 'left', 'right']
const angleLabels: Record<PhotoAngle, string> = {
  front: 'Mặt trước',
  back: 'Mặt sau',
  left: 'Nghiêng trái',
  right: 'Nghiêng phải',
}

function positive(value: unknown) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : null
}

function localPhotos(ownerId: string): ProgressPhotoRow[] {
  try {
    const raw = localStorage.getItem(`aura:progress-photos:${ownerId}`)
      || localStorage.getItem(`aura:cache:user_progress_photos:${ownerId}`)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function normalizedAngle(value: string | undefined): PhotoAngle {
  if (value === 'back') return 'back'
  if (value === 'right') return 'right'
  if (value === 'left' || value === 'side') return 'left'
  return 'front'
}

function dateKey(value: unknown) {
  if (typeof value === 'string') return value.slice(0, 10)
  if (value && typeof value === 'object' && 'toDate' in value && typeof value.toDate === 'function') {
    const date = value.toDate()
    return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10)
  }
  if (value && typeof value === 'object' && 'seconds' in value) {
    const milliseconds = Number(value.seconds) * 1000
    return Number.isFinite(milliseconds) ? new Date(milliseconds).toISOString().slice(0, 10) : ''
  }
  return ''
}

function formatDate(value: unknown) {
  const key = dateKey(value)
  if (!key) return 'Chưa có ngày đo'
  const date = new Date(`${key}T12:00:00`)
  if (Number.isNaN(date.getTime())) return key
  return new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(date)
}

export function ProgressCheckInCard({ ownerId, metrics, currentWeightKg, onOpenCheckIn }: ProgressCheckInCardProps) {
  const [photos, setPhotos] = useState<ProgressPhotoRow[]>(() => localPhotos(ownerId))
  const [selectedGroupKey, setSelectedGroupKey] = useState('')

  useEffect(() => {
    setPhotos(localPhotos(ownerId))
    const refreshLocal = () => setPhotos(localPhotos(ownerId))
    window.addEventListener('aura:progress-photos-updated', refreshLocal)

    if (!ownerId || ownerId === 'demo' || ownerId === 'anonymous') {
      return () => window.removeEventListener('aura:progress-photos-updated', refreshLocal)
    }

    let unsubscribe: (() => void) | undefined
    try {
      unsubscribe = subscribeToUserProgressPhotos(ownerId, (rows) => {
        if (!Array.isArray(rows)) return
        setPhotos(rows)
        safeLocalStorageSet(`aura:progress-photos:${ownerId}`, JSON.stringify(rows))
        safeLocalStorageSet(`aura:cache:user_progress_photos:${ownerId}`, JSON.stringify(rows))
      }, () => undefined)
    } catch {
      // The local snapshot remains visible while Firebase reconnects.
    }

    return () => {
      window.removeEventListener('aura:progress-photos-updated', refreshLocal)
      unsubscribe?.()
    }
  }, [ownerId])

  const groups = useMemo(() => {
    const dated = photos
      .filter((photo) => typeof photo.imageUrl === 'string' && photo.imageUrl)
      .map((photo) => ({ ...photo, dateKey: String(photo.date || photo.recordedAt || '').slice(0, 10) }))
      .sort((a, b) => b.dateKey.localeCompare(a.dateKey))
    const records = new Map<string, { key: string; date: string; byAngle: Map<PhotoAngle, ProgressPhotoRow>; sample: ProgressPhotoRow }>()
    dated.forEach((photo) => {
      const key = photo.checkInId || `legacy-${photo.dateKey}`
      const record = records.get(key) || { key, date: photo.dateKey, byAngle: new Map<PhotoAngle, ProgressPhotoRow>(), sample: photo }
      const angle = normalizedAngle(photo.angle)
      if (!record.byAngle.has(angle)) record.byAngle.set(angle, photo)
      records.set(key, record)
    })
    return [...records.values()].sort((a, b) => b.date.localeCompare(a.date))
  }, [photos])

  useEffect(() => {
    if (!groups.length) return setSelectedGroupKey('')
    if (!groups.some((group) => group.key === selectedGroupKey)) setSelectedGroupKey(groups[0].key)
  }, [groups, selectedGroupKey])

  const selectedGroup = groups.find((group) => group.key === selectedGroupKey) || groups[0]
  const selectedSnapshot = selectedGroup?.sample
  const selectedIsLatest = !selectedGroup || selectedGroup.key === groups[0]?.key
  const snapshotValue = (photoValue: unknown, currentValue: unknown) => positive(photoValue) ?? (selectedIsLatest ? positive(currentValue) : null)

  const metricItems = [
    { label: 'Cân nặng', value: snapshotValue(selectedSnapshot?.weightKg, currentWeightKg), unit: 'kg' },
    { label: 'Vòng eo', value: snapshotValue(selectedSnapshot?.waistCm, metrics.waistCm), unit: 'cm' },
    { label: 'Vòng mông', value: snapshotValue(selectedSnapshot?.hipsCm, metrics.hipsCm), unit: 'cm' },
    { label: 'Vòng đùi', value: snapshotValue(selectedSnapshot?.thighCm, metrics.thighCm), unit: 'cm' },
    { label: 'Bắp tay', value: snapshotValue(selectedSnapshot?.armCm, metrics.armCm), unit: 'cm' },
    { label: 'Mỡ cơ thể', value: snapshotValue(selectedSnapshot?.bodyFatPercentage ?? selectedSnapshot?.bodyFat, metrics.bodyFatPercentage), unit: '%' },
  ]
  const updatedDate = selectedGroup?.date || dateKey(metrics.updatedAt)

  return (
    <section className="pg-card pg-checkin-card" aria-labelledby="progress-checkin-heading">
      <div className="pg-checkin-card__heading">
        <div>
          <h2 id="progress-checkin-heading">Ảnh & số đo cơ thể</h2>
          <p>{groups.length ? `${groups.length} lần có ảnh · chọn ngày để xem lại trọn bộ.` : 'Một lần ghi nhận gồm đầy đủ ảnh và số đo để so sánh chính xác.'}</p>
        </div>
        <button type="button" onClick={onOpenCheckIn} className="pg-checkin-card__action">
          <Camera size={17} aria-hidden="true" />
          <span>Ghi nhận mới</span>
          <ChevronRight size={16} aria-hidden="true" />
        </button>
      </div>

      <div className="pg-checkin-card__body">
        <div className="pg-checkin-photos" aria-label="Bộ ảnh tiến độ theo ngày đã chọn">
          {angleOrder.map((angle) => {
            const photo = selectedGroup?.byAngle.get(angle)
            return (
              <div className={`pg-checkin-photo ${photo ? 'has-photo' : ''}`} key={angle}>
                {photo?.imageUrl
                  ? <img src={photo.imageUrl} alt={`${angleLabels[angle]} ngày ${formatDate(updatedDate)}`} loading="lazy" referrerPolicy="no-referrer" />
                  : <span><ImageIcon size={20} aria-hidden="true" /><small>Chưa có</small></span>}
                <b>{angleLabels[angle]}</b>
              </div>
            )
          })}
        </div>

        <div className="pg-checkin-measurements">
          <div className="pg-checkin-measurements__title">
            <span><Ruler size={16} aria-hidden="true" /> Số đo cùng lần</span>
            {groups.length > 1
              ? <select aria-label="Chọn lần ghi nhận" value={selectedGroup?.key || ''} onChange={(event) => setSelectedGroupKey(event.target.value)}>{groups.map((group) => <option value={group.key} key={group.key}>{formatDate(group.date)}</option>)}</select>
              : <time>{formatDate(updatedDate)}</time>}
          </div>
          <div className="pg-checkin-measurements__grid">
            {metricItems.map((item) => (
              <div key={item.label}>
                <span>{item.label}</span>
                <strong>{item.value === null ? '—' : item.value.toFixed(1).replace('.0', '')}<small>{item.value === null ? '' : item.unit}</small></strong>
              </div>
            ))}
          </div>
          {!metricItems.some((item) => item.value !== null) && (
            <button type="button" onClick={onOpenCheckIn} className="pg-checkin-empty">
              <Scale size={18} aria-hidden="true" /> Thêm số đo đầu tiên
            </button>
          )}
        </div>
      </div>
    </section>
  )
}
