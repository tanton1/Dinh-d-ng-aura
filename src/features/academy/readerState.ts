export interface AcademyReaderState {
  version: 1
  page: number
  bookmarks: number[]
}

export const emptyReaderState = (): AcademyReaderState => ({ version: 1, page: 1, bookmarks: [] })

export function readerStorageKey(ownerId: string, courseId: string, lessonId: string, resourceId: string) {
  // Never persist signed media URLs or share reading state between accounts.
  return `aura:academy:pdf:v1:${[ownerId, courseId, lessonId, resourceId].map(encodeURIComponent).join(':')}`
}

export function normalizeReaderState(raw: unknown, pageCount = 5000): AcademyReaderState {
  const max = Number.isInteger(pageCount) && pageCount > 0 ? pageCount : 1
  if (!raw || typeof raw !== 'object' || (raw as { version?: unknown }).version !== 1) return emptyReaderState()
  const value = raw as Partial<AcademyReaderState>
  return {
    version: 1,
    page: Number.isInteger(value.page) ? Math.max(1, Math.min(max, Number(value.page))) : 1,
    bookmarks: [...new Set(Array.isArray(value.bookmarks) ? value.bookmarks.filter((page) => Number.isInteger(page) && page > 0 && page <= max) : [])].slice(0, 50).sort((a, b) => a - b),
  }
}

export function loadReaderState(key: string): AcademyReaderState {
  try { return normalizeReaderState(JSON.parse(localStorage.getItem(key) ?? 'null')) } catch { return emptyReaderState() }
}

export function saveReaderState(key: string, state: AcademyReaderState) {
  try { localStorage.setItem(key, JSON.stringify(state)); return true } catch { return false }
}

export type PdfOutlineItem = { title: string; dest: string | unknown[] | null; items?: PdfOutlineItem[] }
export function flattenPdfOutline(items: PdfOutlineItem[], maximum = 100) {
  const result: Array<{ title: string; dest: PdfOutlineItem['dest']; depth: number }> = []
  const visit = (nodes: PdfOutlineItem[], depth: number) => {
    for (const item of nodes) {
      if (result.length >= maximum) return
      if (item.dest) result.push({ title: item.title.trim() || 'Mục không tên', dest: item.dest, depth })
      if (depth < 6 && item.items?.length) visit(item.items, depth + 1)
    }
  }
  visit(items, 0)
  return result
}
