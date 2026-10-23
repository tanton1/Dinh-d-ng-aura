export const doc = (_db: unknown, collection: string, id: string) => ({ collection, id })

export const onSnapshot = (reference: { collection: string; id: string }, next: (snapshot: unknown) => void) => {
  const listeners: Map<string, Set<(snapshot: unknown) => void>> = (window as any).__scheduleListeners ??= new Map()
  const key = `${reference.collection}/${reference.id}`
  const callbacks = listeners.get(key) || new Set()
  callbacks.add(next)
  listeners.set(key, callbacks)
  ;(window as any).__emitScheduleSnapshot = (collection: string, raw: unknown, metadata?: { fromCache: boolean }) => {
    for (const [path, handlers] of listeners) {
      if (path.startsWith(`${collection}/`)) {
        for (const handler of handlers) handler({ exists: () => raw !== null, data: () => raw, metadata })
      }
    }
  }
  return () => { callbacks.delete(next) }
}
