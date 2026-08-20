export const VERSIONED_CACHE_SCHEMA = 2 as const

export interface VersionedCacheEnvelope<T> {
  schemaVersion: typeof VERSIONED_CACHE_SCHEMA
  ownerId: string
  scope: string
  revision: number
  cachedAt: string
  source: 'firestore-confirmed'
  value: T
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function readVersionedCache<T>(key: string, ownerId: string, scope: string, validate: (value: unknown) => value is T) {
  if (typeof window === 'undefined') return null
  try {
    const parsed = JSON.parse(window.localStorage.getItem(key) ?? 'null') as unknown
    if (!isRecord(parsed)
      || parsed.schemaVersion !== VERSIONED_CACHE_SCHEMA
      || parsed.ownerId !== ownerId
      || parsed.scope !== scope
      || parsed.source !== 'firestore-confirmed'
      || !Number.isSafeInteger(parsed.revision)
      || typeof parsed.cachedAt !== 'string'
      || !Number.isFinite(Date.parse(parsed.cachedAt))
      || !validate(parsed.value)) return null
    return parsed as unknown as VersionedCacheEnvelope<T>
  } catch {
    return null
  }
}

export function writeVersionedCache<T>(key: string, ownerId: string, scope: string, value: T, revision = Date.now()) {
  if (typeof window === 'undefined') return null
  const envelope: VersionedCacheEnvelope<T> = {
    schemaVersion: VERSIONED_CACHE_SCHEMA,
    ownerId,
    scope,
    revision: Number.isSafeInteger(revision) && revision >= 0 ? revision : Date.now(),
    cachedAt: new Date().toISOString(),
    source: 'firestore-confirmed',
    value,
  }
  try {
    window.localStorage.setItem(key, JSON.stringify(envelope))
    return envelope
  } catch {
    return null
  }
}
