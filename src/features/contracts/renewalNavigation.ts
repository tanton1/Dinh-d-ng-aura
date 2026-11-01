import type { RenewalListInput } from '../../services/contractRenewalService'

export type RenewalSource = 'admin-renewals' | 'staff-renewals'
export type RenewalTab = 'queue' | 'pipeline' | 'calendar' | 'report'
export interface RenewalReturnState {
  tab: RenewalTab
  search: string
  risk: NonNullable<RenewalListInput['risk']>
  stage: NonNullable<RenewalListInput['stage']>
  sla: NonNullable<RenewalListInput['sla']>
  approval: NonNullable<RenewalListInput['approval']>
  branchId: string
  assigneeId: string
  sort: NonNullable<RenewalListInput['sort']>
  segment: NonNullable<RenewalListInput['segment']>
  filtersOpen: boolean
  reportFrom: string
  reportTo: string
}

const key = (source: RenewalSource, actorId: string) => `aura:student-360:return:${source}:${actorId}`
const choices = {
  tab: ['queue', 'pipeline', 'calendar', 'report'],
  risk: ['all', 'expired', 'exhausted', 'critical', 'upcoming', 'early'],
  stage: ['all', 'uncontacted', 'contacted', 'interested', 'quote_sent', 'follow_up', 'won', 'lost'],
  sla: ['all', 'overdue', 'due_today', 'upcoming', 'done'],
  approval: ['all', 'pending', 'approved', 'rejected', 'consumed', 'none'],
  sort: ['priority', 'value', 'follow_up'],
  segment: ['all', 'expiring_30d', 'exhausted_active', 'expired_last_30d', 'in_care'],
}

// Remember UI choices only. Rows, permissions and balances are read normally
// when returning, so a contract changed in 360 cannot leave stale queue data.
export function readRenewalReturnState(source: RenewalSource, actorId: string): Partial<RenewalReturnState> {
  try {
    // Explicit dashboard deep links take priority over a previous visit.
    if (new URLSearchParams(window.location.hash.split('?')[1] || '').has('focus')) return {}
    const saved = JSON.parse(window.sessionStorage.getItem(key(source, actorId)) || 'null')
    if (!saved || typeof saved.savedAt !== 'number' || Date.now() - saved.savedAt > 30 * 60_000) return {}
    const state: Record<string, unknown> = {}
    for (const [field, allowed] of Object.entries(choices)) {
      if (allowed.includes(saved[field])) state[field] = saved[field]
    }
    for (const field of ['search', 'branchId', 'assigneeId']) {
      if (typeof saved[field] === 'string' && saved[field].length <= 200) state[field] = saved[field]
    }
    for (const field of ['reportFrom', 'reportTo']) {
      if (typeof saved[field] === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(saved[field])) state[field] = saved[field]
    }
    if (typeof saved.filtersOpen === 'boolean') state.filtersOpen = saved.filtersOpen
    return state as Partial<RenewalReturnState>
  } catch { return {} }
}

export function saveRenewalReturnState(source: RenewalSource, actorId: string, state: RenewalReturnState) {
  try { window.sessionStorage.setItem(key(source, actorId), JSON.stringify({ ...state, savedAt: Date.now() })) }
  catch { /* Storage restrictions must never block opening a student's profile. */ }
}
