import type { FinanceLedgerPage, FinanceLedgerSummary } from '../services/financeLedgerService'

function finiteAmount(value: unknown, fallback = 0) {
  const amount = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(amount) ? amount : fallback
}

/**
 * Callable revisions can overlap briefly during a production rollout and an
 * installed PWA may keep an older response contract in memory. Keep the
 * accounting meaning stable while normalising both schemas at this boundary.
 */
export function normalizeFinanceLedgerSummary(value: unknown): FinanceLedgerSummary {
  const raw = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const collectedAmount = finiteAmount(raw.collectedAmount)
  const refundedAmount = finiteAmount(raw.refundedAmount)
  const reversedAmount = finiteAmount(raw.reversedAmount)
  const adjustmentAmount = finiteAmount(raw.adjustmentAmount)
  const cashIn = finiteAmount(raw.cashIn, collectedAmount)
  const cashOut = finiteAmount(raw.cashOut, refundedAmount + reversedAmount)
  const cashNet = finiteAmount(raw.cashNet, cashIn - cashOut)
  const recognisedRevenue = finiteAmount(raw.recognisedRevenue)
  const operatingExpense = finiteAmount(raw.operatingExpense)
  const operatingResult = finiteAmount(raw.operatingResult, recognisedRevenue - operatingExpense)
  const dailySeries = Array.isArray(raw.dailySeries)
    ? raw.dailySeries.flatMap((item) => {
      if (!item || typeof item !== 'object') return []
      const point = item as Record<string, unknown>
      const date = typeof point.date === 'string' ? point.date : ''
      return date ? [{ date, total: finiteAmount(point.total) }] : []
    })
    : []

  return {
    collectedAmount,
    refundedAmount,
    reversedAmount,
    adjustmentAmount,
    cashIn,
    cashOut,
    cashNet,
    recognisedRevenue,
    operatingExpense,
    operatingResult,
    netRevenue: cashNet,
    transactionCount: Math.max(0, Math.trunc(finiteAmount(raw.transactionCount))),
    dailySeries,
  }
}

export function normalizeFinanceLedgerPage(value: unknown): FinanceLedgerPage {
  const raw = value && typeof value === 'object' ? value as Partial<FinanceLedgerPage> : {}
  return {
    entries: Array.isArray(raw.entries) ? raw.entries : [],
    summary: normalizeFinanceLedgerSummary(raw.summary),
    hasMore: raw.hasMore === true,
    nextCursor: typeof raw.nextCursor === 'string' && raw.nextCursor ? raw.nextCursor : null,
    canonicalOnly: true,
    source: 'ledgerEntries',
  }
}
