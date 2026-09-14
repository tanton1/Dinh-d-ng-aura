export type ScheduleEmploymentType = 'full_time' | 'part_time' | 'collaborator'

export interface ScheduleLoadPolicy {
  schemaVersion: 1
  defaultDailyTargets: Record<ScheduleEmploymentType, number>
}

export const SCHEDULE_EMPLOYMENT_TYPES = ['full_time', 'part_time', 'collaborator'] as const
export type ScheduleLoadPolicyInput = { schemaVersion?: 1; defaultDailyTargets?: Partial<Record<ScheduleEmploymentType, number>> }

export function normalizeScheduleLoadPolicy(value?: ScheduleLoadPolicyInput | null): ScheduleLoadPolicy {
  const target = (type: ScheduleEmploymentType) => {
    const number = Number(value?.defaultDailyTargets?.[type])
    return Number.isInteger(number) && number >= 1 && number <= 12 ? number : 8
  }
  return { schemaVersion: 1, defaultDailyTargets: {
    full_time: target('full_time'), part_time: target('part_time'), collaborator: target('collaborator'),
  } }
}

/** A reference for balancing, never a capacity/eligibility restriction. */
export function trainerDailyLoadTarget(trainer: { dailySessionTarget?: number; employmentType?: string }, policy?: ScheduleLoadPolicyInput | null) {
  const type = SCHEDULE_EMPLOYMENT_TYPES.includes(trainer.employmentType as ScheduleEmploymentType)
    ? trainer.employmentType as ScheduleEmploymentType : 'full_time'
  const fallback = normalizeScheduleLoadPolicy(policy).defaultDailyTargets[type]
  return Math.max(1, Math.min(12, Math.trunc(Number(trainer.dailySessionTarget ?? fallback) || fallback)))
}
