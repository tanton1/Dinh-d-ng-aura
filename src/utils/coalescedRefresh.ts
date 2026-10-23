export interface CoalescedRefreshState {
  key: string
  queued: boolean
  promise: Promise<void>
}

/** Repeated refresh signals share the pending read and request one follow-up.
 * A signal may follow a mutation, so merely sharing the old read could miss
 * its result. Replacing/clearing the slot cancels queued work for an old scope.
 */
export function runCoalescedRefresh(
  slot: { current: CoalescedRefreshState | null },
  key: string,
  refresh: () => Promise<void>,
): Promise<void> {
  if (slot.current?.key === key) {
    slot.current.queued = true
    return slot.current.promise
  }
  const entry: CoalescedRefreshState = { key, queued: false, promise: Promise.resolve() }
  slot.current = entry
  entry.promise = Promise.resolve().then(async () => {
    try {
      let failed = false
      let failure: unknown
      while (slot.current === entry) {
        entry.queued = false
        try {
          await refresh()
          failed = false
        } catch (error) {
          failed = true
          failure = error
        }
        if (!entry.queued) break
      }
      if (failed) throw failure
    } finally {
      // Release before this async callback settles. A chained .finally would
      // leave a microtask gap where a new signal queues onto a finished loop.
      if (slot.current === entry) slot.current = null
    }
  })
  return entry.promise
}
