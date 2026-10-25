import { useCallback, useEffect, useRef } from 'react'
import { createWorkspaceSync } from '../../utils/workspaceSync'
import { subscribeDeliveryAccess, subscribeDeliveryLocation, subscribeDeliveryRevision, type DeliveryLiveLocation } from '../delivery/deliveryWorkspaceService'
import { getEatCleanOrderTracking } from './eatCleanService'
import type { EatCleanOrderTracking } from './types'

const denied = (error: unknown) => /(?:permission-denied|unauthenticated|not-found)$/.test(String((error as { code?: unknown })?.code || ''))
const foreground = () => document.visibilityState !== 'hidden' && navigator.onLine !== false

export function useOrderTracking(options: {
  accountId: string; orderId: string; enabled: boolean
  apply: (value: EatCleanOrderTracking) => void
  clear: () => void
  pending: (pending: boolean) => void
  failure: (error: unknown, denied: boolean) => void
}) {
  const latest = useRef(options); latest.current = options
  const control = useRef<(() => void) | null>(null)
  useEffect(() => {
    if (!options.enabled) return
    const { accountId, orderId } = options
    if (!accountId || !orderId) { latest.current.clear(); latest.current.failure({ code: 'unauthenticated' }, true); return }
    let alive = true, generation = 0, subscriptionEpoch = 0, gpsEpoch = 0, paused = false, reading = false
    let value: EatCleanOrderTracking | null = null, point: DeliveryLiveLocation | null | undefined
    let observedRole = '', gpsDeniedBinding: string | null = null
    const stops = new Map<string, () => void>()
    const current = () => alive && latest.current.accountId === accountId && latest.current.orderId === orderId
    const stopGps = () => { gpsEpoch++; stops.get('gps')?.(); stops.delete('gps') }
    const stopAll = () => { subscriptionEpoch++; stopGps(); stops.forEach(stop => stop()); stops.clear() }
    const apply = () => {
      if (!current() || !value) return
      latest.current.apply(point === undefined ? value : { ...value,
        shipperLocation: point ? { latitude: point.latitude, longitude: point.longitude } : undefined,
        lastLocationAt: point ? new Date(point.updatedAt).toISOString() : undefined,
        locationExpiresAt: point?.expiresAt,
        stale: !point || Date.now() - point.updatedAt > 120_000,
      })
    }
    const fail = (error: unknown) => {
      if (!current()) return
      paused = true; generation++; stopAll()
      if (denied(error)) { value = null; point = undefined; latest.current.clear() }
      latest.current.failure(error, denied(error))
    }
    const attachGps = () => {
      const stream = value?.locationStream
      if (!current() || paused || !foreground() || !stream?.enabled || gpsDeniedBinding === stream.binding || stops.has('gps')) return
      const ticket = ++gpsEpoch, binding = stream.binding
      stops.set('gps', subscribeDeliveryLocation(orderId, next => {
        if (!current() || paused || ticket !== gpsEpoch || value?.locationStream?.binding !== binding) return
        if (next && next.binding !== binding) {
          // Owner access can remain valid across reassignment. Do not display
          // the new driver's position with the previous driver's identity.
          stopGps(); point = null; gpsDeniedBinding = binding; apply(); engine.retry(); return
        }
        if (point && next && next.updatedAt < point.updatedAt) return
        point = next; apply()
      }, error => {
        if (!current() || paused || ticket !== gpsEpoch) return
        if (denied(error)) {
          // Completion/reassignment can revoke GPS before its business marker
          // arrives. Clear only the point and reconcile authority once. An
          // unchanged failed binding cannot create a permission-retry loop.
          stopGps(); point = null; gpsDeniedBinding = binding; apply(); engine.retry()
        } else { fail(error); engine.fail() }
      }))
    }
    const attachState = () => {
      if (!current() || paused || !foreground() || !value) return
      const epoch = subscriptionEpoch
      if (!stops.has('access')) stops.set('access', subscribeDeliveryAccess(accountId, profile => {
        if (!current() || paused || epoch !== subscriptionEpoch) return
        const changedRole = observedRole !== '' && observedRole !== profile.role
        observedRole = profile.role
        if (profile.disabled || changedRole) { fail({ code: 'permission-denied' }); engine.fail() }
      }, error => { if (current() && epoch === subscriptionEpoch) { fail(error); engine.fail() } }))
      if (!stops.has('order')) stops.set('order', subscribeDeliveryRevision(`eatCleanOrderChanges/${orderId}`, version => {
        if (!current() || paused || epoch !== subscriptionEpoch || ['delivered', 'cancelled'].includes(value?.status || '')) return
        engine.observe('user', version)
      }, error => { if (current() && epoch === subscriptionEpoch) { fail(error); engine.fail() } }))
      attachGps()
    }
    const engine = createWorkspaceSync({
      environment: { available: () => current() && !paused && foreground(),
        schedule: (callback, delay) => window.setTimeout(callback, delay), cancel: timer => window.clearTimeout(timer as number) },
      refresh: async () => {
        const ticket = generation
        if (!current() || paused) return
        reading = true; latest.current.pending(true)
        try {
          const next = await getEatCleanOrderTracking(orderId)
          if (!current() || ticket !== generation) return
          const sync = next?.workspaceSync
          if (!next || !sync || sync.accountId !== accountId || sync.orderId !== orderId || !next.locationStream) throw Error('TRACKING_SYNC_UNAVAILABLE')
          if (value?.locationStream?.binding !== next.locationStream.binding || !next.locationStream.enabled) { stopGps(); point = undefined }
          if (point && Date.parse(next.lastLocationAt || '') > point.updatedAt) point = undefined
          value = next.locationStream.enabled ? next : { ...next, shipperLocation: undefined, lastLocationAt: undefined, locationExpiresAt: undefined }
          apply()
          latest.current.failure(null, false)
          engine.accept({ version: sync.version, userVersion: sync.version, policyVersion: '0', branchVersions: {} })
          attachState()
          if (next.locationStream.enabled && gpsDeniedBinding === next.locationStream.binding) latest.current.failure(Error('TRACKING_LOCATION_UNAVAILABLE'), false)
        } catch (error) {
          if (current() && ticket === generation) { fail(error); engine.fail() }
        } finally {
          reading = false
          if (current()) latest.current.pending(false)
        }
      },
      onError: failed => { if (failed && current() && !paused) fail(Error('TRACKING_SYNC_UNAVAILABLE')) },
    })
    const resume = () => {
      if (!current()) return
      if (!foreground()) { stopAll(); return }
      if (paused) return // Error recovery requires an explicit retry.
      attachState(); engine.resume()
    }
    const retry = () => {
      if (!current() || reading) return
      paused = false; generation++; gpsDeniedBinding = null; point = undefined; stopAll(); engine.retry()
    }
    control.current = retry
    document.addEventListener('visibilitychange', resume)
    window.addEventListener('online', resume); window.addEventListener('offline', resume)
    engine.retry()
    return () => {
      alive = false; generation++; stopAll(); engine.stop()
      document.removeEventListener('visibilitychange', resume)
      window.removeEventListener('online', resume); window.removeEventListener('offline', resume)
      if (control.current === retry) control.current = null
    }
  }, [options.accountId, options.orderId, options.enabled])
  return { refresh: useCallback(() => control.current?.(), []) }
}
