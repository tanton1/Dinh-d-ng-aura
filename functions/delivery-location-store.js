'use strict'

const { isDeepStrictEqual } = require('node:util')
const { createHash } = require('node:crypto')
const { Timestamp } = require('firebase-admin/firestore')
const { HttpsError } = require('firebase-functions/v2/https')
const { locationUpdateIssue } = require('./delivery-location-policy')

const COLLECTION = 'eatCleanLiveLocationViews'
const RETENTION_MS = 24 * 60 * 60 * 1000
const ACTIVE = new Set(['accepted', 'at_store', 'picked_up', 'arrived'])
const ROLES = new Set(['shipper', 'admin', 'super_admin'])
const id = value => typeof value === 'string' && value.length > 0 && value.length <= 160
  && value.trim() === value && !value.includes('/') && !['.', '..'].includes(value)
const millis = value => typeof value?.toMillis === 'function' ? value.toMillis() : Number(value || 0)

function matchesAssignment(value, delivery) {
  return Boolean(value && delivery && value.shipperId === delivery.shipperId
    && isDeepStrictEqual(value.assignmentAt ?? null, delivery.assignedAt ?? null)
    && isDeepStrictEqual(value.acceptanceAt ?? null, delivery.acceptedAt ?? null))
}

function locationStream(delivery) {
  return { enabled: Boolean(delivery && ACTIVE.has(delivery.status)),
    binding: delivery ? createHash('sha256').update(JSON.stringify([
      delivery.shipperId ?? null, delivery.assignedAt ?? null, delivery.acceptedAt ?? null,
    ])).digest('hex') : '' }
}

function publicLocation(value) {
  if (!value) return null
  // Never return assignment metadata or fields injected by a legacy mirror.
  return Object.fromEntries(Object.entries({
    orderId: value.orderId, shipperId: value.shipperId,
    latitude: value.latitude, longitude: value.longitude,
    accuracyMeters: value.accuracyMeters, capturedAt: value.capturedAt,
    heading: value.heading, speedMetersPerSecond: value.speedMetersPerSecond,
    active: value.active, updatedAt: value.updatedAt,
    expiresAt: millis(value.expiresAt) || Number(value.updatedAt || 0) + RETENTION_MS,
  }).filter(([, field]) => field !== undefined))
}

const validCoordinates = point => Number.isFinite(point?.latitude) && Math.abs(point.latitude) <= 90
  && Number.isFinite(point?.longitude) && Math.abs(point.longitude) <= 180

/** One accepted fix replaces one small document. Current access, assignment,
 * terminal state and the previous fix are checked in the same transaction.
 * No business document, revision, event or RTDB mirror is written per fix. */
