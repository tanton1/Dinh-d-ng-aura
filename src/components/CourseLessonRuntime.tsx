import { Children, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import {
  AlertCircle,
  Brain,
  BookOpen,
  Bookmark,
  List,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  Compass,
  Download,
  ExternalLink,
  FileSpreadsheet,
  FileType,
  Footprints,
  Lightbulb,
  LoaderCircle,
  LockKeyhole,
  ListChecks,
  Maximize2,
  Minimize2,
  Play,
  RefreshCw,
  Save,
  ShieldCheck,
  Sparkles,
  Volume2,
  VolumeX,
  Target,
  Timer,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import type { CourseLessonDraft, LessonResourceDraft } from '../types'
import { firebaseAuth } from '../lib/firebase'
import { courseLoadErrorMessage } from '../features/academy/courseLoadError'
import { emptyReaderState, flattenPdfOutline, loadReaderState, normalizeReaderState, readerStorageKey, saveReaderState } from '../features/academy/readerState'
import { auraNutritionStudyGuides } from '../data/auraNutritionStudyGuides'
import {
  AcademyWorkbookConflictError,
  loadAcademyWorkbookFromCloud,
  loadAcademyWorkbook,
  saveAcademyWorkbook,
  type AcademyWorkbookState,
} from '../services/academyLearningService'
import {
  getCourseMediaUrl,
  gradeCourseQuiz,
  safeCourseMediaUrl,
  type QuizGradeResult,
} from '../services/courseRuntimeService'

type RuntimeResource = LessonResourceDraft & {
  assetRef?: {
    assetId: string
    storagePath: string
    contentType?: string
    fileName?: string
    sizeBytes?: number
    status?: 'uploading' | 'ready' | 'failed'
  }
  isPrimary?: boolean
}

type RuntimeLesson = CourseLessonDraft & {
  primaryContent?: {
    kind: 'resource' | 'rich-text' | 'workout'
    resourceId?: string
    body?: string
  }
  quiz?: CourseLessonDraft['quiz'] & {
    publicSettings?: {
      maxAttempts?: number
      timeLimitMinutes?: number
      revealMode?: 'never' | 'after-submit' | 'after-pass'
      questionsPerAttempt?: number
    }
  }
}

interface ResolvedMediaState {
  status: 'idle' | 'loading' | 'ready' | 'error'
  url: string | null
  downloadUrl?: string
  fileName?: string
  contentType?: string
  message?: string
}

const resourceLabels = {
  slide: 'slide',
  video: 'video',
  document: 'tài liệu',
}

function stableOrderScore(value: string) {
  let score = 0
  for (let index = 0; index < value.length; index += 1) score = Math.imul(31, score) + value.charCodeAt(index) | 0
  return score
}

function runtimeResource(resource: LessonResourceDraft): RuntimeResource {
  return resource as RuntimeResource
}

function useResolvedMedia(courseId: string, lessonId: string, resource: RuntimeResource | undefined, enabled: boolean) {
  const [retryKey, setRetryKey] = useState(0)
  const [state, setState] = useState<ResolvedMediaState>({ status: 'idle', url: null })
  const storagePath = resource?.assetRef?.storagePath
  const externalUrl = resource?.url
  const contentType = resource?.assetRef?.contentType
  const assetStatus = resource?.assetRef?.status
  const resourceId = resource?.id

  useEffect(() => {
    let cancelled = false
    let refreshTimer: number | undefined
    if (!enabled || !resource) {
      setState({ status: 'idle', url: null })
      return
    }
    if (assetStatus && assetStatus !== 'ready') {
      setState({
        status: 'error',
        url: null,
        message: assetStatus === 'uploading' ? 'Media đang được xử lý.' : 'Media tải lên chưa sẵn sàng.',
      })
      return
    }

    const resolve = async () => {
      setState({ status: 'loading', url: null })
      try {
        if (storagePath) {
          const resolved = await getCourseMediaUrl({ courseId, lessonId, storagePath })
          if (cancelled) return
          setState({
            status: 'ready',
            url: resolved.url,
            downloadUrl: resolved.downloadUrl,
            fileName: resolved.fileName,
            contentType: resolved.contentType ?? contentType,
          })
          if (resolved.expiresAt) {
            const refreshAfter = Math.max(15_000, resolved.expiresAt - Date.now() - 30_000)
            refreshTimer = window.setTimeout(() => setRetryKey((value) => value + 1), refreshAfter)
          }
          return
        }
        const safeUrl = safeCourseMediaUrl(externalUrl)
        if (!safeUrl) throw new Error('Tài nguyên chưa có liên kết HTTPS hợp lệ.')
        if (!cancelled) setState({ status: 'ready', url: safeUrl, contentType })
      } catch (error) {
        if (!cancelled) {
          setState({
            status: 'error',
            url: null,
            message: error instanceof Error ? error.message : 'Không thể mở media lúc này.',
          })
        }
      }
    }

    void resolve()
    return () => {
      cancelled = true
      if (refreshTimer) window.clearTimeout(refreshTimer)
    }
  }, [assetStatus, contentType, courseId, enabled, externalUrl, lessonId, resourceId, retryKey, storagePath])

  return { ...state, retry: () => setRetryKey((value) => value + 1) }
}

function trustedVideoEmbed(value: string) {
  const url = new URL(value)
  if (url.hostname === 'youtu.be') {
    const id = url.pathname.split('/').filter(Boolean)[0]
    return id ? `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}` : null
  }
  if (url.hostname === 'www.youtube.com' || url.hostname === 'youtube.com') {
    const id = url.pathname.startsWith('/embed/') ? url.pathname.split('/')[2] : url.searchParams.get('v')
    return id ? `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}` : null
  }
  if (url.hostname === 'vimeo.com' || url.hostname === 'www.vimeo.com') {
    const id = url.pathname.split('/').filter(Boolean)[0]
    return id && /^\d+$/.test(id) ? `https://player.vimeo.com/video/${id}` : null
  }
  if (url.hostname === 'player.vimeo.com' && url.pathname.startsWith('/video/')) return url.href
  return null
}

function trustedSlideEmbed(value: string) {
  const url = new URL(value)
  if (url.hostname !== 'docs.google.com' || !url.pathname.startsWith('/presentation/')) return null
  return url.href
}

function MediaLoading() {
  return <div className="lesson-media-status" role="status"><LoaderCircle className="spin" size={16} /> Đang mở media bảo mật...</div>
}

/**
 * Canvas-based PDF reader used by chapter navigation. Rendering one page at a
 * time keeps memory bounded on phones and avoids the browser-native PDF iframe
 * limitations found in iOS/PWA webviews.
 */
export function CoursePdfReader({
  courseId,
  lessonId,
  resource,
  canAccess = true,
  ownerId = firebaseAuth?.currentUser?.uid ?? 'guest',
}: {
  courseId: string
  lessonId: string
  resource: LessonResourceDraft
  canAccess?: boolean
  ownerId?: string
}) {
  const runtime = runtimeResource(resource)
  const media = useResolvedMedia(courseId, lessonId, runtime, canAccess)
  const stageRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const renderTaskRef = useRef<RenderTask | null>(null)
  const touchStartRef = useRef<{ x: number; y: number } | null>(null)
  const storageKey = readerStorageKey(ownerId, courseId, lessonId, runtime.assetRef?.assetId || runtime.id)
  const [readingState, setReadingState] = useState(() => ownerId === 'guest' ? emptyReaderState() : loadReaderState(storageKey))
  const [storageMessage, setStorageMessage] = useState('Vị trí đọc và đánh dấu chỉ lưu trên thiết bị này.')
  const [outlineOpen, setOutlineOpen] = useState(false)
  const [outlineStatus, setOutlineStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [outline, setOutline] = useState<ReturnType<typeof flattenPdfOutline>>([])
  const [outlineQuery, setOutlineQuery] = useState('')
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [pdfDocument, setPdfDocument] = useState<PDFDocumentProxy | null>(null)
  const [documentStatus, setDocumentStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [documentError, setDocumentError] = useState('')
  const [pageNumber, setPageNumber] = useState(1)
  const [pageRendering, setPageRendering] = useState(false)
  const [zoom, setZoom] = useState(1)
  const [stageWidth, setStageWidth] = useState(0)
  const title = runtime.title || 'Tài liệu chương'
  const pageCount = pdfDocument?.numPages ?? 0

  const goToPage = (page: number) => {
    if (!pageCount || !Number.isInteger(page)) return
    const next = normalizeReaderState({ ...readingState, page }, pageCount)
    setPageNumber(next.page)
    setReadingState(next)
    if (ownerId !== 'guest' && !saveReaderState(storageKey, next)) setStorageMessage('Thiết bị không cho lưu vị trí đọc. Bạn vẫn có thể đọc trong phiên này.')
    stageRef.current?.scrollTo({ top: 0, left: 0 })
  }

  const toggleBookmark = () => {
    const exists = readingState.bookmarks.includes(pageNumber)
    if (!exists && readingState.bookmarks.length >= 50) {
      setStorageMessage('Đã đủ 50 dấu trang. Bỏ một dấu cũ trước khi thêm.'); return
    }
    const next = normalizeReaderState({ ...readingState, page: pageNumber, bookmarks: exists ? readingState.bookmarks.filter((page) => page !== pageNumber) : [...readingState.bookmarks, pageNumber] }, pageCount)
    setReadingState(next)
    setStorageMessage(ownerId === 'guest' ? 'Dấu trang khách chỉ giữ trong phiên này.' : saveReaderState(storageKey, next) ? 'Đã lưu đánh dấu trên thiết bị này.' : 'Đánh dấu chỉ giữ trong phiên này vì thiết bị không cho lưu.')
  }

  useEffect(() => {
    if (!outlineOpen || !pdfDocument) return
    let cancelled = false
    setOutlineStatus('loading')
    void pdfDocument.getOutline().then((items) => {
      if (cancelled) return
      setOutline(flattenPdfOutline(items ?? [])); setOutlineStatus('ready')
    }).catch(() => { if (!cancelled) setOutlineStatus('error') })
    return () => { cancelled = true }
  }, [outlineOpen, pdfDocument])

  const openOutlineItem = async (dest: string | unknown[] | null) => {
    if (!pdfDocument || !dest) return
    try {
      const resolved = typeof dest === 'string' ? await pdfDocument.getDestination(dest) : dest
      if (!resolved) throw new Error('Missing destination')
      const ref = resolved[0]
      const page = typeof ref === 'number' ? ref + 1 : await pdfDocument.getPageIndex(ref as { num: number; gen: number }) + 1
      goToPage(page)
    } catch { setStorageMessage('Không xác định được trang của mục này. Hãy chọn số trang bên dưới.') }
  }

  useEffect(() => {
    setIsFullscreen(false)
    setPdfDocument(null)
    setDocumentStatus('idle')
    setDocumentError('')
    const stored = ownerId === 'guest' ? emptyReaderState() : loadReaderState(storageKey)
    setReadingState(stored)
    setPageNumber(stored.page)
    setZoom(1)
    setOutlineOpen(false)
    setOutlineStatus('idle')
    setOutline([])
    setOutlineQuery('')
  }, [storageKey])

  useEffect(() => {
    if (!isFullscreen) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsFullscreen(false)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [isFullscreen])

  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    const updateWidth = () => {
      const style = window.getComputedStyle(stage)
      const horizontalPadding = Number.parseFloat(style.paddingLeft) + Number.parseFloat(style.paddingRight)
      setStageWidth(Math.max(0, Math.floor(stage.clientWidth - horizontalPadding)))
    }
    updateWidth()
    const observer = new ResizeObserver(updateWidth)
    observer.observe(stage)
    return () => observer.disconnect()
  }, [documentStatus, isFullscreen])

  useEffect(() => {
    if (media.status !== 'ready' || !media.url) return
    let cancelled = false
    let loadingTask: ReturnType<typeof import('pdfjs-dist')['getDocument']> | null = null
    setDocumentStatus('loading')
    setDocumentError('')
    void import('pdfjs-dist').then(async (pdfjs) => {
      if (cancelled) return
      pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl
      loadingTask = pdfjs.getDocument({ url: media.url as string })
      const document = await loadingTask.promise
      if (cancelled) return
      setPdfDocument(document)
      setOutlineStatus('idle')
      setPageNumber((current) => Math.max(1, Math.min(document.numPages, current)))
      setReadingState((current) => normalizeReaderState(current, document.numPages))
      setDocumentStatus('ready')
    }).catch((error) => {
      if (cancelled) return
      setDocumentStatus('error')
      setDocumentError(error instanceof Error ? error.message : 'Không thể đọc cấu trúc tệp PDF.')
    })
    return () => {
      cancelled = true
      renderTaskRef.current?.cancel()
      void loadingTask?.destroy()
    }
  }, [media.status, media.url, storageKey])

  useEffect(() => {
    if (!pdfDocument || documentStatus !== 'ready' || !stageWidth || !canvasRef.current) return
    let cancelled = false
    renderTaskRef.current?.cancel()
    setPageRendering(true)
    setDocumentError('')
    void pdfDocument.getPage(pageNumber).then(async (page) => {
      if (cancelled || !canvasRef.current) return
      const canvas = canvasRef.current
      const baseViewport = page.getViewport({ scale: 1 })
      const fitScale = Math.max(.25, Math.max(240, stageWidth) / baseViewport.width)
      const viewport = page.getViewport({ scale: fitScale * zoom })
      const pixelRatio = Math.min(2, Math.max(1, window.devicePixelRatio || 1))
      const context = canvas.getContext('2d', { alpha: false })
      if (!context) throw new Error('Thiết bị không hỗ trợ vùng vẽ PDF.')
      canvas.width = Math.max(1, Math.floor(viewport.width * pixelRatio))
      canvas.height = Math.max(1, Math.floor(viewport.height * pixelRatio))
      canvas.style.width = `${Math.floor(viewport.width)}px`
      canvas.style.height = `${Math.floor(viewport.height)}px`
      const task = page.render({
        canvas,
        canvasContext: context,
        viewport,
        transform: pixelRatio === 1 ? undefined : [pixelRatio, 0, 0, pixelRatio, 0, 0],
      })
      renderTaskRef.current = task
      await task.promise
      if (!cancelled) setPageRendering(false)
    }).catch((error) => {
      if (cancelled || (error instanceof Error && error.name === 'RenderingCancelledException')) return
      setPageRendering(false)
      setDocumentError(error instanceof Error ? error.message : 'Không thể hiển thị trang PDF này.')
    })
    return () => {
      cancelled = true
      renderTaskRef.current?.cancel()
    }
  }, [documentStatus, pageNumber, pdfDocument, stageWidth, zoom])

  if (!canAccess) {
    return <div className="lesson-empty-state"><LockKeyhole size={28} /><h2>Tài liệu đang được khóa</h2><p>Ghi danh khóa học để đọc tài liệu này.</p></div>
  }
  if (media.status === 'loading' || media.status === 'idle') {
    return <div className="lesson-pdf-reader-state" role="status"><LoaderCircle className="spin" size={20} /><span>Đang mở tài liệu…</span></div>
  }
  if (media.status === 'error' || !media.url) {
    return <div className="lesson-pdf-reader-state is-error" role="alert"><FileType size={20} /><div><strong>Chưa mở được tài liệu</strong><p>{media.message ?? 'Liên kết PDF chưa sẵn sàng.'}</p><button type="button" className="outline-button small" onClick={media.retry}><RefreshCw size={13} /> Thử lại</button></div></div>
  }
  if (documentStatus === 'loading' || documentStatus === 'idle') {
    return <div className="lesson-pdf-reader-state" role="status"><LoaderCircle className="spin" size={20} /><span>Đang chuẩn bị các trang tài liệu…</span></div>
  }
  if (documentStatus === 'error' || !pdfDocument) {
    return <div className="lesson-pdf-reader-state is-error" role="alert"><FileType size={20} /><div><strong>Chưa đọc được PDF</strong><p>{documentError || 'Tệp PDF không hợp lệ hoặc máy chủ không cho phép đọc trực tiếp.'}</p><MediaActions url={media.url} downloadUrl={media.downloadUrl} fileName={media.fileName} kind="document" compact /></div></div>
  }

  return (
    <article className={`lesson-pdf-reader${isFullscreen ? ' is-fullscreen' : ''}`} aria-label={`Trình đọc ${title}`}>
      <header className="lesson-pdf-reader__header">
        <div className="lesson-pdf-reader__title"><span><FileType size={17} /></span><div><small>ĐANG ĐỌC</small><strong>{title}</strong></div></div>
        <div className="lesson-pdf-reader__actions">
          <button type="button" className="outline-button small" aria-expanded={outlineOpen} aria-controls="pdf-reading-tools" onClick={() => setOutlineOpen((value) => !value)}><List size={15} /> Mục lục PDF</button>
          <button type="button" className="outline-button small" aria-pressed={readingState.bookmarks.includes(pageNumber)} onClick={toggleBookmark}><Bookmark size={15} />{readingState.bookmarks.includes(pageNumber) ? 'Đã đánh dấu' : 'Đánh dấu'}</button>
          <div className="lesson-pdf-reader__zoom" aria-label="Điều chỉnh kích thước trang">
            <button type="button" onClick={() => setZoom((value) => Math.max(.75, Math.round((value - .25) * 100) / 100))} disabled={zoom <= .75} aria-label="Thu nhỏ trang"><ZoomOut size={13} /></button>
            <button type="button" onClick={() => setZoom(1)} aria-label="Vừa chiều ngang">{Math.round(zoom * 100)}%</button>
            <button type="button" onClick={() => setZoom((value) => Math.min(2, Math.round((value + .25) * 100) / 100))} disabled={zoom >= 2} aria-label="Phóng to trang"><ZoomIn size={13} /></button>
          </div>
          <button type="button" className="outline-button small" onClick={() => setIsFullscreen((value) => !value)} aria-pressed={isFullscreen}>{isFullscreen ? <Minimize2 size={13} /> : <Maximize2 size={13} />}{isFullscreen ? 'Thu nhỏ' : 'Toàn màn hình'}</button>
          <MediaActions url={media.url} downloadUrl={media.downloadUrl} fileName={media.fileName} kind="document" compact />
        </div>
      </header>
      {outlineOpen ? <section id="pdf-reading-tools" className="academy-pdf-tools" aria-label="Mục lục và dấu trang PDF">
        <label>Tìm trong mục lục PDF<input type="search" value={outlineQuery} onChange={(event) => setOutlineQuery(event.target.value)} placeholder="Tên mục trong tệp PDF…" /></label>
        {outlineStatus === 'loading' ? <p role="status">Đang đọc mục lục của tệp…</p> : outlineStatus === 'error' ? <p role="alert">Chưa đọc được mục lục. Bạn vẫn có thể dùng phân trang.</p> : !outline.length ? <p>Tệp này không có mục lục điện tử. Hãy chọn trang hoặc lưu dấu trang để quay lại.</p> : <nav aria-label="Các mục trong PDF">{outline.filter((item) => item.title.toLocaleLowerCase('vi-VN').includes(outlineQuery.toLocaleLowerCase('vi-VN'))).map((item, index) => <button key={index} type="button" style={{ paddingLeft: 12 + item.depth * 12 }} onClick={() => void openOutlineItem(item.dest)}>{item.title}</button>)}</nav>}
        <strong>Dấu trang của bạn</strong>
        <div className="academy-pdf-bookmarks">{readingState.bookmarks.length ? readingState.bookmarks.map((page) => <button key={page} type="button" onClick={() => goToPage(page)} aria-current={pageNumber === page ? 'page' : undefined}>Trang {page}</button>) : <p>Chưa có dấu trang. Bấm “Đánh dấu” ở trang cần ghi nhớ.</p>}</div>
        <p role="status">{storageMessage}</p>
      </section> : null}
      <nav className="lesson-pdf-reader__pager" aria-label="Chuyển trang tài liệu">
        <button type="button" onClick={() => goToPage(pageNumber - 1)} disabled={pageNumber <= 1}><ChevronLeft size={16} /> Trang trước</button>
        <label><span>Trang</span><select value={pageNumber} onChange={(event) => goToPage(Number(event.target.value))} aria-label="Chọn trang PDF">{Array.from({ length: pageCount }, (_, index) => <option key={index + 1} value={index + 1}>{index + 1} / {pageCount}</option>)}</select></label>
        <button type="button" onClick={() => goToPage(pageNumber + 1)} disabled={pageNumber >= pageCount}>Trang sau <ChevronRight size={16} /></button>
      </nav>
      {documentError ? <div className="lesson-pdf-reader-state is-error" role="alert"><p>Chưa hiển thị được trang này. Bạn có thể chọn trang khác hoặc thử tải lại.</p><button type="button" className="outline-button small" onClick={media.retry}>Tải lại PDF</button></div> : null}
      <div
        ref={stageRef}
        className="lesson-pdf-reader__stage"
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget || zoom > 1) return
          if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); goToPage(pageNumber + (event.key === 'ArrowRight' ? 1 : -1)) }
        }}
        onTouchStart={(event) => { const touch = event.changedTouches[0]; touchStartRef.current = touch ? { x: touch.clientX, y: touch.clientY } : null }}
        onTouchEnd={(event) => {
          const start = touchStartRef.current
          const end = event.changedTouches[0]
          touchStartRef.current = null
          if (!start || !end || zoom > 1) return
          const distance = end.clientX - start.x
          if (Math.abs(distance) < 52 || Math.abs(distance) <= Math.abs(end.clientY - start.y) * 1.5) return
          goToPage(distance < 0 ? pageNumber + 1 : pageNumber - 1)
        }}
      >
        {pageRendering ? <div className="lesson-pdf-reader__loading" role="status"><LoaderCircle className="spin" size={18} /> Đang hiển thị trang {pageNumber}…</div> : null}
        <canvas ref={canvasRef} aria-label={`${title}, trang ${pageNumber} trên ${pageCount}`} />
      </div>
      <footer className="lesson-pdf-reader__footer"><span>Trang {pageNumber}/{pageCount} · vừa chiều ngang màn hình · vuốt trái/phải để chuyển trang.</span><a href={media.url} target="_blank" rel="noopener noreferrer">Mở riêng nếu cần</a></footer>
    </article>
  )
}

