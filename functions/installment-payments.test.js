'use strict'

const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const test = require('node:test')
const {
  claimAmountIssue,
  confirmedClaimPatch,
  crc16Ccitt,
  installmentPaymentTarget,
  normalizeTransferProfile,
  paymentActionUrl,
  paymentClaimId,
  planInstallmentReminders,
  proofMetadataIssue,
  proofPathValid,
  reminderDates,
  reminderMilestone,
  studentClaimState,
  transferCode,
  transferContent,
  vietQrPayload,
} = require('./installment-payment-core')
const paymentsSource = readFileSync(join(__dirname, 'installment-payments.js'), 'utf8')
const storageRules = readFileSync(join(__dirname, '..', 'storage.rules'), 'utf8')
const { planInstallmentPayment, restoredInstallments } = require('./installment-schedule')

const ledgerSource = readFileSync(join(__dirname, 'finance-ledger.js'), 'utf8')
const indexSource = readFileSync(join(__dirname, 'index.js'), 'utf8')
const rules = readFileSync(join(__dirname, '..', 'firestore.rules'), 'utf8')

function contract(overrides = {}) {
  return {
    studentId: 'student-1',
    branchId: 'branch-a',
    packageName: 'PT 1:1 · 6 tháng',
    status: 'active',
    totalPrice: 12_000_000,
    discount: 0,
    paidAmount: 8_000_000,
    nextPaymentDate: '2026-11-07',
    installments: [
      { id: 'installment-1', date: '2026-10-07', amount: 8_000_000, status: 'paid' },
      { id: 'installment-2', date: '2026-11-07', amount: 4_000_000, status: 'pending' },
    ],
    ...overrides,
  }
}

test('CRC-16/CCITT-FALSE matches the standard check value', () => {
  assert.equal(crc16Ccitt('123456789'), '29B1')
})

test('VietQR payload is a dynamic NAPAS transfer with amount, memo and a valid checksum', () => {
  const payload = vietQrPayload({ bankBin: '970436', accountNumber: '0123456789', amount: 4_000_000, content: 'AURA 7K3QX9M2' })
  assert.ok(payload.startsWith('000201010212'))
  // 38 → GUID A000000727, beneficiary (00 BIN, 01 account), 02 service code.
  assert.ok(payload.includes('38540010A00000072701240006970436011001234567890208QRIBFTTA'))
  assert.ok(payload.includes('5303704'))
  assert.ok(payload.includes('54074000000'))
  assert.ok(payload.includes('5802VN'))
  assert.ok(payload.includes('62170813AURA 7K3QX9M2'))
  const body = payload.slice(0, -4)
  assert.ok(body.endsWith('6304'))
  assert.equal(payload.slice(-4), crc16Ccitt(body))
  assert.throws(() => vietQrPayload({ bankBin: '97043', accountNumber: '0123456789', amount: 1, content: 'AURA X' }))
  assert.throws(() => vietQrPayload({ bankBin: '970436', accountNumber: '0123456789', amount: 1.5, content: 'AURA X' }))
  assert.throws(() => vietQrPayload({ bankBin: '970436', accountNumber: '0123456789', amount: 1, content: 'Aura có dấu' }))
})

test('claim ids and transfer codes are deterministic per payable target', () => {
  assert.match(paymentClaimId('c1', 'installment-2'), /^ipc_[0-9a-f]{40}$/)
  assert.equal(paymentClaimId('c1', 'installment-2'), paymentClaimId('c1', 'installment-2'))
  assert.notEqual(paymentClaimId('c1', 'installment-2'), paymentClaimId('c1', 'installment-3'))
  assert.equal(paymentClaimId('c1', null), paymentClaimId('c1', ''))
  const code = transferCode('c1', 'installment-2')
  assert.match(code, /^[0-9A-HJKMNP-TV-Z]{8}$/)
  assert.equal(code, transferCode('c1', 'installment-2'))
  assert.notEqual(code, transferCode('c2', 'installment-2'))
})

