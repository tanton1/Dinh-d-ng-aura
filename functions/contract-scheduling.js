'use strict'

const {
  contractEffectiveOnDate,
  contractPausedOn,
  normalizedContractStatus,
} = require('./contract-status')

const { renewalDateSyncPatch } = require('./contract-renewal-handover')

const BLOCKED_SCHEDULING_STATUSES = new Set(['cancelled', 'inactive', 'archived', 'draft', 'frozen'])

function safeSessionCount(value) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0
}

/**
 * A pending renewal stores the projected carry-over in totalSessions so the
 * quote can display it. Until handover, only the newly purchased package (and
 * carry-over already transferred) may be reserved; otherwise the same source
 * sessions could be scheduled once on each contract.
 */
function contractSchedulingEntitlement(contract = {}) {
  const status = normalizedContractStatus(contract.status)
  const isPendingRenewal = status === 'future' && Boolean(contract.sourceContractId)
  if (isPendingRenewal && safeSessionCount(contract.packageSessions) > 0) {
    return safeSessionCount(contract.packageSessions) + safeSessionCount(contract.carriedOverSessions)
  }
  return safeSessionCount(contract.totalSessions)
}

function contractSchedulingRemaining(contract = {}, reservationsByContract = new Map()) {
  return Math.max(0,
    contractSchedulingEntitlement(contract)
      - safeSessionCount(contract.usedSessions)
      - safeSessionCount(contract.carryOverTransferredSessions)
      - safeSessionCount(reservationsByContract.get(contract.id)))
}

function earlyHandoverEnabled(contract = {}) {
  return Boolean(contract.sourceContractId)
    && normalizedContractStatus(contract.status) === 'future'
    // Renewals created before this field was introduced remain compatible.
    // An explicit false is the policy switch that keeps the contractual date
    // hard for a particular renewal.
    && contract.earlyHandoverRequested !== false && contract.activationMode !== 'fixed_date'
}

function operationalContract(contract = {}) {
  return !BLOCKED_SCHEDULING_STATUSES.has(normalizedContractStatus(contract.status))
}

function linkedSource(contract, contracts) {
  if (!contract?.sourceContractId) return null
  return contracts.find((candidate) => candidate.id === contract.sourceContractId
    && candidate.studentId === contract.studentId) || null
}

function sourcePrecedesContract(source, contract, date) {
  const sourceStart = String(source?.startDate || '').slice(0, 10)
  const renewalEnd = String(contract?.endDate || '').slice(0, 10)
  return Boolean(sourceStart && renewalEnd && date >= sourceStart && date <= renewalEnd)
}

function earlyRenewalCanServe(contract, contracts, date, reservationsByContract) {
  if (!earlyHandoverEnabled(contract) || !operationalContract(contract) || contractPausedOn(contract, date)) return false
  const source = linkedSource(contract, contracts)
  if (!source || !operationalContract(source) || contractPausedOn(source, date) || !sourcePrecedesContract(source, contract, date) || (contract.signedDate && date < contract.signedDate)) return false
  return contractSchedulingRemaining(source, reservationsByContract) === 0
    && contractSchedulingRemaining(contract, reservationsByContract) > 0
}

function pendingRenewalDueOn(contract, contracts, date) {
  if (contract.status !== 'future' || !contract.sourceContractId || date < contract.startDate || date > contract.endDate) return false
  const source = linkedSource(contract, contracts)
  return Boolean(source && operationalContract(source) && !contractPausedOn(source, date)
    && !source.renewalSupersededBy && (!contract.signedDate || date >= contract.signedDate))
}

function directlyAvailableContracts(contracts, date, reservationsByContract) {
  return contracts.filter((contract) => ((contract.status === 'future' && contract.sourceContractId) ? pendingRenewalDueOn(contract, contracts, date) : contractEffectiveOnDate(contract, date))
    && !contractPausedOn(contract, date)
    && contractSchedulingRemaining(contract, reservationsByContract) > 0)
}

function preferSourceBeforeRenewal(candidates, date) {
  const ids = new Set(candidates.map((contract) => contract.id))
  const replacedIds = new Set(candidates.filter((contract) => contract.activationMode === 'fixed_date' && contract.startDate <= date).map((contract) => contract.sourceContractId))
  return candidates.filter((contract) => !replacedIds.has(contract.id) && (!contract.sourceContractId || replacedIds.has(contract.sourceContractId) || !ids.has(contract.sourceContractId)))
}