function MediaActions({
  url,
  downloadUrl,
  fileName,
  kind,
  compact = false,
}: {
  url: string
  downloadUrl?: string
  fileName?: string
  kind: RuntimeResource['kind']
  compact?: boolean
}) {
  const label = resourceLabels[kind]
  const downloadTarget = downloadUrl || url
  return (
    <div className={`lesson-media-actions${compact ? ' is-compact' : ''}`}>
      <a className="outline-button small" href={url} target="_blank" rel="noopener noreferrer">
        <ExternalLink size={14} /> Mở {kind === 'document' ? 'PDF' : label}
      </a>
      <a
        className="primary-button small"
        href={downloadTarget}
        download={fileName || undefined}
        target="_blank"
        rel="noopener noreferrer"
      >
        <Download size={14} /> Tải {kind === 'document' ? 'PDF' : label}
      </a>
    </div>
  )
}

function academyHeadingId(lessonId: string, label: string) {
  const slug = label
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
  return `${lessonId}-${slug || 'section'}`
}

function headingText(children: ReactNode) {
  return Children.toArray(children).map((child) => typeof child === 'string' || typeof child === 'number' ? String(child) : '').join('').trim()
}

function lessonChapterNumber(lesson: CourseLessonDraft) {
  const tag = lesson.tags?.find((item) => /^Chương\s+\d+$/i.test(item))
  const match = tag?.match(/\d+/)
  return match ? Number(match[0]) : null
}

