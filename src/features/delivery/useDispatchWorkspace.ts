import { useCallback, useEffect, useRef } from 'react'
import { createWorkspaceSync, millisecondsUntilVietnamMidnight, vietnamDateKey } from '../../utils/workspaceSync'
import { listEatCleanDispatchSnapshot } from './deliveryService'
import { subscribeDeliveryAccess, subscribeDeliveryLocation, subscribeDeliveryRevision, subscribeDispatchDailySignals, type DeliveryLiveLocation } from './deliveryWorkspaceService'
import { DISPATCH_DATA_SECTIONS, type DispatchDataSection, type DispatchMarkerSection, type EatCleanDispatchSnapshot } from './types'

const denied = (error: unknown) => /(?:permission-denied|unauthenticated|not-found)$/.test(String((error as { code?: unknown })?.code || ''))
const foreground = () => document.visibilityState !== 'hidden' && navigator.onLine !== false
const markers: DispatchMarkerSection[] = ['jobs', 'roster', 'config']

export function useDispatchWorkspace(options: {
  accountId: string; enabled: boolean; live: boolean
  apply: (value: EatCleanDispatchSnapshot) => void; clear: () => void
  pending: (pending: boolean) => void; failure: (error: unknown, denied: boolean) => void
}) {
  const latest = useRef(options); latest.current = options
  const control = useRef<{ refresh: () => void; reconcile: () => void; invalidate: (sections: DispatchDataSection[]) => void; guard: () => () => boolean } | null>(null)
  useEffect(() => {
    if (!options.enabled) return
    const accountId = options.accountId
    if (!accountId) { latest.current.clear(); latest.current.failure({ code: 'unauthenticated' }, true); return }
    let alive = true, paused = false, authority = 0, generation = 0, epoch = 0, sequence = 0
    let value: EatCleanDispatchSnapshot | null = null, day = vietnamDateKey(), counterSequence = 0
    let observedRole = ''
    let midnight: number | undefined
    const versions: Partial<Record<DispatchMarkerSection, string>> = {}, observed = new Map<DispatchMarkerSection, string>()
    const forced = new Set<DispatchDataSection>()
    const subscriptions = new Map<string, { stop: () => void; ticket: number }>()
    const points = new Map<string, DeliveryLiveLocation | null>(), gpsDenied = new Map<string, string>()
    const current = () => alive && latest.current.accountId === accountId && latest.current.enabled
    const activeSections = () => latest.current.live ? [...DISPATCH_DATA_SECTIONS] : ['config'] as DispatchDataSection[]
    const stop = (key: string) => { subscriptions.get(key)?.stop(); subscriptions.delete(key) }
    const stopAll = () => { epoch++; for (const key of subscriptions.keys()) stop(key); window.clearTimeout(midnight) }
    const apply = () => {
      if (!current() || !value) return
      latest.current.apply({ ...value, jobs: value.jobs.map(job => ({ ...job, liveLocation: job.locationStream?.enabled ? points.get(job.id) || undefined : undefined })) })
    }
    const fail = (error: unknown) => {
      if (!current()) return
      paused = true; authority++; generation++; stopAll()
      if (denied(error)) { value = null; points.clear(); latest.current.clear() }
      latest.current.failure(error, denied(error)); latest.current.pending(false)
    }
    const accept = () => engine.accept({ version: 'dispatch', userVersion: '0', policyVersion: '0',
      branchVersions: Object.fromEntries(markers.filter(key => latest.current.live || key === 'config').map(key => [key, versions[key] || '0'])) })
    const subscribe = (key: string, attach: (valid: () => boolean) => () => void) => {
      if (subscriptions.has(key)) return
      const ticket = ++sequence, attachedEpoch = epoch
      // Install before attaching, so synchronous cached/mock callbacks are fenced too.
      const record = { ticket, stop: () => {} }; subscriptions.set(key, record)
      const valid = () => current() && !paused && attachedEpoch === epoch && subscriptions.get(key)?.ticket === ticket
      const cleanup = attach(valid)
      if (subscriptions.get(key) === record) record.stop = cleanup; else cleanup()
    }
    const requestSections = (sections: DispatchDataSection[]) => {
      sections.forEach(key => forced.add(key)); engine.retry()
    }
    const reconcile = () => {
      if (!current()) return
      if (!foreground()) { stopAll(); return }
      if (paused || !value) return
      const selected = activeSections()
      for (const key of subscriptions.keys()) if (key !== 'access' && key !== 'config' && !latest.current.live) stop(key)
      subscribe('access', valid => subscribeDeliveryAccess(accountId, profile => {
        if (!valid()) return
        const changedRole = observedRole !== '' && observedRole !== profile.role
        observedRole = profile.role
        if (profile.disabled || changedRole || !['admin', 'super_admin'].includes(profile.role)) { fail({ code: 'permission-denied' }); engine.fail() }
      }, error => { if (valid()) { fail(error); engine.fail() } }))
      for (const key of markers.filter(key => selected.includes(key))) subscribe(key, valid => subscribeDeliveryRevision(`eatCleanWorkspaceChanges/${key}`, next => {
        if (!valid() || (!latest.current.live && key !== 'config')) return
        if ((observed.get(key) || '0') < next) observed.set(key, next)
        engine.observe(`branch:${key}`, next)
      }, error => { if (valid()) { fail(error); engine.fail() } }))
      window.clearTimeout(midnight)
      if (latest.current.live) {
        const today = vietnamDateKey()
        if (day !== today) { stop('counter'); day = today; counterSequence++; value.signalsDay = today; value.signals = { ...value.signals, mapsErrorsToday: 0 }; apply() }
        const attachedDay = day
        subscribe('counter', valid => subscribeDispatchDailySignals(attachedDay, count => {
          if (!valid() || !value || day !== attachedDay) return
          counterSequence++; value.signalsDay = attachedDay; value.signals = { ...value.signals, mapsErrorsToday: count }; apply()
        }, error => { if (valid()) { fail(error); engine.fail() } }))
        midnight = window.setTimeout(reconcile, millisecondsUntilVietnamMidnight())
        const wanted = new Set(value.jobs.filter(job => job.locationStream?.enabled).map(job => `gps:${job.id}:${job.locationStream!.binding}`))
        for (const key of subscriptions.keys()) if (key.startsWith('gps:') && !wanted.has(key)) stop(key)
        for (const job of value.jobs) {
          const stream = job.locationStream
          if (!stream?.enabled || gpsDenied.get(job.id) === stream.binding) continue
          const key = `gps:${job.id}:${stream.binding}`
          const lostBinding = () => { stop(key); points.set(job.id, null); gpsDenied.set(job.id, stream.binding); apply(); requestSections(['jobs']) }
          subscribe(key, valid => subscribeDeliveryLocation(job.id, point => {
            if (!valid()) return
            if (point && point.binding !== stream.binding) { lostBinding(); return }
            const previous = points.get(job.id)
            if (previous && point && previous.updatedAt > point.updatedAt) return
            points.set(job.id, point); apply()
          }, error => {
            if (!valid()) return
            if (denied(error)) lostBinding()
            else { points.set(job.id, null); apply(); fail(error); engine.fail() }
          }))
        }
      }
      accept(); engine.resume()
    }
    const engine = createWorkspaceSync({
      environment: { available: () => current() && !paused && foreground(), schedule: (callback, delay) => window.setTimeout(callback, delay), cancel: timer => window.clearTimeout(timer as number) },
      refresh: async () => {
        const selected = activeSections()
        const sections = value ? selected.filter(key => forced.has(key) || (key !== 'signals' && (observed.get(key) || '0') > (versions[key] || '0'))) : [...DISPATCH_DATA_SECTIONS]
        if (!sections.length) { accept(); return }
        sections.forEach(key => forced.delete(key))
        const ticket = generation, counterTicket = counterSequence
        latest.current.pending(true)
        try {
          const next = await listEatCleanDispatchSnapshot(sections)
          if (!current()) return
          if (ticket !== generation) { if (!paused) requestSections(sections); return }
          if (next.workspaceSync.accountId !== accountId || JSON.stringify(next.sections) !== JSON.stringify(sections)) throw Error('DISPATCH_SYNC_UNAVAILABLE')
          if (!value && (!next.jobs || !next.drivers || !next.config || !next.readiness || !next.signals)) throw Error('DISPATCH_BOOTSTRAP_INCOMPLETE')
          if (next.jobs) {
            const jobs = new Map(next.jobs.map(job => [job.id, job]))
            for (const id of points.keys()) if (!jobs.get(id)?.locationStream?.enabled || value?.jobs.find(job => job.id === id)?.locationStream?.binding !== jobs.get(id)?.locationStream?.binding) points.delete(id)
            for (const id of gpsDenied.keys()) if (gpsDenied.get(id) !== jobs.get(id)?.locationStream?.binding) gpsDenied.delete(id)
          }
          const { sections: _sections, workspaceSync: _sync, signalsDay: _day, signals: incomingSignals, ...data } = next
          const useCounter = counterTicket === counterSequence && next.signalsDay === vietnamDateKey()
          value = { ...value, ...data, ...(useCounter ? { signalsDay: next.signalsDay } : {}), signals: { mapsErrorsToday: 0, otpRejected: 0, otpLocked: 0, gpsStale: 0, lateOrders: 0, ...value?.signals,
            ...(useCounter ? incomingSignals : {}) } } as EatCleanDispatchSnapshot
          Object.assign(versions, next.workspaceSync.versions)
          latest.current.failure(null, false); apply(); reconcile()
        } catch (error) {
          if (current() && ticket === generation) { fail(error); engine.fail() }
          else if (current() && !paused) requestSections(sections)
        } finally { if (current()) latest.current.pending(false) }
      },
      // A mutation/manual refresh can deliberately discard an older response.
      // Its queued follow-up must finish before treating a dirty baseline as a
      // transport failure; no accepted version is fabricated to clear it.
      onError: failed => { if (failed && current() && !paused && !activeSections().some(key => forced.has(key))) fail(Error('DISPATCH_SYNC_UNAVAILABLE')) },
    })
    const handle = {
      refresh() { if (!current()) return; paused = false; generation++; observedRole = ''; gpsDenied.clear(); stopAll(); requestSections(activeSections()) },
      reconcile,
      invalidate(sections: DispatchDataSection[]) { if (!current() || paused) return; generation++; requestSections(sections) },
      guard() { const ticket = authority; return () => current() && Boolean(value) && !paused && ticket === authority },
    }
    control.current = handle
    document.addEventListener('visibilitychange', reconcile); window.addEventListener('online', reconcile); window.addEventListener('offline', reconcile)
    engine.retry()
    return () => {
      alive = false; authority++; generation++; stopAll(); engine.stop()
      document.removeEventListener('visibilitychange', reconcile); window.removeEventListener('online', reconcile); window.removeEventListener('offline', reconcile)
      if (control.current === handle) control.current = null
    }
  }, [options.accountId, options.enabled])
  useEffect(() => { control.current?.reconcile() }, [options.live])
  return {
    refresh: useCallback(() => control.current?.refresh(), []),
    invalidate: useCallback((sections: DispatchDataSection[]) => control.current?.invalidate(sections), []),
    mutationGuard: useCallback(() => control.current?.guard() || (() => false), []),
  }
}
