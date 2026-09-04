import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft, ArrowRight, Bookmark, CheckCircle2, ChevronDown, CircleAlert,
  Droplet, Egg, Info, LayoutGrid, Leaf, LoaderCircle, MapPin, Plus, RefreshCw,
  Rows2, Columns2, Search, ShieldCheck, Utensils, Wheat, X,
} from 'lucide-react'
import { useDebounce } from '../../hooks/useDebounce'
import NutritionGroupIcon from '../../components/NutritionGroupIcon'
import type { NutritionFoodCatalogItem } from '../../features/nutrition/types'
import { normalizeNutritionSearch as normalizeSearch } from '../../features/nutrition/routing'
import { loadNutritionCatalogPage, resetNutritionCatalog, scaleOptionalNumber } from '../../features/nutrition/catalog'
import { useAccessibleDialog } from '../../features/nutrition/useAccessibleDialog'

const DEMO_CATALOG: NutritionFoodCatalogItem[] = [
  { id: 'demo-pho-bo', code: 'MA-001', name: 'Phở bò', servingGrams: 500, calories: 394, protein: 26.8, carbs: 51.4, fat: 9.1, source: 'Viện Dinh dưỡng' },
  { id: 'demo-com-trang', code: 'TP-001', name: 'Cơm trắng', servingGrams: 100, calories: 130, protein: 2.7, carbs: 28.2, fat: 0.3, source: 'Viện Dinh dưỡng' },
  { id: 'demo-uc-ga', code: 'TP-002', name: 'Ức gà chín', servingGrams: 100, calories: 165, protein: 31, carbs: 0, fat: 3.6, source: 'Dữ liệu minh họa' },
  { id: 'demo-banh-mi-trung', code: 'MA-002', name: 'Bánh mì trứng', servingGrams: 180, calories: 385, protein: 17, carbs: 44, fat: 16, source: 'Dữ liệu minh họa' },
  { id: 'demo-ca-hoi', code: 'TP-003', name: 'Cá hồi áp chảo', servingGrams: 100, calories: 208, protein: 22, carbs: 0, fat: 13, source: 'Dữ liệu minh họa' },
  { id: 'demo-khoai-lang', code: 'TP-004', name: 'Khoai lang luộc', servingGrams: 100, calories: 86, protein: 1.6, carbs: 20.1, fat: 0.1, source: 'Dữ liệu minh họa' },
]

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

