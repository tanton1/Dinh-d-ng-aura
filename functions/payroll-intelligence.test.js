const assert = require('node:assert/strict')
const test = require('node:test')
const {
  normalizePayrollIntelligencePolicy,
  chooseEffectivePayrollIntelligencePolicy,
  resolveAttribution,
  buildEvidenceLedger,
  calculateKpiSummary,
  calculateRankSummary,
  buildPayrollIntelligence,
} = require('./payroll-intelligence')

function policy(overrides = {}) {
  return normalizePayrollIntelligencePolicy({
    id: 'incentive-a',
    name: 'KPI test',
    effectiveFrom: '2026-08-01',
    enabled: true,
    metrics: {
      teaching_slots: { source: 'teaching_slots', label: 'Ca dạy', enabled: true, weight: 50, target: 10 },
      feedback_score: { source: 'feedback_score', label: 'Điểm đánh giá', enabled: true, weight: 50, target: 5 },
    },
    attributionRules: [
      { sourceType: 'teaching', priority: ['trainerId'] },
      { sourceType: 'revenue', priority: ['referralStaffId', 'assignedSalesId'] },
      { sourceType: 'renewal', priority: ['assignedSalesId', 'trainerId'] },
      { sourceType: 'feedback', priority: ['actualTrainerId', 'trainerId'] },
    ],
    rankBands: [
      { code: 'a', label: 'A', minScore: 90, maxScore: 100 },
      { code: 'b', label: 'B', minScore: 0, maxScore: 89.99 },
    ],
    renew: { wonStages: ['won'] },
    ...overrides,
  }, 'incentive-a')
}

test('effective policy selection is versioned and does not choose a future policy', () => {
  const selected = chooseEffectivePayrollIntelligencePolicy([
    { id: 'old', effectiveFrom: '2026-08-01', version: 1, enabled: true, metrics: { a: { source: 'teaching_slots', enabled: true, weight: 1, target: 1 } } },
    { id: 'future', effectiveFrom: '2026-09-01', version: 2, enabled: true, metrics: { a: { source: 'teaching_slots', enabled: true, weight: 1, target: 1 } } },
  ], '2026-08-31')
  assert.equal(selected.id, 'old')
})

test('attribution follows configured priority and records ambiguity', () => {
  const result = resolveAttribution({ sourceType: 'renewal', assignedSalesId: 'sales-1', trainerId: 'trainer-1' }, policy())
  assert.deepEqual(result.staffIds, ['sales-1'])
  assert.equal(result.conflict, true)
  const unresolved = resolveAttribution({ sourceType: 'renewal' }, policy())
  assert.deepEqual(unresolved.staffIds, [])
  assert.equal(unresolved.conflict, true)
})

test('evidence ledger groups a paired teaching shift as one evidence unit', () => {
  const ledger = buildEvidenceLedger({
    staffId: 'trainer-1',
    teachingSlots: [{ key: 'trainer-1|2026-08-05|18', date: '2026-08-05', hour: 18, studentCount: 2 }],
    referralEvidence: { commissionAmount: 100_000, evidence: [{ ledgerEntryId: 'ledger-1', cashImpact: 1_000_000 }] },
    feedback: [{ id: 'feedback-1', trainerId: 'trainer-1', actualTrainerId: 'trainer-1', sessionDate: '2026-08-05', overallScore: 5, status: 'submitted' }],
    renewals: [{ id: 'renewal-1', stage: 'won', assignedSalesId: 'trainer-1', wonValue: 2_000_000, updatedAt: '2026-08-10' }],
    workdays: { paidDays: 1 },
    policy: policy(),
  })
  assert.equal(ledger.filter((item) => item.sourceType === 'teaching').length, 1)
  assert.equal(ledger.filter((item) => item.sourceType === 'revenue').length, 1)
  assert.equal(ledger.filter((item) => item.sourceType === 'renewal').length, 1)
  assert.equal(ledger.filter((item) => item.sourceType === 'workdays').length, 1)
  assert.equal(ledger.find((item) => item.sourceType === 'workdays').date, '')
})

test('KPI and rank are analytical only and do not produce payroll money', () => {
  const result = buildPayrollIntelligence({
    staffId: 'trainer-1',
    teachingSlots: Array.from({ length: 10 }, (_, index) => ({ key: `slot-${index}`, date: '2026-08-05', hour: index })),
    feedback: Array.from({ length: 2 }, (_, index) => ({ id: `feedback-${index}`, trainerId: 'trainer-1', overallScore: 5, sessionDate: '2026-08-05', status: 'submitted' })),
    workdays: { paidDays: 1 },
    policy: policy(),
  })
  assert.equal(result.kpi.score, 100)
  assert.equal(result.rank.label, 'A')
  assert.equal(result.amountImpact, 'none')
  assert.equal(result.evidenceLedgerSummary.count, 13)
})

test('payroll intelligence is snapshotted without changing payroll money fields', () => {
  const fs = require('node:fs')
  const path = require('node:path')
  const source = fs.readFileSync(path.join(__dirname, 'payroll.js'), 'utf8')
  const index = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8')
  const rules = fs.readFileSync(path.join(__dirname, '..', 'firestore.rules'), 'utf8')

  assert.match(source, /incentiveAmountImpact:\s*'none'/)
  assert.match(source, /intelligencePolicySnapshot:/)
  assert.match(source, /evidenceLedger:/)
  assert.match(source, /const teachingPayAmount = teachingSlots\.reduce/)
  assert.match(index, /exports\.listPayrollIntelligencePoliciesV2/)
  assert.match(index, /exports\.savePayrollIntelligencePolicyV2/)
  assert.match(index, /exports\.managePayrollIntelligencePolicyV2/)
  assert.match(rules, /match \/payrollIncentivePolicies\/\{policyId\}/)
  assert.match(rules, /allow read, write: if false/)
})

test('disabled policy keeps the existing payroll layer untouched', () => {
  const result = buildPayrollIntelligence({ staffId: 'trainer-1', teachingSlots: [], policy: null })
  assert.equal(result.enabled, false)
  assert.equal(result.kpi.score, null)
  assert.equal(result.amountImpact, 'none')
})
