import React, { useState } from 'react'
import { Activity, BicepsFlexed, Check, CircleDot, PersonStanding, X } from 'lucide-react'
import type { BodyMeasurements } from '../../types/progressTypes'

interface BodyMeasurementsModalProps {
  metrics: BodyMeasurements
  onClose: () => void
  onSave: (updated: Partial<BodyMeasurements>) => void | Promise<void>
}

export function BodyMeasurementsModal({ metrics, onClose, onSave }: BodyMeasurementsModalProps) {
  const [waist, setWaist] = useState(String(metrics.waistCm))
  const [bodyFat, setBodyFat] = useState(String(metrics.bodyFatPercentage))
  const [muscle, setMuscle] = useState(String(metrics.muscleMassKg))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError(null)
    try {
      await onSave({
        waistCm: parseFloat(waist) || metrics.waistCm,
        bodyFatPercentage: parseFloat(bodyFat) || metrics.bodyFatPercentage,
        muscleMassKg: parseFloat(muscle) || metrics.muscleMassKg,
        updatedAt: new Date().toISOString().split('T')[0],
      })
      onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Chưa thể lưu chỉ số cơ thể.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="pg-modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="pg-modal-sheet">
        <div className="pg-modal-header">
          <h2>Cập nhật chỉ số cơ thể</h2>
          <button type="button" onClick={onClose} className="pg-modal-close-btn" aria-label="Đóng">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {error && <div role="alert" style={{ padding: '10px 12px', borderRadius: 12, background: '#fff1f2', color: '#b42318', fontSize: 13, fontWeight: 600 }}>{error}</div>}
          <div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 700, color: '#475569', marginBottom: 6 }}>
              <Activity size={16} style={{ color: '#9333ea' }} />
              <span>Vòng eo (cm)</span>
            </label>
            <input
              type="number"
              value={waist}
              onChange={(e) => setWaist(e.target.value)}
              style={{
                width: '100%',
                height: 46,
                borderRadius: 14,
                border: '1px solid #cbd5e1',
                padding: '0 16px',
                fontSize: 16,
                fontWeight: 700,
                color: '#0f172a',
              }}
            />
          </div>

          <div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 700, color: '#475569', marginBottom: 6 }}>
              <CircleDot size={16} style={{ color: '#ea580c' }} />
              <span>Tỷ lệ mỡ cơ thể (%)</span>
            </label>
            <input
              type="number"
              step="0.1"
              value={bodyFat}
              onChange={(e) => setBodyFat(e.target.value)}
              style={{
                width: '100%',
                height: 46,
                borderRadius: 14,
                border: '1px solid #cbd5e1',
                padding: '0 16px',
                fontSize: 16,
                fontWeight: 700,
                color: '#0f172a',
              }}
            />
          </div>

          <div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 700, color: '#475569', marginBottom: 6 }}>
              <BicepsFlexed size={16} style={{ color: '#059669' }} />
              <span>Khối lượng cơ (kg)</span>
            </label>
            <input
              type="number"
              step="0.1"
              value={muscle}
              onChange={(e) => setMuscle(e.target.value)}
              style={{
                width: '100%',
                height: 46,
                borderRadius: 14,
                border: '1px solid #cbd5e1',
                padding: '0 16px',
                fontSize: 16,
                fontWeight: 700,
                color: '#0f172a',
              }}
            />
          </div>

          <button
            type="submit"
            disabled={saving}
            style={{
              height: 48,
              borderRadius: 16,
              border: 'none',
              background: 'linear-gradient(110deg, #ec4899 0%, #fb923c 100%)',
              color: '#ffffff',
              fontSize: 15,
              fontWeight: 800,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              cursor: saving ? 'wait' : 'pointer',
              marginTop: 10,
              boxShadow: '0 8px 20px rgba(247, 37, 103, 0.25)',
            }}
          >
            <Check size={18} strokeWidth={3} />
            <span>{saving ? 'Đang lưu…' : 'Lưu chỉ số'}</span>
          </button>
        </form>
      </div>
    </div>
  )
}
