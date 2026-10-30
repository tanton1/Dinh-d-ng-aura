import type { ReceivablesPage, ReceivablesQuery } from './scopedReportingService'

const MAX_PAGES_PER_ACTION = 3
const MATCHES_PER_ACTION = 20

// A source page can contain no matching contracts. Fill one visible page with
// a small, fixed read budget; the user explicitly continues any remaining scan.
export async function readReceivablesWindow(
  query: ReceivablesQuery,
  read: (query: ReceivablesQuery) => Promise<ReceivablesPage>,
  isCurrent: () => boolean,
): Promise<(ReceivablesPage & { scanLimited: boolean }) | null> {
  const contracts = new Map<string, ReceivablesPage['contracts'][number]>()
  const students = new Map<string, ReceivablesPage['students'][number]>()
  const seenCursors = new Set<string>()
  let cursor = query.cursor ?? null
  if (cursor) seenCursors.add(cursor)
  let summary: ReceivablesPage['summary'] = null
  let scanned = 0
  let last: ReceivablesPage | null = null
  for (let pageIndex = 0; pageIndex < MAX_PAGES_PER_ACTION && isCurrent(); pageIndex++) {
    const page = await read({ ...query, cursor, pageSize: MATCHES_PER_ACTION - contracts.size,
      includeSummary: pageIndex === 0 && query.includeSummary !== false,
      refresh: pageIndex === 0 && query.refresh === true })
    if (!isCurrent()) return null
    if (page.hasMore && (!page.nextCursor || seenCursors.has(page.nextCursor))) {
      throw new Error('Chưa thể tải trang tiếp theo. Hãy làm mới danh sách.')
    }
    page.contracts.forEach(contract => contracts.set(contract.id, contract))
    page.students.forEach(student => students.set(student.id, student))
    summary ||= page.summary
    scanned += page.scanned
    last = page
    if (!page.hasMore || contracts.size >= MATCHES_PER_ACTION) break
    cursor = page.nextCursor
    seenCursors.add(cursor!)
  }
  if (!last || !isCurrent()) return null
  return { ...last, contracts: [...contracts.values()], students: [...students.values()], summary, scanned,
    scanLimited: last.hasMore && contracts.size < MATCHES_PER_ACTION }
}
