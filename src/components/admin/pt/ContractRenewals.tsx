import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle, ArrowRight, BadgeCheck, BarChart3, CalendarDays, CheckCircle2,
  BookOpenText, ChevronDown, ChevronRight, CircleDollarSign, ClipboardCheck, Clock3, Copy, Filter,
  History, KanbanSquare, ListFilter, LoaderCircle, MessageCircle, Phone, RefreshCw,
  Search, Send, Sparkles, Target, UserRoundCheck, UserRoundPlus, UsersRound, X,
} from 'lucide-react'
import {
  assignContractRenewalCase,
  decideRenewalApproval,
  getContractRenewalCaseDetail,
  getRenewalAnalytics,
  listContractRenewalCases,
  listRenewalMessageTemplates,
  listRenewalCalendar,
  recordContractRenewalActivity,
  refreshContractRenewalQueue,
  transferRenewalCases,
  type RenewalActivityOutcome,
  type RenewalActivityType,
  type RenewalAnalytics,
  type RenewalCaseDetail,
  type RenewalListInput,
  type RenewalMessageTemplate,
  type RenewalPipelineResponse,
  type RenewalPipelineRow,
  type RenewalRiskCategory,
  type RenewalSegment,
  type RenewalSlaStatus,
  type RenewalStage,
} from '../../../services/contractRenewalService'
import RenewContractModal from './RenewContractModal'
import './ContractRenewals.css'

interface Props { onNavigate?: (screen: string) => void }
type WorkspaceTab = 'queue' | 'pipeline' | 'calendar' | 'report'
type RenewalPermissions = RenewalPipelineResponse['permissions']

const pendingPermissions: RenewalPermissions = {
  canRecordActivity: false, canCreateQuote: false, canRenewContract: false,
  canViewFinancials: false, canViewAnalytics: false, canAssign: false, canApprove: false,
}

const riskLabels: Record<RenewalRiskCategory, string> = {
  expired: 'Đã hết hạn', exhausted: 'Đã hết buổi', critical: 'Cần xử lý ngay', upcoming: 'Sắp hết', early: 'Theo dõi sớm',
}
const stageLabels: Record<RenewalStage, string> = {
  uncontacted: 'Chưa liên hệ', contacted: 'Đã liên hệ', interested: 'Quan tâm', quote_sent: 'Đã gửi báo giá',
  follow_up: 'Hẹn chăm sóc', won: 'Đã tái ký', lost: 'Không tái ký',
}
const slaLabels: Record<RenewalSlaStatus, string> = { overdue: 'Quá SLA', due_today: 'Đến hạn hôm nay', upcoming: 'Sắp tới', done: 'Hoàn tất' }
const segmentLabels: Record<RenewalSegment, string> = {
  expiring_30d: 'Sắp hết hạn trong tháng',
  exhausted_active: 'Hết buổi, còn thời hạn',
  expired_last_30d: 'Hết hạn 1 tháng gần đây',
  in_care: 'Hợp đồng đang chăm sóc',
}
const stageOrder: RenewalStage[] = ['uncontacted', 'contacted', 'interested', 'quote_sent', 'follow_up', 'won', 'lost']
const editableStages: RenewalStage[] = ['uncontacted', 'contacted', 'interested', 'quote_sent', 'follow_up', 'lost']
const trainerEditableStages: RenewalStage[] = ['uncontacted', 'contacted', 'interested', 'follow_up']
const money = (value: number) => `${new Intl.NumberFormat('vi-VN').format(Math.max(0, value))}đ`
const formatDate = (value?: string | null) => {
  if (!value) return 'Chưa hẹn'
  const date = new Date(`${value.slice(0, 10)}T00:00:00`)
  return Number.isNaN(date.getTime()) ? 'Chưa hẹn' : date.toLocaleDateString('vi-VN')
}
const vietnamToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
const addDays = (dateKey: string, days: number) => {
  const [year, month, day] = dateKey.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day + days))
  return date.toISOString().slice(0, 10)
}

function initialRenewalSla(): 'all' | RenewalSlaStatus {
  const focus = new URLSearchParams(window.location.hash.split('?')[1] || '').get('focus')
  return focus === 'overdue' ? 'overdue' : focus === 'due-today' ? 'due_today' : 'all'
}

function messageFor(row: RenewalPipelineRow) {
  return `Aura Fitness xin chào ${row.student.name}. Gói ${row.contract.packageName} của bạn ${row.risk.daysLeft < 0 ? 'đã hết hạn' : `còn ${row.risk.daysLeft} ngày`}. Aura muốn đồng hành cùng bạn trong lộ trình tiếp theo. Bạn thuận tiện để Aura tư vấn vào thời gian nào?`
}

function openZalo(row: RenewalPipelineRow, message = messageFor(row)) {
  const phone = row.student.phone.replace(/\D/g, '')
  if (!phone) return
  window.open(`https://zalo.me/${phone}?text=${encodeURIComponent(message)}`, '_blank', 'noopener,noreferrer')
}

