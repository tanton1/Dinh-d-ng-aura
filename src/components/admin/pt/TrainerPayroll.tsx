import { useCallback, useEffect, useMemo, useState } from 'react'
import type { User as FirebaseUser } from 'firebase/auth'
import {
  AlertTriangle,
  Banknote,
  CheckCircle2,
  ChevronRight,
  Clock3,
  FileCheck2,
  LockKeyhole,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  UsersRound,
  WalletCards,
  X,
} from 'lucide-react'
import type { UserProfile } from '../../../types'
import { useDatabase } from '../../../contexts/DatabaseContext'
import AuraMetricCarousel, { type AuraMetricSlide } from './AuraMetricCarousel'
import AuraHelpPopover from './AuraHelpPopover'
import {
  createPayrollRun,
  getPayrollRun,
  listPayrollPolicies,
  listPayrollRuns,
  lockPayrollRun,
  markPayrollRunPaid,
  reviewPayrollRun,
  savePayrollPolicy,
  type PayrollPolicy,
  type PayrollRunDetail,
  type PayrollRunStatus,
  type PayrollRunSummary,
} from '../../../services/payrollService'
import { listCashAccounts, type CashAccount } from '../../../services/cashbookService'
import '../../../styles-payroll-canonical.css'

interface Props {
  user: FirebaseUser | null
  profile: UserProfile | null
}

type PayrollView = 'runs' | 'policies'
type RunStatusFilter = 'all' | PayrollRunStatus

const statusMeta: Record<PayrollRunStatus, { label: string; hint: string }> = {
  draft: { label: 'Bản nháp', hint: 'Có thể kiểm tra trước khi gửi duyệt' },
  reviewed: { label: 'Đã duyệt', hint: 'Sẵn sàng khóa kỳ' },
  locked: { label: 'Đã khóa', hint: 'Đã ghi nhận chi phí, chưa giảm quỹ' },
  paid: { label: 'Đã chi', hint: 'Đã tạo giao dịch sổ quỹ' },
}

function currentPeriod() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

function currentDateOnly() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
}

function money(value: unknown) {
  const amount = Number(value)
  return `${Math.round(Number.isFinite(amount) ? amount : 0).toLocaleString('vi-VN')}đ`
}

function periodLabel(value: string) {
  const match = /^(\d{4})-(\d{2})$/.exec(value)
  return match ? `Tháng ${Number(match[2])}/${match[1]}` : value || 'Chưa xác định'
}

function dateLabel(value: string) {
  if (!value) return 'Chưa xác định'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('vi-VN')
}

function friendlyError(cause: unknown) {
  const message = cause instanceof Error ? cause.message : ''
  if (/permission|unauth|quyền/i.test(message)) return 'Tài khoản chưa có quyền quản lý bảng lương.'
  if (/not found|internal|unavailable/i.test(message)) return 'Dịch vụ lương đang được cập nhật. Hãy tải lại sau ít phút.'
  return message || 'Không thể tải dữ liệu lương.'
}

