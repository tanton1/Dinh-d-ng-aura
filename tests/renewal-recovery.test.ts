import assert from 'node:assert/strict'
import { test } from 'node:test'
import { clearRenewalCommand, readRenewalCommand, reconcileRenewalCommand, rememberRenewalCommand, renewalOutcomeUnknown } from '../src/features/contracts/renewalRecovery'
import type { RenewPtContractInput } from '../src/services/contractRenewalService'

const input: RenewPtContractInput = {
  caseId: 'case', sourceContractId: 'source', packageId: 'package', quoteId: 'quote',
  startDate: '2026-11-01', activationMode: 'automatic', expectedSourceRevision: 2, expectedCaseRevision: 3,
  idempotencyKey: 'stable-attempt', carryOver: true, discount: 0, initialPayment: 9000000,
  cashAccountId: 'bank', paymentMethod: 'transfer', installments: [], trainerIds: [], nutritionPTIds: [], note: 'Confirmed',
}

test('lost financial response reconciles the case before replay; committed contract never writes twice', async () => {
  let writes = 0
  const result = await reconcileRenewalCommand(input, async () => ({ case: { sourceContractId: 'source', renewedContractId: 'next' } }), async () => { writes++; return 'written' })
  assert.deepEqual(result, { contractId: 'next', unchanged: true })
  assert.equal(writes, 0)
})

test('missing result replays exactly the frozen payment and ID, while failed/mismatched reads cannot write', async () => {
  const actions: string[] = []
  await reconcileRenewalCommand(input, async () => { actions.push('read'); return { case: { sourceContractId: 'source', renewedContractId: null } } }, async replay => {
    actions.push('replay'); assert.deepEqual(replay, input)
  })
  assert.deepEqual(actions, ['read', 'replay'])
  let writes = 0
  await assert.rejects(reconcileRenewalCommand(input, async () => { throw new Error('offline') }, async () => { writes++ }))
  await assert.rejects(reconcileRenewalCommand(input, async () => ({ case: { sourceContractId: 'different', renewedContractId: 'next' } }), async () => { writes++ }))
  assert.equal(writes, 0)
})

test('recovery command is isolated by actor/case/source and cannot be mutated through the original draft', () => {
  const command = { ownerUid: 'cashier-one', createdAt: Date.now(), input: { ...input, installments: [{ id: 'one', date: '2026-12-01', amount: 500000 }] } }
  rememberRenewalCommand(command)
  command.input.initialPayment = 0
  command.input.installments[0].amount = 0
  assert.equal(readRenewalCommand('cashier-one', 'case', 'source')?.input.initialPayment, 9000000)
  assert.equal(readRenewalCommand('cashier-one', 'case', 'source')?.input.installments[0].amount, 500000)
  assert.equal(readRenewalCommand('cashier-two', 'case', 'source'), null)
  assert.equal(readRenewalCommand('cashier-one', 'case', 'other'), null)
  clearRenewalCommand('cashier-one', 'case', 'different-attempt')
  assert.ok(readRenewalCommand('cashier-one', 'case', 'source'))
  clearRenewalCommand('cashier-one', 'case', input.idempotencyKey)
  assert.equal(readRenewalCommand('cashier-one', 'case', 'source'), null)
})

test('transport uncertainty retains recovery while explicit business rejections can return to editing', () => {
  for (const code of ['functions/unavailable', 'deadline-exceeded', 'internal', 'cancelled', '']) assert.equal(renewalOutcomeUnknown({ code }), true)
  for (const code of ['functions/invalid-argument', 'aborted', 'permission-denied', 'failed-precondition']) assert.equal(renewalOutcomeUnknown({ code }), false)
})
