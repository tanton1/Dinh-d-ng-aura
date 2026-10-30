'use strict'

const { FieldPath } = require('firebase-admin/firestore')
const { HttpsError } = require('firebase-functions/v2/https')
const { createSharedDashboardCache } = require('./operations-dashboard-cache')
const { recordOperationMetrics } = require('./operation-metrics')
const { withFunctionTelemetry } = require('./observability')

const OVERVIEW_SCHEMA_VERSION = 1
const OVERVIEW_SCAN_LIMIT = 25_000
const OVERVIEW_PAGE_SIZE = 500
const OVERVIEW_TTL_MS = 60_000
const OVERVIEW_BUILD_LEASE_MS = 60_000
const OVERVIEW_SCAN_DEADLINE_MS = 45_000
const USER_FIELDS = ['role', 'disabled', 'status', 'notificationSettings.enabled', 'notificationSettings.fcmEnabled']
const DEVICE_FIELDS = ['userId', 'enabled', 'token']
const LOG_FIELDS = ['createdAt', 'webPushSentCount', 'webPushFailureCount']
const METRIC_FIELDS = ['activeUsers', 'pushEnabledUsers', 'activeDevices', 'webPushAccepted24h', 'webPushFailures24h']

// Preserve the legacy audience predicate. Missing/empty roles are members;
// administrator/staff profiles are not, and disabled status also excludes one.
function isMemberProfile(profile) {
  const role = profile?.role
  return (role === undefined || role === null || role === '' || role === 'student')
    && profile?.disabled !== true
    && profile?.status !== 'disabled'
}

function pushTimestampToIso(value) {
  if (!value) return null
  try {
    const date = typeof value.toDate === 'function'
      ? value.toDate()
      : value instanceof Date
        ? value
        : new Date(value)
    return date instanceof Date && Number.isFinite(date.getTime()) ? date.toISOString() : null
  } catch { return null }
}

function pushMetric(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0
}

function unknownOverview(reason) {
  return { complete: false, reason, ...Object.fromEntries(METRIC_FIELDS.map(field => [field, null])),
    latestAutomationAt: null, latestBroadcastAt: null }
}

// DocumentSnapshot cursors retain the complete path for collection-group
// queries. Ordering recent logs by timestamp AND document ID keeps ties stable.
async function scanSource(query, read, visit, { limit = OVERVIEW_SCAN_LIMIT, timestampOrder = false } = {}) {
  let count = 0, after = null
  while (count <= limit) {
    let page = timestampOrder ? query.orderBy('createdAt').orderBy(FieldPath.documentId()) : query.orderBy(FieldPath.documentId())
    if (after) page = page.startAfter(after)
    const requested = Math.min(OVERVIEW_PAGE_SIZE, limit + 1 - count)
    const snapshot = await read(page.limit(requested))
    count += snapshot.size
    if (count > limit) return false
    for (const document of snapshot.docs) visit(document)
    if (snapshot.size < requested) return true
    after = snapshot.docs.at(-1)
  }
  return false
}

async function readOverviewSnapshot(db, { now = () => Date.now(), scanLimit = OVERVIEW_SCAN_LIMIT, deadlineAt = Date.now() + OVERVIEW_SCAN_DEADLINE_MS } = {}) {
  const windowStart = new Date(now() - 24 * 60 * 60_000).toISOString()
  let sourceReadTime = null
  const checkDeadline = () => {
    if (Date.now() >= deadlineAt) throw new HttpsError('unavailable', 'Tổng quan Push đang mất nhiều thời gian. Vui lòng thử lại sau.')
  }
  const value = await db.runTransaction(async transaction => {
    const read = async query => {
      checkDeadline()
      const snapshot = await transaction.get(query)
      recordOperationMetrics({ logicalQueries: 1, documentsReturned: snapshot.size })
      sourceReadTime ||= snapshot.readTime
      checkDeadline()
      return snapshot
    }
    const activeProfiles = new Map()
    const usersComplete = await scanSource(db.collection('users').select(...USER_FIELDS), read, document => {
      const profile = document.data() || {}
      if (isMemberProfile(profile)) {
        const preferences = profile.notificationSettings && typeof profile.notificationSettings === 'object' ? profile.notificationSettings : {}
        // Keep only the two required flags in memory; no names/contact details.
        activeProfiles.set(document.id, { enabled: preferences.enabled !== false, fcmEnabled: preferences.fcmEnabled === true })
      }
    }, { limit: scanLimit })
    if (!usersComplete) return unknownOverview('scan-limit')

    const activeDeviceUsers = new Set()
    let activeDevices = 0
    const devicesComplete = await scanSource(db.collectionGroup('devices').select(...DEVICE_FIELDS), read, document => {
      const device = document.data() || {}
      // Keep the legacy userId join (not parent-path inference). Token contents
      // exist only in this projected snapshot and never enter a result/cache.
      if (device.enabled === false || typeof device.token !== 'string' || !device.token || !activeProfiles.has(device.userId)) return
      activeDevices++
      activeDeviceUsers.add(device.userId)
    }, { limit: scanLimit })
    if (!devicesComplete) return unknownOverview('scan-limit')

    let webPushAccepted24h = 0, webPushFailures24h = 0
    const logQuery = name => db.collection(`system/${name}/logs`)
    const addLog = document => {
      const log = document.data() || {}
      webPushAccepted24h += pushMetric(log.webPushSentCount)
      webPushFailures24h += pushMetric(log.webPushFailureCount)
    }
    for (const name of ['push_broadcast_logs', 'push_automation_logs']) {
      const complete = await scanSource(logQuery(name).where('createdAt', '>=', new Date(windowStart)).select(...LOG_FIELDS), read, addLog, { limit: scanLimit, timestampOrder: true })
      if (!complete) return unknownOverview('scan-limit')
    }
    if (!Number.isFinite(webPushAccepted24h) || !Number.isFinite(webPushFailures24h)) return unknownOverview('invalid-metric')

    const latest = async name => {
      const snapshot = await read(logQuery(name).orderBy('createdAt', 'desc').orderBy(FieldPath.documentId(), 'desc').select('createdAt').limit(1))
      return snapshot.empty ? null : pushTimestampToIso(snapshot.docs[0].data()?.createdAt)
    }
    const latestBroadcastAt = await latest('push_broadcast_logs')
    const latestAutomationAt = await latest('push_automation_logs')
    let pushEnabledUsers = 0
    for (const [userId, preferences] of activeProfiles) {
      if (preferences.enabled && (preferences.fcmEnabled || activeDeviceUsers.has(userId))) pushEnabledUsers++
    }
    return { complete: true, activeUsers: activeProfiles.size, pushEnabledUsers, activeDevices,
      webPushAccepted24h, webPushFailures24h, latestAutomationAt, latestBroadcastAt }
  }, { readOnly: true })
  const asOf = pushTimestampToIso(sourceReadTime)
  if (!asOf) throw new HttpsError('unavailable', 'Không thể xác minh thời điểm dữ liệu Push. Vui lòng thử lại.')
  return { value: { ...value, asOf, windowStart, schemaVersion: OVERVIEW_SCHEMA_VERSION }, sourceReadTime }
}

