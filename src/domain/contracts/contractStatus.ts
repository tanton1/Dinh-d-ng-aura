import type { StudentContract } from '../../types'

export type EffectiveContractStatus = StudentContract['status'] | 'inactive' | 'archived' | 'draft' | 'invalid'

export function normalizedContractDate(value: unknown) {
  if (typeof value !== 'string') return ''
  const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})/)
  return match ? `${match[1]}-${match[2]}-${match[3]}` : ''
}

export function effectiveContractStatus(
  contract: Pick<StudentContract, 'status' | 'startDate' | 'endDate'> & { renewalSupersededBy?: string; renewedByContractId?: string },
  referenceDate: string,
): EffectiveContractStatus {
  const stored = String(contract.status || 'active').toLowerCase() as EffectiveContractStatus
  if (['cancelled', 'inactive', 'archived', 'draft', 'frozen'].includes(stored)) return stored
  if (stored === 'expired' && (contract.renewalSupersededBy || contract.renewedByContractId)) return 'expired'
  const date = normalizedContractDate(referenceDate)
  const start = normalizedContractDate(contract.startDate)
  const end = normalizedContractDate(contract.endDate)
  if (!date || !start || !end || start > end) return 'invalid'
  if (date < start) return 'future'
  if (date > end) return 'expired'
  return 'active'
}

export function contractPausedOn(contract: StudentContract, date: string) {
  if (String(contract.status).toLowerCase() === 'frozen') return true
  return (contract.pausePeriods || []).some((period) => {
    const start = normalizedContractDate(period.startDate)
    const end = normalizedContractDate(period.endDate)
    return Boolean(start && end && start <= date && end >= date)
  })
}

export function contractSchedulableOn(contract: StudentContract, date: string) {
  return effectiveContractStatus(contract, date) === 'active' && !contractPausedOn(contract, date)
}
