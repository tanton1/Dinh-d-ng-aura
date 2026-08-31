const test = require('node:test')
const assert = require('node:assert/strict')
const { addMonthsDateKey, normalizeInstallments, renewalRisk, renewalHandoverProjection, latestContractsByStudent, requiresRenewalApproval, renewalQueueFingerprint, matchesRenewalSegment, renewalStats, renewalMessageTemplates, caseAssignedToTrainer, canViewCase } = require('./contract-renewals')

test('renewal calendar uses real months and clamps month-end dates', () => {
  assert.equal(addMonthsDateKey('2026-01-31', 1), '2026-02-28')
  assert.equal(addMonthsDateKey('2024-01-31', 1), '2024-02-29')
  assert.equal(addMonthsDateKey('2026-11-30', 3), '2027-02-28')
})

test('future renewal transfers the exact remaining quota only on its handover date', () => {
  const source = { totalSessions: 36, usedSessions: 33 }
  const next = { startDate: '2026-08-29', packageSessions: 36, carryOverRequested: true, carryOverPending: true }
  assert.deepEqual(renewalHandoverProjection(source, next, '2026-08-27'), {
    handoverDue: false,
    packageSessions: 36,
    plannedCarryOverSessions: 3,
    carriedOverSessions: 0,
    totalSessions: 36,
  })
  assert.deepEqual(renewalHandoverProjection({ ...source, usedSessions: 35 }, next, '2026-08-29'), {
    handoverDue: true,
    packageSessions: 36,
    plannedCarryOverSessions: 1,
    carriedOverSessions: 1,
    totalSessions: 37,
  })
})

test('renewal risk prioritises exhausted, expired and near-expiry contracts', () => {
  assert.equal(renewalRisk({ endDate: '2026-09-30', totalSessions: 10, usedSessions: 10 }, '2026-08-24').category, 'exhausted')
  assert.equal(renewalRisk({ endDate: '2026-08-20', totalSessions: 10, usedSessions: 5 }, '2026-08-24').category, 'expired')
  assert.equal(renewalRisk({ endDate: '2026-08-30', totalSessions: 10, usedSessions: 5 }, '2026-08-24').category, 'critical')
  assert.equal(renewalRisk({ endDate: '2026-09-15', totalSessions: 10, usedSessions: 5 }, '2026-08-24').category, 'upcoming')
})

test('renewal carousel segments and counts share exact non-overlapping expiry rules', () => {
  const expiring = { id: 'expiring', active: true, stage: 'uncontacted', daysLeft: 30, sessionsLeft: 2 }
  const exhausted = { id: 'exhausted', active: true, stage: 'uncontacted', daysLeft: 10, sessionsLeft: 0 }
  const expired = { id: 'expired', active: true, stage: 'uncontacted', daysLeft: -30, sessionsLeft: 4 }
  const care = { id: 'care', active: true, stage: 'follow_up', daysLeft: 60, sessionsLeft: 5 }
  const closed = { id: 'closed', active: false, stage: 'won', daysLeft: 5, sessionsLeft: 0 }

  assert.equal(matchesRenewalSegment(expiring, 'expiring_30d'), true)
  assert.equal(matchesRenewalSegment({ ...expiring, daysLeft: 31 }, 'expiring_30d'), false)
  assert.equal(matchesRenewalSegment(exhausted, 'exhausted_active'), true)
  assert.equal(matchesRenewalSegment({ ...exhausted, daysLeft: 0 }, 'exhausted_active'), false)
  assert.equal(matchesRenewalSegment(expired, 'expired_last_30d'), true)
  assert.equal(matchesRenewalSegment({ ...expired, daysLeft: -31 }, 'expired_last_30d'), false)
  assert.equal(matchesRenewalSegment(care, 'in_care'), true)
  assert.equal(matchesRenewalSegment(closed, 'exhausted_active'), false)

  const stats = renewalStats([expiring, exhausted, expired, care, closed])
  assert.deepEqual(stats.segmentCounts, { expiring_30d: 1, exhausted_active: 1, expired_last_30d: 1, in_care: 1 })
})

test('renewal workspace ships a complete Vietnamese message playbook', () => {
  assert.equal(renewalMessageTemplates.length, 8)
  assert.equal(new Set(renewalMessageTemplates.map((item) => item.id)).size, renewalMessageTemplates.length)
  assert.ok(renewalMessageTemplates.some((item) => item.recommendedSegments.includes('expiring_30d')))
  assert.ok(renewalMessageTemplates.some((item) => item.recommendedSegments.includes('exhausted_active')))
  assert.ok(renewalMessageTemplates.some((item) => item.recommendedSegments.includes('expired_last_30d')))
  assert.ok(renewalMessageTemplates.every((item) => item.body.includes('{{studentName}}')))
})