function speakableLessonText(body: string) {
  return body
    .replace(/```[\s\S]*?```/g, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/[#>*_`~-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 18_000)
}

function workbookContentSignature(workbook: AcademyWorkbookState) {
  const { cloudRevision: _cloudRevision, updatedAt: _updatedAt, ...content } = workbook
  return JSON.stringify(content)
}

function AcademyWorkbookPanel({ lesson, courseId }: { lesson: CourseLessonDraft; courseId: string }) {
  const chapter = lessonChapterNumber(lesson)
  const deepDive = chapter ? auraNutritionStudyGuides[chapter]?.deepDive : undefined
  const ownerId = firebaseAuth?.currentUser?.uid ?? 'demo'
  const [state, setState] = useState<AcademyWorkbookState>(() => loadAcademyWorkbook(ownerId, courseId, lesson.id))
  const [ready, setReady] = useState(false)
  const [saved, setSaved] = useState(true)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [syncIssue, setSyncIssue] = useState<'conflict' | 'offline' | null>(null)
  const [saveNonce, setSaveNonce] = useState(0)
  const stateRef = useRef(state)
  const workbookScope = `${ownerId}:${courseId}:${lesson.id}`
  const workbookScopeRef = useRef(workbookScope)
  const mountedRef = useRef(true)

  useEffect(() => { stateRef.current = state }, [state])
  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  useEffect(() => {
    let cancelled = false
    workbookScopeRef.current = workbookScope
    setReady(false)
    setDirty(false)
    setSaving(false)
    setSyncIssue(null)
    void loadAcademyWorkbookFromCloud(ownerId, courseId, lesson.id).then((remote) => {
      if (!cancelled) {
        setState(remote)
        setSaved(true)
        setReady(true)
      }
    }).catch((error) => {
      if (!cancelled) {
        setDirty(loadAcademyWorkbook(ownerId, courseId, lesson.id).updatedAt > 0)
        setSyncIssue(error instanceof AcademyWorkbookConflictError ? 'conflict' : 'offline')
        setSaved(false)
        setReady(true)
      }
    })
    return () => { cancelled = true }
  }, [courseId, lesson.id, ownerId, workbookScope])

  useEffect(() => {
    if (!ready || !dirty || saving || syncIssue === 'conflict') return
    const signature = workbookContentSignature(state)
    const scope = workbookScope
    const timer = window.setTimeout(() => {
      setSaving(true)
      void saveAcademyWorkbook(ownerId, courseId, lesson.id, state)
        .then((synchronized) => {
          if (!mountedRef.current || workbookScopeRef.current !== scope) return
          const hasNewerLocalChanges = workbookContentSignature(stateRef.current) !== signature
          setState((current) => ({ ...current, cloudRevision: synchronized.cloudRevision, updatedAt: synchronized.updatedAt }))
          setDirty(hasNewerLocalChanges)
          setSaved(!hasNewerLocalChanges)
          setSyncIssue(null)
        })
        .catch((error) => {
          if (!mountedRef.current || workbookScopeRef.current !== scope) return
          setSaved(false)
          setSyncIssue(error instanceof AcademyWorkbookConflictError ? 'conflict' : 'offline')
        })
        .finally(() => { if (mountedRef.current && workbookScopeRef.current === scope) setSaving(false) })
    }, 650)
    return () => window.clearTimeout(timer)
  }, [courseId, dirty, lesson.id, ownerId, ready, saveNonce, saving, state, syncIssue, workbookScope])

  const changeState = (update: (current: AcademyWorkbookState) => AcademyWorkbookState) => {
    setState(update)
    setDirty(true)
    setSaved(false)
  }
  const updateAnswer = (id: string, value: string) => changeState((current) => ({
    ...current,
    answers: { ...current.answers, [id]: value.slice(0, 2000) },
  }))
  const toggleDay = (day: number) => changeState((current) => ({
    ...current,
    challengeDone: { ...current.challengeDone, [String(day)]: !current.challengeDone[String(day)] },
  }))
  const reloadFromCloud = async () => {
    setReady(false)
    try {
      const remote = await loadAcademyWorkbookFromCloud(ownerId, courseId, lesson.id, { preferRemote: true })
      setState(remote)
      setDirty(false)
      setSaved(true)
      setSyncIssue(null)
    } catch {
      setSyncIssue('offline')
    } finally {
      setReady(true)
    }
  }

  if (!deepDive) return null

  return (
    <section className="academy-workbook-panel" aria-labelledby={`workbook-${lesson.id}`}>
      <header className="academy-workbook-panel__header">
        <div>
          <span className="academy-section-kicker"><ClipboardCheck size={17} /><span><small>WORKBOOK TƯƠNG TÁC</small><strong id={`workbook-${lesson.id}`}>Biến bài đọc thành quyết định của bạn</strong></span></span>
          <p>Điền ngắn, lưu tự động. Nội dung chỉ thuộc tài khoản của bạn và có thể chỉnh lại bất cứ lúc nào.</p>
        </div>
        <span className={`academy-workbook-save ${saved ? 'is-saved' : syncIssue ? 'has-error' : ''}`} role="status"><Save size={14} />{saved ? 'Đã lưu' : syncIssue ? 'Chưa đồng bộ' : 'Đang lưu…'}</span>
      </header>
      {syncIssue ? <div className={`academy-workbook-sync academy-workbook-sync--${syncIssue}`} role="alert"><AlertCircle size={18} /><div><strong>{syncIssue === 'conflict' ? 'Có bản mới từ thiết bị khác' : 'Cloud đang tạm gián đoạn'}</strong><p>{syncIssue === 'conflict' ? 'Bản trên thiết bị vẫn được giữ. Tải bản Cloud mới nhất để tránh ghi đè.' : 'Dữ liệu vẫn nằm trên thiết bị này. Hãy thử đồng bộ lại khi kết nối ổn định.'}</p></div><button type="button" onClick={() => syncIssue === 'conflict' || !dirty ? void reloadFromCloud() : (setSyncIssue(null), setSaveNonce((value) => value + 1))}>{syncIssue === 'conflict' ? 'Tải bản mới nhất' : 'Thử lại'}</button></div> : null}
      <div className="academy-workbook-fields">
        {deepDive.workbookFields.map((field) => (
          <label key={field.id} className={`academy-workbook-field is-${field.kind}`}>
            <span>{field.label}</span>
            <small>{field.prompt}</small>
            {field.kind === 'scale' ? (
              <div className="academy-confidence-scale" role="radiogroup" aria-label={field.prompt}>
                {[1, 2, 3, 4, 5].map((score) => <button key={score} type="button" className={state.answers[field.id] === String(score) ? 'is-selected' : ''} onClick={() => updateAnswer(field.id, String(score))} aria-pressed={state.answers[field.id] === String(score)}>{score}</button>)}
              </div>
            ) : field.kind === 'long' ? (
              <textarea value={state.answers[field.id] ?? ''} onChange={(event) => updateAnswer(field.id, event.target.value)} rows={3} placeholder="Viết vài dòng thật ngắn…" />
            ) : (
              <input value={state.answers[field.id] ?? ''} onChange={(event) => updateAnswer(field.id, event.target.value)} placeholder="Ví dụ: Chủ nhật tuần này" />
            )}
          </label>
        ))}
      </div>
      <div className="academy-challenge-card">
        <div className="academy-challenge-card__title"><Target size={17} /><div><small>THỬ NGHIỆM 7 NGÀY</small><strong>{deepDive.challenge.title}</strong></div><span>{Object.values(state.challengeDone).filter(Boolean).length}/7</span></div>
        <div className="academy-challenge-days">
          {deepDive.challenge.days.map((day) => <label key={day.day} className={state.challengeDone[String(day.day)] ? 'is-done' : ''}><input type="checkbox" checked={Boolean(state.challengeDone[String(day.day)])} onChange={() => toggleDay(day.day)} /><span><b>Ngày {day.day}</b>{day.task}<small>{day.reflection}</small></span>{state.challengeDone[String(day.day)] ? <Check size={15} /> : null}</label>)}
        </div>
      </div>
      <div className="academy-readiness-card"><div><ShieldCheck size={17} /><strong>Cổng sẵn sàng</strong></div>{deepDive.readinessChecklist.map((item) => <span key={item}><CheckCircle2 size={14} />{item}</span>)}</div>
    </section>
  )
}

function AcademyRichLesson({
  lesson,
  body,
  courseId,
  onOpenResources,
}: {
  lesson: CourseLessonDraft
  body: string
  courseId: string
  onOpenResources?: () => void
}) {
  const isPractice = lesson.tags?.includes('Thực hành') === true
  const chapterLabel = lesson.tags?.find((tag) => /^Chương\s+\d+$/i.test(tag)) ?? 'AURA ACADEMY'
  const phaseLabel = lesson.tags?.find((tag) => !/^Chương\s+\d+$/i.test(tag) && !['Thực hành', 'Giáo trình 2026'].includes(tag))
  const takeaways = lesson.memory?.takeaways.slice(0, 3) ?? []
  const terms = lesson.memory?.glossary.slice(0, 3) ?? []
  const articleSections = useMemo(() => body
    .split('\n')
    .filter((line) => /^##\s+/.test(line))
    .map((line) => line.replace(/^##\s+/, '').trim())
    .filter(Boolean), [body])
  const handbook = lesson.resources?.find((resource) => resource.kind === 'document')
  const readingMinutes = Math.max(4, Math.ceil(body.trim().split(/\s+/).length / 220))
  const [isSpeaking, setIsSpeaking] = useState(false)
  const visualPath = isPractice
    ? [
        { label: 'Quan sát', detail: 'Bắt đầu từ dữ liệu thật', Icon: Compass },
        { label: 'Thử nhỏ', detail: 'Chọn một bước vừa sức', Icon: Footprints },
        { label: 'Rà lại', detail: 'Giữ, chỉnh hoặc dừng', Icon: Target },
      ]
    : [
        { label: 'Nhìn rộng', detail: 'Hiểu đúng bối cảnh', Icon: Compass },
        { label: 'Nắm lõi', detail: 'Giữ ba ý quan trọng', Icon: Lightbulb },
        { label: 'Nhớ sâu', detail: 'Tự nói lại bằng lời mình', Icon: Brain },
      ]

  return (
    <article className="lesson-copy lesson-primary-copy academy-rich-lesson">
      <header className={`academy-lesson-visual ${isPractice ? 'is-practice' : ''}`}>
        <div className="academy-lesson-visual__glow" aria-hidden="true" />
        <div className="academy-lesson-visual__meta">
          <span><Sparkles size={13} /> {chapterLabel}</span>
          {phaseLabel ? <span>{phaseLabel}</span> : null}
          <span><Timer size={13} /> {lesson.duration}</span>
        </div>
        <div className="academy-lesson-visual__copy">
          <span>{isPractice ? 'XƯỞNG THỰC HÀNH' : 'BẢN ĐỒ HỌC NHANH'}</span>
          <h2>{isPractice ? 'Biến kiến thức thành một bước làm được ngay' : 'Hiểu theo lớp, nhớ bằng kết nối'}</h2>
          <p>{lesson.summary}</p>
          <button type="button" className="academy-speak-button" onClick={() => {
            if (!('speechSynthesis' in window)) return
            if (isSpeaking) {
              window.speechSynthesis.cancel()
              setIsSpeaking(false)
              return
            }
            const utterance = new SpeechSynthesisUtterance(speakableLessonText(body))
            utterance.lang = 'vi-VN'
            utterance.rate = .94
            utterance.onend = () => setIsSpeaking(false)
            utterance.onerror = () => setIsSpeaking(false)
            window.speechSynthesis.cancel()
            window.speechSynthesis.speak(utterance)
            setIsSpeaking(true)
          }} aria-pressed={isSpeaking}><span>{isSpeaking ? <VolumeX size={16} /> : <Volume2 size={16} />}</span>{isSpeaking ? 'Dừng đọc bài' : 'Nghe bài học'}</button>
        </div>
        <div className="academy-learning-path" aria-label="Nhịp học của bài">
          {visualPath.map(({ label, detail, Icon }, index) => (
            <div key={label}>
              <span><Icon size={18} /></span>
              <strong>{label}</strong>
              <small>{detail}</small>
              {index < visualPath.length - 1 ? <i aria-hidden="true" /> : null}
            </div>
          ))}
        </div>
      </header>

      {articleSections.length ? (
        <nav className="academy-article-outline" aria-label="Nội dung trong bài">
          <div>
            <span><ListChecks size={18} /></span>
            <div><small>NỘI DUNG CHƯƠNG</small><strong>{articleSections.length} phần · khoảng {readingMinutes} phút đọc</strong></div>
          </div>
          <div>
            {articleSections.map((label, index) => (
              <button
                type="button"
                key={`${label}-${index}`}
                onClick={() => document.getElementById(academyHeadingId(lesson.id, label))?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
              >
                <span>{String(index + 1).padStart(2, '0')}</span>{label}
              </button>
            ))}
          </div>
        </nav>
      ) : null}

      {handbook && onOpenResources ? (
        <button type="button" className="academy-handbook-callout" onClick={onOpenResources}>
          <span><FileType size={22} /></span>
          <div><small>GIÁO TRÌNH ĐẦY ĐỦ</small><strong>{handbook.title}</strong><p>{handbook.note || 'PDF minh họa, case study, workbook và tài liệu tham khảo.'}</p></div>
          <i>Mở PDF <ExternalLink size={14} /></i>
        </button>
      ) : null}

      {takeaways.length ? (
        <section className={`academy-visual-takeaways ${isPractice ? 'is-practice' : ''}`} aria-label={isPractice ? 'Ba bước thực hành' : 'Ba ý cần mang theo'}>
          <div className="academy-section-kicker"><Lightbulb size={17} /><span><small>{isPractice ? 'LÀM THEO NHỊP' : '60 GIÂY NẮM LÕI'}</small><strong>{isPractice ? 'Ba bước để bắt đầu' : 'Ba ý cần mang theo'}</strong></span></div>
          <div>
            {takeaways.map((item, index) => (
              <article key={item}>
                <span>{String(index + 1).padStart(2, '0')}</span>
                <p>{item}</p>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      <div className="academy-rich-lesson__body">
        <ReactMarkdown components={{
          h1: () => null,
          h2: ({ children }) => {
            const label = headingText(children)
            return <h2 id={academyHeadingId(lesson.id, label)}>{children}</h2>
          },
        }}>{body}</ReactMarkdown>
      </div>

      {terms.length ? (
        <section className="academy-concept-strip" aria-label="Từ khóa của bài học">
          <div className="academy-section-kicker"><Brain size={17} /><span><small>TỪ KHÓA</small><strong>Chạm để tạo liên kết</strong></span></div>
          <dl>
            {terms.map((entry) => <div key={entry.id}><dt>{entry.term}</dt><dd>{entry.definition}</dd></div>)}
          </dl>
        </section>
      ) : null}
      <AcademyWorkbookPanel lesson={lesson} courseId={courseId} />
    </article>
  )
}

export function CoursePrimaryContent({
  courseId,
  lesson,
  canView,
  lockedMessage,
  onMediaProgress,
  onOpenResources,
}: {
  courseId: string
  lesson: CourseLessonDraft
  canView: boolean
  lockedMessage: string
  onMediaProgress?: (percent: number) => void
  onOpenResources?: () => void
}) {
  const runtimeLesson = lesson as RuntimeLesson
  const resources = useMemo(() => (lesson.resources ?? []).map(runtimeResource), [lesson.resources])
  const primaryResource = resources.find((resource) => resource.id === runtimeLesson.primaryContent?.resourceId)
    ?? resources.find((resource) => resource.isPrimary)
    ?? resources.find((resource) => lesson.type === 'Video' ? resource.kind === 'video' : resource.kind !== 'video')
  const media = useResolvedMedia(courseId, lesson.id, primaryResource, canView && runtimeLesson.primaryContent?.kind !== 'rich-text')

  if (!canView) {
    return <div className="video-player locked"><div className="video-pattern"><i /><i /><i /></div><div className="video-copy"><strong>{lesson.title}</strong><small>{lockedMessage}</small></div><div className="video-play" aria-hidden="true"><LockKeyhole size={29} /></div></div>
  }

  if (runtimeLesson.primaryContent?.kind === 'rich-text' && runtimeLesson.primaryContent.body?.trim()) {
    return <AcademyRichLesson courseId={courseId} lesson={lesson} body={runtimeLesson.primaryContent.body} onOpenResources={onOpenResources} />
  }

  if (runtimeLesson.primaryContent?.kind === 'workout' || lesson.type === 'Buổi tập') {
    return <div className="video-player"><div className="video-pattern"><i /><i /><i /></div><div className="video-copy"><strong>{lesson.title}</strong><small>Nội dung kế thừa này cần được giảng viên chuyển đổi sang bài học Aura Academy.</small></div><div className="video-play" aria-hidden="true"><FileType size={29} /></div></div>
  }

  if (!primaryResource) {
    return <div className="video-player"><div className="video-pattern"><i /><i /><i /></div><div className="video-copy"><strong>{lesson.title}</strong><small>{lesson.type === 'Quiz' ? 'Hoàn thành bài kiểm tra bên dưới.' : 'Giảng viên chưa thêm media chính.'}</small></div><div className="video-play" aria-hidden="true">{lesson.type === 'Video' ? <Play size={29} fill="currentColor" /> : lesson.type === 'Quiz' ? <ListChecks size={29} /> : <FileType size={29} />}</div></div>
  }

  if (media.status === 'loading') return <div className="video-player"><MediaLoading /></div>
  if (media.status === 'error' || !media.url) {
    return <div className="video-player"><div className="lesson-media-status" role="alert"><AlertCircle size={16} /> {media.message ?? 'Media chưa sẵn sàng.'}<button className="outline-button small" onClick={media.retry}><RefreshCw size={13} /> Thử lại</button></div></div>
  }

  const videoEmbed = primaryResource.kind === 'video' ? trustedVideoEmbed(media.url) : null
  const slideEmbed = primaryResource.kind === 'slide' ? trustedSlideEmbed(media.url) : null
  const looksLikeVideo = media.contentType?.startsWith('video/') || /\.(mp4|webm|ogg)(?:$|\?)/i.test(media.url)
  const looksLikePdf = media.contentType === 'application/pdf' || /\.pdf(?:$|\?)/i.test(media.url)

  if (primaryResource.kind === 'video' && videoEmbed) {
    return <div className="video-player lesson-runtime-player"><iframe src={videoEmbed} title={primaryResource.title || lesson.title} allow="accelerometer; autoplay; encrypted-media; picture-in-picture" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" /></div>
  }
  if (primaryResource.kind === 'video' && looksLikeVideo) {
    return <div className="video-player lesson-runtime-player"><video controls preload="metadata" src={media.url} onTimeUpdate={(event) => { const video = event.currentTarget; if (Number.isFinite(video.duration) && video.duration > 0) onMediaProgress?.(Math.round((video.currentTime / video.duration) * 100)) }}>Trình duyệt của bạn chưa hỗ trợ phát video.</video></div>
  }
  if (primaryResource.kind === 'slide' && slideEmbed) {
    return <div className="video-player lesson-runtime-player"><iframe src={slideEmbed} title={primaryResource.title || lesson.title} allowFullScreen sandbox="allow-scripts allow-same-origin allow-popups" referrerPolicy="no-referrer" /></div>
  }
  if ((primaryResource.kind === 'document' || primaryResource.kind === 'slide') && looksLikePdf) {
    return <CoursePdfReader courseId={courseId} lessonId={lesson.id} resource={primaryResource} canAccess={canView} />
  }

  return <div className="video-player"><div className="video-pattern"><i /><i /><i /></div><div className="video-copy"><strong>{primaryResource.title || lesson.title}</strong><small>Mở {resourceLabels[primaryResource.kind]} trong cửa sổ mới.</small></div><a className="video-play" href={media.url} target="_blank" rel="noopener noreferrer" aria-label={`Mở ${primaryResource.title || resourceLabels[primaryResource.kind]}`}><ExternalLink size={26} /></a></div>
}

export function CourseResourceItem({
  courseId,
  lessonId,
  resource,
  canAccess = true,
}: {
  courseId: string
  lessonId: string
  resource: LessonResourceDraft
  canAccess?: boolean
}) {
  const runtime = runtimeResource(resource)
  const media = useResolvedMedia(courseId, lessonId, runtime, canAccess)
  const Icon = runtime.kind === 'slide' ? FileSpreadsheet : runtime.kind === 'video' ? Play : FileType
  const title = runtime.title || `Tài nguyên ${resourceLabels[runtime.kind]}`
  const content = <><span><Icon size={16} /></span><div><strong>{title}</strong><small>{runtime.assetRef?.storagePath ? <><ShieldCheck size={12} /> Media bảo mật Aura</> : <><ExternalLink size={12} /> Liên kết ngoài</>}</small>{runtime.note ? <small>{runtime.note}</small> : null}</div></>

  if (!canAccess) return <div className="lesson-resource-item is-disabled" aria-disabled="true"><LockKeyhole size={16} /><div><strong>{title}</strong><small>Ghi danh để mở tài nguyên này.</small></div></div>
  if (media.status === 'loading') return <div className="lesson-resource-item is-disabled" role="status"><LoaderCircle className="spin" size={16} /><div><strong>{title}</strong><small>Đang tạo liên kết an toàn...</small></div></div>
  if (media.status !== 'ready' || !media.url) return (
    <div className="lesson-resource-item is-error" role="alert">
      {content}
      <div className="lesson-resource-error">
        <small>{media.message ?? 'Chưa thể tạo liên kết mở tài liệu.'}</small>
        <button type="button" className="outline-button small" onClick={media.retry} aria-label={`Thử tải lại ${title}`}><RefreshCw size={13} /> Thử lại</button>
      </div>
    </div>
  )
  return (
    <div className="lesson-resource-item">
      {content}
      <MediaActions url={media.url} downloadUrl={media.downloadUrl} fileName={media.fileName} kind={runtime.kind} />
    </div>
  )
}

export function CourseQuizRunner({
  courseId,
  lesson,
  canSubmit,
  demoMode,
  completed,
  onPassed,
  onReviewCards,
  remediationCards = [],
}: {
  courseId: string
  lesson: CourseLessonDraft
  canSubmit: boolean
  demoMode: boolean
  completed: boolean
  onPassed: () => Promise<void>
  onReviewCards?: (ids: string[]) => void
  remediationCards?: Array<{ id: string; title: string }>
}) {
  const runtimeLesson = lesson as RuntimeLesson
  const quiz = runtimeLesson.quiz
  const [answers, setAnswers] = useState<Record<string, number>>({})
  const [submitState, setSubmitState] = useState<'idle' | 'submitting' | 'error'>('idle')
  const [result, setResult] = useState<QuizGradeResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [localAttempts, setLocalAttempts] = useState(0)
  const [questionIndex, setQuestionIndex] = useState(0)
  const questionRef = useRef<HTMLFieldSetElement>(null)
  const questions = useMemo(() => {
    const items = [...(quiz?.questions ?? [])]
    if (quiz?.questionOrder === 'shuffle') {
      const ownerId = firebaseAuth?.currentUser?.uid ?? 'preview'
      items.sort((left, right) => stableOrderScore(`${ownerId}:${lesson.id}:${left.id}`) - stableOrderScore(`${ownerId}:${lesson.id}:${right.id}`))
    }
    const requested = quiz?.publicSettings?.questionsPerAttempt
    const count = Number.isInteger(requested) ? Math.max(1, Math.min(items.length, Number(requested))) : items.length
    const required = items.filter((question) => question.mustPass === true)
    const optional = items.filter((question) => question.mustPass !== true)
    return [...required, ...optional.slice(0, Math.max(0, count - required.length))]
  }, [lesson.id, quiz?.publicSettings?.questionsPerAttempt, quiz?.questionOrder, quiz?.questions])
  const answeredCount = questions.filter((question) => answers[question.id] !== undefined).length
  const moveQuestion = (index: number) => {
    setQuestionIndex(Math.max(0, Math.min(questions.length - 1, index)))
    window.requestAnimationFrame(() => { questionRef.current?.scrollIntoView({ block: 'start' }); questionRef.current?.focus({ preventScroll: true }) })
  }
  const configuredMaxAttempts = quiz?.publicSettings?.maxAttempts
  const maxAttempts = typeof configuredMaxAttempts === 'number' && configuredMaxAttempts > 0
    ? configuredMaxAttempts
    : undefined
  const attemptsExhausted = !result?.passed && (
    result?.attemptsRemaining === 0
    || (typeof maxAttempts === 'number' && localAttempts >= maxAttempts)
  )

  useEffect(() => {
    setAnswers({})
    setSubmitState('idle')
    setResult(null)
    setError(null)
    setLocalAttempts(0)
    setQuestionIndex(0)
  }, [lesson.id])

  if (!quiz || questions.length === 0) {
    return <div className="lesson-empty-state"><AlertCircle size={28} /><h2>Quiz chưa sẵn sàng</h2><p>Giảng viên cần bổ sung câu hỏi trước khi bạn có thể làm bài.</p></div>
  }

  const submit = async () => {
    if (!canSubmit || submitState === 'submitting' || attemptsExhausted) return
    if (questions.some((question) => answers[question.id] === undefined)) {
      setError('Hãy chọn một đáp án cho tất cả câu hỏi trước khi nộp bài.')
      moveQuestion(questions.findIndex((question) => answers[question.id] === undefined))
      return
    }
    setSubmitState('submitting')
    setError(null)
    try {
      let grade: QuizGradeResult
      if (demoMode) {
        const hasLegacyKey = questions.every((question) => typeof question.correctIndex === 'number')
        if (!hasLegacyKey) throw new Error('Quiz demo chưa có khóa đáp án để chấm thử.')
        const correctCount = questions.filter((question) => answers[question.id] === question.correctIndex).length
        const percent = Math.round((correctCount / questions.length) * 100)
        const mustPassPassed = questions.filter((question) => question.mustPass).every((question) => answers[question.id] === question.correctIndex)
        grade = { correctCount, totalQuestions: questions.length, percent, mustPassPassed, passed: percent >= quiz.passPercent && mustPassPassed, review: questions.map((question) => ({ questionId: question.id, correct: answers[question.id] === question.correctIndex, explanation: question.explanation ?? '', remediationCardIds: question.remediationCardIds ?? [] })) }
      } else {
        grade = await gradeCourseQuiz({ courseId, lessonId: lesson.id, answers })
      }
      setLocalAttempts((value) => value + 1)
      setResult(grade)
      if (grade.passed && !completed) await onPassed()
      setSubmitState('idle')
    } catch (caught) {
      setSubmitState('error')
      setError(courseLoadErrorMessage(caught))
    }
  }

  const retry = () => {
    setAnswers({})
    setResult(null)
    setError(null)
    setSubmitState('idle')
    setQuestionIndex(0)
  }

  const retryCompletion = async () => {
    if (!result?.passed || completed || submitState === 'submitting') return
    setSubmitState('submitting')
    setError(null)
    try {
      await onPassed()
      setSubmitState('idle')
    } catch (caught) {
      setSubmitState('error')
      setError(caught instanceof Error ? caught.message : 'Không thể lưu tiến độ. Vui lòng thử lại.')
    }
  }

  return (
    <section className="quiz-outline course-quiz-runner" aria-labelledby={`quiz-${lesson.id}`}>
      <div className="quiz-overview"><span><ShieldCheck size={15} /> Đáp án được chấm bảo mật trên Aura</span><span>Điểm đạt: {quiz.passPercent}%</span>{maxAttempts ? <span>Tối đa: {maxAttempts} lần</span> : null}</div>
      <h2 id={`quiz-${lesson.id}`}>{lesson.title}</h2>
      <div className="academy-quiz-progress" role="status">Đã trả lời {answeredCount}/{questions.length} câu · Ngân hàng {quiz.questions.length} câu{questions.some((question) => question.mustPass) ? ' · Cần đúng câu an toàn' : ''}</div>
      <nav className="academy-quiz-question-nav" aria-label="Điều hướng câu hỏi">{questions.map((question, index) => <button key={question.id} type="button" aria-label={`Câu ${index + 1}${answers[question.id] !== undefined ? ', đã trả lời' : ', chưa trả lời'}`} aria-current={questionIndex === index ? 'step' : undefined} className={answers[question.id] !== undefined ? 'is-answered' : ''} onClick={() => moveQuestion(index)}>{index + 1}</button>)}</nav>
      {questions.slice(questionIndex, questionIndex + 1).map((question) => (
        <fieldset ref={questionRef} tabIndex={-1} key={question.id} disabled={!canSubmit || submitState === 'submitting' || Boolean(result)}>
          <legend>Câu {questionIndex + 1}. {question.question || `Câu hỏi ${questionIndex + 1}`}{question.mustPass ? <small className="academy-quiz-required">An toàn · Bắt buộc đúng</small> : null}</legend>
          {question.options.map((option, optionIndex) => (
            <label key={`${question.id}-${optionIndex}`}>
              <input type="radio" name={`quiz-${lesson.id}-${question.id}`} checked={answers[question.id] === optionIndex} onChange={() => { setAnswers((current) => ({ ...current, [question.id]: optionIndex })); setError(null) }} />
              <span>{option || `Lựa chọn ${optionIndex + 1}`}</span>
            </label>
          ))}
        </fieldset>
      ))}
      <nav className="academy-quiz-pager" aria-label="Chuyển câu hỏi"><button type="button" disabled={questionIndex === 0} onClick={() => moveQuestion(questionIndex - 1)}><ChevronLeft size={16} /> Câu trước</button><span>{questionIndex + 1}/{questions.length}</span><button type="button" disabled={questionIndex >= questions.length - 1} onClick={() => moveQuestion(questionIndex + 1)}>Câu sau <ChevronRight size={16} /></button></nav>
      {result ? <>
        <div className={`learning-action-error ${result.passed ? 'is-success' : ''}`} role="status" aria-live="polite">{result.passed ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}<strong>{result.passed ? 'Bạn đã đạt!' : 'Chưa đạt lần này'}</strong><span>{result.correctCount}/{result.totalQuestions} câu đúng · {result.percent}%</span>{result.mustPassPassed === false ? <small>Cần đúng câu an toàn bắt buộc.</small> : null}{result.attemptsRemaining !== undefined && result.attemptsRemaining !== null ? <small>Còn {result.attemptsRemaining} lượt làm.</small> : null}</div>
        {result.review?.length ? <details className="course-quiz-review" open>
          <summary>Giải thích và thẻ cần xem lại <span>{result.review.filter((item) => !item.correct).length} câu cần ôn</span></summary>
          <div>{result.review.map((item) => { const index = questions.findIndex((question) => question.id === item.questionId); const cards = remediationCards.filter((card) => item.remediationCardIds.includes(card.id)); return <article key={item.questionId}><strong>{item.correct ? '✓' : '×'} {index >= 0 ? `Câu ${index + 1}` : 'Câu cần xem lại'}</strong><p>{item.explanation || (item.correct ? 'Đáp án của bạn phù hợp với nội dung chương.' : 'Hãy mở lại các thẻ được gợi ý và thử lại khi đã rõ hơn.')}</p>{cards.length && onReviewCards ? <button type="button" className="outline-button" onClick={() => onReviewCards(cards.map((card) => card.id))}>Ôn lại: {cards.map((card) => card.title).join(' · ')}</button> : item.remediationCardIds.length ? <small>Ôn lại phần Nắm lõi của chương này.</small> : null}</article> })}</div>
        </details> : null}
      </> : null}
      {error ? <div className="learning-action-error" role="alert">{error}</div> : null}
      {!canSubmit ? <p><LockKeyhole size={14} /> Hãy ghi danh và mở khóa bài học để nộp quiz.</p> : null}
      {result?.passed && error && !completed ? <button className="outline-button" type="button" onClick={() => void retryCompletion()} disabled={submitState === 'submitting'}><RefreshCw size={15} /> {submitState === 'submitting' ? 'Đang lưu tiến độ...' : 'Thử lưu tiến độ lại'}</button> : result && !result.passed && !attemptsExhausted ? <button className="outline-button" type="button" onClick={retry}><RefreshCw size={15} /> Làm lại quiz</button> : <button className="primary-button" type="button" onClick={submit} disabled={!canSubmit || submitState === 'submitting' || Boolean(result) || attemptsExhausted}>{submitState === 'submitting' ? <><LoaderCircle className="spin" size={16} /> Đang chấm bài...</> : completed || result?.passed ? <><CheckCircle2 size={16} /> Đã hoàn thành</> : 'Nộp bài kiểm tra'}</button>}
      {attemptsExhausted ? <p role="status">Bạn đã dùng hết số lượt làm quiz. Hãy liên hệ huấn luyện viên để được hỗ trợ.</p> : null}
    </section>
  )
}
