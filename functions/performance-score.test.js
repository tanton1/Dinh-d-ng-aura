const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const {
  PERFORMANCE_CATEGORIES,
  PROFILE_CHECKLIST_KEYS,
  calculateBrandPerformance,
  calculateMetricScore,
  calculatePerformanceSummary,
  bonusForScore,
  normalizeUrl,
  proofKey,
  assertBranchScope,
} = require('./performance-score')

function evidence(type, id, extra = {}) {
  return { id, type, status: 'approved', duplicateKey: id, ...extra }
}

test('Aura Performance Score keeps the approved 100-point weight model', () => {
  assert.deepEqual(PERFORMANCE_CATEGORIES.map(({ id, weight }) => ({ id, weight })), [
    { id: 'coaching_quality', weight: 25 },
    { id: 'client_care', weight: 15 },
    { id: 'nutrition_care', weight: 10 },
    { id: 'retention_renew', weight: 20 },
    { id: 'business_contribution', weight: 10 },
    { id: 'brand', weight: 10 },
    { id: 'operations_discipline', weight: 10 },
  ])
  assert.equal(PERFORMANCE_CATEGORIES.reduce((sum, item) => sum + item.weight, 0), 100)
  PERFORMANCE_CATEGORIES.forEach((category) => {
    assert.equal(category.submetrics.reduce((sum, item) => sum + item.weight, 0), category.weight)
  })
  const brand = PERFORMANCE_CATEGORIES.find((item) => item.id === 'brand')
  assert.deepEqual(brand.submetrics.map(({ id, weight }) => ({ id, weight })), [
    { id: 'personal_brand', weight: 5 },
    { id: 'aura_brand', weight: 3 },
    { id: 'profile_quality', weight: 2 },
  ])
})

test('Personal Brand follows the 0, 1, 2.5, 4 and 5 point table', () => {
  const scores = [0, 1, 2, 3, 4, 6].map((count) => calculateBrandPerformance(
    Array.from({ length: count }, (_, index) => evidence('personal_content', `personal-${index}`)),
  ).personal.score)
  assert.deepEqual(scores, [0, 1, 2.5, 4, 5, 5])
})

test('Aura Brand caps at three and Profile Quality awards 0.2 per checklist item', () => {
  const checklist = Object.fromEntries(PROFILE_CHECKLIST_KEYS.map((key, index) => [key, index < 7]))
  const result = calculateBrandPerformance([
    ...Array.from({ length: 5 }, (_, index) => evidence('aura_assignment', `aura-${index}`, { briefId: `brief-${index}` })),
    evidence('profile_checklist', 'profile', { checklist, reviewedAt: new Date('2026-09-07T00:00:00Z') }),
  ])
  assert.equal(result.aura.approvedCount, 3)
  assert.equal(result.aura.score, 3)
  assert.equal(result.profile.completedCount, 7)
  assert.equal(result.profile.score, 1.4)
})

test('pending or repeated evidence never inflates the brand score', () => {
  const result = calculateBrandPerformance([
    evidence('personal_content', 'one', { duplicateKey: 'same' }),
    evidence('personal_content', 'two', { duplicateKey: 'same' }),
    evidence('personal_content', 'pending', { status: 'submitted', duplicateKey: 'new' }),
  ])
  assert.equal(result.personal.approvedCount, 1)
  assert.equal(result.personal.score, 1)
})

test('deterministic metric formulas follow the issued KPI bands', () => {
  assert.equal(calculateMetricScore('customer_rating', { source: 'manager_review', actual: 4.8 }).score, 10)
  assert.equal(calculateMetricScore('customer_rating', { source: 'manager_review', actual: 4.69 }).score, 8)
  assert.equal(calculateMetricScore('coaching_audit', { source: 'manager_review', actual: 85 }).score, 6.8)
  assert.equal(calculateMetricScore('weekly_checkin', { source: 'manager_review', numerator: 36, denominator: 40 }).score, 5.4)
  assert.equal(calculateMetricScore('renew_rate', { source: 'manager_review', actual: 75 }).score, 14)
  assert.equal(calculateMetricScore('self_generated_revenue', { source: 'manager_review', actual: 80, target: 100 }).score, 3)
  assert.equal(calculateMetricScore('renew_cash_vs_forecast', { source: 'manager_review', actual: 89, target: 100 }).score, 1)
  assert.equal(calculateMetricScore('qualified_lead_conversion', { source: 'manager_review', actual: 100, target: 100 }).score, 2)
  assert.equal(calculateMetricScore('attendance', { source: 'manager_review', actual: 97.5 }).score, 2)
})

