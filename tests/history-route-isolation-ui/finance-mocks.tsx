import type { ReactNode } from 'react'
import { calls } from './mocks'

export const firebaseBusinessReportingFunctions = { region: 'business-reporting' }

// Keep the production reporting adapter so this fixture observes its page bound
// and regional transport selection, instead of reimplementing those guarantees.
export async function callReadOnlyFunction(name: string, input: Record<string, unknown>, options: { functionsClient: { region: string } }) {
  calls.reporting.push({ name, input, region: options.functionsClient.region })
  if (name !== 'listFinanceReceivables') throw new Error(`Unexpected reporting call: ${name}`)
  const id = input.cursor ? 'next' : 'first'
  const asOf = new Date().toISOString()
  return {
    contracts: [{ id, studentId: id, packageName: 'Gói PT', totalPrice: 500000, discount: 0, paidAmount: 100000, status: 'active' }],
    students: [{ id, name: `Finance learner ${id}`, phone: '' }],
    summary: input.includeSummary ? { complete: true, totals: { debt: 800000, overdue: 0, thisMonth: 0 }, counts: { all: 2, overdue: 0, 'this-week': 0, 'this-month': 0, overpaid: 0 }, asOf, sourceDocuments: 2 } : null,
    nextCursor: input.cursor ? null : 'next-page', hasMore: !input.cursor, asOf, scanned: 1,
  }
}

export async function listFinanceLedger(input: Record<string, unknown>) {
  calls.ledger.push(input)
  return { entries: [], nextCursor: null, hasMore: false, summary: null }
}

export async function listCashAccounts() { calls.cashAccounts++; return { accounts: [] } }
export const FinancePendingOperations = () => null
export default function FinanceIntentBoundary({ children }: { children?: (controls: unknown) => ReactNode }) {
  return children?.({ blocked: false, busy: false, submit: async () => { throw new Error('Unexpected finance write') } })
}
