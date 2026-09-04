import { useState } from 'react'
import { Bookmark, Camera, Droplets, Dumbbell, Plus, Search, Sparkles, X } from 'lucide-react'
import { useAccessibleDialog } from '../../features/nutrition/useAccessibleDialog'

export interface NutritionQuickAddSheetProps {
  savedCount: number
  onClose: () => void
  onScan?: () => void
  onCatalog?: () => void
  onSaved?: () => void
  onWater: () => void
  onExercise: () => void
}

export interface NutritionWaterLogSheetProps {
  current: number
  goal: number
  dateLabel: string
  todayEntries?: Array<{ id: string; time: string; amountMl: number }>
  onClose: () => void
  onLog: (amount: number) => void
  onRemoveEntry?: (id: string) => void
}

function formatNumber(value: number) {
  return new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 }).format(value)
}

export function NutritionQuickAddSheet({ savedCount, onClose, onScan, onCatalog, onSaved, onWater, onExercise }: NutritionQuickAddSheetProps) {
  const dialogRef = useAccessibleDialog(onClose)
  const actions = [
    ...(onScan ? [{ title: 'Chụp / Quét ảnh món ăn', copy: 'Phân tích calo & dinh dưỡng bằng AI', icon: <Camera size={22} />, action: onScan, primary: true }] : []),
    { title: 'Ghi lượng nước', copy: '250, 500, 750, 1000 ml', icon: <Droplets size={22} />, action: onWater, highlight: true },
    ...(onCatalog ? [{ title: 'Catalog dinh dưỡng', copy: 'Tra cứu món ăn và thực phẩm', icon: <Search size={22} />, action: onCatalog }] : []),
    { title: 'Ghi luyện tập', copy: 'Thời gian & cường độ', icon: <Dumbbell size={22} />, action: onExercise },
    ...(onSaved ? [{ title: 'Món đã lưu', copy: savedCount ? `${savedCount} món trong catalog` : 'Chưa có món đã lưu', icon: <Bookmark size={22} />, action: onSaved }] : []),
  ]

  return (
    <div className="nutrition-sheet-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section ref={dialogRef} className="nutrition-quick-sheet pink-orange-sheet" role="dialog" aria-modal="true" aria-labelledby="nutrition-quick-sheet-title">
        <header>
          <div>
            <span className="nutrition-kicker pink-orange-badge"><Sparkles size={12} /> THÊM NHANH</span>
            <h2 id="nutrition-quick-sheet-title">Bạn muốn ghi lại gì?</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Đóng bảng thêm nhanh"><X size={20} /></button>
        </header>
        <div className="nutrition-quick-sheet__grid">
          {actions.map((item, index) => (
            <button
              type="button"
              key={item.title}
              className={`${item.primary ? 'is-primary' : ''} ${item.highlight ? 'is-highlight-water' : ''}`}
              data-dialog-autofocus={index === 0 ? '' : undefined}
              onClick={() => { onClose(); item.action() }}
            >
              <span>{item.icon}</span>
              <strong>{item.title}</strong>
              <small>{item.copy}</small>
            </button>
          ))}
        </div>
      </section>
    </div>
  )
}

export function NutritionWaterLogSheet({ current, goal, dateLabel, todayEntries = [], onClose, onLog, onRemoveEntry }: NutritionWaterLogSheetProps) {
  const [amount, setAmount] = useState(250)
  const dialogRef = useAccessibleDialog(onClose)
  const safeAmount = Number.isFinite(amount) ? Math.min(5000, Math.max(0, Math.round(amount))) : 0
  const percentage = Math.min(100, Math.round((current / (goal || 2000)) * 100))

  return (
    <div className="nutrition-sheet-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section ref={dialogRef} className="nutrition-water-sheet pink-orange-sheet" role="dialog" aria-modal="true" aria-labelledby="nutrition-water-sheet-title" aria-describedby="nutrition-water-sheet-description">
        <header>
          <div>
            <span className="nutrition-kicker pink-orange-badge"><Sparkles size={12} /> HYDRATION TRACKER</span>
            <h2 id="nutrition-water-sheet-title">Ghi lượng nước uống</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Đóng bảng ghi nước"><X size={20} /></button>
        </header>

        <div className="water-progress-card-po">
          <div className="water-progress-header-po">
            <div className="water-progress-info-po">
              <span className="water-droplet-emoji">💧</span>
              <div>
                <small>Đã uống trong {dateLabel.toLocaleLowerCase('vi-VN')}</small>
                <strong>{formatNumber(current)} <span className="goal-sub-po">/ {formatNumber(goal)} ml</span></strong>
              </div>
            </div>
            <div className="water-pct-pill-po">{percentage}%</div>
          </div>
          <div className="water-progress-track-po">
            <div className="water-progress-fill-po" style={{ width: `${percentage}%` }} />
          </div>
        </div>

        <label className="nutrition-water-sheet__input">
          <span>Lượng muốn thêm (ml)</span>
          <div className="water-input-stepper-po">
            <button type="button" className="water-step-btn-po" onClick={() => setAmount(Math.max(50, (amount || 250) - 50))}>-50</button>
            <input type="number" inputMode="numeric" min="1" max="5000" step="50" value={amount || ''} onChange={(event) => setAmount(Number(event.target.value))} aria-describedby="nutrition-water-limit" />
            <b>ml</b>
            <button type="button" className="water-step-btn-po" onClick={() => setAmount(Math.min(5000, (amount || 0) + 50))}>+50</button>
          </div>
          <small id="nutrition-water-limit">Tối đa 5.000 ml mỗi lần ghi.</small>
        </label>

        <div className="nutrition-water-presets pink-orange-presets" role="group" aria-label="Chọn nhanh lượng nước">
          {[
            { value: 250, label: '+250 ml', desc: '1 cốc nhỏ' },
            { value: 500, label: '+500 ml', desc: '1 chai tiêu chuẩn' },
            { value: 750, label: '+750 ml', desc: '1 bình thể thao' },
            { value: 1000, label: '+1.000 ml', desc: '1 lít nước' },
          ].map((preset) => (
            <button type="button" key={preset.value} className={amount === preset.value ? 'active' : ''} aria-pressed={amount === preset.value} onClick={() => setAmount(preset.value)}>
              <Droplets size={18} />
              <strong>{preset.label}</strong>
              <small>{preset.desc}</small>
            </button>
          ))}
        </div>

        <button type="button" className="nutrition-water-sheet__submit pink-orange-submit" disabled={safeAmount <= 0} onClick={() => onLog(safeAmount)}>
          <Plus size={18} /> Ghi +{formatNumber(safeAmount)} ml nước
        </button>

        {todayEntries.length > 0 && (
          <div className="water-today-entries-po">
            <span className="entries-title-po">Nhật ký nước hôm nay ({todayEntries.length} lần ghi)</span>
            <div className="entries-chips-po">
              {todayEntries.map((entry) => (
                <div key={entry.id} className="entry-chip-po">
                  <span>💧 +{formatNumber(entry.amountMl)} ml ({entry.time})</span>
                  {onRemoveEntry && (
                    <button type="button" onClick={() => onRemoveEntry(entry.id)} aria-label="Xóa lần ghi này" title="Xóa">
                      <X size={13} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </section>
    </div>
  )
}
