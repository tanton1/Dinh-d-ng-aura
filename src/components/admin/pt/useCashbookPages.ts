import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CashbookPageMetadata, CashTransaction, ExpenseVoucher, ReceiptVoucher } from '../../../services/cashbookService'

type Page = CashbookPageMetadata & (
  | { kind: 'cash'; transactions: CashTransaction[] }
  | { kind: 'receipts'; vouchers: ReceiptVoucher[] }
  | { kind: 'vouchers'; vouchers: ExpenseVoucher[] }
)
type Reader = (cursor?: string) => Promise<Page>
type Identity = { key: string | null }
type Run = { identity: Identity; active: boolean; busy: boolean; read: Reader; data: Page | null; cursors: Set<string>; refreshRequired: boolean }
type Result = { identity: Identity; data: Page | null; error: unknown; appending: boolean; refreshRequired: boolean }

const invalidPage = () => Object.assign(new Error('Trang sổ quỹ không còn đồng nhất. Hãy tải lại để xem số liệu mới.'), { details: { reason: 'cashbook-page-invalid' } })
function validate(page: Page, run: Run) {
  if (page.paginationVersion !== 1 || typeof page.hasMore !== 'boolean' || typeof page.scanLimited !== 'boolean'
    || typeof page.asOf !== 'string' || !Number.isFinite(Date.parse(page.asOf))
    || (page.hasMore ? typeof page.nextCursor !== 'string' || !page.nextCursor : page.nextCursor !== null)
    || (run.data && (page.kind !== run.data.kind || page.asOf !== run.data.asOf))
    || (page.nextCursor && run.cursors.has(page.nextCursor))) throw invalidPage()
  const rows = page.kind === 'cash' ? page.transactions : page.vouchers
  if (!Array.isArray(rows) || rows.some(row => !row || typeof row.id !== 'string' || !row.id)) throw invalidPage()
}

function unique<T extends { id: string }>(previous: T[], next: T[]) {
  return [...new Map([...previous, ...next].map(row => [row.id, row])).values()]
}
function merge(previous: Page | null, page: Page): Page {
  if (page.kind === 'cash') return { ...page, transactions: unique(previous?.kind === 'cash' ? previous.transactions : [], page.transactions) }
  if (page.kind === 'vouchers') return { ...page, vouchers: unique(previous?.kind === 'vouchers' ? previous.vouchers : [], page.vouchers) }
  const receipts = new Map<string, ReceiptVoucher>()
  for (const row of [...(previous?.kind === 'receipts' ? previous.vouchers : []), ...page.vouchers]) {
    const key = row.listIdentity || `${row.documentType}:${row.ledgerEntryId || row.id}`
    // A retried page cannot replace an original receipt with its derived view.
    if (!receipts.has(key) || !row.derived || receipts.get(key)?.derived) receipts.set(key, row)
  }
  return { ...page, vouchers: [...receipts.values()] }
}

// Pages belong to one visit, owner/authority (parent session), filter and read
// time. Switching A -> B -> A never reuses an older request or its error.
export default function useCashbookPages(key: string | null, read: Reader) {
  const identity = useMemo(() => ({ key }), [key])
  const currentIdentity = useRef(identity)
  currentIdentity.current = identity
  const reader = useRef(read)
  reader.current = read
  const runRef = useRef<Run | null>(null)
  const [result, setResult] = useState<Result | null>(null)
  const fetchPage = useCallback(async (run: Run, cursor?: string) => {
    const current = () => run.active && currentIdentity.current === run.identity
    if (!current() || run.busy || run.refreshRequired) return
    run.busy = true
    if (run.data) setResult({ identity: run.identity, data: run.data, error: null, appending: true, refreshRequired: false })
    try {
      const page = await run.read(cursor)
      if (!current()) return
      validate(page, run)
      run.data = merge(run.data, page)
      if (page.nextCursor) run.cursors.add(page.nextCursor)
      setResult({ identity: run.identity, data: run.data, error: null, appending: false, refreshRequired: false })
    } catch (error) {
      if (!current()) return
      const reason = (error as { details?: { reason?: string } })?.details?.reason
      run.refreshRequired = ['cashbook-cursor-expired', 'cashbook-cursor-invalid', 'cashbook-page-invalid'].includes(reason || '')
      setResult({ identity: run.identity, data: run.data, error, appending: false, refreshRequired: run.refreshRequired })
    } finally { run.busy = false }
  }, [])
  useEffect(() => {
    if (identity.key === null) { runRef.current = null; setResult(null); return }
    const run: Run = { identity, active: true, busy: false, read: reader.current, data: null, cursors: new Set(), refreshRequired: false }
    runRef.current = run
    // StrictMode cleanup can cancel the first read before it leaves the UI.
    void Promise.resolve().then(() => fetchPage(run))
    return () => { run.active = false }
  }, [identity, fetchPage])
  const loadMore = useCallback(() => {
    const run = runRef.current
    if (run?.identity === identity && run.data?.hasMore && run.data.nextCursor) void fetchPage(run, run.data.nextCursor)
  }, [identity, fetchPage])
  const current = key !== null && result?.identity === identity ? result : null
  return { data: current?.data ?? null, error: current?.error ?? null, loading: key !== null && !current,
    appending: current?.appending ?? false, refreshRequired: current?.refreshRequired ?? false, loadMore }
}
