import { useCallback, useEffect, useRef } from 'react'
import { createWorkspaceSync, type WorkspaceSyncState } from '../../utils/workspaceSync'
import { listMyEatCleanDeliveryJobs } from './deliveryService'
import { subscribeDeliveryAccess, subscribeDeliveryRevision } from './deliveryWorkspaceService'
import type { DeliveryWorkspaceState, EatCleanDriverWorkspace } from './types'

const denied = (error: unknown) => /(?:permission-denied|unauthenticated)$/.test(String((error as { code?: string })?.code || ''))
const engineState = (state: DeliveryWorkspaceState): WorkspaceSyncState => ({
  version: state.version, policyVersion: state.policyVersion, userVersion: '0',
  // Different role scopes never compare each other's work watermark.
  branchVersions: { [state.scope]: state.userVersion },
})

export function useDeliveryWorkspace(options: {
  accountId: string
  apply: (value: EatCleanDriverWorkspace) => void
  clear: () => void
  pending: (pending: boolean, initial: boolean) => void
  failure: (error: unknown, accessDenied: boolean) => void
}) {
  const optionsRef = useRef(options)
  optionsRef.current = options
  const control = useRef<{ retry: () => void; invalidate: () => void } | null>(null)
  useEffect(() => {
    const accountId = options.accountId
    if (!accountId) return
    let alive = true, generation = 0, first = true, readingError = false
    let observedRole = ''
    const paths = new Map<string, string>([['policy', 'eatCleanWorkspaceChanges/config'], ['access', `users/${accountId}`]])
    const stops = new Map<string, () => void>(), failed = new Set<string>()
    const current = () => alive && optionsRef.current.accountId === accountId
    const fail = (error: unknown) => {
      if (!current()) return
      readingError = true
      if (denied(error)) {
        generation++
        optionsRef.current.clear()
        stops.forEach((stop, key) => { stop(); failed.add(key) })
        stops.clear()
        for (const key of [...paths.keys()]) if (key.startsWith('branch:')) { paths.delete(key); failed.delete(key) }
      }
      optionsRef.current.failure(error, denied(error))
    }
    const attach = (key: string, path: string) => {
      stops.get(key)?.()
      if (key === 'access') {
        const stop = subscribeDeliveryAccess(accountId, profile => {
          if (!current()) return
          failed.delete(key)
          const changedRole = observedRole !== '' && observedRole !== profile.role
          observedRole = profile.role
          if (profile.disabled || !['shipper', 'admin', 'super_admin'].includes(profile.role) || changedRole) {
            fail({ code: 'permission-denied' }); engine.fail()
          }
        }, error => { if (current()) { failed.add(key); fail(error); engine.fail() } })
        stops.set(key, stop)
        return
      }
      const stop = subscribeDeliveryRevision(path, version => {
        if (!current() || !paths.has(key)) return
        failed.delete(key)
        engine.observe(key, version)
      }, error => {
        if (!current() || !paths.has(key)) return
        failed.add(key); fail(error); engine.fail()
      })
      stops.set(key, stop)
    }
    const engine = createWorkspaceSync({
      environment: {
        available: () => current() && document.visibilityState !== 'hidden' && navigator.onLine !== false,
        schedule: (callback, delay) => window.setTimeout(callback, delay),
        cancel: timer => window.clearTimeout(timer as number),
      },
      refresh: async () => {
        const ticket = generation, initial = first
        readingError = false
        optionsRef.current.pending(true, initial)
        try {
          const value = await listMyEatCleanDeliveryJobs()
          if (!current() || ticket !== generation) return
          if (!value.workspaceSync || value.workspaceSync.accountId !== accountId) throw new Error('DELIVERY_SYNC_UNAVAILABLE')
          const state = value.workspaceSync
          // Attach after the server fixes the role scope. The first server
          // snapshot catches commits between marker read, hydration and attach.
          const key = `branch:${state.scope}`
          const path = state.scope === 'shipper' ? `eatCleanDriverChanges/${accountId}` : 'eatCleanWorkspaceChanges/dispatch'
          for (const old of paths.keys()) if (old.startsWith('branch:') && old !== key) {
            stops.get(old)?.(); stops.delete(old); paths.delete(old); failed.delete(old)
          }
          if (!paths.has(key)) { paths.set(key, path); attach(key, path) }
          optionsRef.current.apply(value)
          engine.accept(engineState(state))
          if (failed.size) optionsRef.current.failure(new Error('DELIVERY_SYNC_UNAVAILABLE'), false)
        } catch (error) {
          if (current() && ticket === generation) { fail(error); engine.fail() }
        } finally {
          if (current()) { first = false; optionsRef.current.pending(false, initial) }
        }
      },
      onError: value => {
        if (value && current() && !readingError) optionsRef.current.failure(new Error('DELIVERY_SYNC_UNAVAILABLE'), false)
      },
    })
    const reconnect = () => { for (const key of [...failed]) attach(key, paths.get(key)!) }
    const resume = () => {
      if (!current() || document.visibilityState === 'hidden' || navigator.onLine === false) return
      reconnect(); engine.resume()
    }
    const controls = {
      retry: () => { reconnect(); engine.retry() },
      // Successful local mutations invalidate older responses and request one
      // reconcile; a marker arriving first shares the same in-flight read.
      invalidate: () => { generation++; engine.retry() },
    }
    control.current = controls
    optionsRef.current.pending(true, true)
    paths.forEach((path, key) => attach(key, path))
    document.addEventListener('visibilitychange', resume)
    window.addEventListener('online', resume)
    engine.retry()
    return () => {
      alive = false; generation++; engine.stop(); stops.forEach(stop => stop())
      document.removeEventListener('visibilitychange', resume); window.removeEventListener('online', resume)
      if (control.current === controls) control.current = null
    }
  }, [options.accountId])
  return {
    refresh: useCallback((_background = true) => control.current?.retry(), []),
    invalidate: useCallback(() => control.current?.invalidate(), []),
  }
}
