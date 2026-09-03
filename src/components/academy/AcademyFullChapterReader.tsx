import { useDeferredValue, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import {
  AlertCircle,
  BookOpen,
  Bookmark,
  CheckCircle2,
  FileText,
  LoaderCircle,
  Minus,
  Plus,
  Search,
  Volume2,
  VolumeX,
} from 'lucide-react'

type FullReaderBlock = {
  kind: 'heading' | 'paragraph' | 'bullet'
  text: string
}

type FullReaderPage = {
  number: number
  blocks: FullReaderBlock[]
}

type FullChapter = {
  schemaVersion: 1
  chapter: number
  title: string
  pageCount: number
  wordCount: number
  sourceFile: string
  sourceSha256: string
  pages: FullReaderPage[]
}

const chapterCache = new Map<number, FullChapter>()

function fullChapterUrl(chapter: number) {
  return `/academy/full-reader/chapter-${String(chapter).padStart(2, '0')}.json`
}

function validateFullChapter(value: unknown, chapter: number): FullChapter {
  if (!value || typeof value !== 'object') throw new Error('Tệp bài đọc không hợp lệ.')
  const candidate = value as Partial<FullChapter>
  if (candidate.schemaVersion !== 1 || candidate.chapter !== chapter || !Array.isArray(candidate.pages)) {
    throw new Error('Phiên bản bài đọc không khớp chương đang mở.')
  }
  if (!candidate.pages.length || candidate.pages.length !== candidate.pageCount) {
    throw new Error('Bài đọc chưa đủ số trang của giáo trình.')
  }
  return candidate as FullChapter
}

async function loadFullChapter(chapter: number, signal: AbortSignal) {
  const cached = chapterCache.get(chapter)
  if (cached) return cached
  const response = await fetch(fullChapterUrl(chapter), { signal, cache: 'force-cache' })
  if (!response.ok) throw new Error(`Không thể tải bài đọc đầy đủ (HTTP ${response.status}).`)
  const result = validateFullChapter(await response.json(), chapter)
  chapterCache.set(chapter, result)
  return result
}

function normalizeSearch(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

function readingStorageKey(ownerId: string, chapter: number) {
  return `aura:academy:full-reader:v1:${ownerId || 'guest'}:${chapter}`
}

function readSavedPage(ownerId: string, chapter: number) {
  try {
    const value = Number(localStorage.getItem(readingStorageKey(ownerId, chapter)))
    return Number.isInteger(value) && value > 0 ? value : 1
  } catch {
    return 1
  }
}

function pageHeading(page: FullReaderPage) {
  return page.blocks.find((block) => block.kind === 'heading')?.text ?? `Trang ${page.number}`
}

function searchSnippet(page: FullReaderPage, query: string) {
  const match = page.blocks.find((block) => normalizeSearch(block.text).includes(query))
  if (!match) return ''
  const text = match.text.trim()
  return text.length > 180 ? `${text.slice(0, 177)}…` : text
}

export default function AcademyFullChapterReader({
  chapter,
  ownerId,
  onOpenPdf,
}: {
  chapter: number
  ownerId: string
  onOpenPdf: () => void
}) {
  const [content, setContent] = useState<FullChapter | null>(() => chapterCache.get(chapter) ?? null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>(content ? 'ready' : 'loading')
  const [error, setError] = useState('')
  const [retryKey, setRetryKey] = useState(0)
  const [fontScale, setFontScale] = useState(1)
  const [query, setQuery] = useState('')
  const deferredQuery = useDeferredValue(query)
  const normalizedQuery = normalizeSearch(deferredQuery)
  const [currentPage, setCurrentPage] = useState(() => readSavedPage(ownerId, chapter))
  const [isSpeaking, setIsSpeaking] = useState(false)
  const pageElements = useRef(new Map<number, HTMLElement>())

  useEffect(() => {
    const controller = new AbortController()
    setContent(chapterCache.get(chapter) ?? null)
    setStatus(chapterCache.has(chapter) ? 'ready' : 'loading')
    setError('')
    setQuery('')
    setCurrentPage(readSavedPage(ownerId, chapter))
    void loadFullChapter(chapter, controller.signal)
      .then((result) => {
        setContent(result)
        setStatus('ready')
      })
      .catch((caught) => {
        if (controller.signal.aborted) return
        setStatus('error')
        setError(caught instanceof Error ? caught.message : 'Chưa thể tải bài đọc đầy đủ.')
      })
    return () => controller.abort()
  }, [chapter, ownerId, retryKey])

  useEffect(() => {
    if (!content || status !== 'ready') return
    const observer = new IntersectionObserver((entries) => {
      const visible = entries
        .filter((entry) => entry.isIntersecting)
        .sort((left, right) => right.intersectionRatio - left.intersectionRatio)[0]
      const page = Number((visible?.target as HTMLElement | undefined)?.dataset.page)
      if (!Number.isInteger(page) || page < 1) return
      setCurrentPage(page)
      try { localStorage.setItem(readingStorageKey(ownerId, chapter), String(page)) } catch { /* Optional device bookmark. */ }
    }, { rootMargin: '-18% 0px -64% 0px', threshold: [0, .15, .5] })
    pageElements.current.forEach((element) => observer.observe(element))
    return () => observer.disconnect()
  }, [chapter, content, ownerId, status])

  useEffect(() => () => {
    if ('speechSynthesis' in window) window.speechSynthesis.cancel()
  }, [chapter])

  const searchResults = useMemo(() => {
    if (!content || normalizedQuery.length < 2) return []
    return content.pages.flatMap((page) => {
      const snippet = searchSnippet(page, normalizedQuery)
      return snippet ? [{ page: page.number, heading: pageHeading(page), snippet }] : []
    }).slice(0, 60)
  }, [content, normalizedQuery])

  const scrollToPage = (page: number) => {
    pageElements.current.get(page)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    setCurrentPage(page)
  }

  const togglePageSpeech = () => {
    if (!content || !('speechSynthesis' in window)) return
    if (isSpeaking) {
      window.speechSynthesis.cancel()
      setIsSpeaking(false)
      return
    }
    const page = content.pages.find((item) => item.number === currentPage) ?? content.pages[0]
    const utterance = new SpeechSynthesisUtterance(page.blocks.map((block) => block.text).join('. ').slice(0, 12_000))
    utterance.lang = 'vi-VN'
    utterance.rate = .94
    utterance.onend = () => setIsSpeaking(false)
    utterance.onerror = () => setIsSpeaking(false)
    window.speechSynthesis.cancel()
    window.speechSynthesis.speak(utterance)
    setIsSpeaking(true)
  }

  if (status === 'error') {
    return <div className="academy-full-reader-state is-error" role="alert"><AlertCircle size={25} /><h2>Chưa mở được bài đọc</h2><p>{error}</p><button type="button" className="primary-button" onClick={() => setRetryKey((value) => value + 1)}>Thử tải lại</button></div>
  }
  if (status === 'loading' || !content) {
    return <div className="academy-full-reader-state" role="status"><LoaderCircle className="spin" size={25} /><h2>Đang mở toàn bộ Chương {chapter}</h2><p>Aura chỉ tải chương này để giữ tốc độ trên điện thoại.</p></div>
  }

  return (
    <article className="academy-full-reader" style={{ '--reader-font-scale': fontScale } as CSSProperties}>
      <header className="academy-full-reader__hero">
        <div className="academy-full-reader__eyebrow"><BookOpen size={16} /> GIÁO TRÌNH TOÀN VĂN · CHƯƠNG {chapter}</div>
        <h2>{content.title}</h2>
        <p>Toàn bộ phần chữ được giữ theo thứ tự trang của bản xuất bản. Với infographic hoặc bảng có bố cục phức tạp, hãy mở PDF gốc để xem hình ảnh chính xác.</p>
        <div className="academy-full-reader__stats"><span><FileText size={14} /> {content.pageCount} trang</span><span>{content.wordCount.toLocaleString('vi-VN')} từ</span><span><Bookmark size={14} /> Đang ở trang {currentPage}</span></div>
      </header>

      <div className="academy-full-reader__toolbar">
        <label><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tìm trong toàn bộ chương…" aria-label="Tìm trong toàn bộ chương" />{query ? <button type="button" onClick={() => setQuery('')} aria-label="Xóa tìm kiếm">×</button> : null}</label>
        <div className="academy-full-reader__font" aria-label="Điều chỉnh cỡ chữ"><button type="button" onClick={() => setFontScale((value) => Math.max(.9, Math.round((value - .1) * 10) / 10))} aria-label="Giảm cỡ chữ"><Minus size={15} /></button><span>Aa</span><button type="button" onClick={() => setFontScale((value) => Math.min(1.3, Math.round((value + .1) * 10) / 10))} aria-label="Tăng cỡ chữ"><Plus size={15} /></button></div>
        <button type="button" className={isSpeaking ? 'is-active' : ''} onClick={togglePageSpeech}>{isSpeaking ? <VolumeX size={16} /> : <Volume2 size={16} />}{isSpeaking ? 'Dừng đọc' : `Nghe trang ${currentPage}`}</button>
        <button type="button" onClick={onOpenPdf}><FileText size={16} /> PDF minh họa</button>
      </div>

      <div className="academy-full-reader__progress" aria-label={`Đã đọc đến trang ${currentPage} trên ${content.pageCount}`}><span style={{ width: `${Math.min(100, (currentPage / content.pageCount) * 100)}%` }} /></div>

      {normalizedQuery.length >= 2 ? (
        <section className="academy-full-reader__search-results" aria-label="Kết quả tìm kiếm">
          <div><Search size={17} /><strong>{searchResults.length ? `${searchResults.length} trang phù hợp` : 'Không tìm thấy nội dung phù hợp'}</strong><small>Kết quả được tìm trong toàn bộ chương, kể cả trang chưa cuộn tới.</small></div>
          {searchResults.length ? <div>{searchResults.map((result) => <button type="button" key={result.page} onClick={() => scrollToPage(result.page)}><span>Trang {result.page}</span><strong>{result.heading}</strong><small>{result.snippet}</small></button>)}</div> : null}
        </section>
      ) : null}

      {currentPage > 1 ? <button type="button" className="academy-full-reader__resume" onClick={() => scrollToPage(currentPage)}><Bookmark size={16} /> Tiếp tục từ trang {currentPage}</button> : null}

      <div className="academy-full-reader__layout">
        <nav className="academy-full-reader__pages" aria-label="Mục lục trang">
          <strong>Mục lục trang</strong>
          <div>{content.pages.map((page) => <button type="button" className={page.number === currentPage ? 'is-current' : ''} key={page.number} onClick={() => scrollToPage(page.number)} aria-current={page.number === currentPage ? 'page' : undefined}><span>{String(page.number).padStart(2, '0')}</span><small>{pageHeading(page)}</small></button>)}</div>
        </nav>
        <div className="academy-full-reader__document">
          {content.pages.map((page) => (
            <section
              className="academy-full-reader__page"
              id={`academy-full-chapter-${chapter}-page-${page.number}`}
              data-page={page.number}
              key={page.number}
              ref={(element) => { if (element) pageElements.current.set(page.number, element); else pageElements.current.delete(page.number) }}
              aria-labelledby={`academy-full-chapter-${chapter}-page-${page.number}-title`}
            >
              <header><span>CHƯƠNG {chapter}</span><strong id={`academy-full-chapter-${chapter}-page-${page.number}-title`}>Trang {page.number}/{content.pageCount}</strong></header>
              <div>
                {page.blocks.map((block, index) => block.kind === 'heading'
                  ? <h3 key={`${page.number}-${index}`}>{block.text}</h3>
                  : block.kind === 'bullet'
                    ? <p className="is-bullet" key={`${page.number}-${index}`}><CheckCircle2 size={15} />{block.text}</p>
                    : <p key={`${page.number}-${index}`}>{block.text}</p>)}
              </div>
            </section>
          ))}
          <footer className="academy-full-reader__source"><FileText size={16} /><div><strong>Nguồn chính thức</strong><small>{content.sourceFile}</small></div><button type="button" onClick={onOpenPdf}>Mở bản PDF có hình minh họa</button></footer>
        </div>
      </div>
    </article>
  )
}
