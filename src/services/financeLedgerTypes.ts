export type FinanceLedgerType = 'payment' | 'refund' | 'adjustment' | 'reversal' | 'revenue_recognition' | 'expense' | 'payroll'

export type FinanceLedgerStatus = 'pending' | 'posted' | 'reversed'

export interface FinanceLedgerEntry {
  id: string
  type: FinanceLedgerType
  eventClass: string
  source: string
  contractId: string
  studentId: string
  branchId: string
  installmentId: string
  amount: number
  cashImpact: number | null
  revenueImpact: number | null
  expenseImpact: number | null
  receivableImpact: number | null
  deferredRevenueImpact: number | null
  effectiveAt: string
  paymentMethod: string
  referenceCode: string
  status: FinanceLedgerStatus
  reversedEntryId: string
  note: string
  reason: string
}

export interface FinanceLedgerSummary {
  collectedAmount: number
  refundedAmount: number
  reversedAmount: number
  adjustmentAmount: number
  cashIn: number
  cashOut: number
  cashNet: number
  recognisedRevenue: number
  operatingExpense: number
  operatingResult: number
  /** Compatibility alias returned for older clients. Prefer cashNet. */
  netRevenue: number
  transactionCount: number
  dailySeries: Array<{ date: string; total: number }>
}

export interface FinanceLedgerQuery {
  pageSize?: number
  cursor?: string | null
  startAt?: string
  endAt?: string
  branchId?: string
  types?: FinanceLedgerType[]
  status?: FinanceLedgerStatus | 'all'
  /** Skip the all-period scan when only the entry table is consumed. */
  includeSummary?: boolean
}

export interface FinanceLedgerPage {
  entries: FinanceLedgerEntry[]
  summary: FinanceLedgerSummary | null
  hasMore: boolean
  nextCursor: string | null
  canonicalOnly: true
  source: 'ledgerEntries'
}
