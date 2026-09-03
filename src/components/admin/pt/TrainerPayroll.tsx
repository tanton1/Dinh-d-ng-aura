import { useCallback, useEffect, useMemo, useState } from 'react'
import type { User as FirebaseUser } from 'firebase/auth'
import {
  AlertTriangle,
  Banknote,
  CalendarCheck2,
  CheckCircle2,
  ChevronRight,
  Clock3,
  FileCheck2,
  Eye,
  EyeOff,
  LockKeyhole,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
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
  deleteDraftPayrollRun,
  getPayrollRun,
  listPayrollPolicies,
  listPayrollRuns,
  lockPayrollRun,
  markPayrollRunPaid,
  managePayrollPolicy,
  reviewPayrollRun,
  savePayrollPolicy,
  type PayrollPolicy,
  type PayrollProfile,
  type PayrollPolicyApplicationMode,
  type PayrollRunDetail,
  type PayrollRunStatus,
  type PayrollRunSummary,
} from '../../../services/payrollService'
import { listCashAccounts, type CashAccount } from '../../../services/cashbookService'
import '../../../styles-payroll-canonical.css'
import StaffWorkdayPayrollPanel from './StaffWorkdayPayrollPanel'
import StaffPayrollStatementPanel from './StaffPayrollStatementPanel'
import {
  getStaffPayrollStatement,
  listStaffPayrollAttendance,
  type MyStaffPayroll,
  type StaffAttendanceRow,
} from '../../../services/staffPayrollService'

interface Props {
  user: FirebaseUser | null
  profile: UserProfile | null
}

type PayrollView = 'runs' | 'workdays' | 'policies'
type RunStatusFilter = 'all' | PayrollRunStatus
type PolicyApplicationMode = Exclude<PayrollPolicyApplicationMode, 'single'>
type PendingConfirmation =
  | { kind: 'delete-run'; id: string; label: string }
  | { kind: 'policy'; id: string; label: string; action: 'hide' | 'restore' | 'delete' }

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

function teachingTierLabel(tier: 'standard' | 'after_threshold' | 'after_threshold_evening') {
  if (tier === 'after_threshold_evening') return 'Tăng ca tối'
  if (tier === 'after_threshold') return 'Từ ca thứ 9'
  return 'Ca tiêu chuẩn'
}

