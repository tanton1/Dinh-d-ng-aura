import type { AdminUserRecord, PushAdminOverview, PushAutomationLog, PushBroadcastLog, PushDispatchResult, PushTemplate, SystemPushSettings } from '../../src/types'
import { AURA_UI_SURFACES } from '../../src/features/ui-rollout/types'

type Call = { name: string; owner: string; authzVersion: number; input?: unknown }
type Pending = { name: string; owner: string; resolve: () => void }
type Subscription = { owner: string; callback: (users: AdminUserRecord[]) => void; closed: boolean }
const clone = <T,>(value: T): T => structuredClone(value)

export const DEFAULT_PUSH_SETTINGS: SystemPushSettings = {
  enabled: true, automationEnabled: true, vapidPublicKey: '', fcmSenderId: '', fcmProjectId: '',
  autoMealReminders: true, mealReminderTimes: { breakfast: '07:30', lunch: '12:00', dinner: '18:30' },
  workoutReminderTime: '17:00', weeklyProgressReviewDay: 'monday', timezone: 'Asia/Ho_Chi_Minh',
  quietHoursStart: '21:30', quietHoursEnd: '07:00', maxDailyPerUser: 3, soundEnabled: true, badgeEnabled: true,
}

export const usersFor = (owner: string): AdminUserRecord[] => [{
  uid: owner === 'admin-a' ? 'student-a' : 'student-b', displayName: owner === 'admin-a' ? 'Student Alpha' : 'Student Beta',
  email: 'fixture@example.invalid', role: 'student', status: 'active',
}]
const makeTemplate = (owner: string): PushTemplate => ({
  id: `${owner}-template`, title: owner === 'admin-a' ? 'Alpha template' : 'Beta template',
  message: 'Fixture reminder only', type: 'INFO', category: 'general', targetGoal: 'all', actionUrl: '/home', active: true,
  createdAt: '2026-10-30T01:00:00Z',
})
const makeBroadcast = (owner: string, page: number): PushBroadcastLog => ({
  id: `${owner}-notice-${page}`, title: `${owner === 'admin-a' ? 'Alpha' : 'Beta'} notice ${page}`,
  message: 'Saved fixture content', type: 'INFO', targetType: 'all', category: 'general',
  actionUrl: '/home', sentCount: 2, webPushSentCount: 2, webPushFailureCount: page === 2 ? 1 : 0,
  createdAt: `2026-10-${page === 1 ? '30' : '29'}T01:00:00Z`, sentBy: owner,
})

export const state = {
  owner: 'admin-a', authzVersion: 1, calls: [] as Call[], held: new Set<string>(new URLSearchParams(location.search).getAll('hold')), pending: [] as Pending[],
  failures: Object.fromEntries(new URLSearchParams(location.search).getAll('fail').map(name => [name, true])) as Record<string, boolean>, subscriptions: [] as Subscription[],
  userStarts: 0, userStops: 0,
  dispatchRejection: null as { code: string; message: string; details?: object } | null,
  dispatchResult: null as PushDispatchResult | null,
  settings: clone(DEFAULT_PUSH_SETTINGS), templates: [makeTemplate('admin-a')],
  release(name: string, owner?: string) {
    const pending = state.pending.filter(item => item.name === name && (!owner || item.owner === owner))
    state.pending = state.pending.filter(item => !pending.includes(item))
    for (const item of pending) item.resolve()
  },
  emitLateUsers(owner: string) {
    for (const item of state.subscriptions.filter(item => item.owner === owner)) item.callback(usersFor(owner))
  },
}
Object.assign(window, { notificationFixture: state })

function record(name: string, input?: unknown) {
  state.calls.push({ name, owner: state.owner, authzVersion: state.authzVersion, input: clone(input) })
}
async function read<T>(name: string, value: T, input?: unknown): Promise<T> {
  record(name, input)
  const captured = clone(value)
  if (state.held.has(name)) await new Promise<void>(resolve => state.pending.push({ name, owner: state.owner, resolve }))
  if (state.failures[name]) throw new Error(`Fixture ${name} unavailable`)
  return captured
}

