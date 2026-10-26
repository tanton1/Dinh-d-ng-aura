import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft, ArrowRight, Bookmark, ChevronDown, CircleAlert,
  Info, LayoutGrid, Leaf, LoaderCircle, Plus, RefreshCw,
  Search, Utensils, X,
} from 'lucide-react'
import { useDebounce } from '../../hooks/useDebounce'
import NutritionGroupIcon from '../../components/NutritionGroupIcon'
import type { NutritionFoodCatalogItem } from '../../features/nutrition/types'
import { normalizeNutritionSearch as normalizeSearch } from '../../features/nutrition/routing'
import { loadNutritionCatalogPage, resetNutritionCatalog, scaleOptionalNumber } from '../../features/nutrition/catalog'
import { useAccessibleDialog } from '../../features/nutrition/useAccessibleDialog'
import './food-library.css'

import { DEMO_CATALOG } from '../../features/nutrition/demoCatalog'

function canLogCatalogFood(food: NutritionFoodCatalogItem): food is NutritionFoodCatalogItem & { calories: number; protein: number; carbs: number; fat: number } {
  return food.calories !== null && food.protein !== null && food.carbs !== null && food.fat !== null
}
function formatNumber(value: number) {
  return new Intl.NumberFormat('vi-VN').format(Math.round(value))
}
function formatDecimal(value: number, maximumFractionDigits = 1) {
  return new Intl.NumberFormat('vi-VN', { maximumFractionDigits }).format(value)
}

function scaleCatalogFood(food: NutritionFoodCatalogItem, multiplier: number): NutritionFoodCatalogItem {
  const safeMultiplier = Math.min(5, Math.max(0, Math.round(multiplier * 10) / 10))
  const scaledGrams = food.servingGrams === null ? null : Math.round(food.servingGrams * safeMultiplier * 10) / 10
  const basisLabel = food.servingGrams !== null
    ? `${formatDecimal(safeMultiplier)} khẩu phần · ${formatDecimal(scaledGrams ?? 0)} g`
    : `${formatDecimal(safeMultiplier)} suất theo nguồn`
  return {
    ...food,
    servingGrams: scaledGrams,
    servingLabel: basisLabel,
    calories: scaleOptionalNumber(food.calories, safeMultiplier),
    protein: scaleOptionalNumber(food.protein, safeMultiplier),
    carbs: scaleOptionalNumber(food.carbs, safeMultiplier),
    fat: scaleOptionalNumber(food.fat, safeMultiplier),
    fiber: scaleOptionalNumber(food.fiber, safeMultiplier),
    sugar: scaleOptionalNumber(food.sugar, safeMultiplier),
    sodium: scaleOptionalNumber(food.sodium, safeMultiplier),
  }
}

function catalogPageNeedsReload(error: unknown) {
  if (!error || typeof error !== 'object' || !('code' in error)) return false
  const code = String((error as { code?: unknown }).code ?? '')
  return code.endsWith('failed-precondition') || code.endsWith('invalid-argument')
}

