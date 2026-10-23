import type { StudentContract } from '../../types'

export type EffectiveContractStatus = StudentContract['status'] | 'inactive' | 'archived' | 'draft' | 'invalid'

export function normalizedContractDate(value: unknown) {
  if (typeof value !== 'string') return ''
  const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})/)
  return match ? `${match[1]}-${match[2]}-${match[3]}` : ''
}

export function effectiveContractStatus(
  contract: Pick<StudentContract, 'status' | 'startDate' | 'endDate'> & { renewalSupersededBy?: string; renewedByContractId?: string; sourceContractId?: string; handoverStatus?: string },
  referenceDate: string,
): EffectiveContractStatus {
  const stored = String(contract.status || 'active').toLowerCase() as EffectiveContractStatus
  if (['cancelled', 'inactive', 'archived', 'draft', 'frozen'].includes(stored)) return stored
  if (contract.sourceContractId && contract.handoverStatus === 'pending') return 'future'
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

/** Pending renewals can accept reservations; this does not activate the contract. */
export function contractSchedulableInChainOn(contract: StudentContract, contracts: StudentContract[], date: string) {
  if (contract.status !== 'future' || !contract.sourceContractId) return contractSchedulableOn(contract, date)
  const source = contracts.find((item) => item.id === contract.sourceContractId && item.studentId === contract.studentId && item.branchId === contract.branchId)
  if (!source || ['cancelled', 'frozen'].includes(source.status) || source.renewalSupersededBy
    || contractPausedOn(source, date) || contractPausedOn(contract, date)
    || date < source.startDate || date > contract.endDate || (contract.signedDate && date < contract.signedDate)) return false
  const automatic = contract.activationMode !== 'fixed_date' && contract.earlyHandoverRequested !== false
  const remaining = Math.max(0, source.totalSessions - source.usedSessions - (source.carryOverTransferredSessions || 0))
  return automatic
    ? (date > source.endDate || remaining === 0)
    : date >= contract.startDate
}
