const test = require('node:test')
const assert = require('node:assert/strict')
const { addMonthsDateKey, normalizeInstallments, renewalRisk, latestContractsByStudent, requiresRenewalApproval, renewalQueueFingerprint } = require('./contract-renewals')

test('renewal calendar uses real months and clamps month-end dates', () => {
  assert.equal(addMonthsDateKey('2026-01-31', 1), '2026-02-28')
  assert.equal(addMonthsDateKey('2024-01-31', 1), '2024-02-29')
  assert.equal(addMonthsDateKey('2026-11-30', 3), '2027-02-28')
})

test('renewal risk prioritises exhausted, expired and near-expiry contracts', () => {
  assert.equal(renewalRisk({ endDate: '2026-09-30', totalSessions: 10, usedSessions: 10 }, '2026-08-24').category, 'exhausted')
  assert.equal(renewalRisk({ endDate: '2026-08-20', totalSessions: 10, usedSessions: 5 }, '2026-08-24').category, 'expired')
  assert.equal(renewalRisk({ endDate: '2026-08-30', totalSessions: 10, usedSessions: 5 }, '2026-08-24').category, 'critical')
  assert.equal(renewalRisk({ endDate: '2026-09-15', totalSessions: 10, usedSessions: 5 }, '2026-08-24').category, 'upcoming')
})

test('installment schedule must exactly match remaining contract balance', () => {
  const result = normalizeInstallments([
    { id: 'a', date: '2026-09-01', amount: 400_000 },
    { id: 'b', date: '2026-10-01', amount: 600_000 },
  ], 1_000_000, '2026-08-25', '2026-11-25')
  assert.equal(result.length, 2)
  assert.throws(() => normalizeInstallments([{ date: '2026-09-01', amount: 900_000 }], 1_000_000, '2026-08-25', '2026-11-25'), /không khớp/)
})

test('pipeline keeps only the latest non-cancelled contract per student', () => {
  const latest = latestContractsByStudent([
    { id: 'old', studentId: 's1', endDate: '2026-08-01', status: 'expired' },
    { id: 'new', studentId: 's1', endDate: '2026-12-01', status: 'active' },
    { id: 'cancelled', studentId: 's2', endDate: '2027-01-01', status: 'cancelled' },
  ])
  assert.equal(latest.get('s1').id, 'new')
  assert.equal(latest.has('s2'), false)
})

test('renewal approval threshold is strict and applies to every actor', () => {
  assert.equal(requiresRenewalApproval(1_000_000, 10_000_000, 3), false)
  assert.equal(requiresRenewalApproval(1_000_001, 10_000_000, 0), true)
  assert.equal(requiresRenewalApproval(0, 10_000_000, 4), true)
  assert.equal(requiresRenewalApproval(0, 10_000_000, 3), false)
})

test('renewal transaction requires a quote, approval evidence and checks idempotency before revision', () => {
  const source = require('node:fs').readFileSync(require('node:path').join(__dirname, 'contract-renewals.js'), 'utf8')
  assert.match(source, /else throw new HttpsError\('failed-precondition', 'Cần tạo báo giá trước khi tái ký\.'/)
  assert.match(source, /if \(needsApproval\) \{/)
  assert.doesNotMatch(source, /needsApproval && actor\.renewalScope !== 'system'/)
  assert.ok(source.indexOf("source.renewalIdempotencyKey === idempotencyKey") < source.indexOf("Number(source.revision || 0) !== expectedSourceRevision"))
})

test('daily renewal reminders are internal, deterministic and never auto-send externally', () => {
  const source = require('node:fs').readFileSync(require('node:path').join(__dirname, 'contract-renewals.js'), 'utf8')
  assert.match(source, /notifications\/renewal_\$\{today\}_\$\{item\.id\}/)
  assert.match(source, /type: 'renewal_reminder', category: 'operations'/)
  assert.doesNotMatch(source, /sendEachForMulticast|sendMulticast|deliverScheduledPushes/)
})

test('daily queue refresh ignores timestamps and revision when business data is unchanged', () => {
  const baseline = {
    schemaVersion: 2,
    sourceContractId: 'contract-1',
    studentId: 'student-1',
    stage: 'contacted',
    active: true,
    riskCategory: 'critical',
    studentSnapshot: { phone: '0900000000', name: 'Aura Member' },
    revision: 7,
    updatedBy: 'staff-1',
  }
  assert.equal(renewalQueueFingerprint(baseline), renewalQueueFingerprint({
    ...baseline,
    revision: 99,
    updatedBy: 'scheduler',
    updatedAt: { toMillis: () => 1_777_777_777_000 },
  }))
  assert.notEqual(renewalQueueFingerprint(baseline), renewalQueueFingerprint({ ...baseline, riskCategory: 'expired' }))
})
