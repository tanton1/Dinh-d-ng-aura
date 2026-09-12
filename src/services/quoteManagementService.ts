import { httpsCallable } from 'firebase/functions'
import { firebaseFunctions } from '../lib/firebaseFunctions'
import { createClientCorrelationId } from './clientTelemetryService'
import { callReadOnlyFunction } from './readOnlyCallableService'

export type SalesQuoteStatus = 'pending' | 'accepted' | 'archived'

export interface SalesQuote {
  id: string
  source: 'canonical' | 'legacy'
  code: string
  customerName: string
  customerPhone: string
  normalizedPhone?: string
  branchId: string
  packageId: string
  packageName: string
  originalPrice: number
  discount: number
  finalPrice: number
  status: SalesQuoteStatus
  revision: number
  memberReferralCode: string | null
  assignedSalesId: string | null
  leadId: string | null
  approvalId: string | null
  approvalStatus: string | null
  createdAt: string | null
  updatedAt: string | null
  validUntil: string | null
}

export interface SalesQuoteCatalog {
  branches: Array<{ id: string; name: string; status: string }>
  packages: Array<{ id: string; name: string; price: number; branchId: string | null; status: string }>
}

export interface SalesQuotePage {
  schemaVersion: 1
  quotes: SalesQuote[]
  legacyQuotes: SalesQuote[]
  nextCursor: string | null
  catalog: SalesQuoteCatalog
  scan: { scanned: number; capped: boolean }
}

export interface CreateSalesQuoteInput {
  customerName: string
  customerPhone: string
  branchId: string
  packageId: string
  discount?: number
  memberReferralCode?: string
  idempotencyKey: string
}

export interface ArchiveSalesQuoteInput {
  quoteId: string
  expectedRevision: number
  idempotencyKey: string
}

export interface AcceptSalesQuoteInput {
  quoteId: string
  expectedRevision: number
  idempotencyKey: string
  studentId?: string
  leadId?: string
}

export interface QuoteCommandResult {
  schemaVersion: 1
  quote?: SalesQuote
  quoteId?: string
  status?: SalesQuoteStatus
  revision?: number
  leadId?: string
  approvalId?: string
  approvalStatus?: string | null
  unchanged: boolean
}

function functionsOrThrow() {
  if (!firebaseFunctions) throw new Error('Firebase Functions chưa sẵn sàng.')
  return firebaseFunctions
}

export function createQuoteCommandKey() {
  return `quote-${createClientCorrelationId()}`
}

export function listSalesQuotes(input: { branchId?: string; status?: SalesQuoteStatus | 'all'; cursor?: string; pageSize?: number; includeLegacy?: boolean } = {}) {
  return callReadOnlyFunction<typeof input, SalesQuotePage>('listSalesQuotes', input, { timeoutMs: 20_000, maximumAttempts: 2 })
}

async function callQuoteCommand<Input extends object>(name: string, input: Input) {
  const callable = httpsCallable<Input & { correlationId: string }, QuoteCommandResult>(functionsOrThrow(), name, { timeout: 30_000 })
  return (await callable({ ...input, correlationId: createClientCorrelationId() })).data
}

export function createSalesQuote(input: CreateSalesQuoteInput) {
  return callQuoteCommand('createSalesQuote', input)
}

export function archiveSalesQuote(input: ArchiveSalesQuoteInput) {
  return callQuoteCommand('archiveSalesQuote', input)
}

export function acceptSalesQuote(input: AcceptSalesQuoteInput) {
  return callQuoteCommand('acceptSalesQuote', input)
}
