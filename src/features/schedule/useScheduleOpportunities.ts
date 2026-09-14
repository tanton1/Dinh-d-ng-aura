import { useMemo } from 'react'
import type { PtScheduleWorkspaceV2Result } from '../../services/ptSchedulePublishService'
import { calculateScheduleOpportunities, groupScheduleOpportunities, type OpportunityStudentRow } from './opportunities'
import { beginScheduleTiming } from './performance'

export function useScheduleOpportunities(workspace: PtScheduleWorkspaceV2Result | null, enabled: boolean,
  studentRows: OpportunityStudentRow[], studentId: string, dates: Record<string, { full: string }>, days: string[], hours: number[]) {
  // Component-scoped cache: no learner data survives through a global UID cache.
  const items = useMemo(() => {
    if (!workspace || !enabled) return []
    const finish = beginScheduleTiming('opportunities')
    try { return calculateScheduleOpportunities({ workspace, studentRows, studentId, dates, days, hours }) }
    finally { finish() }
  },
  [workspace, enabled, studentRows, studentId, dates, days, hours])
  const bySlot = useMemo(() => groupScheduleOpportunities(items), [items])
  return { items, bySlot }
}
