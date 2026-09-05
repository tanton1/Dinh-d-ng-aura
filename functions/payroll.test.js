const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const {
  applyPayrollPolicyPlan,
  duplicateLearnerDayViolations,
  payrollRunPolicyPlan,
  periodBounds,
  periodDateBounds,
  payrollPeriodClosed,
  payrollPolicyConfiguration,
  teachingSlotsFromAttendance,
  teachingSlotsFromSessions,
} = require('./payroll')

test('payroll period uses Asia/Ho_Chi_Minh calendar boundaries', () => {
  const bounds = periodBounds('2026-08')

  assert.equal(bounds.start.toDate().toISOString(), '2026-07-31T17:00:00.000Z')
  assert.equal(bounds.end.toDate().toISOString(), '2026-08-31T17:00:00.000Z')
})

test('payroll December period rolls over to the next year', () => {
  const bounds = periodBounds('2026-12')

  assert.equal(bounds.start.toDate().toISOString(), '2026-11-30T17:00:00.000Z')
  assert.equal(bounds.end.toDate().toISOString(), '2026-12-31T17:00:00.000Z')
})

test('payroll date queries and closing guard follow the same Vietnam business period', () => {
  assert.deepEqual(periodDateBounds('2026-12'), { start: '2026-12-01', end: '2027-01-01' })
  assert.equal(payrollPeriodClosed('2026-08', new Date('2026-08-31T16:59:59.999Z')), false)
  assert.equal(payrollPeriodClosed('2026-08', new Date('2026-08-31T17:00:00.000Z')), true)
})

test('payroll policy rejects impossible dates and unsafe rates', () => {
  const { policyEffectiveDate, policyRate } = require('./payroll')
  assert.throws(() => policyEffectiveDate('2026-02-31'), /Ngày hiệu lực/)
  assert.throws(() => policyRate(Number.NaN), /Đơn giá/)
  assert.throws(() => policyRate(999), /Đơn giá/)
  assert.equal(policyEffectiveDate('2026-08-01').timestamp.toDate().toISOString(), '2026-07-31T17:00:00.000Z')
  assert.equal(policyRate(20_000), 20_000)
  assert.deepEqual(payrollPolicyConfiguration({
    ratePerSession: 20_000,
    dailySessionThreshold: 8,
    rateAfterDailyThreshold: 70_000,
    eveningStartHour: 20,
    rateAfterDailyThresholdEvening: 80_000,
  }), {
    ratePerSession: 20_000,
    dailySessionThreshold: 8,
    rateAfterDailyThreshold: 70_000,
    eveningStartHour: 20,
    rateAfterDailyThresholdEvening: 80_000,
  })
})

test('two learners in the same trainer slot count as one paid class and daily tiers start after class eight', () => {
  const sessions = new Map()
  const attendance = []
  const hours = [6, 7, 8, 9, 10, 11, 12, 13, 14, 20]
  hours.forEach((hour, index) => {
    const sessionId = `session-${hour}-student-${index}`
    sessions.set(sessionId, { trainerId: 'trainer-a', studentId: `student-${index}`, date: '2026-08-25', hour })
    attendance.push({ id: `attendance-${index}`, type: 'attended', sessionId, studentId: `student-${index}`, trainerId: 'trainer-a' })
  })
  sessions.set('session-6-student-b', { trainerId: 'trainer-a', studentId: 'student-b', date: '2026-08-25', hour: 6 })
  attendance.push({ id: 'attendance-b', type: 'attended', sessionId: 'session-6-student-b', studentId: 'student-b', trainerId: 'trainer-a' })
  attendance.push({ id: 'policy-charge', type: 'charged_cancellation', sessionId: 'missing-policy-session', trainerId: 'trainer-a' })

  const result = teachingSlotsFromAttendance(attendance, sessions, {
    ratePerSession: 20_000,
    dailySessionThreshold: 8,
    rateAfterDailyThreshold: 70_000,
    eveningStartHour: 20,
    rateAfterDailyThresholdEvening: 80_000,
  })
  const slots = result.trainers.get('trainer-a')

  assert.equal(result.attendanceEventCount, 11)
  assert.equal(result.teachingSlotCount, 10)
  assert.equal(slots.length, 10)
  assert.equal(slots[0].studentCount, 2)
  assert.equal(slots[0].rate, 20_000)
  assert.equal(slots[8].dailyPosition, 9)
  assert.equal(slots[8].rate, 70_000)
  assert.equal(slots[9].dailyPosition, 10)
  assert.equal(slots[9].rate, 80_000)
  assert.equal(slots.reduce((sum, slot) => sum + slot.rate, 0), 310_000)
})

