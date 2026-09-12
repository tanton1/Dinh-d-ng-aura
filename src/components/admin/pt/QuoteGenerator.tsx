import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { User } from 'firebase/auth'
import { Archive, Building2, CheckCircle2, Clock3, FileText, LoaderCircle, Package, Phone, Plus, Printer, RefreshCw, Search, ShoppingCart, X } from 'lucide-react'
import type { UserProfile } from '../../../types'
import { useAuth } from '../../../contexts/AuthContext'
import { Badge, Button, Dialog, EmptyState, ErrorState, LoadingState, PageHeader } from '../../ui'
import {
  acceptSalesQuote,
  archiveSalesQuote,
  createQuoteCommandKey,
  createSalesQuote,
  listSalesQuotes,
  type SalesQuote,
  type SalesQuoteCatalog,
  type SalesQuoteStatus,
} from '../../../services/quoteManagementService'
import './QuoteGenerator.css'

interface Props {
  user?: User | null
  profile?: UserProfile | null
  onNavigate?: (screen: string) => void
}

type StatusFilter = SalesQuoteStatus | 'all'
const EMPTY_CATALOG: SalesQuoteCatalog = { branches: [], packages: [] }

function vnd(value: number) {
  return `${Math.max(0, Number(value) || 0).toLocaleString('vi-VN')}đ`
}

