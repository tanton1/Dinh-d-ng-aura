import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import type { PayrollRunItem, PayrollRunSummary } from '../src/services/payrollService'
import {
  createPayrollStatementPdf,
  payrollPdfFilename,
  payrollPdfFromRunItem,
  type PayrollPdfStatement,
} from '../src/utils/payrollPdf'

function statementFixture(): PayrollPdfStatement {
  return {
    reference: '2026-10/trainer-a',
    periodId: '2026-10',
    status: 'draft',
    official: false,
    generatedAt: '2026-11-04T08:30:00.000Z',
    employee: {
      id: 'trainer-a',
      name: 'Nguyễn Thị Ánh Đào',
      employeeCode: 'AURA-017',
      branchName: 'CS2 Hải Châu',
      profileLabel: 'Nhân viên chính thức',
      employmentType: 'full_time',
    },
    policyName: 'Chính sách lương PT tháng 10',
    amounts: {
      baseSalaryAmount: 8_000_000,
      teachingPayAmount: 2_520_000,
      commissionAmount: 480_000,
      bonusAmount: 300_000,
      adjustmentAmount: 100_000,
      deductionAmount: 50_000,
      grossAmount: 11_300_000,
      finalAmount: 11_350_000,
    },
    workdays: {
      paidDays: 26,
      estimatedPaidDays: 26,
      eligibleWorkdays: 26,
      autoPaidDays: 4,
      pendingDays: 0,
      unpaidDays: 0,
      benefitReviewDays: 0,
      rows: Array.from({ length: 31 }, (_, index) => ({
        date: `2026-10-${String(index + 1).padStart(2, '0')}`,
        status: index % 7 === 4 ? 'weekly_rest' : 'present',
        holidayName: '',
        note: index === 9 ? 'Admin đã đối soát ngày công' : '',
        teachingSlotCount: index % 3,
        source: index % 2 ? 'calendar' as const : 'teaching_slots' as const,
      })),
    },
    teaching: {
      attendanceEventCount: 76,
      slots: Array.from({ length: 72 }, (_, index) => ({
        key: `slot-${index}`,
        date: `2026-10-${String((index % 28) + 1).padStart(2, '0')}`,
        hour: 6 + (index % 15),
        branchName: index % 9 ? 'CS2 Hải Châu' : 'CS1 Thanh Khê',
        studentCount: index % 5 === 0 ? 2 : 1,
        dailyPosition: (index % 10) + 1,
        tier: index % 10 === 9 ? 'after_threshold_evening' as const : index % 10 === 8 ? 'after_threshold' as const : 'standard' as const,
        rate: index % 10 === 9 ? 80_000 : index % 10 === 8 ? 70_000 : 20_000,
        policyName: 'Chính sách lương PT tháng 10',
        crossBranchWarning: index % 9 === 0,
        studentNames: index % 5 === 0 ? ['Nguyễn Minh Anh', 'Trần Gia Hân'] : ['Nguyễn Minh Anh'],
      })),
    },
    referral: {
      rate: 5,
      contractCount: 2,
      cashCollectedAmount: 9_600_000,
      cashReversedAmount: 0,
      netCashAmount: 9_600_000,
      commissionAmount: 480_000,
    },
    adjustments: [{ id: 'bonus-a', type: 'bonus', amount: 100_000, reason: 'Hỗ trợ sự kiện', evidenceReference: 'BB-2026-10-01' }],
    warnings: ['1 ca có dữ liệu khác chi nhánh và cần kiểm tra.'],
  }
}

