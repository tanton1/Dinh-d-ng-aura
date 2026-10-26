import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  Bookmark,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Clock3,
  Leaf,
  Heart,
  LoaderCircle,
  Plus,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Sparkles,
  Target,
  Trash2,
  Utensils,
  X,
} from 'lucide-react'
import { useMealPlanCatalog, type MealPlanTab } from '../../features/nutrition/useMealPlanCatalog'
import type { NutritionFoodCatalogItem } from '../../features/nutrition/types'
import type { NutritionPlanDay, NutritionPlannedMeal } from './NutritionWorkspace'
import '../../styles-meal-plan.css'

type CalorieFilter = 'all' | 'under-300' | '300-500' | 'over-500'
type ProteinFilter = 'all' | 'high-protein'
type GoalFilter = 'all' | 'lose-fat' | 'gain-muscle' | 'maintain'
type MealTypeFilter = 'all' | 'breakfast' | 'lunch' | 'snack' | 'dinner'



export interface ConnectedMealPlanPageProps {
  activeTab?: MealPlanTab
  catalogActive?: boolean
  onTabChange?: (tab: MealPlanTab) => void
  initialSavedOnly?: boolean
  days: NutritionPlanDay[]
  selectedDayId: string
  meals: NutritionPlannedMeal[]
  dailyCalorieGoal: number
  status?: 'draft' | 'active'
  sourceTitle?: string
  weekLabel: string
  errorMessage?: string
  isLoading?: boolean
  isGenerating?: boolean
  isSaving?: boolean
  canEdit?: boolean
  strategyTitle: string
  strategyDescription: string
  constraints: string[]
  initialCatalog?: NutritionFoodCatalogItem[]
  savedFoodIds: Set<string>
  allowDemo?: boolean
  loggedMealKeys?: Set<string>
  onSelectDay: (dayId: string) => void
  onGeneratePlan: () => void
  onAddMeal: (dayId: string) => void
  onReplaceMeal: (mealId: string) => void
  onRemoveMeal: (mealId: string) => void
  onOpenMeal?: (mealId: string) => void
  onConfirmPlan: () => void
  onReload: () => void
  onShiftWeek: (direction: -1 | 1) => void
  onOpenCatalogFood: (food: NutritionFoodCatalogItem, items: NutritionFoodCatalogItem[]) => void
  onLogCatalogFood: (food: NutritionFoodCatalogItem) => void | Promise<void>
  onLogPlannedMeal: (meal: NutritionPlannedMeal) => void | Promise<void>
  onToggleSaved: (food: NutritionFoodCatalogItem, saved: boolean) => void
}

function formatNumber(value: number | null | undefined, digits = 0) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—'
  return new Intl.NumberFormat('vi-VN', { maximumFractionDigits: digits }).format(value)
}

function calorieMatches(value: number | null, filter: CalorieFilter) {
  if (filter === 'all') return true
  if (value === null) return false
  if (filter === 'under-300') return value < 300
  if (filter === '300-500') return value >= 300 && value <= 500
  return value > 500
}

function foldMealText(value: unknown) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLocaleLowerCase('vi-VN')
}

function itemMatchesGoal(item: NutritionFoodCatalogItem, goal: GoalFilter) {
  if (goal === 'all') return true
  const calories = Number(item.calories)
  const protein = Number(item.protein)
  if (!Number.isFinite(calories) || !Number.isFinite(protein)) return false
  if (goal === 'gain-muscle') return protein >= 20 || (calories > 0 && protein / calories >= 0.055)
  if (goal === 'lose-fat') return calories <= 500 && protein >= 12 && (item.fat == null || item.fat <= 24)
  return calories >= 250 && calories <= 650 && protein >= 10
}