export default function TrainerPayroll({ profile }: Props) {
  const { trainers, branches } = useDatabase()
  const [view, setView] = useState<PayrollView>('runs')
  const [runs, setRuns] = useState<PayrollRunSummary[]>([])
  const [policies, setPolicies] = useState<PayrollPolicy[]>([])
  const [cashAccounts, setCashAccounts] = useState<CashAccount[]>([])
  const [periodId, setPeriodId] = useState(currentPeriod)
  const [statusFilter, setStatusFilter] = useState<RunStatusFilter>('all')
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [busyAction, setBusyAction] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [detail, setDetail] = useState<PayrollRunDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [payoutAccountId, setPayoutAccountId] = useState('')
  const [payoutReference, setPayoutReference] = useState('')
  const [policyForm, setPolicyForm] = useState({
    name: 'Chính sách lương PT',
    effectiveFrom: currentDateOnly(),
    ratePerSession: '20000',
  })

  const canManage = profile?.role === 'admin' || profile?.role === 'super_admin'
  const trainerById = useMemo(() => new Map(trainers.map((trainer) => [trainer.id, trainer])), [trainers])
  const branchById = useMemo(() => new Map(branches.map((branch) => [branch.id, branch])), [branches])

  const refresh = useCallback(async () => {
    setLoading(true)
    setError('')
    const [runsResult, policiesResult, accountsResult] = await Promise.allSettled([
      listPayrollRuns(36),
      listPayrollPolicies(),
      listCashAccounts(),
    ])
    if (runsResult.status === 'fulfilled') setRuns(runsResult.value)
    if (policiesResult.status === 'fulfilled') setPolicies(policiesResult.value)
    if (accountsResult.status === 'fulfilled') {
      const activeAccounts = accountsResult.value.accounts.filter((account) => account.status === 'active')
      setCashAccounts(activeAccounts)
      setPayoutAccountId((current) => current || activeAccounts[0]?.id || '')
    }
    const failure = [runsResult, policiesResult, accountsResult].find((result) => result.status === 'rejected')
    if (failure?.status === 'rejected') setError(friendlyError(failure.reason))
    setLoading(false)
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  const openRun = useCallback(async (runId: string) => {
    setDetailLoading(true)
    setError('')
    try {
      setDetail(await getPayrollRun(runId))
    } catch (cause) {
      setError(friendlyError(cause))
    } finally {
      setDetailLoading(false)
    }
  }, [])

  const runAction = async (action: 'create' | 'review' | 'lock' | 'pay', run?: PayrollRunSummary) => {
    if (busyAction) return
    const key = `${action}:${run?.id || periodId}`
    setBusyAction(key)
    setMessage('')
    setError('')
    try {
      if (action === 'create') {
        if (!policies.some((policy) => policy.status === 'active')) {
          setView('policies')
          throw new Error('Hãy tạo chính sách lương có hiệu lực trước khi lập kỳ lương.')
        }
        const result = await createPayrollRun(periodId)
        setMessage(result.unchanged ? 'Kỳ lương này đã tồn tại; Aura không tạo trùng.' : 'Đã tạo bản nháp kỳ lương từ dữ liệu điểm danh chính thức.')
      } else if (action === 'review' && run) {
        await reviewPayrollRun(run.id)
        setMessage('Kỳ lương đã được chuyển sang trạng thái đã duyệt.')
      } else if (action === 'lock' && run) {
        await lockPayrollRun(run.id)
        setMessage('Đã khóa kỳ và ghi nhận chi phí lương. Tiền quỹ chưa bị giảm.')
      } else if (action === 'pay' && run) {
        if (!payoutAccountId || !payoutReference.trim()) throw new Error('Chọn quỹ và nhập mã chứng từ trước khi chi lương.')
        await markPayrollRunPaid({ runId: run.id, cashAccountId: payoutAccountId, paymentReference: payoutReference.trim() })
        setPayoutReference('')
        setMessage('Đã ghi nhận chi lương đồng thời vào sổ quỹ và sổ cái.')
      }
      await refresh()
      if (run?.id) await openRun(run.id)
    } catch (cause) {
      setError(friendlyError(cause))
    } finally {
      setBusyAction('')
    }
  }

  const submitPolicy = async () => {
    if (busyAction) return
    const ratePerSession = Number(policyForm.ratePerSession)
    if (!Number.isSafeInteger(ratePerSession) || ratePerSession < 1_000) {
      setError('Đơn giá buổi tập chưa hợp lệ.')
      return
    }
    setBusyAction('policy')
    setError('')
    setMessage('')
    try {
      const result = await savePayrollPolicy({ name: policyForm.name, effectiveFrom: policyForm.effectiveFrom, ratePerSession })
      setMessage(result.unchanged ? 'Chính sách này đã tồn tại.' : 'Đã lưu phiên bản chính sách mới; kỳ cũ không bị thay đổi.')
      await refresh()
    } catch (cause) {
      setError(friendlyError(cause))
    } finally {
      setBusyAction('')
    }
  }

  const selectedPeriodRun = runs.find((run) => run.periodId === periodId) || runs[0]
  const waitingRuns = runs.filter((run) => run.status === 'draft' || run.status === 'reviewed')
  const lockedAmount = runs.filter((run) => run.status === 'locked').reduce((sum, run) => sum + run.finalAmount, 0)
  const paidAmount = runs.filter((run) => run.status === 'paid').reduce((sum, run) => sum + run.finalAmount, 0)
  const adjustmentAmount = runs.reduce((sum, run) => sum + Math.abs(run.adjustmentAmount), 0)
  const availableCash = cashAccounts.reduce((sum, account) => sum + Number(account.balance || 0), 0)

  const slides: AuraMetricSlide[] = [
    { id: 'period-total', eyebrow: selectedPeriodRun ? periodLabel(selectedPeriodRun.periodId) : periodLabel(periodId), value: money(selectedPeriodRun?.finalAmount || 0), detail: selectedPeriodRun ? `${selectedPeriodRun.trainerCount} HLV · ${selectedPeriodRun.attendanceCount} lượt điểm danh` : 'Chưa lập kỳ lương chính thức', icon: <Banknote size={20} />, tone: 'pink', actionLabel: selectedPeriodRun ? 'Mở kỳ lương' : 'Thiết lập kỳ', onSelect: () => selectedPeriodRun ? void openRun(selectedPeriodRun.id) : setView(policies.length ? 'runs' : 'policies') },
    { id: 'waiting', eyebrow: 'Chờ xử lý', value: `${waitingRuns.length}`, detail: 'Kỳ nháp hoặc đang chờ khóa', icon: <Clock3 size={20} />, tone: 'orange', actionLabel: 'Lọc danh sách', onSelect: () => { setView('runs'); setStatusFilter(waitingRuns.some((run) => run.status === 'reviewed') ? 'reviewed' : 'draft') } },
    { id: 'locked', eyebrow: 'Đã khóa · chưa chi', value: money(lockedAmount), detail: 'Chi phí đã ghi nhận, chưa giảm số dư quỹ', icon: <LockKeyhole size={20} />, tone: 'sunset', actionLabel: 'Xem kỳ cần chi', onSelect: () => { setView('runs'); setStatusFilter('locked') } },
    { id: 'adjustments', eyebrow: 'Điều chỉnh', value: money(adjustmentAmount), detail: 'Thưởng, khấu trừ và correction đã duyệt', icon: <Settings2 size={20} />, tone: 'ink' },
    { id: 'cash', eyebrow: 'Quỹ có thể chi', value: money(availableCash), detail: `${cashAccounts.length} quỹ hoạt động · đã chi ${money(paidAmount)}`, icon: <WalletCards size={20} />, tone: 'pink' },
  ]

  const visibleRuns = useMemo(() => {
    const query = search.trim().toLowerCase()
    return runs.filter((run) => {
      if (statusFilter !== 'all' && run.status !== statusFilter) return false
      return !query || `${run.periodId} ${run.policyName} ${statusMeta[run.status].label}`.toLowerCase().includes(query)
    })
  }, [runs, search, statusFilter])

  return <div className="payroll-page">
    <AuraMetricCarousel slides={slides} label="Tổng quan bảng lương" loading={loading && runs.length === 0} />

    <div className="payroll-page__nav" role="tablist" aria-label="Quản lý lương">
      <button type="button" role="tab" aria-selected={view === 'runs'} className={view === 'runs' ? 'is-active' : ''} onClick={() => setView('runs')}><FileCheck2 size={17} /> Kỳ lương</button>
      <button type="button" role="tab" aria-selected={view === 'policies'} className={view === 'policies' ? 'is-active' : ''} onClick={() => setView('policies')}><Settings2 size={17} /> Chính sách</button>
      <AuraHelpPopover title="Cách tính lương" label="Cách tính lương"><p>Lương chính thức chỉ lấy từ điểm danh server. Khóa kỳ ghi nhận chi phí; thao tác chi trả sau đó mới làm giảm quỹ.</p></AuraHelpPopover>
    </div>

    {(message || error) && <div className={`payroll-page__notice ${error ? 'is-error' : 'is-success'}`} role="status">
      {error ? <AlertTriangle size={18} /> : <CheckCircle2 size={18} />}
      <span>{error || message}</span>
      <button type="button" aria-label="Đóng thông báo" onClick={() => { setError(''); setMessage('') }}><X size={16} /></button>
    </div>}

    {view === 'runs' ? <>
      <section className="payroll-page__toolbar" aria-label="Bộ lọc kỳ lương">
        <label><span>Kỳ</span><input aria-label="Kỳ lương" type="month" value={periodId} onChange={(event) => setPeriodId(event.target.value)} /></label>
        <label><span>Trạng thái</span><select aria-label="Lọc trạng thái kỳ lương" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as RunStatusFilter)}><option value="all">Tất cả</option>{Object.entries(statusMeta).map(([id, meta]) => <option key={id} value={id}>{meta.label}</option>)}</select></label>
        <label className="payroll-page__search"><span>Tìm kiếm</span><Search size={17} /><input aria-label="Tìm kỳ lương" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Tháng hoặc chính sách" /></label>
        <button className="payroll-page__refresh" type="button" aria-label="Tải lại" disabled={loading} onClick={() => void refresh()}><RefreshCw size={18} /></button>
        <button className="payroll-page__primary" type="button" disabled={!canManage || !!busyAction || !periodId} onClick={() => void runAction('create')}><Plus size={17} /> Tạo kỳ</button>
      </section>

      {!policies.length && !loading && <section className="payroll-page__setup"><ShieldCheck size={28} /><div><strong>Chưa có chính sách lương hiệu lực</strong><p>Tạo chính sách trước; Aura sẽ không tự đoán đơn giá hoặc dùng phép tính trong trình duyệt.</p></div><button type="button" onClick={() => setView('policies')}>Thiết lập ngay</button></section>}

      <section className="payroll-page__runs" aria-label="Danh sách kỳ lương">
        <div className="payroll-page__section-title"><div><span>Kỳ lương chính thức</span><strong>{visibleRuns.length} kỳ</strong></div><small>Nguồn: attendanceEvents</small></div>
        {loading && !runs.length ? <div className="payroll-page__skeleton" aria-label="Đang tải kỳ lương" /> : visibleRuns.length ? <div className="payroll-page__run-grid">
          {visibleRuns.map((run) => <article className="payroll-run-card" key={run.id}>
            <button className="payroll-run-card__open" type="button" onClick={() => void openRun(run.id)} aria-label={`Mở ${periodLabel(run.periodId)}`}>
              <div className="payroll-run-card__head"><div><span>{periodLabel(run.periodId)}</span><strong>{money(run.finalAmount)}</strong></div><em className={`is-${run.status}`}>{statusMeta[run.status].label}</em></div>
              <div className="payroll-run-card__metrics"><span><b>{run.trainerCount}</b> HLV</span><span><b>{run.attendanceCount}</b> buổi</span><span><b>{money(run.adjustmentAmount)}</b> điều chỉnh</span></div>
              <p>{run.policyName || `Chính sách v${run.policyVersion}`}<ChevronRight size={17} /></p>
            </button>
            <div className="payroll-run-card__actions">
              {run.status === 'draft' && <button type="button" disabled={!!busyAction} onClick={() => void runAction('review', run)}><FileCheck2 size={15} /> Gửi duyệt</button>}
              {run.status === 'reviewed' && <button type="button" disabled={!!busyAction} onClick={() => void runAction('lock', run)}><LockKeyhole size={15} /> Khóa kỳ</button>}
              {run.status === 'locked' && <button type="button" onClick={() => void openRun(run.id)}><WalletCards size={15} /> Chi lương</button>}
              {run.status === 'paid' && <span><CheckCircle2 size={15} /> Đã hoàn tất</span>}
            </div>
          </article>)}
        </div> : <div className="payroll-page__empty"><UsersRound size={34} /><strong>Chưa có kỳ lương phù hợp</strong><p>Chọn kỳ khác hoặc tạo bản nháp từ dữ liệu điểm danh chính thức.</p></div>}
      </section>
    </> : <section className="payroll-policy" aria-label="Chính sách lương">
      <div className="payroll-policy__form">
        <div className="payroll-page__section-title"><div><span>Phiên bản mới</span><strong>Chính sách lương PT</strong></div><AuraHelpPopover title="Nguyên tắc phiên bản" label="Nguyên tắc phiên bản"><p>Mỗi ngày hiệu lực chỉ có một chính sách. Chính sách cũ không bị sửa để giữ nguyên bảng lương lịch sử.</p></AuraHelpPopover></div>
        <div className="payroll-policy__fields"><label><span>Tên chính sách</span><input value={policyForm.name} maxLength={100} onChange={(event) => setPolicyForm((current) => ({ ...current, name: event.target.value }))} /></label><label><span>Hiệu lực từ</span><input type="date" value={policyForm.effectiveFrom} onChange={(event) => setPolicyForm((current) => ({ ...current, effectiveFrom: event.target.value }))} /></label><label><span>Đơn giá / buổi</span><input type="number" min="1000" step="1000" inputMode="numeric" value={policyForm.ratePerSession} onChange={(event) => setPolicyForm((current) => ({ ...current, ratePerSession: event.target.value }))} /></label><button className="payroll-page__primary" type="button" disabled={!canManage || !!busyAction} onClick={() => void submitPolicy()}><ShieldCheck size={17} /> Lưu phiên bản</button></div>
        <p className="payroll-policy__scope">Giai đoạn hiện tại áp dụng đơn giá theo buổi PT đã điểm danh. Lương cơ bản, hoa hồng Sales, phụ cấp dinh dưỡng và thưởng/khấu trừ sẽ được thêm dưới dạng policy scope và adjustment có duyệt, không tính tạm ở client.</p>
      </div>
      <div className="payroll-policy__history"><div className="payroll-page__section-title"><div><span>Lịch sử</span><strong>{policies.length} phiên bản</strong></div><small>Không ghi đè</small></div>{policies.length ? policies.map((policy) => <article key={policy.id}><div><strong>{policy.name}</strong><span>Hiệu lực {dateLabel(policy.effectiveFrom)} · v{policy.version}</span></div><b>{money(policy.ratePerSession)}<small>/buổi</small></b></article>) : <div className="payroll-page__empty"><Settings2 size={30} /><strong>Chưa có chính sách</strong><p>Hãy tạo phiên bản đầu tiên để lập kỳ lương.</p></div>}</div>
    </section>}

    {(detail || detailLoading) && <div className="payroll-drawer" role="dialog" aria-modal="true" aria-label="Chi tiết kỳ lương" onMouseDown={(event) => { if (event.target === event.currentTarget) setDetail(null) }}><section><header><div><span>Chi tiết kỳ lương</span><strong>{detail ? periodLabel(detail.run.periodId) : 'Đang tải…'}</strong></div><button type="button" aria-label="Đóng" onClick={() => setDetail(null)}><X size={21} /></button></header>{detailLoading && !detail ? <div className="payroll-page__skeleton" /> : detail && <><div className="payroll-drawer__summary"><div><span>Thực nhận</span><strong>{money(detail.run.finalAmount)}</strong></div><div><span>Điểm danh</span><strong>{detail.run.attendanceCount}</strong></div><div><span>Trạng thái</span><strong>{statusMeta[detail.run.status].label}</strong></div></div><p className="payroll-drawer__status"><ShieldCheck size={17} /> {statusMeta[detail.run.status].hint}</p><div className="payroll-drawer__items"><div className="payroll-page__section-title"><div><span>Chi tiết nhân sự</span><strong>{detail.items.length} HLV</strong></div><small>Đối chiếu attendanceEvents</small></div>{detail.items.map((item) => { const trainer = trainerById.get(item.trainerId); const name = item.trainerSnapshot?.name || trainer?.name || `HLV ${item.trainerId.slice(0, 6)}`; const branchId = item.trainerSnapshot?.branchId || trainer?.branchId || ''; return <article key={item.id}><div className="payroll-drawer__person"><span>{name.slice(0, 1).toUpperCase()}</span><div><strong>{name}</strong><small>{item.trainerSnapshot?.employeeCode || trainer?.employeeCode || 'Chưa có mã NV'} · {branchById.get(branchId)?.name || 'Chưa gắn chi nhánh'}</small></div></div><div className="payroll-drawer__numbers"><span>{item.sessionCount} buổi × {money(item.ratePerSession)}</span><strong>{money(item.finalAmount)}</strong></div></article> })}{!detail.items.length && <div className="payroll-page__empty"><UsersRound size={30} /><strong>Không có lượt điểm danh</strong><p>Kỳ này chưa phát sinh lương theo buổi.</p></div>}</div>{detail.run.status === 'locked' && <div className="payroll-drawer__payout"><div><strong>Ghi nhận chi lương</strong><p>Thao tác này giảm quỹ đúng một lần và lưu tham chiếu thanh toán.</p></div><label><span>Quỹ chi</span><select value={payoutAccountId} onChange={(event) => setPayoutAccountId(event.target.value)}><option value="">Chọn quỹ</option>{cashAccounts.map((account) => <option key={account.id} value={account.id}>{account.name} · {money(account.balance)}</option>)}</select></label><label><span>Mã chứng từ</span><input value={payoutReference} maxLength={200} placeholder="VD: UNC-202608-001" onChange={(event) => setPayoutReference(event.target.value)} /></label><button className="payroll-page__primary" type="button" disabled={!!busyAction || !payoutAccountId || !payoutReference.trim()} onClick={() => void runAction('pay', detail.run)}><WalletCards size={17} /> Xác nhận chi</button></div>}</>}</section></div>}
  </div>
}
