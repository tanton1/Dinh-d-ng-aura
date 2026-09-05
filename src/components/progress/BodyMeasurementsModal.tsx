import React, { useState } from 'react'
import { Activity, BicepsFlexed, Check, CircleDot, Ruler, X } from 'lucide-react'
import type { BodyMeasurements } from '../../types/progressTypes'

interface BodyMeasurementsModalProps {
  metrics: BodyMeasurements
  isFemale?: boolean
  onClose: () => void
  onSave: (updated: Partial<BodyMeasurements>) => void | Promise<void>
}

type MeasurementKey = 'waistCm' | 'bodyFatPercentage' | 'muscleMassKg' | 'hipsCm' | 'thighCm' | 'armCm' | 'chestCm'

const FIELD_RULES: Record<MeasurementKey, { min: number; max: number; label: string }> = {
  waistCm: { min: 30, max: 200, label: 'Vòng eo' },
  bodyFatPercentage: { min: 2, max: 70, label: 'Tỷ lệ mỡ cơ thể' },
  muscleMassKg: { min: 1, max: 150, label: 'Khối lượng cơ' },
  hipsCm: { min: 40, max: 220, label: 'Vòng hông' },
  thighCm: { min: 20, max: 120, label: 'Vòng đùi' },
  armCm: { min: 10, max: 80, label: 'Bắp tay' },
  chestCm: { min: 40, max: 220, label: 'Vòng ngực' },
}

function initialValue(value: number | undefined) {
  return value && value > 0 ? String(value) : ''
}

interface MeasurementFieldProps {
  id: string
  label: string
  unit: string
  value: string
  onChange: (value: string) => void
  icon: React.ReactNode
  hint?: string
}

function MeasurementField({ id, label, unit, value, onChange, icon, hint }: MeasurementFieldProps) {
  return (
    <label className="pg-measurement-field" htmlFor={id}>
      <span className="pg-field-label"><span className="pg-field-icon">{icon}</span>{label}<small>({unit})</small></span>
      <span className="pg-input-with-unit">
        <input id={id} type="number" inputMode="decimal" step="0.1" value={value} onChange={(event) => onChange(event.target.value)} />
        <span>{unit}</span>
      </span>
      {hint && <small className="pg-field-hint">{hint}</small>}
    </label>
  )
}

