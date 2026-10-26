import React, { useEffect, useMemo, useState } from 'react'
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
import { catalogServingLabel } from '../../features/nutrition/catalogPresentation'
import IngredientArtwork from '../../components/IngredientArtwork'
import { getIngredientArtwork } from '../../features/nutrition/ingredientArtwork'
import { KCAL_CATALOG_TITLE } from '../../features/nutrition/catalogLabels'
import { catalogNutritionMatches, emptyCatalogFilters, type CatalogEnergyFilter, type CatalogFilters, type IngredientProteinFilter } from '../../features/nutrition/catalogFilters'
import { useCatalogInfiniteScroll } from '../../features/nutrition/useCatalogInfiniteScroll'
import type { NutritionFoodCatalogItem } from '../../features/nutrition/types'
import type { NutritionPlanDay, NutritionPlannedMeal } from './NutritionWorkspace'
import '../../styles-meal-plan.css'

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
  onLogPlannedMeal: (meal: NutritionPlannedMeal) => void | Promise<void>
  onToggleSaved: (food: NutritionFoodCatalogItem, saved: boolean) => void
}

function formatNumber(value: number | null | undefined, digits = 0) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—'
  return new Intl.NumberFormat('vi-VN', { maximumFractionDigits: digits }).format(value)
}

function planMealKey(meal: NutritionPlannedMeal) {
  return `${meal.dayId}|${meal.id}`
}

