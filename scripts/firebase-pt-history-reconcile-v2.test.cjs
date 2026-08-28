'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const { PLAN_VERSION, chooseContract, buildPlan, assertPlanSafe } = require('./firebase-pt-history-reconcile-v2.cjs')

function contract(id, studentId, startDate, endDate, status = 'active', fields = {}) {
  return { id, updateTime: `2026-08-28T00:00:0${id.length}.000000Z`, fingerprint: `contract-${id}`, fields: { studentId, startDate, endDate, status, totalSessions: 36, usedSessions: 0, ...fields } }
}

function session(id, studentId, date, fields = {}) {
  return { id, updateTime: `2026-08-28T01:00:0${id.length}.000000Z`, fingerprint: `session-${id}`, fields: { studentId, date, status: 'completed', ...fields } }
}

function grouped(contracts) {
  const map = new Map()
  contracts.forEach((item) => map.set(item.fields.studentId, [...(map.get(item.fields.studentId) || []), { ...item, studentId: item.fields.studentId, startDate: item.fields.startDate, endDate: item.fields.endDate, status: item.fields.status }]))
  return map
}

test('exact date match is preferred without a tolerance guess', () => {
  const contracts = [contract('a', 'student', '2026-06-01', '2026-08-31')]
  const choice = chooseContract(session('s', 'student', '2026-08-01'), grouped(contracts))
  assert.equal(choice.contract.id, 'a')
  assert.equal(choice.reason, 'exact_contract_window')
  assert.equal(choice.gapDays, 0)
})

test('overlapping contracts deterministically use the latest start date', () => {
  const contracts = [
    contract('old', 'student', '2026-01-01', '2026-06-30', 'expired'),
    contract('new', 'student', '2026-05-01', '2026-09-30'),
  ]
  const choice = chooseContract(session('s', 'student', '2026-05-20'), grouped(contracts))
  assert.equal(choice.contract.id, 'new')
  assert.equal(choice.reason, 'overlap_latest_contract_start')
})

test('nearest unique contract accepts a bounded legacy date gap', () => {
  const contracts = [contract('a', 'student', '2026-06-08', '2026-09-08')]
  const choice = chooseContract(session('s', 'student', '2026-06-02'), grouped(contracts))
  assert.equal(choice.contract.id, 'a')
  assert.equal(choice.reason, 'nearest_contract_date_gap')
  assert.equal(choice.gapDays, 6)
})

test('history inside a later-cancelled contract remains linkable', () => {
  const contracts = [contract('a', 'student', '2026-04-01', '2026-07-01', 'cancelled')]
  const choice = chooseContract(session('s', 'student', '2026-05-01'), grouped(contracts))
  assert.equal(choice.contract.id, 'a')
  assert.equal(choice.reason, 'historical_cancelled_contract')
})

test('planner raises usage from evidence but never lowers a legacy projection', () => {
  const contracts = [
    contract('raise', 'student-a', '2026-01-01', '2026-12-31', 'active', { totalSessions: 2, usedSessions: 0 }),
    contract('preserve', 'student-b', '2026-01-01', '2026-12-31', 'expired', { totalSessions: 36, usedSessions: 10 }),
  ]
  const sessions = [
    session('one', 'student-a', '2026-05-01', { contractId: 'raise' }),
    session('two', 'student-a', '2026-05-02'),
    session('legacy', 'student-b', '2026-05-01', { contractId: 'preserve' }),
  ]
  const plan = buildPlan(sessions, contracts)
  const raised = plan.contractUpdates.find((item) => item.contractId === 'raise')
  const preserved = plan.contractUpdates.find((item) => item.contractId === 'preserve')
  assert.equal(plan.sessionLinks.length, 1)
  assert.equal(raised.afterUsed, 2)
  assert.equal(preserved.afterUsed, 10)
  assert.equal(preserved.status, 'legacy_projection_preserved')
  assert.equal(plan.contractUpdates.some((item) => item.afterUsed < item.beforeUsed), false)
})

test('pending renewal projection uses reconciled source usage', () => {
  const contracts = [
    contract('source', 'student', '2026-01-01', '2026-08-31', 'expired', { totalSessions: 36, usedSessions: 34 }),
    contract('renewal', 'student', '2026-09-01', '2026-12-01', 'future', { totalSessions: 38, packageSessions: 36, sourceContractId: 'source', carryOverRequested: true, carryOverPending: true, plannedCarryOverSessions: 2 }),
  ]
  const sessions = Array.from({ length: 35 }, (_, index) => session(`s${index}`, 'student', `2026-07-${String((index % 28) + 1).padStart(2, '0')}`, { contractId: 'source' }))
  const plan = buildPlan(sessions, contracts)
  assert.equal(plan.futureRenewalUpdates.length, 1)
  assert.equal(plan.futureRenewalUpdates[0].plannedCarryOverSessions, 1)
  assert.equal(plan.futureRenewalUpdates[0].totalSessions, 37)
})

test('completed handover correction is accepted only when new entitlement still covers usage', () => {
  const contracts = [
    contract('source', 'student', '2026-01-01', '2026-06-30', 'expired', { totalSessions: 12, usedSessions: 7, carryOverTransferredSessions: 5 }),
    contract('renewal', 'student', '2026-07-01', '2026-09-30', 'active', { totalSessions: 17, packageSessions: 12, usedSessions: 12, sourceContractId: 'source', carryOverRequested: true, carryOverPending: false, carriedOverSessions: 5 }),
  ]
  const sessions = [
    ...Array.from({ length: 13 }, (_, index) => session(`old${index}`, 'student', `2026-06-${String((index % 28) + 1).padStart(2, '0')}`, { contractId: 'source' })),
    ...Array.from({ length: 12 }, (_, index) => session(`new${index}`, 'student', `2026-07-${String((index % 28) + 1).padStart(2, '0')}`, { contractId: 'renewal' })),
  ]
  const plan = buildPlan(sessions, contracts)
  assert.equal(plan.completedHandoverCorrections.length, 1)
  assert.equal(plan.completedHandoverCorrections[0].correctedCarryOverSessions, 0)
  assert.equal(plan.completedHandoverCorrections[0].correctedRenewalTotal, 12)
  assert.doesNotThrow(() => assertPlanSafe(plan))
  assert.equal(PLAN_VERSION, 'pt-history-priority-v2')
})
