import { test } from 'node:test'
import assert from 'node:assert/strict'
import { businessReportCompleteness } from '../src/utils/businessReportCompleteness'
import type { BusinessPerformanceReport } from '../src/services/businessReportingService'

const report = (flags: Partial<BusinessPerformanceReport['dataQuality']> = {}) => ({ dataQuality: { ledgerTruncated: false, attendanceTruncated: false, ...flags } }) as BusinessPerformanceReport
test('ledger overflow invalidates money totals, trends and recognition comparison, without hiding independent source counts', () => {
  const state = businessReportCompleteness(report({ ledgerTruncated: true }))
  assert.equal(state.ledger, false)
  assert.equal(state.recognitionReconciliation, false)
  assert.equal(state.attendance, true)
  assert.equal(state.cashReconciliation, true)
})
test('cash, payroll and attendance caps only invalidate their dependent reconciliation metrics', () => {
  const state = businessReportCompleteness(report({ cashTransactionsTruncated: true, payrollLimitReached: true, attendanceTruncated: true, cashAccountsTruncated: true }))
  assert.equal(state.ledger, true)
  assert.equal(state.cashReconciliation, false)
  assert.equal(state.payrollReconciliation, false)
  assert.equal(state.attendance, false)
  assert.equal(state.recognitionReconciliation, false)
  assert.equal(state.cashAccounts, false)
})
test('an unloaded report is unknown rather than a complete zero-valued report', () => {
  assert.ok(Object.values(businessReportCompleteness(null)).every(value => value === false))
  assert.ok(Object.values(businessReportCompleteness(report())).every(value => value === true))
})