test('ambiguous low rating and renew bands require an approved rubric instead of guessing', () => {
  assert.equal(calculateMetricScore('customer_rating', { source: 'system_auto', actual: 4.2 }).status, 'needs_review')
  assert.equal(calculateMetricScore('renew_rate', { source: 'manager_review', actual: 35 }).status, 'needs_review')
  assert.equal(calculateMetricScore('customer_rating', { source: 'manager_review', actual: 4.2, manualScore: 3 }).score, 3)
  assert.equal(calculateMetricScore('renew_rate', { source: 'manager_review', actual: 35, manualScore: 4 }).score, 4)
})

function maximumMetricInputs(attendance = 100) {
  return {
    customer_rating: { source: 'manager_review', actual: 4.8 },
    coaching_audit: { source: 'manager_review', actual: 100 },
    client_progress: { source: 'manager_review', manualScore: 7 },
    weekly_checkin: { source: 'manager_review', numerator: 10, denominator: 10 },
    at_risk_followup: { source: 'manager_review', numerator: 4, denominator: 4 },
    progress_review: { source: 'manager_review', numerator: 3, denominator: 3 },
    communication: { source: 'manager_review', manualScore: 2 },
    nutrition_review_completion: { source: 'manager_review', numerator: 4, denominator: 4 },
    feedback_sla: { source: 'manager_review', numerator: 3, denominator: 3 },
    compliance_management: { source: 'manager_review', manualScore: 3 },
    renew_rate: { source: 'manager_review', actual: 85 },
    renewal_process: { source: 'manager_review', numerator: 5, denominator: 5 },
    churn_documentation: { source: 'manager_review', numerator: 2, denominator: 2 },
    self_generated_revenue: { source: 'manager_review', actual: 100, target: 100 },
    renew_cash_vs_forecast: { source: 'manager_review', actual: 90, target: 100 },
    qualified_lead_conversion: { source: 'manager_review', actual: 20, target: 20 },
    quality_new_referral: { source: 'manager_review', numerator: 2, denominator: 2 },
    attendance: { source: 'manager_review', actual: attendance },
    schedule_management: { source: 'manager_review', manualScore: 2 },
    training_notes: { source: 'manager_review', manualScore: 2 },
    sop: { source: 'manager_review', manualScore: 2 },
    teamwork: { source: 'manager_review', manualScore: 1 },
  }
}

function maximumBrandEvidence() {
  const checklist = Object.fromEntries(PROFILE_CHECKLIST_KEYS.map((key) => [key, true]))
  return [
    ...Array.from({ length: 4 }, (_, index) => evidence('personal_content', `personal-max-${index}`)),
    ...Array.from({ length: 3 }, (_, index) => evidence('aura_assignment', `aura-max-${index}`, { briefId: `brief-max-${index}` })),
    evidence('profile_checklist', 'profile-max', { checklist, reviewedAt: new Date('2026-09-07T00:00:00Z') }),
  ]
}

test('a complete scorecard totals 100 and unlocks the correct bonus only after all gates pass', () => {
  const summary = calculatePerformanceSummary({
    evidence: maximumBrandEvidence(),
    metricInputs: maximumMetricInputs(),
    gateInputs: {
      client_safety: { status: 'pass', source: 'manager_review', reason: 'Không có critical safety violation.' },
      integrity: { status: 'pass', source: 'manager_review', reason: 'Không có gian lận được xác minh.' },
    },
  })
  assert.equal(summary.coverage.availableWeight, 100)
  assert.equal(summary.score.value, 100)
  assert.equal(summary.gates.every((gate) => gate.status === 'pass'), true)
  assert.deepEqual(summary.bonus, {
    eligibility: 'eligible', recommendedAmount: 3_000_000, classification: 'Outstanding',
    reason: 'Đã đủ điểm và vượt cả bốn Gate.',
  })
})

test('a failed Attendance Gate keeps the analytical score but makes KPI bonus zero', () => {
  const summary = calculatePerformanceSummary({
    evidence: maximumBrandEvidence(), metricInputs: maximumMetricInputs(97.5),
    gateInputs: {
      client_safety: { status: 'pass', reason: 'Đạt' },
      integrity: { status: 'pass', reason: 'Đạt' },
    },
  })
  assert.equal(summary.score.value, 99)
  assert.equal(summary.gates.find((gate) => gate.id === 'attendance').status, 'fail')
  assert.equal(summary.bonus.eligibility, 'ineligible')
  assert.equal(summary.bonus.recommendedAmount, 0)
})

test('an approved attendance emergency exception is explicit and auditable', () => {
  const summary = calculatePerformanceSummary({
    evidence: maximumBrandEvidence(), metricInputs: maximumMetricInputs(97.5),
    gateInputs: {
      attendance: { status: 'pass', source: 'manager_review', reason: 'Ngoại lệ khẩn cấp EV-2026-09-01 đã được duyệt.', evidenceRefs: ['incident/EV-2026-09-01'] },
      client_safety: { status: 'pass', reason: 'Đạt' }, integrity: { status: 'pass', reason: 'Đạt' },
    },
  })
  const attendanceGate = summary.gates.find((gate) => gate.id === 'attendance')
  assert.equal(attendanceGate.status, 'pass')
  assert.equal(attendanceGate.source, 'manager_review')
  assert.deepEqual(attendanceGate.evidenceRefs, ['incident/EV-2026-09-01'])
})