function dateLabel(value: string | null) {
  if (!value) return 'Chưa ghi nhận'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 'Chưa ghi nhận' : date.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function statusLabel(status: SalesQuoteStatus) {
  return status === 'accepted' ? 'Đã gửi duyệt' : status === 'archived' ? 'Đã lưu trữ' : 'Chờ xử lý'
}

function statusTone(status: SalesQuoteStatus): 'success' | 'neutral' | 'warning' {
  return status === 'accepted' ? 'success' : status === 'archived' ? 'neutral' : 'warning'
}

function commandError(error: unknown) {
  if (error instanceof Error && error.message.trim()) return error.message.replace(/^FirebaseError:\s*/i, '')
  return 'Aura chưa thể hoàn tất thao tác. Hãy kiểm tra kết nối rồi thử lại.'
}

function isoAtEndOfDay(value: string) {
  return value ? new Date(`${value}T23:59:59.999`).getTime() : null
}

export default function QuoteGenerator({ profile, onNavigate }: Props) {
  const { backendMode, hasCapability } = useAuth()
  const canManage = backendMode === 'demo' || hasCapability('sales.operations.manage') || profile?.role === 'admin' || profile?.role === 'super_admin'
  const [quotes, setQuotes] = useState<SalesQuote[]>([])
  const [legacyQuotes, setLegacyQuotes] = useState<SalesQuote[]>([])
  const [catalog, setCatalog] = useState<SalesQuoteCatalog>(EMPTY_CATALOG)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [branchFilter, setBranchFilter] = useState('')
  const [search, setSearch] = useState('')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [detailQuote, setDetailQuote] = useState<SalesQuote | null>(null)
  const [acceptCandidate, setAcceptCandidate] = useState<SalesQuote | null>(null)
  const [archiveCandidate, setArchiveCandidate] = useState<SalesQuote | null>(null)
  const [linkStudentId, setLinkStudentId] = useState('')
  const [busyAction, setBusyAction] = useState<string | null>(null)
  const pendingRef = useRef(false)
  const [form, setForm] = useState({ customerName: '', customerPhone: '', branchId: '', packageId: '', discount: '0', memberReferralCode: '' })

  const load = useCallback(async (append = false) => {
    if (!canManage) { setLoading(false); return }
    if (append && !nextCursor) return
    append ? setLoadingMore(true) : setLoading(true)
    setError('')
    try {
      if (backendMode === 'demo') {
        if (!append) { setQuotes([]); setLegacyQuotes([]); setNextCursor(null) }
        return
      }
      const page = await listSalesQuotes({ branchId: branchFilter || undefined, status: statusFilter === 'all' ? undefined : statusFilter, cursor: append ? nextCursor || undefined : undefined, pageSize: 30, includeLegacy: !append })
      setQuotes((current) => append ? [...current, ...page.quotes] : page.quotes)
      if (!append) setLegacyQuotes(page.legacyQuotes || [])
      setNextCursor(page.nextCursor)
      setCatalog(page.catalog || EMPTY_CATALOG)
    } catch (cause) { setError(commandError(cause)) }
    finally { append ? setLoadingMore(false) : setLoading(false) }
  }, [backendMode, branchFilter, canManage, nextCursor, statusFilter])

  useEffect(() => { void load(false) }, [branchFilter, statusFilter]) // eslint-disable-line react-hooks/exhaustive-deps

  const visibleQuotes = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('vi-VN')
    const fromMillis = fromDate ? new Date(`${fromDate}T00:00:00`).getTime() : null
    const toMillis = isoAtEndOfDay(toDate)
    return [...quotes, ...legacyQuotes].filter((quote) => {
      if (query && ![quote.customerName, quote.customerPhone, quote.code, quote.packageName].some((value) => value.toLocaleLowerCase('vi-VN').includes(query))) return false
      const created = quote.createdAt ? new Date(quote.createdAt).getTime() : 0
      if (fromMillis && created < fromMillis) return false
      if (toMillis && created > toMillis) return false
      return true
    })
  }, [fromDate, legacyQuotes, quotes, search, toDate])

  const availablePackages = useMemo(() => catalog.packages.filter((item) => !item.branchId || item.branchId === form.branchId), [catalog.packages, form.branchId])

  const openCreate = () => {
    setError(''); setNotice('')
    setForm({ customerName: '', customerPhone: '', branchId: catalog.branches[0]?.id || '', packageId: '', discount: '0', memberReferralCode: '' })
    setCreateOpen(true)
  }

  const handleCreate = async () => {
    if (pendingRef.current) return
    const discount = Number(form.discount || 0)
    if (form.customerName.trim().length < 2 || !form.customerPhone.trim() || !form.branchId || !form.packageId || !Number.isInteger(discount) || discount < 0) { setError('Vui lòng điền đủ tên, số điện thoại, chi nhánh, gói tập và mức ưu đãi hợp lệ.'); return }
    pendingRef.current = true; setBusyAction('create'); setError('')
    try {
      if (backendMode === 'demo') {
        const pkg = catalog.packages.find((item) => item.id === form.packageId)
        const now = new Date().toISOString()
        const demoQuote: SalesQuote = { id: `demo-${Date.now()}`, source: 'canonical', code: `AQ-DEMO-${Date.now().toString().slice(-6)}`, customerName: form.customerName.trim(), customerPhone: form.customerPhone.trim(), branchId: form.branchId, packageId: form.packageId, packageName: pkg?.name || 'Gói tập', originalPrice: pkg?.price || 0, discount, finalPrice: Math.max(0, (pkg?.price || 0) - discount), status: 'pending', revision: 1, memberReferralCode: form.memberReferralCode.trim() || null, assignedSalesId: null, leadId: null, approvalId: null, approvalStatus: null, createdAt: now, updatedAt: now, validUntil: new Date(Date.now() + 7 * 86_400_000).toISOString() }
        setQuotes((current) => [demoQuote, ...current]); setDetailQuote(demoQuote)
      } else {
        const result = await createSalesQuote({ customerName: form.customerName.trim(), customerPhone: form.customerPhone.trim(), branchId: form.branchId, packageId: form.packageId, discount, memberReferralCode: form.memberReferralCode.trim() || undefined, idempotencyKey: createQuoteCommandKey() })
        if (result.quote) setDetailQuote(result.quote)
        await load(false)
      }
      setCreateOpen(false); setNotice('Đã tạo báo giá. Báo giá mới được lưu với phiên bản và nhật ký kiểm toán.')
    } catch (cause) { setError(commandError(cause)) }
    finally { pendingRef.current = false; setBusyAction(null) }
  }

  const handleAccept = async () => {
    const quote = acceptCandidate
    if (!quote || pendingRef.current || quote.source !== 'canonical') return
    pendingRef.current = true; setBusyAction(`accept:${quote.id}`); setError('')
    try {
      if (backendMode === 'demo') {
        const updated = { ...quote, status: 'accepted' as const, revision: quote.revision + 1 }
        setQuotes((current) => current.map((item) => item.id === quote.id ? updated : item)); setDetailQuote(updated)
      } else {
        await acceptSalesQuote({ quoteId: quote.id, expectedRevision: quote.revision, idempotencyKey: createQuoteCommandKey(), studentId: linkStudentId.trim() || undefined })
        await load(false)
      }
      setAcceptCandidate(null); setLinkStudentId(''); setNotice('Đã gửi hồ sơ duyệt hợp đồng. Aura chưa tự tạo tài khoản hoặc kích hoạt hợp đồng.')
    } catch (cause) { setError(commandError(cause)) }
    finally { pendingRef.current = false; setBusyAction(null) }
  }

  const handleArchive = async () => {
    const quote = archiveCandidate
    if (!quote || pendingRef.current || quote.source !== 'canonical') return
    pendingRef.current = true; setBusyAction(`archive:${quote.id}`); setError('')
    try {
      if (backendMode === 'demo') setQuotes((current) => current.map((item) => item.id === quote.id ? { ...item, status: 'archived' } : item))
      else { await archiveSalesQuote({ quoteId: quote.id, expectedRevision: quote.revision, idempotencyKey: createQuoteCommandKey() }); await load(false) }
      setArchiveCandidate(null); setNotice('Đã lưu trữ báo giá. Dữ liệu lịch sử vẫn được giữ nguyên.')
    } catch (cause) { setError(commandError(cause)) }
    finally { pendingRef.current = false; setBusyAction(null) }
  }

  if (!canManage) return <ErrorState title="Chưa được cấp quyền báo giá" description="Bạn cần capability sales.operations.manage trong phạm vi được cấp để xem hoặc tạo báo giá." />

  return <div className="quote-management-page">
    <PageHeader eyebrow="AURA OPERATIONS · SALES" title="Báo giá & hồ sơ duyệt" description="Quản lý báo giá theo chi nhánh, giữ nguyên lịch sử legacy và gửi duyệt hợp đồng an toàn." action={<div className="quote-management-header-actions"><Button variant="secondary" onClick={() => onNavigate?.('admin-packages')}><Package size={17} /> Thiết lập gói</Button><Button onClick={openCreate}><Plus size={17} /> Tạo báo giá</Button></div>} />
    {notice && <div className="quote-management-notice" role="status" aria-live="polite"><CheckCircle2 size={17} />{notice}<button type="button" aria-label="Đóng thông báo" onClick={() => setNotice('')}><X size={16} /></button></div>}
    {error && <ErrorState title="Chưa thể hoàn tất thao tác" description={error} action={<Button variant="secondary" onClick={() => void load(false)}><RefreshCw size={16} /> Thử lại</Button>} />}
    <section className="quote-management-toolbar" aria-label="Bộ lọc báo giá">
      <label className="quote-management-search"><Search size={17} /><span className="sr-only">Tìm báo giá</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Tìm tên, mã báo giá, số điện thoại…" /></label>
      <label><span>Trạng thái</span><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}><option value="all">Tất cả</option><option value="pending">Chờ xử lý</option><option value="accepted">Đã gửi duyệt</option><option value="archived">Đã lưu trữ</option></select></label>
      <label><span>Chi nhánh</span><select value={branchFilter} onChange={(event) => setBranchFilter(event.target.value)}><option value="">Tất cả chi nhánh</option>{catalog.branches.map((branch) => <option value={branch.id} key={branch.id}>{branch.name}</option>)}</select></label>
      <label><span>Từ ngày</span><input type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} /></label>
      <label><span>Đến ngày</span><input type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} /></label>
      <Button variant="ghost" onClick={() => void load(false)} disabled={loading}><RefreshCw size={17} className={loading ? 'is-spinning' : ''} /> Làm mới</Button>
    </section>
    <section className="quote-management-summary"><div><ShoppingCart size={18} /><strong>{visibleQuotes.length}</strong><span>báo giá đang hiển thị</span></div><div><Clock3 size={18} /><strong>{quotes.filter((quote) => quote.status === 'pending').length}</strong><span>chờ xử lý</span></div><div><CheckCircle2 size={18} /><strong>{quotes.filter((quote) => quote.status === 'accepted').length}</strong><span>đã gửi duyệt</span></div><div><Building2 size={18} /><strong>{catalog.branches.length}</strong><span>chi nhánh được cấp</span></div></section>
    {loading ? <LoadingState title="Đang tải báo giá" description="Aura đang kiểm tra phạm vi và đối chiếu dữ liệu legacy." /> : visibleQuotes.length === 0 ? <EmptyState title="Chưa có báo giá phù hợp" description="Thử đổi bộ lọc hoặc tạo báo giá đầu tiên trong phạm vi được cấp." action={<Button onClick={openCreate}><Plus size={17} /> Tạo báo giá</Button>} /> : <div className="quote-management-list">
      {visibleQuotes.map((quote) => <article className={`quote-card${quote.source === 'legacy' ? ' quote-card--legacy' : ''}`} key={`${quote.source}-${quote.id}`}>
        <div className="quote-card__main"><div className="quote-card__eyebrow"><span className="quote-code">{quote.code}</span><span>{dateLabel(quote.createdAt)}</span>{quote.source === 'legacy' ? <Badge>Legacy · chỉ đọc</Badge> : <Badge tone={statusTone(quote.status)}>{statusLabel(quote.status)}</Badge>}</div><h2>{quote.customerName || 'Chưa có tên khách'}</h2><p>{quote.packageName || 'Chưa chọn gói'} · <strong>{vnd(quote.finalPrice)}</strong></p><div className="quote-card__meta"><span><Phone size={14} />{quote.customerPhone || 'Chưa có SĐT'}</span>{quote.memberReferralCode && <span>Mã giới thiệu: {quote.memberReferralCode}</span>}</div></div>
        <div className="quote-card__actions">{quote.status === 'pending' && quote.source === 'canonical' && <Button tone="success" onClick={() => setAcceptCandidate(quote)}><CheckCircle2 size={16} /> Gửi duyệt</Button>}<Button variant="secondary" onClick={() => setDetailQuote(quote)}><FileText size={16} /> Chi tiết</Button>{quote.status === 'pending' && quote.source === 'canonical' && <button type="button" className="quote-icon-button quote-icon-button--danger" aria-label={`Lưu trữ ${quote.code}`} onClick={() => setArchiveCandidate(quote)}><Archive size={17} /></button>}</div>
      </article>)}
      {nextCursor && <div className="quote-management-more"><Button variant="secondary" onClick={() => void load(true)} disabled={loadingMore}>{loadingMore && <LoaderCircle size={16} className="is-spinning" />} {loadingMore ? 'Đang tải…' : 'Tải thêm báo giá'}</Button></div>}
    </div>}

    <Dialog open={createOpen} onClose={() => { if (!pendingRef.current) setCreateOpen(false) }} title="Tạo báo giá" description="Báo giá được ghi server-side, có snapshot gói, revision và chống ghi trùng." footer={<><Button variant="secondary" onClick={() => setCreateOpen(false)} disabled={busyAction === 'create'}>Hủy</Button><Button onClick={() => void handleCreate()} disabled={busyAction === 'create'}>{busyAction === 'create' && <LoaderCircle size={16} className="is-spinning" />} {busyAction === 'create' ? 'Đang tạo…' : 'Tạo báo giá'}</Button></>}>
      <div className="quote-form-grid"><label>Tên khách hàng *<input autoFocus value={form.customerName} onChange={(event) => setForm({ ...form, customerName: event.target.value })} placeholder="Nguyễn Văn A" /></label><label>Số điện thoại *<input inputMode="tel" value={form.customerPhone} onChange={(event) => setForm({ ...form, customerPhone: event.target.value })} placeholder="09xx xxx xxx" /></label><label>Chi nhánh *<select value={form.branchId} onChange={(event) => setForm({ ...form, branchId: event.target.value, packageId: '' })}><option value="">Chọn chi nhánh</option>{catalog.branches.map((branch) => <option value={branch.id} key={branch.id}>{branch.name}</option>)}</select></label><label>Gói tập *<select value={form.packageId} onChange={(event) => setForm({ ...form, packageId: event.target.value })}><option value="">Chọn gói tập</option>{availablePackages.map((item) => <option value={item.id} key={item.id}>{item.name} · {vnd(item.price)}</option>)}</select></label><label>Ưu đãi (VNĐ)<input type="number" min="0" step="1" value={form.discount} onChange={(event) => setForm({ ...form, discount: event.target.value })} /></label><label>Mã giới thiệu <small>Không bắt buộc</small><input maxLength={40} value={form.memberReferralCode} onChange={(event) => setForm({ ...form, memberReferralCode: event.target.value.toUpperCase().replace(/\s/g, '') })} placeholder="AURA…" /></label></div>
    </Dialog>

    <Dialog open={Boolean(acceptCandidate)} onClose={() => { if (!pendingRef.current) setAcceptCandidate(null) }} title="Gửi duyệt hợp đồng" description="Bước này tạo lead và hồ sơ contract approval pending. Không tự tạo tài khoản, không kích hoạt hợp đồng và không thu tiền." footer={<><Button variant="secondary" onClick={() => setAcceptCandidate(null)} disabled={Boolean(busyAction)}>Hủy</Button><Button tone="success" onClick={() => void handleAccept()} disabled={Boolean(busyAction)}>{busyAction?.startsWith('accept:') && <LoaderCircle size={16} className="is-spinning" />} {busyAction?.startsWith('accept:') ? 'Đang gửi…' : 'Xác nhận gửi duyệt'}</Button></>}>
      <div className="quote-confirm-copy"><CheckCircle2 size={22} /><p><strong>{acceptCandidate?.customerName}</strong> sẽ được chuyển sang hàng đợi duyệt hợp đồng. Nếu đã có hồ sơ học viên, nhập mã học viên để liên kết chính xác; để trống nếu cần quản lý xác minh sau.</p></div><label>Mã học viên hiện tại (tuỳ chọn)<input value={linkStudentId} onChange={(event) => setLinkStudentId(event.target.value)} placeholder="Không tự dò theo tên hoặc số điện thoại" /></label>
    </Dialog>

    <Dialog open={Boolean(archiveCandidate)} onClose={() => { if (!pendingRef.current) setArchiveCandidate(null) }} title="Lưu trữ báo giá?" description={archiveCandidate ? `“${archiveCandidate.code} · ${archiveCandidate.customerName}” sẽ không còn trong hàng đợi chờ xử lý.` : undefined} footer={<><Button variant="secondary" onClick={() => setArchiveCandidate(null)} disabled={Boolean(busyAction)}>Giữ lại</Button><Button tone="danger" onClick={() => void handleArchive()} disabled={Boolean(busyAction)}>{busyAction?.startsWith('archive:') && <LoaderCircle size={16} className="is-spinning" />} {busyAction?.startsWith('archive:') ? 'Đang lưu…' : 'Lưu trữ'}</Button></>}><p className="quote-muted-copy">Lịch sử báo giá không bị xoá và vẫn có thể đối soát trong timeline.</p></Dialog>

    <Dialog open={Boolean(detailQuote)} onClose={() => setDetailQuote(null)} title={detailQuote ? `Báo giá · ${detailQuote.code}` : 'Chi tiết báo giá'} description="Thông tin chỉ đọc từ projection báo giá." footer={<><Button variant="secondary" onClick={() => setDetailQuote(null)}>Đóng</Button><Button onClick={() => window.print()}><Printer size={16} /> In báo giá</Button></>}>
      {detailQuote && <div className="quote-detail"><div className="quote-detail__header"><span className="quote-detail__mark"><ShoppingCart size={22} /></span><div><span>AURA FITNESS</span><h3>{detailQuote.customerName}</h3></div><Badge tone={detailQuote.source === 'legacy' ? 'neutral' : statusTone(detailQuote.status)}>{detailQuote.source === 'legacy' ? 'Legacy · chỉ đọc' : statusLabel(detailQuote.status)}</Badge></div><dl><div><dt>Khách hàng</dt><dd>{detailQuote.customerName}</dd></div><div><dt>Điện thoại</dt><dd>{detailQuote.customerPhone || 'Chưa có'}</dd></div><div><dt>Gói tập</dt><dd>{detailQuote.packageName}</dd></div><div><dt>Giá niêm yết</dt><dd>{vnd(detailQuote.originalPrice)}</dd></div><div><dt>Ưu đãi</dt><dd>- {vnd(detailQuote.discount)}</dd></div><div><dt>Thành tiền</dt><dd className="quote-detail__total">{vnd(detailQuote.finalPrice)}</dd></div><div><dt>Hiệu lực đến</dt><dd>{dateLabel(detailQuote.validUntil)}</dd></div><div><dt>Phiên bản</dt><dd>{detailQuote.revision || 'Legacy'}</dd></div></dl><p className="quote-muted-copy">Báo giá chỉ là đề xuất thương mại. Hợp đồng chỉ được kích hoạt sau khi người có quyền phê duyệt và hoàn tất quy trình thu tiền.</p></div>}
    </Dialog>
  </div>
}
