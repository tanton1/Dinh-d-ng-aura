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
