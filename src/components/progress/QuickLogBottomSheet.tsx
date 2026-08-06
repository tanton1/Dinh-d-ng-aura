import React from 'react'
import { Camera, Droplets, Dumbbell, Ruler, Scale, Utensils, X } from 'lucide-react'

interface QuickLogBottomSheetProps {
  onClose: () => void
  onSelectAction: (action: 'weight' | 'meal' | 'workout' | 'measurement' | 'photo' | 'water') => void
}

export function QuickLogBottomSheet({ onClose, onSelectAction }: QuickLogBottomSheetProps) {
  const actions = [
    { id: 'weight' as const, label: 'Cân nặng', icon: Scale, color: '#ec4899' },
    { id: 'meal' as const, label: 'Bữa ăn', icon: Utensils, color: '#ea580c' },
    { id: 'workout' as const, label: 'Buổi tập', icon: Dumbbell, color: '#9333ea' },
    { id: 'measurement' as const, label: 'Số đo', icon: Ruler, color: '#2563eb' },
    { id: 'photo' as const, label: 'Ảnh tiến độ', icon: Camera, color: '#059669' },
    { id: 'water' as const, label: 'Nước uống', icon: Droplets, color: '#0284c7' },
  ]

  return (
    <div className="pg-modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="pg-modal-sheet">
        <div className="pg-modal-header">
          <h2>Ghi nhanh</h2>
          <button type="button" onClick={onClose} className="pg-modal-close-btn" aria-label="Đóng">
            <X size={18} />
          </button>
        </div>

        <div className="pg-quick-grid">
          {actions.map((act) => {
            const Icon = act.icon
            return (
              <div
                key={act.id}
                className="pg-quick-item"
                onClick={() => {
                  onSelectAction(act.id)
                }}
              >
                <div className="pg-quick-icon">
                  <Icon size={20} />
                </div>
                <span className="pg-quick-label">{act.label}</span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
