import React, { useState } from 'react'
import { Check, Info, Scale, X } from 'lucide-react'
import NutritionGroupIcon from '../../components/NutritionGroupIcon'
import { useAccessibleDialog } from '../../features/nutrition/useAccessibleDialog'
import type { MealLog, NutritionFoodCatalogItem, NutritionMealDraft } from '../../features/nutrition/types'

export interface MealEditorContext {
  date: string
  mealType: NutritionMealDraft['mealType']
  time: string
}

export interface MealLogEditDraft {
  date: string
  time: string
  mealType: NutritionMealDraft['mealType']
  portionMultiplier: number
}

function formatNumber(value: number) {
  return new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 }).format(value)
}

function canLogCatalogFood(food: NutritionFoodCatalogItem): food is NutritionFoodCatalogItem & {
  calories: number
  protein: number
  carbs: number
  fat: number
} {
  return food.calories !== null && food.protein !== null && food.carbs !== null && food.fat !== null
}

interface MealEditorSheetProps {
  food: NutritionFoodCatalogItem
  initialDate: string
  initialMealType?: NutritionMealDraft['mealType']
  initialTime?: string
  mode?: 'diary' | 'plan'
  lockDate?: boolean
  isSaving?: boolean
  onClose: () => void
  onConfirm: (food: NutritionFoodCatalogItem, context: MealEditorContext) => void
}

export const MealEditorSheet = React.memo(function MealEditorSheet({ food, initialDate, initialMealType = 'lunch', initialTime, mode = 'diary', lockDate = false, isSaving = false, onClose, onConfirm }: MealEditorSheetProps) {
  const [date, setDate] = useState(initialDate)
  const [mealType, setMealType] = useState<NutritionMealDraft['mealType']>(initialMealType)
  const [time, setTime] = useState(() => initialTime || new Date().toTimeString().slice(0, 5))
  const dialogRef = useAccessibleDialog(onClose)
  const hasCompleteCoreNutrition = canLogCatalogFood(food)
  const isPlan = mode === 'plan'

  return <div className="nutrition-sheet-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <section ref={dialogRef} className="nutrition-meal-editor" role="dialog" aria-modal="true" aria-labelledby="nutrition-meal-editor-title">
      <header><div><span className="nutrition-kicker">{isPlan ? 'THÊM VÀO KẾ HOẠCH' : 'THÊM VÀO NHẬT KÝ'}</span><h2 id="nutrition-meal-editor-title">{isPlan ? 'Sắp bữa trong tuần' : 'Kiểm tra bữa ăn'}</h2></div><button type="button" onClick={onClose} aria-label="Đóng" disabled={isSaving}><X size={20} /></button></header>
      <div className="nutrition-meal-editor__food">
        <span><NutritionGroupIcon categoryName={food.category?.nameVi} kind={food.kind ?? 'food'} size={24} /></span>
        <div><strong>{food.name}</strong><p>{food.servingLabel ?? (food.servingGrams !== null ? `${formatNumber(food.servingGrams)} g` : 'Khẩu phần theo nguồn')} · {food.calories === null ? 'Chưa có kcal' : `${formatNumber(food.calories)} kcal`}</p></div>
      </div>
      <div className="nutrition-meal-editor__grid">
        <label><span>Ngày</span><input data-dialog-autofocus type="date" value={date} onChange={(event) => setDate(event.target.value)} disabled={lockDate || isSaving} /></label>
        <label><span>Thời gian</span><input type="time" value={time} onChange={(event) => setTime(event.target.value)} disabled={isSaving} /></label>
        <label><span>Loại bữa</span><select value={mealType} onChange={(event) => setMealType(event.target.value as NutritionMealDraft['mealType'])} disabled={isSaving}><option value="breakfast">Bữa sáng</option><option value="lunch">Bữa trưa</option><option value="dinner">Bữa tối</option><option value="snack">Bữa phụ</option></select></label>
        <div><span>Nguồn dữ liệu</span><strong>{food.source ?? 'Viện Dinh dưỡng Quốc gia'}</strong><small>Giá trị được lưu thành snapshot tại thời điểm ghi.</small></div>
      </div>
      <p className="nutrition-meal-editor__notice"><Info size={14} /> {hasCompleteCoreNutrition ? (isPlan ? 'Món được lưu vào tuần này với kcal và macro tại thời điểm chọn.' : 'Dữ liệu được lưu thành snapshot; vi chất còn thiếu vẫn giữ là “—”.') : `Bản ghi nguồn còn thiếu kcal hoặc macro nên chưa thể thêm vào ${isPlan ? 'kế hoạch' : 'nhật ký'}.`}</p>
      <button type="button" className="nutrition-primary-button" disabled={!date || !time || !hasCompleteCoreNutrition || isSaving} onClick={() => onConfirm(food, { date, mealType, time })}><Check size={17} /> {isSaving ? 'Đang lưu…' : isPlan ? 'Xác nhận món' : 'Thêm vào nhật ký'}</button>
    </section>
  </div>
})