function payrollProfileLabel(profile: PayrollProfile) {
  if (profile === 'probation') return 'Thử việc'
  if (profile === 'senior') return 'Senior'
  if (profile === 'part_time') return 'Part-time'
  if (profile === 'collaborator') return 'CTV'
  return 'Chính thức'
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
  const [expandedTrainerId, setExpandedTrainerId] = useState('')
  const [payoutAccountId, setPayoutAccountId] = useState('')
  const [payoutReference, setPayoutReference] = useState('')
  const [showRunSetup, setShowRunSetup] = useState(false)
  const [showPolicyForm, setShowPolicyForm] = useState(false)
  const [liveRows, setLiveRows] = useState<StaffAttendanceRow[]>([])
  const [liveAsOfDate, setLiveAsOfDate] = useState('')
  const [staffStatementId, setStaffStatementId] = useState('')
  const [staffStatement, setStaffStatement] = useState<MyStaffPayroll | null>(null)
  const [staffStatementLoading, setStaffStatementLoading] = useState(false)
  const [staffStatementError, setStaffStatementError] = useState('')
  const [selectedPolicyIds, setSelectedPolicyIds] = useState<string[]>([])
  const [defaultPolicyId, setDefaultPolicyId] = useState('')
  const [policyApplicationMode, setPolicyApplicationMode] = useState<PolicyApplicationMode>('trainer_assignment')
  const [trainerPolicyAssignments, setTrainerPolicyAssignments] = useState<Record<string, string>>({})
  const [pendingConfirmation, setPendingConfirmation] = useState<PendingConfirmation | null>(null)
  const [policyForm, setPolicyForm] = useState({
    name: 'Chính sách lương PT',
    audience: 'employee' as 'employee' | 'collaborator' | 'all',
    eligibleProfiles: ['official'] as PayrollProfile[],
    effectiveFrom: currentDateOnly(),
    ratePerSession: '20000',
    rateAfterDailyThreshold: '70000',
    rateAfterDailyThresholdEvening: '80000',
  })

  const canManage = profile?.role === 'admin' || profile?.role === 'super_admin'
  const trainerById = useMemo(() => new Map(trainers.map((trainer) => [trainer.id, trainer])), [trainers])
  const branchById = useMemo(() => new Map(branches.map((branch) => [branch.id, branch])), [branches])
  const activePolicies = useMemo(() => policies.filter((policy) => policy.status === 'active'), [policies])

  const refresh = useCallback(async () => {
    setLoading(true)
    setError('')
    const [runsResult, policiesResult, accountsResult, liveResult] = await Promise.allSettled([
      listPayrollRuns(36),
      listPayrollPolicies(),
      listCashAccounts(),
      listStaffPayrollAttendance(periodId),
    ])
    if (runsResult.status === 'fulfilled') setRuns(runsResult.value)
    if (policiesResult.status === 'fulfilled') setPolicies(policiesResult.value)
    if (accountsResult.status === 'fulfilled') {
      const activeAccounts = accountsResult.value.accounts.filter((account) => account.status === 'active')
      setCashAccounts(activeAccounts)
      setPayoutAccountId((current) => current || activeAccounts[0]?.id || '')
    }
    if (liveResult.status === 'fulfilled') {
      setLiveRows([...liveResult.value.rows].sort((left, right) => left.name.localeCompare(right.name, 'vi')))
      setLiveAsOfDate(liveResult.value.asOfDate)
    } else {
      setLiveRows([])
      setLiveAsOfDate('')
    }
    const failure = [runsResult, policiesResult, accountsResult, liveResult].find((result) => result.status === 'rejected')
    if (failure?.status === 'rejected') setError(friendlyError(failure.reason))
    setLoading(false)
  }, [periodId])

  useEffect(() => { void refresh() }, [refresh])

  const openStaffStatement = useCallback(async (staffId: string) => {
    setStaffStatementId(staffId)
    setStaffStatement(null)
    setStaffStatementError('')
    setStaffStatementLoading(true)
    window.scrollTo({ top: 0, behavior: 'smooth' })
    try {
      setStaffStatement(await getStaffPayrollStatement(periodId, staffId))
    } catch (cause) {
      setStaffStatementError(friendlyError(cause))
    } finally {
      setStaffStatementLoading(false)
    }
  }, [periodId])

  const openRun = useCallback(async (runId: string) => {
    setDetailLoading(true)
    setExpandedTrainerId('')
    setError('')
    try {
      const loaded = await getPayrollRun(runId)
      setDetail(loaded)
      setRuns((current) => current.map((run) => run.id === runId ? {
        ...run,
        requiresRebuild: loaded.run.requiresRebuild,
        trainerCount: loaded.run.trainerCount,
        teachingSlotCount: loaded.run.teachingSlotCount,
        attendanceCount: loaded.run.teachingSlotCount,
        attendanceEventCount: loaded.run.attendanceEventCount,
        staffCount: loaded.run.staffCount,
        workdayStaffCount: loaded.run.workdayStaffCount,
        attendanceReviewRequiredCount: loaded.run.attendanceReviewRequiredCount,
        calendarReviewRequiredCount: loaded.run.calendarReviewRequiredCount,
        attendanceReviewRequired: loaded.run.attendanceReviewRequired,
        baseSalaryAmount: loaded.run.baseSalaryAmount,
        teachingPayAmount: loaded.run.teachingPayAmount,
        bonusAmount: loaded.run.bonusAmount,
        grossAmount: loaded.run.grossAmount,
        adjustmentAmount: loaded.run.adjustmentAmount,
        finalAmount: loaded.run.finalAmount,
      } : run))
    } catch (cause) {
      setError(friendlyError(cause))
    } finally {
      setDetailLoading(false)
    }
  }, [])

  const openRunSetup = () => {
    if (!activePolicies.length) {
      setView('policies')
      setShowPolicyForm(true)
      setError('Hãy tạo hoặc mở lại ít nhất một chính sách trước khi lập kỳ lương.')
      return
    }
    const initial = activePolicies[0]
    setSelectedPolicyIds(activePolicies.map((policy) => policy.id))
    setDefaultPolicyId(initial.id)
    setPolicyApplicationMode('staff_profile')
    setTrainerPolicyAssignments({})
    setError('')
    setShowRunSetup(true)
  }

  const toggleRunPolicy = (policyId: string) => {
    setSelectedPolicyIds((current) => {
      const next = current.includes(policyId) ? current.filter((id) => id !== policyId) : [...current, policyId]
      if (!next.length) return current
      if (!next.includes(defaultPolicyId)) setDefaultPolicyId(next[0])
      setTrainerPolicyAssignments((assignments) => Object.fromEntries(Object.entries(assignments).filter(([, id]) => next.includes(id))))
      return next
    })
  }

  const togglePolicyProfile = (profile: PayrollProfile) => {
    setPolicyForm((current) => {
      const eligibleProfiles = current.eligibleProfiles.includes(profile)
        ? current.eligibleProfiles.filter((item) => item !== profile)
        : [...current.eligibleProfiles, profile]
      if (!eligibleProfiles.length) return current
      const includesCollaborator = eligibleProfiles.includes('collaborator')
      const includesEmployee = eligibleProfiles.some((item) => item !== 'collaborator')
      return {
        ...current,
        eligibleProfiles,
        audience: includesCollaborator && includesEmployee ? 'all' : includesCollaborator ? 'collaborator' : 'employee',
        ...(includesCollaborator && !current.eligibleProfiles.includes('collaborator')
          ? { ratePerSession: '50000', rateAfterDailyThreshold: '75000', rateAfterDailyThresholdEvening: '100000' }
          : {}),
      }
    })
  }

  const createConfiguredRun = async () => {
    if (busyAction || !selectedPolicyIds.length || !defaultPolicyId) return
    setBusyAction(`create:${periodId}`)
    setMessage('')
    setError('')
    try {
      const result = await createPayrollRun({
        periodId,
        policyIds: selectedPolicyIds,
        defaultPolicyId,
        policyApplicationMode,
        trainerPolicyAssignments: policyApplicationMode === 'trainer_assignment'
          ? Object.entries(trainerPolicyAssignments).filter(([, policyId]) => selectedPolicyIds.includes(policyId)).map(([trainerId, policyId]) => ({ trainerId, policyId }))
          : [],
      })
      setShowRunSetup(false)
      setMessage(result.unchanged ? 'Kỳ lương này đã tồn tại; Aura không tạo trùng.' : 'Đã tạo bản nháp theo cấu hình chính sách đã chọn.')
      await refresh()
      await openRun(result.runId)
    } catch (cause) {
      setError(friendlyError(cause))
    } finally {
      setBusyAction('')
    }
  }

  const runAction = async (action: 'review' | 'lock' | 'pay', run: PayrollRunSummary) => {
    if (busyAction) return
    if (action === 'review' && run.requiresRebuild) {
      setError('Kỳ nháp cũ cần được xóa và lập lại để lưu đúng ngày công, tiền ca và hoa hồng giới thiệu theo dòng tiền.')
      return
    }
    const key = `${action}:${run?.id || periodId}`
    setBusyAction(key)
    setMessage('')
    setError('')
    try {
      if (action === 'review') {
        await reviewPayrollRun(run.id)
        setMessage('Kỳ lương đã được chuyển sang trạng thái đã duyệt.')
      } else if (action === 'lock') {
        await lockPayrollRun(run.id)
        setMessage('Đã khóa kỳ và ghi nhận chi phí lương. Tiền quỹ chưa bị giảm.')
      } else if (action === 'pay') {
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

  const confirmDestructiveAction = async () => {
    if (!pendingConfirmation || busyAction) return
    const confirmation = pendingConfirmation
    setBusyAction(`${confirmation.kind}:${confirmation.id}`)
    setError('')
    setMessage('')
    try {
      if (confirmation.kind === 'delete-run') {
        await deleteDraftPayrollRun(confirmation.id)
        if (detail?.run.id === confirmation.id) setDetail(null)
        setMessage('Đã xóa kỳ nháp. Bạn có thể tạo lại theo chính sách mới.')
      } else {
        await managePayrollPolicy(confirmation.id, confirmation.action)
        setMessage(confirmation.action === 'delete'
          ? 'Đã xóa chính sách chưa từng sử dụng.'
          : confirmation.action === 'hide' ? 'Đã ẩn chính sách khỏi danh sách lập kỳ mới.' : 'Đã mở lại chính sách.')
      }
      setPendingConfirmation(null)
      await refresh()
    } catch (cause) {
      setError(friendlyError(cause))
    } finally {
      setBusyAction('')
    }
  }

  const submitPolicy = async () => {
    if (busyAction) return
    const ratePerSession = Number(policyForm.ratePerSession)
    const rateAfterDailyThreshold = Number(policyForm.rateAfterDailyThreshold)
    const rateAfterDailyThresholdEvening = Number(policyForm.rateAfterDailyThresholdEvening)
    if (![ratePerSession, rateAfterDailyThreshold, rateAfterDailyThresholdEvening].every((rate) => Number.isSafeInteger(rate) && rate >= 1_000)) {
      setError('Các đơn giá ca dạy phải là số nguyên từ 1.000đ.')
      return
    }
    if (policyForm.eligibleProfiles.includes('collaborator') && [ratePerSession, rateAfterDailyThreshold, rateAfterDailyThresholdEvening].some((rate) => rate < 50_000 || rate > 100_000)) {
      setError('Chính sách CTV cần đơn giá từ 50.000đ đến 100.000đ mỗi ca.')
      return
    }
    setBusyAction('policy')
    setError('')
    setMessage('')
    try {
      const result = await savePayrollPolicy({
        name: policyForm.name,
        audience: policyForm.audience,
        eligibleProfiles: policyForm.eligibleProfiles,
        effectiveFrom: policyForm.effectiveFrom,
        ratePerSession,
        dailySessionThreshold: 8,
        rateAfterDailyThreshold,
        eveningStartHour: 20,
        rateAfterDailyThresholdEvening,
      })
      setMessage(result.unchanged ? 'Chính sách này đã tồn tại.' : 'Đã lưu phiên bản chính sách mới; kỳ cũ không bị thay đổi.')
      setShowPolicyForm(false)
      await refresh()
    } catch (cause) {
      setError(friendlyError(cause))
    } finally {
      setBusyAction('')
    }
  }

  const slides: AuraMetricSlide[] = liveRows.length ? liveRows.map((row, index) => ({
    id: `staff-${row.staffId}`,
    eyebrow: `${row.name} · ${periodLabel(periodId)}`,
    value: money(row.finalAmount),
    detail: `${money(row.baseSalaryEarned)} cơ bản · ${money(row.teachingPayAmount)} ca dạy · ${money(row.commissionAmount)} HH ${row.referralCommissionRate ? `${row.referralCommissionRate}%` : ''}`,
    icon: <Banknote size={20} />,
    tone: (['pink', 'orange', 'sunset', 'ink'] as const)[index % 4],
    actionLabel: row.reviewRequired || !row.policyConfigured ? 'Cần đối soát' : `Tạm tính đến ${liveAsOfDate ? dateLabel(liveAsOfDate) : 'hiện tại'}`,
    onSelect: () => void openStaffStatement(row.staffId),
  })) : [{
    id: 'staff-empty', eyebrow: periodLabel(periodId), value: 'Chưa có số liệu',
    detail: 'Chưa tìm thấy staff đang hoạt động trong phạm vi kỳ lương này.',
    icon: <UsersRound size={20} />, tone: 'pink', actionLabel: 'Kiểm tra ngày công', onSelect: () => setView('workdays'),
  }]

  const visibleRuns = useMemo(() => {
    const query = search.trim().toLowerCase()
    return runs.filter((run) => {
      if (statusFilter !== 'all' && run.status !== statusFilter) return false
      return !query || `${run.periodId} ${run.policyName} ${statusMeta[run.status].label}`.toLowerCase().includes(query)
    })
  }, [runs, search, statusFilter])
  const subpageActive = showRunSetup || Boolean(pendingConfirmation) || Boolean(detail) || detailLoading
  useEffect(() => { if (subpageActive) window.scrollTo({ top: 0, behavior: 'smooth' }) }, [subpageActive])

  if (staffStatementId) return <StaffPayrollStatementPanel
    data={staffStatement}
    periodId={periodId}
    loading={staffStatementLoading}
    error={staffStatementError}
    onBack={() => { setStaffStatementId(''); setStaffStatement(null); setStaffStatementError('') }}
    onRetry={() => void openStaffStatement(staffStatementId)}
  />

  return <div className={`payroll-page ${subpageActive ? 'payroll-page--subpage' : ''}`}>
    <h1 className="aura-visually-hidden">Quản lý bảng lương</h1>
    <AuraMetricCarousel slides={slides} label="Lương tạm tính từng nhân viên" loading={loading && liveRows.length === 0} />

    <div className="payroll-page__nav" role="tablist" aria-label="Quản lý lương">
      <button type="button" role="tab" aria-selected={view === 'runs'} className={view === 'runs' ? 'is-active' : ''} onClick={() => setView('runs')}><FileCheck2 size={17} /> Kỳ lương</button>
      <button type="button" role="tab" aria-selected={view === 'workdays'} className={view === 'workdays' ? 'is-active' : ''} onClick={() => setView('workdays')}><CalendarCheck2 size={17} /> Ngày công</button>
      <button type="button" role="tab" aria-selected={view === 'policies'} className={view === 'policies' ? 'is-active' : ''} onClick={() => setView('policies')}><Settings2 size={17} /> Chính sách</button>
      <AuraHelpPopover title="Cách tính lương" label="Cách tính lương"><p>Tiền ca chỉ lấy từ ca đã điểm danh; hai học viên cùng HLV, ngày và giờ vẫn là một ca. Hoa hồng tách riêng, chỉ bằng 2–10% dòng tiền thực thu trong kỳ của hợp đồng có mã giới thiệu PT; khoản hoàn hoặc đảo thu làm giảm hoa hồng.</p></AuraHelpPopover>
    </div>

    {(message || error) && <div className={`payroll-page__notice ${error ? 'is-error' : 'is-success'}`} role="status">
      {error ? <AlertTriangle size={18} /> : <CheckCircle2 size={18} />}
      <span>{error || message}</span>
      <button type="button" aria-label="Đóng thông báo" onClick={() => { setError(''); setMessage('') }}><X size={16} /></button>
    </div>}

    {view === 'workdays' ? <StaffWorkdayPayrollPanel branches={branches} /> : view === 'runs' ? <>
      <section className="payroll-page__toolbar" aria-label="Bộ lọc kỳ lương">
        <label><span>Kỳ</span><input aria-label="Kỳ lương" type="month" value={periodId} onChange={(event) => setPeriodId(event.target.value)} /></label>
        <label><span>Trạng thái</span><select aria-label="Lọc trạng thái kỳ lương" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as RunStatusFilter)}><option value="all">Tất cả</option>{Object.entries(statusMeta).map(([id, meta]) => <option key={id} value={id}>{meta.label}</option>)}</select></label>
        <label className="payroll-page__search"><span>Tìm kiếm</span><Search size={17} /><input aria-label="Tìm kỳ lương" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Tháng hoặc chính sách" /></label>
        <button className="payroll-page__refresh" type="button" aria-label="Tải lại" disabled={loading} onClick={() => void refresh()}><RefreshCw size={18} /></button>
        <button className="payroll-page__primary" type="button" disabled={!canManage || !!busyAction || !periodId} onClick={openRunSetup}><Plus size={17} /> Tạo kỳ</button>
      </section>

      {!policies.length && !loading && <section className="payroll-page__setup"><ShieldCheck size={28} /><div><strong>Chưa có chính sách lương hiệu lực</strong><p>Tạo chính sách trước; Aura sẽ không tự đoán đơn giá hoặc dùng phép tính trong trình duyệt.</p></div><button type="button" onClick={() => setView('policies')}>Thiết lập ngay</button></section>}

      <section className="payroll-page__runs" aria-label="Danh sách kỳ lương">
        <div className="payroll-page__section-title"><div><span>Kỳ lương chính thức</span><strong>{visibleRuns.length} kỳ</strong></div><small>Nguồn: ngày công + ca dạy đã điểm danh</small></div>
        {loading && !runs.length ? <div className="payroll-page__skeleton" aria-label="Đang tải kỳ lương" /> : visibleRuns.length ? <div className="payroll-page__run-grid">
          {visibleRuns.map((run) => <article className="payroll-run-card" key={run.id}>
            <button className="payroll-run-card__open" type="button" onClick={() => void openRun(run.id)} aria-label={`Mở ${periodLabel(run.periodId)}`}>
              <div className="payroll-run-card__head"><div><span>{periodLabel(run.periodId)}</span><strong>{money(run.finalAmount)}</strong></div><em className={`is-${run.status}`}>{run.requiresRebuild ? 'Cần lập lại' : statusMeta[run.status].label}</em></div>
              <div className="payroll-run-card__metrics"><span><b>{run.staffCount}</b> nhân viên</span><span><b>{run.teachingSlotCount}</b> ca dạy</span><span><b>{run.attendanceReviewRequiredCount + run.calendarReviewRequiredCount}</b> cần đối soát</span></div>
              <p>{run.policyName || `Chính sách v${run.policyVersion}`}<ChevronRight size={17} /></p>
            </button>
            <div className="payroll-run-card__actions">
              {run.status === 'draft' && <><button className="is-danger-ghost" type="button" disabled={!!busyAction} onClick={() => setPendingConfirmation({ kind: 'delete-run', id: run.id, label: periodLabel(run.periodId) })}><Trash2 size={15} /> Xóa nháp</button><button type="button" disabled={!!busyAction || run.requiresRebuild || run.attendanceReviewRequired} title={run.requiresRebuild ? 'Xóa kỳ nháp cũ và tạo lại trước khi gửi duyệt' : run.attendanceReviewRequired ? 'Chốt đủ ngày công và lịch chuẩn trước khi gửi duyệt' : undefined} onClick={() => void runAction('review', run)}><FileCheck2 size={15} /> {run.requiresRebuild ? 'Cần tạo lại' : run.attendanceReviewRequired ? 'Chờ ngày công' : 'Gửi duyệt'}</button></>}
              {run.status === 'reviewed' && <button type="button" disabled={!!busyAction} onClick={() => void runAction('lock', run)}><LockKeyhole size={15} /> Khóa kỳ</button>}
              {run.status === 'locked' && <button type="button" onClick={() => void openRun(run.id)}><WalletCards size={15} /> Chi lương</button>}
              {run.status === 'paid' && <span><CheckCircle2 size={15} /> Đã hoàn tất</span>}
            </div>
          </article>)}
        </div> : <div className="payroll-page__empty"><UsersRound size={34} /><strong>Chưa có kỳ lương phù hợp</strong><p>Chọn kỳ khác hoặc tạo bản nháp từ dữ liệu điểm danh chính thức.</p></div>}
      </section>
    </> : <section className={`payroll-policy ${showPolicyForm ? 'is-creating' : ''}`} aria-label="Chính sách lương">
      <div className="payroll-policy__history">
        <div className="payroll-page__section-title">
          <div><span>Chính sách đang có</span><strong>{policies.length} phiên bản</strong></div>
          <div className="payroll-policy__heading-actions">
            <AuraHelpPopover title="Nguyên tắc phiên bản" label="Nguyên tắc phiên bản"><p>Có thể tạo nhiều chính sách. Khi lập kỳ, chọn theo hồ sơ nhân viên, từng HLV hoặc ngày hiệu lực. Kỳ cũ luôn giữ snapshot riêng.</p></AuraHelpPopover>
            <button className="payroll-policy__create" type="button" disabled={!canManage || !!busyAction} onClick={() => setShowPolicyForm(true)}><Plus size={15} /> Tạo chính sách</button>
          </div>
        </div>
        {policies.length ? policies.map((policy) => <article className={policy.status === 'inactive' ? 'is-inactive' : ''} key={policy.id}>
          <div className="payroll-policy__identity"><div><strong>{policy.name}</strong><span>{policy.eligibleProfiles.map(payrollProfileLabel).join(' · ')} · Hiệu lực {dateLabel(policy.effectiveFrom)} · {policy.status === 'active' ? 'Đang dùng' : 'Đã ẩn'} · {policy.usageCount} kỳ</span></div><div className="payroll-policy__actions">{policy.status === 'active' ? <button type="button" onClick={() => setPendingConfirmation({ kind: 'policy', id: policy.id, label: policy.name, action: 'hide' })}><EyeOff size={14} /> Ẩn</button> : <button type="button" onClick={() => setPendingConfirmation({ kind: 'policy', id: policy.id, label: policy.name, action: 'restore' })}><Eye size={14} /> Mở lại</button>}{policy.canDelete && <button className="is-danger" type="button" onClick={() => setPendingConfirmation({ kind: 'policy', id: policy.id, label: policy.name, action: 'delete' })}><Trash2 size={14} /> Xóa</button>}</div></div>
          <div className="payroll-policy__rates"><span><small>Ca 1–{policy.dailySessionThreshold}</small><b>{money(policy.ratePerSession)}</b></span><span><small>Từ ca {policy.dailySessionThreshold + 1}</small><b>{money(policy.rateAfterDailyThreshold)}</b></span><span><small>Sau {policy.eveningStartHour}h</small><b>{money(policy.rateAfterDailyThresholdEvening)}</b></span></div>
        </article>) : <div className="payroll-page__empty"><Settings2 size={30} /><strong>Chưa có chính sách</strong><p>Dùng nút “Tạo chính sách” để thiết lập phiên bản đầu tiên.</p></div>}
      </div>

      {showPolicyForm && <div className="payroll-policy__form">
        <div className="payroll-page__section-title"><div><span>Phiên bản mới</span><strong>Thiết lập chính sách</strong></div><button className="payroll-policy__close" type="button" aria-label="Đóng bảng tạo chính sách" onClick={() => setShowPolicyForm(false)}><X size={17} /></button></div>
        <div className="payroll-policy__fields">
          <label><span>Tên chính sách</span><input value={policyForm.name} maxLength={100} onChange={(event) => setPolicyForm((current) => ({ ...current, name: event.target.value }))} /></label>
          <div className="payroll-policy__profiles"><span>Nhóm nhân viên áp dụng</span><div>{(['probation', 'official', 'senior', 'part_time', 'collaborator'] as PayrollProfile[]).map((profile) => <button key={profile} type="button" className={policyForm.eligibleProfiles.includes(profile) ? 'is-active' : ''} onClick={() => togglePolicyProfile(profile)}>{payrollProfileLabel(profile)}</button>)}</div></div>
          <label><span>Hiệu lực từ</span><input type="date" value={policyForm.effectiveFrom} onChange={(event) => setPolicyForm((current) => ({ ...current, effectiveFrom: event.target.value }))} /></label>
          <label><span>Đơn giá ca 1–8</span><input type="number" min="1000" step="1000" inputMode="numeric" value={policyForm.ratePerSession} onChange={(event) => setPolicyForm((current) => ({ ...current, ratePerSession: event.target.value }))} /></label>
          <label><span>Từ ca thứ 9</span><input type="number" min="1000" step="1000" inputMode="numeric" value={policyForm.rateAfterDailyThreshold} onChange={(event) => setPolicyForm((current) => ({ ...current, rateAfterDailyThreshold: event.target.value }))} /></label>
          <label><span>Từ ca thứ 9 · sau 20h</span><input type="number" min="1000" step="1000" inputMode="numeric" value={policyForm.rateAfterDailyThresholdEvening} onChange={(event) => setPolicyForm((current) => ({ ...current, rateAfterDailyThresholdEvening: event.target.value }))} /></label>
          <div className="payroll-policy__form-actions"><button className="payroll-page__secondary" type="button" onClick={() => setShowPolicyForm(false)}>Hủy</button><button className="payroll-page__primary" type="button" disabled={!canManage || !!busyAction} onClick={() => void submitPolicy()}><ShieldCheck size={17} /> Lưu phiên bản</button></div>
        </div>
        <p className="payroll-policy__scope">Áp dụng cho: {policyForm.eligibleProfiles.map(payrollProfileLabel).join(' · ')}. {policyForm.eligibleProfiles.includes('collaborator') ? 'Chính sách có CTV phải dùng đơn giá 50.000–100.000đ/ca.' : 'Nhân viên hưởng lương cơ bản theo ngày công và tiền ca theo chính sách.'} Một khung giờ có hai học viên vẫn chỉ tính một ca.</p>
      </div>}
    </section>}

    {showRunSetup && <div className="payroll-modal" role="region" aria-label="Thiết lập kỳ lương">
      <section className="payroll-run-setup">
        <header><div><span>Lập kỳ {periodLabel(periodId)}</span><strong>Chọn chính sách áp dụng</strong></div><button type="button" aria-label="Đóng" onClick={() => setShowRunSetup(false)} disabled={!!busyAction}><X size={20} /></button></header>
        <p className="payroll-run-setup__lead">Kỳ nháp lưu snapshot chính sách. Bạn có thể xóa kỳ nháp và lập lại; kỳ đã duyệt không thể xóa.</p>
        <div className="payroll-run-setup__policies">
          {activePolicies.map((policy) => {
            const selected = selectedPolicyIds.includes(policy.id)
            return <label className={selected ? 'is-selected' : ''} key={policy.id}>
              <input type="checkbox" checked={selected} onChange={() => toggleRunPolicy(policy.id)} />
              <span><strong>{policy.name}</strong><small>{policy.eligibleProfiles.map(payrollProfileLabel).join(' · ')} · Hiệu lực {dateLabel(policy.effectiveFrom)}</small></span>
              <b>{money(policy.ratePerSession)}<small>/ca chuẩn</small></b>
            </label>
          })}
        </div>
        <label className="payroll-run-setup__default"><span>Chính sách mặc định</span><select value={defaultPolicyId} onChange={(event) => setDefaultPolicyId(event.target.value)}>{activePolicies.filter((policy) => selectedPolicyIds.includes(policy.id)).map((policy) => <option key={policy.id} value={policy.id}>{policy.name}</option>)}</select></label>
        {selectedPolicyIds.length > 1 && <>
          <div className="payroll-run-setup__modes" role="radiogroup" aria-label="Cách áp chính sách">
            <button className={policyApplicationMode === 'staff_profile' ? 'is-active' : ''} type="button" role="radio" aria-checked={policyApplicationMode === 'staff_profile'} onClick={() => setPolicyApplicationMode('staff_profile')}><ShieldCheck size={17} /><span><strong>Theo hồ sơ nhân viên</strong><small>Tự chọn theo cấp bậc đã cài</small></span></button>
            <button className={policyApplicationMode === 'trainer_assignment' ? 'is-active' : ''} type="button" role="radio" aria-checked={policyApplicationMode === 'trainer_assignment'} onClick={() => setPolicyApplicationMode('trainer_assignment')}><UsersRound size={17} /><span><strong>Theo từng HLV</strong><small>Chọn A/B cho từng người</small></span></button>
            <button className={policyApplicationMode === 'effective_date' ? 'is-active' : ''} type="button" role="radio" aria-checked={policyApplicationMode === 'effective_date'} onClick={() => setPolicyApplicationMode('effective_date')}><Clock3 size={17} /><span><strong>Theo ngày hiệu lực</strong><small>Tự đổi chính sách theo ngày ca dạy</small></span></button>
          </div>
          {policyApplicationMode === 'trainer_assignment' ? <div className="payroll-run-setup__trainers">
            <div><SlidersHorizontal size={16} /><span><strong>Phân chính sách cho HLV</strong><small>Không chọn riêng sẽ dùng chính sách mặc định.</small></span></div>
            {trainers.map((trainer) => <label key={trainer.id}><span>{trainer.name || 'Chưa cập nhật tên HLV'}</span><select value={trainerPolicyAssignments[trainer.id] || ''} onChange={(event) => setTrainerPolicyAssignments((current) => ({ ...current, [trainer.id]: event.target.value }))}><option value="">Mặc định</option>{activePolicies.filter((policy) => selectedPolicyIds.includes(policy.id)).map((policy) => <option key={policy.id} value={policy.id}>{policy.name}</option>)}</select></label>)}
          </div> : policyApplicationMode === 'staff_profile' ? <p className="payroll-run-setup__rule"><ShieldCheck size={17} /> Aura ưu tiên chính sách đã gán trong hồ sơ nhân viên; nếu chưa gán, hệ thống chọn phiên bản mới nhất phù hợp Thử việc, Chính thức, Senior, Part-time hoặc CTV.</p> : <p className="payroll-run-setup__rule"><Clock3 size={17} /> Mỗi ca dạy dùng chính sách có ngày hiệu lực gần nhất nhưng không sau ngày của ca. Các chính sách cần có ngày hiệu lực khác nhau.</p>}
        </>}
        <footer><button className="payroll-page__secondary" type="button" disabled={!!busyAction} onClick={() => setShowRunSetup(false)}>Hủy</button><button className="payroll-page__primary" type="button" disabled={!!busyAction || !selectedPolicyIds.length || !defaultPolicyId} onClick={() => void createConfiguredRun()}><FileCheck2 size={17} /> {busyAction.startsWith('create:') ? 'Đang tạo…' : 'Tạo kỳ nháp'}</button></footer>
      </section>
    </div>}

    {pendingConfirmation && <div className="payroll-confirm" role="region" aria-label="Xác nhận thao tác"><section><span className="payroll-confirm__icon"><AlertTriangle size={24} /></span><strong>{pendingConfirmation.kind === 'delete-run' ? 'Xóa kỳ lương nháp?' : pendingConfirmation.action === 'delete' ? 'Xóa chính sách?' : pendingConfirmation.action === 'hide' ? 'Ẩn chính sách?' : 'Mở lại chính sách?'}</strong><p>{pendingConfirmation.kind === 'delete-run' ? `${pendingConfirmation.label} chưa duyệt sẽ bị xóa cùng các dòng tính lương để bạn lập lại theo chính sách mới.` : pendingConfirmation.action === 'delete' ? `${pendingConfirmation.label} chưa được kỳ lương nào sử dụng và sẽ bị xóa.` : pendingConfirmation.action === 'hide' ? `${pendingConfirmation.label} sẽ không còn xuất hiện khi lập kỳ mới; các kỳ cũ không thay đổi.` : `${pendingConfirmation.label} sẽ lại xuất hiện trong danh sách chính sách có thể chọn.`}</p><div><button type="button" disabled={!!busyAction} onClick={() => setPendingConfirmation(null)}>Giữ lại</button><button className={pendingConfirmation.kind === 'delete-run' || pendingConfirmation.action === 'delete' ? 'is-danger' : ''} type="button" disabled={!!busyAction} onClick={() => void confirmDestructiveAction()}>{busyAction ? 'Đang xử lý…' : 'Xác nhận'}</button></div></section></div>}

    {(detail || detailLoading) && <div className="payroll-drawer" role="region" aria-label="Chi tiết kỳ lương">
      <section>
        <header><div><span>Chi tiết kỳ lương</span><strong>{detail ? periodLabel(detail.run.periodId) : 'Đang tải…'}</strong></div><button type="button" aria-label="Đóng" onClick={() => setDetail(null)}><X size={21} /></button></header>
        {detailLoading && !detail ? <div className="payroll-page__skeleton" /> : detail && <>
          <div className="payroll-drawer__summary">
            <div><span>Thực nhận</span><strong>{money(detail.run.finalAmount)}</strong></div>
            <div><span>Lương cơ bản</span><strong>{money(detail.run.baseSalaryAmount)}</strong></div>
            <div><span>Tiền ca dạy</span><strong>{money(detail.run.teachingPayAmount)}</strong></div>
            <div><span>Trạng thái</span><strong>{statusMeta[detail.run.status].label}</strong></div>
          </div>
          <p className="payroll-drawer__status"><ShieldCheck size={17} /> {statusMeta[detail.run.status].hint}</p>
          {detail.run.requiresRebuild && <div className="payroll-drawer__legacy-warning"><AlertTriangle size={20} /><div><strong>Kỳ lương dùng công thức cũ</strong><p>{detail.run.status === 'draft' ? 'Hãy lập lại kỳ để tiền ca không bị cộng chồng và hoa hồng chỉ lấy 2–10% từ dòng tiền thực thu của hợp đồng có mã giới thiệu PT.' : 'Kỳ đã duyệt hoặc khóa được giữ nguyên để bảo toàn chứng từ. Chỉ các kỳ mới dùng công thức hoa hồng theo dòng tiền.'}</p>{detail.run.storedTeachingSlotCount !== detail.run.teachingSlotCount && <small>Dữ liệu cũ: {detail.run.storedTeachingSlotCount || 0} lượt · Preview chuẩn: {detail.run.teachingSlotCount} ca.</small>}</div>{detail.run.status === 'draft' && <button type="button" onClick={() => { setPendingConfirmation({ kind: 'delete-run', id: detail.run.id, label: periodLabel(detail.run.periodId) }); setDetail(null) }}><Trash2 size={15} /> Lập lại kỳ</button>}</div>}
          <div className="payroll-drawer__items">
            <div className="payroll-page__section-title"><div><span>Chi tiết theo nhân viên</span><strong>{detail.items.length} người</strong></div><small>Bấm tên để xem ngày công và ca dạy</small></div>
            {detail.items.map((item) => {
              const trainer = trainerById.get(item.trainerId)
              const name = item.staffSnapshot?.name || item.trainerSnapshot?.name || trainer?.name || 'Chưa cập nhật tên nhân viên'
              const branchId = item.staffSnapshot?.branchId || item.trainerSnapshot?.branchId || trainer?.branchId || ''
              const expanded = expandedTrainerId === item.id
              return <article className={`payroll-trainer-item ${expanded ? 'is-expanded' : ''}`} key={item.id}>
                <button type="button" className="payroll-trainer-item__trigger" aria-expanded={expanded} onClick={() => setExpandedTrainerId((current) => current === item.id ? '' : item.id)}>
                  <div className="payroll-drawer__person"><span>{name.slice(0, 1).toUpperCase()}</span><div><strong>{name}</strong><small>{item.employmentType === 'collaborator' ? 'CTV' : 'Nhân viên'} · {branchById.get(branchId)?.name || 'Chưa gắn chi nhánh'} · {item.teachingDayCount || new Set(item.teachingSlots.map((slot) => slot.date)).size} ngày dạy</small></div></div>
                  <div className="payroll-drawer__numbers"><span>{item.workdaySummary.estimatedPaidDays}/{item.workdaySummary.eligibleWorkdays} công · {item.sessionCount} ca</span><strong>{money(item.finalAmount)}</strong></div>
                  <ChevronRight className="payroll-trainer-item__chevron" size={18} />
                </button>
                {expanded && <div className="payroll-trainer-item__detail">
                  <div className="payroll-trainer-item__components"><span>Lương cơ bản <b>{money(item.baseSalaryAmount)}</b></span><span>Ca dạy <b>{money(item.teachingPayAmount)}</b></span><span>Hoa hồng GT <b>{money(item.commissionAmount)}</b><small>{item.referralCommission ? `${item.referralCommission.rate}% trên ${money(item.referralCommission.netCashAmount)} thực thu` : 'Kỳ cũ chưa có bằng chứng dòng tiền'}</small></span><span>Thưởng <b>{money(item.bonusAmount)}</b></span><span>Khấu trừ <b>{money(item.deductionAmount)}</b></span></div>
                  {(item.attendanceReviewRequired || item.calendarReviewRequired) && <p className="payroll-trainer-item__review"><AlertTriangle size={15} /> {item.calendarReviewRequired ? 'Lịch làm việc chưa duyệt. ' : ''}{item.attendanceReviewRequired ? 'Ngày công còn thiếu hoặc cần xác minh.' : ''}</p>}
                  <div className="payroll-trainer-item__tiers"><span>Ca 1–8 <b>{item.tierSummary.standardCount}</b><small>{money(item.tierSummary.standardAmount)}</small></span><span>Từ ca 9 <b>{item.tierSummary.afterThresholdCount}</b><small>{money(item.tierSummary.afterThresholdAmount)}</small></span><span>Ca tối <b>{item.tierSummary.afterThresholdEveningCount}</b><small>{money(item.tierSummary.afterThresholdEveningAmount)}</small></span></div>
                  {item.teachingSlots.length ? <div className="payroll-teaching-slots">{item.teachingSlots.map((slot) => <div key={slot.key} className="payroll-teaching-slot"><time>{dateLabel(slot.date)} · {String(slot.hour).padStart(2, '0')}:00</time><span>Ca #{slot.dailyPosition} · {slot.studentCount} học viên{slot.policyName ? ` · ${slot.policyName}` : ''}</span><em>{teachingTierLabel(slot.tier)}</em><strong>{money(slot.rate)}</strong></div>)}</div> : <p className="payroll-trainer-item__legacy">Kỳ cũ chưa lưu snapshot từng ca. Tạo kỳ mới để xem chi tiết ngày, giờ và số học viên.</p>}
                </div>}
              </article>
            })}
            {!detail.items.length && <div className="payroll-page__empty"><UsersRound size={30} /><strong>Không có nhân viên trong kỳ</strong><p>Kiểm tra hồ sơ đội ngũ, ngày công và ca dạy đã điểm danh.</p></div>}
          </div>
          {detail.run.status === 'locked' && <div className="payroll-drawer__payout"><div><strong>Ghi nhận chi lương</strong><p>Thao tác này giảm quỹ đúng một lần và lưu tham chiếu thanh toán.</p></div><label><span>Quỹ chi</span><select value={payoutAccountId} onChange={(event) => setPayoutAccountId(event.target.value)}><option value="">Chọn quỹ</option>{cashAccounts.map((account) => <option key={account.id} value={account.id}>{account.name} · {money(account.balance)}</option>)}</select></label><label><span>Mã chứng từ</span><input value={payoutReference} maxLength={200} placeholder="VD: UNC-202608-001" onChange={(event) => setPayoutReference(event.target.value)} /></label><button className="payroll-page__primary" type="button" disabled={!!busyAction || !payoutAccountId || !payoutReference.trim()} onClick={() => void runAction('pay', detail.run)}><WalletCards size={17} /> Xác nhận chi</button></div>}
        </>}
      </section>
    </div>}
  </div>
}
