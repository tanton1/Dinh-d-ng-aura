'use strict'

const { FieldValue } = require('firebase-admin/firestore')
const { HttpsError } = require('firebase-functions/v2/https')
const { renewalRevenueAllocation, revenueSegments } = require('./pt-revenue-allocation')
const { contractPausedOn, contractEffectiveOnDate } = require('./contract-status')
const { summarizeContractUsage, MAX_SESSION_EVIDENCE } = require('./contract-usage')
const { addDateDays, vietnamDateKey } = require('./pt-policy')
const { contractSalesIndexPatch } = require('./contract-sales-index')

const blockedStatuses = new Set(['cancelled', 'inactive', 'archived', 'draft', 'frozen'])
const count = (value) => Math.max(0, Math.floor(Number(value) || 0))
const automaticRenewal = (contract) => contract.activationMode !== 'fixed_date' && contract.earlyHandoverRequested !== false

function checkedDate(value) {
  const parsed = new Date(`${value}T00:00:00Z`)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) || Number.isNaN(parsed.getTime())
    || parsed.toISOString().slice(0, 10) !== value) {
    throw new HttpsError('failed-precondition', 'Ngày chuyển giao hợp đồng không hợp lệ.')
  }
  return value
}

// A preservation/extension can move the automatic handover later. The original
// sold dates and the instalment agreements remain available for audit.
function renewalDateSyncPatch(source, next) {
  if (!source || next.status !== 'future' || next.activationMode !== 'automatic') return {}
  const startDate = [addDateDays(checkedDate(source.endDate), 1), next.signedDate || ''].sort().at(-1)
  const previous = checkedDate(next.plannedActivationDate || next.startDate)
  if (previous === startDate) return {}
  const days = Math.round((Date.parse(startDate) - Date.parse(previous)) / 86_400_000)
  return {
    startDate,
    plannedActivationDate: startDate,
    endDate: days > 0 ? addDateDays(checkedDate(next.endDate), days) : next.endDate,
  }
}

function renewalActivationProjection(source, nextContract, today = vietnamDateKey()) {
  const next = { ...nextContract, ...renewalDateSyncPatch(source, nextContract) }
  const sourceRemaining = source
    ? Math.max(0, count(source.totalSessions) - count(source.usedSessions) - count(source.carryOverTransferredSessions)) : 0
  const plannedStartDate = checkedDate(next.startDate)
  const blocked = (next.signedDate && today < next.signedDate) || blockedStatuses.has(next.status) || (source && (
    blockedStatuses.has(source.status) || contractPausedOn(source, today)
    || (source.renewalSupersededBy && source.renewalSupersededBy !== next.id)))
    || contractPausedOn(next, today)
  const dueByDate = plannedStartDate <= today
  const dueBySourceExhaustion = Boolean(source) && automaticRenewal(next) && sourceRemaining === 0
  const handoverDue = !blocked && (dueByDate || dueBySourceExhaustion)
  const earlyHandover = handoverDue && dueBySourceExhaustion && !dueByDate
  const effectiveStartDate = earlyHandover ? today : plannedStartDate
  const start = plannedStartDate.split('-').map(Number)
  const end = checkedDate(next.endDate).split('-').map(Number)
  const durationMonths = count(next.durationMonths) || Math.max(1, (end[0] - start[0]) * 12 + end[1] - start[1])
  const packageSessions = count(next.packageSessions ?? next.totalSessions)
  const requested = next.carryOverRequested === true || next.carryOverPending === true
  const approvedLimit = next.plannedCarryOverSessions === undefined ? sourceRemaining : count(next.plannedCarryOverSessions)
  const carriedOverSessions = requested && handoverDue ? Math.min(sourceRemaining, approvedLimit) : 0
  return {
    handoverDue: Boolean(handoverDue), earlyHandover: Boolean(earlyHandover),
    reason: !handoverDue ? 'WAITING' : earlyHandover ? 'SOURCE_QUOTA_EXHAUSTED' : 'PLANNED_START_DATE_REACHED',
    sourceRemaining, durationMonths, effectiveStartDate, effectiveEndDate: next.endDate,
    packageSessions, carriedOverSessions, totalSessions: packageSessions + carriedOverSessions,
  }
}

