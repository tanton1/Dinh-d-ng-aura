'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { contractFinanceEvidence } = require('./pt-contract-finance-evidence.cjs')
function fixture() {
  const sessions = [1, 2, 3].map(n => ({ id: `s${n}`, studentId: 's', contractId: 'c', trainerId: 't', date: `2026-09-0${n}`, hour: 15, status: 'completed',
    ...(n > 1 ? { billingStatus: 'charged', serviceOrdinal: n } : {}) }))
  return { contractId: 'c', contract: { studentId: 's', status: 'active', totalSessions: 6, usedSessions: 3, totalPrice: 600, discount: 0, startDate: '2026-09-01', endDate: '2026-12-01' },
    sessions: [...sessions, { ...sessions[1], id: 'duplicate', status: 'cancelled', billingStatus: 'exempt', duplicateRepairVersion: 1, serviceOrdinal: 3 }],
    billings: [sessions[1], sessions[2], { ...sessions[1], id: 'duplicate', sessionId: 'duplicate', serviceOrdinal: 3 }], attendance: [],
    ledger: [{ id: 'l1', sessionId: 's1', serviceOrdinal: 1, type: 'revenue_recognition', status: 'posted', revenueImpact: 100 }], reviews: [] }
}
test('legacy debits and a cancelled duplicate reconcile without changing usage or posted money', () => {
  const input = fixture(), original = structuredClone(input), result = contractFinanceEvidence(input)
  assert.equal(result.used, 3); assert.equal(result.newBillingCount, 1); assert.equal(result.missingRevenueCount, 2)
  assert.equal(result.additionalRevenue, 200); assert.equal(result.expectedRevenue, 300)
  assert.deepEqual(result.charges.map(c => c.ordinal), [1, 2, 3])
  assert.equal(result.duplicates[0].canonicalSessionId, 's2'); assert.deepEqual(input, original)
})
for (const [name, change] of [
  ['counter mismatch', v => { v.contract.usedSessions = 4 }],
  ['active duplicate', v => { v.sessions.at(-1).billingStatus = 'charged' }],
  ['unproven cancellation', v => { delete v.sessions.at(-1).duplicateRepairVersion }],
  ['ordinal collision', v => { v.sessions[2].serviceOrdinal = 2 }],
  ['another learner', v => { v.sessions[0].studentId = 'other' }],
  ['changed revenue', v => { v.ledger[0].revenueImpact = 99 }],
  ['double posting', v => { v.ledger.push({ ...v.ledger[0], id: 'l2' }) }],
  ['prior amendment', v => { v.contract.revenueAllocation = { version: 2 } }],
  ['returned service', v => { v.returns = [{ id: 'returned' }] }],
  ['unrelated review', v => { v.reviews = [{ status: 'open', sessionId: 's2', issueCode: 'VALUE_MISMATCH' }] }],
]) test(`repair refuses ${name}`, () => { const v = fixture(); change(v); assert.throws(() => contractFinanceEvidence(v)) })