test('payroll PDF converter keeps the canonical employee totals and audit details', () => {
  const run = {
    id: '2026-10',
    periodId: '2026-10',
    status: 'draft',
    policyName: 'Chính sách Aura',
  } as PayrollRunSummary
  const item = {
    id: 'trainer-a',
    staffId: 'trainer-a',
    trainerId: 'trainer-a',
    employmentType: 'full_time',
    employmentLevel: 'probation',
    staffSnapshot: { name: 'Nguyễn Thị Ánh Đào', employeeCode: 'AURA-017', branchId: 'branch-2' },
    baseSalaryAmount: 8_000_000,
    teachingPayAmount: 2_000_000,
    commissionAmount: 480_000,
    bonusAmount: 300_000,
    adjustmentAmount: 100_000,
    deductionAmount: 50_000,
    grossAmount: 10_780_000,
    finalAmount: 10_830_000,
    attendanceEventCount: 2,
    sessionEvidencePendingAmount: 70_000,
    crossBranchWarningCount: 1,
    attendanceReviewRequired: true,
    calendarReviewRequired: false,
    teachingSlots: [{ key: 'slot-a', date: '2026-10-06', hour: 18, branchId: 'branch-2', branchIds: ['branch-2'], studentCount: 2, dailyPosition: 1, tier: 'standard', rate: 20_000, policyId: 'policy-a', policyName: 'Chính sách Aura', sessionIds: ['a', 'b'], studentIds: ['a', 'b'], attendanceEventIds: ['a', 'b'], crossBranchWarning: true }],
    workdaySummary: { paidDays: 20, estimatedPaidDays: 26, eligibleWorkdays: 26, autoPaidDays: 3, pendingDays: 1, unpaidDays: 0, benefitReviewDays: 0 },
    workdayDays: [{ date: '2026-10-06', weekday: 2, status: 'present', eligible: true, holidayName: '', note: '', revision: 1, teachingSlotCount: 1, source: 'teaching_slots' }],
    referralCommission: { rate: 5, contractCount: 1, cashCollectedAmount: 9_600_000, cashReversedAmount: 0, netCashAmount: 9_600_000, commissionAmount: 480_000, reversalAmount: 0 },
    payrollAdjustments: [{ id: 'bonus-a', type: 'bonus', amount: 100_000, reason: 'Hỗ trợ sự kiện', evidenceReference: 'BB-01' }],
  } as PayrollRunItem

  const statement = payrollPdfFromRunItem(run, item, {
    branchNameById: (id) => id === 'branch-2' ? 'CS2 Hải Châu' : id,
    studentNameById: (id) => id === 'a' ? 'Thanh Trần' : id === 'b' ? 'Hoàng Yến' : '',
    generatedAt: '2026-11-04T08:30:00.000Z',
  })

  assert.equal(statement.employee.name, 'Nguyễn Thị Ánh Đào')
  assert.equal(statement.employee.branchName, 'CS2 Hải Châu')
  assert.equal(statement.employee.profileLabel, 'Nhân viên thử việc · 85% lương cơ bản')
  assert.equal(statement.amounts.finalAmount, 10_830_000)
  assert.equal(statement.teaching.slots[0].studentCount, 2)
  assert.deepEqual(statement.teaching.slots[0].studentNames, ['Thanh Trần', 'Hoàng Yến'])
  assert.equal(statement.workdays.rows[0].source, 'teaching_slots')
  assert.equal(statement.adjustments[0].evidenceReference, 'BB-01')
  assert.ok(statement.warnings.some((warning) => warning.includes('Ngày công')))
  assert.ok(statement.warnings.some((warning) => warning.includes('bằng chứng ca dạy')))
})

test('payroll PDF filename is safe and readable without Vietnamese accents', () => {
  assert.equal(payrollPdfFilename(statementFixture()), 'Phieu_luong_2026-10_Nguyen_Thi_Anh_Dao.pdf')
})

test('payroll PDF renders a multi-page A4 statement with embedded Vietnamese fonts', async () => {
  const [regular, medium] = await Promise.all([
    readFile(path.resolve('public/fonts/Roboto-Regular.ttf'), 'base64'),
    readFile(path.resolve('public/fonts/Roboto-Medium.ttf'), 'base64'),
  ])
  const { doc, filename } = await createPayrollStatementPdf(statementFixture(), { fonts: { regular, medium } })
  const bytes = Buffer.from(doc.output('arraybuffer'))

  assert.equal(filename, 'Phieu_luong_2026-10_Nguyen_Thi_Anh_Dao.pdf')
  assert.equal(bytes.subarray(0, 4).toString('ascii'), '%PDF')
  assert.ok(bytes.length > 30_000, `PDF is unexpectedly small: ${bytes.length} bytes`)
  assert.ok(doc.getNumberOfPages() >= 3)
})
