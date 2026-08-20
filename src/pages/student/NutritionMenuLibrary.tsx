import { useMemo, useState } from 'react'
import {
  ArrowRight,
  Beef,
  ChevronRight,
  Clock3,
  Dumbbell,
  Flame,
  Leaf,
  Search,
  Sparkles,
  Target,
  Utensils,
  Wheat,
  X,
} from 'lucide-react'
import { mealTemplates } from '../../data/mealTemplates'
import { foodDb } from '../../data/foodDb'
import type { NutritionFoodCatalogItem } from '../../features/nutrition/types'
import type { MealTemplate } from '../../types'
import '../../styles-nutrition-menu.css'

type MenuGoal = 'all' | 'lose-fat' | 'gain-muscle' | 'maintain'
type MenuMeal = 'all' | 'breakfast' | 'lunch' | 'dinner' | 'snack'
type CalorieRange = 'all' | 'under-300' | '300-400' | '400-500' | 'over-500'

interface NutritionMenuLibraryProps {
  dailyCalorieGoal: number
  profileGoal: 'lose-fat' | 'gain-muscle' | 'maintain'
  onSelectMeal: (food: NutritionFoodCatalogItem) => void
  onOpenCatalog: () => void
}

const goalLabels: Record<Exclude<MenuGoal, 'all'>, string> = {
  'lose-fat': 'Giảm mỡ',
  'gain-muscle': 'Tăng cơ',
  maintain: 'Duy trì',
}

const mealLabels: Record<MenuMeal, string> = {
  all: 'Tất cả',
  breakfast: 'Bữa sáng',
  lunch: 'Bữa trưa',
  dinner: 'Bữa tối',
  snack: 'Bữa phụ',
}

function normalizeText(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('vi-VN')
}

function mealType(template: MealTemplate): Exclude<MenuMeal, 'all'> | 'main' {
  const name = normalizeText(template.name)
  if (name.includes('bua sang')) return 'breakfast'
  if (name.includes('bua phu')) return 'snack'
  return 'main'
}

function matchesMeal(template: MealTemplate, meal: MenuMeal) {
  if (meal === 'all') return true
  const type = mealType(template)
  if (meal === 'lunch' || meal === 'dinner') return type === 'main'
  return type === meal
}

function matchesCalories(kcal: number, range: CalorieRange) {
  if (range === 'all') return true
  if (range === 'under-300') return kcal < 300
  if (range === '300-400') return kcal >= 300 && kcal < 400
  if (range === '400-500') return kcal >= 400 && kcal < 500
  return kcal >= 500
}

function matchesGoal(template: MealTemplate, goal: MenuGoal) {
  if (goal === 'all') return true
  const { kcal, protein, fat } = template.base_macros
  if (goal === 'lose-fat') return kcal <= 420 && (protein >= 24 || fat <= 10)
  if (goal === 'gain-muscle') return protein >= 28 || (kcal >= 400 && protein >= 22)
  return kcal >= 260 && kcal <= 520
}

function templateIngredients(template: MealTemplate) {
  return template.items.map((item) => {
    const food = foodDb.find((candidate) => candidate.id === item.foodId)
    if (!food) return null
    const multiplier = typeof item.multiplier === 'number' ? item.multiplier : 1
    return `${multiplier !== 1 ? `${multiplier}× ` : ''}${food.name ?? 'Nguyên liệu'}`
  }).filter((item): item is string => Boolean(item))
}

function toCatalogMeal(template: MealTemplate): NutritionFoodCatalogItem {
  return {
    id: `aura-menu:${template.id}`,
    kind: 'dish',
    name: template.name.replace(/^Bữa (sáng|phụ):\s*/i, ''),
    servingGrams: null,
    servingLabel: '1 khẩu phần theo thực đơn',
    calories: template.base_macros.kcal,
    protein: template.base_macros.protein,
    carbs: template.base_macros.carb,
    fat: template.base_macros.fat,
    source: 'Aura Menu',
  }
}

function suggestedGoal(template: MealTemplate) {
  if (matchesGoal(template, 'gain-muscle')) return 'Tăng cơ'
  if (matchesGoal(template, 'lose-fat')) return 'Giảm mỡ'
  return 'Duy trì'
}

