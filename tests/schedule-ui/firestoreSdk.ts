export const doc = (_db: unknown, collection: string, id: string) => ({ collection, id })

export const onSnapshot = (reference: { collection: string; id: string }, optionsOrNext: unknown, nextOrError: (snapshot: any) => void, onError?: (error: unknown) => void) => {
  const next = typeof optionsOrNext === 'function' ? optionsOrNext as (snapshot: unknown) => void : nextOrError
  const error = typeof optionsOrNext === 'function' ? nextOrError : onError
  const listeners: Map<string, Set<(snapshot: unknown) => void>> = (window as any).__scheduleListeners ??= new Map()
  const errors: Map<string, Set<(error: unknown) => void>> = (window as any).__scheduleListenerErrors ??= new Map()
  const key = `${reference.collection}/${reference.id}`
  const callbacks = listeners.get(key) || new Set()
  callbacks.add(next)
  listeners.set(key, callbacks)
  const failures = errors.get(key) || new Set()
  if (error) failures.add(error)
  errors.set(key, failures)
  ;(window as any).__emitScheduleSnapshot = function (collection: string, raw: unknown, metadata?: { fromCache: boolean }, id?: string) {
    const details = arguments.length < 3 ? { fromCache: false } : metadata
    for (const [path, handlers] of listeners) {
      if (path.startsWith(`${collection}/`) && (!id || path === `${collection}/${id}`)) {
        for (const handler of handlers) handler({ exists: () => raw !== null, data: () => raw, metadata: details })
      }
    }
  }
  ;(window as any).__failScheduleListener = (collection: string) => {
    for (const [path, handlers] of errors) {
      if (path.startsWith(`${collection}/`)) for (const handler of handlers) handler({ code: 'permission-denied' })
    }
  }
  // Queue delivery, as Firestore does, after React has registered the scope.
  if (reference.collection === 'ptScheduleWeeklyViews' && (window as any).__initialWeeklySnapshot) {
    queueMicrotask(async () => {
      if (!callbacks.has(next)) return
      const mode = (window as any).__initialWeeklySnapshot
      if (mode === 'denied') { error?.({ code: 'permission-denied' }); return }
      const { weeklyViewFixture } = await import('./service')
      if (!callbacks.has(next)) return
      const [branchId, weekId] = reference.id.split('_')
      const raw = mode === 'missing' ? null : weeklyViewFixture({ branchId, weekId })
      next({ exists: () => raw !== null, data: () => raw, metadata: { fromCache: mode === 'cache' } })
    })
  }
  return () => { callbacks.delete(next); if (error) failures.delete(error) }
}
