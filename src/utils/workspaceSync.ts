export interface WorkspaceSyncState {
  version: string
  userVersion: string
  branchVersions: Record<string, string>
  policyVersion: string
}

export type WorkspaceSyncDomain = 'studentSchedule' | 'trainerWorkspace'

export interface WorkspaceSyncEnvironment {
  available: () => boolean
  schedule: (callback: () => void, delay: number) => unknown
  cancel: (timer: unknown) => void
}

export function vietnamDateKey(now = Date.now()) {
  return new Date(now + 7 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

export function millisecondsUntilVietnamMidnight(now = Date.now()) {
  return Date.parse(`${vietnamDateKey(now)}T00:00:00+07:00`) + 86_400_000 - now + 25
}

/** Revision notifications are invalidations, never a periodic refresh loop.
 * A failed/stale attempt waits for a new revision, resume, or explicit retry.
 */
export function createWorkspaceSync(options: {
  refresh: () => Promise<unknown>
  environment: WorkspaceSyncEnvironment
  onAccept?: (state: WorkspaceSyncState) => void
  onError?: (failed: boolean) => void
  onPending?: (pending: boolean) => void
}) {
  const observed = new Map<string, string>()
  let baseline: Map<string, string> | null = null
  let sequence = 0
  let attempted = -1
  let pending = false
  let failed = false
  let stopped = false
  let force = false
  let timer: unknown
  const dirty = () => baseline !== null && [...observed].some(([key, value]) => baseline!.has(key) && value > baseline!.get(key)!)
  const shouldRefresh = () => dirty() || (baseline === null && failed && attempted >= 0 && sequence > attempted)
  const fail = () => { failed = true; options.onError?.(true) }
  const schedule = (delay = 180) => {
    if (stopped || pending || !options.environment.available() || (!force && (!shouldRefresh() || sequence === attempted))) return
    options.environment.cancel(timer)
    timer = options.environment.schedule(() => { void run() }, delay)
  }
  const run = async () => {
    if (stopped || pending || !options.environment.available()) return
    pending = true
    force = false
    attempted = sequence
    failed = false
    try { await options.refresh() } catch { fail() }
    finally {
      pending = false
      if (stopped) return
      // A draft may become dirty while the response is in flight. Its
      // revision stays pending until resume; that is not a transport error.
      if (options.environment.available() && dirty() && sequence === attempted) fail()
      schedule()
    }
  }
  return {
    accept(state: WorkspaceSyncState | undefined) {
      if (stopped) return
      if (!state) { fail(); return }
      baseline = new Map([['user', state.userVersion], ['policy', state.policyVersion], ...Object.entries(state.branchVersions || {}).map(([id, version]) => [`branch:${id}`, version] as const)])
      failed = false
      options.onError?.(false)
      options.onAccept?.(state)
      options.onPending?.(dirty())
      schedule()
    },
    observe(key: string, version: string) {
      if (stopped || (observed.has(key) && observed.get(key)! >= version)) return
      observed.set(key, version)
      sequence += 1
      options.onPending?.(dirty())
      schedule()
    },
    fail,
    retry() { force = true; schedule(0) },
    resume() {
      if (failed) { force = true; options.onError?.(false) }
      // Reattempt a response deliberately held while editing/hidden, even
      // when no second source notification arrives.
      if (dirty()) attempted = -1
      schedule(0)
    },
    stop() { stopped = true; options.environment.cancel(timer) },
  }
}
