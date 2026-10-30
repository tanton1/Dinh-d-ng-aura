'use strict'

const { createHash, randomUUID } = require('node:crypto')
const { Timestamp } = require('firebase-admin/firestore')
const { HttpsError } = require('firebase-functions/v2/https')

const CACHE_COLLECTION = 'systemOperationsDashboardCache'
const SHARED_CACHE_TTL_MS = 3 * 60_000
const CACHE_SCHEMA_VERSION = 3
const BUILD_LEASE_MS = 60_000
const BUILD_WAIT_DELAYS_MS = [200, 400, 800, 1600, 2000, 2000, 1000]

function stableDashboardCacheKey({ actor, permissions, scope, startDate, endDate, startAt = startDate, endAt = endDate, today = '' }) {
  const administrator = actor.accessRole === 'admin' || actor.accessRole === 'super_admin'
  const audience = administrator
    ? 'operations-admin'
    : `actor:${actor.uid}:${actor.authzVersion || 0}`
  const permissionFingerprint = Object.entries(permissions)
    .filter(([, enabled]) => enabled === true)
    .map(([name]) => name)
    .sort()
    .join(',')
  const material = JSON.stringify({
    schemaVersion: CACHE_SCHEMA_VERSION,
    audience,
    permissionFingerprint,
    branchId: scope.branchId,
    branchIds: [...scope.branchIds].sort(),
    unrestricted: scope.unrestricted,
    startDate,
    endDate,
    startAt,
    endAt,
    today,
    actorScope: administrator ? null : { legacyStaffId: actor.legacyStaffId || actor.uid, capabilities: [...(actor.capabilities || [])].sort() },
  })
  return createHash('sha256').update(material).digest('hex')
}

function cacheValue(stored, now) {
  const expiresAtMillis = stored.valueExpiresAt?.toMillis?.() || 0
  if (stored.schemaVersion !== CACHE_SCHEMA_VERSION || expiresAtMillis <= now || !stored.value) return null
  return { ...stored.value, cache: { hit: true, tier: 'shared', ttlSeconds: Math.max(0, Math.ceil((expiresAtMillis - now) / 1000)), expiresAtMillis } }
}

function compareReadTimes(left, right) {
  if (!left || !right || !Number.isFinite(left.seconds) || !Number.isFinite(right.seconds)
      || !Number.isFinite(left.nanoseconds) || !Number.isFinite(right.nanoseconds)) return null
  return left.seconds - right.seconds || left.nanoseconds - right.nanoseconds
}

