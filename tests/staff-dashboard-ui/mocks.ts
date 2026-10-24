import { useSyncExternalStore } from 'react'
import type { StaffPosition } from '../../src/identity/access'

const options = (window as any).dashboardOptions || {}
let identity = {
  user: { uid: 'pt-a' }, authzReady: true,
  accessContext: { uid: 'pt-a', authzVersion: 1, status: 'active', branchIds: ['branch-a'], capabilities: options.capabilities || ['payroll.self.view', 'performance.self.view'], positions: (options.positions || ['trainer_pt']) as StaffPosition[] },
}
const listeners = new Set<() => void>()
export function useAuth() { return useSyncExternalStore((notify) => { listeners.add(notify); return () => { listeners.delete(notify) } }, () => identity) }
export const useWorkspaceAccountId = () => useAuth().user.uid
export const useAuraUiSurface = () => Boolean(options.actionCenter)
export const firebaseFunctions = {}
const calls: Array<{ kind: string; key: string; uid: string }> = []
const pending: Array<{ kind: string; uid: string; key: string; resolve: () => void }> = []
const formatDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' })
function response(kind: string, key: string, uid: string): any {
  if (kind === 'workspace') return {
    schemaVersion: 4, scope: { staffId: uid, counts: { primaryStudents: 2, secondaryStudents: 1, pendingRequests: 0 } },
    sessions: [{ id: `${uid}-session`, studentId: `${uid}-student`, studentName: `${uid} Student`, trainerId: uid, date: key, hour: 8, status: 'scheduled', attendanceStatus: 'pending', timeZone: 'Asia/Ho_Chi_Minh' }],
    hasMore: options.hasMore === true,
  }
  if (kind === 'payroll') return { periodId: key, amounts: { baseSalaryAmount: key === '2026-11' ? 456000 : 123000, teachingPayAmount: 45000 }, workdays: { days: [] }, teachingSlots: [], run: { official: false } }
  if (kind === 'performance') return { periodId: key, score: { value: 80, provisionalValue: 80 }, coverage: { availableWeight: 100, confidence: 'high' }, bonus: { classification: `${uid} Strong`, recommendedAmount: 0 }, brand: { total: 5 }, evidence: { pending: 0 }, gates: [] }
  if (kind === 'sales') return { quotes: [], catalog: { branches: [], packages: [] } }
  if (kind === 'actions') return { rows: [], nextCursor: null, hasMore: false }
  if (kind === 'summary') return { total: 0 }
  throw new Error('Unexpected read')
}
async function read(kind: string, key = '') {
  const uid = identity.user.uid
  calls.push({ kind, key, uid })
  const ordinal = calls.filter((call) => call.kind === kind).length
  if (options.failFirst?.includes(kind) && ordinal === 1) throw new Error(`Retry ${kind}`)
  if (options.defer?.includes(kind)) return new Promise((resolve) => pending.push({ kind, uid, key, resolve: () => resolve(response(kind, key, uid)) }))
  return response(kind, key, uid)
}
export const getMyTrainerDashboard = (day: string) => read('workspace', day)
export const getMyStaffPayroll = (period: string) => read('payroll', period)
export const getMyPerformanceScore = (period: string) => read('performance', period)
export const getMySalesWorkspace = () => read('sales')
export const listOperationalActions = () => read('actions')
export const getOperationalActionSummary = () => read('summary')
const unexpectedWrite = async () => { throw new Error('Unexpected write') }
export const claimOperationalAction = unexpectedWrite, resolveOperationalAction = unexpectedWrite, snoozeOperationalAction = unexpectedWrite
Object.assign(window, { dashboardHarness: {
  calls,
  date: () => formatDate.format(new Date()),
  update: (values: { uid?: string; branches?: string[]; capabilities?: string[]; positions?: StaffPosition[]; active?: boolean; authzReady?: boolean }) => {
    identity = { ...identity, user: { uid: values.uid || identity.user.uid }, authzReady: values.authzReady ?? identity.authzReady, accessContext: { ...identity.accessContext, uid: values.uid || identity.user.uid, authzVersion: identity.accessContext.authzVersion + 1, status: values.active === false ? 'suspended' : 'active', branchIds: values.branches || identity.accessContext.branchIds, capabilities: values.capabilities || identity.accessContext.capabilities, positions: values.positions || identity.accessContext.positions } }
    listeners.forEach((notify) => notify())
  },
  resolve: (kind: string, uid?: string, key?: string) => {
    const index = pending.findIndex((item) => item.kind === kind && (!uid || item.uid === uid) && (!key || item.key === key))
    if (index < 0) throw new Error(`Missing pending ${kind} ${uid}`)
    pending.splice(index, 1)[0].resolve()
  },
} })
