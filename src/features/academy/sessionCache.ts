export interface AcademyCacheEntry<T> { value: T; expiresAt: number }

/** Memory only. A scope represents one authenticated session and access state. */
export function createAcademySessionCache<T>(options: { ttlMs: number; maxEntries: number; maxBytes: number; now?: () => number }) {
  if (![options.ttlMs, options.maxEntries, options.maxBytes].every((value) => Number.isSafeInteger(value) && value > 0)) throw new Error('Invalid Academy cache limits')
  const now = options.now ?? Date.now
  let session: object | null = null
  let access = ''
  let epoch = 0
  let totalBytes = 0
  const entries = new Map<string, AcademyCacheEntry<T> & { bytes: number }>()
  const pending = new Map<string, Promise<AcademyCacheEntry<T>>>()
  const stale = () => Object.assign(new Error('Phiên học hoặc quyền truy cập đã thay đổi. Hãy mở lại chương.'), { code: 'academy/cache-scope-changed' })
  const remove = (key: string) => { const entry = entries.get(key); if (entry) totalBytes -= entry.bytes; entries.delete(key) }
  const clear = () => { epoch += 1; entries.clear(); pending.clear(); totalBytes = 0 }
  const setScope = (nextSession: object | null, nextAccess: string) => {
    if (session === nextSession && access === nextAccess) return
    clear(); session = nextSession; access = nextAccess
  }
  const copy = (entry: AcademyCacheEntry<T>): AcademyCacheEntry<T> => ({ value: structuredClone(entry.value), expiresAt: entry.expiresAt })
  const peek = (key: string) => {
    const entry = entries.get(key)
    if (!session || !entry) return undefined
    if (entry.expiresAt <= now()) { remove(key); return undefined }
    entries.delete(key); entries.set(key, entry)
    return copy(entry)
  }
  const read = async (key: string, load: () => Promise<T>): Promise<AcademyCacheEntry<T>> => {
    if (!session) throw stale()
    const ready = peek(key)
    if (ready) return ready
    const currentEpoch = epoch
    let operation = pending.get(key)
    if (!operation) {
      operation = Promise.resolve().then(() => { if (epoch !== currentEpoch || !session) throw stale(); return load() }).then((value) => {
        if (epoch !== currentEpoch || !session) throw stale()
        const entry = { value: structuredClone(value), expiresAt: now() + options.ttlMs }
        const bytes = new TextEncoder().encode(JSON.stringify(value)).byteLength
        for (const [candidate, cached] of entries) if (cached.expiresAt <= now()) remove(candidate)
        if (bytes <= options.maxBytes) {
          remove(key)
          while (entries.size >= options.maxEntries || totalBytes + bytes > options.maxBytes) remove(entries.keys().next().value!)
          entries.set(key, { ...entry, bytes }); totalBytes += bytes
        }
        return entry
      }).finally(() => { if (pending.get(key) === operation) pending.delete(key) })
      pending.set(key, operation)
    }
    const result = await operation
    if (epoch !== currentEpoch || !session) throw stale()
    return copy(result)
  }
  return { setScope, peek, read, clear, remove, matchesScope: (expectedSession: object, expectedAccess: string) => session === expectedSession && access === expectedAccess,
    size: () => entries.size, bytes: () => totalBytes }
}
