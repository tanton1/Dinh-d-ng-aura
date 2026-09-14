import type { PtScheduleOptimizationSummary, PtScheduleUnassignedEntry } from '../../services/ptSchedulePublishService'

type SearchLimitEntry = Pick<PtScheduleUnassignedEntry, 'blockerType' | 'primaryReasonCode' | 'reasonCodes'>

/**
 * A search budget is an implementation safeguard, not an operational issue by
 * itself. Surface it only when the bounded search left an actionable learner
 * unresolved; otherwise old drafts can keep a stale flag forever and distract
 * the scheduler from contract/availability warnings.
 */
export function hasActionableSearchLimit(
  summary?: Pick<PtScheduleOptimizationSummary, 'rescueSearchLimitReached' | 'repairSearchLimitReached' | 'optimalityGap'> | null,
  entries?: SearchLimitEntry[] | null,
) {
  const reached = summary?.rescueSearchLimitReached === true || summary?.repairSearchLimitReached === true
  if (!reached) return false
  if (Array.isArray(entries) && entries.length > 0) {
    return entries.some((entry) => entry.blockerType === 'search_limit_reached'
      || entry.primaryReasonCode === 'SEARCH_LIMIT_REACHED'
      || entry.reasonCodes?.includes('SEARCH_LIMIT_REACHED'))
  }
  return Number(summary?.optimalityGap || 0) > 0
}
