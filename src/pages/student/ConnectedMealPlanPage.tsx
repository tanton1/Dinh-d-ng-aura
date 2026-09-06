import React, { useEffect, useMemo, useState } from 'react'
import {
  Bookmark,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Clock3,
  Flame,
  Heart,
  ImageOff,
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
import { useDebounce } from '../../hooks/useDebounce'
import { loadNutritionCatalogPage, resetNutritionCatalog } from '../../features/nutrition/catalog'
import type { NutritionFoodCatalogItem } from '../../features/nutrition/types'
import type { NutritionPlanDay, NutritionPlannedMeal } from './NutritionWorkspace'
import '../../styles-meal-plan.css'

type CalorieFilter = 'all' | 'under-300' | '300-500' | 'over-500'
type ProteinFilter = 'all' | 'high-protein'

const DEMO_DISHES: NutritionFoodCatalogItem[] = [
  { id: 'demo-chicken', kind: 'dish', name: 'Ức gà áp chảo & rau củ', category: { nameVi: 'Món chính' }, servingGrams: null, servingLabel: '1 khẩu phần', calories: 428, protein: 42, carbs: 36, fat: 12, source: 'Aura Menu', imageUrl: 'https://images.unsplash.com/photo-1532550907401-a500c9a57435?auto=format&fit=crop&w=800&q=80' },
  { id: 'demo-salad', kind: 'dish', name: 'Salad khoai lang nướng & cải kale', category: { nameVi: 'Salad' }, servingGrams: null, servingLabel: '1 khẩu phần', calories: 386, protein: 18, carbs: 52, fat: 11, source: 'Aura Menu', imageUrl: 'https://images.unsplash.com/photo-1512621776951-a57141f2eefd?auto=format&fit=crop&w=800&q=80' },
  { id: 'demo-pasta', kind: 'dish', name: 'Mì Ý sốt cà chua với tôm', category: { nameVi: 'Mì và bún' }, servingGrams: null, servingLabel: '1 khẩu phần', calories: 312, protein: 28, carbs: 41, fat: 7, source: 'Aura Menu', imageUrl: 'https://images.unsplash.com/photo-1551183053-bf91a1d81141?auto=format&fit=crop&w=800&q=80' },
  { id: 'demo-salmon', kind: 'dish', name: 'Cá hồi áp chảo & măng tây', category: { nameVi: 'Món chính' }, servingGrams: null, servingLabel: '1 khẩu phần', calories: 518, protein: 44, carbs: 24, fat: 26, source: 'Aura Menu', imageUrl: 'https://images.unsplash.com/photo-1467003909585-2f8a72700288?auto=format&fit=crop&w=800&q=80' },
  { id: 'demo-yogurt', kind: 'dish', name: 'Sữa chua Hy Lạp, yến mạch & quả mọng', category: { nameVi: 'Bữa sáng' }, servingGrams: null, servingLabel: '1 khẩu phần', calories: 256, protein: 21, carbs: 29, fat: 6, source: 'Aura Menu', imageUrl: 'https://images.unsplash.com/photo-1488477181946-6428a0291777?auto=format&fit=crop&w=800&q=80' },
  { id: 'demo-seabass', kind: 'dish', name: 'Cá chẽm hấp gừng hành & cơm gạo lứt', category: { nameVi: 'Món chính' }, servingGrams: null, servingLabel: '1 khẩu phần', calories: 410, protein: 38, carbs: 44, fat: 9, source: 'Aura Menu', imageUrl: 'https://images.unsplash.com/photo-1515003197210-e0cd71810b5f?auto=format&fit=crop&w=800&q=80' },
]

export interface ConnectedMealPlanPageProps {
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

function planMealKey(meal: NutritionPlannedMeal) {
  return `${meal.dayId}|${meal.id}`
}

export default function ConnectedMealPlanPage(props: ConnectedMealPlanPageProps) {
  const [activeTab, setActiveTab] = useState<'recipes' | 'plan'>('recipes')
  const [query, setQuery] = useState('')
  const debouncedQuery = useDebounce(query, 300)
  const [items, setItems] = useState<NutritionFoodCatalogItem[]>(props.initialCatalog?.length ? props.initialCatalog : [])
  const [categories, setCategories] = useState<string[]>([])
  const [category, setCategory] = useState('all')
  const [calorieFilter, setCalorieFilter] = useState<CalorieFilter>('all')
  const [proteinFilter, setProteinFilter] = useState<ProteinFilter>('all')
  const [savedOnly, setSavedOnly] = useState(false)
  const [filterOpen, setFilterOpen] = useState(false)
  const [catalogState, setCatalogState] = useState<'loading' | 'live' | 'demo' | 'error'>('loading')
  const [totalCount, setTotalCount] = useState(0)
  const [catalogVersion, setCatalogVersion] = useState('')
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [retryToken, setRetryToken] = useState(0)
  const [selectedSummary, setSelectedSummary] = useState<NutritionFoodCatalogItem | null>(null)

  useEffect(() => {
    let active = true
    setCatalogState('loading')
    setNextCursor(null)
    setHasMore(false)
    if (props.allowDemo && !props.initialCatalog?.length) {
      setItems(DEMO_DISHES)
      setCategories([...new Set(DEMO_DISHES.map((item) => item.category?.nameVi).filter((value): value is string => Boolean(value)))])
      setTotalCount(DEMO_DISHES.length)
      setCatalogState('demo')
      return () => { active = false }
    }
    loadNutritionCatalogPage({
      query: debouncedQuery,
      kind: 'dish',
      category: category === 'all' ? '' : category,
      limit: 30,
    }).then((page) => {
      if (!active) return
      setItems(page.items)
      setCategories(page.categories)
      setTotalCount(page.filteredCount)
      setCatalogVersion(page.catalogVersion)
      setNextCursor(page.nextCursor)
      setHasMore(page.hasMore)
      setCatalogState('live')
    }).catch(() => {
      if (!active) return
      const fallback = props.initialCatalog?.length ? props.initialCatalog : props.allowDemo ? DEMO_DISHES : []
      setItems(fallback.filter((item) => item.kind !== 'food'))
      setCategories([...new Set(fallback.map((item) => item.category?.nameVi).filter((value): value is string => Boolean(value)))])
      setTotalCount(fallback.length)
      setCatalogState(fallback.length ? 'demo' : 'error')
    })
    return () => { active = false }
  }, [category, debouncedQuery, props.allowDemo, props.initialCatalog, retryToken])

  const visibleItems = useMemo(() => items.filter((item) => {
    if (savedOnly && !props.savedFoodIds.has(item.id)) return false
    if (!calorieMatches(item.calories, calorieFilter)) return false
    if (proteinFilter === 'high-protein' && (item.protein ?? 0) < 20) return false
    return true
  }), [calorieFilter, items, proteinFilter, props.savedFoodIds, savedOnly])

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
  const filterCount = (category !== 'all' ? 1 : 0) + (calorieFilter !== 'all' ? 1 : 0) + (proteinFilter !== 'all' ? 1 : 0) + (savedOnly ? 1 : 0)

  const reloadCatalog = () => {
    resetNutritionCatalog()
    setRetryToken((current) => current + 1)
  }

  const loadMore = async () => {
    if (!hasMore || !nextCursor || loadingMore) return
    setLoadingMore(true)
    try {
      const page = await loadNutritionCatalogPage({
        query: debouncedQuery,
        kind: 'dish',
        category: category === 'all' ? '' : category,
        limit: 30,
        cursor: nextCursor,
        catalogVersion: catalogVersion || undefined,
      })
      setItems((current) => {
        const merged = new Map(current.map((item) => [item.id, item]))
        page.items.forEach((item) => merged.set(item.id, item))
        return [...merged.values()]
      })
      setNextCursor(page.nextCursor)
      setHasMore(page.hasMore)
      setTotalCount(page.filteredCount)
    } catch {
      setCatalogState('error')
    } finally {
      setLoadingMore(false)
    }
  }

  return (
    <div className="meal-plan-page-container meal-plan-page-container--connected">
      <div className="meal-plan-shell meal-plan-shell--connected">
        <header className="meal-plan-header meal-plan-header--connected">
          <div className="meal-plan-header__top">
            <div>
              <h1 className="meal-plan-header__title">THỰC ĐƠN</h1>
              <p className="meal-plan-header__subtitle">Ăn uống khoa học – Đạt mục tiêu vóc dáng</p>
            </div>
            <div className="meal-plan-header__actions">
              <button type="button" className={`meal-plan-icon-btn ${savedOnly ? 'is-active' : ''}`} onClick={() => { setActiveTab('recipes'); setSavedOnly((current) => !current) }} aria-label={savedOnly ? 'Hiện tất cả món' : 'Xem món đã lưu'} aria-pressed={savedOnly}>
                <Bookmark size={20} />
                {props.savedFoodIds.size > 0 && <span className="meal-plan-badge-count">{props.savedFoodIds.size}</span>}
              </button>
              <button type="button" className="meal-plan-icon-btn" onClick={() => setFilterOpen((current) => !current)} aria-label="Mở bộ lọc món ăn" aria-expanded={filterOpen} aria-controls="meal-plan-filter-panel">
                <SlidersHorizontal size={20} />
                {filterCount > 0 && <span className="meal-plan-badge-dot" />}
              </button>
            </div>
          </div>

          <div className="meal-plan-tabs" role="tablist" aria-label="Nội dung kế hoạch dinh dưỡng">
            <button type="button" role="tab" aria-selected={activeTab === 'recipes'} onClick={() => setActiveTab('recipes')} className={`meal-plan-tab-btn ${activeTab === 'recipes' ? 'meal-plan-tab-btn--active' : ''}`}>
              Thực đơn
              {activeTab === 'recipes' && <span className="meal-plan-tab-indicator" />}
            </button>
            <button type="button" role="tab" aria-selected={activeTab === 'plan'} onClick={() => setActiveTab('plan')} className={`meal-plan-tab-btn ${activeTab === 'plan' ? 'meal-plan-tab-btn--active' : ''}`}>
              Kế hoạch 7 ngày
              {activeTab === 'plan' && <span className="meal-plan-tab-indicator" />}
            </button>
          </div>
        </header>

        {activeTab === 'recipes' ? (
          <main className="meal-plan-main meal-plan-live-catalog" role="tabpanel">
            <div className="meal-plan-search-row">
              <div className="meal-plan-search-input-wrapper">
                <Search size={20} aria-hidden="true" />
                <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tìm món ăn, nguyên liệu hoặc nhóm món..." className="meal-plan-search-input" aria-label="Tìm món ăn" />
                {query && <button type="button" onClick={() => setQuery('')} aria-label="Xóa từ khóa"><X size={16} /></button>}
              </div>
              <button type="button" onClick={() => setFilterOpen((current) => !current)} className={`meal-plan-filter-trigger ${filterCount ? 'meal-plan-filter-trigger--active' : ''}`} aria-expanded={filterOpen} aria-controls="meal-plan-filter-panel">
                <SlidersHorizontal size={18} /> Bộ lọc{filterCount ? ` (${filterCount})` : ''}
              </button>
            </div>

            {filterOpen && (
              <section id="meal-plan-filter-panel" className="meal-plan-filter-panel" aria-label="Bộ lọc thực đơn">
                <div>
                  <span>Nhóm món</span>
                  <select value={category} onChange={(event) => setCategory(event.target.value)} aria-label="Nhóm món">
                    <option value="all">Tất cả nhóm món</option>
                    {categories.map((value) => <option key={value} value={value}>{value}</option>)}
                  </select>
                </div>
                <div>
                  <span>Năng lượng</span>
                  <select value={calorieFilter} onChange={(event) => setCalorieFilter(event.target.value as CalorieFilter)} aria-label="Mức năng lượng">
                    <option value="all">Mọi mức kcal</option>
                    <option value="under-300">Dưới 300 kcal</option>
                    <option value="300-500">300–500 kcal</option>
                    <option value="over-500">Trên 500 kcal</option>
                  </select>
                </div>
                <button type="button" className={proteinFilter === 'high-protein' ? 'is-active' : ''} onClick={() => setProteinFilter((current) => current === 'all' ? 'high-protein' : 'all')} aria-pressed={proteinFilter === 'high-protein'}>Giàu đạm ≥ 20g</button>
                <button type="button" className={savedOnly ? 'is-active' : ''} onClick={() => setSavedOnly((current) => !current)} aria-pressed={savedOnly}><Heart size={15} /> Món đã lưu</button>
                {filterCount > 0 && <button type="button" className="meal-plan-filter-panel__clear" onClick={() => { setCategory('all'); setCalorieFilter('all'); setProteinFilter('all'); setSavedOnly(false) }}>Xóa lọc</button>}
              </section>
            )}

            <section className="meal-plan-live-section" aria-labelledby="meal-plan-catalog-title">
              <div className="meal-plan-live-heading">
                <div><span><Sparkles size={18} /></span><div><h2 id="meal-plan-catalog-title">Gợi ý phù hợp cho bạn</h2><p>{catalogState === 'demo' ? 'Dữ liệu minh họa' : `${formatNumber(totalCount)} món trong thư viện Aura`}</p></div></div>
                {catalogState === 'error' && <button type="button" onClick={reloadCatalog}><RefreshCw size={15} /> Tải lại</button>}
              </div>

              {catalogState === 'loading' ? (
                <div className="meal-plan-live-loading" role="status"><LoaderCircle className="is-spinning" size={22} /> Đang tải thực đơn…</div>
              ) : visibleItems.length ? (
                <div className="meal-plan-live-grid">
                  {visibleItems.map((food) => {
                    const saved = props.savedFoodIds.has(food.id)
                    return (
                      <article className="meal-plan-live-card" key={food.id}>
                        <button type="button" className="meal-plan-live-card__visual" onClick={() => food.id.startsWith('demo-') ? setSelectedSummary(food) : props.onOpenCatalogFood(food, items)} aria-label={`Xem chi tiết ${food.name}`}>
                          {food.imageUrl ? <img src={food.imageUrl} alt="" loading="lazy" /> : <span><ImageOff size={24} /><small>Chưa có ảnh</small></span>}
                          {food.category?.nameVi && <em>{food.category.nameVi}</em>}
                        </button>
                        <div className="meal-plan-live-card__body">
                          <div className="meal-plan-live-card__title-row"><button type="button" onClick={() => food.id.startsWith('demo-') ? setSelectedSummary(food) : props.onOpenCatalogFood(food, items)}>{food.name}</button><button type="button" className={saved ? 'is-saved' : ''} onClick={() => props.onToggleSaved(food, !saved)} aria-label={saved ? `Bỏ lưu ${food.name}` : `Lưu ${food.name}`} aria-pressed={saved}><Heart size={17} /></button></div>
                          <p><strong>{formatNumber(food.calories)} kcal</strong><span>{formatNumber(food.protein, 1)}g đạm</span><span>{formatNumber(food.carbs, 1)}g carb</span></p>
                          <small>{food.servingLabel || (food.servingGrams ? `${formatNumber(food.servingGrams)} g` : 'Khẩu phần theo nguồn')} · {food.source || 'Aura'}</small>
                          <button type="button" className="meal-plan-live-card__log" disabled={food.calories === null || food.protein === null || food.carbs === null || food.fat === null} onClick={() => props.onLogCatalogFood(food)}><Plus size={15} /> Ghi vào nhật ký</button>
                        </div>
                      </article>
                    )
                  })}
                </div>
              ) : (
                <div className="meal-plan-live-empty"><Utensils size={25} /><h3>Chưa tìm thấy món phù hợp</h3><p>Thử bỏ bớt bộ lọc hoặc tìm bằng tên món khác.</p><button type="button" onClick={() => { setQuery(''); setCategory('all'); setCalorieFilter('all'); setProteinFilter('all'); setSavedOnly(false) }}>Xóa bộ lọc</button></div>
              )}
              {hasMore && catalogState === 'live' && <button type="button" className="meal-plan-load-more" onClick={loadMore} disabled={loadingMore}>{loadingMore ? <LoaderCircle className="is-spinning" size={17} /> : <Plus size={17} />} Xem thêm món</button>}
            </section>
          </main>
        ) : (
          <main className="meal-plan-main meal-plan-live-plan" role="tabpanel">
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

      {selectedSummary && <div className="meal-plan-modal-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedSummary(null) }}><section className="meal-plan-modal-sheet meal-plan-summary-sheet" role="dialog" aria-modal="true" aria-labelledby="meal-plan-summary-title"><button type="button" className="recipe-modal-close-btn" onClick={() => setSelectedSummary(null)} aria-label="Đóng chi tiết"><X size={18} /></button>{selectedSummary.imageUrl && <img src={selectedSummary.imageUrl} alt="" />}<h2 id="meal-plan-summary-title">{selectedSummary.name}</h2><p><strong>{formatNumber(selectedSummary.calories)} kcal</strong><span>{formatNumber(selectedSummary.protein)}g đạm</span><span>{formatNumber(selectedSummary.carbs)}g carb</span><span>{formatNumber(selectedSummary.fat)}g béo</span></p><small>{selectedSummary.source}</small><button type="button" className="meal-plan-log-btn" onClick={() => { void props.onLogCatalogFood(selectedSummary); setSelectedSummary(null) }}><Plus size={17} /> Ghi món vào nhật ký</button></section></div>}
    </div>
  )
}
