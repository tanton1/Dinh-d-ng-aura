import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  buildStaffDashboardPayrollChart,
  type StaffDashboardPayrollSnapshot,
} from '../src/utils/staffDashboardPayroll'

function snapshot(): StaffDashboardPayrollSnapshot {
  return {
    periodId: '2026-08',
    amounts: { baseSalaryAmount: 9_600_000, teachingPayAmount: 1_500_000 },
    workdays: {
      days: [
        { date: '2026-08-03', weekday: 1, status: 'present', eligible: true, holidayName: '', note: '', revision: 1, teachingSlotCount: 1, source: 'admin_override' },
        { date: '2026-08-04', weekday: 2, status: 'unpaid_leave', eligible: true, holidayName: '', note: '', revision: 1, teachingSlotCount: 0, source: 'admin_override' },
        { date: '2026-08-10', weekday: 1, status: 'pending', eligible: true, holidayName: '', note: '', revision: 0, teachingSlotCount: 2, source: 'calendar' },
        { date: '2026-08-17', weekday: 1, status: 'upcoming', eligible: true, holidayName: '', note: '', revision: 0, teachingSlotCount: 0, source: 'calendar' },
      ],
    },
    teachingSlots: [
      { key: 'a', date: '2026-08-03', hour: 7, branchId: '', dailyPosition: 1, tier: 'standard', rate: 300_000, policyId: 'p', policyName: 'PT', studentCount: 2, sessionIds: ['a1', 'a2'] },
      { key: 'b', date: '2026-08-10', hour: 8, branchId: '', dailyPosition: 1, tier: 'standard', rate: 600_000, policyId: 'p', policyName: 'PT', studentCount: 1, sessionIds: ['b1'] },
      { key: 'c', date: '2026-08-11', hour: 9, branchId: '', dailyPosition: 2, tier: 'standard', rate: 600_000, policyId: 'p', policyName: 'PT', studentCount: 1, sessionIds: ['c1'] },
    ],
    run: { official: false },
  }
}

test('dashboard payroll chart retains canonical monthly totals', () => {
  const chart = buildStaffDashboardPayrollChart(snapshot())
  assert.equal(chart.buckets.length, 5)
  assert.deepEqual(chart.buckets.map((bucket) => bucket.label), ['01–07', '08–14', '15–21', '22–28', '29–31'])
  assert.equal(chart.buckets.reduce((sum, bucket) => sum + bucket.baseSalaryAmount, 0), 9_600_000)
  assert.equal(chart.buckets.reduce((sum, bucket) => sum + bucket.teachingPayAmount, 0), 1_500_000)
  assert.equal(chart.buckets.reduce((sum, bucket) => sum + bucket.teachingSlotCount, 0), 3)
})

test('unpaid days are excluded while pending and upcoming eligible days remain in salary projection', () => {
  const chart = buildStaffDashboardPayrollChart(snapshot())
  assert.equal(chart.buckets[0].baseSalaryAmount, 3_200_000)
  assert.equal(chart.buckets[1].baseSalaryAmount, 3_200_000)
  assert.equal(chart.buckets[2].baseSalaryAmount, 3_200_000)
  assert.equal(chart.buckets[0].teachingPayAmount, 300_000)
  assert.equal(chart.buckets[1].teachingPayAmount, 1_200_000)
})

test('legacy teaching totals are still visible when slot rates are missing', () => {
  const input = snapshot()
  input.teachingSlots = input.teachingSlots.map((slot) => ({ ...slot, rate: 0 }))
  const chart = buildStaffDashboardPayrollChart(input)
  assert.equal(chart.buckets.reduce((sum, bucket) => sum + bucket.teachingPayAmount, 0), 1_500_000)
  assert.equal(chart.buckets[0].teachingPayAmount, 500_000)
  assert.equal(chart.buckets[1].teachingPayAmount, 1_000_000)
})
