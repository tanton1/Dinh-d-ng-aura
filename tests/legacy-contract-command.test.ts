import assert from 'node:assert/strict'
import test from 'node:test'
import { legacyContractCreateCommand, legacyContractEditCommand } from '../src/services/legacyContractCommand'
import type { StudentContract } from '../src/types/ptOperations'

const contract: StudentContract = { id: 'stable-id', studentId: 'student-a', packageId: 'package-a', packageName: 'Package', branchId: 'a', status: 'active', startDate: '2026-10-30', endDate: '2027-01-30', totalSessions: 12, usedSessions: 4, totalPrice: 1_200_000, paidAmount: 0, discount: 0, revision: 8, installments: [{ id: 'first', amount: 1_200_000, date: '2026-10-30', status: 'pending' }], cancellationSettlement: { status: 'approved', revision: 5, settlementAmount: 200_000 } }

test('create preserves the caller ID for server retry while excluding status, cash, usage and settlement projections', () => {
  const command = legacyContractCreateCommand(contract)
  assert.equal(command.contractId, 'stable-id')
  assert.equal(command.studentId, 'student-a')
  assert.equal(command.action, 'create')
  if (command.action !== 'create') return
  for (const key of ['id', 'studentId', 'packageName', 'status', 'paidAmount', 'usedSessions', 'revision', 'cancellationSettlement', 'nextPaymentDate']) assert.equal(key in command.contract, false, key)
  assert.equal(command.contract.totalPrice, 1_200_000)
  assert.deepEqual(command.contract.installments, contract.installments)
  assert.notEqual(command.contract.installments, contract.installments)
})

test('create refuses fabricated cash or posted installment history', () => {
  assert.throws(() => legacyContractCreateCommand({ ...contract, paidAmount: 1 }), /phiếu thu/)
  assert.throws(() => legacyContractCreateCommand({ ...contract, installments: [{ ...contract.installments![0], status: 'paid' }] }), /lịch sử đã thu/)
  assert.throws(() => legacyContractCreateCommand({ ...contract, status: 'cancelled' }), /hồ sơ học viên/)
})

test('edit binds current revision, strips derived fields and does not send unchanged finance fields', () => {
  const command = legacyContractEditCommand({ ...contract, note: 'Updated', usedSessions: 9 }, contract)
  assert.equal(command.action, 'edit')
  if (command.action !== 'edit') return
  assert.equal(command.expectedRevision, 8)
  assert.equal(command.contract.note, 'Updated')
  for (const key of ['paidAmount', 'usedSessions', 'status', 'cancellationSettlement', 'totalPrice', 'discount', 'installments']) assert.equal(key in command.contract, false, key)
  const changed = legacyContractEditCommand({ ...contract, totalPrice: 1_300_000 }, contract)
  if (changed.action === 'edit') assert.equal(changed.contract.totalPrice, 1_300_000)
})

test('edit rejects stale records, raw status changes, student moves and monetary projection edits', () => {
  assert.throws(() => legacyContractEditCommand(contract), /tải lại/)
  assert.throws(() => legacyContractEditCommand({ ...contract, revision: 7 }, contract), /đã thay đổi/)
  assert.throws(() => legacyContractEditCommand({ ...contract, status: 'cancelled' }, contract), /Học viên 360/)
  assert.throws(() => legacyContractEditCommand({ ...contract, status: 'frozen' }, contract), /Học viên 360/)
  assert.throws(() => legacyContractEditCommand({ ...contract, studentId: 'student-b' }, contract), /học viên khác/)
  assert.throws(() => legacyContractEditCommand({ ...contract, paidAmount: 1 }, contract), /phiếu thu/)
  assert.throws(() => legacyContractEditCommand({ ...contract, status: 'cancelled' }, { ...contract, status: 'cancelled' }), /quyết toán/)
})
