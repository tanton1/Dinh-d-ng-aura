'use strict'
const test = require('node:test'), assert = require('node:assert/strict')
const { buildPlan } = require('./firebase-pt-duplicate-session-repair.cjs')
function input() {
  const shared = { studentId: 's', trainerId: 't', contractId: 'c', date: '2026-10-15', hour: 15, scheduleEntryId: 'slot', scheduleWeekId: '2026-10-12' }
  return { week: '2026-10-12', students: [], attendance: new Map(), sessions: [
    { id: 'legacy', updateTime: '2026-10-15T08:00:00Z', data: { ...shared, branchId: 'all', status: 'completed' } },
    { id: 'pt_duplicate', updateTime: '2026-10-16T08:00:00Z', data: { ...shared, branchId: 'b', status: 'scheduled' } },
  ] }
}
test('schedule-only duplicate repair retains uncharged candidates', () => assert.equal(buildPlan(input()).candidates.length, 1))
test('charged duplicate is quarantined rather than leaving a charged receipt behind', () => {
  const value = input(); value.sessions[1].data.billingStatus = 'charged'
  const p = buildPlan(value); assert.equal(p.candidates.length, 0)
  assert.equal(p.quarantined[0].reason, 'financial_evidence_requires_contract_reconciliation')
})
test('a receipt blocks schedule-only repair even if the legacy session missed its billing flag', () => {
  const value = input(); value.billing = new Map([['pt_duplicate', { data: { billingStatus: 'charged' } }]])
  assert.equal(buildPlan(value).candidates.length, 0)
})