const FoodCatalogModal = React.memo(function FoodCatalogModal({ catalog, savedFoodIds, initialSavedOnly = false, allowDemo = false, onClose, onAdd, onOpenDetail, onToggleSaved, presentation = 'modal', standalone = false, actionLabel = 'Ghi nhật ký' }: { catalog?: NutritionFoodCatalogItem[]; savedFoodIds?: Set<string>; initialSavedOnly?: boolean; allowDemo?: boolean; onClose: () => void; onAdd: (food: NutritionFoodCatalogItem, multiplier: number) => void | Promise<void>; onOpenDetail: (food: NutritionFoodCatalogItem, catalog: NutritionFoodCatalogItem[]) => void; onToggleSaved: (food: NutritionFoodCatalogItem, saved: boolean) => void; presentation?: 'modal' | 'page'; standalone?: boolean; actionLabel?: string }) {
  const [query, setQuery] = useState('')
  const debouncedQuery = useDebounce(query, 300)
  const [items, setItems] = useState<NutritionFoodCatalogItem[]>(catalog?.length ? catalog : [])
  const [catalogState, setCatalogState] = useState<'loading' | 'live' | 'demo' | 'error'>(catalog?.length ? 'live' : 'loading')
  const [catalogTotalCount, setCatalogTotalCount] = useState(catalog?.length ?? 0)
  const [catalogFilteredCount, setCatalogFilteredCount] = useState(catalog?.length ?? 0)
  const [catalogVersion, setCatalogVersion] = useState('')
  const [catalogCategories, setCatalogCategories] = useState<string[]>([])
  const [catalogNextCursor, setCatalogNextCursor] = useState<string | null>(null)
  const [catalogHasMore, setCatalogHasMore] = useState(false)
  const [catalogLoadingMore, setCatalogLoadingMore] = useState(false)
  const [retryToken, setRetryToken] = useState(0)
  const [kindFilter, setKindFilter] = useState<'all' | 'dish' | 'food'>('all')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const renderBatchSize = useMemo(() => window.matchMedia('(max-width: 760px)').matches ? 16 : 30, [])
  const [visibleCount, setVisibleCount] = useState(renderBatchSize)
  const [savedOnly, setSavedOnly] = useState(initialSavedOnly)
  const savedQueryKey = savedOnly ? JSON.stringify([...(savedFoodIds ?? [])].sort()) : ''
  const [portionById, setPortionById] = useState<Record<string, number>>({})
  const [addingFoodId, setAddingFoodId] = useState<string | null>(null)
  const dialogRef = useAccessibleDialog(onClose)
  const catalogListRef = useRef<HTMLDivElement>(null)
  const loadMoreSentinelRef = useRef<HTMLDivElement>(null)
  const catalogRequestGenerationRef = useRef(0)
  const catalogLoadingMoreRef = useRef(false)

  const updatePortion = (foodId: string, value: number) => {
    const nextValue = Math.min(5, Math.max(0, Math.round(value * 10) / 10))
    setPortionById((current) => ({ ...current, [foodId]: nextValue }))
  }

  const addCatalogFood = async (food: NutritionFoodCatalogItem, multiplier: number) => {
    setAddingFoodId(food.id)
    try {
      await onAdd(food, multiplier)
    } finally {
      setAddingFoodId(null)
    }
  }

  useEffect(() => {
    const generation = ++catalogRequestGenerationRef.current
    if (catalog?.length) {
      setItems(catalog)
      setCatalogTotalCount(catalog.length)
      setCatalogFilteredCount(catalog.length)
      setCatalogVersion(`provided-${catalog.length}`)
      setCatalogCategories([...new Set(catalog.map((item) => item.category?.nameVi).filter((value): value is string => Boolean(value)))].sort((left, right) => left.localeCompare(right, 'vi')))
      setCatalogNextCursor(null)
      setCatalogHasMore(false)
      setCatalogLoadingMore(false)
      catalogLoadingMoreRef.current = false
      setCatalogState('live')
      return
    }
    let active = true
    if (allowDemo) {
      setItems(DEMO_CATALOG)
      setCatalogTotalCount(DEMO_CATALOG.length)
      setCatalogFilteredCount(DEMO_CATALOG.length)
      setCatalogState('demo')
      return
    }
    if (savedOnly && savedQueryKey === '[]') {
      setItems([])
      setCatalogFilteredCount(0)
      setCatalogNextCursor(null)
      setCatalogHasMore(false)
      setCatalogLoadingMore(false)
      catalogLoadingMoreRef.current = false
      setCatalogState('live')
      return () => { active = false }
    }
    setCatalogState('loading')
    setCatalogNextCursor(null)
    setCatalogHasMore(false)
    setCatalogLoadingMore(false)
    catalogLoadingMoreRef.current = false
    setItems([])
    setVisibleCount(renderBatchSize)
    const savedIds = savedQueryKey ? JSON.parse(savedQueryKey) as string[] : undefined
    loadNutritionCatalogPage({
      query: savedIds?.length ? '' : debouncedQuery,
      kind: kindFilter,
      category: categoryFilter === 'all' ? '' : categoryFilter,
      limit: 36,
      ids: savedIds,
    })
      .then((page) => {
        if (!active || catalogRequestGenerationRef.current !== generation) return
        setItems(page.items)
        setCatalogTotalCount(page.catalogTotal)
        setCatalogFilteredCount(page.filteredCount)
        setCatalogVersion(page.catalogVersion)
        setCatalogCategories(page.categories)
        setCatalogNextCursor(page.nextCursor)
        setCatalogHasMore(page.hasMore)
        setCatalogState('live')
      })
      .catch(() => {
        if (!active || catalogRequestGenerationRef.current !== generation) return
        setItems(allowDemo ? DEMO_CATALOG : [])
        setCatalogFilteredCount(allowDemo ? DEMO_CATALOG.length : 0)
        setCatalogState(allowDemo ? 'demo' : 'error')
    })
    return () => { active = false }
  }, [allowDemo, catalog, categoryFilter, debouncedQuery, kindFilter, renderBatchSize, retryToken, savedOnly, savedQueryKey])

  const retryCatalog = () => {
    resetNutritionCatalog()
    setItems([])
    setCatalogState('loading')
    setRetryToken((current) => current + 1)
  }

  const loadMoreCatalog = useCallback(async () => {
    if (!catalogHasMore || !catalogNextCursor || catalogLoadingMoreRef.current || savedOnly) return
    const generation = catalogRequestGenerationRef.current
    const cursor = catalogNextCursor
    catalogLoadingMoreRef.current = true
    setCatalogLoadingMore(true)
    try {
      const page = await loadNutritionCatalogPage({
        query: debouncedQuery,
        kind: kindFilter,
        category: categoryFilter === 'all' ? '' : categoryFilter,
        limit: 36,
        cursor,
        catalogVersion: catalogVersion || undefined,
      })
      if (catalogRequestGenerationRef.current !== generation) return
      setItems((current) => {
        const byId = new Map(current.map((item) => [item.id, item]))
        page.items.forEach((item) => byId.set(item.id, item))
        return [...byId.values()]
      })
      setCatalogTotalCount(page.catalogTotal)
      setCatalogFilteredCount(page.filteredCount)
      setCatalogVersion(page.catalogVersion)
      setCatalogCategories(page.categories)
      setCatalogNextCursor(page.nextCursor)
      setCatalogHasMore(page.hasMore)
      setVisibleCount((current) => current + renderBatchSize)
    } catch (error: unknown) {
      if (catalogRequestGenerationRef.current !== generation) return
      if (catalogPageNeedsReload(error)) {
        resetNutritionCatalog()
        setItems([])
        setRetryToken((current) => current + 1)
        return
      }
      setCatalogState('error')
    } finally {
      if (catalogRequestGenerationRef.current === generation) {
        catalogLoadingMoreRef.current = false
        setCatalogLoadingMore(false)
      }
    }
  }, [catalogHasMore, catalogNextCursor, catalogVersion, categoryFilter, debouncedQuery, kindFilter, renderBatchSize, savedOnly])

  useEffect(() => {
    if (categoryFilter !== 'all' && catalogCategories.length && !catalogCategories.includes(categoryFilter)) setCategoryFilter('all')
  }, [catalogCategories, categoryFilter])

  const matchingItems = useMemo(() => {
    const normalizedQuery = normalizeSearch(debouncedQuery)
    const queryTokens = normalizedQuery.split(' ').filter(Boolean)
    const serverFilteredQuery = !catalog?.length && catalogState === 'live' && !savedOnly
    return items.filter((item) => {
      if (kindFilter !== 'all' && item.kind !== kindFilter) return false
      if (savedOnly && !savedFoodIds?.has(item.id)) return false
      if (categoryFilter !== 'all' && item.category?.nameVi !== categoryFilter) return false
      if (!queryTokens.length || serverFilteredQuery) return true
      const searchableText = normalizeSearch(`${item.name} ${item.nameEn ?? ''} ${item.nameAscii ?? ''} ${item.code ?? ''} ${item.category?.nameVi ?? ''} ${item.region?.nameVi ?? ''}`)
      return queryTokens.every((token) => searchableText.includes(token))
    })
  }, [catalog, catalogState, categoryFilter, items, kindFilter, debouncedQuery, savedFoodIds, savedOnly])

  useEffect(() => setVisibleCount(renderBatchSize), [categoryFilter, kindFilter, debouncedQuery, renderBatchSize, savedOnly])

  const filteredItems = matchingItems.slice(0, visibleCount)

  useEffect(() => {
    const target = loadMoreSentinelRef.current
    if (!target || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting) || catalogState === 'loading' || catalogState === 'error') return
      if (matchingItems.length > filteredItems.length) {
        setVisibleCount((current) => current + renderBatchSize)
      } else if (catalogHasMore && !catalogLoadingMore) {
        void loadMoreCatalog()
      }
    }, {
      root: presentation === 'modal' ? catalogListRef.current : null,
      rootMargin: '240px 0px',
      threshold: 0.01,
    })
    observer.observe(target)
    return () => observer.disconnect()
  }, [catalogHasMore, catalogLoadingMore, catalogState, filteredItems.length, loadMoreCatalog, matchingItems.length, presentation, renderBatchSize])

  const resultCount = catalog?.length || catalogState === 'demo' || savedOnly ? matchingItems.length : catalogFilteredCount
  const resetFilters = () => { setQuery(''); setKindFilter('all'); setCategoryFilter('all'); setSavedOnly(false) }
  const Heading = presentation === 'page' ? 'h1' : 'h2'

  return (
    <div className={presentation === 'page' ? 'nutrition-route-page nutrition-route-page--catalog' : 'nutrition-modal-backdrop'} role="presentation" onMouseDown={(event) => presentation === 'modal' && event.target === event.currentTarget && onClose()}>
      <section ref={presentation === 'modal' ? dialogRef : undefined} className={`nutrition-catalog-modal food-library ${presentation === 'page' ? 'nutrition-catalog-modal--page' : ''}`} role={presentation === 'modal' ? 'dialog' : 'region'} aria-modal={presentation === 'modal' ? true : undefined} aria-labelledby="nutrition-catalog-title" data-testid="nutrition-food-search-modal">
        <header className="food-library__header">
          <div>{standalone && <span className="food-library__eyebrow">HỌC & DỊCH VỤ</span>}<Heading id="nutrition-catalog-title">Thư viện món ăn</Heading><p>Hiểu món mình ăn. Chọn phần vừa đủ.</p></div>
          <button type="button" className="food-library__icon-button" onClick={onClose} aria-label={presentation === 'modal' ? 'Đóng' : standalone ? 'Về trang chủ' : 'Quay lại dinh dưỡng'}>{presentation === 'page' ? <ArrowLeft size={20} /> : <X size={20} />}</button>
        </header>
        <div className="nutrition-catalog-body">
          <div className="food-library__tools">
            <label className="food-library__search">
              <Search size={19} aria-hidden="true" />
              <input type="search" aria-label="Tìm món ăn hoặc thực phẩm" autoFocus={presentation === 'modal'} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tìm món ăn, thực phẩm, mã món…" data-testid="nutrition-food-search-input" />
              {query && <button type="button" onClick={() => setQuery('')} aria-label="Xóa tìm kiếm"><X size={17} /></button>}
            </label>
            <div className="food-library__filters" aria-label="Lọc danh mục">
              <div className="food-library__kinds">
                <button type="button" onClick={() => setKindFilter('all')} aria-pressed={kindFilter === 'all'}><LayoutGrid size={15} /> Tất cả</button>
                <button type="button" onClick={() => setKindFilter('dish')} aria-pressed={kindFilter === 'dish'}><Utensils size={15} /> Món ăn</button>
                <button type="button" onClick={() => setKindFilter('food')} aria-pressed={kindFilter === 'food'}><Leaf size={15} /> Thực phẩm</button>
                <button type="button" onClick={() => setSavedOnly((current) => !current)} aria-pressed={savedOnly}><Bookmark size={15} /> Đã lưu</button>
              </div>
              {catalogCategories.length > 0 && <label className="food-library__category"><span>Nhóm</span><select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}><option value="all">Tất cả nhóm</option>{catalogCategories.map((category) => <option value={category} key={category}>{category}</option>)}</select></label>}
            </div>
          </div>
          <div className="food-library__results" role="status" aria-live="polite">
            <span>{catalogState === 'loading' ? 'Đang tìm món…' : `${formatNumber(resultCount)} kết quả${savedOnly ? ' đã lưu' : ''}`}</span>
            <small>{catalogState === 'demo' ? 'Dữ liệu minh họa' : 'Dinh dưỡng theo khẩu phần đã chọn'}</small>
          </div>
          {catalogState === 'loading' && <div className="food-library__state"><LoaderCircle size={20} className="nutrition-spinner" /><span>Đang tải thư viện…</span></div>}
          {catalogState === 'error' && <div className="food-library__state" role="alert"><CircleAlert size={20} /><span>Chưa tải được món ăn. Bạn hãy thử lại.</span><button type="button" onClick={retryCatalog}><RefreshCw size={16} /> Thử lại</button></div>}
          <div ref={catalogListRef} className="food-library__list">
            {filteredItems.map((food) => {
              const portion = portionById[food.id] ?? 1
              const scaledFood = scaleCatalogFood(food, portion)
              const canAdd = portion > 0 && canLogCatalogFood(food)
              const portionLabel = `${formatDecimal(portion)} suất${scaledFood.servingGrams !== null ? ` · ${formatDecimal(scaledFood.servingGrams)} g` : ' theo nguồn'}`
              const isSaved = savedFoodIds?.has(food.id)
              return (
                <article className="food-library__card" key={food.id}>
                  <div className="food-library__identity">
                    <div className="food-library__image"><NutritionGroupIcon categoryName={food.category?.nameVi} kind={food.kind ?? 'food'} size={30} />{food.imageUrl && <img src={food.imageUrl} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={(event) => { event.currentTarget.style.display = 'none' }} />}</div>
                    <div className="food-library__name"><small>{food.category?.nameVi || (food.kind === 'dish' ? 'Món ăn' : 'Thực phẩm')}</small><h3><button type="button" onClick={() => onOpenDetail(food, items)} aria-label={`Xem chi tiết ${food.name}`}>{food.name}</button></h3></div>
                    <button type="button" className="food-library__icon-button" aria-label={isSaved ? `Bỏ lưu ${food.name}` : `Lưu ${food.name}`} aria-pressed={isSaved} onClick={() => onToggleSaved(food, !isSaved)}><Bookmark size={19} fill={isSaved ? 'currentColor' : 'none'} /></button>
                  </div>
                  <dl className="food-library__nutrients" aria-label={`Dinh dưỡng của ${portionLabel}`}>
                    <div><dt>Năng lượng</dt><dd>{scaledFood.calories !== null ? formatNumber(scaledFood.calories) : '—'} <span>kcal</span></dd></div>
                    <div><dt>Đạm</dt><dd>{scaledFood.protein !== null ? formatDecimal(scaledFood.protein) : '—'} <span>g</span></dd></div>
                    <div><dt>Carb</dt><dd>{scaledFood.carbs !== null ? formatDecimal(scaledFood.carbs) : '—'} <span>g</span></dd></div>
                    <div><dt>Béo</dt><dd>{scaledFood.fat !== null ? formatDecimal(scaledFood.fat) : '—'} <span>g</span></dd></div>
                  </dl>
                  <div className="food-library__actions">
                    <details className="food-library__portion">
                      <summary aria-label={`Chỉnh khẩu phần ${food.name}`}><span>{portionLabel}</span><ChevronDown size={16} /></summary>
                      <div className="food-library__portion-controls">
                        <label htmlFor={`catalog-portion-${food.id}`}>Khẩu phần <output>{formatDecimal(portion)}×</output></label>
                        <input id={`catalog-portion-${food.id}`} type="range" min="0.1" max="5" step="0.1" value={portion} onChange={(event) => updatePortion(food.id, Number(event.target.value))} aria-valuetext={portionLabel} />
                        <div role="group" aria-label={`Chọn nhanh khẩu phần ${food.name}`}>{[0.5, 1, 1.5, 2].map((value) => <button type="button" key={value} onClick={() => updatePortion(food.id, value)} aria-pressed={portion === value}>{formatDecimal(value)}×</button>)}</div>
                      </div>
                    </details>
                    <button type="button" className="food-library__add" onClick={() => void addCatalogFood(food, portion)} disabled={!canAdd || addingFoodId !== null} aria-label={`${actionLabel}: ${food.name}`} title={!canLogCatalogFood(food) ? 'Món còn thiếu kcal hoặc macro' : undefined}>{addingFoodId === food.id ? <LoaderCircle className="nutrition-spin" size={16} /> : <Plus size={16} />}<span>{actionLabel}</span></button>
                  </div>
                  {!canLogCatalogFood(food) && <small className="food-library__missing">Chưa đủ kcal hoặc macro để ghi nhật ký.</small>}
                </article>
              )
            })}
            {catalogState !== 'loading' && catalogState !== 'error' && !filteredItems.length && <div className="food-library__empty"><Search size={26} /><strong>{savedOnly ? 'Chưa có món đã lưu phù hợp' : 'Chưa tìm thấy món phù hợp'}</strong><p>Thử tên ngắn hơn hoặc đổi bộ lọc.</p><button type="button" onClick={resetFilters}>Xem tất cả món</button></div>}
            <div ref={loadMoreSentinelRef} className="nutrition-catalog-load-sentinel" aria-hidden="true" />
          </div>
          {(matchingItems.length > filteredItems.length || catalogHasMore) && <button type="button" className="nutrition-catalog-load-more" disabled={catalogLoadingMore} onClick={() => {
            if (matchingItems.length > filteredItems.length) setVisibleCount((current) => current + renderBatchSize)
            else void loadMoreCatalog()
          }}>{catalogLoadingMore ? <LoaderCircle className="nutrition-spin" size={14} /> : null} {catalogLoadingMore ? 'Đang tải thêm…' : 'Xem thêm món'} <ArrowRight size={14} /></button>}
          <footer className="food-library__footer"><Info size={15} /><span>Dữ liệu tham khảo. Khẩu phần và cách chế biến có thể làm thay đổi giá trị dinh dưỡng.</span></footer>
        </div>
      </section>
    </div>
  )
})

export default FoodCatalogModal