async function writeFirestoreLocation({ db, request, orderId, position, distance, now = Date.now }) {
  const actorId = request.auth?.uid
  if (!actorId) throw new HttpsError('unauthenticated', 'Bạn cần đăng nhập để cập nhật vị trí.')
  if (!id(actorId) || !id(orderId)) throw new HttpsError('invalid-argument', 'Mã tài khoản hoặc đơn hàng không hợp lệ.')
  if (!validCoordinates(position)) throw new HttpsError('invalid-argument', 'Vị trí shipper không hợp lệ.')
  const reference = db.doc(`${COLLECTION}/${orderId}`)
  return db.runTransaction(async transaction => {
    const [actorSnapshot, deliverySnapshot, pointSnapshot] = await transaction.getAll(
      db.doc(`users/${actorId}`), db.doc(`eatCleanDeliveries/${orderId}`), reference,
    )
    const profile = actorSnapshot.data(), role = String(request.auth?.token?.role || '')
    if (!actorSnapshot.exists || profile?.disabled === true || !ROLES.has(role) || profile?.role !== role) {
      throw new HttpsError('permission-denied', 'Tài khoản không có quyền vận hành giao hàng.')
    }
    if (!deliverySnapshot.exists) throw new HttpsError('not-found', 'Không tìm thấy nhiệm vụ giao hàng.')
    const delivery = deliverySnapshot.data()
    if (role === 'shipper' && delivery.shipperId !== actorId) throw new HttpsError('permission-denied', 'Đơn này chưa được gán cho bạn.')
    if (!id(delivery.shipperId) || !ACTIVE.has(delivery.status)) {
      throw new HttpsError('failed-precondition', 'Đơn chưa ở trạng thái cho phép cập nhật vị trí.')
    }
    const currentTime = now()
    const value = {
      schemaVersion: 1,
      orderId,
      shipperId: delivery.shipperId,
      assignmentAt: delivery.assignedAt ?? null,
      acceptanceAt: delivery.acceptedAt ?? null,
      latitude: position.latitude, longitude: position.longitude,
      accuracyMeters: position.accuracyMeters, capturedAt: position.capturedAt,
      heading: position.heading ?? 0, speedMetersPerSecond: position.speedMetersPerSecond ?? 0,
      active: true,
      updatedAt: currentTime,
      expiresAt: Timestamp.fromMillis(currentTime + RETENTION_MS),
    }
    // A new canonical assignment starts a new sample window, including A→B→A.
    // Legacy deliveries without assignment timestamps remain supported; the
    // next assignment/acceptance made by current writers changes these fields.
    const current = matchesAssignment(pointSnapshot.data(), delivery) ? pointSnapshot.data() : null
    const reason = locationUpdateIssue(current, value, millis(delivery.acceptedAt), currentTime, distance)
    if (reason) return { location: publicLocation(current), throttled: true, reason }
    transaction.set(reference, value)
    return { location: publicLocation(value), throttled: false }
  })
}

/** Read the displayed active jobs only. An existing point from another
 * assignment is never replaced with a possibly stale legacy mirror. */
async function readFirestoreLocations({ db, realtimeDb, deliveries, now = Date.now }) {
  const active = deliveries.filter(row => id(row.id) && ACTIVE.has(row.status))
  const result = new Map()
  if (!active.length) return result
  if (active.length > 200 || new Set(active.map(row => row.id)).size !== active.length) throw Error('LOCATION_READ_SCOPE_INVALID')
  const snapshots = await db.getAll(...active.map(row => db.doc(`${COLLECTION}/${row.id}`)))
  await Promise.all(snapshots.map(async (snapshot, index) => {
    const delivery = active[index]
    if (snapshot.id !== delivery.id) throw Error('LOCATION_READ_ORDER_MISMATCH')
    if (snapshot.exists) {
      const point = snapshot.data()
      if (point.schemaVersion === 1 && point.orderId === delivery.id && point.active === true
          && validCoordinates(point) && matchesAssignment(point, delivery) && millis(point.expiresAt) > now()) {
        result.set(delivery.id, publicLocation(point))
      }
      return
    }
    // Compatibility for an active job that has not published its first new
    // fix yet. New writers never write a second RTDB copy.
    if (realtimeDb) {
      const legacy = await realtimeDb.ref(`eatCleanLiveLocations/${delivery.id}`).get()
      const point = legacy.exists() ? legacy.val() : null
      // Old RTDB records have no assignment timestamp. A fix must postdate
      // this acceptance/assignment; matching the shipper alone fails A→B→A.
      const assignmentTime = Math.max(millis(delivery.assignedAt), millis(delivery.acceptedAt))
      if (point && point.active !== false && validCoordinates(point) && point.shipperId === delivery.shipperId
          && Number(point.updatedAt) >= assignmentTime
          && millis(point.expiresAt || Number(point.updatedAt || 0) + RETENTION_MS) > now()) result.set(delivery.id, publicLocation(point))
    }
  }))
  return result
}

module.exports = { COLLECTION, RETENTION_MS, ACTIVE, matchesAssignment, locationStream, publicLocation, writeFirestoreLocation, readFirestoreLocations }
