import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import test from 'node:test'
import { crc16Ccitt, vietQrPayload, VIETQR_BANKS } from '../src/domain/payments/vietQr'
import { describeInstallmentPlan, planInstallmentPayment, type ScheduleRow } from '../src/domain/payments/installmentSchedule'
import { demoInstallmentPayment, paymentTargetFromHash } from '../src/services/installmentPaymentService'

const require = createRequire(import.meta.url)
const server = require('../functions/installment-payment-core.js') as {
  vietQrPayload: typeof vietQrPayload
  crc16Ccitt: typeof crc16Ccitt
  paymentActionUrl: (contractId: string, installmentId: string | null) => string
  transferContent: (name: string, contractId: string, installmentId: string | null) => string
}
const serverSchedule = require('../functions/installment-schedule.js') as { planInstallmentPayment: typeof planInstallmentPayment }

test('client VietQR mirror is byte-identical to the server payload', () => {
  const cases = [
    { bankBin: '970436', accountNumber: '0123456789', amount: 4_000_000, content: 'AURA 7K3QX9M2' },
    { bankBin: '970422', accountNumber: 'ABC1234', amount: 1, content: 'AURA DEMO2026' },
    { bankBin: '970407', accountNumber: '1903456789012', amount: 12_500_000, content: 'AURA 00000000' },
  ]
  for (const input of cases) assert.equal(vietQrPayload(input), server.vietQrPayload(input))
  assert.equal(crc16Ccitt('123456789'), server.crc16Ccitt('123456789'))
})

test('client schedule re-plan is identical to the server for shortfalls and excesses', () => {
  const rows: ScheduleRow[] = [
    { id: 'k1', date: '2026-10-07', amount: 8_000_000, status: 'paid' },
    { id: 'k2', date: '2026-11-07', amount: 7_600_000, status: 'pending' },
    { id: 'k3', date: '2026-12-07', amount: 3_000_000, status: 'pending' },
    { id: 'k4', date: '2027-01-07', amount: 2_000_000, status: 'pending' },
  ]
  const cases: Array<[string, number, string]> = [['k2', 5_000_000, '2026-11-07'], ['k2', 9_000_000, '2026-11-07'], ['k2', 12_600_000, '2026-11-07'], ['k4', 500_000, '2027-02-01'], ['k3', 3_000_000, ''], ['k1', 1, ''], ['k2', 0, '']]
  for (const [id, amount, paidOn] of cases) {
    assert.deepEqual(planInstallmentPayment(rows, id, amount, { paidOn }), serverSchedule.planInstallmentPayment(rows, id, amount, { paidOn }))
  }
  const numbered = rows.map((item, index) => ({ ...item, sequence: index + 1 }))
  assert.equal(describeInstallmentPlan(numbered, 'k2', 5_000_000, '2026-11-07'), 'Phần còn thiếu 2.600.000đ sẽ cộng vào kỳ 3 (07/12/2026).')
  assert.equal(describeInstallmentPlan(numbered, 'k4', 500_000, '2027-02-01'), 'Phần còn thiếu 1.500.000đ sẽ thành kỳ mới, hạn 03/03/2027.')
  assert.equal(describeInstallmentPlan(numbered, 'k2', 9_000_000, '2026-11-07'), 'Phần trả thêm 1.400.000đ sẽ trừ vào kỳ 3 (07/12/2026).')
  assert.equal(describeInstallmentPlan(numbered, 'k2', 12_600_000, '2026-11-07'), 'Phần trả thêm 5.000.000đ sẽ trừ vào kỳ 3 (07/12/2026), đủ kỳ này và kỳ 4 (07/01/2027), đủ kỳ này.')
  assert.equal(describeInstallmentPlan(numbered, 'k2', 7_600_000, '2026-11-07'), '')
})

test('transfer memo is a valid VietQR memo for any student name', () => {
  for (const name of ['Huỳnh Thị Hải Âu', 'Nguyễn Thị Phương Anh', 'Đặng Văn Đức', 'x', '', 'Ngô-Đình Diệm Jr.']) {
    const memo = server.transferContent(name, 'contract-1', 'installment-2')
    assert.ok(memo.length <= 25, memo)
    assert.doesNotThrow(() => vietQrPayload({ bankBin: '970436', accountNumber: '0123456789', amount: 1, content: memo }))
  }
  assert.ok(server.transferContent('Huỳnh Thị Hải Âu', 'contract-1', 'installment-2').startsWith('HUYNH THI HAI AU '))
})

test('bank list carries valid, unique NAPAS BINs', () => {
  assert.ok(VIETQR_BANKS.every((bank) => /^\d{6}$/.test(bank.bin)))
  assert.equal(new Set(VIETQR_BANKS.map((bank) => bank.bin)).size, VIETQR_BANKS.length)
})

test('reminder links reopen the right payment target', () => {
  const link = server.paymentActionUrl('contract-1', 'installment-2')
  assert.deepEqual(paymentTargetFromHash(link), { contractId: 'contract-1', installmentId: 'installment-2' })
  assert.deepEqual(paymentTargetFromHash(server.paymentActionUrl('contract-1', null)), { contractId: 'contract-1', installmentId: null })
  assert.equal(paymentTargetFromHash('#/schedule?tab=contract'), null)
  assert.equal(paymentTargetFromHash('#/schedule?pay=a%2Fb~x'), null)
})

test('demo payment shows a scannable transfer for the selected installment', () => {
  const contract = {
    id: 'demo', packageName: 'PT 1:1', status: 'active', startDate: '2026-06-01', endDate: '2026-12-01', totalSessions: 72, usedSessions: 30, remainingSessions: 42,
    totalAmount: 12_000_000, paidAmount: 8_000_000, outstandingAmount: 4_000_000, paymentStatus: 'due_soon' as const, nextPaymentDate: '2026-11-12', daysUntilEnd: 90,
    installments: [
      { id: 'i1', date: '2026-10-07', amount: 8_000_000, status: 'paid' as const },
      { id: 'i2', date: '2026-11-12', amount: 4_000_000, status: 'pending' as const },
    ],
  }
  const view = demoInstallmentPayment(contract, contract.installments[1], '2026-11-07')
  assert.equal(view.state, 'open')
  assert.equal(view.installment?.sequence, 2)
  assert.equal(view.installment?.daysUntilDue, 5)
  assert.deepEqual([view.installment?.minAmount, view.installment?.maxAmount], [100_000, 4_000_000])
  assert.deepEqual(view.laterInstallments, [])
  assert.ok(view.transfer?.qrPayload.includes('5303704'))
  assert.equal(demoInstallmentPayment(contract, contract.installments[1], '2026-11-07', true).state, 'submitted')
  assert.equal(demoInstallmentPayment(contract, contract.installments[1], '2026-11-07', 2_500_000).claim?.amount, 2_500_000)
  assert.equal(demoInstallmentPayment(contract, contract.installments[0], '2026-11-07').state, 'paid')
})