test('transfer memo leads with the student name and stays within 25 characters', () => {
  const code = transferCode('c1', 'installment-2')
  assert.equal(transferContent('Huỳnh Thị Hải Âu', 'c1', 'installment-2'), `HUYNH THI HAI AU ${code}`)
  assert.equal(transferContent('Nguyễn Thị Phương Anh', 'c1', 'installment-2'), `NGUYEN ANH ${code}`)
  assert.equal(transferContent('Nguyễn Thị Phương-Anh Elizabeth', 'c1', 'installment-2'), `NGUYEN ELIZABETH ${code}`)
  assert.equal(transferContent('Nguyễn Thị Elizabetha', 'c1', 'installment-2'), `ELIZABETHA ${code}`)
  assert.equal(transferContent('NGUYENTHIPHUONGANHELIZABETH', 'c1', 'installment-2'), `NGUYENTHIPHUONGA ${code}`)
  assert.equal(transferContent('', 'c1', 'installment-2'), `AURA ${code}`)
  for (const name of ['Huỳnh Thị Hải Âu', 'Nguyễn Thị Phương Anh', 'Đặng Văn Đức', 'x']) {
    const memo = transferContent(name, 'c1', 'installment-2')
    assert.ok(memo.length <= 25, memo)
    assert.doesNotThrow(() => vietQrPayload({ bankBin: '970436', accountNumber: '0123456789', amount: 1, content: memo }))
  }
})

test('payment target mirrors the finance command rules', () => {
  const pending = installmentPaymentTarget(contract(), 'installment-2')
  assert.deepEqual({ ...pending, amounts: undefined }, { installmentId: 'installment-2', amount: 4_000_000, dueDate: '2026-11-07', sequence: 2, count: 2, amounts: undefined, minAmount: 100_000, maxAmount: 4_000_000, later: [] })
  const three = contract({ totalPrice: 15_000_000, installments: [...contract().installments, { id: 'installment-3', date: '2026-12-07', amount: 3_000_000, status: 'pending' }] })
  const middle = installmentPaymentTarget(three, 'installment-2')
  assert.equal(middle.maxAmount, 7_000_000)
  assert.deepEqual(middle.later, [{ id: 'installment-3', date: '2026-12-07', amount: 3_000_000, sequence: 3 }])
  assert.equal(installmentPaymentTarget(contract({ installments: [{ id: 'tiny', date: '2026-11-07', amount: 50_000, status: 'pending' }] }), 'tiny').minAmount, 50_000)
  assert.equal(installmentPaymentTarget(contract(), 'installment-1').error, 'paid')
  assert.equal(installmentPaymentTarget(contract(), 'missing').error, 'not_found')
  assert.equal(installmentPaymentTarget(contract({ status: 'cancelled' }), 'installment-2').error, 'closed')
  assert.equal(installmentPaymentTarget(contract(), null).error, 'installment_required')
  assert.equal(installmentPaymentTarget(contract({ paidAmount: 9_000_000 }), 'installment-2').error, 'mismatch')
  const legacy = installmentPaymentTarget(contract({ installments: [] }), null)
  assert.equal(legacy.amount, 4_000_000)
  assert.equal(legacy.installmentId, null)
  assert.equal(installmentPaymentTarget(contract({ installments: [], paidAmount: 12_000_000 }), null).error, 'settled')
})

test('students may claim any amount between the floor and the remaining debt', () => {
  const target = installmentPaymentTarget(contract({ totalPrice: 15_000_000, installments: [...contract().installments, { id: 'installment-3', date: '2026-12-07', amount: 3_000_000, status: 'pending' }] }), 'installment-2')
  assert.equal(claimAmountIssue(target, 4_000_000), null)
  assert.equal(claimAmountIssue(target, 100_000), null)
  assert.equal(claimAmountIssue(target, 7_000_000), null)
  assert.equal(claimAmountIssue(target, 99_999), 'below_minimum')
  assert.equal(claimAmountIssue(target, 7_000_001), 'above_outstanding')
  assert.equal(claimAmountIssue(target, 1.5), 'invalid')
  const full = contract({ totalPrice: 100_000_000, paidAmount: 0, installments: Array.from({ length: 24 }, (_, index) => ({ id: `i${index}`, date: `2027-${String(index % 12 + 1).padStart(2, '0')}-01`, amount: index === 23 ? 100_000_000 - 23 * 1_000_000 : 1_000_000, status: 'pending' })) })
  assert.equal(claimAmountIssue(installmentPaymentTarget(full, 'i23'), 500_000), 'schedule_full')
})

