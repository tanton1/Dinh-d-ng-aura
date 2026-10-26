import { useEffect, useMemo, useRef, useState } from 'react'
import { useDebounce } from '../../hooks/useDebounce'
import { loadNutritionCatalogPage, resetNutritionCatalog, type NutritionCatalogPage } from './catalog'
import { DEMO_CATALOG, DEMO_MENU_DISHES } from './demoCatalog'
import { normalizeNutritionSearch, type MealPlanTab } from './routing'
import type { NutritionFoodCatalogItem } from './types'
import { uniqueCatalogItems } from './catalogPresentation'

export type { MealPlanTab } from './routing'
const PAGE_SIZE = 30
const CACHE_MS = 120_000
const EMPTY: NutritionCatalogPage = { items: [], categories: [], hasMore: false, nextCursor: null, totalCount: 0, catalogTotal: 0, filteredCount: 0, catalogVersion: '' }

/** Preserve the existing menu's loaded pages without mounting inactive readers. */
export function useMealPlanCatalog({ tab, query, category, savedOnly, savedFoodIds, initialCatalog, allowDemo = false, active = true }: {
  tab: MealPlanTab; query: string; category: string; savedOnly: boolean; savedFoodIds: Set<string>
  initialCatalog?: NutritionFoodCatalogItem[]; allowDemo?: boolean; active?: boolean
}) {
  const debouncedQuery = useDebounce(query, 300)
  const kind = tab === 'ingredients' ? 'food' : 'dish'
  const enabled = active && tab !== 'plan' && query === debouncedQuery
  const savedKey = savedOnly ? JSON.stringify([...savedFoodIds].sort()) : ''
  const key = JSON.stringify([kind, normalizeNutritionSearch(debouncedQuery), category, savedKey])
  const [retry, setRetry] = useState(0)
  const [result, setResult] = useState({ key: '', page: EMPTY, status: 'loading' as 'loading' | 'live' | 'demo' | 'error' })
  const [loadingMore, setLoadingMore] = useState(false)
  const [failedMoreKey, setFailedMoreKey] = useState<string | null>(null)
  const cache = useRef(new Map<string, { page: NutritionCatalogPage; expires: number }>())
  const scope = `${enabled}|${key}|${retry}`
  const generation = useRef({ scope, value: 0 })
  if (generation.current.scope !== scope) generation.current = { scope, value: generation.current.value + 1 }
  const moreRequest = useRef<number | null>(null)
  const storePage = (page: NutritionCatalogPage) => {
    cache.current.delete(key)
    if (cache.current.size >= 8) cache.current.delete(cache.current.keys().next().value!)
    cache.current.set(key, { page, expires: Date.now() + CACHE_MS })
  }
  const matches = (food: NutritionFoodCatalogItem) => food.kind === kind
    && (category === 'all' || food.category?.nameVi === category)
    && (!savedOnly || savedFoodIds.has(food.id))
    && normalizeNutritionSearch(debouncedQuery).split(' ').filter(Boolean).every(token => normalizeNutritionSearch(`${food.name} ${food.nameEn ?? ''} ${food.code ?? ''} ${food.category?.nameVi ?? ''}`).includes(token))

  const fetchPage = async (previous?: NutritionCatalogPage): Promise<NutritionCatalogPage> => {
    const ids: string[] | undefined = savedKey ? JSON.parse(savedKey) : undefined
    const offset = previous ? Number(previous.nextCursor) : 0
    if (ids && !ids.length) return { ...EMPTY }
    const page = await loadNutritionCatalogPage({
      kind, query: ids ? '' : debouncedQuery, category: category === 'all' ? '' : category, limit: PAGE_SIZE,
      ...(ids ? { ids: ids.slice(offset, offset + PAGE_SIZE) } : previous ? { cursor: previous.nextCursor!, catalogVersion: previous.catalogVersion } : {}),
    })
    if (!ids) return page
    const hasMore = offset + PAGE_SIZE < ids.length
    return { ...page, items: page.items.filter(matches), hasMore, nextCursor: hasMore ? String(offset + PAGE_SIZE) : null }
  }

  useEffect(() => {
    if (!enabled) return
    let active = true
    const ticket = generation.current.value
    moreRequest.current = null
    setLoadingMore(false)
    setFailedMoreKey(null)
    if (allowDemo || initialCatalog) {
      const source = initialCatalog ?? [...DEMO_MENU_DISHES, ...DEMO_CATALOG.filter(food => food.kind === 'food')]
      const items = uniqueCatalogItems(source.filter(matches))
      setResult({ key, status: allowDemo ? 'demo' : 'live', page: { ...EMPTY, items, filteredCount: items.length, categories: [...new Set(source.filter(food => food.kind === kind).map(food => food.category?.nameVi).filter((value): value is string => Boolean(value)))] } })
      return
    }
    const cached = cache.current.get(key)
    if (cached && cached.expires > Date.now()) {
      setResult({ key, page: cached.page, status: 'live' })
      return
    }
    setResult({ key, page: EMPTY, status: 'loading' })
    void fetchPage().then(page => {
      if (!active || ticket !== generation.current.value) return
      storePage(page)
      setResult({ key, page, status: 'live' })
    }).catch(() => {
      if (active && ticket === generation.current.value) setResult({ key, page: EMPTY, status: 'error' })
    })
    return () => { active = false }
    // All request inputs are encoded in key. Saved toggles outside Saved do not read again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, key, retry, allowDemo, initialCatalog])

  useEffect(() => () => { generation.current.value++ }, [])
  const current = enabled && result.key === key ? result : { key, page: EMPTY, status: 'loading' as const }
  const loadMore = async () => {
    const ticket = generation.current.value
    if (!enabled || result.key !== key || result.status !== 'live' || !result.page.hasMore || !result.page.nextCursor || moreRequest.current === ticket) return
    moreRequest.current = ticket
    setFailedMoreKey(null)
    setLoadingMore(true)
    try {
      const page = await fetchPage(result.page)
      if (ticket !== generation.current.value) return
      const items = [...new Map([...result.page.items, ...page.items].map(food => [food.id, food])).values()]
      const merged = { ...page, items, categories: [...new Set([...result.page.categories, ...page.categories])], ...(savedOnly ? { filteredCount: items.length } : {}) }
      storePage(merged)
      setResult({ key, page: merged, status: 'live' })
    } catch {
      if (ticket === generation.current.value) setFailedMoreKey(key)
    } finally {
      if (ticket === generation.current.value) { moreRequest.current = null; setLoadingMore(false) }
    }
  }
  const reload = () => { cache.current.clear(); resetNutritionCatalog(); setRetry(value => value + 1) }
  const items = useMemo(() => uniqueCatalogItems(current.page.items), [current.page.items])
  return { ...current.page, items, requestKey: scope, status: current.status, loadingMore, loadMoreError: failedMoreKey === key, loadMore, reload }
}