test('canonical completed sessions produce the same paired teaching shifts without attendance fan-out reads', () => {
  const sessions = [
    { id: 'session-a', status: 'completed', trainerId: 'trainer-a', studentId: 'student-a', branchId: 'branch-a', date: '2026-08-25', hour: 6 },
    { id: 'session-b', status: 'attended', trainerId: 'trainer-a', studentId: 'student-b', branchId: 'branch-a', date: '2026-08-25', hour: 6 },
    { id: 'session-cancelled', status: 'cancelled', trainerId: 'trainer-a', studentId: 'student-c', branchId: 'branch-a', date: '2026-08-25', hour: 7 },
  ]
  const result = teachingSlotsFromSessions(sessions, {
    ratePerSession: 20_000,
    dailySessionThreshold: 8,
    rateAfterDailyThreshold: 70_000,
    eveningStartHour: 20,
    rateAfterDailyThresholdEvening: 80_000,
  })
  const slots = result.trainers.get('trainer-a')

  assert.equal(result.attendanceEventCount, 2)
  assert.equal(result.teachingSlotCount, 1)
  assert.equal(slots.length, 1)
  assert.equal(slots[0].studentCount, 2)
  assert.deepEqual(slots[0].sessionIds.sort(), ['session-a', 'session-b'])
})

test('automatic 48-hour attendance remains review evidence and never becomes teaching pay', () => {
  const result = teachingSlotsFromSessions([
    { id: 'manual', status: 'completed', trainerId: 'trainer-a', studentId: 'student-a', date: '2026-08-25', hour: 6, confirmationSource: 'manual', recognitionReviewRequired: false },
    { id: 'automatic', status: 'completed', trainerId: 'trainer-a', studentId: 'student-b', date: '2026-08-25', hour: 7, confirmationSource: 'auto_after_48h', recognitionReviewRequired: true },
  ], { ratePerSession: 20_000 })

  assert.equal(result.teachingSlotCount, 1)
  assert.equal(result.teachingEvidenceReviewRequiredCount, 1)
  assert.deepEqual(result.teachingEvidenceReviewRequiredSessionIds, ['automatic'])
  assert.deepEqual(result.trainers.get('trainer-a')[0].sessionIds, ['manual'])
})

test('legacy attendance rebuild excludes automatic review evidence', () => {
  const sessions = new Map([
    ['automatic', { trainerId: 'trainer-a', studentId: 'student-a', date: '2026-08-25', hour: 6, confirmationSource: 'auto_after_48h', recognitionReviewRequired: true }],
  ])
  const result = teachingSlotsFromAttendance([
    { id: 'automatic', type: 'attended', sessionId: 'automatic', studentId: 'student-a', confirmationSource: 'auto_after_48h', recognitionReviewRequired: true },
  ], sessions, { ratePerSession: 20_000 })

  assert.equal(result.teachingSlotCount, 0)
  assert.equal(result.teachingEvidenceReviewRequiredCount, 1)
})

test('a learner attending another branch remains payable as one teaching slot', () => {
  const result = teachingSlotsFromSessions([
    { id: 'session-a', status: 'completed', trainerId: 'trainer-a', studentId: 'student-a', branchId: 'branch-a', date: '2026-08-25', hour: 6 },
    { id: 'session-b', status: 'completed', trainerId: 'trainer-a', studentId: 'student-b', branchId: 'branch-b', date: '2026-08-25', hour: 6 },
  ], { ratePerSession: 20_000 })
  const slot = result.trainers.get('trainer-a')[0]
  assert.equal(result.teachingSlotCount, 1)
  assert.equal(result.crossBranchWarningCount, 1)
  assert.equal(slot.studentCount, 2)
  assert.equal(slot.crossBranchWarning, true)
  assert.deepEqual(slot.branchIds.sort(), ['branch-a', 'branch-b'])
})

