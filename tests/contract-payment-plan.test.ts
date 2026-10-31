import assert from 'node:assert/strict'
import { test } from 'node:test'
import { dividePaymentPlan, paymentDueDate, paymentPlanError, type PaymentPlanInstallment } from '../src/domain/contracts/paymentPlan'
import { clearContractCreate, readContractCreate, rememberContractCreate } from '../src/features/contracts/contractCreateRecovery'

test('division allocates every dong and keeps paid history and existing due dates', () => {
  const paid: PaymentPlanInstallment = { id: 'paid', amount: 3, date: '2026-10-01', status: 'paid' }
  const existing: PaymentPlanInstallment = { id: 'pending', amount: 7, date: '2026-12-15', status: 'pending' }
  const result = dividePaymentPlan(10, 3, '2026-11-01', '2027-02-01', [paid, existing])
  assert.deepEqual(result[0], paid)
  assert.deepEqual(result.slice(1).map(item => item.amount), [4, 3, 3])
  assert.equal(result[1].id, 'pending')
  assert.equal(result[1].date, '2026-12-15')
  assert.equal(paymentPlanError(result, 10), '')
  assert.deepEqual(dividePaymentPlan(0, 3, '2026-11-01', undefined, [paid, existing]), [paid])
  assert.deepEqual(dividePaymentPlan(2, 6, '2026-11-01').map(item => item.amount), [1, 1])
})

test('custom unequal periods must equal the debt and contain valid amounts and dates', () => {
  const rows = [2_000_000, 2_000_000, 4_000_000].map((amount, index) => ({ id: `p${index}`, amount, date: '2026-12-01', status: 'pending' as const }))
  assert.equal(paymentPlanError(rows, 8_000_000), '')
  assert.match(paymentPlanError(rows, 7_000_000), /Tổng/)
  assert.match(paymentPlanError([{ ...rows[0], amount: 0 }], 0), /lớn hơn 0/)
  assert.match(paymentPlanError([{ ...rows[0], amount: 1.5 }], 1.5), /không hợp lệ/)
  assert.match(paymentPlanError([rows[0], rows[0]], 4_000_000), /trùng/)
  assert.match(paymentPlanError(rows, 8_000_000, { minDate: '2027-01-01' }), /thời hạn/)
  assert.equal(paymentDueDate('2028-01-31', 1), '2028-02-29')
  assert.equal(paymentDueDate('2026-10-31', 6, '2027-01-31'), '2027-01-31')
})

test('unknown create outcome keeps the exact payment scoped to its cashier and learner', () => {
  const command = { ownerUid: 'cashier', input: { studentId: 'learner', action: 'create' as const, contractId: 'new', contract: { installments: [{ id: 'p1', amount: 8_000_000 }] }, initialPayment: { amount: 3_000_000, cashAccountId: 'bank', paymentMethod: 'transfer' as const } } }
  rememberContractCreate(command)
  command.input.initialPayment.amount = 9
  assert.equal(readContractCreate('cashier', 'learner')?.input.initialPayment?.amount, 3_000_000)
  assert.equal(readContractCreate('other', 'learner'), null)
  assert.equal(readContractCreate('cashier', 'other'), null)
  assert.throws(() => rememberContractCreate(command), /trước đó/)
  clearContractCreate('cashier', 'learner', 'wrong')
  assert.ok(readContractCreate('cashier', 'learner'))
  clearContractCreate('cashier', 'learner', 'new')
  assert.equal(readContractCreate('cashier', 'learner'), null)
})