async function readRenewalUsage(transaction, db, contractId, contract) {
  const evidence = await transaction.get(db.collection('sessions').where('contractId', '==', contractId).limit(MAX_SESSION_EVIDENCE + 1))
  if (evidence.size > MAX_SESSION_EVIDENCE) throw new HttpsError('failed-precondition', 'Cần đối soát đầy đủ số buổi trước khi chuyển giao hợp đồng.')
  const usage = summarizeContractUsage(contract, evidence.docs.map((item) => ({ ...item.data(), id: item.id })))
  const canonical = new Set(usage.canonicalChargedSessionIds)
  const revenueOccupiedOrdinals = evidence.docs.filter(item => canonical.has(item.id))
    .map(item => Number(item.data().serviceOrdinal)).filter(n => Number.isSafeInteger(n) && n > 0)
  return { ...contract, usedSessions: usage.usedSessions, revenueOccupiedOrdinals }
}

function assertRenewalLink(sourceId, source, nextId, next) {
  if (next.sourceContractId !== sourceId || sourceId === nextId || !source.studentId
    || source.studentId !== next.studentId || (source.branchId && next.branchId && source.branchId !== next.branchId)
    || (source.renewedByContractId && source.renewedByContractId !== nextId)) {
    throw new HttpsError('failed-precondition', 'Liên kết hợp đồng nối tiếp không còn hợp lệ.')
  }
}

// Validates a booking/change in a continuation chain. This projection is only
// for reservation checks; consumption always goes through the handover plan.
function renewalReservationProjection(contractId, contract, source, date) {
  if (contract.status !== 'future' || !contract.sourceContractId || !source) return contract
  assertRenewalLink(contract.sourceContractId, source, contractId, contract)
  const next = { ...contract, ...renewalDateSyncPatch(source, contract) }
  if (blockedStatuses.has(source.status) || source.renewalSupersededBy || contractPausedOn(source, date)
    || contractPausedOn(next, date) || date < source.startDate || date > next.endDate
    || (next.signedDate && date < next.signedDate)
    || (!automaticRenewal(next) && date < next.startDate)) return contract
  return { ...next, status: 'active', handoverStatus: undefined,
    startDate: automaticRenewal(next) ? [source.startDate, next.signedDate || ''].sort().at(-1) : next.startDate }
}

// Read/plan first, write only after all billing/approval checks have passed.
function renewalHandoverPlan({ sourceId = null, source = null, nextId, next, date, actorUid }) {
  if (next.status !== 'future') return null
  if (source) assertRenewalLink(sourceId, source, nextId, next)
  const projection = renewalActivationProjection(source, { ...next, id: nextId }, date)
  if (!projection.handoverDue) return null
  if (projection.packageSessions < 1 || projection.effectiveStartDate > projection.effectiveEndDate) {
    throw new HttpsError('failed-precondition', 'Quyền lợi hợp đồng nối tiếp không hợp lệ.')
  }
  const plan = {
    sourceId, nextId, projection,
    caseId: next.renewalCaseId || sourceId || null, studentId: next.studentId || '', branchId: next.branchId || '',
    nextPatch: {
      ...renewalDateSyncPatch(source, next), status: 'active',
      startDate: projection.effectiveStartDate, endDate: projection.effectiveEndDate,
      originalStartDate: next.originalStartDate || next.startDate,
      originalEndDate: next.originalEndDate || next.endDate,
      totalSessions: projection.totalSessions, durationMonths: projection.durationMonths,
      revenueAllocation: renewalRevenueAllocation({ sourceId, source, nextId, next, carriedOverSessions: projection.carriedOverSessions }),
      carriedOverSessions: projection.carriedOverSessions, carryOverPending: false,
      carryOverTransferredAt: FieldValue.serverTimestamp(),
      handoverStatus: 'active', handoverReason: projection.reason,
      activationDate: projection.effectiveStartDate,
      ...(projection.earlyHandover ? { earlyHandoverAt: FieldValue.serverTimestamp() } : {}),
      activatedAt: FieldValue.serverTimestamp(), activatedBy: actorUid,
      updatedAt: FieldValue.serverTimestamp(), revision: count(next.revision) + 1,
    },
    sourcePatch: source ? {
      ...(!source.revenueAllocation ? { revenueAllocation: { version: 1, segments: revenueSegments(sourceId, source) } } : {}),
      status: 'expired', renewalSupersededBy: nextId,
      completionReason: projection.sourceRemaining === 0 ? 'quota_exhausted' : source.endDate < date ? 'term_ended' : 'renewal_handover',
      completedDate: projection.effectiveStartDate, completedAt: FieldValue.serverTimestamp(),
      carryOverTransferredSessions: projection.carriedOverSessions,
      carryOverTransferredAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(), revision: count(source.revision) + 1,
    } : null,
  }
  Object.assign(plan.nextPatch, contractSalesIndexPatch({ ...next, ...plan.nextPatch }))
  if (plan.sourcePatch) Object.assign(plan.sourcePatch, contractSalesIndexPatch({ ...source, ...plan.sourcePatch }))
  return plan
}

