/** Weekly snapshots have their own East-region pool. A logical base name
 * must never fall through to the default Singapore Functions client.
 * Maintenance endpoints remain available for explicit operator workflows;
 * they are commands and must not be retried automatically. */
export const weeklyScheduleEndpoints = {
  getPtScheduleWeeklyView: {
    callableName: 'getPtScheduleWeeklyViewRegional',
    region: 'asia-east1',
    operation: 'read',
    maximumAttempts: 2,
    timeoutMs: 20_000,
    fallback: null,
  },
  rebuildPtScheduleWeeklyView: {
    callableName: 'rebuildPtScheduleWeeklyView',
    region: 'asia-east1',
    operation: 'maintenance-command',
    maximumAttempts: 1,
    timeoutMs: 60_000,
    fallback: null,
  },
  markPtScheduleWeeklyViewDirty: {
    callableName: 'markPtScheduleWeeklyViewDirty',
    region: 'asia-east1',
    operation: 'maintenance-command',
    maximumAttempts: 1,
    timeoutMs: 60_000,
    fallback: null,
  },
} as const

export type WeeklyScheduleOperation = keyof typeof weeklyScheduleEndpoints

export function weeklyScheduleEndpoint(name: string) {
  return Object.prototype.hasOwnProperty.call(weeklyScheduleEndpoints, name)
    ? weeklyScheduleEndpoints[name as WeeklyScheduleOperation]
    : undefined
}