test('student state follows the contract before the claim', () => {
  const target = installmentPaymentTarget(contract(), 'installment-2')
  assert.equal(studentClaimState(null, target), 'open')
  assert.equal(studentClaimState({ status: 'submitted', amount: 4_000_000 }, target), 'submitted')
  assert.equal(studentClaimState({ status: 'submitted', amount: 3_000_000 }, target), 'submitted')
  assert.equal(studentClaimState({ status: 'withdrawn', amount: 4_000_000 }, target), 'open')
  assert.equal(studentClaimState({ status: 'rejected', amount: 4_000_000 }, target), 'rejected')
  // A reversed payment returns the installment to pending; an old confirmed
  // claim must not stop the student from paying again.
  assert.equal(studentClaimState({ status: 'confirmed', amount: 4_000_000 }, target), 'open')
  assert.equal(studentClaimState({ status: 'submitted', amount: 4_000_000 }, installmentPaymentTarget(contract(), 'installment-1')), 'paid')
})

test('posting a payment confirms the matching claim exactly once', () => {
  const base = { amount: 4_000_000, installmentId: 'installment-2', ledgerEntryId: 'ledger-1', receiptVoucherNumber: 'PT-A-1', actorUid: 'finance', confirmedAt: 'now' }
  assert.equal(confirmedClaimPatch(null, base), null)
  assert.equal(confirmedClaimPatch({ status: 'submitted', amount: 4_000_000 }, base).status, 'confirmed')
  assert.equal(confirmedClaimPatch({ status: 'withdrawn', amount: 4_000_000 }, base).status, 'confirmed')
  assert.equal(confirmedClaimPatch({ status: 'confirmed', ledgerEntryId: 'ledger-1' }, base), null)
  const legacy = { ...base, installmentId: '' }
  assert.equal(confirmedClaimPatch({ status: 'submitted', amount: 4_000_000 }, { ...legacy, amount: 1_000_000 }), null)
  assert.equal(confirmedClaimPatch({ status: 'rejected', amount: 4_000_000 }, legacy), null)
  assert.equal(confirmedClaimPatch({ status: 'submitted', amount: 4_000_000 }, legacy).status, 'confirmed')
})

test('transfer profile is stored as banks print it', () => {
  const profile = normalizeTransferProfile({ enabled: true, bankBin: '970436', bankName: 'Vietcombank', accountNumber: '0123 456 789', accountName: 'Công ty Aura Đinh Dưỡng' })
  assert.deepEqual(profile, { schemaVersion: 1, enabled: true, bankBin: '970436', bankName: 'Vietcombank', accountNumber: '0123456789', accountName: 'CONG TY AURA DINH DUONG' })
  assert.throws(() => normalizeTransferProfile({ ...profile, bankBin: 'VCB' }), /6 chữ số/)
  assert.throws(() => normalizeTransferProfile({ ...profile, accountNumber: '12' }), /Số tài khoản/)
})

test('reminders fire 3 days before, on and 3 days after the due date', () => {
  assert.deepEqual(reminderDates('2026-11-07'), ['2026-11-10', '2026-11-07', '2026-11-04'])
  assert.equal(reminderMilestone('2026-11-10', '2026-11-07'), 'before_3')
  assert.equal(reminderMilestone('2026-11-07', '2026-11-07'), 'due')
  assert.equal(reminderMilestone('2026-11-04', '2026-11-07'), 'after_3')
  assert.equal(reminderMilestone('2026-11-08', '2026-11-07'), null)
})

test('reminder plan skips reported, frozen, unlinked and settled contracts', () => {
  const students = new Map([['student-1', { accountUid: 'uid-1' }], ['student-2', {}]])
  const contracts = [
    { id: 'due', data: contract() },
    { id: 'reported', data: contract() },
    { id: 'frozen', data: contract({ status: 'frozen' }) },
    { id: 'unlinked', data: contract({ studentId: 'student-2' }) },
    { id: 'settled', data: contract({ paidAmount: 12_000_000 }) },
    { id: 'not-a-milestone', data: contract({ nextPaymentDate: '2026-11-08', installments: [{ id: 'i', date: '2026-11-08', amount: 4_000_000, status: 'pending' }] }) },
  ]
  const claims = new Map([[paymentClaimId('reported', 'installment-2'), { status: 'submitted' }]])
  const plan = planInstallmentReminders({ contracts, students, claims, today: '2026-11-07' })
  assert.equal(plan.length, 1)
  assert.equal(plan[0].userId, 'uid-1')
  assert.equal(plan[0].title, 'Kỳ thanh toán đến hạn hôm nay')
  assert.equal(plan[0].actionUrl, paymentActionUrl('due', 'installment-2'))
  assert.match(plan[0].dedupeKey, /^installment-due-[0-9a-f]{24}-due$/)
  assert.ok(plan[0].message.includes('4.000.000đ'))
})