function createPushOverviewReads({ db, logger = console, requireCaller, hasTrustedRole, privilegedAdminRoles,
  sharedCache, now = () => Date.now(), scanLimit = OVERVIEW_SCAN_LIMIT }) {
  if (typeof requireCaller !== 'function' || typeof hasTrustedRole !== 'function' || !(privilegedAdminRoles instanceof Set)) throw new Error('Existing trusted Push authorization callbacks are required.')
  if (!Number.isInteger(scanLimit) || scanLimit < 1 || scanLimit > OVERVIEW_SCAN_LIMIT) throw new Error('Invalid Push overview scan limit.')
  const cache = sharedCache || createSharedDashboardCache({ db, logger, now, ttlMs: OVERVIEW_TTL_MS,
    buildLeaseMs: OVERVIEW_BUILD_LEASE_MS, coalesceRefresh: true })
  const cacheKey = `push-admin-overview-v${OVERVIEW_SCHEMA_VERSION}-limit${scanLimit}`
  // The shared telemetry wrapper may include actor/source IDs on errors. This
  // aggregate endpoint logs only numeric observations and fixed classifications.
  const metricLogger = Object.fromEntries(['info', 'warn', 'error'].map(level => [level, (message, value) => {
    const fields = ['schemaVersion', 'domain', 'operation', 'release', 'sampleRate', 'metrics', 'functionName',
      'outcome', 'failureCode', 'errorCode', 'retryable', 'durationMs', 'authenticated', 'appVerified']
    logger[level](message, Object.fromEntries(fields.filter(field => value[field] !== undefined).map(field => [field, value[field]])))
  }]))

  async function getPushAdminOverview(request) {
    const deadlineAt = Date.now() + OVERVIEW_SCAN_DEADLINE_MS
    const actorId = requireCaller(request)
    const actorSnapshot = await db.doc(`users/${actorId}`).get()
    recordOperationMetrics({ logicalQueries: 1, documentsReturned: actorSnapshot.exists ? 1 : 0 })
    if (!actorSnapshot.exists || !hasTrustedRole(request, actorSnapshot.data(), privilegedAdminRoles)) {
      throw new HttpsError('permission-denied', 'Bạn không có quyền xem trạng thái Push.')
    }
    if (request.data?.forceRefresh !== undefined && typeof request.data.forceRefresh !== 'boolean') {
      throw new HttpsError('invalid-argument', 'Tùy chọn làm mới Push không hợp lệ.')
    }
    // Authorization is evaluated on every request, including shared hits. No
    // caller/profile/token information is part of the all-admin cache value.
    const acquired = await cache.acquire(cacheKey, request.data?.forceRefresh === true)
    if (acquired.cached) {
      recordOperationMetrics({ cacheHit: true, projectionAgeMs: Math.max(0, now() - Date.parse(acquired.cached.asOf)) })
      return acquired.cached
    }
    let published = false
    try {
      const built = await readOverviewSnapshot(db, { now, scanLimit, deadlineAt })
      published = await cache.publish(cacheKey, built.value, acquired.lease, { sourceReadTime: built.sourceReadTime })
      if (published === false) throw new HttpsError('unavailable', 'Tổng quan Push đã thay đổi trong lúc cập nhật. Vui lòng thử lại.')
      recordOperationMetrics({ cacheHit: false, projectionAgeMs: Math.max(0, now() - Date.parse(built.value.asOf)) })
      return { ...built.value, cache: { hit: false, tier: 'shared', ttlSeconds: OVERVIEW_TTL_MS / 1000 } }
    } finally { if (!published) await cache.release(cacheKey, acquired.lease) }
  }
  return { getPushAdminOverview: withFunctionTelemetry('getPushAdminOverview', getPushAdminOverview, { logger: metricLogger }) }
}

module.exports = { createPushOverviewReads, readOverviewSnapshot, scanSource, isMemberProfile, pushTimestampToIso, pushMetric,
  OVERVIEW_SCHEMA_VERSION, OVERVIEW_SCAN_LIMIT, OVERVIEW_PAGE_SIZE, OVERVIEW_TTL_MS, OVERVIEW_BUILD_LEASE_MS,
  USER_FIELDS, DEVICE_FIELDS, LOG_FIELDS, METRIC_FIELDS }
