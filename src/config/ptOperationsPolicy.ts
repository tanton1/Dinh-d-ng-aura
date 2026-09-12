import type { ScheduleConfig } from '../types/ptOperations'

export const PT_OPERATIONS_POLICY_DEFAULTS = {
  complimentaryChangeCancelPerMonth: 1,
  sessionChangeDeadlineHours: 24,
  offMaxDaysPerRequest: 14,
  offRegistrationCutoffHour: 9,
  availabilityRegistrationCutoffDayOfWeek: 0,
  availabilityRegistrationCutoffHour: 10,
  offLimitsByDuration: {
    threeMonths: 2,
    sixMonths: 3,
    twelveMonths: 5,
  },
} as const

export type PtOperationsPolicyDraft = Required<Pick<ScheduleConfig,
  | 'complimentaryChangeCancelPerMonth'
  | 'sessionChangeDeadlineHours'
  | 'offMaxDaysPerRequest'
  | 'offRegistrationCutoffHour'
  | 'availabilityRegistrationCutoffDayOfWeek'
  | 'availabilityRegistrationCutoffHour'
  | 'offLimitsByDuration'
>>

export function ptOperationsPolicyFromConfig(config?: Partial<ScheduleConfig> | null): PtOperationsPolicyDraft {
  const nested = config?.operationsPolicy?.values
  // The top-level shape is still the editable wire contract. It must win over
  // an older nested snapshot while an Admin is migrating or saving policy.
  const source = { ...nested, ...config }
  return {
    complimentaryChangeCancelPerMonth: Number.isInteger(Number(source.complimentaryChangeCancelPerMonth))
      ? Number(source.complimentaryChangeCancelPerMonth)
      : PT_OPERATIONS_POLICY_DEFAULTS.complimentaryChangeCancelPerMonth,
    sessionChangeDeadlineHours: Number.isInteger(Number(source.sessionChangeDeadlineHours))
      ? Number(source.sessionChangeDeadlineHours)
      : PT_OPERATIONS_POLICY_DEFAULTS.sessionChangeDeadlineHours,
    offMaxDaysPerRequest: Number.isInteger(Number(source.offMaxDaysPerRequest))
      ? Number(source.offMaxDaysPerRequest)
      : PT_OPERATIONS_POLICY_DEFAULTS.offMaxDaysPerRequest,
    offRegistrationCutoffHour: Number.isInteger(Number(source.offRegistrationCutoffHour))
      ? Number(source.offRegistrationCutoffHour)
      : PT_OPERATIONS_POLICY_DEFAULTS.offRegistrationCutoffHour,
    availabilityRegistrationCutoffDayOfWeek: Number.isInteger(Number(source.availabilityRegistrationCutoffDayOfWeek))
      ? Number(source.availabilityRegistrationCutoffDayOfWeek)
      : PT_OPERATIONS_POLICY_DEFAULTS.availabilityRegistrationCutoffDayOfWeek,
    availabilityRegistrationCutoffHour: Number.isInteger(Number(source.availabilityRegistrationCutoffHour))
      ? Number(source.availabilityRegistrationCutoffHour)
      : PT_OPERATIONS_POLICY_DEFAULTS.availabilityRegistrationCutoffHour,
    offLimitsByDuration: {
      threeMonths: Number.isInteger(Number(source.offLimitsByDuration?.threeMonths))
        ? Number(source.offLimitsByDuration?.threeMonths)
        : PT_OPERATIONS_POLICY_DEFAULTS.offLimitsByDuration.threeMonths,
      sixMonths: Number.isInteger(Number(source.offLimitsByDuration?.sixMonths))
        ? Number(source.offLimitsByDuration?.sixMonths)
        : PT_OPERATIONS_POLICY_DEFAULTS.offLimitsByDuration.sixMonths,
      twelveMonths: Number.isInteger(Number(source.offLimitsByDuration?.twelveMonths))
        ? Number(source.offLimitsByDuration?.twelveMonths)
        : PT_OPERATIONS_POLICY_DEFAULTS.offLimitsByDuration.twelveMonths,
    },
  }
}
