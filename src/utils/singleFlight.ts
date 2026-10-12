export interface SingleFlightRef<T> {
  current: Promise<T> | null
}

/**
 * Runs at most one copy of an async mutation at a time. Calls made while the
 * mutation is pending receive the same promise, so a fast double click cannot
 * enqueue a second write before React has rendered its disabled state.
 */
export function runSingleFlight<T>(reference: SingleFlightRef<T>, operation: () => Promise<T>): Promise<T> {
  if (reference.current) return reference.current

  const pending = Promise.resolve()
    .then(operation)
    .finally(() => {
      if (reference.current === pending) reference.current = null
    })

  reference.current = pending
  return pending
}

/**
 * Coalesces identical async requests while they are in flight. The registry
 * is intentionally caller-owned so a service can scope its memory to the
 * current browser bundle and clear entries as soon as a request settles.
 */
export function runKeyedSingleFlight<T>(
  registry: Map<string, Promise<T>>,
  key: string,
  operation: () => Promise<T>,
): Promise<T> {
  const existing = registry.get(key)
  if (existing) return existing

  const pending = Promise.resolve()
    .then(operation)
    .finally(() => {
      if (registry.get(key) === pending) registry.delete(key)
    })

  registry.set(key, pending)
  return pending
}
