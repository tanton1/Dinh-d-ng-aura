import { useMemo, useRef } from 'react'
import type { PtScheduleWorkspaceV2Result } from '../../services/ptSchedulePublishService'
import { calculateScheduleOpportunities, groupScheduleOpportunities, type OpportunityStudentRow } from './opportunities'
import { beginScheduleTiming } from './performance'

export function useScheduleOpportunities(workspace: PtScheduleWorkspaceV2Result | null, enabled: boolean,
  studentRows: OpportunityStudentRow[], studentId: string, dates: Record<string, { full: string }>, days: string[], hours: number[]) {
  // Component-scoped cache: no learner data survives through a global UID cache.
  // Keep the last few tab/learner views so returning to Kho ca is instant after
  // the first calculation. The workspace revision is part of the key, so a
  // draft update can never display stale opportunities.
  const resultCache = useRef(new WeakMap<PtScheduleWorkspaceV2Result, Map<string, ReturnType<typeof calculateScheduleOpportunities>>>())
  const items = useMemo(() => {
    if (!workspace || !enabled) return []
    const key = `${studentId}|${days.join(',')}|${hours.join(',')}`
    const workspaceCache = resultCache.current.get(workspace) || new Map<string, ReturnType<typeof calculateScheduleOpportunities>>()
    resultCache.current.set(workspace, workspaceCache)
    const cached = workspaceCache.get(key)
    if (cached) return cached
    const finish = beginScheduleTiming('opportunities')
    try {
      const next = calculateScheduleOpportunities({ workspace, studentRows, studentId, dates, days, hours })
      workspaceCache.set(key, next)
      while (workspaceCache.size > 6) workspaceCache.delete(workspaceCache.keys().next().value!)
      return next
    } finally { finish() }
  },
  [workspace, enabled, studentRows, studentId, dates, days, hours])
  const bySlot = useMemo(() => groupScheduleOpportunities(items), [items])
  return { items, bySlot }
}