test('a shortfall moves to the next installment or a new one; an excess settles later ones', () => {
  const rows = [
    { id: 'k1', date: '2026-10-07', amount: 8_000_000, status: 'paid' },
    { id: 'k2', date: '2026-11-07', amount: 4_000_000, status: 'pending' },
    { id: 'k3', date: '2026-12-07', amount: 3_000_000, status: 'pending' },
  ]
  const partial = planInstallmentPayment(rows, 'k2', 2_500_000, { paidOn: '2026-11-07' })
  assert.deepEqual(partial.installments.map((item) => [item.id, item.amount, item.status]), [['k1', 8_000_000, 'paid'], ['k2', 2_500_000, 'paid'], ['k3', 4_500_000, 'pending']])
  assert.equal(partial.shortfall, 1_500_000)
  assert.equal(partial.nextPaymentDate, '2026-12-07')
  assert.deepEqual(partial.changes, [{ id: 'k3', date: '2026-12-07', from: 3_000_000, to: 4_500_000, created: false }])
  // Pending total always drops by exactly the amount received.
  const pendingBefore = rows.filter((item) => item.status === 'pending').reduce((sum, item) => sum + item.amount, 0)
  const pendingAfter = partial.installments.filter((item) => item.status === 'pending').reduce((sum, item) => sum + item.amount, 0)
  assert.equal(pendingBefore - pendingAfter, 2_500_000)

  const last = planInstallmentPayment(rows, 'k3', 1_000_000, { paidOn: '2027-01-15' })
  assert.deepEqual(last.installments.at(-1), { id: 'k3-rest', date: '2027-02-14', amount: 2_000_000, status: 'pending' })
  assert.equal(last.changes[0].created, true)
  assert.equal(planInstallmentPayment(rows, 'k3', 1_000_000, { paidOn: '2026-11-20' }).installments.at(-1).date, '2027-01-06')

  const extra = planInstallmentPayment(rows, 'k2', 6_000_000)
  assert.deepEqual(extra.installments.map((item) => [item.id, item.amount, item.status]), [['k1', 8_000_000, 'paid'], ['k2', 6_000_000, 'paid'], ['k3', 1_000_000, 'pending']])
  const settles = planInstallmentPayment(rows, 'k2', 7_000_000)
  assert.deepEqual(settles.installments.map((item) => item.id), ['k1', 'k2'])
  assert.equal(settles.nextPaymentDate, null)
  assert.equal(planInstallmentPayment(rows, 'k2', 8_000_000).unallocated, 1_000_000)

  assert.equal(planInstallmentPayment(rows, 'k1', 1).error, 'not_pending')
  assert.equal(planInstallmentPayment(rows, 'missing', 1).error, 'not_found')
  assert.equal(planInstallmentPayment(rows, 'k2', 0).error, 'invalid_amount')
  const full = Array.from({ length: 24 }, (_, index) => ({ id: `i${index}`, date: `2027-01-${String(index + 1).padStart(2, '0')}`, amount: 1_000, status: 'pending' }))
  assert.equal(planInstallmentPayment(full, 'i23', 500).error, 'schedule_full')
  assert.equal(planInstallmentPayment(full, 'i22', 500).changes[0].id, 'i23')

  const snapshot = { before: rows, after: partial.installments }
  assert.deepEqual(restoredInstallments(partial.installments, snapshot).installments, rows)
  assert.equal(restoredInstallments([...partial.installments, { id: 'k4', date: '2027-01-07', amount: 1, status: 'pending' }], snapshot), null)
})

