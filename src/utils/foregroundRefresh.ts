export interface ForegroundRefresh {
  refresh: (background?: boolean, afterMutation?: boolean) => Promise<void>
  invalidate: () => void
  dispose: () => void
}

/** One read at a time. Timer/resume signals share it; a mutation can request
 * one fresh follow-up and invalidate a response started before that mutation. */
export function createForegroundRefresh(
  read: (background: boolean, isCurrent: () => boolean) => Promise<void>,
  available: () => boolean,
): ForegroundRefresh {
  let disposed = false
  let generation = 0
  let queued = false
  let pending: Promise<void> | null = null
  const refresh = (background = true, afterMutation = false): Promise<void> => {
    if (disposed) return Promise.resolve()
    // A mutation can finish just after connectivity or visibility changes.
    // Invalidate the older response even while a new read must wait.
    if (afterMutation) { generation++; if (pending) queued = true }
    if (!available()) return pending ?? Promise.resolve()
    if (pending) return pending
    pending = Promise.resolve().then(async () => {
      try {
        do {
          queued = false
          if (disposed || !available()) break
          const version = generation
          await read(background, () => !disposed && version === generation)
          background = true
        } while (queued)
      } finally { pending = null }
    })
    return pending
  }
  return {
    refresh,
    invalidate: () => { generation++ },
    dispose: () => { disposed = true; generation++; queued = false },
  }
}
