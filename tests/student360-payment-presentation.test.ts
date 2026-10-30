import assert from 'node:assert/strict'
import test from 'node:test'
import { student360PaymentPresentation } from '../src/features/student-360/student360PaymentPresentation'
import type { Student360Overview } from '../src/features/student-360/types'

const contract = (status: string, payment: unknown) => ({ status, payment }) as Student360Overview['contract']

test('old cancelled payment projections never imply debt, overdue or financial closure', () => {
  for (const status of ['paid', 'due', 'overdue']) assert.deepEqual(student360PaymentPresentation(contract('cancelled', { status, outstanding: 900_000 }), true), { label: 'Quyết toán', value: 'Cần rà soát', note: 'Mở hợp đồng để đối soát', tone: 'attention' })
})

test('approved collection and refund respect financial-amount visibility', () => {
  const due = contract('cancelled', { status: 'settlement_due', outstanding: 100_000 })
  assert.equal(student360PaymentPresentation(due, true).note, '100.000đ')
  assert.equal(student360PaymentPresentation(due, false).note, 'Theo quyết toán đã duyệt')
  const refund = contract('cancelled', { status: 'settlement_refund', refundDue: 50_000 })
  assert.equal(student360PaymentPresentation(refund, true).value, 'Cần hoàn khách')
  assert.equal(student360PaymentPresentation(refund, true).note, '50.000đ')
  assert.equal(student360PaymentPresentation(refund, false).note, 'Theo quyết toán đã duyệt')
})

test('zero approved balance still awaits explicit closure; pending approval remains review', () => {
  assert.equal(student360PaymentPresentation(contract('cancelled', { status: 'settlement_ready' }), true).value, 'Chờ hoàn tất')
  assert.equal(student360PaymentPresentation(contract('cancelled', { status: 'settled' }), true).value, 'Đã quyết toán')
  assert.equal(student360PaymentPresentation(contract('cancelled', { status: 'settlement_review', settlementStatus: 'pending_approval' }), true).value, 'Chờ duyệt')
  assert.equal(student360PaymentPresentation(contract('active', { status: 'paid' }), true).value, 'Đã thanh toán')
})
