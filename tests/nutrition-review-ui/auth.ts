import { useSyncExternalStore } from 'react'

let version = 1
let uid = 'coach-1'
Object.assign(window, { reviewAuth: { change(nextUid: string, nextVersion: number) {
  uid = nextUid; version = nextVersion; window.dispatchEvent(new Event('review-auth-change'))
} } })
const subscribe = (callback: () => void) => { window.addEventListener('review-auth-change', callback); return () => window.removeEventListener('review-auth-change', callback) }
export function useAuth() {
  useSyncExternalStore(subscribe, () => `${uid}:${version}`)
  return { user: { uid }, authzReady: true, accessContext: { uid, authzVersion: version, status: 'active', capabilities: ['nutrition.meals.all.review'], branchIds: [] } }
}