test('canonical payment closes the claim inside its own transaction', () => {
  const payment = ledgerSource.match(/const recordContractPayment = async[\s\S]*?\r?\n  }\r?\n/)?.[0] || ''
  assert.ok(payment.length > 1000)
  assert.match(payment, /transaction\.get\(claimReference\)/)
  assert.match(payment, /confirmedClaimPatch\(/)
  assert.match(payment, /transaction\.update\(claimReference, claimPatch\)/)
  // The claim read must happen with the other reads, before the receipt write.
  assert.ok(payment.indexOf('transaction.get(claimReference)') < payment.indexOf('createReceiptVoucher(transaction'))
  // A re-planned schedule is kept on the ledger entry and restored by a reversal.
  assert.match(payment, /installmentSchedule: \{ before: replan\.before, after: replan\.after \}/)
  assert.match(ledgerSource, /'pending', amount, \{ restore: original\.data\(\)\.installmentSchedule \|\| null \}/)
})

test('a receipt must sit under the caller and claim, with matching Storage metadata', () => {
  const claimId = paymentClaimId('c1', 'installment-2')
  const scope = { uid: 'uid-1', claimId }
  assert.equal(proofPathValid(`installment-proofs/uid-1/${claimId}/proof-1794050000000.jpg`, scope), true)
  assert.equal(proofPathValid(`installment-proofs/uid-1/${claimId}/proof-1794050000000.webp`, scope), true)
  assert.equal(proofPathValid(`installment-proofs/uid-2/${claimId}/proof-1794050000000.jpg`, scope), false)
  assert.equal(proofPathValid(`installment-proofs/uid-1/${paymentClaimId('c1', 'installment-3')}/proof-1794050000000.jpg`, scope), false)
  assert.equal(proofPathValid(`installment-proofs/uid-1/${claimId}/../proof-1794050000000.jpg`, scope), false)
  assert.equal(proofPathValid(`installment-proofs/uid-1/${claimId}/receipt.gif`, scope), false)
  assert.equal(proofPathValid(`performance-evidence/uid-1/${claimId}/proof-1794050000000.jpg`, scope), false)
  assert.equal(proofPathValid(42, scope), false)
  const metadata = { contentType: 'image/jpeg', size: '120000', metadata: { ownerUid: 'uid-1', claimId, resourceKind: 'installment-payment-proof' } }
  assert.equal(proofMetadataIssue(metadata, scope), null)
  assert.equal(proofMetadataIssue({ ...metadata, metadata: { ...metadata.metadata, ownerUid: 'uid-2' } }, scope), 'metadata')
  assert.equal(proofMetadataIssue({ ...metadata, metadata: { ...metadata.metadata, resourceKind: 'progress-photo' } }, scope), 'metadata')
  assert.equal(proofMetadataIssue({ ...metadata, contentType: 'image/gif' }, scope), 'type')
  assert.equal(proofMetadataIssue({ ...metadata, size: String(8 * 1024 * 1024 + 1) }, scope), 'size')
  assert.equal(proofMetadataIssue({ ...metadata, size: '0' }, scope), 'size')
})

test('receipts are verified before the claim references them and discarded when it does not', () => {
  const submit = paymentsSource.match(/const submitMyInstallmentPaymentClaim = onCall[\s\S]*?\r?\n  }\)\r?\n/)?.[0] || ''
  assert.ok(submit.length > 1000)
  assert.ok(submit.indexOf('verifiedProof(storage, proofPath, proofScope)') < submit.indexOf('db.runTransaction'))
  assert.match(submit, /if \(proofPath && !proofReferenced\) await discardProof\(storage, proofPath, proofScope\)/)
  assert.match(submit, /action === 'attach_proof'/)
  assert.match(paymentsSource, /getSignedUrl\(\{ action: 'read', expires: Date\.now\(\) \+ PROOF_URL_MINUTES \* 60_000 \}\)/)
  assert.match(storageRules, /match \/installment-proofs\/\{userId\}\/\{claimId\}\/\{fileName\} \{[\s\S]*?allow read: if isOwner\(userId\);[\s\S]*?allow update, delete: if false;/)
})

test('claims are callable-only and the reminder job is registered', () => {
  assert.match(rules, /match \/installmentPaymentClaims\/\{claimId\} \{\s*allow read, write: if false;/)
  assert.match(indexSource, /exports\.sendInstallmentDueRemindersScheduled = onSchedule\(/)
  assert.match(indexSource, /Object\.assign\(exports, createInstallmentPaymentFunctions\(\{ db, onCall, storage \}\)\)/)
})
