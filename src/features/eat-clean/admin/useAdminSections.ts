import { useCallback, useEffect, useRef, useState } from 'react'
import { getEatCleanAdminErrorMessage, listEatCleanAdminSections } from './eatCleanAdminService'
import { DEFAULT_EAT_CLEAN_CONFIG, EAT_CLEAN_ADMIN_SECTIONS, EMPTY_EAT_CLEAN_SUMMARY, type EatCleanAdminData, type EatCleanAdminSection, type EatCleanAdminSnapshot } from './types'

const emptyData = (): EatCleanAdminData => ({ schemaVersion: 1, seeded: true, config: { ...DEFAULT_EAT_CLEAN_CONFIG }, orders: [], meals: [], inventory: [], summary: { ...EMPTY_EAT_CLEAN_SUMMARY } })
interface State {
  data: EatCleanAdminData | null
  loaded: EatCleanAdminSection[]
  pending: EatCleanAdminSection[]
  dirty: EatCleanAdminSection[]
  errors: Partial<Record<EatCleanAdminSection, string>>
  denied: string
  coverage: EatCleanAdminSnapshot['coverage']
}
const emptyState = (): State => ({ data: null, loaded: [], pending: [], dirty: [], errors: {}, denied: '', coverage: {} })

// One instance belongs to the keyed account/role workspace. Partial requests
// share pending sections; per-section generations fence reads across saves.
export function useAdminSections(required: readonly EatCleanAdminSection[], enabled: boolean, isDemo: boolean) {
  const [state, setState] = useState<State>(emptyState)
  const current = useRef(state)
  const alive = useRef(true)
  const sequence = useRef(0)
  const seededGeneration = useRef(0)
  const generations = useRef(new Map<EatCleanAdminSection, number>())
  const requests = useRef(new Map<EatCleanAdminSection, { generation: number; promise: Promise<void> }>())
  const publish = useCallback((update: (value: State) => State) => {
    if (!alive.current) return
    current.current = update(current.current)
    setState(current.current)
  }, [])
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])

  const load = useCallback(async (sections: readonly EatCleanAdminSection[], force = false) => {
    if (!enabled || !alive.current || !sections.length) return
    const needed = sections.filter(section => force || !current.current.loaded.includes(section) || current.current.dirty.includes(section))
    const waiting = [...new Set(needed.flatMap(section => requests.current.has(section) && !force ? [requests.current.get(section)!.promise] : []))]
    const selected = needed.filter(section => force || !requests.current.has(section))
    if (!selected.length) { await Promise.all(waiting); return }
    const generation = ++sequence.current
    selected.forEach(section => generations.current.set(section, generation))
    publish(value => ({ ...value, denied: '', pending: [...new Set([...value.pending, ...selected])], errors: Object.fromEntries(Object.entries(value.errors).filter(([section]) => !selected.includes(section as EatCleanAdminSection))) }))
    const accepted = () => selected.filter(section => generations.current.get(section) === generation)
    const promise = (async () => {
      try {
        const result: EatCleanAdminSnapshot = await (isDemo
          ? Promise.resolve({ ...emptyData(), sections: [...selected], coverage: {} })
          : listEatCleanAdminSections(selected))
        if (!alive.current || !accepted().length) return
        const applicable = accepted()
        const acceptSeeded = generation >= seededGeneration.current
        if (acceptSeeded) seededGeneration.current = generation
        publish(value => {
          const data = { ...(value.data || emptyData()), seeded: acceptSeeded ? result.seeded : (value.data?.seeded ?? result.seeded) }
          for (const section of applicable) {
            if (section === 'orders') { data.orders = result.orders!; data.summary = result.summary! }
            else if (section === 'meals') data.meals = result.meals!
            else if (section === 'inventory') data.inventory = result.inventory!
            else data.config = result.config!
          }
          return { ...value, data, loaded: [...new Set([...value.loaded, ...applicable])], dirty: value.dirty.filter(section => !applicable.includes(section)), coverage: { ...value.coverage, ...Object.fromEntries(applicable.map(section => [section, result.coverage[section]])) } }
        })
      } catch (error) {
        if (!alive.current || !accepted().length) return
        const message = getEatCleanAdminErrorMessage(error)
        if (/(?:permission-denied|unauthenticated)$/.test(String((error as { code?: unknown })?.code || ''))) {
          for (const section of EAT_CLEAN_ADMIN_SECTIONS) generations.current.set(section, ++sequence.current)
          requests.current.clear()
          publish(() => ({ ...emptyState(), denied: message }))
        } else publish(value => ({ ...value, errors: { ...value.errors, ...Object.fromEntries(accepted().map(section => [section, message])) } }))
      } finally {
        for (const section of selected) if (requests.current.get(section)?.generation === generation) requests.current.delete(section)
        publish(value => ({ ...value, pending: [...requests.current.keys()] }))
      }
    })()
    selected.forEach(section => requests.current.set(section, { generation, promise }))
    await Promise.all([...waiting, promise])
  }, [enabled, isDemo, publish])

  const error = state.denied || required.map(section => state.errors[section]).find(Boolean) || ''
  const ready = required.every(section => state.loaded.includes(section))
  const needsLoad = !ready || required.some(section => state.dirty.includes(section))
  const pendingKey = state.pending.join('|')
  useEffect(() => {
    if (enabled && needsLoad && !error) void load(required)
  }, [enabled, needsLoad, pendingKey, error, required, load])

  const invalidate = useCallback((sections: readonly EatCleanAdminSection[]) => {
    for (const section of sections) { generations.current.set(section, ++sequence.current); requests.current.delete(section) }
    seededGeneration.current = sequence.current
    publish(value => ({ ...value, dirty: [...new Set([...value.dirty, ...sections])], pending: [...requests.current.keys()], errors: Object.fromEntries(Object.entries(value.errors).filter(([section]) => !sections.includes(section as EatCleanAdminSection))) }))
  }, [publish])

  const patch = useCallback((sections: readonly EatCleanAdminSection[], update: (value: EatCleanAdminData) => EatCleanAdminData) => {
    for (const section of sections) { generations.current.set(section, ++sequence.current); requests.current.delete(section) }
    seededGeneration.current = sequence.current
    publish(value => ({ ...value, data: value.data ? update(value.data) : null, pending: [...requests.current.keys()] }))
  }, [publish])

  return {
    data: state.data, loading: !ready && !error, refreshing: ready && required.some(section => state.pending.includes(section)), error,
    limited: required.some(section => state.coverage[section]?.limitReached), ready,
    refresh: () => load(required, true), invalidate, patch,
  }
}
