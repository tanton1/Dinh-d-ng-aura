import { useCallback, useEffect, useRef, useState } from 'react'

/** Reads belong to a single visible dashboard panel, with no settled-result TTL. */
export function useStaffDashboardPanel<T>({ scopeKey, enabled, autoLoad = true, read, errorMessage }: {
  scopeKey: string
  enabled: boolean
  autoLoad?: boolean
  read: () => Promise<T>
  errorMessage: string
}) {
  const [state, setState] = useState<{ key: string; value: T | null; loading: boolean; started: boolean; error: string }>({
    key: scopeKey, value: null, loading: enabled && autoLoad, started: false, error: '',
  })
  const currentScope = useRef(scopeKey)
  const currentEnabled = useRef(enabled)
  const readRef = useRef(read)
  const mounted = useRef(false)
  const pending = useRef<{ key: string; promise: Promise<void> } | null>(null)
  currentScope.current = scopeKey
  currentEnabled.current = enabled
  readRef.current = read

  // The pending request survives React's effect replay, but an unmounted panel
  // or a changed month/day cannot accept its result.
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  const refresh = useCallback((): Promise<void> => {
    if (!enabled) return Promise.resolve()
    if (pending.current?.key === scopeKey) return pending.current.promise
    const loader = readRef.current
    const current = () => mounted.current && currentEnabled.current && currentScope.current === scopeKey && pending.current?.promise === promise
    setState((previous) => ({ key: scopeKey, value: previous.key === scopeKey ? previous.value : null, loading: true, started: true, error: '' }))
    const promise = Promise.resolve().then(() => {
      if (!current()) throw new Error('Dashboard panel scope changed before the read started.')
      return loader()
    })
      .then((value) => { if (current()) setState({ key: scopeKey, value, loading: false, started: true, error: '' }) })
      .catch((cause: unknown) => {
        if (current()) setState((previous) => ({ ...previous, loading: false, error: cause instanceof Error ? cause.message : errorMessage }))
      })
      .finally(() => { if (pending.current?.promise === promise) pending.current = null })
    pending.current = { key: scopeKey, promise }
    return promise
  }, [enabled, errorMessage, scopeKey])

  useEffect(() => { if (enabled && autoLoad) void refresh() }, [autoLoad, enabled, refresh])

  const sameScope = state.key === scopeKey
  return {
    value: enabled && sameScope ? state.value : null,
    error: enabled && sameScope ? state.error : '',
    loading: enabled && (sameScope ? state.loading : autoLoad),
    started: enabled && sameScope && state.started,
    refresh,
  }
}

/** Preserve the dashboard cards while loading their expensive data only when seen. */
export function useStaffDashboardPanelVisibility() {
  const ref = useRef<HTMLElement>(null)
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    if (visible) return
    if (typeof IntersectionObserver === 'undefined') { setVisible(true); return }
    const element = ref.current
    if (!element) return
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) { setVisible(true); observer.disconnect() }
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [visible])
  return { ref, visible, reveal: () => setVisible(true) }
}