test('payroll reports every learner recorded more than once on the same completed day', () => {
  let error
  try {
    teachingSlotsFromSessions([
      { id: 'session-a', status: 'completed', trainerId: 'trainer-a', studentId: 'student-a', branchId: 'branch-a', date: '2026-08-25', hour: 6 },
      { id: 'session-b', status: 'attended', trainerId: 'trainer-b', studentId: 'student-a', branchId: 'branch-b', date: '2026-08-25', hour: 18 },
      { id: 'session-c', status: 'completed', trainerId: 'trainer-c', studentId: 'student-c', branchId: 'branch-a', date: '2026-08-26', hour: 7 },
      { id: 'session-d', status: 'completed', trainerId: 'trainer-c', studentId: 'student-c', branchId: 'branch-a', date: '2026-08-26', hour: 19 },
    ], { ratePerSession: 20_000 })
    assert.fail('Expected duplicate learner days')
  } catch (cause) {
    error = cause
  }
  assert.equal(error.details.kind, 'payroll_validation')
  assert.equal(error.details.violations.length, 2)
  assert.deepEqual(error.details.violations[0].sessionIds, ['session-a', 'session-b'])
  assert.deepEqual(error.details.violations[0].trainerIds, ['trainer-a', 'trainer-b'])
  assert.deepEqual(error.details.violations[0].branchIds, ['branch-a', 'branch-b'])
  assert.deepEqual(error.details.violations[0].hours, [6, 18])
  assert.equal(error.details.violations[0].studentId, 'student-a')
  assert.equal(error.details.violations[0].remediation, 'teaching_history')
})

test('legacy payroll diagnostics can be shown without changing the stored run', () => {
  const violations = duplicateLearnerDayViolations([
    { id: 'session-a', data: () => ({ status: 'completed', trainerId: 'trainer-a', studentId: 'student-a', branchId: 'branch-a', date: '2026-08-25', hour: 6 }) },
    { id: 'session-b', data: () => ({ status: 'attended', trainerId: 'trainer-b', studentId: 'student-a', branchId: 'branch-b', date: '2026-08-25', hour: 18 }) },
  ])

  assert.equal(violations.length, 1)
  assert.equal(violations[0].code, 'STUDENT_MULTIPLE_COMPLETED_SESSIONS_PER_DAY')
  assert.deepEqual(violations[0].sessionIds, ['session-a', 'session-b'])
  assert.equal(violations[0].remediation, 'teaching_history')
})

test('payroll keeps every cross-branch slot as a non-blocking diagnostic', () => {
  const result = teachingSlotsFromSessions([
    { id: 'session-a', status: 'completed', trainerId: 'trainer-a', studentId: 'student-a', branchId: 'branch-a', date: '2026-08-25', hour: 6 },
    { id: 'session-b', status: 'completed', trainerId: 'trainer-a', studentId: 'student-b', branchId: 'branch-b', date: '2026-08-25', hour: 6 },
    { id: 'session-c', status: 'completed', trainerId: 'trainer-a', studentId: 'student-c', branchId: 'branch-a', date: '2026-08-26', hour: 6 },
    { id: 'session-d', status: 'completed', trainerId: 'trainer-a', studentId: 'student-d', branchId: 'branch-b', date: '2026-08-26', hour: 6 },
  ], { ratePerSession: 20_000 })
  assert.equal(result.crossBranchWarningCount, 2)
  assert.equal(result.teachingSlotCount, 2)
  assert.equal([...result.trainers.get('trainer-a')].filter((slot) => slot.crossBranchWarning).length, 2)
})

