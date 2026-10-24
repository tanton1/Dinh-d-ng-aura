import { useEffect, useState } from 'react'
import type { OperationalAction } from '../../src/services/actionCenterService'
const state = window as any
state.fixtureUid ||= 'account-a'
state.actionFixture = { calls: [], pending: [], changed: new Map(), ...(state.actionOptions || {}) }
const fixture = state.actionFixture
export const firebaseFunctions = {}
export function useWorkspaceAccountId() {
  const [uid, setUid] = useState(state.fixtureUid)
  useEffect(() => { const update = () => setUid(state.fixtureUid); window.addEventListener('fixture-account', update); return () => window.removeEventListener('fixture-account', update) }, [])
  return uid
}
function row(index: number, uid: string): OperationalAction {
  const actionId = `${uid}-${index}`
  return { actionId, sourceType: 'contract', sourceId: 'contract', actionType: 'renewal', branchId: 'branch', studentId: 'student', severity: index % 2 ? 'warning' : 'critical', status: fixture.changed.get(actionId) || 'open', title: `${uid} Action ${index}`, redactedSummary: 'Test action', dueAt: null, assignedUid: null, availableActions: [], createdAt: null, updatedAt: null, claimedAt: null, resolvedAt: null }
}
function invoke<T>(kind: string, input: unknown, value: T): Promise<T> {
  fixture.calls.push({ kind, input, uid: state.fixtureUid })
  if (fixture.defer?.includes(kind)) return new Promise<T>((resolve, reject) => fixture.pending.push({ kind, uid: state.fixtureUid, finish: () => resolve(value), resolve, reject }))
  return Promise.resolve(value)
}
export function listOperationalActions(input: { pageSize: number; cursor?: string }) {
  const uid = state.fixtureUid
  const rows = (input.cursor ? [5, 6, 7, 8] : [1, 2, 3, 4, 5]).map((index) => row(index, uid)).filter((item) => !['resolved', 'snoozed'].includes(item.status))
  return invoke('list', input, { schemaVersion: 1, rows, nextCursor: input.cursor ? null : 'page-2', hasMore: !input.cursor })
}
export function getOperationalActionSummary() {
  const removed = [...fixture.changed.values()].filter((value) => value === 'resolved' || value === 'snoozed').length
  return invoke('summary', {}, { schemaVersion: 1, total: 9 - removed, critical: 4, warning: 5 - removed, info: 0 })
}
function mutation(kind: string, actionId: string, status: string) {
  fixture.changed.set(actionId, status)
  const index = Number(actionId.split('-').at(-1))
  return invoke(kind, { actionId }, row(index, state.fixtureUid))
}
export const claimOperationalAction = (id: string) => mutation('claim', id, 'in_progress')
export const resolveOperationalAction = (id: string) => mutation('resolve', id, 'resolved')
export const snoozeOperationalAction = (id: string) => mutation('snooze', id, 'snoozed')