/**
 * Resolves the one contract that owns a planned learner session. A linked
 * renewal is a continuation, not an overlapping independent contract:
 * remaining source sessions are reserved first, then the future renewal may
 * serve later reservations even when its original start date is later.
 */
function resolveSchedulingContract({
  contracts = [],
  studentId,
  branchId,
  date,
  reservationsByContract = new Map(),
  allowCrossBranch = false,
}) {
  contracts = contracts.map((contract) => ({ ...contract, ...renewalDateSyncPatch(linkedSource(contract, contracts), contract) }))
  const learnerContracts = contracts.filter((contract) => contract.studentId === studentId && operationalContract(contract))
  const potentiallyRelevant = learnerContracts.filter((contract) => contractEffectiveOnDate(contract, date)
    || earlyHandoverEnabled(contract) || pendingRenewalDueOn(contract, learnerContracts, date))
  if (potentiallyRelevant.some((contract) => !contract.branchId)) {
    return { contract: null, reasons: ['CONTRACT_BRANCH_REQUIRED'], earlyHandover: false }
  }
  const scopedContracts = learnerContracts.filter((contract) => allowCrossBranch || contract.branchId === branchId)
  const direct = scopedContracts.filter((contract) => contractEffectiveOnDate(contract, date))
  const directAvailable = preferSourceBeforeRenewal(directlyAvailableContracts(scopedContracts, date, reservationsByContract), date)
  if (directAvailable.length > 1) {
    return { contract: null, reasons: ['AMBIGUOUS_ACTIVE_CONTRACT'], earlyHandover: false }
  }
  if (directAvailable.length === 1) {
    return { contract: directAvailable[0], reasons: [], earlyHandover: false }
  }

  const early = preferSourceBeforeRenewal(scopedContracts.filter((contract) => earlyRenewalCanServe(
    contract,
    scopedContracts,
    date,
    reservationsByContract,
  )), date)
  if (early.length > 1) {
    return { contract: null, reasons: ['AMBIGUOUS_ACTIVE_CONTRACT'], earlyHandover: false }
  }
  if (early.length === 1) {
    return {
      contract: early[0],
      reasons: [],
      earlyHandover: true,
      sourceContractId: early[0].sourceContractId,
    }
  }

  if (direct.some((contract) => contractPausedOn(contract, date))) {
    return { contract: null, reasons: ['CONTRACT_PAUSED'], earlyHandover: false }
  }
  if (direct.length && direct.every((contract) => contractSchedulingRemaining(contract, reservationsByContract) === 0)) {
    return { contract: null, reasons: ['CONTRACT_SESSION_QUOTA_EXCEEDED'], earlyHandover: false }
  }
  return { contract: null, reasons: ['ACTIVE_CONTRACT_NOT_FOUND'], earlyHandover: false }
}

/** A renewal can contribute quota to the selected week after its source does. */
function contractCanParticipateInWeek(contract, contracts, dates, reservationsByContract = new Map()) {
  if (!operationalContract(contract)) return false
  // Include a date-effective but paused contract in the operational set so
  // the caller can surface CONTRACT_PAUSED instead of the misleading
  // ACTIVE_CONTRACT_NOT_FOUND diagnostic.
  contract = { ...contract, ...renewalDateSyncPatch(linkedSource(contract, contracts), contract) }
  if (dates.some((date) => (contract.status === 'future' && contract.sourceContractId) ? pendingRenewalDueOn(contract, contracts, date) : contractEffectiveOnDate(contract, date))) return true
  if (!earlyHandoverEnabled(contract)) return false
  const source = linkedSource(contract, contracts)
  return Boolean(source && operationalContract(source) && dates.some((date) => sourcePrecedesContract(source, contract, date) && !contractPausedOn(source, date) && (!contract.signedDate || date >= contract.signedDate)))
    && contractSchedulingRemaining(contract, reservationsByContract) > 0
}

module.exports = {
  contractCanParticipateInWeek,
  contractSchedulingEntitlement,
  contractSchedulingRemaining,
  earlyHandoverEnabled,
  resolveSchedulingContract,
}