export default function ConnectedMealPlanPage(props: ConnectedMealPlanPageProps) {
  const [localTab, setLocalTab] = useState<MealPlanTab>('recipes')
  const activeTab = props.activeTab ?? localTab
  const ingredients = activeTab === 'ingredients'
  const filterTab = ingredients ? 'ingredients' : 'recipes'
  const [tabFilters, setTabFilters] = useState(() => ({
    recipes: { ...emptyCatalogFilters(), savedOnly: props.initialSavedOnly ?? false },
    ingredients: { ...emptyCatalogFilters(), savedOnly: props.initialSavedOnly ?? false },
  }))
  const filters = tabFilters[filterTab]
  const { query, category, energy: calorieFilter, protein: proteinFilter, savedOnly } = filters
  const updateFilters = (patch: Partial<CatalogFilters>) => setTabFilters(current => ({ ...current, [filterTab]: { ...current[filterTab], ...patch } }))
  const resetFilters = () => setTabFilters(current => ({ ...current, [filterTab]: emptyCatalogFilters() }))
  const [mobileColumns, setMobileColumns] = useState<1 | 2>(2)
  useEffect(() => {
    setTabFilters(current => ({
      recipes: { ...current.recipes, savedOnly: props.initialSavedOnly ?? false },
      ingredients: { ...current.ingredients, savedOnly: props.initialSavedOnly ?? false },
    }))
  }, [props.initialSavedOnly])
  const [filterOpen, setFilterOpen] = useState(false)
  const catalog = useMealPlanCatalog({ tab: activeTab, active: props.catalogActive, query, category, savedOnly, savedFoodIds: props.savedFoodIds, initialCatalog: props.initialCatalog, allowDemo: props.allowDemo })
  const { items, categories, status: catalogState, hasMore, nextCursor, loadingMore, loadMoreError, loadMore, reload: reloadCatalog } = catalog
  const selectTab = (tab: MealPlanTab) => {
    setLocalTab(tab)
    props.onTabChange?.(tab)
  }

  const visibleItems = useMemo(() => items.filter((item) => {
    if (savedOnly && !props.savedFoodIds.has(item.id)) return false
    return catalogNutritionMatches(item, ingredients, calorieFilter, proteinFilter)
  }), [calorieFilter, items, ingredients, proteinFilter, props.savedFoodIds, savedOnly])
  const catalogEnd = useCatalogInfiniteScroll({
    scope: JSON.stringify([activeTab, filters, catalog.requestKey]),
    active: props.catalogActive !== false && activeTab !== 'plan',
    enabled: catalogState === 'live' && hasMore && !loadMoreError,
    cursor: nextCursor, loading: loadingMore, loadMore,
  })

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


  return (
    <div className="meal-plan-page-container meal-plan-page-container--connected">
      <div className="meal-plan-shell meal-plan-shell--connected">
        <header className="meal-plan-header meal-plan-header--connected">
          <div className="meal-plan-header__top">
            <div>
              <h1 className="meal-plan-header__title">{KCAL_CATALOG_TITLE}</h1>
              <p className="meal-plan-header__subtitle">Tra cứu năng lượng và thành phần dinh dưỡng.</p>
            </div>
            <div className="meal-plan-header__actions">
              <button type="button" className={`meal-plan-icon-btn ${savedOnly ? 'is-active' : ''}`} onClick={() => { if (activeTab === 'plan') selectTab('recipes'); updateFilters({ savedOnly: !savedOnly }) }} aria-label={savedOnly ? 'Hiện tất cả' : ingredients ? 'Xem nguyên liệu đã lưu' : 'Xem món đã lưu'} aria-pressed={savedOnly}>
                <Bookmark size={20} />
                {props.savedFoodIds.size > 0 && <span className="meal-plan-badge-count">{props.savedFoodIds.size}</span>}
              </button>

            </div>
          </div>

          <div className="meal-plan-tabs" role="tablist" aria-label="Nội dung tra cứu">
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
                <input value={query} onChange={(event) => updateFilters({ query: event.target.value })} placeholder={ingredients ? 'Tìm nguyên liệu, nhóm thực phẩm…' : 'Tìm món ăn, nhóm món…'} className="meal-plan-search-input" aria-label={ingredients ? 'Tìm nguyên liệu' : 'Tìm món ăn'} type="search" />
                {query && <button type="button" onClick={() => updateFilters({ query: '' })} aria-label="Xóa từ khóa"><X size={16} /></button>}
              </div>
              <button type="button" onClick={() => setFilterOpen((current) => !current)} aria-label="Bộ lọc" className={`meal-plan-filter-trigger ${filterCount ? 'meal-plan-filter-trigger--active' : ''}`} aria-expanded={filterOpen} aria-controls="meal-plan-filter-panel">
                <SlidersHorizontal size={18} /><span>Bộ lọc{filterCount ? ` (${filterCount})` : ''}</span>
              </button>
            </div>

            {filterOpen && (
              <section id="meal-plan-filter-panel" className="meal-plan-filter-panel" aria-label={ingredients ? 'Bộ lọc nguyên liệu' : 'Bộ lọc món ăn'}>
                <div>
                  <span>{ingredients ? 'Nhóm nguyên liệu' : 'Nhóm món'}</span>
                  <select value={category} onChange={(event) => updateFilters({ category: event.target.value })} aria-label={ingredients ? 'Nhóm nguyên liệu' : 'Nhóm món'}>
                    <option value="all">{ingredients ? 'Tất cả nhóm nguyên liệu' : 'Tất cả nhóm món'}</option>
                    {categories.map((value) => <option key={value} value={value}>{value}</option>)}
                  </select>
                </div>
                <div>
                  <span>{ingredients ? 'Năng lượng / 100 g' : 'Kcal theo nguồn'}</span>
                  <select value={calorieFilter} onChange={(event) => updateFilters({ energy: event.target.value as CatalogEnergyFilter })} aria-label={ingredients ? 'Năng lượng trên 100 g' : 'Kcal theo nguồn'}>
                    <option value="all">Mọi mức kcal</option>
                    <option value="lower">{ingredients ? 'Dưới 100 kcal' : 'Dưới 300 kcal'}</option>
                    <option value="middle">{ingredients ? '100–300 kcal' : '300–500 kcal'}</option>
                    <option value="higher">{ingredients ? 'Trên 300 kcal' : 'Trên 500 kcal'}</option>
                  </select>
                </div>
                {ingredients && <div>
                  <span>Đạm / 100 g</span>
                  <select value={proteinFilter} onChange={(event) => updateFilters({ protein: event.target.value as IngredientProteinFilter })} aria-label="Đạm trên 100 g">
                    <option value="all">Mọi mức đạm</option>
                    <option value="at-least-10">Từ 10 g</option>
                    <option value="at-least-20">Từ 20 g</option>
                  </select>
                </div>}
                <button type="button" className={savedOnly ? 'is-active' : ''} onClick={() => updateFilters({ savedOnly: !savedOnly })} aria-pressed={savedOnly}><Heart size={15} /> {ingredients ? 'Nguyên liệu đã lưu' : 'Món đã lưu'}</button>
                {filterCount > 0 && <button type="button" className="meal-plan-filter-panel__clear" onClick={() => updateFilters({ category: 'all', energy: 'all', protein: 'all', savedOnly: false })}>Xóa lọc</button>}
              </section>
            )}

            <section className="meal-plan-live-section" aria-labelledby="meal-plan-catalog-title">
              <div className="meal-plan-live-heading">
              <div><div><h2 id="meal-plan-catalog-title">{savedOnly ? 'Đã lưu' : ingredients ? 'Nguyên liệu' : 'Món ăn'}</h2><p>{catalogState === 'loading' ? 'Đang tải…' : `${formatNumber(visibleItems.length)} ${ingredients ? 'nguyên liệu' : 'món'}${hasMore ? ' đã hiển thị' : ''}`}</p></div></div>
              <div className="meal-plan-display-toggle" role="group" aria-label="Mật độ hiển thị trên điện thoại">
                <button type="button" className={mobileColumns === 1 ? 'is-active' : ''} onClick={() => setMobileColumns(1)} aria-pressed={mobileColumns === 1}>1 cột</button>
                <button type="button" className={mobileColumns === 2 ? 'is-active' : ''} onClick={() => setMobileColumns(2)} aria-pressed={mobileColumns === 2}>2 cột</button>
              </div>
                {catalogState === 'error' && <button type="button" onClick={reloadCatalog}><RefreshCw size={15} /> Tải lại</button>}
              </div>

              {catalogState === 'error' && <p className="meal-plan-catalog-error" role="alert">Chưa tải được danh sách. Bấm Tải lại để thử lại.</p>}
              {catalogState === 'loading' ? (
                <div className="meal-plan-live-loading" role="status"><LoaderCircle className="is-spinning" size={22} /> Đang tải {ingredients ? 'nguyên liệu' : 'món ăn'}…</div>
              ) : visibleItems.length ? (
                <div className={`meal-plan-live-grid meal-plan-live-grid--mobile-${mobileColumns}`}>
                  {visibleItems.map((food) => {
                    const saved = props.savedFoodIds.has(food.id)
                    const servingLabel = catalogServingLabel(food.servingLabel, food.servingGrams)
                    const artwork = food.kind === 'food' ? getIngredientArtwork(food.code) : null
                    return (
                      <article className="meal-plan-live-card" key={food.id}>
                        <div className="meal-plan-live-card__media"><button type="button" className="meal-plan-live-card__visual" onClick={() => props.onOpenCatalogFood(food, items)} aria-label={`Xem chi tiết ${food.name}`}>
                          {food.imageUrl ? <img src={food.imageUrl} alt="" loading="lazy" decoding="async" width="480" height="360" /> : artwork ? <IngredientArtwork artwork={artwork} name={food.name} /> : <span>{activeTab === 'ingredients' ? <Leaf size={34} /> : <Utensils size={34} />}</span>}
                          {food.category?.nameVi && <em>{food.category.nameVi}</em>}
                        </button><button type="button" className={`meal-plan-live-card__save ${saved ? 'is-saved' : ''}`} onClick={() => props.onToggleSaved(food, !saved)} aria-label={saved ? `Bỏ lưu ${food.name}` : `Lưu ${food.name}`} aria-pressed={saved}><Heart size={17} /></button></div>
                        <div className="meal-plan-live-card__body">
                          <div className="meal-plan-live-card__title-row"><button type="button" onClick={() => props.onOpenCatalogFood(food, items)}>{food.name}</button></div>
                          <p><strong>{formatNumber(food.calories)} kcal</strong><span>{formatNumber(food.protein, 1)}g đạm</span><span>{formatNumber(food.carbs, 1)}g carb</span></p>
                          {servingLabel && <small>{servingLabel}</small>}
                        </div>
                      </article>
                    )
                  })}
                </div>
              ) : (
                <div className="meal-plan-live-empty"><Utensils size={25} /><h3>{hasMore ? 'Chưa có kết quả phù hợp trong phần đã tải' : 'Chưa tìm thấy kết quả phù hợp'}</h3><p>{hasMore ? 'Cuộn xuống để tiếp tục tìm với các bộ lọc đang chọn.' : 'Thử bỏ bớt bộ lọc hoặc tìm bằng tên khác.'}</p><button type="button" onClick={resetFilters}>Xóa bộ lọc</button></div>
              )}
              <div ref={catalogEnd} className="meal-plan-catalog-end" data-catalog-end tabIndex={hasMore ? 0 : -1} aria-label="Cuối danh sách tra cứu" aria-busy={loadingMore}>
                {loadMoreError ? <><span role="alert">Chưa tải được phần tiếp theo.</span><button type="button" onClick={loadMore}>Thử tải lại</button></> : <span role="status" aria-live="polite">{loadingMore ? <><LoaderCircle className="is-spinning" size={17} /> Đang tải thêm {ingredients ? 'nguyên liệu' : 'món ăn'}…</> : hasMore ? 'Cuộn xuống để xem tiếp' : catalogState !== 'loading' && items.length > 0 ? 'Đã hết danh sách' : ''}</span>}
              </div>
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
