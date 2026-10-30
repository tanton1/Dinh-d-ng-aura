import type { BusinessPerformanceReport } from '../services/businessReportingService'

/** Each reconciliation source only invalidates the numbers that depend on it. */
export function businessReportCompleteness(report: BusinessPerformanceReport | null) {
  const quality = report?.dataQuality
  const ledger = Boolean(report && !quality?.ledgerTruncated)
  return {
    ledger,
    cashReconciliation: Boolean(report && !quality?.cashTransactionsTruncated),
    payrollReconciliation: Boolean(report && !quality?.payrollLimitReached),
    attendance: Boolean(report && !quality?.attendanceTruncated),
    recognitionReconciliation: ledger && !quality?.attendanceTruncated,
    cashAccounts: Boolean(report && !quality?.cashAccountsTruncated),
  }
}
