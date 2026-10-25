import type { PtScheduleWorkspaceV2Result } from '../../services/ptSchedulePublishService'

// Keep recent branch/week workspaces available while an Admin moves between
// locations. Draft edits still replace the entry immediately and the realtime
// draft listener keeps the visible matrix current; this TTL only avoids a full
// cold read during quick A → B → A navigation.
const TTL_MS = 5 * 60_000
const LIMIT = 8
export const WORKSPACE_CACHE_REVALIDATE_MS = 2 * 60_000
type Entry = { value: PtScheduleWorkspaceV2Result; storedAt: number }

/** In-memory only. Keys must include UID, authorization version, branch and week. */
export function createWorkspaceCache(now = Date.now) {
  const entries = new Map<string, Entry>()
  const requests = new Map<string, Promise<PtScheduleWorkspaceV2Result>>()

  const read = (scope: string) => {
    const cached = entries.get(scope)
    if (!cached) return null
    if (now() - cached.storedAt >= TTL_MS) {
      entries.delete(scope)
      return null
    }
    entries.delete(scope)
    entries.set(scope, cached)
    return cached
  }

  const write = (scope: string, value: PtScheduleWorkspaceV2Result) => {
    const cached = entries.get(scope)
    // Rendering a cached branch is not a fresh server read. Also prevent a
    // delayed read from rolling back a newer local command/realtime revision.
    if (cached && (cached.value === value || cached.value.draftRevision > value.draftRevision)) return cached.value
    if (cached?.value.draftRevision === value.draftRevision && (['weeklyViewRevision', 'weeklyViewDirtyGeneration'] as const)
      .some(key => typeof cached.value[key] === 'number' && typeof value[key] === 'number' && value[key]! < cached.value[key]!)) return cached.value
    entries.delete(scope)
    entries.set(scope, { value, storedAt: now() })
    while (entries.size > LIMIT) entries.delete(entries.keys().next().value!)
    return value
  }

  const load = (scope: string, fetch: () => Promise<PtScheduleWorkspaceV2Result>) => {
    const pending = requests.get(scope)
    if (pending) return pending
    // Shared across component remounts and A -> B -> A navigation. Only reads
    // are coalesced; mutation commands always keep their own server validation.
    const request = Promise.resolve().then(fetch).then((value) => write(scope, value)).finally(() => {
      if (requests.get(scope) === request) requests.delete(scope)
    })
    requests.set(scope, request)
    return request
  }

  return { read, write, load }
}

const cache = createWorkspaceCache()
export const readWorkspaceCache = cache.read
export const writeWorkspaceCache = cache.write
export const loadWorkspaceRequest = cache.load