export const MealLogEditorSheet = React.memo(function MealLogEditorSheet({ meal, onClose, onConfirm }: { meal: MealLog; onClose: () => void; onConfirm: (draft: MealLogEditDraft) => void }) {
  const [date, setDate] = useState(meal.date)
  const [time, setTime] = useState(meal.time)
  const [mealType, setMealType] = useState(meal.type)
  const [portionMultiplier, setPortionMultiplier] = useState(1)
  const dialogRef = useAccessibleDialog(onClose)
  const safeMultiplier = Math.min(10, Math.max(.1, Number.isFinite(portionMultiplier) ? portionMultiplier : 1))

  return <div className="nutrition-sheet-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <section ref={dialogRef} className="nutrition-meal-editor" role="dialog" aria-modal="true" aria-labelledby="nutrition-meal-log-editor-title">
      <header><div><span className="nutrition-kicker">CHỈNH NHẬT KÝ</span><h2 id="nutrition-meal-log-editor-title">{meal.title}</h2></div><button type="button" onClick={onClose} aria-label="Đóng"><X size={20} /></button></header>
      <div className="nutrition-meal-editor__food">
        <span><Scale size={24} /></span>
        <div><strong>{formatNumber(meal.calories * safeMultiplier)} kcal</strong><p>{formatNumber(meal.protein * safeMultiplier)}g đạm · {formatNumber(meal.carbs * safeMultiplier)}g carb · {formatNumber(meal.fat * safeMultiplier)}g béo</p></div>
      </div>
      <div className="nutrition-meal-editor__grid">
        <label><span>Ngày</span><input data-dialog-autofocus type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>
        <label><span>Thời gian</span><input type="time" value={time} onChange={(event) => setTime(event.target.value)} /></label>
        <label><span>Loại bữa</span><select value={mealType} onChange={(event) => setMealType(event.target.value as NutritionMealDraft['mealType'])}><option value="breakfast">Bữa sáng</option><option value="lunch">Bữa trưa</option><option value="dinner">Bữa tối</option><option value="snack">Bữa phụ</option></select></label>
        <label><span>Hệ số khẩu phần</span><input type="number" min="0.1" max="10" step="0.1" value={portionMultiplier} onChange={(event) => setPortionMultiplier(Number(event.target.value))} /></label>
      </div>
      <p className="nutrition-meal-editor__notice"><Info size={14} /> Khẩu phần thay đổi sẽ scale kcal, macro, vi chất và từng thành phần theo cùng tỷ lệ.</p>
      <button type="button" className="nutrition-primary-button" disabled={!date || !time || portionMultiplier < .1 || portionMultiplier > 10} onClick={() => onConfirm({ date, time, mealType, portionMultiplier: safeMultiplier })}><Check size={17} /> Lưu thay đổi</button>
    </section>
  </div>
})