test('missing data remains N/A and never silently becomes zero', () => {
  const summary = calculatePerformanceSummary({ evidence: maximumBrandEvidence() })
  assert.equal(summary.coverage.availableWeight, 10)
  assert.equal(summary.score.value, null)
  assert.equal(summary.score.provisionalValue, 10)
  assert.equal(summary.categories.find((item) => item.id === 'coaching_quality').score, null)
  assert.equal(summary.bonus.eligibility, 'pending')
})

test('bonus bands match the issued Performance Score policy', () => {
  assert.deepEqual([95, 90, 85, 80, 70, 69.99].map((score) => bonusForScore(score).bonusAmount), [3_000_000, 2_000_000, 1_500_000, 1_000_000, 500_000, 0])
})

test('evidence URLs drop tracking and fragments before deduplication', () => {
  assert.equal(
    normalizeUrl('https://Facebook.com/groups/aura/posts/123/?utm_source=x&fbclid=y#comment'),
    'https://facebook.com/groups/aura/posts/123',
  )
})

test('the same screenshot cannot be counted twice through different social links', () => {
  const contentHash = 'a'.repeat(64)
  const left = proofKey({ type: 'personal_content', url: 'https://facebook.com/post/1', contentHash, briefId: '', screenshotPath: 'first.jpg' })
  const right = proofKey({ type: 'personal_content', url: 'https://group.example/post/2', contentHash, briefId: '', screenshotPath: 'second.jpg' })
  assert.equal(left, right)
})

test('distinct Aura Brand tasks under one campaign remain separately countable', () => {
  const first = proofKey({ type: 'aura_assignment', url: 'https://facebook.com/post/1', contentHash: '', briefId: 'campaign-september', screenshotPath: '' })
  const second = proofKey({ type: 'aura_assignment', url: 'https://facebook.com/post/2', contentHash: '', briefId: 'campaign-september', screenshotPath: '' })
  assert.notEqual(first, second)
})

test('manager reviews are branch scoped while Admin can review the whole system', () => {
  const manager = { accessRole: 'staff', positions: ['branch_manager'], capabilities: ['performance.evidence.review'], branchIds: ['branch-a'] }
  assert.doesNotThrow(() => assertBranchScope(manager, ['branch-a']))
  assert.throws(() => assertBranchScope(manager, ['branch-b']), /cùng chi nhánh/)
  assert.doesNotThrow(() => assertBranchScope({ ...manager, accessRole: 'admin', branchIds: [] }, ['branch-b']))
})

test('Firestore and Storage deny direct evidence writes while callable exports remain explicit', () => {
  const root = path.join(__dirname, '..')
  const firestoreRules = fs.readFileSync(path.join(root, 'firestore.rules'), 'utf8')
  const storageRules = fs.readFileSync(path.join(root, 'storage.rules'), 'utf8')
  const indexSource = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8')
  assert.match(firestoreRules, /match \/performanceEvidence\/\{evidenceId\}[\s\S]*?allow read, write: if false/)
  assert.match(firestoreRules, /match \/performanceAssessments\/\{assessmentId\}[\s\S]*?allow read, write: if false/)
  assert.match(storageRules, /match \/performance-evidence\/\{userId\}\/\{periodId\}\/\{evidenceId\}\/\{fileName\}[\s\S]*?request\.resource\.metadata\.ownerUid == userId/)
  assert.match(indexSource, /exports\.submitPerformanceBrandEvidenceV2/)
  assert.match(indexSource, /exports\.reviewPerformanceBrandEvidenceV2/)
  assert.match(indexSource, /exports\.savePerformanceMetricAssessmentV2/)
  assert.match(indexSource, /exports\.savePerformanceGateAssessmentV2/)
  assert.match(indexSource, /exports\.setPerformanceSnapshotLockV2/)
  const performanceSource = fs.readFileSync(path.join(__dirname, 'performance-score.js'), 'utf8')
  const submitBlock = performanceSource.match(/const submitPerformanceBrandEvidence[\s\S]*?const withdrawPerformanceBrandEvidence/)?.[0] || ''
  assert.match(submitBlock, /actor\.legacyStaffId \|\| actor\.uid/)
  assert.doesNotMatch(submitBlock, /request\.data\?\.staffId/)
  assert.match(performanceSource, /performanceSnapshots\/\$\{period\}_\$\{staffId\}[\s\S]*?locked === true/)
  assert.match(performanceSource, /amountImpact: 'none'/)
  assert.match(performanceSource, /action: 'performance\.metric\.assessed'/)
  assert.match(performanceSource, /before,[\s\S]*after: assessment,[\s\S]*reason: assessment\.note/)
})