test('bulk renewal handoff is branch-scoped, revisioned and audited atomically', () => {
  const source = require('node:fs').readFileSync(require('node:path').join(__dirname, 'contract-renewals.js'), 'utf8')
  assert.match(source, /const transferRenewalCases = renewalCall/)
  assert.match(source, /request\.data\.cases\.length > 20/)
  assert.match(source, /Nhân viên nhận bàn giao không phụ trách đủ các chi nhánh đã chọn/)
  assert.match(source, /Một hồ sơ đã được cập nhật\. Hãy tải lại danh sách/)
  assert.match(source, /beforeAssignedSalesId: value\.assignedSalesId \|\| ''/)
})

test('renewal callables and scheduler use bounded low-CPU production settings', () => {
  const source = require('node:fs').readFileSync(require('node:path').join(__dirname, 'contract-renewals.js'), 'utf8')
  assert.match(source, /const renewalCall[\s\S]*?cpu: 'gcf_gen1', concurrency: 1, maxInstances: 2, invoker: 'public'/)
  assert.match(source, /createRenewalQuote = renewalCall/)
  assert.match(source, /retryCount: 1, cpu: 'gcf_gen1', maxInstances: 1/)
  assert.match(source, /schedule: '5 0 \* \* \*'/)
  assert.match(source, /activateDueRenewalContractsCore\(\{ db \}\)/)
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
  assert.match(source, /plannedCarryOverSessions: carriedOverSessions/)
  assert.match(source, /carryOverPending/)
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

test('trainer renewal scope includes only primary, secondary or nutrition assignments', () => {
  const actor = {
    uid: 'auth-trainer', legacyStaffId: 'trainer-legacy', renewalScope: 'self',
    renewalCanViewSalesCases: false, renewalCanViewTrainerCases: true,
  }
  assert.equal(caseAssignedToTrainer(actor, { contractSnapshot: { trainerId: 'trainer-legacy' } }), true)
  assert.equal(caseAssignedToTrainer(actor, { contractSnapshot: { trainerIds: ['other', 'auth-trainer'] } }), true)
  assert.equal(caseAssignedToTrainer(actor, { contractSnapshot: { nutritionPTIds: ['trainer-legacy'] } }), true)
  assert.equal(canViewCase(actor, { assignedSalesId: 'auth-trainer', contractSnapshot: { trainerId: 'other' } }), false)
  assert.equal(canViewCase(actor, { assignedSalesId: 'other', contractSnapshot: { trainerId: 'trainer-legacy' } }), true)
  assert.equal(canViewCase(actor, { assignedSalesId: 'other', contractSnapshot: { trainerId: 'unrelated' } }), false)
})

test('sales renewal scope remains limited to personally assigned cases', () => {
  const actor = {
    uid: 'sales-1', renewalScope: 'self',
    renewalCanViewSalesCases: true, renewalCanViewTrainerCases: false,
  }
  assert.equal(canViewCase(actor, { assignedSalesId: 'sales-1', contractSnapshot: { trainerId: 'trainer-1' } }), true)
  assert.equal(canViewCase(actor, { assignedSalesId: 'sales-2', contractSnapshot: { trainerId: 'sales-1' } }), false)
})

test('trainer renewal API is financially redacted and sales-only mutations fail closed', () => {
  const source = require('node:fs').readFileSync(require('node:path').join(__dirname, 'contract-renewals.js'), 'utf8')
  assert.match(source, /contractSnapshot\.trainerIds', 'array-contains'/)
  assert.match(source, /contractSnapshot\.nutritionPTIds', 'array-contains'/)
  assert.match(source, /expectedValue: actor\.renewalCanSell === true \? Number\(value\.expectedValue \|\| 0\) : 0/)
  assert.match(source, /const createRenewalQuote = renewalCall[\s\S]*?requireRenewalSalesAction\(actor\)/)
  assert.match(source, /const renewPtContract = renewalCall[\s\S]*?requireRenewalSalesAction\(actor\)/)
  assert.match(source, /contractPaymentJournal/)
  assert.match(source, /journalEntries\/\$\{paymentReference\.id\}/)
  assert.match(source, /accountingAdvanceAccountCode: '131'/)
})