function applyRenewalHandover(transaction, db, plan, actorUid) {
  if (!plan) return
  transaction.update(db.doc(`contracts/${plan.nextId}`), plan.nextPatch)
  if (plan.sourcePatch) transaction.update(db.doc(`contracts/${plan.sourceId}`), plan.sourcePatch)
  transaction.create(db.doc(`contractRenewalActivities/handover-${plan.nextId}`), {
    schemaVersion: 1, caseId: plan.caseId, studentId: plan.studentId, branchId: plan.branchId, outcome: 'connected',
    type: 'handover', sourceContractId: plan.sourceId, newContractId: plan.nextId,
    reason: plan.projection.reason, activationDate: plan.projection.effectiveStartDate,
    endDate: plan.projection.effectiveEndDate, transferredSessions: plan.projection.carriedOverSessions,
    actorUid, createdAt: FieldValue.serverTimestamp(),
  })
}

async function prepareRenewalSessionCharge({ transaction, db, contractId, contract, date, actorUid }) {
  const original = { contractId, contract, handover: null, pendingNext: null }
  let sourceId, source, nextId, next
  if (contract.status === 'future' && contract.sourceContractId) {
    sourceId = contract.sourceContractId
    const snapshot = await transaction.get(db.doc(`contracts/${sourceId}`))
    if (!snapshot.exists) throw new HttpsError('failed-precondition', 'Không tìm thấy hợp đồng nguồn để chuyển giao.')
    source = snapshot.data(); nextId = contractId; next = contract
  } else if (contract.renewedByContractId) {
    sourceId = contractId; source = contract; nextId = contract.renewedByContractId
    const snapshot = await transaction.get(db.doc(`contracts/${nextId}`))
    if (!snapshot.exists) throw new HttpsError('failed-precondition', 'Không tìm thấy hợp đồng nối tiếp.')
    next = snapshot.data()
  } else if (contract.status === 'future' && !contract.sourceContractId) {
    const handover = renewalHandoverPlan({ nextId: contractId, next: contract, date, actorUid })
    return handover ? { ...original, contract: { ...contract, ...handover.nextPatch }, handover } : original
  } else return original

  assertRenewalLink(sourceId, source, nextId, next)
  if (source.renewalSupersededBy === nextId && next.status === 'active' && date >= next.startDate) {
    return { ...original, contractId: nextId, contract: next }
  }
  if (next.status !== 'future') return original
  source = await readRenewalUsage(transaction, db, sourceId, source)
  const handover = renewalHandoverPlan({ sourceId, source, nextId, next, date, actorUid })
  if (handover) return { ...original, contractId: nextId, contract: { ...next, ...handover.nextPatch }, handover }
  // A reservation is not consumption. If an earlier booking was cancelled,
  // the next actual session uses the source quota before touching the renewal.
  if (automaticRenewal(next) && contractEffectiveOnDate(source, date) && !contractPausedOn(source, date)
    && count(source.usedSessions) + count(source.carryOverTransferredSessions) < count(source.totalSessions)) {
    return { contractId: sourceId, contract: source, handover: null, pendingNext: { nextId, next } }
  }
  return { ...original, contract: contractId === sourceId ? source : contract, pendingNext: contractId === sourceId ? { nextId, next } : null }
}

module.exports = {
  automaticRenewal, renewalDateSyncPatch, renewalActivationProjection, readRenewalUsage,
  assertRenewalLink, renewalHandoverPlan, applyRenewalHandover, prepareRenewalSessionCharge, renewalReservationProjection,
}
