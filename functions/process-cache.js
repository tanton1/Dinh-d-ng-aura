'use strict'

/**
 * Small process-local cache for Firestore-bound callables.
 *
 * It intentionally only provides short-lived read-through caching and
 * in-flight request coalescing. Firestore remains the source of truth; a
 * process restart or TTL expiry simply results in a normal read. Keeping this
 * helper independent makes it safe to use in both production Functions and
 * the lightweight unit-test fakes used by this repository.
 */
function createProcessCache({ ttlMs = 5_000, maxEntries = 256 } = {}) {
  const entries = new Map()
  const pending = new Map()

  function trim() {
    while (entries.size > maxEntries) entries.delete(entries.keys().next().value)
  }

  function clear(prefix = '') {
    if (!prefix) {
      entries.clear()
      pending.clear()
      return
    }
    for (const key of entries.keys()) if (key.startsWith(prefix)) entries.delete(key)
    for (const key of pending.keys()) if (key.startsWith(prefix)) pending.delete(key)
  }

  async function get(key, loader, customTtlMs = ttlMs) {
    const now = Date.now()
    const cached = entries.get(key)
    if (cached && cached.expiresAt > now) {
      entries.delete(key)
      entries.set(key, cached)
      return { value: cached.value, hit: true }
    }
    if (cached) entries.delete(key)
    const current = pending.get(key)
    if (current) return { value: await current, hit: false, coalesced: true }

    const request = Promise.resolve().then(loader).then((value) => {
      entries.set(key, { value, expiresAt: Date.now() + Math.max(0, customTtlMs) })
      trim()
      return value
    }).finally(() => {
      if (pending.get(key) === request) pending.delete(key)
    })
    pending.set(key, request)
    return { value: await request, hit: false }
  }

  return { get, clear, entries, pending }
}

const objectIdentity = new WeakMap()
let nextObjectIdentity = 1

/**
 * Return a stable process-local identity for a Firestore client (or test
 * double). Cache keys must include this value because a Functions process can
 * serve more than one database client in tests and during migrations.
 */
function cacheScope(value) {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) return String(value || 'default')
  if (!objectIdentity.has(value)) objectIdentity.set(value, `scope-${nextObjectIdentity++}`)
  return objectIdentity.get(value)
}

module.exports = { cacheScope, createProcessCache }