export function getSystemPushSettings(options?: { requireServer?: boolean }) { return read('settings', state.settings, options) }
export function getPushAdminOverview(options?: { forceRefresh?: boolean }) {
  const overview: PushAdminOverview = {
    activeUsers: (state.owner === 'admin-a' ? 111 : 222) + (state.authzVersion - 1) * 10,
    pushEnabledUsers: 2, activeDevices: 3, webPushAccepted24h: 4, webPushFailures24h: 1,
    latestAutomationAt: '2026-10-30T01:00:00Z',
    asOf: '2026-10-30T02:00:00Z', windowStart: '2026-10-29T02:00:00Z',
  }
  return read('overview', overview, options)
}
export function getPushTemplates() {
  return read('templates', state.owner === 'admin-a' ? state.templates : [makeTemplate(state.owner)])
}
export type PushBroadcastCursor = { fixturePage: number }
export function getPushBroadcastLogsPage(input: { cursor?: PushBroadcastCursor | null; pageSize?: number } = {}) {
  const page = input.cursor?.fixturePage ?? 1
  return read('broadcasts', { items: [makeBroadcast(state.owner, page)], hasMore: page === 1, nextCursor: page === 1 ? { fixturePage: 2 } : null }, input)
}
export async function getPushBroadcastLogs() { return (await getPushBroadcastLogsPage()).items }
export function getPushAutomationLogs(...args: unknown[]) {
  const row: PushAutomationLog = {
    id: `${state.owner}-automation`, evaluatedUsers: 3, candidates: 2, createdNotifications: 2,
    webPushSentCount: 2, webPushFailureCount: 0, removedInvalidDevices: 0, createdAt: '2026-10-30T02:00:00Z',
  }
  return read('automations', [row], args)
}
export function subscribeToAdminUsers(callback: (users: AdminUserRecord[]) => void) {
  record('users')
  const subscription = { owner: state.owner, callback, closed: false }
  state.subscriptions.push(subscription); state.userStarts++
  queueMicrotask(() => { if (!subscription.closed) callback(usersFor(subscription.owner)) })
  return () => { if (!subscription.closed) { subscription.closed = true; state.userStops++ } }
}
export async function saveSystemPushSettings(settings: SystemPushSettings) {
  record('saveSettings', settings); state.settings = clone(settings)
}
export async function savePushTemplate(template: PushTemplate) {
  record('saveTemplate', template)
  if (state.failures.saveTemplate) throw new Error('Fixture saveTemplate unavailable')
  state.templates = [...state.templates.filter(row => row.id !== template.id), clone(template)]
}
export async function deletePushTemplate(id: string) { record('deleteTemplate', id); if (state.failures.deleteTemplate) throw new Error('Fixture deleteTemplate unavailable'); state.templates = state.templates.filter(row => row.id !== id) }
export async function togglePushTemplateActive(id: string, active: boolean) {
  record('toggleTemplate', { id, active }); if (state.failures.toggleTemplate) throw new Error('Fixture toggleTemplate unavailable'); state.templates = state.templates.map(row => row.id === id ? { ...row, active } : row)
}
export async function dispatchAdminPushBroadcast(input: unknown): Promise<PushDispatchResult> {
  const result = await read('dispatch', state.dispatchResult ?? { sentCount: 1, webPushSentCount: 1, webPushFailureCount: 0, filteredOutCount: 0, logId: 'fixture-sent' }, input)
  if (state.dispatchRejection) throw Object.assign(new Error(state.dispatchRejection.message), state.dispatchRejection)
  return result
}
export function getStoredFcmToken() { return null }
export async function requestFcmPermissionAndToken() { record('registerDevice'); return 'fixture-only-token' }

const rolloutConfig = { schemaVersion: 1 as const, surfaces: Object.fromEntries(AURA_UI_SURFACES.map(surface => [surface, 'off'])), updatedAt: '', updatedBy: '' }
export function useAuraUiRollout() { return { config: rolloutConfig, loading: false, error: null } }
export async function loadAuraUiAssignment() { record('loadAssignment'); return null }
export async function saveAuraUiAssignment() { throw new Error('Rollout mutation is outside this fixture') }
export async function saveAuraUiRolloutConfig() { throw new Error('Rollout mutation is outside this fixture') }
