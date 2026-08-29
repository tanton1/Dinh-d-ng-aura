'use strict'

const { createHash } = require('node:crypto')
const { Timestamp } = require('firebase-admin/firestore')

const CACHE_COLLECTION = 'systemOperationsDashboardCache'
const SHARED_CACHE_TTL_MS = 3 * 60_000
const CACHE_SCHEMA_VERSION = 1

function stableDashboardCacheKey({ actor, permissions, scope, startDate, endDate }) {
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
  })
  return createHash('sha256').update(material).digest('hex')
}

function cacheTtlSeconds(expiresAtMillis) {
  return Math.max(0, Math.ceil((expiresAtMillis - Date.now()) / 1000))
}

function createSharedDashboardCache({ db, logger = console, ttlMs = SHARED_CACHE_TTL_MS }) {
  async function get(cacheKey, forceRefresh = false) {
    if (forceRefresh) return null
    try {
      const snapshot = await db.collection(CACHE_COLLECTION).doc(cacheKey).get()
      if (!snapshot.exists) return null
      const stored = snapshot.data() || {}
      const expiresAtMillis = stored.expiresAt?.toMillis?.() || 0
      if (stored.schemaVersion !== CACHE_SCHEMA_VERSION || expiresAtMillis <= Date.now() || !stored.value) return null
      return {
        ...stored.value,
        cache: {
          hit: true,
          tier: 'shared',
          ttlSeconds: cacheTtlSeconds(expiresAtMillis),
        },
      }
    } catch (error) {
      logger.warn('operations_dashboard_shared_cache_read_failed', {
        message: error instanceof Error ? error.message : String(error),
      })
      return null
    }
  }

  async function set(cacheKey, value) {
    const now = Date.now()
    try {
      await db.collection(CACHE_COLLECTION).doc(cacheKey).set({
        schemaVersion: CACHE_SCHEMA_VERSION,
        value,
        createdAt: Timestamp.fromMillis(now),
        expiresAt: Timestamp.fromMillis(now + ttlMs),
      })
      return true
    } catch (error) {
      logger.warn('operations_dashboard_shared_cache_write_failed', {
        message: error instanceof Error ? error.message : String(error),
      })
      return false
    }
  }

  return { get, set }
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
  SHARED_CACHE_TTL_MS,
  stableDashboardCacheKey,
  createSharedDashboardCache,
  pruneExpiredDashboardCache,
}