export function BodyMeasurementsModal({ metrics, isFemale = false, onClose, onSave }: BodyMeasurementsModalProps) {
  const [values, setValues] = useState<Record<MeasurementKey, string>>({
    waistCm: initialValue(metrics.waistCm),
    bodyFatPercentage: initialValue(metrics.bodyFatPercentage),
    muscleMassKg: initialValue(metrics.muscleMassKg),
    hipsCm: initialValue(metrics.hipsCm),
    thighCm: initialValue(metrics.thighCm),
    armCm: initialValue(metrics.armCm),
    chestCm: initialValue(metrics.chestCm),
  })
  const [measurementNote, setMeasurementNote] = useState(metrics.measurementNote ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const setValue = (key: MeasurementKey, value: string) => {
    setValues((current) => ({ ...current, [key]: value }))
  }

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError(null)
    const payload: Partial<BodyMeasurements> = { updatedAt: new Date().toISOString() }

    for (const key of Object.keys(FIELD_RULES) as MeasurementKey[]) {
      const raw = values[key].trim()
      if (!raw) {
        const existing = Number(metrics[key])
        if (Number.isFinite(existing) && existing > 0) payload[key] = existing as never
        continue
      }
      const number = Number(raw)
      const rule = FIELD_RULES[key]
      if (!Number.isFinite(number) || number < rule.min || number > rule.max) {
        setError(`${rule.label} cần nằm trong khoảng ${rule.min}–${rule.max}.`)
        return
      }
      payload[key] = Number(number.toFixed(1)) as never
    }

    if (measurementNote.trim()) payload.measurementNote = measurementNote.trim().slice(0, 240)
    const hasMeasurementData = (Object.keys(FIELD_RULES) as MeasurementKey[]).some((key) => key in payload)
    if (!hasMeasurementData && !measurementNote.trim()) {
      setError('Hãy nhập ít nhất một số đo hoặc ghi chú trước khi lưu.')
      return
    }

    setSaving(true)
    try {
      await onSave(payload)
      onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Chưa thể lưu chỉ số cơ thể.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="pg-modal-backdrop" onClick={(event) => event.target === event.currentTarget && onClose()}>
      <section className="pg-modal-sheet pg-measurement-modal" role="dialog" aria-modal="true" aria-labelledby="measurement-modal-title">
        <div className="pg-modal-header">
          <div><span className="pg-section-eyebrow">CẬP NHẬT HÀNH TRÌNH</span><h2 id="measurement-modal-title">Số đo cơ thể</h2></div>
          <button type="button" onClick={onClose} className="pg-modal-close-btn" aria-label="Đóng"><X size={18} /></button>
        </div>
        <p className="pg-modal-lead">Các trường đều không bắt buộc. BMI sẽ được tính tự động từ cân nặng và chiều cao trong hồ sơ.</p>

        <form onSubmit={handleSubmit} className="pg-measurement-form">
          {error && <div role="alert" className="pg-form-error">{error}</div>}

          <div className="pg-form-section">
            <div className="pg-form-section-heading"><h3>Chỉ số nền tảng</h3><span>Ghi số đo mới nhất</span></div>
            <div className="pg-measurement-grid">
              <MeasurementField id="body-waist" label="Vòng eo" unit="cm" value={values.waistCm} onChange={(value) => setValue('waistCm', value)} icon={<Activity size={16} />} />
              <MeasurementField id="body-fat" label="Mỡ cơ thể" unit="%" value={values.bodyFatPercentage} onChange={(value) => setValue('bodyFatPercentage', value)} icon={<CircleDot size={16} />} />
              <MeasurementField id="body-muscle" label="Khối lượng cơ" unit="kg" value={values.muscleMassKg} onChange={(value) => setValue('muscleMassKg', value)} icon={<BicepsFlexed size={16} />} />
            </div>
          </div>

          <div className="pg-form-section">
            <div className="pg-form-section-heading"><div><h3>{isFemale ? 'Số đo hình thể' : 'Số đo bổ sung'}</h3><span>{isFemale ? 'Ưu tiên theo dõi eo, hông, đùi và bắp tay.' : 'Tùy chọn, dùng để theo dõi thay đổi hình thể.'}</span></div><span className="pg-soft-badge">Tùy chọn</span></div>
            <div className="pg-measurement-grid">
              <MeasurementField id="body-hips" label="Vòng hông" unit="cm" value={values.hipsCm} onChange={(value) => setValue('hipsCm', value)} icon={<Ruler size={16} />} hint="Đo ngang điểm đầy nhất" />
              <MeasurementField id="body-thigh" label="Vòng đùi" unit="cm" value={values.thighCm} onChange={(value) => setValue('thighCm', value)} icon={<Ruler size={16} />} />
              <MeasurementField id="body-arm" label="Bắp tay" unit="cm" value={values.armCm} onChange={(value) => setValue('armCm', value)} icon={<Ruler size={16} />} />
              <MeasurementField id="body-chest" label="Vòng ngực" unit="cm" value={values.chestCm} onChange={(value) => setValue('chestCm', value)} icon={<Ruler size={16} />} />
            </div>
          </div>

          <label className="pg-note-field" htmlFor="measurement-note"><span>Ghi chú lần đo <small>(không bắt buộc)</small></span><textarea id="measurement-note" value={measurementNote} maxLength={240} onChange={(event) => setMeasurementNote(event.target.value)} placeholder="Ví dụ: đo buổi sáng, trước bữa ăn…" rows={3} /></label>

          <button type="submit" disabled={saving} className="pg-primary-action"><Check size={18} strokeWidth={3} /><span>{saving ? 'Đang lưu…' : 'Lưu số đo'}</span></button>
        </form>
      </section>
    </div>
  )
}
