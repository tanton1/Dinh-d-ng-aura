'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const { recognitionThrough, recognitionForNextSession, ptRevenueRecognitionWrite, eatCleanRevenueRecognitionWrites } = require('./finance-recognition')

test('PT revenue recognition is prorated per completed billable session', () => {
  const contract = { totalPrice: 1_000_001, discount: 0, totalSessions: 10, usedSessions: 0, paidAmount: 1_000_001, studentId: 'student-1', branchId: 'branch-a' }
  assert.equal(recognitionThrough(contract, 0), 0)
  assert.equal(recognitionThrough(contract, 1), 100_001)
  assert.equal(recognitionThrough(contract, 10), 1_000_001)
  assert.equal(recognitionForNextSession(contract), 100_001)
  const write = ptRevenueRecognitionWrite({ sessionId: 'session-1', session: { studentId: 'student-1', trainerId: 'trainer-1', branchId: 'branch-a', date: '2026-08-21' }, contractId: 'contract-1', contract, attendanceEventId: 'attendance-1', actorUid: 'admin-1' })
  assert.equal(write.type, 'revenue_recognition')
  assert.equal(write.source, 'pt_gym')
  assert.equal(write.cashImpact, 0)
  assert.equal(write.revenueImpact, 100_001)
  assert.equal(write.deferredRevenueImpact, -100_001)
  assert.equal(write.idempotencyKey, 'pt-session-recognition:session-1')
})

test('incomplete legacy PT contract does not invent revenue', () => {
  assert.equal(ptRevenueRecognitionWrite({ sessionId: 'session-2', session: {}, contractId: 'contract-2', contract: { totalSessions: 0, totalPrice: 0 }, attendanceEventId: 'attendance-2', actorUid: 'admin-1' }), null)
})

test('Eat Clean revenue is recognised on delivery with food and delivery sources separate', () => {
  const writes = eatCleanRevenueRecognitionWrites({
    orderId: 'order-1',
    actorUid: 'shipper-1',
    order: { userId: 'member-1', commercialSnapshot: { pricing: { subtotal: 120_000, deliveryFee: 20_000 } }, discount: 10_000 },
  })
  assert.deepEqual(writes.map((item) => item.id), ['eat_clean_order-1', 'delivery_fee_order-1'])
  assert.equal(writes[0].value.source, 'eat_clean')
  assert.equal(writes[0].value.revenueImpact, 110_000)
  assert.equal(writes[1].value.source, 'delivery_fee')
  assert.equal(writes[1].value.revenueImpact, 20_000)
  assert.equal(writes.every((item) => item.value.cashImpact === 0), true)
})