function itemMatchesMealType(item: NutritionFoodCatalogItem, type: MealTypeFilter): boolean {
  if (type === 'all') return true
  const text = foldMealText(`${item.name} ${item.category?.nameVi || ''}`)
  if (type === 'breakfast') return /\b(sang|sua|trung|yen mach|chao|banh mi|xoi|ngu coc|pho|bun)\b/.test(text)
  if (type === 'snack') return /\b(phu|trai cay|sua chua|hat|sinh to|salad|nuoc ep|chuoi|tao|bo|che)\b/.test(text) || Number(item.calories) <= 280
  if (type === 'dinner') return /\b(t?oi|salad|ca|ga|tom|rau|sup)\b/.test(text) && Number(item.calories) <= 700
  return !itemMatchesMealType(item, 'breakfast') && !itemMatchesMealType(item, 'snack')
}

function planMealKey(meal: NutritionPlannedMeal) {
  return `${meal.dayId}|${meal.id}`
}

export default function ConnectedMealPlanPage(props: ConnectedMealPlanPageProps) {
  const [localTab, setLocalTab] = useState<MealPlanTab>('recipes')
  const activeTab = props.activeTab ?? localTab
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('all')
  const [calorieFilter, setCalorieFilter] = useState<CalorieFilter>('all')
  const [proteinFilter, setProteinFilter] = useState<ProteinFilter>('all')
  const [goalFilter, setGoalFilter] = useState<GoalFilter>('all')
  const [mealTypeFilter, setMealTypeFilter] = useState<MealTypeFilter>('all')
  const [mobileColumns, setMobileColumns] = useState<1 | 2>(2)
  const [savedOnly, setSavedOnly] = useState(props.initialSavedOnly ?? false)
  useEffect(() => setSavedOnly(props.initialSavedOnly ?? false), [props.initialSavedOnly])
  const [filterOpen, setFilterOpen] = useState(false)
  const catalog = useMealPlanCatalog({ tab: activeTab, active: props.catalogActive, query, category, savedOnly, savedFoodIds: props.savedFoodIds, initialCatalog: props.initialCatalog, allowDemo: props.allowDemo })
  const { items, categories, status: catalogState, filteredCount: totalCount, hasMore, loadingMore, loadMore, reload: reloadCatalog } = catalog
  const [loggingId, setLoggingId] = useState<string | null>(null)
  const logging = useRef(false)
  const logFood = async (food: NutritionFoodCatalogItem) => {
    if (logging.current) return
    logging.current = true
    setLoggingId(food.id)
    try { await props.onLogCatalogFood(food) } finally { logging.current = false; setLoggingId(null) }
  }
  const selectTab = (tab: MealPlanTab) => {
    setCategory('all')
    setGoalFilter('all')
    setMealTypeFilter('all')
    setLocalTab(tab)
    props.onTabChange?.(tab)
  }

  const visibleItems = useMemo(() => items.filter((item) => {
    if (savedOnly && !props.savedFoodIds.has(item.id)) return false
    if (!calorieMatches(item.calories, calorieFilter)) return false
    if (proteinFilter === 'high-protein' && (item.protein ?? 0) < 20) return false
    if (!itemMatchesGoal(item, goalFilter)) return false
    if (!itemMatchesMealType(item, mealTypeFilter)) return false
    return true
  }), [calorieFilter, goalFilter, items, mealTypeFilter, proteinFilter, props.savedFoodIds, savedOnly])

  const selectedDay = props.days.find((day) => day.id === props.selectedDayId) ?? props.days[0]
  const selectedDayMeals = useMemo(() => props.meals
    .filter((meal) => meal.dayId === selectedDay?.id)
    .sort((left, right) => left.time.localeCompare(right.time)), [props.meals, selectedDay?.id])
  const totals = useMemo(() => selectedDayMeals.reduce((sum, meal) => ({
    calories: sum.calories + (Number(meal.calories) || 0),
    protein: sum.protein + (Number(meal.protein) || 0),
    carbs: sum.carbs + (Number(meal.carbs) || 0),
    fat: sum.fat + (Number(meal.fat) || 0),
  }), { calories: 0, protein: 0, carbs: 0, fat: 0 }), [selectedDayMeals])
  const filterCount = (category !== 'all' ? 1 : 0) + (calorieFilter !== 'all' ? 1 : 0) + (proteinFilter !== 'all' ? 1 : 0) + (goalFilter !== 'all' ? 1 : 0) + (mealTypeFilter !== 'all' ? 1 : 0) + (savedOnly ? 1 : 0)


  return (
    <div className="meal-plan-page-container meal-plan-page-container--connected">
      <div className="meal-plan-shell meal-plan-shell--connected">
        <header className="meal-plan-header meal-plan-header--connected">
          <div className="meal-plan-header__top">
            <div>
              <h1 className="meal-plan-header__title">Thực đơn</h1>
              <p className="meal-plan-header__subtitle">Chọn món dễ dàng. Ăn uống theo mục tiêu.</p>
            </div>
            <div className="meal-plan-header__actions">
              <button type="button" className={`meal-plan-icon-btn ${savedOnly ? 'is-active' : ''}`} onClick={() => { if (activeTab === 'plan') selectTab('recipes'); setSavedOnly((current) => !current) }} aria-label={savedOnly ? 'Hiện tất cả món' : 'Xem món đã lưu'} aria-pressed={savedOnly}>
                <Bookmark size={20} />
                {props.savedFoodIds.size > 0 && <span className="meal-plan-badge-count">{props.savedFoodIds.size}</span>}
              </button>

            </div>
          </div>

          <div className="meal-plan-tabs" role="tablist" aria-label="Nội dung thực đơn">
            {([['recipes', 'Món ăn'], ['ingredients', 'Nguyên liệu'], ['plan', 'Kế hoạch 7 ngày']] as const).map(([tab, label]) => (
              <button key={tab} id={`menu-tab-${tab}`} type="button" role="tab" aria-selected={activeTab === tab} aria-controls="menu-tab-panel" onClick={() => selectTab(tab)} className={`meal-plan-tab-btn ${activeTab === tab ? 'meal-plan-tab-btn--active' : ''}`}>
                {label}{activeTab === tab && <span className="meal-plan-tab-indicator" />}
              </button>
            ))}
          </div>
        </header>

        {activeTab !== 'plan' ? (
          <main id="menu-tab-panel" className="meal-plan-main meal-plan-live-catalog" role="tabpanel" aria-labelledby={`menu-tab-${activeTab}`}>
            <div className="meal-plan-search-row">
              <div className="meal-plan-search-input-wrapper">
                <Search size={20} aria-hidden="true" />
                <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={activeTab === 'ingredients' ? 'Tìm nguyên liệu, nhóm thực phẩm…' : 'Tìm món ăn, nhóm món…'} className="meal-plan-search-input" aria-label={activeTab === 'ingredients' ? 'Tìm nguyên liệu' : 'Tìm món ăn'} type="search" />
                {query && <button type="button" onClick={() => setQuery('')} aria-label="Xóa từ khóa"><X size={16} /></button>}
              </div>
              <button type="button" onClick={() => setFilterOpen((current) => !current)} aria-label="Bộ lọc" className={`meal-plan-filter-trigger ${filterCount ? 'meal-plan-filter-trigger--active' : ''}`} aria-expanded={filterOpen} aria-controls="meal-plan-filter-panel">
                <SlidersHorizontal size={18} /><span>Bộ lọc{filterCount ? ` (${filterCount})` : ''}</span>
              </button>
            </div>

            {filterOpen && (
              <section id="meal-plan-filter-panel" className="meal-plan-filter-panel" aria-label="Bộ lọc thực đơn">
                <div>
                  <span>Mục tiêu</span>
                  <select value={goalFilter} onChange={(event) => setGoalFilter(event.target.value as GoalFilter)} aria-label="Mục tiêu dinh dưỡng">
                    <option value="all">Tất cả mục tiêu</option>
                    <option value="lose-fat">Giảm mỡ</option>
                    <option value="gain-muscle">Tăng cơ</option>
                    <option value="maintain">Duy trì</option>
                  </select>
                </div>
                <div>
                  <span>Loại bữa</span>
                  <select value={mealTypeFilter} onChange={(event) => setMealTypeFilter(event.target.value as MealTypeFilter)} aria-label="Loại bữa ăn">
                    <option value="all">Tất cả bữa</option>
                    <option value="breakfast">Bữa sáng</option>
                    <option value="lunch">Bữa chính</option>
                    <option value="snack">Bữa phụ</option>
                    <option value="dinner">Bữa tối</option>
                  </select>
                </div>
                <div>
                  <span>Nhóm món</span>
                  <select value={category} onChange={(event) => setCategory(event.target.value)} aria-label="Nhóm món">
                    <option value="all">Tất cả nhóm món</option>
                    {categories.map((value) => <option key={value} value={value}>{value}</option>)}
                  </select>
                </div>
                <div>
                  <span>Kcal mong muốn</span>
                  <select value={calorieFilter} onChange={(event) => setCalorieFilter(event.target.value as CalorieFilter)} aria-label="Mức năng lượng">
                    <option value="all">Mọi mức kcal</option>
                    <option value="under-300">Dưới 300 kcal</option>
                    <option value="300-500">300–500 kcal</option>
                    <option value="over-500">Trên 500 kcal</option>
                  </select>
                </div>
                <button type="button" className={proteinFilter === 'high-protein' ? 'is-active' : ''} onClick={() => setProteinFilter((current) => current === 'all' ? 'high-protein' : 'all')} aria-pressed={proteinFilter === 'high-protein'}>Giàu đạm ≥ 20g</button>
                <button type="button" className={savedOnly ? 'is-active' : ''} onClick={() => setSavedOnly((current) => !current)} aria-pressed={savedOnly}><Heart size={15} /> Món đã lưu</button>
                {filterCount > 0 && <button type="button" className="meal-plan-filter-panel__clear" onClick={() => { setCategory('all'); setCalorieFilter('all'); setProteinFilter('all'); setGoalFilter('all'); setMealTypeFilter('all'); setSavedOnly(false) }}>Xóa lọc</button>}
              </section>
            )}

            <div className="meal-plan-quick-filters" role="group" aria-label="Lọc nhanh thực đơn">
              <span>Lọc nhanh</span>
              <button type="button" className={goalFilter === 'lose-fat' ? 'is-active' : ''} onClick={() => setGoalFilter((current) => current === 'lose-fat' ? 'all' : 'lose-fat')} aria-pressed={goalFilter === 'lose-fat'}>Giảm mỡ</button>
              <button type="button" className={goalFilter === 'gain-muscle' ? 'is-active' : ''} onClick={() => setGoalFilter((current) => current === 'gain-muscle' ? 'all' : 'gain-muscle')} aria-pressed={goalFilter === 'gain-muscle'}>Tăng cơ</button>
              <button type="button" className={mealTypeFilter === 'breakfast' ? 'is-active' : ''} onClick={() => setMealTypeFilter((current) => current === 'breakfast' ? 'all' : 'breakfast')} aria-pressed={mealTypeFilter === 'breakfast'}>Bữa sáng</button>
              <button type="button" className={calorieFilter === 'under-300' ? 'is-active' : ''} onClick={() => setCalorieFilter((current) => current === 'under-300' ? 'all' : 'under-300')} aria-pressed={calorieFilter === 'under-300'}>&lt; 300 kcal</button>
            </div>

            <section className="meal-plan-live-section" aria-labelledby="meal-plan-catalog-title">
              <div className="meal-plan-live-heading">
              <div><div><h2 id="meal-plan-catalog-title">{savedOnly ? 'Đã lưu' : activeTab === 'ingredients' ? 'Nguyên liệu' : 'Món ăn'}</h2><p>{catalogState === 'loading' ? 'Đang tải…' : `${formatNumber(visibleItems.length)} ${activeTab === 'ingredients' ? 'nguyên liệu' : 'món'}${hasMore ? ` đã hiển thị${savedOnly ? '' : ` / ${formatNumber(totalCount)}`}` : ''}`}</p></div></div>
              <div className="meal-plan-display-toggle" role="group" aria-label="Mật độ hiển thị trên điện thoại">
                <button type="button" className={mobileColumns === 1 ? 'is-active' : ''} onClick={() => setMobileColumns(1)} aria-pressed={mobileColumns === 1}>1 cột</button>
                <button type="button" className={mobileColumns === 2 ? 'is-active' : ''} onClick={() => setMobileColumns(2)} aria-pressed={mobileColumns === 2}>2 cột</button>
              </div>
                {catalogState === 'error' && <button type="button" onClick={reloadCatalog}><RefreshCw size={15} /> Tải lại</button>}
              </div>

              {catalogState === 'error' && <p className="meal-plan-catalog-error" role="alert">Chưa tải được danh sách. Bấm Tải lại để thử lại.</p>}
              {catalogState === 'loading' ? (
                <div className="meal-plan-live-loading" role="status"><LoaderCircle className="is-spinning" size={22} /> Đang tải thực đơn…</div>
              ) : visibleItems.length ? (
                <div className={`meal-plan-live-grid meal-plan-live-grid--mobile-${mobileColumns}`}>
                  {visibleItems.map((food) => {
                    const saved = props.savedFoodIds.has(food.id)
                    return (
                      <article className="meal-plan-live-card" key={food.id}>
                        <div className="meal-plan-live-card__media"><button type="button" className="meal-plan-live-card__visual" onClick={() => props.onOpenCatalogFood(food, items)} aria-label={`Xem chi tiết ${food.name}`}>
                          {food.imageUrl ? <img src={food.imageUrl} alt="" loading="lazy" decoding="async" width="480" height="360" /> : <span>{activeTab === 'ingredients' ? <Leaf size={34} /> : <Utensils size={34} />}</span>}
                          {food.category?.nameVi && <em>{food.category.nameVi}</em>}
                        </button><button type="button" className={`meal-plan-live-card__save ${saved ? 'is-saved' : ''}`} onClick={() => props.onToggleSaved(food, !saved)} aria-label={saved ? `Bỏ lưu ${food.name}` : `Lưu ${food.name}`} aria-pressed={saved}><Heart size={17} /></button></div>
                        <div className="meal-plan-live-card__body">
                          <div className="meal-plan-live-card__title-row"><button type="button" onClick={() => props.onOpenCatalogFood(food, items)}>{food.name}</button></div>
                          <p><strong>{formatNumber(food.calories)} kcal</strong><span>{formatNumber(food.protein, 1)}g đạm</span><span>{formatNumber(food.carbs, 1)}g carb</span></p>
                          <small>{food.servingLabel || (food.servingGrams ? `${formatNumber(food.servingGrams)} g` : 'Khẩu phần theo nguồn')}</small>
                          <button type="button" className="meal-plan-live-card__log" aria-label={`Ghi nhật ký: ${food.name}`} disabled={loggingId !== null || food.calories === null || food.protein === null || food.carbs === null || food.fat === null} onClick={() => void logFood(food)}>{loggingId === food.id ? <LoaderCircle size={15} className="is-spinning" /> : <Plus size={15} />} Ghi nhật ký</button>
                        </div>
                      </article>
                    )
                  })}
                </div>
              ) : (
                <div className="meal-plan-live-empty"><Utensils size={25} /><h3>{hasMore ? 'Chưa có món phù hợp trong phần đã tải' : 'Chưa tìm thấy món phù hợp'}</h3><p>{hasMore ? 'Bấm Xem thêm món để tiếp tục tìm với các bộ lọc đang chọn.' : 'Thử bỏ bớt bộ lọc hoặc tìm bằng tên món khác.'}</p><button type="button" onClick={() => { setQuery(''); setCategory('all'); setCalorieFilter('all'); setProteinFilter('all'); setGoalFilter('all'); setMealTypeFilter('all'); setSavedOnly(false) }}>Xóa bộ lọc</button></div>
              )}
              {hasMore && catalogState === 'live' && <button type="button" className="meal-plan-load-more" onClick={loadMore} disabled={loadingMore}>{loadingMore ? <LoaderCircle className="is-spinning" size={17} /> : <Plus size={17} />} Xem thêm món</button>}
            </section>
          </main>
        ) : (
          <main id="menu-tab-panel" className="meal-plan-main meal-plan-live-plan" role="tabpanel" aria-labelledby="menu-tab-plan">
            <section className="meal-plan-week-toolbar" aria-label="Tuần kế hoạch">
              <button type="button" onClick={() => props.onShiftWeek(-1)} aria-label="Tuần trước"><ChevronLeft size={19} /></button>
              <div><small>KẾ HOẠCH TUẦN</small><strong>{props.weekLabel}</strong>{props.sourceTitle && <em>{props.sourceTitle}</em>}{props.status && <span className={`is-${props.status}`}>{props.status === 'draft' ? 'Bản nháp' : 'Đang áp dụng'}</span>}</div>
              <button type="button" onClick={() => props.onShiftWeek(1)} aria-label="Tuần sau"><ChevronRight size={19} /></button>
            </section>

            <section className="plan-summary-card meal-plan-live-strategy">
              <span><Target size={20} /></span>
              <div><h2>{props.strategyTitle}</h2><p>{props.strategyDescription}</p><div>{props.constraints.slice(0, 3).map((item) => <small key={item}><Check size={12} /> {item}</small>)}</div></div>
            </section>

            {props.errorMessage && <div className="meal-plan-live-error" role="alert"><CircleAlert size={19} /><div><strong>Chưa đồng bộ được kế hoạch</strong><p>{props.errorMessage}</p></div><button type="button" onClick={props.onReload}>Thử lại</button></div>}

            {props.isLoading ? (
              <div className="meal-plan-live-loading" role="status"><LoaderCircle className="is-spinning" size={22} /> Đang tải kế hoạch tuần…</div>
            ) : props.meals.length === 0 ? (
              <section className="meal-plan-plan-empty"><span><CalendarDays size={28} /></span><h2>Tuần này chưa có kế hoạch</h2><p>Aura sẽ chọn món từ thư viện thật theo mục tiêu kcal, đạm, dị ứng và món bạn không thích.</p><button type="button" onClick={props.onGeneratePlan} disabled={props.isGenerating}>{props.isGenerating ? <LoaderCircle className="is-spinning" size={17} /> : <Sparkles size={17} />} Tạo kế hoạch 7 ngày</button></section>
            ) : (
              <>
                <div className="plan-date-strip-container"><div className="plan-date-strip" role="tablist" aria-label="Chọn ngày trong kế hoạch">
                  {props.days.map((day) => <button key={day.id} type="button" role="tab" aria-selected={selectedDay?.id === day.id} onClick={() => props.onSelectDay(day.id)} className={`plan-date-pill ${selectedDay?.id === day.id ? 'plan-date-pill--active' : ''}`}><span className="day-name">{day.weekday.replace('Thứ ', 'T').replace('Chủ Nhật', 'CN')}</span><span className="day-number-circle">{day.date}</span></button>)}
                </div></div>

                <section className="meal-plan-day-summary">
                  <div><small>{selectedDay?.label || selectedDay?.weekday}</small><strong>{formatNumber(totals.calories)} <span>/ {formatNumber(props.dailyCalorieGoal)} kcal</span></strong></div>
                  <div><span><small>Đạm</small><strong>{formatNumber(totals.protein)}g</strong></span><span><small>Carb</small><strong>{formatNumber(totals.carbs)}g</strong></span><span><small>Chất béo</small><strong>{formatNumber(totals.fat)}g</strong></span><span><small>Số bữa</small><strong>{selectedDayMeals.length}</strong></span></div>
                  <i><span style={{ width: `${Math.min(100, Math.round((totals.calories / Math.max(1, props.dailyCalorieGoal)) * 100))}%` }} /></i>
                </section>

                <section className="meal-plan-day-meals" aria-label={`Các bữa ${selectedDay?.weekday}`}>
                  {selectedDayMeals.map((meal) => {
                    const logged = props.loggedMealKeys?.has(planMealKey(meal)) || props.loggedMealKeys?.has(`${meal.dayId}|${meal.catalogId || meal.title.trim().toLocaleLowerCase('vi-VN')}`)
                    return <article key={meal.id} className="plan-detailed-meal-card meal-plan-day-meal">
                      <button type="button" className="meal-plan-day-meal__image" onClick={() => props.onOpenMeal?.(meal.id)} disabled={!props.onOpenMeal} aria-label={`Xem ${meal.title}`}>{meal.image ? <img src={meal.image} alt="" loading="lazy" /> : <span><Utensils size={22} /></span>}</button>
                      <div className="meal-plan-day-meal__body"><div><span className="plan-meal-time-badge"><Clock3 size={12} /> {meal.time} · {meal.label}</span><strong>{formatNumber(meal.calories)} kcal</strong></div><button type="button" className="meal-plan-day-meal__title" onClick={() => props.onOpenMeal?.(meal.id)} disabled={!props.onOpenMeal}>{meal.title}</button><p>{formatNumber(meal.protein)}g đạm · {formatNumber(meal.carbs)}g carb · {formatNumber(meal.fat)}g béo</p>{meal.rationale && <small>{meal.rationale}</small>}<div className="meal-plan-day-meal__actions"><button type="button" className={logged ? 'is-logged' : ''} onClick={() => props.onLogPlannedMeal(meal)} disabled={logged}>{logged ? <Check size={14} /> : <Plus size={14} />}{logged ? 'Đã ghi' : 'Ghi nhật ký'}</button>{props.canEdit && <button type="button" onClick={() => props.onReplaceMeal(meal.id)}>Đổi món</button>}{props.canEdit && <button type="button" className="is-danger" onClick={() => props.onRemoveMeal(meal.id)} aria-label={`Xóa ${meal.title}`}><Trash2 size={14} /></button>}</div></div>
                    </article>
                  })}
                  {props.canEdit && <button type="button" className="meal-plan-add-meal" onClick={() => selectedDay && props.onAddMeal(selectedDay.id)}><Plus size={17} /> Thêm món vào {selectedDay?.weekday}</button>}
                </section>

                <div className="meal-plan-plan-actions">
                  <button type="button" className="meal-plan-regenerate" onClick={() => { if (window.confirm('Tạo lại sẽ thay phần kế hoạch nháp hiện tại. Bạn muốn tiếp tục?')) props.onGeneratePlan() }} disabled={props.isGenerating || props.isSaving}><RefreshCw className={props.isGenerating ? 'is-spinning' : ''} size={17} /> Tạo lại gợi ý</button>
                  {props.canEdit && props.status === 'draft' && <button type="button" className="meal-plan-confirm" onClick={props.onConfirmPlan} disabled={props.isSaving}>{props.isSaving ? <LoaderCircle className="is-spinning" size={17} /> : <Check size={17} />} Xác nhận kế hoạch tuần</button>}
                </div>
              </>
            )}
          </main>
        )}
      </div>


    </div>
  )
}