export default function NutritionMenuLibrary({
  dailyCalorieGoal,
  profileGoal,
  onSelectMeal,
  onOpenCatalog,
}: NutritionMenuLibraryProps) {
  const [query, setQuery] = useState('')
  const [meal, setMeal] = useState<MenuMeal>('all')
  const [goal, setGoal] = useState<MenuGoal>(profileGoal)
  const [calorieRange, setCalorieRange] = useState<CalorieRange>('all')
  const [visibleCount, setVisibleCount] = useState(18)
  const [selected, setSelected] = useState<MealTemplate | null>(null)

  const filtered = useMemo(() => {
    const normalizedQuery = normalizeText(query.trim())
    return mealTemplates.filter((template) => {
      const ingredients = templateIngredients(template)
      const searchValue = normalizeText([template.name, ...ingredients].join(' '))
      return (!normalizedQuery || searchValue.includes(normalizedQuery))
        && matchesMeal(template, meal)
        && matchesGoal(template, goal)
        && matchesCalories(template.base_macros.kcal, calorieRange)
    })
  }, [calorieRange, goal, meal, query])

  const suggestedMealCalories = Math.round(dailyCalorieGoal / 3)
  const resetFilters = () => {
    setQuery('')
    setMeal('all')
    setGoal('all')
    setCalorieRange('all')
    setVisibleCount(18)
  }

  return (
    <section className="nutrition-menu" aria-label="Thực đơn theo kcal và mục tiêu">
      <header className="nutrition-menu__hero">
        <div>
          <span className="nutrition-menu__eyebrow"><Sparkles size={14} /> THỰC ĐƠN AURA</span>
          <h1>Chọn món đúng mục tiêu</h1>
          <p>Lọc nhanh theo bữa ăn, kcal và mục tiêu vóc dáng. Khẩu phần gợi ý có thể chỉnh trước khi ghi vào nhật ký.</p>
        </div>
        <div className="nutrition-menu__target">
          <Target size={20} />
          <span>Mục tiêu ngày<strong>{dailyCalorieGoal.toLocaleString('vi-VN')} kcal</strong></span>
          <small>≈ {suggestedMealCalories.toLocaleString('vi-VN')} kcal / bữa chính</small>
        </div>
      </header>

      <div className="nutrition-menu__search-row">
        <label className="nutrition-menu__search">
          <Search size={19} />
          <input value={query} onChange={(event) => { setQuery(event.target.value); setVisibleCount(18) }} placeholder="Tìm món hoặc nguyên liệu…" />
          {query && <button type="button" onClick={() => setQuery('')} aria-label="Xóa tìm kiếm"><X size={16} /></button>}
        </label>
        <button type="button" className="nutrition-menu__catalog-link" onClick={onOpenCatalog}>2.000+ món & nguyên liệu <ArrowRight size={16} /></button>
      </div>

      <div className="nutrition-menu__filter-section">
        <div className="nutrition-menu__filter-heading"><Utensils size={17} /><strong>Chọn bữa ăn</strong></div>
        <div className="nutrition-menu__chips" role="group" aria-label="Chọn bữa ăn">
          {(Object.keys(mealLabels) as MenuMeal[]).map((item) => (
            <button type="button" key={item} className={meal === item ? 'is-active' : ''} onClick={() => { setMeal(item); setVisibleCount(18) }}>{mealLabels[item]}</button>
          ))}
        </div>
      </div>

      <div className="nutrition-menu__filter-grid">
        <div className="nutrition-menu__filter-card">
          <div className="nutrition-menu__filter-heading"><Target size={17} /><strong>Theo mục tiêu</strong></div>
          <div className="nutrition-menu__goal-grid">
            {([
              ['lose-fat', 'Giảm mỡ', <Flame size={19} key="flame" />],
              ['gain-muscle', 'Tăng cơ', <Dumbbell size={19} key="muscle" />],
              ['maintain', 'Duy trì', <Leaf size={19} key="leaf" />],
            ] as const).map(([id, label, icon]) => (
              <button type="button" key={id} className={goal === id ? 'is-active' : ''} onClick={() => { setGoal(goal === id ? 'all' : id); setVisibleCount(18) }}>{icon}<span>{label}</span></button>
            ))}
          </div>
        </div>
        <div className="nutrition-menu__filter-card">
          <div className="nutrition-menu__filter-heading"><Flame size={17} /><strong>Theo mức năng lượng</strong></div>
          <div className="nutrition-menu__calorie-grid">
            {([
              ['all', 'Tất cả'],
              ['under-300', '< 300'],
              ['300-400', '300–400'],
              ['400-500', '400–500'],
              ['over-500', '> 500'],
            ] as const).map(([id, label]) => (
              <button type="button" key={id} className={calorieRange === id ? 'is-active' : ''} onClick={() => { setCalorieRange(id); setVisibleCount(18) }}>{label}<small>{id === 'all' ? 'kcal' : 'kcal'}</small></button>
            ))}
          </div>
        </div>
      </div>

      <div className="nutrition-menu__results-heading">
        <div><span><Wheat size={17} /></span><div><h2>Gợi ý dành cho bạn</h2><p>{filtered.length} món phù hợp với bộ lọc hiện tại</p></div></div>
        {(query || meal !== 'all' || goal !== 'all' || calorieRange !== 'all') && <button type="button" onClick={resetFilters}>Xóa bộ lọc</button>}
      </div>

      {filtered.length ? (
        <div className="nutrition-menu__grid">
          {filtered.slice(0, visibleCount).map((template) => {
            const ingredients = templateIngredients(template)
            const proteinDensity = Math.round((template.base_macros.protein * 4 / Math.max(template.base_macros.kcal, 1)) * 100)
            return (
              <article className="nutrition-menu-card" key={template.id}>
                <button type="button" className="nutrition-menu-card__open" onClick={() => setSelected(template)} aria-label={`Xem ${template.name}`}>
                  <span className="nutrition-menu-card__visual"><Utensils size={27} /><small>{suggestedGoal(template)}</small></span>
                  <span className="nutrition-menu-card__body">
                    <span className="nutrition-menu-card__badge">{mealLabels[mealType(template) === 'main' ? 'lunch' : mealType(template) as MenuMeal]}</span>
                    <strong>{template.name.replace(/^Bữa (sáng|phụ):\s*/i, '')}</strong>
                    <small>{ingredients.slice(0, 3).join(' · ') || 'Công thức cân bằng macro'}</small>
                  </span>
                </button>
                <div className="nutrition-menu-card__macros">
                  <span><Flame size={15} /><strong>{template.base_macros.kcal}</strong> kcal</span>
                  <span><Beef size={15} /><strong>{Math.round(template.base_macros.protein)}g</strong> đạm</span>
                  <span><strong>{proteinDensity}%</strong> năng lượng từ đạm</span>
                </div>
                <div className="nutrition-menu-card__actions">
                  <button type="button" onClick={() => setSelected(template)}>Chi tiết <ChevronRight size={15} /></button>
                  <button type="button" onClick={() => onSelectMeal(toCatalogMeal(template))}>Chọn món</button>
                </div>
              </article>
            )
          })}
        </div>
      ) : (
        <div className="nutrition-menu__empty"><Search size={24} /><strong>Chưa tìm thấy món phù hợp</strong><p>Thử bỏ bớt một bộ lọc hoặc tìm bằng tên nguyên liệu ngắn hơn.</p><button type="button" onClick={resetFilters}>Xem tất cả món</button></div>
      )}

      {visibleCount < filtered.length && <button type="button" className="nutrition-menu__load-more" onClick={() => setVisibleCount((current) => current + 18)}>Hiển thị thêm {Math.min(18, filtered.length - visibleCount)} món <ChevronRight size={16} /></button>}

      <p className="nutrition-menu__disclaimer"><Sparkles size={14} /> Phân loại mục tiêu dựa trên kcal và tỷ lệ macro. Hãy điều chỉnh khẩu phần theo mục tiêu cá nhân và hướng dẫn của Coach/PT.</p>

      {selected && (
        <div className="nutrition-menu-detail" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setSelected(null)}>
          <section role="dialog" aria-modal="true" aria-labelledby="nutrition-menu-detail-title">
            <header><span><Utensils size={22} /></span><button type="button" onClick={() => setSelected(null)} aria-label="Đóng"><X size={19} /></button></header>
            <div className="nutrition-menu-detail__content">
              <span className="nutrition-menu__eyebrow"><Sparkles size={14} /> {suggestedGoal(selected)}</span>
              <h2 id="nutrition-menu-detail-title">{selected.name.replace(/^Bữa (sáng|phụ):\s*/i, '')}</h2>
              <div className="nutrition-menu-detail__metrics">
                <div><Flame size={18} /><span><strong>{selected.base_macros.kcal}</strong> kcal</span></div>
                <div><Dumbbell size={18} /><span><strong>{Math.round(selected.base_macros.protein)}g</strong> đạm</span></div>
                <div><Wheat size={18} /><span><strong>{Math.round(selected.base_macros.carb)}g</strong> carb</span></div>
                <div><Leaf size={18} /><span><strong>{Math.round(selected.base_macros.fat)}g</strong> béo</span></div>
              </div>
              <h3>Thành phần gợi ý</h3>
              <ul>{templateIngredients(selected).map((ingredient) => <li key={ingredient}><span />{ingredient}</li>)}</ul>
              <div className="nutrition-menu-detail__note"><Clock3 size={17} /><p>Khẩu phần có thể thay đổi trong bước tiếp theo trước khi ghi vào nhật ký.</p></div>
              <button type="button" className="nutrition-menu-detail__primary" onClick={() => { onSelectMeal(toCatalogMeal(selected)); setSelected(null) }}>Chọn món này <ArrowRight size={17} /></button>
            </div>
          </section>
        </div>
      )}
    </section>
  )
}
