import { useMemo, useState } from 'react'
import { ChevronRight, Plus, Search, Star, UtensilsCrossed } from 'lucide-react'
import { MEAL_CATEGORY_LABELS, formatCurrency, readableError } from '../adminEatCleanUtils'
import type { EatCleanDeliverySlot, EatCleanMeal, EatCleanMealCategory } from '../types'
import { EatCleanSheet } from './EatCleanSheet'

interface EatCleanMenuTabProps {
  meals: EatCleanMeal[]
  deliverySlots: EatCleanDeliverySlot[]
  onSaveMeal: (meal: EatCleanMeal) => Promise<void>
}

type MealCategoryFilter = 'all' | EatCleanMealCategory

function createEmptyMeal(): EatCleanMeal {
  return {
    id: `meal_${Date.now().toString(36)}`,
    slug: '',
    name: '',
    shortDescription: '',
    description: '',
    category: 'lunch',
    basePrice: 0,
    compareAtPrice: null,
    imageUrl: '',
    calories: 0,
    protein: 0,
    carbs: 0,
    fat: 0,
    fiber: 0,
    servingGrams: 0,
    ingredients: [],
    dietaryTags: [],
    goalTags: [],
    allergens: [],
    allowedDeliverySlots: [],
    inventoryTracked: true,
    active: true,
    featured: false,
    sortOrder: 0,
    revision: 0,
  }
}

function commaList(value: string) {
  return [...new Set(value.split(',').map((item) => item.trim()).filter(Boolean))]
}

