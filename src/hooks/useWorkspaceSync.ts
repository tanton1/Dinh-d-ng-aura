import { useCallback, useEffect, useRef, useState } from 'react'
import { onAuthStateChanged } from 'firebase/auth'
import { doc, onSnapshot, type Unsubscribe } from 'firebase/firestore'
import { firebaseAuth } from '../lib/firebase'
import { firestoreDb } from '../lib/firebaseFirestore'
import { createWorkspaceSync, millisecondsUntilVietnamMidnight, vietnamDateKey, type WorkspaceSyncDomain, type WorkspaceSyncState } from '../utils/workspaceSync'

export function useWorkspaceAccountId() {
  const [uid, setUid] = useState(firebaseAuth?.currentUser?.uid || '')
  useEffect(() => firebaseAuth ? onAuthStateChanged(firebaseAuth, (user) => setUid(user?.uid || '')) : undefined, [])
  return uid
}

/** One local clock alarm per day; resume only changes state if the day changed. */
export function useVietnamDay() {
  const [day, setDay] = useState(vietnamDateKey)
  useEffect(() => {
    let timer: number
    const update = () => {
      window.clearTimeout(timer)
      setDay(vietnamDateKey())
      timer = window.setTimeout(update, millisecondsUntilVietnamMidnight())
    }
    const resume = () => { if (!document.hidden) update() }
    update()
    document.addEventListener('visibilitychange', resume)
    return () => { window.clearTimeout(timer); document.removeEventListener('visibilitychange', resume) }
  }, [])
  return day
}

/** Rendering deadlines are local alarms, with no network work attached. */
export function useLocalTimeBoundaries(boundaries: number[]) {
  const [now, setNow] = useState(Date.now)
  const key = boundaries.filter(Number.isFinite).sort((left, right) => left - right).join(',')
  useEffect(() => {
    const current = Date.now()
    const next = key.split(',').map(Number).find((value) => value > current)
    const timer = next === undefined ? undefined : window.setTimeout(() => setNow(Date.now()), Math.min(next - current + 25, 2_147_483_647))
    const resume = () => { if (!document.hidden) setNow(Date.now()) }
    document.addEventListener('visibilitychange', resume)
    return () => { window.clearTimeout(timer); document.removeEventListener('visibilitychange', resume) }
  }, [key, now])
  return Math.max(now, Date.now())
}

export function useWorkspaceSync({ accountId, domain, scopeKey, enabled, refresh }: {
  accountId: string; domain: WorkspaceSyncDomain; scopeKey: string; enabled: boolean; refresh: () => Promise<unknown>
}) {
  const refreshRef = useRef(refresh)
  refreshRef.current = refresh
  const engineRef = useRef<ReturnType<typeof createWorkspaceSync> | null>(null)
  const retryRef = useRef<() => void>(() => {})
  const [error, setError] = useState(false)
  useEffect(() => {
    setError(false)
    if (!enabled || !accountId) return
    let alive = true
    let readFailed = false
    const subscriptions = new Map<string, Unsubscribe>()
    const paths = new Map<string, string>([['user', `users/${accountId}/workspaceChanges/operations`], ['policy', 'workspaceChanges/policy']])
    const failedKeys = new Set<string>()
    const field = `${domain}Version`
    const attach = (key: string, path: string) => {
      if (!firestoreDb) { failedKeys.add(key); setError(true); return }
      const stop = onSnapshot(doc(firestoreDb, path), { includeMetadataChanges: true }, (snapshot) => {
        if (!alive || snapshot.metadata.fromCache || snapshot.metadata.hasPendingWrites) return
        failedKeys.delete(key)
        setError(readFailed || failedKeys.size > 0)
        engine.observe(key, String(snapshot.data()?.[field] ?? '0'))
      }, () => { if (alive) { failedKeys.add(key); setError(true) } })
      subscriptions.set(key, stop)
    }
    const engine = createWorkspaceSync({
      refresh: () => refreshRef.current(),
      environment: {
        available: () => !document.hidden && navigator.onLine !== false,
        schedule: (callback, delay) => window.setTimeout(callback, delay),
        cancel: (timer) => window.clearTimeout(timer as number),
      },
      onError: (failed) => { readFailed = failed; if (alive) setError(failed || failedKeys.size > 0) },
      onAccept: (state) => {
        const branchKeys = new Set(Object.keys(state.branchVersions || {}).map((id) => `branch:${id}`))
        for (const [key, stop] of subscriptions) if (key.startsWith('branch:') && !branchKeys.has(key)) {
          stop(); subscriptions.delete(key); paths.delete(key); failedKeys.delete(key)
        }
        for (const id of Object.keys(state.branchVersions || {})) {
          const key = `branch:${id}`
          if (!paths.has(key)) { const path = `workspaceBranchChanges/${id}`; paths.set(key, path); attach(key, path) }
        }
        if (alive) setError(readFailed || failedKeys.size > 0)
      },
    })
    engineRef.current = engine
    const reconnect = () => {
      for (const key of failedKeys) { subscriptions.get(key)?.(); attach(key, paths.get(key)!) }
    }
    const resume = () => {
      if (document.hidden || navigator.onLine === false) return
      reconnect(); engine.resume()
    }
    retryRef.current = () => { reconnect(); engine.retry() }
    paths.forEach((path, key) => attach(key, path))
    document.addEventListener('visibilitychange', resume)
    window.addEventListener('online', resume)
    engine.retry()
    return () => {
      alive = false; engine.stop(); subscriptions.forEach((stop) => stop())
      document.removeEventListener('visibilitychange', resume); window.removeEventListener('online', resume)
      if (engineRef.current === engine) { engineRef.current = null; retryRef.current = () => {} }
    }
  }, [accountId, domain, enabled, scopeKey])
  return {
    error,
    accept: useCallback((state: WorkspaceSyncState | undefined) => engineRef.current?.accept(state), []),
    failed: useCallback(() => engineRef.current?.fail(), []),
    retry: useCallback(() => retryRef.current(), []),
  }
}