test('legacy all-branch sentinel does not create a false payroll branch conflict', () => {
  const result = teachingSlotsFromSessions([
    { id: 'session-a', status: 'completed', trainerId: 'trainer-a', studentId: 'student-a', branchId: 'branch-a', date: '2026-08-25', hour: 6 },
    { id: 'session-b', status: 'completed', trainerId: 'trainer-a', studentId: 'student-b', branchId: 'all', date: '2026-08-25', hour: 6 },
  ], { ratePerSession: 20_000 })
  const slot = result.trainers.get('trainer-a')[0]
  assert.equal(result.teachingSlotCount, 1)
  assert.equal(slot.studentCount, 2)
  assert.equal(slot.branchId, 'branch-a')
})

test('invalid completed sessions return actionable payroll validation details', () => {
  let error
  try {
    teachingSlotsFromSessions([
      { id: 'session-invalid', status: 'completed', trainerId: '', studentId: 'student-a', branchId: 'branch-a', date: '2026-08-25', hour: 6 },
    ], { ratePerSession: 20_000 })
    assert.fail('Expected missing trainer')
  } catch (cause) {
    error = cause
  }

  assert.equal(error.details.kind, 'payroll_validation')
  assert.deepEqual(error.details.violations[0], {
    code: 'SESSION_TRAINER_MISSING',
    severity: 'error',
    title: 'Ca dạy chưa có PT phụ trách',
    detail: 'Một ca đã hoàn thành nhưng chưa liên kết PT. Hãy gán lại PT cho ca trước khi lập lương.',
    remediation: 'teaching_history',
    sessionId: 'session-invalid',
    studentId: 'student-a',
    branchId: 'branch-a',
    date: '2026-08-25',
  })
})