const FoodCatalogModal = React.memo(function FoodCatalogModal({ catalog, savedFoodIds, initialSavedOnly = false, allowDemo = false, onClose, onAdd, onOpenDetail, onToggleSaved, presentation = 'modal' }: { catalog?: NutritionFoodCatalogItem[]; savedFoodIds?: Set<string>; initialSavedOnly?: boolean; allowDemo?: boolean; onClose: () => void; onAdd: (food: NutritionFoodCatalogItem, multiplier: number) => void | Promise<void>; onOpenDetail: (food: NutritionFoodCatalogItem, catalog: NutritionFoodCatalogItem[]) => void; onToggleSaved: (food: NutritionFoodCatalogItem, saved: boolean) => void; presentation?: 'modal' | 'page' }) {
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
  const [layoutMode, setLayoutMode] = useState<'single' | 'grid'>(() => {
    try {
      const savedLayout = window.localStorage.getItem('aura:nutrition:catalog-layout')
      if (savedLayout === 'single' || savedLayout === 'grid') return savedLayout
    } catch {
      // A blocked storage surface should not prevent the catalog from opening.
    }
    return window.matchMedia('(max-width: 760px)').matches ? 'single' : 'grid'
  })
  const [portionById, setPortionById] = useState<Record<string, number>>({})
  const [addingFoodId, setAddingFoodId] = useState<string | null>(null)
  const dialogRef = useAccessibleDialog(onClose)
  const catalogListRef = useRef<HTMLDivElement>(null)
  const loadMoreSentinelRef = useRef<HTMLDivElement>(null)
  const catalogRequestGenerationRef = useRef(0)
  const catalogLoadingMoreRef = useRef(false)

  const setLayout = (layout: 'single' | 'grid') => {
    setLayoutMode(layout)
    try {
      window.localStorage.setItem('aura:nutrition:catalog-layout', layout)
    } catch {
      // Keep the in-memory choice when localStorage is unavailable.
    }
  }

  const updatePortion = (foodId: string, value: number) => {
    const nextValue = Math.min(5, Math.max(0, Math.round(value * 10) / 10))
    setPortionById((current) => ({ ...current, [foodId]: nextValue }))
  }

  const addCatalogFood = async (food: NutritionFoodCatalogItem, multiplier: number) => {
    setAddingFoodId(food.id)
    try {
      await onAdd(scaleCatalogFood(food, multiplier), multiplier)
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
    const serverFilteredQuery = !catalog?.length && catalogState === 'live'
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

  return (
    <div className={presentation === 'page' ? 'nutrition-route-page nutrition-route-page--catalog' : 'nutrition-modal-backdrop'} role="presentation" onMouseDown={(event) => presentation === 'modal' && event.target === event.currentTarget && onClose()}>
      <section ref={presentation === 'modal' ? dialogRef : undefined} className={`nutrition-catalog-modal ${presentation === 'page' ? 'nutrition-catalog-modal--page' : ''}`} role={presentation === 'modal' ? 'dialog' : 'region'} aria-modal={presentation === 'modal' ? true : undefined} aria-labelledby="nutrition-catalog-title" data-testid="nutrition-food-search-modal">
        <header className="nutrition-scan-modal__header">
          <div><h2 id="nutrition-catalog-title">Món ăn & thực phẩm</h2>
            <div className="nutrition-catalog-verified">
              <ShieldCheck size={16} className="icon-shield" />
              <span>Dữ liệu tham khảo về món ăn và thực phẩm<br />Kcal và dinh dưỡng phụ thuộc khẩu phần thực tế</span>
            </div>
          </div>
          <button type="button" className="nutrition-close-button" onClick={onClose} aria-label={presentation === 'page' ? 'Quay lại trang dinh dưỡng' : 'Đóng'}>{presentation === 'page' ? <ArrowLeft size={20} /> : <X size={20} />}</button>
        </header>
        <div className="nutrition-catalog-body">
          <label className="nutrition-catalog-search">
            <Search size={18} />
            <input autoFocus={presentation === 'modal'} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tìm tên món, mã, nhóm hoặc nguyên liệu..." data-testid="nutrition-food-search-input" />
            <span className="search-result-count" title={`Phiên bản Catalog: ${catalogVersion || 'chưa xác định'}`}>
              {formatNumber(items.length)} / {formatNumber(catalogFilteredCount)} đã tải · {formatNumber(catalogTotalCount)} toàn Catalog
            </span>
          </label>
          <div className="nutrition-catalog-filters" aria-label="Lọc danh mục">
            <div className="nutrition-catalog-kind-filter">
              <button type="button" className={kindFilter === 'all' ? 'active' : ''} onClick={() => setKindFilter('all')} aria-pressed={kindFilter === 'all'}>
                <LayoutGrid size={15} /> Tất cả
              </button>
              <button type="button" className={kindFilter === 'dish' ? 'active' : ''} onClick={() => setKindFilter('dish')} aria-pressed={kindFilter === 'dish'}>
                <Utensils size={15} /> Món ăn
              </button>
              <button type="button" className={kindFilter === 'food' ? 'active' : ''} onClick={() => setKindFilter('food')} aria-pressed={kindFilter === 'food'}>
                <Leaf size={15} /> Thực phẩm
              </button>
              <button type="button" className={`nutrition-catalog-saved-filter ${savedOnly ? 'active' : ''}`} onClick={() => setSavedOnly((current) => !current)} aria-pressed={savedOnly}>
                <Bookmark size={15} /> Đã lưu
              </button>
            </div>
            <label className="nutrition-category-dropdown">
              <span>Nhóm</span>
              <div className="dropdown-wrapper">
                <select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}>
                  <option value="all">Tất cả nhóm</option>
                  {catalogCategories.map((category) => <option value={category} key={category}>{category}</option>)}
                </select>
                <ChevronDown size={16} className="dropdown-icon" />
              </div>
            </label>
            <div className="nutrition-catalog-verified-status">
              <CheckCircle2 size={15} className="icon-check" />
              <span>Dữ liệu được cập nhật từ Viện Dinh dưỡng Quốc gia</span>
            </div>
          </div>
          <div className={`nutrition-catalog-status nutrition-catalog-status--${catalogState}`}>
            {catalogState === 'loading' ? <LoaderCircle size={15} className="nutrition-spinner" /> : catalogState === 'error' ? <CircleAlert size={15} /> : null}
            <span>{catalogState === 'loading' ? 'Đang tải Catalog dinh dưỡng…' : catalogState === 'error' ? 'Không tải được Catalog dinh dưỡng. Hãy thử lại sau.' : ''}</span>
            {catalogState === 'error' && <button type="button" onClick={retryCatalog}><RefreshCw size={14} /> Thử lại</button>}
          </div>
          <div ref={catalogListRef} className={`nutrition-catalog-list nutrition-catalog-list--${layoutMode}`} data-layout={layoutMode}>
            {filteredItems.map((food) => {
              const portion = portionById[food.id] ?? 1
              const scaledFood = scaleCatalogFood(food, portion)
              const canAdd = portion > 0 && canLogCatalogFood(food)
              const portionLabel = food.servingGrams !== null
                ? `${formatDecimal(portion)} suất theo nguồn`
                : `${formatDecimal(portion)} suất theo nguồn`
              
              const isSaved = savedFoodIds?.has(food.id)
              
              return (
                <article className="nutrition-catalog-card" key={food.id}>
                  <div className="catalog-card-top-row">
                    <div className="catalog-card-image-box">
                      <span className="nutrition-catalog-card__media">
                        <NutritionGroupIcon categoryName={food.category?.nameVi} kind={food.kind ?? 'food'} size={28} className="nutrition-catalog-card__placeholder" />
                        {food.imageUrl && <img src={food.imageUrl} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={(event) => { event.currentTarget.style.display = 'none' }} />}
                      </span>
                      <div className="catalog-card-calories-badge">{scaledFood.calories !== null ? formatNumber(scaledFood.calories) : '—'} kcal</div>
                    </div>
                    
                    <div className="catalog-card-info-box">
                      <div className="catalog-card-header">
                        <span className="catalog-card-category">{food.kind === 'dish' ? 'MÓN ĂN' : food.kind === 'food' ? 'THỰC PHẨM' : 'DỮ LIỆU'} {food.category?.nameVi ? `· ${food.category.nameVi.toUpperCase()}` : ''}</span>
                        <button type="button" className={`catalog-card-bookmark ${isSaved ? 'saved' : ''}`} aria-label={isSaved ? `Bỏ lưu ${food.name}` : `Lưu ${food.name}`} aria-pressed={isSaved} onClick={() => onToggleSaved(food, !isSaved)}><Bookmark size={18} fill={isSaved ? 'currentColor' : 'none'} /></button>
                      </div>
                      
                      <button type="button" className="catalog-card-title-btn" onClick={() => onOpenDetail(food, items)} aria-label={`Xem chi tiết ${food.name}`}>
                        <h3 className="catalog-card-title">{food.name}</h3>
                      </button>
                      {food.region?.nameVi && <span className="catalog-card-location"><MapPin size={12} /> {food.region.nameVi}</span>}
                    </div>
                  </div>

                  <div className="catalog-card-summary-box">
                    <div className="catalog-summary-item">
                      <small>Khẩu phần</small>
                      <strong>{portionLabel}</strong>
                    </div>
                    <div className="catalog-summary-item align-right">
                      <small>Năng lượng</small>
                      <strong className="calories-text">{scaledFood.calories !== null ? formatNumber(scaledFood.calories) : '—'} <span>kcal</span></strong>
                    </div>
                  </div>

                  <div className="catalog-card-macros-box" aria-label={`Dinh dưỡng của ${portionLabel}`}>
                    <div className="macro-pill macro-protein">
                      <div className="macro-icon"><Egg size={15} /></div>
                      <div className="macro-texts">
                        <small>Đạm</small>
                        <strong>{scaledFood.protein !== null ? `${formatDecimal(scaledFood.protein)}g` : '—'}</strong>
                      </div>
                    </div>
                    <div className="macro-pill macro-carbs">
                      <div className="macro-icon"><Wheat size={15} /></div>
                      <div className="macro-texts">
                        <small>Carb</small>
                        <strong>{scaledFood.carbs !== null ? `${formatDecimal(scaledFood.carbs)}g` : '—'}</strong>
                      </div>
                    </div>
                    <div className="macro-pill macro-fat">
                      <div className="macro-icon"><Droplet size={15} /></div>
                      <div className="macro-texts">
                        <small>Chất béo</small>
                        <strong>{scaledFood.fat !== null ? `${formatDecimal(scaledFood.fat)}g` : '—'}</strong>
                      </div>
                    </div>
                  </div>

                  <div className="catalog-card-slider-box">
                    <div className="catalog-slider-header">
                      <label htmlFor={`catalog-portion-${food.id}`}>Khẩu phần</label>
                      <output htmlFor={`catalog-portion-${food.id}`}>{formatDecimal(portion)}x</output>
                    </div>
                    <input className="catalog-slider-input" id={`catalog-portion-${food.id}`} type="range" min="0" max="5" step="0.1" value={portion} onChange={(event) => updatePortion(food.id, Number(event.target.value))} aria-valuetext={portionLabel} />
                  </div>

                  <div className="catalog-card-actions-box">
                    <div className="catalog-quick-portions" role="group" aria-label={`Chọn nhanh khẩu phần ${food.name}`}>
                      {[0.5, 1, 1.5, 2].map((value) => <button type="button" key={value} className={portion === value ? 'active' : ''} onClick={() => updatePortion(food.id, value)} aria-pressed={portion === value}>{formatDecimal(value)}x</button>)}
                    </div>
                    
                    <button type="button" className="catalog-add-btn" onClick={() => addCatalogFood(food, portion)} disabled={!canAdd || addingFoodId !== null} title={!canLogCatalogFood(food) ? 'Bản ghi nguồn còn thiếu kcal hoặc macro để thêm an toàn' : portion === 0 ? 'Hãy chọn khẩu phần lớn hơn 0' : undefined}>
                      {addingFoodId === food.id ? <LoaderCircle className="nutrition-spin" size={16} /> : <Plus size={16} />} Thêm món
                    </button>
                  </div>
                </article>
              )
            })}
            {catalogState !== 'loading' && catalogState !== 'error' && !filteredItems.length && <div className="nutrition-catalog-empty"><Search size={25} /><strong>Không tìm thấy món phù hợp</strong><span>Thử tên ngắn hơn hoặc bỏ dấu tiếng Việt.</span></div>}
            <div ref={loadMoreSentinelRef} className="nutrition-catalog-load-sentinel" aria-hidden="true" />
          </div>
          {(catalogLoadingMore || (catalogState === 'live' && (catalogHasMore || matchingItems.length > filteredItems.length))) && <div className="nutrition-catalog-progress" role="status" aria-live="polite">
            {catalogLoadingMore ? <LoaderCircle className="nutrition-spin" size={14} /> : null}
            <span>{catalogLoadingMore ? 'Đang tải thêm món…' : 'Cuộn xuống để tải tiếp'}</span>
          </div>}
          {(matchingItems.length > filteredItems.length || catalogHasMore) && <button type="button" className="nutrition-catalog-load-more" disabled={catalogLoadingMore} onClick={() => {
            if (matchingItems.length > filteredItems.length) setVisibleCount((current) => current + renderBatchSize)
            else void loadMoreCatalog()
          }}>{catalogLoadingMore ? <LoaderCircle className="nutrition-spin" size={14} /> : null} {matchingItems.length > filteredItems.length ? `Hiển thị thêm ${Math.min(renderBatchSize, matchingItems.length - filteredItems.length)} kết quả` : 'Tải thêm món từ Catalog'} <ArrowRight size={14} /></button>}
          <footer className="nutrition-catalog-footer"><Info size={14} /><span>Giá trị dinh dưỡng phụ thuộc khẩu phần và cách chế biến. Hãy kiểm tra lại lượng thực tế trước khi lưu.</span></footer>
        </div>
      </section>
    </div>
  )
})

export default FoodCatalogModal