function createSharedDashboardCache({ db, logger = console, ttlMs = SHARED_CACHE_TTL_MS, buildLeaseMs = BUILD_LEASE_MS, coalesceRefresh = false, now = () => Date.now(), pause = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
  async function get(cacheKey, forceRefresh = false) {
    if (forceRefresh) return null
    try {
      const snapshot = await db.collection(CACHE_COLLECTION).doc(cacheKey).get()
      if (!snapshot.exists) return null
      return cacheValue(snapshot.data() || {}, now())
    } catch (error) {
      logger.warn('operations_dashboard_shared_cache_read_failed', {
        message: error instanceof Error ? error.message : String(error),
      })
      return null
    }
  }

  async function acquire(cacheKey, forceRefresh = false) {
    let refreshReadTime = null
    const cached = await get(cacheKey, forceRefresh)
    if (cached) return { cached }
    const reference = db.collection(CACHE_COLLECTION).doc(cacheKey)
    const token = randomUUID()
    for (let attempt = 0; attempt <= BUILD_WAIT_DELAYS_MS.length; attempt++) {
      const result = await db.runTransaction(async transaction => {
        const snapshot = await transaction.get(reference)
        const stored = snapshot.data() || {}, time = now()
        // Server read times, not instance clocks/publication time, own the
        // refresh fence. A builder can publish after a payment while its source
        // snapshot still predates that payment. Only a source snapshot taken
        // after this refresh's first authoritative read can satisfy it.
        if (coalesceRefresh && forceRefresh && !refreshReadTime) {
          if (compareReadTimes(snapshot.readTime, snapshot.readTime) === null) {
            throw new HttpsError('unavailable', 'Không thể xác minh thời điểm cập nhật báo cáo. Vui lòng thử lại.')
          }
          refreshReadTime = snapshot.readTime
        }
        const readOrder = compareReadTimes(stored.valueSourceReadTime, refreshReadTime)
        const joinedRefresh = coalesceRefresh && readOrder !== null && readOrder >= 0
        const fresh = (!forceRefresh || joinedRefresh) && cacheValue(stored, time)
        if (fresh) return { cached: fresh }
        if ((!forceRefresh || coalesceRefresh) && stored.leaseUntil?.toMillis?.() > time) return null
        // An explicit refresh supersedes an earlier builder. Its token fences
        // the earlier result even if that worker finishes later on another region.
        transaction.set(reference, {
          schemaVersion: CACHE_SCHEMA_VERSION, leaseToken: token,
          leaseUntil: Timestamp.fromMillis(time + buildLeaseMs),
          // Retention expiry must not extend the freshness of a retained value.
          // Existing TTL/pruning cannot delete this live lease during its build.
          expiresAt: Timestamp.fromMillis(time + Math.max(ttlMs, buildLeaseMs + 1000)),
        }, { merge: true })
        return { lease: { token, cacheKey, startedAt: snapshot.readTime || null } }
      })
      if (result) return result
      if (attempt < BUILD_WAIT_DELAYS_MS.length) await pause(BUILD_WAIT_DELAYS_MS[attempt])
    }
    throw new HttpsError('unavailable', 'Báo cáo đang được cập nhật. Vui lòng thử lại sau ít giây.')
  }

  async function publish(cacheKey, value, lease, { sourceReadTime = lease?.startedAt } = {}) {
    if (!lease?.token || lease.cacheKey !== cacheKey) throw new Error('Dashboard cache lease does not match its scope.')
    const sourceOrder = compareReadTimes(sourceReadTime, lease.startedAt)
    if (coalesceRefresh && (sourceOrder === null || sourceOrder < 0)) {
      throw new Error('Reporting cache publication requires a source snapshot taken after its lease was acquired.')
    }
    const reference = db.collection(CACHE_COLLECTION).doc(cacheKey)
    return db.runTransaction(async transaction => {
      const snapshot = await transaction.get(reference), stored = snapshot.data() || {}, time = now()
      if (stored.leaseToken !== lease.token || !(stored.leaseUntil?.toMillis?.() > time)) return false
      transaction.set(reference, {
        schemaVersion: CACHE_SCHEMA_VERSION, value, createdAt: Timestamp.fromMillis(time),
        ...(sourceReadTime ? { valueSourceReadTime: sourceReadTime } : {}),
        valueExpiresAt: Timestamp.fromMillis(time + ttlMs), expiresAt: Timestamp.fromMillis(time + ttlMs),
        leaseToken: null, leaseUntil: null,
      })
      return true
    })
  }

  async function release(cacheKey, lease) {
    if (!lease?.token || lease.cacheKey !== cacheKey) return
    try {
      const reference = db.collection(CACHE_COLLECTION).doc(cacheKey)
      await db.runTransaction(async transaction => {
        const snapshot = await transaction.get(reference)
        if (snapshot.data()?.leaseToken === lease.token) transaction.set(reference, { leaseToken: null, leaseUntil: null }, { merge: true })
      })
    } catch {
      // An abandoned lease is bounded; never clear another builder or mask the
      // original source error. The existing retention policy removes the record.
      logger.warn('operations_dashboard_build_release_failed', { cacheKey })
    }
  }

  return { get, acquire, publish, release }
}

async function pruneExpiredDashboardCache({ db, logger = console, limit = 250 }) {
  const snapshot = await db.collection(CACHE_COLLECTION)
    .where('expiresAt', '<=', Timestamp.now())
    .limit(Math.max(1, Math.min(500, limit)))
    .get()
  if (snapshot.empty) return { deleted: 0 }
  const batch = db.batch()
  snapshot.docs.forEach((item) => batch.delete(item.ref))
  await batch.commit()
  logger.info('operations_dashboard_shared_cache_pruned', { deleted: snapshot.size })
  return { deleted: snapshot.size }
}

module.exports = {
  CACHE_COLLECTION,
  CACHE_SCHEMA_VERSION,
  BUILD_LEASE_MS,
  BUILD_WAIT_DELAYS_MS,
  SHARED_CACHE_TTL_MS,
  stableDashboardCacheKey,
  createSharedDashboardCache,
  pruneExpiredDashboardCache,
}