test('payroll creation is one deterministic transaction per period', () => {
  const source = fs.readFileSync(path.join(__dirname, 'payroll.js'), 'utf8')
  const createBlock = source.match(/const createPayrollRun[\s\S]*?\n  async function transition/)?.[0] || ''

  assert.match(createBlock, /db\.doc\(`payrollRuns\/\$\{periodId\}`\)/)
  assert.match(createBlock, /db\.runTransaction/)
  assert.match(createBlock, /transaction\.create\(runReference/)
  assert.match(createBlock, /payrollRunItems\/\$\{periodId\}_\$\{staffId\}/)
  assert.match(createBlock, /teachingSlotsFromSessions\(sessionSnapshot\.docs/)
  assert.match(createBlock, /\.select\('status', 'trainerId', 'studentId', 'date', 'hour', 'branchId', 'attendanceEventId', 'attendanceStatus', 'confirmationSource', 'recognitionReviewRequired'\)/)
  assert.doesNotMatch(createBlock, /Promise\.all\(sessionIds\.map/)
  assert.doesNotMatch(createBlock, /db\.collection\('payrollRuns'\)\.doc\(\)/)
})

test('locking a payroll run records an immutable management expense', () => {
  const source = fs.readFileSync(path.join(__dirname, 'payroll.js'), 'utf8')
  const lockBlock = source.match(/const lockPayrollRun[\s\S]*?\n  const markPayrollRunPaid/)?.[0] || ''
  assert.match(lockBlock, /ledgerEntries\/payroll_\$\{runId\}/)
  assert.match(lockBlock, /type: 'payroll'/)
  assert.match(lockBlock, /eventClass: 'payroll_accrual'/)
  assert.match(lockBlock, /expenseImpact: finalAmount/)
  assert.match(lockBlock, /cashImpact: 0/)
  assert.match(lockBlock, /journalEntries\/payroll_\$\{runId\}/)
  assert.match(lockBlock, /payrollAccrualJournal/)
  assert.match(lockBlock, /assertFinancePeriodOpen/)
  assert.match(lockBlock, /db\.runTransaction/)
})

test('payroll payout creates the cash-book and ledger entries atomically', () => {
  const source = fs.readFileSync(path.join(__dirname, 'payroll.js'), 'utf8')
  const payoutStart = source.indexOf('const markPayrollRunPaid = payrollCall')
  const payoutTail = payoutStart >= 0 ? source.slice(payoutStart) : ''
  const payoutEnd = payoutTail.search(/\r?\n  return \{\r?\n    listPayrollPolicies/)
  const payoutBlock = payoutEnd > 0 ? payoutTail.slice(0, payoutEnd) : ''

  assert.match(payoutBlock, /ledgerEntries\/payroll_payment_\$\{runId\}/)
  assert.match(payoutBlock, /cashTransactions\/payroll_\$\{runId\}/)
  assert.match(payoutBlock, /cashAccounts\/\$\{cashAccountId\}/)
  assert.match(payoutBlock, /eventClass: 'payroll_payment'/)
  assert.match(payoutBlock, /cashImpact: -finalAmount/)
  assert.match(payoutBlock, /expenseImpact: 0/)
  assert.match(payoutBlock, /journalEntries\/payroll_payment_\$\{runId\}/)
  assert.match(payoutBlock, /payrollPaymentJournal/)
  assert.match(payoutBlock, /FieldValue\.increment\(-finalAmount\)/)
  assert.match(payoutBlock, /status !== 'locked'/)
  assert.match(payoutBlock, /db\.runTransaction/)
})

test('payroll policy versions are immutable, independently selectable and audited', () => {
  const source = fs.readFileSync(path.join(__dirname, 'payroll.js'), 'utf8')
  const start = source.indexOf('const savePayrollPolicy = payrollCall')
  const end = source.indexOf('const managePayrollPolicy = payrollCall', start)
  const block = start >= 0 && end > start ? source.slice(start, end) : ''

  assert.match(block, /payrollPolicies\/\$\{policyId\}/)
  assert.match(block, /createHash\('sha256'\)/)
  assert.match(block, /transaction\.create\(reference/)
  assert.match(block, /already-exists/)
  assert.match(block, /payroll\.policy\.created/)
  assert.doesNotMatch(block, /transaction\.update\(reference/)
})

test('used payroll policies can only be hidden while unused policies may be deleted', () => {
  const source = fs.readFileSync(path.join(__dirname, 'payroll.js'), 'utf8')
  const start = source.indexOf('const managePayrollPolicy = payrollCall')
  const end = source.indexOf('const listPayrollRuns = payrollCall', start)
  const block = start >= 0 && end > start ? source.slice(start, end) : ''

  assert.match(block, /where\('policyId', '==', policyId\)/)
  assert.match(block, /where\('policyIds', 'array-contains', policyId\)/)
  assert.match(block, /if \(used\)/)
  assert.match(block, /chỉ có thể ẩn/)
  assert.match(block, /transaction\.delete\(reference\)/)
})

test('payroll can apply selected policies by trainer, effective date or staff profile', () => {
  const policies = [
    { id: 'policy-a', name: 'A', effectiveDate: '2026-08-01', configuration: payrollPolicyConfiguration({ ratePerSession: 20_000, dailySessionThreshold: 8, rateAfterDailyThreshold: 70_000, eveningStartHour: 20, rateAfterDailyThresholdEvening: 80_000 }) },
    { id: 'policy-b', name: 'B', effectiveDate: '2026-08-16', configuration: payrollPolicyConfiguration({ ratePerSession: 30_000, dailySessionThreshold: 8, rateAfterDailyThreshold: 90_000, eveningStartHour: 20, rateAfterDailyThresholdEvening: 100_000 }) },
  ]
  const teaching = {
    trainers: new Map([
      ['trainer-a', [{ key: 'a-1', date: '2026-08-10', hour: 6, studentCount: 1, sessionIds: [], attendanceEventIds: [] }]],
      ['trainer-b', [{ key: 'b-1', date: '2026-08-20', hour: 6, studentCount: 1, sessionIds: [], attendanceEventIds: [] }]],
    ]),
    attendanceEventCount: 2,
    teachingSlotCount: 2,
  }
  const trainerPlan = payrollRunPolicyPlan({
    policyIds: ['policy-a', 'policy-b'],
    defaultPolicyId: 'policy-a',
    policyApplicationMode: 'trainer_assignment',
    trainerPolicyAssignments: [{ trainerId: 'trainer-b', policyId: 'policy-b' }],
  })
  const trainerPriced = applyPayrollPolicyPlan(teaching, trainerPlan, policies)
  assert.equal(trainerPriced.trainers.get('trainer-a')[0].rate, 20_000)
  assert.equal(trainerPriced.trainers.get('trainer-b')[0].rate, 30_000)

  const datePlan = payrollRunPolicyPlan({ policyIds: ['policy-a', 'policy-b'], defaultPolicyId: 'policy-a', policyApplicationMode: 'effective_date' })
  const datePriced = applyPayrollPolicyPlan(teaching, datePlan, policies)
  assert.equal(datePriced.trainers.get('trainer-a')[0].policyId, 'policy-a')
  assert.equal(datePriced.trainers.get('trainer-b')[0].policyId, 'policy-b')

  const profilePolicies = [
    { ...policies[0], eligibleProfiles: ['official'] },
    { ...policies[1], effectiveDate: '2026-08-01', eligibleProfiles: ['senior'] },
  ]
  const profilePlan = {
    ...payrollRunPolicyPlan({ policyIds: ['policy-a', 'policy-b'], defaultPolicyId: 'policy-a', policyApplicationMode: 'staff_profile' }),
    staffProfiles: new Map([['trainer-a', 'official'], ['trainer-b', 'senior']]),
    staffPolicyAssignments: new Map([['trainer-b', 'policy-b']]),
  }
  const profilePriced = applyPayrollPolicyPlan(teaching, profilePlan, profilePolicies)
  assert.equal(profilePriced.trainers.get('trainer-a')[0].policyId, 'policy-a')
  assert.equal(profilePriced.trainers.get('trainer-b')[0].policyId, 'policy-b')
})

test('only a draft payroll run can be deleted and its items are removed atomically', () => {
  const source = fs.readFileSync(path.join(__dirname, 'payroll.js'), 'utf8')
  const start = source.indexOf('const deleteDraftPayrollRun = payrollCall')
  const end = source.indexOf('async function transition', start)
  const block = start >= 0 && end > start ? source.slice(start, end) : ''
  assert.match(block, /status !== 'draft'/)
  assert.match(block, /items\.docs\.forEach\(\(item\) => transaction\.delete\(item\.ref\)\)/)
  assert.match(block, /transaction\.delete\(runReference\)/)
  assert.match(block, /payroll\.draft\.deleted/)
})

test('payroll items snapshot trainer identity and attendance evidence source', () => {
  const source = fs.readFileSync(path.join(__dirname, 'payroll.js'), 'utf8')
  const createBlock = source.match(/const createPayrollRun[\s\S]*?\n  async function transition/)?.[0] || ''

  assert.match(createBlock, /trainerSnapshot:/)
  assert.match(createBlock, /evidenceSource: workdays\.workdayEnabled/)
  assert.match(createBlock, /policySnapshot: payrollPolicySnapshot\(defaultPolicy\)/)
  assert.match(createBlock, /policySnapshots/)
  assert.match(createBlock, /teachingSlots/)
  assert.match(createBlock, /teachingSlotCount/)
  assert.match(createBlock, /calculateReferralCommissions/)
  assert.match(createBlock, /ledgerEntries/)
  assert.match(createBlock, /referralCommission/)
  assert.doesNotMatch(createBlock, /teachingSlots\.length \* commissionPerSession/)
})

test('legacy draft payroll is enriched for review but cannot be approved before rebuilding', () => {
  const source = fs.readFileSync(path.join(__dirname, 'payroll.js'), 'utf8')
  const getStart = source.indexOf('const getPayrollRun = payrollCall')
  const getEnd = source.indexOf('const createPayrollRun = payrollHeavyCall', getStart)
  const getBlock = getStart >= 0 && getEnd > getStart ? source.slice(getStart, getEnd) : ''
  const transitionStart = source.indexOf('async function transition')
  const transitionEnd = source.indexOf('const reviewPayrollRun', transitionStart)
  const transitionBlock = transitionStart >= 0 && transitionEnd > transitionStart ? source.slice(transitionStart, transitionEnd) : ''

  assert.match(getBlock, /legacyPayrollPreview/)
  assert.match(getBlock, /payrollIdentityByTrainerId/)
  assert.match(getBlock, /requiresRebuild/)
  assert.match(getBlock, /storedTeachingSlotCount/)
  assert.match(transitionBlock, /schemaVersion/)
  assert.match(transitionBlock, /cần được xóa và lập lại/)
  assert.match(transitionBlock, /assertPayrollPeriodClosed/)
})

test('period reward and penalty entries are audited, snapshotted and cannot mutate an existing run', () => {
  const source = fs.readFileSync(path.join(__dirname, 'payroll.js'), 'utf8')
  const adjustmentStart = source.indexOf('const listPayrollAdjustments')
  const adjustmentEnd = source.indexOf('const listPayrollRuns', adjustmentStart)
  const adjustmentBlock = adjustmentStart >= 0 && adjustmentEnd > adjustmentStart ? source.slice(adjustmentStart, adjustmentEnd) : ''
  const createBlock = source.match(/const createPayrollRun[\s\S]*?\n  async function transition/)?.[0] || ''

  assert.match(adjustmentBlock, /payrollAdjustments/)
  assert.match(adjustmentBlock, /PAYROLL_DRAFT_REBUILD_REQUIRED/)
  assert.match(adjustmentBlock, /PAYROLL_RUN_IMMUTABLE/)
  assert.match(adjustmentBlock, /payroll\.adjustment\.created/)
  assert.match(adjustmentBlock, /payroll\.adjustment\.voided/)
  assert.match(createBlock, /adjustmentsByStaff/)
  assert.match(createBlock, /manualBonusAmount/)
  assert.match(createBlock, /manualDeductionAmount/)
  assert.match(createBlock, /payrollAdjustments: payrollAdjustments\.map/)
})

test('payroll UI surfaces trainer names, teaching-slot evidence and legacy rebuild state', () => {
  const ui = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'admin', 'pt', 'TrainerPayroll.tsx'), 'utf8')
  const service = fs.readFileSync(path.join(__dirname, '..', 'src', 'services', 'payrollService.ts'), 'utf8')

  assert.match(ui, /item\.trainerSnapshot\?\.name/)
  assert.match(ui, /item\.teachingSlots\.map/)
  assert.match(ui, /Dữ liệu cũ:/)
  assert.match(ui, /Preview chuẩn:/)
  assert.match(service, /sessionCount: teachingSlots\.length \|\|/)
})

test('payroll UI uses canonical runs and cannot edit teaching sessions', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'admin', 'pt', 'TrainerPayroll.tsx'), 'utf8')
  const styles = fs.readFileSync(path.join(__dirname, '..', 'src', 'styles-payroll-canonical.css'), 'utf8')

  assert.match(source, /getPayrollRun/)
  assert.match(source, /listPayrollPolicies/)
  assert.match(source, /Nguồn: ngày công \+ ca dạy đã điểm danh/)
  assert.match(source, /Đơn giá ca 1–8/)
  assert.match(source, /Từ ca thứ 9/)
  assert.match(source, /deleteDraftPayrollRun/)
  assert.match(source, /managePayrollPolicy/)
  assert.match(source, /Theo từng HLV/)
  assert.match(source, /Theo ngày hiệu lực/)
  assert.match(source, /Theo hồ sơ nhân viên/)
  assert.match(source, /Thưởng \/ phạt/)
  assert.match(source, /parsePayrollFailure/)
  assert.match(source, /Xem chi tiết trong popup/)
  assert.match(source, /payroll-correction-modal/)
  assert.doesNotMatch(source, /window\.location\.hash = `#\/admin-training-history/)
  assert.match(styles, /:not\(\.payroll-correction-modal\)/)
  assert.doesNotMatch(source, /commissionPerSession\s*\|\|\s*20000/)
  assert.doesNotMatch(source, /confirmSessionAttendance|cancelSession|rescheduleSession|swapSessions/)
  assert.doesNotMatch(source, /Ước tính đối soát PT/)
})
