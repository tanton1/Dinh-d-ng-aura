import React, { useState } from 'react'
import { Calendar, Check, Scale, X } from 'lucide-react'

interface WeightLogModalProps {
  currentWeight: number
  onClose: () => void
  onSave: (weightKg: number, note?: string) => void
}

export function WeightLogModal({ currentWeight = 65.0, onClose, onSave }: WeightLogModalProps) {
  const [val, setVal] = useState<string>(String(currentWeight))
  const [note, setNote] = useState<string>('')
  const [date, setDate] = useState<string>(new Date().toISOString().split('T')[0])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const num = parseFloat(val)
    if (!isNaN(num) && num > 20 && num < 300) {
      onSave(num, note)
      onClose()
    }
  }

  return (
    <div className="pg-modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="pg-modal-sheet">
        <div className="pg-modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 36, height: 36, borderRadius: 12, background: '#fce7f3', color: '#db2777', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Scale size={20} />
            </div>
            <h2>Ghi nhận cân nặng</h2>
          </div>
          <button type="button" onClick={onClose} className="pg-modal-close-btn" aria-label="Đóng">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 700, color: '#475569', marginBottom: 6 }}>
              Cân nặng (kg)
            </label>
            <div style={{ position: 'relative' }}>
              <input
                type="number"
                step="0.1"
                min="30"
                max="250"
                value={val}
                onChange={(e) => setVal(e.target.value)}
                style={{
                  width: '100%',
                  height: 52,
                  borderRadius: 16,
                  border: '1px solid #cbd5e1',
                  padding: '0 16px',
                  fontSize: 24,
                  fontWeight: 900,
                  color: '#0f172a',
                  outline: 'none',
                }}
                required
              />
              <span style={{ position: 'absolute', right: 16, top: '50%', transform: 'translateY(-50%)', fontWeight: 800, color: '#94a3b8' }}>
                kg
              </span>
            </div>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 700, color: '#475569', marginBottom: 6 }}>
              Ngày cân
            </label>
            <div style={{ position: 'relative' }}>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                style={{
                  width: '100%',
                  height: 46,
                  borderRadius: 14,
                  border: '1px solid #cbd5e1',
                  padding: '0 16px',
                  fontSize: 14,
                  fontWeight: 600,
                  color: '#0f172a',
                  outline: 'none',
                }}
              />
            </div>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 700, color: '#475569', marginBottom: 6 }}>
              Ghi chú (Tùy chọn)
            </label>
            <input
              type="text"
              placeholder="Ví dụ: Vừa ngủ dậy, nhịn ăn..."
              value={note}
              onChange={(e) => setNote(e.target.value)}
              style={{
                width: '100%',
                height: 46,
                borderRadius: 14,
                border: '1px solid #cbd5e1',
                padding: '0 16px',
                fontSize: 14,
                color: '#0f172a',
                outline: 'none',
              }}
            />
          </div>

          <button
            type="submit"
            style={{
              height: 50,
              borderRadius: 16,
              border: 'none',
              background: 'linear-gradient(110deg, #f72567 0%, #ff7a38 100%)',
              color: '#ffffff',
              fontSize: 15,
              fontWeight: 800,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              cursor: 'pointer',
              marginTop: 8,
              boxShadow: '0 8px 20px rgba(247, 37, 103, 0.25)',
            }}
          >
            <Check size={18} strokeWidth={3} />
            <span>Lưu cân nặng</span>
          </button>
        </form>
      </div>
    </div>
  )
}
