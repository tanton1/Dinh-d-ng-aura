export const VISIBLE_READ_POLL_INTERVAL_MS = 30_000

export interface PollingEnvironment {
  canRefresh: () => boolean
  setTimer: (callback: () => void, milliseconds: number) => unknown
  clearTimer: (timer: unknown) => void
  onResume: (callback: () => void) => () => void
}

function browserEnvironment(): PollingEnvironment {
  return {
    canRefresh: () => !document.hidden && navigator.onLine !== false,
    setTimer: (callback, milliseconds) => window.setTimeout(callback, milliseconds),
    clearTimer: (timer) => window.clearTimeout(timer as number),
    onResume: (callback) => {
      document.addEventListener('visibilitychange', callback)
      window.addEventListener('online', callback)
      return () => {
        document.removeEventListener('visibilitychange', callback)
        window.removeEventListener('online', callback)
      }
    },
  }
}

/** One pending read per poller, with the delay starting after it settles.
 * Screens own error presentation; a failed background read must not spin.
 * No result cache: opening a tab again requests current server data.
 */
export function startVisiblePolling(
  refresh: () => Promise<unknown> | void,
  { immediate = false, environment = browserEnvironment() }: { immediate?: boolean; environment?: PollingEnvironment } = {},
): () => void {
  let stopped = false
  let pending = false
  let timer: unknown
  const schedule = () => {
    if (!stopped) timer = environment.setTimer(() => { void run() }, VISIBLE_READ_POLL_INTERVAL_MS)
  }
  const run = async () => {
    if (stopped || pending) return
    environment.clearTimer(timer)
    if (!environment.canRefresh()) { schedule(); return }
    pending = true
    try {
      await refresh()
    } catch {
      // The caller renders its own failure and keeps its last usable snapshot.
    } finally {
      pending = false
      schedule()
    }
  }
  const unsubscribe = environment.onResume(() => { void run() })
  if (immediate) void run()
  else schedule()
  return () => {
    stopped = true
    environment.clearTimer(timer)
    unsubscribe()
  }
}
