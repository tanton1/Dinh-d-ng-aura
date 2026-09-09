'use strict'

const TERMINAL_CONTRACT_STATUSES = new Set(['cancelled', 'inactive', 'archived', 'draft'])
const STORED_CONTRACT_STATUSES = new Set(['active', 'future', 'expired', 'frozen', ...TERMINAL_CONTRACT_STATUSES])

function contractDateKey(value) {
  if (typeof value !== 'string') return ''
  const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})/)
  return match ? `${match[1]}-${match[2]}-${match[3]}` : ''
}

function normalizedContractStatus(value) {
  const status = String(value || 'active').trim().toLowerCase()
  return STORED_CONTRACT_STATUSES.has(status) ? status : 'active'
}

/**
 * Canonical operational status. Dates own active/future/expired; explicit
 * workflow states (cancelled/frozen/draft/inactive/archived) are preserved.
 * Invalid dates are surfaced instead of silently making a contract active.
 */
function effectiveContractStatus(contract = {}, referenceDate) {
  const storedStatus = normalizedContractStatus(contract.status)
  // A source contract explicitly superseded by a renewal stays expired. A
  // plain stale `expired` flag is derived again from its dates, so an approved
  // extension/reopen can correctly make it active.
  if (TERMINAL_CONTRACT_STATUSES.has(storedStatus) || storedStatus === 'frozen') return storedStatus
  if (storedStatus === 'expired' && (contract.renewalSupersededBy || contract.renewedByContractId)) return 'expired'

  const date = contractDateKey(referenceDate)
  const startDate = contractDateKey(contract.startDate)
  const endDate = contractDateKey(contract.endDate)
  if (!date || !startDate || !endDate || startDate > endDate) return 'invalid'
  if (date < startDate) return 'future'
  if (date > endDate) return 'expired'
  return 'active'
}

function contractStatusProjection(contract = {}, referenceDate) {
  const storedStatus = normalizedContractStatus(contract.status)
  const effectiveStatus = effectiveContractStatus(contract, referenceDate)
  return {
    storedStatus,
    effectiveStatus,
    statusMismatch: effectiveStatus !== 'invalid' && effectiveStatus !== storedStatus,
    validDates: Boolean(contractDateKey(contract.startDate)
      && contractDateKey(contract.endDate)
      && contractDateKey(contract.startDate) <= contractDateKey(contract.endDate)),
  }
}

function contractEffectiveOnDate(contract = {}, date) {
  return effectiveContractStatus(contract, date) === 'active'
}

function contractPausedOn(contract = {}, date) {
  if (normalizedContractStatus(contract.status) === 'frozen') return true
  const target = contractDateKey(date)
  if (!target) return false
  return Array.isArray(contract.pausePeriods) && contract.pausePeriods.some((period) => {
    const startDate = contractDateKey(period?.startDate)
    const endDate = contractDateKey(period?.endDate)
    return Boolean(startDate && endDate && startDate <= target && endDate >= target)
  })
}

function contractSchedulableOn(contract = {}, date) {
  return contractEffectiveOnDate(contract, date) && !contractPausedOn(contract, date)
}

module.exports = {
  TERMINAL_CONTRACT_STATUSES,
  contractDateKey,
  contractEffectiveOnDate,
  contractPausedOn,
  contractSchedulableOn,
  contractStatusProjection,
  effectiveContractStatus,
  normalizedContractStatus,
}