export default function ContractRenewals({ onNavigate }: Props) {
  const [tab, setTab] = useState<WorkspaceTab>('queue')
  const [data, setData] = useState<RenewalPipelineResponse | null>(null)
  const [rows, setRows] = useState<RenewalPipelineRow[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [search, setSearch] = useState('')
  const [risk, setRisk] = useState<'all' | RenewalRiskCategory>('all')
  const [stage, setStage] = useState<'all' | RenewalStage>('all')
  const [sla, setSla] = useState<'all' | RenewalSlaStatus>(initialRenewalSla)
  const [approval, setApproval] = useState<'all' | 'pending' | 'approved' | 'rejected' | 'consumed' | 'none'>('all')
  const [branchId, setBranchId] = useState('all')
  const [assigneeId, setAssigneeId] = useState('all')
  const [sort, setSort] = useState<'priority' | 'value' | 'follow_up'>('priority')
  const [segment, setSegment] = useState<'all' | RenewalSegment>('all')
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(null)
  const [detail, setDetail] = useState<RenewalCaseDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [renewing, setRenewing] = useState<RenewalPipelineRow | null>(null)
  const [calendarItems, setCalendarItems] = useState<RenewalPipelineRow[]>([])
  const [analytics, setAnalytics] = useState<RenewalAnalytics | null>(null)
  const [messageTemplates, setMessageTemplates] = useState<RenewalMessageTemplate[]>([])
  const [templateError, setTemplateError] = useState('')
  const [selectedCaseIds, setSelectedCaseIds] = useState<Set<string>>(new Set())
  const [transferOpen, setTransferOpen] = useState(false)
  const [reportFrom, setReportFrom] = useState(addDays(vietnamToday(), -30))
  const [reportTo, setReportTo] = useState(vietnamToday())

  const listInput = useMemo<RenewalListInput>(() => ({
    pageSize: 30, search: search.trim(), risk, stage, sla, approval, branchId, assignedSalesId: assigneeId, sort, segment,
  }), [approval, assigneeId, branchId, risk, search, segment, sla, sort, stage])

  const load = useCallback(async (append = false) => {
    append ? setLoadingMore(true) : setLoading(true)
    setError('')
    try {
      const response = await listContractRenewalCases({ ...listInput, cursor: append ? data?.nextCursor : null })
      setData(response)
      setRows((current) => append ? [...current, ...response.rows] : response.rows)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Không thể tải hàng đợi tái ký.') }
    finally { setLoading(false); setLoadingMore(false) }
  }, [data?.nextCursor, listInput])

  useEffect(() => {
    const timeout = window.setTimeout(() => { void load(false) }, 280)
    return () => window.clearTimeout(timeout)
  // load intentionally changes when the server-side filter changes.
  }, [listInput])

  useEffect(() => {
    let active = true
    void listRenewalMessageTemplates().then((result) => { if (active) setMessageTemplates(result.templates) })
      .catch(() => { if (active) setTemplateError('Chưa thể tải thư viện kịch bản. Hãy thử làm mới trang.') })
    return () => { active = false }
  }, [])

  useEffect(() => { setSelectedCaseIds(new Set()) }, [listInput])

  const openDetail = useCallback(async (caseId: string) => {
    setSelectedCaseId(caseId); setDetailLoading(true); setError('')
    try { setDetail(await getContractRenewalCaseDetail(caseId)) }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Không thể tải chi tiết hồ sơ.') }
    finally { setDetailLoading(false) }
  }, [])

  const reloadDetailAndList = useCallback(async () => {
    await load(false)
    if (selectedCaseId) await openDetail(selectedCaseId)
  }, [load, openDetail, selectedCaseId])

  useEffect(() => {
    if (tab !== 'calendar') return
    const today = vietnamToday()
    setLoading(true)
    void listRenewalCalendar({ from: today, to: addDays(today, 45) }).then((result) => setCalendarItems(result.items)).catch((cause) => setError(cause instanceof Error ? cause.message : 'Không thể tải lịch chăm sóc.')).finally(() => setLoading(false))
  }, [tab])

  const loadReport = useCallback(async () => {
    setLoading(true); setError('')
    try { setAnalytics(await getRenewalAnalytics({ from: reportFrom, to: reportTo })) }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Không thể tải báo cáo tái ký.') }
    finally { setLoading(false) }
  }, [reportFrom, reportTo])

  useEffect(() => { if (tab === 'report') void loadReport() }, [loadReport, tab])

  const syncQueue = async () => {
    if (data?.scope !== 'system') { await load(false); return }
    setSyncing(true); setError(''); setNotice('')
    try {
      const result = await refreshContractRenewalQueue(true)
      setNotice(`Đã đối chiếu ${result.contractsScanned} hợp đồng · ${result.plannedWrites} hồ sơ được cập nhật.`)
      await load(false)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Không thể đồng bộ hàng đợi.') }
    finally { setSyncing(false) }
  }

  const selectSegment = (nextSegment: RenewalSegment) => {
    setTab('queue')
    setSegment(nextSegment)
    setSearch('')
    setRisk('all')
    setStage('all')
    setSla('all')
    setApproval('all')
    setBranchId('all')
    setAssigneeId('all')
    setSort('priority')
    setFiltersOpen(false)
    window.setTimeout(() => document.getElementById('renewal-queue-results')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80)
  }

  const selectPipelineStage = (nextStage: RenewalStage) => {
    setTab('queue')
    setSegment('all')
    setSearch('')
    setRisk('all')
    setStage(nextStage)
    setSla('all')
    setApproval('all')
    setBranchId('all')
    setAssigneeId('all')
    setSort('priority')
    window.setTimeout(() => document.getElementById('renewal-queue-results')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80)
  }

  const toggleCaseSelection = (caseId: string) => setSelectedCaseIds((current) => {
    const next = new Set(current)
    next.has(caseId) ? next.delete(caseId) : next.add(caseId)
    return next
  })
  const selectedRows = rows.filter((row) => selectedCaseIds.has(row.caseId))
  const permissions = data?.permissions ?? pendingPermissions

  useEffect(() => {
    if (data && !data.permissions.canViewAnalytics && tab === 'report') setTab('queue')
  }, [data, tab])

  const tabs: Array<{ id: WorkspaceTab; label: string; icon: typeof ListFilter }> = [
    { id: 'queue', label: 'Hàng đợi', icon: ListFilter }, { id: 'pipeline', label: 'Pipeline', icon: KanbanSquare },
    { id: 'calendar', label: 'Lịch chăm sóc', icon: CalendarDays },
    ...(permissions.canViewAnalytics ? [{ id: 'report' as const, label: 'Báo cáo', icon: BarChart3 }] : []),
  ]

  const scopeLabel = data?.audience === 'trainer'
    ? 'HỌC VIÊN PT ĐƯỢC PHÂN CÔNG'
    : data?.scope === 'system' ? 'TOÀN HỆ THỐNG' : data?.scope === 'branch' ? 'THEO CHI NHÁNH' : 'HỒ SƠ SALES CỦA TÔI'

  return <div className="renewal-page">
    <header className="renewal-hero">
      <div className="renewal-hero__copy"><span><Sparkles size={15} /> AURA RETENTION OS · {scopeLabel}</span><h1>Tái ký chủ động, không bỏ quên học viên</h1><p>{data?.audience === 'trainer' ? 'Theo dõi học viên PT chính, PT phụ hoặc dinh dưỡng được phân công; ghi nhận chăm sóc và chuyển tín hiệu quan tâm cho Sales.' : 'Ưu tiên theo hạn hợp đồng, số buổi, SLA và giá trị; mọi tương tác, báo giá, phê duyệt và khoản thu đều có lịch sử.'}</p></div>
      <button type="button" onClick={() => void syncQueue()} disabled={syncing || loading} className="renewal-refresh"><RefreshCw size={17} className={syncing ? 'is-spinning' : ''} /><span>{data?.scope === 'system' ? 'Đồng bộ hàng đợi' : 'Làm mới'}</span></button>
      <KpiCarousel data={data} activeSegment={segment} onSelect={selectSegment} />
    </header>

    <nav className="renewal-workspace-tabs" aria-label="Không gian tái ký">
      {tabs.map(({ id, label, icon: Icon }) => <button key={id} type="button" className={tab === id ? 'is-active' : ''} onClick={() => setTab(id)}><Icon size={17} /><span>{label}</span>{id === 'queue' && <b>{data?.stats.total ?? 0}</b>}</button>)}
    </nav>

    {error && <div className="renewal-error" role="alert"><AlertTriangle size={18} /><span>{error}</span><button onClick={() => setError('')}>Đóng</button></div>}
    {notice && <div className="renewal-success" role="status"><CheckCircle2 size={18} /><span>{notice}</span><button onClick={() => setNotice('')}>Đóng</button></div>}

    {tab === 'queue' && <>
      <RenewalFilters data={data} permissions={permissions} search={search} setSearch={setSearch} risk={risk} setRisk={setRisk} stage={stage} setStage={setStage} sla={sla} setSla={setSla} approval={approval} setApproval={setApproval} branchId={branchId} setBranchId={setBranchId} assigneeId={assigneeId} setAssigneeId={setAssigneeId} sort={sort} setSort={setSort} segment={segment} setSegment={setSegment} open={filtersOpen} setOpen={setFiltersOpen} />
      <QueueView rows={rows} loading={loading} permissions={permissions} selectedCaseIds={selectedCaseIds} onToggleSelection={toggleCaseSelection} onSelectAll={(checked) => setSelectedCaseIds(checked ? new Set(rows.slice(0, 20).map((row) => row.caseId)) : new Set())} onTransfer={() => setTransferOpen(true)} onOpen={openDetail} onRenew={setRenewing} />
      {data?.hasMore && <button type="button" className="renewal-load-more" disabled={loadingMore} onClick={() => void load(true)}>{loadingMore ? <LoaderCircle className="is-spinning" /> : <ChevronDown />} Tải thêm hồ sơ</button>}
    </>}
    {tab === 'pipeline' && <PipelineView rows={rows} loading={loading} showFinancials={permissions.canViewFinancials} stageCounts={data?.stats.stageCounts || null} onViewStage={selectPipelineStage} onOpen={openDetail} />}
    {tab === 'calendar' && <CalendarView items={calendarItems} loading={loading} showFinancials={permissions.canViewFinancials} onOpen={openDetail} />}
    {tab === 'report' && permissions.canViewAnalytics && <ReportView analytics={analytics} loading={loading} from={reportFrom} to={reportTo} setFrom={setReportFrom} setTo={setReportTo} onReload={loadReport} />}

    {data?.scope !== 'self' && <button type="button" className="renewal-student-shortcut" onClick={() => onNavigate?.('admin-pt-students')}><UsersRound size={17} /> Mở danh sách học viên</button>}

    {selectedCaseId && <CaseInspector detail={detail} loading={detailLoading} options={data?.options || null} permissions={permissions} messageTemplates={messageTemplates} templateError={templateError} onClose={() => { setSelectedCaseId(null); setDetail(null) }} onReload={reloadDetailAndList} onRenew={(row) => setRenewing(row)} />}
    {transferOpen && data && <LeadTransferDialog rows={selectedRows} assignees={data.options.assignees} onClose={() => setTransferOpen(false)} onSuccess={async (count) => { setTransferOpen(false); setSelectedCaseIds(new Set()); setNotice(`Đã bàn giao ${count} hồ sơ và ghi lịch sử vận hành.`); await load(false) }} />}
    {renewing && data && permissions.canRenewContract && <RenewContractModal row={renewing} options={data.options} scope={data.scope} onClose={() => setRenewing(null)} onSuccess={async () => { setRenewing(null); setSelectedCaseId(null); setDetail(null); setNotice('Tái ký thành công. Hợp đồng, khoản thu và pipeline đã được cập nhật.'); await load(false) }} />}
  </div>
}

function KpiCarousel({ data, activeSegment, onSelect }: { data: RenewalPipelineResponse | null; activeSegment: 'all' | RenewalSegment; onSelect: (segment: RenewalSegment) => void }) {
  const cards = [
    { segment: 'expiring_30d', icon: CalendarDays, eyebrow: '30 NGÀY TỚI', hint: 'Còn buổi và sắp đến hạn', tone: 'expiring' },
    { segment: 'exhausted_active', icon: AlertTriangle, eyebrow: 'CẦN NỐI GÓI', hint: 'Đã hết buổi nhưng hợp đồng còn hạn', tone: 'exhausted' },
    { segment: 'expired_last_30d', icon: History, eyebrow: '30 NGÀY QUA', hint: 'Ưu tiên phục hồi kết nối', tone: 'expired' },
    { segment: 'in_care', icon: UserRoundCheck, eyebrow: 'ĐANG THEO ĐUỔI', hint: 'Đã liên hệ đến bước follow-up', tone: 'care' },
  ] satisfies Array<{ segment: RenewalSegment; icon: typeof CalendarDays; eyebrow: string; hint: string; tone: string }>
  return <div className="renewal-kpis" aria-label="Nhóm hợp đồng tái ký">{cards.map(({ segment: cardSegment, icon: Icon, eyebrow, hint, tone }, index) => {
    const active = activeSegment === cardSegment
    return <button key={cardSegment} type="button" aria-pressed={active} className={`renewal-focus-card renewal-focus-card--${tone} ${active ? 'is-active' : ''}`} onClick={() => onSelect(cardSegment)}>
      <span className="renewal-focus-card__index">0{index + 1}</span>
      <span className="renewal-focus-card__icon"><Icon /></span>
      <span className="renewal-focus-card__copy"><small>{eyebrow}</small><strong>{data?.stats.segmentCounts?.[cardSegment] ?? 0}</strong><b>{segmentLabels[cardSegment]}</b><em>{hint}</em></span>
      <span className="renewal-focus-card__action">{active ? 'Đang hiển thị' : 'Xem danh sách'} <ArrowRight /></span>
    </button>
  })}</div>
}

interface FilterProps {
  data: RenewalPipelineResponse | null; permissions: RenewalPermissions; search: string; setSearch: (value: string) => void
  risk: 'all' | RenewalRiskCategory; setRisk: (value: 'all' | RenewalRiskCategory) => void
  stage: 'all' | RenewalStage; setStage: (value: 'all' | RenewalStage) => void
  sla: 'all' | RenewalSlaStatus; setSla: (value: 'all' | RenewalSlaStatus) => void
  approval: 'all' | 'pending' | 'approved' | 'rejected' | 'consumed' | 'none'; setApproval: (value: 'all' | 'pending' | 'approved' | 'rejected' | 'consumed' | 'none') => void
  branchId: string; setBranchId: (value: string) => void; assigneeId: string; setAssigneeId: (value: string) => void
  sort: 'priority' | 'value' | 'follow_up'; setSort: (value: 'priority' | 'value' | 'follow_up') => void
  segment: 'all' | RenewalSegment; setSegment: (value: 'all' | RenewalSegment) => void
  open: boolean; setOpen: (value: boolean) => void
}
function RenewalFilters(props: FilterProps) {
  const activeCount = [props.segment, props.risk, props.stage, props.sla, props.branchId,
    ...(props.permissions.canViewFinancials ? [props.approval, props.assigneeId] : []),
  ].filter((value) => value !== 'all').length
  return <section id="renewal-queue-results" className={`renewal-filter-shell ${props.open ? 'is-open' : ''}`}>
    <div className="renewal-filter-primary"><label className="renewal-search"><Search size={18} /><input value={props.search} onChange={(event) => props.setSearch(event.target.value)} placeholder="Tìm tên, SĐT, email, gói tập…" /></label><button type="button" className={activeCount ? 'has-filter' : ''} onClick={() => props.setOpen(!props.open)}><Filter size={17} /> Bộ lọc {activeCount > 0 && <b>{activeCount}</b>} <ChevronDown size={15} /></button></div>
    {props.segment !== 'all' && <div className="renewal-active-segment"><span><Sparkles size={15} /> Đang xem: <strong>{segmentLabels[props.segment]}</strong></span><button type="button" onClick={() => props.setSegment('all')}>Xem tất cả <X size={14} /></button></div>}
    <div className="renewal-filter-fields">
      <label>Cảnh báo<select value={props.risk} onChange={(event) => props.setRisk(event.target.value as typeof props.risk)}><option value="all">Tất cả</option>{Object.entries(riskLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label>Giai đoạn<select value={props.stage} onChange={(event) => props.setStage(event.target.value as typeof props.stage)}><option value="all">Tất cả</option>{stageOrder.map((value) => <option key={value} value={value}>{stageLabels[value]}</option>)}</select></label>
      <label>SLA<select value={props.sla} onChange={(event) => props.setSla(event.target.value as typeof props.sla)}><option value="all">Tất cả</option>{Object.entries(slaLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      {props.permissions.canViewFinancials && <label>Phê duyệt<select value={props.approval} onChange={(event) => props.setApproval(event.target.value as typeof props.approval)}><option value="all">Tất cả</option><option value="pending">Chờ duyệt</option><option value="approved">Đã duyệt</option><option value="rejected">Từ chối</option><option value="consumed">Đã sử dụng</option><option value="none">Chưa có yêu cầu</option></select></label>}
      <label>Chi nhánh<select value={props.branchId} onChange={(event) => props.setBranchId(event.target.value)}><option value="all">Tất cả</option>{props.data?.options.branches.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      {props.permissions.canViewFinancials && <label>Phụ trách<select value={props.assigneeId} onChange={(event) => props.setAssigneeId(event.target.value)}><option value="all">Tất cả</option>{props.data?.options.assignees.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
      <label>Sắp xếp<select value={props.sort} onChange={(event) => props.setSort(event.target.value as typeof props.sort)}><option value="priority">Ưu tiên SLA</option>{props.permissions.canViewFinancials && <option value="value">Giá trị cao</option>}<option value="follow_up">Hẹn gần nhất</option></select></label>
      <button type="button" className="renewal-clear-filter" onClick={() => { props.setSegment('all'); props.setRisk('all'); props.setStage('all'); props.setSla('all'); props.setApproval('all'); props.setBranchId('all'); props.setAssigneeId('all') }}>Xóa lọc</button>
    </div>
  </section>
}

function QueueView({ rows, loading, permissions, selectedCaseIds, onToggleSelection, onSelectAll, onTransfer, onOpen, onRenew }: {
  rows: RenewalPipelineRow[]; loading: boolean; permissions: RenewalPermissions; selectedCaseIds: Set<string>
  onToggleSelection: (caseId: string) => void; onSelectAll: (checked: boolean) => void; onTransfer: () => void
  onOpen: (id: string) => void; onRenew: (row: RenewalPipelineRow) => void
}) {
  if (loading) return <LoadingState label="Đang xếp ưu tiên theo SLA…" />
  if (!rows.length) return <EmptyState />
  const canTransfer = permissions.canAssign
  const canRenew = permissions.canRenewContract
  const selectedCount = selectedCaseIds.size
  return <section className="renewal-queue-panel"><header><div><h2>Hàng đợi ưu tiên</h2><p>{rows.length} hồ sơ đang hiển thị · dữ liệu lọc tại server</p></div><div className="renewal-queue-tools"><span><BadgeCheck size={15} /> Canonical</span>{canTransfer && selectedCount > 0 && <button type="button" onClick={onTransfer}><UserRoundPlus size={16} /> Bàn giao {selectedCount} lead</button>}</div></header>
    {canTransfer && selectedCount > 0 && <div className="renewal-selection-bar"><span><CheckCircle2 size={16} /><strong>{selectedCount} hồ sơ đã chọn</strong><small>Tối đa 20 hồ sơ mỗi lần bàn giao</small></span><button type="button" onClick={() => onSelectAll(false)}>Bỏ chọn</button></div>}
    <div className="renewal-table-wrap"><table className="renewal-table"><thead><tr>{canTransfer && <th className="renewal-select-cell"><input type="checkbox" aria-label="Chọn các hồ sơ đang hiển thị" checked={rows.length > 0 && rows.slice(0, 20).every((row) => selectedCaseIds.has(row.caseId))} onChange={(event) => onSelectAll(event.target.checked)} /></th>}<th>Học viên</th><th>Hợp đồng</th><th>Cảnh báo</th><th>Phụ trách</th><th>Giai đoạn</th><th>SLA / hẹn</th>{permissions.canViewFinancials && <th>Giá trị</th>}<th /></tr></thead><tbody>{rows.map((row) => <tr key={row.caseId} className={selectedCaseIds.has(row.caseId) ? 'is-selected' : ''} onClick={() => onOpen(row.caseId)}>{canTransfer && <td className="renewal-select-cell"><input type="checkbox" aria-label={`Chọn ${row.student.name}`} checked={selectedCaseIds.has(row.caseId)} onClick={(event) => event.stopPropagation()} onChange={() => onToggleSelection(row.caseId)} /></td>}<td><div className="renewal-member-cell"><i>{row.student.name.trim().charAt(0).toUpperCase() || 'A'}</i><span><strong>{row.student.name}</strong><small>{row.student.phone || row.student.email || 'Chưa có liên hệ'}</small></span></div></td><td><strong>{row.contract.packageName}</strong><small>{row.contract.usedSessions}/{row.contract.totalSessions} buổi · đến {formatDate(row.contract.endDate)}</small></td><td><span className={`renewal-risk renewal-risk--${row.risk.category}`}>{riskLabels[row.risk.category]}</span><small>{riskSummary(row)}</small></td><td><strong>{row.assignedSalesName}</strong><small>{row.branchName}</small></td><td><span className={`renewal-stage renewal-stage--${row.stage}`}>{stageLabels[row.stage]}</span></td><td><span className={`renewal-sla renewal-sla--${row.slaStatus}`}>{slaLabels[row.slaStatus]}</span><small>{formatDate(row.nextActionAt || row.slaDueAt)}</small></td>{permissions.canViewFinancials && <td><strong>{money(row.expectedValue)}</strong><small>{Math.round(row.probability * 100)}% xác suất</small></td>}<td><button type="button" onClick={(event) => { event.stopPropagation(); canRenew ? onRenew(row) : onOpen(row.caseId) }}>{canRenew ? 'Tái ký' : 'Chăm sóc'} <ChevronRight size={15} /></button></td></tr>)}</tbody></table></div>
    <div className="renewal-mobile-list">{rows.map((row) => <RenewalMobileCard key={row.caseId} row={row} selectable={canTransfer} selected={selectedCaseIds.has(row.caseId)} showFinancials={permissions.canViewFinancials} canRenew={canRenew} onToggleSelection={onToggleSelection} onOpen={onOpen} onRenew={onRenew} />)}</div>
  </section>
}

function RenewalMobileCard({ row, selectable, selected, showFinancials, canRenew, onToggleSelection, onOpen, onRenew }: { row: RenewalPipelineRow; selectable: boolean; selected: boolean; showFinancials: boolean; canRenew: boolean; onToggleSelection: (id: string) => void; onOpen: (id: string) => void; onRenew: (row: RenewalPipelineRow) => void }) {
  return <article className={`renewal-mobile-card renewal-mobile-card--${row.slaStatus} ${selectable ? 'is-selectable' : ''} ${selected ? 'is-selected' : ''}`} onClick={() => onOpen(row.caseId)}><header>{selectable && <label className="renewal-mobile-select" onClick={(event) => event.stopPropagation()}><input type="checkbox" aria-label={`Chọn ${row.student.name}`} checked={selected} onChange={() => onToggleSelection(row.caseId)} /></label>}<i>{row.student.name.trim().charAt(0).toUpperCase() || 'A'}</i><div><strong>{row.student.name}</strong><span>{row.student.phone || 'Chưa có SĐT'} · {row.branchName}</span></div><span className={`renewal-risk renewal-risk--${row.risk.category}`}>{riskLabels[row.risk.category]}</span></header><div className="renewal-mobile-contract"><div><span>{row.contract.packageName}</span><strong>{riskSummary(row)}</strong></div><i><b style={{ width: `${Math.min(100, row.contract.totalSessions ? row.contract.usedSessions / row.contract.totalSessions * 100 : 0)}%` }} /></i><small>{row.contract.usedSessions}/{row.contract.totalSessions} buổi{showFinancials ? ` · ${money(row.expectedValue)}` : ''}</small></div><footer><span className={`renewal-sla renewal-sla--${row.slaStatus}`}>{slaLabels[row.slaStatus]} · {formatDate(row.nextActionAt || row.slaDueAt)}</span><button type="button" onClick={(event) => { event.stopPropagation(); canRenew ? onRenew(row) : onOpen(row.caseId) }}>{canRenew ? 'Tái ký' : 'Chăm sóc'} <ArrowRight size={14} /></button></footer></article>
}

function PipelineView({ rows, loading, showFinancials, stageCounts, onViewStage, onOpen }: { rows: RenewalPipelineRow[]; loading: boolean; showFinancials: boolean; stageCounts: Record<RenewalStage, number> | null; onViewStage: (stage: RenewalStage) => void; onOpen: (id: string) => void }) {
  if (loading) return <LoadingState label="Đang tải pipeline…" />
  return <section className="renewal-pipeline"><header><div><h2>Pipeline chăm sóc</h2><p>Số trên tiêu đề lấy từ toàn bộ dữ liệu server; thẻ bên dưới là nhóm đang tải.</p></div><KanbanSquare /></header><div className="renewal-kanban">{stageOrder.map((stage) => { const cases = rows.filter((row) => row.stage === stage); const total = stageCounts?.[stage] ?? cases.length; return <section key={stage} className={`renewal-kanban-column renewal-kanban-column--${stage}`}><header><span>{stageLabels[stage]}</span><b>{total}</b></header><div>{cases.length ? cases.map((row) => <button key={row.caseId} type="button" onClick={() => onOpen(row.caseId)}><strong>{row.student.name}</strong><span>{row.contract.packageName}</span><small><i className={`renewal-sla-dot renewal-sla-dot--${row.slaStatus}`} />{formatDate(row.nextActionAt || row.slaDueAt)}{showFinancials ? ` · ${money(row.expectedValue)}` : ''}</small></button>) : <p>Chưa có thẻ trong trang đang tải</p>}</div>{total > 0 && <footer><button type="button" onClick={() => onViewStage(stage)}>Xem toàn bộ {total} <ArrowRight size={14} /></button></footer>}</section> })}</div></section>
}

function CalendarView({ items, loading, showFinancials, onOpen }: { items: RenewalPipelineRow[]; loading: boolean; showFinancials: boolean; onOpen: (id: string) => void }) {
  if (loading) return <LoadingState label="Đang tải lịch chăm sóc…" />
  const groups = items.reduce<Record<string, RenewalPipelineRow[]>>((result, item) => { const key = item.nextActionAt || item.slaDueAt || 'unknown'; (result[key] ||= []).push(item); return result }, {})
  return <section className="renewal-calendar"><header><div><h2>45 ngày hành động tiếp theo</h2><p>Lịch này là nội bộ; hệ thống không tự gửi tin cho khách.</p></div><CalendarDays /></header>{Object.keys(groups).length ? <div className="renewal-agenda">{Object.entries(groups).sort(([left], [right]) => left.localeCompare(right)).map(([date, cases]) => <section key={date}><time dateTime={date}><strong>{formatDate(date)}</strong><span>{cases.length} việc</span></time><div>{cases.map((row) => <button key={row.caseId} type="button" onClick={() => onOpen(row.caseId)}><i className={`renewal-sla-dot renewal-sla-dot--${row.slaStatus}`} /><span><strong>{row.student.name}</strong><small>{stageLabels[row.stage]} · {row.assignedSalesName}</small></span>{showFinancials && <b>{money(row.expectedValue)}</b>}<ChevronRight size={16} /></button>)}</div></section>)}</div> : <EmptyState />}</section>
}

function ReportView({ analytics, loading, from, to, setFrom, setTo, onReload }: { analytics: RenewalAnalytics | null; loading: boolean; from: string; to: string; setFrom: (value: string) => void; setTo: (value: string) => void; onReload: () => Promise<void> }) {
  return <section className="renewal-report"><header><div><h2>Hiệu quả tái ký</h2><p>Phân biệt giá trị đã thắng, đã thu và pipeline có trọng số.</p></div><div><label>Từ<input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label><label>Đến<input type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label><button type="button" onClick={() => void onReload()}><RefreshCw size={16} /></button></div></header>{loading ? <LoadingState label="Đang tổng hợp báo cáo…" /> : analytics && <><div className="renewal-report-kpis"><article><Target /><span>Tỷ lệ chốt</span><strong>{Math.round(analytics.conversionRate * 100)}%</strong><small>{analytics.wonCases} thắng / {analytics.lostCases} mất</small></article><article><CircleDollarSign /><span>Giá trị tái ký</span><strong>{money(analytics.wonValue)}</strong><small>hợp đồng đã thắng</small></article><article><ClipboardCheck /><span>Tiền đã thu</span><strong>{money(analytics.collectedValue)}</strong><small>đối chiếu ledger</small></article><article><BarChart3 /><span>Pipeline trọng số</span><strong>{money(analytics.weightedPipelineValue)}</strong><small>{analytics.overdueCases} hồ sơ quá SLA</small></article></div><div className="renewal-report-grid"><section><h3>Hiệu suất phụ trách</h3>{analytics.assignees.length ? analytics.assignees.map((item) => <div className="renewal-assignee-row" key={item.id}><span><strong>{item.name}</strong><small>{item.won}/{item.total} tái ký</small></span><b>{money(item.value)}</b></div>) : <p>Chưa có dữ liệu trong kỳ.</p>}</section><section><h3>Lý do không tái ký</h3>{Object.keys(analytics.lostReasons).length ? Object.entries(analytics.lostReasons).sort(([, left], [, right]) => right - left).map(([reason, count]) => <div className="renewal-reason-row" key={reason}><span>{reason}</span><b>{count}</b></div>) : <p>Chưa ghi nhận trường hợp thất bại.</p>}</section></div></>}</section>
}

function CaseInspector({ detail, loading, options, permissions, messageTemplates, templateError, onClose, onReload, onRenew }: { detail: RenewalCaseDetail | null; loading: boolean; options: RenewalPipelineResponse['options'] | null; permissions: RenewalPermissions; messageTemplates: RenewalMessageTemplate[]; templateError: string; onClose: () => void; onReload: () => Promise<void>; onRenew: (row: RenewalPipelineRow) => void }) {
  const [activityType, setActivityType] = useState<RenewalActivityType>('call')
  const [outcome, setOutcome] = useState<RenewalActivityOutcome>('connected')
  const [stage, setStage] = useState<RenewalStage>('contacted')
  const [nextActionAt, setNextActionAt] = useState('')
  const [note, setNote] = useState('')
  const [lostReason, setLostReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [localError, setLocalError] = useState('')
  const [messageOpen, setMessageOpen] = useState(false)
  const row = detail?.case
  const allowedStages = permissions.canCreateQuote ? editableStages : trainerEditableStages

  useEffect(() => {
    if (!row) return
    const suggestedStage = row.stage === 'won' || row.stage === 'lost' ? 'follow_up' : row.stage
    setStage(!permissions.canCreateQuote && !allowedStages.includes(suggestedStage) ? 'follow_up' : suggestedStage)
    setNextActionAt(row.nextActionAt || '')
    setNote(row.note || '')
  }, [permissions.canCreateQuote, row])

  const saveActivity = async () => {
    if (!row || !permissions.canRecordActivity) return
    if (stage === 'lost' && !lostReason.trim()) { setLocalError('Vui lòng ghi rõ lý do không tái ký.'); return }
    setSaving(true); setLocalError('')
    try { await recordContractRenewalActivity({ caseId: row.caseId, expectedRevision: row.revision, type: activityType, outcome, stage, nextActionAt: nextActionAt || null, note, lostReason }); await onReload() }
    catch (cause) { setLocalError(cause instanceof Error ? cause.message : 'Không thể lưu tương tác.') }
    finally { setSaving(false) }
  }

  const assign = async (assignedSalesId: string) => {
    if (!row) return
    setSaving(true); setLocalError('')
    try { await assignContractRenewalCase({ caseId: row.caseId, assignedSalesId, expectedRevision: row.revision }); await onReload() }
    catch (cause) { setLocalError(cause instanceof Error ? cause.message : 'Không thể phân công hồ sơ.') }
    finally { setSaving(false) }
  }

  const decide = async (decision: 'approved' | 'rejected') => {
    if (!detail?.approval?.id) return
    setSaving(true); setLocalError('')
    try { await decideRenewalApproval({ approvalId: detail.approval.id, decision, note: decision === 'approved' ? 'Đã kiểm tra chính sách và đồng ý.' : 'Không đáp ứng chính sách ưu đãi.' }); await onReload() }
    catch (cause) { setLocalError(cause instanceof Error ? cause.message : 'Không thể cập nhật phê duyệt.') }
    finally { setSaving(false) }
  }

  return <><div className="renewal-inspector-layer" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><aside className="renewal-inspector" role="dialog" aria-modal="true" aria-labelledby="renewal-inspector-title"><div className="renewal-inspector__handle" /><header><div><span>HỒ SƠ TÁI KÝ</span><h2 id="renewal-inspector-title">{row?.student.name || 'Đang tải…'}</h2><p>{row ? `${row.student.phone || 'Chưa có SĐT'} · ${row.branchName}` : 'Đang đối chiếu dữ liệu'}</p></div><button type="button" onClick={onClose}><X /></button></header>{loading || !row ? <LoadingState label="Đang tải lịch sử hồ sơ…" /> : <div className="renewal-inspector-body">
    <section className="renewal-inspector-summary"><div><span>Hợp đồng</span><strong>{row.contract.packageName}</strong><small>{row.contract.usedSessions}/{row.contract.totalSessions} buổi · {riskSummary(row)}</small></div><div><span>Pipeline</span><strong>{stageLabels[row.stage]}</strong><small>{permissions.canViewFinancials ? `${money(row.expectedValue)} · ${Math.round(row.probability * 100)}%` : 'Tiến độ chăm sóc học viên'}</small></div><div><span>SLA</span><strong className={`is-${row.slaStatus}`}>{slaLabels[row.slaStatus]}</strong><small>{formatDate(row.nextActionAt || row.slaDueAt)}</small></div></section>
    {!permissions.canCreateQuote && <section className="renewal-trainer-guidance"><UserRoundCheck /><div><strong>Vai trò HLV chăm sóc</strong><span>Bạn có thể liên hệ, ghi nhận nhu cầu và hẹn chăm sóc. Báo giá, khoản thu và hoàn tất tái ký được chuyển cho Sales.</span></div></section>}
    <section className="renewal-inspector-actions"><button type="button" disabled={!row.student.phone} onClick={() => setMessageOpen(true)}><BookOpenText size={16} /> Kịch bản chăm sóc</button><button type="button" disabled={!row.student.phone} onClick={() => window.location.href = `tel:${row.student.phone}`}><Phone size={16} /> Gọi điện</button>{permissions.canRenewContract && <button type="button" className="is-primary" onClick={() => onRenew(row)}>Tạo tái ký <ArrowRight size={16} /></button>}</section>
    {permissions.canAssign && options && <label className="renewal-assignment">Nhân viên phụ trách<select disabled={saving} value={row.assignedSalesId} onChange={(event) => void assign(event.target.value)}><option value="">Chưa phân công</option>{options.assignees.filter((item) => item.branchIds.includes(row.branchId)).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
    {detail.approval?.status === 'pending' && permissions.canApprove && <section className="renewal-pending-approval"><BadgeCheck /><div><strong>Chờ duyệt ưu đãi</strong><span>{String(detail.approval.reason || 'Không có lý do')}</span></div><button type="button" disabled={saving} onClick={() => void decide('rejected')}>Từ chối</button><button type="button" className="is-primary" disabled={saving} onClick={() => void decide('approved')}>Duyệt</button></section>}
    <section className="renewal-activity-form"><div className="renewal-section-title"><span><Send size={15} /></span><div><h3>Ghi nhận tương tác</h3><p>Không tự gửi ra ngoài; chỉ lưu hoạt động nội bộ.</p></div></div><div className="renewal-form-grid"><label>Kênh<select value={activityType} onChange={(event) => setActivityType(event.target.value as RenewalActivityType)}><option value="call">Cuộc gọi</option><option value="zalo">Zalo</option><option value="meeting">Gặp trực tiếp</option><option value="note">Ghi chú</option></select></label><label>Kết quả<select value={outcome} onChange={(event) => setOutcome(event.target.value as RenewalActivityOutcome)}><option value="connected">Đã kết nối</option><option value="no_answer">Không nghe máy</option><option value="interested">Quan tâm</option><option value="not_interested">Chưa quan tâm</option><option value="quote_requested">Muốn nhận báo giá</option><option value="other">Khác</option></select></label><label>Giai đoạn<select value={stage} onChange={(event) => setStage(event.target.value as RenewalStage)}>{allowedStages.map((item) => <option key={item} value={item}>{stageLabels[item]}</option>)}</select></label><label>Hành động tiếp theo<input type="date" value={nextActionAt} onChange={(event) => setNextActionAt(event.target.value)} /></label></div>{stage === 'lost' && <label>Lý do không tái ký<input value={lostReason} onChange={(event) => setLostReason(event.target.value)} maxLength={200} /></label>}<label>Ghi chú<textarea value={note} onChange={(event) => setNote(event.target.value)} maxLength={500} /></label><button type="button" className="is-primary" disabled={saving || !permissions.canRecordActivity} onClick={() => void saveActivity()}>{saving ? <LoaderCircle className="is-spinning" /> : <Send />} Lưu tương tác</button></section>
    {localError && <div className="renewal-modal-error"><AlertTriangle />{localError}</div>}
    <section className="renewal-history"><h3><History size={17} /> Lịch sử hoạt động</h3>{detail.activities.length ? detail.activities.map((item) => <article key={item.id}><i /><div><strong>{activityLabel(String(item.type || 'note'))}</strong><span>{item.note || stageLabels[item.afterStage || 'uncontacted']}</span><small>{item.createdAt ? new Date(item.createdAt).toLocaleString('vi-VN') : 'Vừa cập nhật'}</small></div></article>) : <p>Chưa có tương tác nào được ghi nhận.</p>}</section>
    {detail.upcomingSessions.length > 0 && <section className="renewal-upcoming"><h3><CalendarDays size={17} /> Buổi PT sắp tới</h3>{detail.upcomingSessions.map((item) => <div key={item.id}><span>{formatDate(item.date)} · {String(item.hour).padStart(2, '0')}:00</span><b>{item.status}</b></div>)}</section>}
  </div>}</aside></div>{messageOpen && row && <RenewalMessageDrawer row={row} templates={messageTemplates} loadError={templateError} onClose={() => setMessageOpen(false)} onRecorded={async () => { setMessageOpen(false); await onReload() }} />}</>
}

function segmentForRow(row: RenewalPipelineRow): RenewalSegment {
  if (row.risk.daysLeft < 0 && row.risk.daysLeft >= -30) return 'expired_last_30d'
  if (row.risk.sessionsLeft <= 0 && row.risk.daysLeft > 0) return 'exhausted_active'
  if (row.risk.daysLeft >= 0 && row.risk.daysLeft <= 30) return 'expiring_30d'
  return 'in_care'
}

function personalizeRenewalMessage(template: RenewalMessageTemplate, row: RenewalPipelineRow) {
  const variables: Record<string, string> = {
    studentName: row.student.name,
    packageName: row.contract.packageName,
    daysLeft: String(Math.max(0, row.risk.daysLeft)),
    sessionsLeft: String(Math.max(0, row.risk.sessionsLeft)),
    endDate: formatDate(row.contract.endDate),
    staffName: row.assignedSalesName && row.assignedSalesId ? row.assignedSalesName : 'đội ngũ Aura',
    branchName: row.branchName,
    nextActionDate: formatDate(row.nextActionAt || row.slaDueAt),
  }
  return Object.entries(variables).reduce((message, [key, value]) => message.replaceAll(`{{${key}}}`, value), template.body)
}

function RenewalMessageDrawer({ row, templates, loadError, onClose, onRecorded }: { row: RenewalPipelineRow; templates: RenewalMessageTemplate[]; loadError: string; onClose: () => void; onRecorded: () => Promise<void> }) {
  const recommendedSegment = segmentForRow(row)
  const orderedTemplates = useMemo(() => [...templates].sort((left, right) => {
    const score = (item: RenewalMessageTemplate) => Number(item.recommendedSegments.includes(recommendedSegment)) * 2 + Number(item.recommendedStages.includes(row.stage))
    return score(right) - score(left) || left.name.localeCompare(right.name, 'vi')
  }), [recommendedSegment, row.stage, templates])
  const [selectedId, setSelectedId] = useState('')
  const [draft, setDraft] = useState('')
  const [copied, setCopied] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const selectedTemplate = orderedTemplates.find((item) => item.id === selectedId) || orderedTemplates[0]

  useEffect(() => {
    if (!selectedTemplate) return
    setSelectedId(selectedTemplate.id)
    setDraft(personalizeRenewalMessage(selectedTemplate, row))
    setCopied(false)
  }, [row, selectedTemplate?.id])

  const copyMessage = async () => {
    try { await navigator.clipboard.writeText(draft); setCopied(true); setError('') }
    catch { setError('Không thể sao chép tự động. Hãy chọn và sao chép nội dung trong khung xem trước.') }
  }

  const openAndRecord = async () => {
    if (!selectedTemplate || !row.student.phone || !draft.trim()) return
    openZalo(row, draft.trim())
    setSaving(true); setError('')
    try {
      await recordContractRenewalActivity({
        caseId: row.caseId, expectedRevision: row.revision, type: 'zalo', outcome: 'other',
        stage: row.stage === 'uncontacted' ? 'contacted' : row.stage,
        nextActionAt: row.nextActionAt || null,
        note: `Đã mở Zalo bằng kịch bản: ${selectedTemplate.name}`,
      })
      await onRecorded()
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Đã mở Zalo nhưng chưa thể ghi lịch sử tương tác.'); setSaving(false) }
  }

  return <div className="renewal-message-layer" onMouseDown={(event) => event.target === event.currentTarget && !saving && onClose()}><aside className="renewal-message-drawer" role="dialog" aria-modal="true" aria-labelledby="renewal-message-title"><div className="renewal-inspector__handle" /><header><div><span><BookOpenText size={15} /> THƯ VIỆN KỊCH BẢN AURA</span><h2 id="renewal-message-title">Chăm sóc {row.student.name}</h2><p>Chọn mẫu phù hợp, kiểm tra nội dung cá nhân hóa rồi chủ động gửi.</p></div><button type="button" onClick={onClose} disabled={saving} aria-label="Đóng thư viện kịch bản"><X /></button></header>
    {loadError && !templates.length ? <div className="renewal-modal-error"><AlertTriangle />{loadError}</div> : <div className="renewal-message-layout"><section className="renewal-template-list"><h3>Mẫu đề xuất <span>{orderedTemplates.length}</span></h3>{orderedTemplates.map((template) => { const recommended = template.recommendedSegments.includes(recommendedSegment) || template.recommendedStages.includes(row.stage); return <button key={template.id} type="button" className={selectedTemplate?.id === template.id ? 'is-active' : ''} onClick={() => setSelectedId(template.id)}><span><strong>{template.name}</strong><small>{recommended ? 'Phù hợp hồ sơ này' : 'Mẫu tham khảo'}</small></span>{recommended && <Sparkles size={15} />}</button> })}</section><section className="renewal-message-preview"><div><span>Nội dung xem trước</span><small>{draft.length}/1000</small></div><textarea value={draft} maxLength={1000} rows={10} onChange={(event) => { setDraft(event.target.value); setCopied(false) }} /><p><AlertTriangle size={14} /> Aura không tự gửi tin. Nhân viên kiểm tra nội dung trước khi mở Zalo.</p></section></div>}
    {error && <div className="renewal-modal-error"><AlertTriangle />{error}</div>}
    <footer><button type="button" onClick={() => void copyMessage()} disabled={!draft.trim() || saving}><Copy size={16} /> {copied ? 'Đã sao chép' : 'Sao chép'}</button><button type="button" className="is-primary" onClick={() => void openAndRecord()} disabled={!selectedTemplate || !draft.trim() || !row.student.phone || saving}>{saving ? <LoaderCircle className="is-spinning" /> : <MessageCircle size={16} />} Mở Zalo & ghi nhận</button></footer>
  </aside></div>
}

function LeadTransferDialog({ rows, assignees, onClose, onSuccess }: { rows: RenewalPipelineRow[]; assignees: RenewalPipelineResponse['options']['assignees']; onClose: () => void; onSuccess: (count: number) => Promise<void> }) {
  const branchIds = useMemo(() => [...new Set(rows.map((row) => row.branchId))], [rows])
  const candidates = useMemo(() => assignees.filter((item) => branchIds.every((branchId) => item.branchIds.includes(branchId))), [assignees, branchIds])
  const [assignedSalesId, setAssignedSalesId] = useState('')
  const [reason, setReason] = useState('')
  const [nextActionAt, setNextActionAt] = useState(addDays(vietnamToday(), 1))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => { if (!assignedSalesId && candidates[0]) setAssignedSalesId(candidates[0].id) }, [assignedSalesId, candidates])

  const submit = async () => {
    if (!assignedSalesId || reason.trim().length < 3 || !rows.length) return
    setSaving(true); setError('')
    try {
      const result = await transferRenewalCases({ cases: rows.map((row) => ({ caseId: row.caseId, expectedRevision: row.revision })), assignedSalesId, reason: reason.trim(), nextActionAt: nextActionAt || null })
      await onSuccess(result.transferred)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Không thể bàn giao hồ sơ.'); setSaving(false) }
  }

  return <div className="renewal-modal-layer" onMouseDown={(event) => event.target === event.currentTarget && !saving && onClose()}><section className="renewal-handoff-dialog" role="dialog" aria-modal="true" aria-labelledby="renewal-handoff-title"><div className="renewal-modal__handle" /><header><div><span><UserRoundPlus size={15} /> BÀN GIAO LEAD TÁI KÝ</span><h2 id="renewal-handoff-title">Chuyển {rows.length} hồ sơ cho nhân viên</h2><p>Chỉ Sales đang hoạt động và phụ trách đủ chi nhánh đã chọn mới xuất hiện.</p></div><button type="button" onClick={onClose} disabled={saving} aria-label="Đóng"><X /></button></header><div className="renewal-handoff-body"><section className="renewal-handoff-summary"><strong>{rows.length} hồ sơ</strong><span>{branchIds.length} chi nhánh</span><small>{rows.slice(0, 4).map((row) => row.student.name).join(' · ')}{rows.length > 4 ? ` · +${rows.length - 4}` : ''}</small></section>{candidates.length ? <><label>Nhân viên nhận<select value={assignedSalesId} onChange={(event) => setAssignedSalesId(event.target.value)}>{candidates.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>Ngày xử lý tiếp theo<input type="date" min={vietnamToday()} value={nextActionAt} onChange={(event) => setNextActionAt(event.target.value)} /></label><label className="is-wide">Lý do và nội dung bàn giao<textarea rows={4} maxLength={300} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Ví dụ: Phân bổ lại workload, khách thuộc chi nhánh phụ trách…" /><small>{reason.length}/300</small></label></> : <div className="renewal-modal-error"><AlertTriangle />Không có Sales nào phụ trách đầy đủ các chi nhánh của nhóm hồ sơ này. Hãy chọn các hồ sơ cùng phạm vi hoặc cập nhật chức danh/chi nhánh tại Vai trò & Quyền.</div>}{error && <div className="renewal-modal-error"><AlertTriangle />{error}</div>}</div><footer><button type="button" onClick={onClose} disabled={saving}>Hủy</button><button type="button" className="is-primary" onClick={() => void submit()} disabled={saving || !candidates.length || !assignedSalesId || reason.trim().length < 3}>{saving ? <LoaderCircle className="is-spinning" /> : <UserRoundPlus size={16} />} Xác nhận bàn giao</button></footer></section></div>
}

function LoadingState({ label }: { label: string }) { return <div className="renewal-state"><LoaderCircle className="is-spinning" /><strong>{label}</strong><span>Vui lòng chờ trong giây lát.</span></div> }
function EmptyState() { return <div className="renewal-state"><CheckCircle2 /><strong>Không có hồ sơ phù hợp</strong><span>Hãy đổi bộ lọc hoặc đồng bộ lại hàng đợi.</span></div> }
function riskSummary(row: RenewalPipelineRow) { if (row.risk.daysLeft < 0) return `Quá hạn ${Math.abs(row.risk.daysLeft)} ngày`; if (row.risk.sessionsLeft <= 0) return `Hết buổi · còn ${row.risk.daysLeft} ngày`; return `Còn ${row.risk.daysLeft} ngày · ${row.risk.sessionsLeft} buổi` }
function activityLabel(type: string) { return ({ call: 'Cuộc gọi', zalo: 'Tin nhắn Zalo', meeting: 'Gặp trực tiếp', note: 'Ghi chú', stage_change: 'Đổi giai đoạn', assignment: 'Phân công', quote: 'Tạo báo giá', approval_submitted: 'Gửi phê duyệt', approval_decided: 'Duyệt ưu đãi', renewal_completed: 'Hoàn tất tái ký' } as Record<string, string>)[type] || 'Hoạt động hệ thống' }