export function EatCleanMenuTab({ meals, deliverySlots, onSaveMeal }: EatCleanMenuTabProps) {
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<MealCategoryFilter>('all')
  const [editingMeal, setEditingMeal] = useState<EatCleanMeal | null>(null)
  const [ingredientsText, setIngredientsText] = useState('')
  const [dietaryTagsText, setDietaryTagsText] = useState('')
  const [goalTagsText, setGoalTagsText] = useState('')
  const [allergensText, setAllergensText] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const filteredMeals = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase('vi-VN')
    return meals.filter((meal) => {
      if (category !== 'all' && meal.category !== category) return false
      if (!normalizedQuery) return true
      return [meal.name, meal.shortDescription, meal.description, ...meal.dietaryTags, ...meal.goalTags]
        .some((value) => value.toLocaleLowerCase('vi-VN').includes(normalizedQuery))
    })
  }, [category, meals, query])

  const openMeal = (meal?: EatCleanMeal) => {
    const nextMeal = meal ? {
      ...meal,
      ingredients: [...meal.ingredients],
      dietaryTags: [...meal.dietaryTags],
      goalTags: [...meal.goalTags],
      allergens: [...meal.allergens],
      allowedDeliverySlots: [...meal.allowedDeliverySlots],
    } : { ...createEmptyMeal(), allowedDeliverySlots: deliverySlots.filter((slot) => slot.enabled).map((slot) => slot.id) }
    setEditingMeal(nextMeal)
    setIngredientsText(nextMeal.ingredients.join(', '))
    setDietaryTagsText(nextMeal.dietaryTags.join(', '))
    setGoalTagsText(nextMeal.goalTags.join(', '))
    setAllergensText(nextMeal.allergens.join(', '))
    setError('')
  }

  const closeMeal = () => {
    if (!saving) setEditingMeal(null)
  }

  const updateMeal = <K extends keyof EatCleanMeal>(key: K, value: EatCleanMeal[K]) => {
    setEditingMeal((current) => current ? { ...current, [key]: value } : current)
  }

  const toggleDeliverySlot = (slotId: string) => {
    if (!editingMeal) return
    const selected = new Set(editingMeal.allowedDeliverySlots)
    if (selected.has(slotId)) selected.delete(slotId)
    else selected.add(slotId)
    updateMeal('allowedDeliverySlots', [...selected])
  }

  const saveMeal = async () => {
    if (!editingMeal) return
    if (editingMeal.name.trim().length < 2) {
      setError('Tên món cần ít nhất 2 ký tự.')
      return
    }
    if (!Number.isInteger(editingMeal.basePrice) || editingMeal.basePrice < 0) {
      setError('Giá món phải là số nguyên không âm.')
      return
    }
    if ([editingMeal.calories, editingMeal.protein, editingMeal.carbs, editingMeal.fat].some((value) => !Number.isFinite(value) || value < 0)) {
      setError('Thông tin dinh dưỡng không hợp lệ.')
      return
    }

    setSaving(true)
    setError('')
    try {
      await onSaveMeal({
        ...editingMeal,
        name: editingMeal.name.trim(),
        shortDescription: editingMeal.shortDescription.trim(),
        description: editingMeal.description.trim(),
        imageUrl: editingMeal.imageUrl?.trim() || undefined,
        ingredients: commaList(ingredientsText),
        dietaryTags: commaList(dietaryTagsText),
        goalTags: commaList(goalTagsText),
        allergens: commaList(allergensText),
      })
      setEditingMeal(null)
    } catch (saveError) {
      setError(readableError(saveError, 'Không thể lưu món ăn.'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="eat-clean-panel" aria-labelledby="eat-clean-menu-title">
      <div className="eat-clean-panel__heading eat-clean-panel__heading--action">
        <div><span className="eat-clean-kicker">THỰC ĐƠN</span><h2 id="eat-clean-menu-title">Danh mục món Eat Clean</h2><p>Quản lý giá, macro, nhãn mục tiêu, khung giao và trạng thái hiển thị.</p></div>
        <button type="button" className="eat-clean-primary-button" onClick={() => openMeal()}><Plus size={18} /> Thêm món</button>
      </div>

      <div className="eat-clean-toolbar">
        <label className="eat-clean-search"><Search size={18} aria-hidden="true" /><span className="sr-only">Tìm món ăn</span><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tìm tên món, mô tả, tag..." /></label>
        <label className="eat-clean-filter-field"><span>Nhóm món</span><select value={category} onChange={(event) => setCategory(event.target.value as MealCategoryFilter)}><option value="all">Tất cả</option>{Object.entries(MEAL_CATEGORY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      </div>

      {filteredMeals.length === 0 ? (
        <div className="eat-clean-empty eat-clean-empty--compact"><UtensilsCrossed size={30} /><h3>{meals.length === 0 ? 'Thực đơn chưa có món' : 'Không tìm thấy món phù hợp'}</h3><p>{meals.length === 0 ? 'Khởi tạo catalog hoặc tạo món đầu tiên.' : 'Thử đổi từ khóa hoặc nhóm món.'}</p>{meals.length === 0 && <button type="button" className="eat-clean-primary-button" onClick={() => openMeal()}><Plus size={18} /> Thêm món đầu tiên</button>}</div>
      ) : (
        <>
          <div className="eat-clean-desktop-table" role="region" aria-label="Danh sách món Eat Clean" tabIndex={0}>
            <table><thead><tr><th>Món ăn</th><th>Nhóm</th><th>Dinh dưỡng</th><th>Giá bán</th><th>Hiển thị</th><th><span className="sr-only">Thao tác</span></th></tr></thead><tbody>
              {filteredMeals.map((meal) => <tr key={meal.id}>
                <td><strong>{meal.featured && <Star size={13} aria-label="Món nổi bật" />} {meal.name}</strong><small>{meal.shortDescription || 'Chưa có mô tả ngắn'}</small></td>
                <td><span>{MEAL_CATEGORY_LABELS[meal.category]}</span><small>{meal.inventoryTracked ? 'Theo dõi tồn kho' : 'Không theo dõi kho'}</small></td>
                <td><strong>{meal.calories} kcal</strong><small>{meal.protein}g protein · {meal.carbs}g carb</small></td>
                <td><strong>{formatCurrency(meal.basePrice)}</strong>{meal.compareAtPrice && <small>So sánh {formatCurrency(meal.compareAtPrice)}</small>}</td>
                <td><span className={`eat-clean-status ${meal.active ? 'eat-clean-status--active' : 'eat-clean-status--inactive'}`}>{meal.active ? 'Đang bán' : 'Đang ẩn'}</span></td>
                <td><button type="button" className="eat-clean-table-action" onClick={() => openMeal(meal)}>Chỉnh sửa <ChevronRight size={16} /></button></td>
              </tr>)}
            </tbody></table>
          </div>
          <div className="eat-clean-mobile-list">
            {filteredMeals.map((meal, index) => <article className="eat-clean-mobile-card eat-clean-meal-card" key={meal.id}>
              <div className="eat-clean-meal-card__image"><img src={meal.imageUrl || ['/images/eat-clean/chicken-pepper.webp', '/images/eat-clean/salmon-vegetables.webp', '/images/eat-clean/beef-egg-salad.webp'][index % 3]} alt="" /></div>
              <div className="eat-clean-meal-card__content"><header><div><strong>{meal.name}</strong><small>{MEAL_CATEGORY_LABELS[meal.category]}</small></div><span className={`eat-clean-status ${meal.active ? 'eat-clean-status--active' : 'eat-clean-status--inactive'}`}>{meal.active ? 'Đang bán' : 'Đang ẩn'}</span></header><p>{meal.calories} kcal · {meal.protein}g protein</p><div><strong>{formatCurrency(meal.basePrice)}</strong><button type="button" className="eat-clean-link-button" onClick={() => openMeal(meal)}>Chỉnh sửa <ChevronRight size={15} /></button></div></div>
            </article>)}
          </div>
        </>
      )}

      <EatCleanSheet open={Boolean(editingMeal)} title={editingMeal?.name ? `Chỉnh sửa ${editingMeal.name}` : 'Thêm món Eat Clean'} description="Dữ liệu lưu theo schema catalog canonical và hiển thị trực tiếp cho khách." onClose={closeMeal} footer={<><button type="button" className="eat-clean-secondary-button" onClick={closeMeal} disabled={saving}>Hủy</button><button type="button" className="eat-clean-primary-button" onClick={saveMeal} disabled={saving}>{saving ? 'Đang lưu…' : 'Lưu món'}</button></>}>
        {editingMeal && <div className="eat-clean-sheet-stack">
          <label className="eat-clean-field"><span>Tên món *</span><input value={editingMeal.name} onChange={(event) => updateMeal('name', event.target.value)} maxLength={120} autoComplete="off" /><small>{editingMeal.name.length}/120 ký tự</small></label>
          <div className="eat-clean-form-grid eat-clean-form-grid--2"><label className="eat-clean-field"><span>Nhóm món</span><select value={editingMeal.category} onChange={(event) => updateMeal('category', event.target.value as EatCleanMealCategory)}>{Object.entries(MEAL_CATEGORY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="eat-clean-field"><span>Giá bán (đ)</span><input type="number" min={0} step={1000} value={editingMeal.basePrice} onChange={(event) => updateMeal('basePrice', Number(event.target.value))} /></label></div>
          <label className="eat-clean-field"><span>Mô tả ngắn</span><input value={editingMeal.shortDescription} onChange={(event) => updateMeal('shortDescription', event.target.value)} maxLength={240} /></label>
          <label className="eat-clean-field"><span>Mô tả chi tiết</span><textarea rows={4} value={editingMeal.description} onChange={(event) => updateMeal('description', event.target.value)} maxLength={2000} /><small>{editingMeal.description.length}/2000 ký tự</small></label>
          <label className="eat-clean-field"><span>URL ảnh món</span><input type="url" value={editingMeal.imageUrl ?? ''} onChange={(event) => updateMeal('imageUrl', event.target.value)} placeholder="https://..." /></label>
          <fieldset className="eat-clean-fieldset"><legend>Dinh dưỡng mỗi khẩu phần</legend><div className="eat-clean-form-grid eat-clean-form-grid--3">
            <label className="eat-clean-field"><span>Kcal</span><input type="number" min={0} value={editingMeal.calories} onChange={(event) => updateMeal('calories', Number(event.target.value))} /></label><label className="eat-clean-field"><span>Protein (g)</span><input type="number" min={0} step="0.1" value={editingMeal.protein} onChange={(event) => updateMeal('protein', Number(event.target.value))} /></label><label className="eat-clean-field"><span>Carb (g)</span><input type="number" min={0} step="0.1" value={editingMeal.carbs} onChange={(event) => updateMeal('carbs', Number(event.target.value))} /></label><label className="eat-clean-field"><span>Fat (g)</span><input type="number" min={0} step="0.1" value={editingMeal.fat} onChange={(event) => updateMeal('fat', Number(event.target.value))} /></label><label className="eat-clean-field"><span>Chất xơ (g)</span><input type="number" min={0} step="0.1" value={editingMeal.fiber} onChange={(event) => updateMeal('fiber', Number(event.target.value))} /></label><label className="eat-clean-field"><span>Khẩu phần (g)</span><input type="number" min={0} step="0.1" value={editingMeal.servingGrams} onChange={(event) => updateMeal('servingGrams', Number(event.target.value))} /></label>
          </div></fieldset>
          <label className="eat-clean-field"><span>Nguyên liệu</span><input value={ingredientsText} onChange={(event) => setIngredientsText(event.target.value)} placeholder="Ức gà, gạo lứt, bông cải..." /><small>Phân tách bằng dấu phẩy.</small></label>
          <div className="eat-clean-form-grid eat-clean-form-grid--2"><label className="eat-clean-field"><span>Nhãn chế độ ăn</span><input value={dietaryTagsText} onChange={(event) => setDietaryTagsText(event.target.value)} placeholder="high-protein, low-carb" /></label><label className="eat-clean-field"><span>Nhãn mục tiêu</span><input value={goalTagsText} onChange={(event) => setGoalTagsText(event.target.value)} placeholder="lose-fat, gain-muscle" /></label></div>
          <label className="eat-clean-field"><span>Chất gây dị ứng</span><input value={allergensText} onChange={(event) => setAllergensText(event.target.value)} placeholder="dairy, gluten, shellfish" /></label>
          <fieldset className="eat-clean-fieldset"><legend>Khung giao áp dụng</legend><div className="eat-clean-checkbox-grid">{deliverySlots.map((slot) => <label key={slot.id}><input type="checkbox" checked={editingMeal.allowedDeliverySlots.includes(slot.id)} onChange={() => toggleDeliverySlot(slot.id)} /> <span>{slot.label} · {slot.start}–{slot.end}</span></label>)}</div>{deliverySlots.length === 0 && <p className="eat-clean-inline-empty">Chưa có khung giao trong cấu hình vận hành.</p>}</fieldset>
          <div className="eat-clean-switch-stack"><label className="eat-clean-switch-field"><span><strong>Hiển thị món</strong><small>Tắt để ẩn khỏi storefront.</small></span><input type="checkbox" checked={editingMeal.active} onChange={(event) => updateMeal('active', event.target.checked)} /></label><label className="eat-clean-switch-field"><span><strong>Món nổi bật</strong><small>Ưu tiên trong khu vực gợi ý.</small></span><input type="checkbox" checked={editingMeal.featured} onChange={(event) => updateMeal('featured', event.target.checked)} /></label><label className="eat-clean-switch-field"><span><strong>Theo dõi tồn kho</strong><small>Yêu cầu có sức chứa theo ngày khi đặt.</small></span><input type="checkbox" checked={editingMeal.inventoryTracked} onChange={(event) => updateMeal('inventoryTracked', event.target.checked)} /></label></div>
          {error && <div className="eat-clean-inline-error" role="alert">{error}</div>}
        </div>}
      </EatCleanSheet>
    </section>
  )
}
