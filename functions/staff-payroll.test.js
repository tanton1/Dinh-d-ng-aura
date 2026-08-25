const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const {
  calculateWorkdayPayroll,
  mergeWorkCalendar,
  monthDateKeys,
  payrollAmounts,
} = require('./staff-payroll')

test('August 2026 has 26 standard Aura workdays when Sunday is the weekly rest day', () => {
  const calendar = mergeWorkCalendar('2026-08')
  const result = calculateWorkdayPayroll({
    periodId: '2026-08',
    calendar,
    attendance: [],
    staff: { baseSalary: 12_000_000 },
    today: '2026-07-31',
  })
  assert.equal(monthDateKeys('2026-08').length, 31)
  assert.equal(result.standardWorkdays, 26)
  assert.equal(result.eligibleWorkdays, 26)
  assert.equal(result.pendingDays, 0)
  assert.equal(result.baseSalaryEarned, 12_000_000)
  assert.equal(result.calendarReviewRequired, true)
})

test('paid holidays are excluded and unpaid absences reduce base salary by the canonical daily rate', () => {
  const calendar = mergeWorkCalendar('2026-08', {
    periodId: '2026-08',
    branchId: 'global',
    weeklyRestDays: [0],
    holidays: [{ date: '2026-08-10', name: 'Ngày nghỉ hưởng lương', paid: true }],
    status: 'approved',
    revision: 1,
  })
  const attendance = monthDateKeys('2026-08').map((date) => ({ date, status: 'present', revision: 1 }))
  attendance.find((item) => item.date === '2026-08-11').status = 'unpaid_leave'
  attendance.find((item) => item.date === '2026-08-12').status = 'unexcused_absence'
  attendance.find((item) => item.date === '2026-08-13').status = 'paid_leave'
  const result = calculateWorkdayPayroll({
    periodId: '2026-08',
    calendar,
    attendance,
    staff: { baseSalary: 12_000_000 },
    today: '2026-08-31',
  })
  assert.equal(result.standardWorkdays, 25)
  assert.equal(result.unpaidDays, 2)
  assert.equal(result.reviewRequired, false)
  assert.equal(result.baseSalaryEarned, Math.round(12_000_000 / 25 * 23))
  assert.equal(result.days.find((item) => item.date === '2026-08-10').status, 'paid_holiday')
  assert.equal(result.days.find((item) => item.date === '2026-08-13').status, 'paid_leave')
})

test('missing past attendance and benefit leave block review but future workdays remain upcoming', () => {
  const calendar = mergeWorkCalendar('2026-08', {
    periodId: '2026-08', weeklyRestDays: [0], holidays: [], status: 'approved', revision: 1,
  })
  const result = calculateWorkdayPayroll({
    periodId: '2026-08',
    calendar,
    attendance: [{ date: '2026-08-03', status: 'sick_leave', revision: 1 }],
    staff: { baseSalary: 10_000_000 },
    today: '2026-08-05',
  })
  assert.equal(result.benefitReviewDays, 1)
  assert.ok(result.pendingDays > 0)
  assert.equal(result.attendanceReviewRequired, true)
  assert.equal(result.days.find((item) => item.date === '2026-08-06').status, 'upcoming')
})

test('employment starting mid-month prorates salary against full-month standard days', () => {
  const calendar = mergeWorkCalendar('2026-08', {
    periodId: '2026-08', weeklyRestDays: [0], holidays: [], status: 'approved', revision: 1,
  })
  const attendance = monthDateKeys('2026-08').map((date) => ({ date, status: 'present', revision: 1 }))
  const result = calculateWorkdayPayroll({
    periodId: '2026-08',
    calendar,
    attendance,
    staff: { baseSalary: 13_000_000, employmentStartDate: '2026-08-17' },
    today: '2026-08-31',
  })
  assert.equal(result.standardWorkdays, 26)
  assert.ok(result.eligibleWorkdays < result.standardWorkdays)
  assert.equal(result.baseSalaryEarned, Math.round(13_000_000 / 26 * result.eligibleWorkdays))
})

test('base salary, teaching pay, bonus and deductions remain separate in payroll totals', () => {
  const amounts = payrollAmounts({ baseSalaryEarned: 11_000_000, fixedBonus: 500_000 }, {
    grossAmount: 3_000_000,
    commissionAmount: 600_000,
    adjustmentAmount: 100_000,
    deductionAmount: 200_000,
  })
  assert.deepEqual(amounts, {
    baseSalaryAmount: 11_000_000,
    teachingPayAmount: 3_000_000,
    commissionAmount: 600_000,
    bonusAmount: 500_000,
    adjustmentAmount: 100_000,
    deductionAmount: 200_000,
    grossAmount: 15_100_000,
    finalAmount: 15_000_000,
  })
})

test('staff payroll callables are actor-scoped and browser writes never calculate salary', () => {
  const source = fs.readFileSync(path.join(__dirname, 'staff-payroll.js'), 'utf8')
  assert.match(source, /trustedAccessContext/)
  assert.match(source, /requireSelfPayroll/)
  assert.match(source, /payroll\.self\.view/)
  assert.match(source, /payroll\.operations\.manage/)
  assert.match(source, /staffAttendanceDays/)
  assert.match(source, /payrollRunItems/)
  assert.match(source, /reviewRequired/)
  assert.match(source, /collection\('roleAssignments'\)\.where\('accessRole', '==', 'staff'\)/)
  assert.match(source, /fillMissingStaffAttendanceDays/)
  assert.match(source, /if \(current\[index\]\.exists\) return/)
  assert.doesNotMatch(source, /allow read|allow write/)
})

test('payroll run includes every active Identity v2 staff account and explicit per-session commission', () => {
  const source = fs.readFileSync(path.join(__dirname, 'payroll.js'), 'utf8')
  assert.match(source, /collection\('roleAssignments'\)\.where\('accessRole', '==', 'staff'\)/)
  assert.match(source, /assignment\.crmProfileId/)
  assert.match(source, /commissionPerSession/)
  assert.match(source, /commissionAmount/)
})
