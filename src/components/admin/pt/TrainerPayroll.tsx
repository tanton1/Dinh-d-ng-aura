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
  Gift,
  Plus,
  RefreshCw,
  Save,
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
  listPayrollAdjustments,
  listPayrollPolicies,
  listPayrollRuns,
  lockPayrollRun,
  markPayrollRunPaid,
  managePayrollPolicy,
  parsePayrollFailure,
  reviewPayrollRun,
  savePayrollAdjustment,
  savePayrollPolicy,
  voidPayrollAdjustment,
  type PayrollAdjustment,
  type PayrollFailure,
  type PayrollPolicy,
  type PayrollProfile,
  type PayrollPolicyApplicationMode,
  type PayrollRunDetail,
  type PayrollRunStatus,
  type PayrollRunSummary,
  type PayrollViolation,
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

type PayrollView = 'runs' | 'workdays' | 'policies' | 'adjustments'
type RunStatusFilter = 'all' | PayrollRunStatus
type PolicyApplicationMode = Exclude<PayrollPolicyApplicationMode, 'single'>
type PendingConfirmation =
  | { kind: 'delete-run'; id: string; label: string }
  | { kind: 'rebuild-run'; id: string; label: string }
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

function payrollPeriodEnded(value: string) {
  return /^\d{4}-\d{2}$/.test(value) && value < currentPeriod()
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

function violationFacts(violation: PayrollViolation, trainers: Array<{ id: string; name?: string }>, students: Array<{ id: string; name?: string }>, branches: Array<{ id: string; name?: string }>) {
  const trainerIds = violation.trainerIds?.length
    ? violation.trainerIds
    : violation.trainerId || violation.staffId ? [violation.trainerId || violation.staffId || ''] : []
  const trainerNames = violation.trainerNames?.length
    ? violation.trainerNames
    : trainerIds.map((id) => trainers.find((item) => item.id === id)?.name || (id === violation.staffId ? violation.staffName : '') || id)
  const studentIds = violation.studentIds?.length ? violation.studentIds : violation.studentId ? [violation.studentId] : []
  const studentNames = violation.studentNames?.length
    ? violation.studentNames
    : studentIds.map((id) => students.find((item) => item.id === id)?.name || id)
  const branchIds = violation.branchIds?.length ? violation.branchIds : violation.branchId ? [violation.branchId] : []
  const branchNames = branchIds.map((id) => branches.find((item) => item.id === id)?.name || id).filter(Boolean)
  const sessionIds = violation.sessionIds?.length ? violation.sessionIds : violation.sessionId ? [violation.sessionId] : []
  return [
    trainerNames.length ? `PT: ${trainerNames.join(', ')}` : '',
    studentNames.length ? `Học viên: ${studentNames.join(', ')}` : '',
    violation.date ? `${dateLabel(violation.date)}${violation.hours?.length ? ` · ${violation.hours.map((hour) => `${String(hour).padStart(2, '0')}:00`).join(', ')}` : violation.hour !== undefined ? ` · ${String(violation.hour).padStart(2, '0')}:00` : ''}` : '',
    branchNames.length ? `Cơ sở: ${branchNames.join(', ')}` : '',
    sessionIds.length ? `Mã ca: ${sessionIds.slice(0, 3).join(', ')}${sessionIds.length > 3 ? ` +${sessionIds.length - 3}` : ''}` : '',
  ].filter(Boolean).join(' · ')
}

function teachingTierLabel(tier: 'standard' | 'after_threshold' | 'after_threshold_evening') {
  if (tier === 'after_threshold_evening') return 'Tăng ca tối'
  if (tier === 'after_threshold') return 'Từ ca thứ 9'
  return 'Ca tiêu chuẩn'
}

function payrollWorkdayLabel(status: string, holidayName = '') {
  if (status === 'present') return 'Có mặt'
  if (status === 'remote') return 'Làm từ xa'
  if (status === 'business_trip') return 'Công tác'
  if (status === 'training') return 'Đào tạo'
  if (status === 'paid_leave') return 'Nghỉ phép có lương'
  if (status === 'unpaid_leave') return 'Nghỉ không lương'
  if (status === 'unexcused_absence') return 'Vắng không phép'
  if (status === 'sick_leave') return 'Nghỉ ốm · cần duyệt'
  if (status === 'maternity_leave') return 'Nghỉ thai sản · cần duyệt'
  if (status === 'auto_present_teaching') return 'Tự tính đủ công'
  if (status === 'weekly_rest') return 'Nghỉ tuần'
  if (status === 'paid_holiday') return holidayName || 'Nghỉ lễ'
  if (status === 'outside_employment') return 'Ngoài thời gian làm việc'
  if (status === 'upcoming') return 'Chưa đến ngày'
  return 'Chưa chốt'
}

function payrollProfileLabel(profile: PayrollProfile) {
  if (profile === 'probation') return 'Thử việc'
  if (profile === 'senior') return 'Senior'
  if (profile === 'part_time') return 'Part-time'
  if (profile === 'collaborator') return 'CTV'
  return 'Chính thức'
}

function friendlyFailure(cause: unknown): PayrollFailure {
  const parsed = parsePayrollFailure(cause)
  const { message, code } = parsed
  if (code === 'permission-denied' || code === 'unauthenticated' || /permission|unauth|quyền/i.test(message)) {
    return { ...parsed, message: code === 'unauthenticated'
      ? 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại để quản lý bảng lương.'
      : 'Tài khoản chưa có quyền quản lý bảng lương.' }
  }
  if (code === 'internal' || code === 'unavailable' || code === 'deadline-exceeded' || /^(internal|unavailable)$/i.test(message.trim())) {
    if (/mã đối soát/i.test(message)) return parsed
    return { ...parsed, message: 'Dịch vụ lương chưa hoàn tất giao dịch. Hãy thử lại; nếu lỗi lặp lại, dùng mã đối soát trong chi tiết bên dưới.' }
  }
  if (code === 'resource-exhausted') return { ...parsed, message: message || 'Dữ liệu kỳ lương quá lớn để xử lý trong một lần.' }
  if (code === 'not-found') return { ...parsed, message: message || 'Chưa có dữ liệu kỳ lương phù hợp.' }
  return { ...parsed, message: message || 'Không thể tải dữ liệu lương.' }
}

function friendlyError(cause: unknown) {
  return friendlyFailure(cause).message
}

const remediationLabel: Record<PayrollViolation['remediation'], string> = {
  workdays: 'Mở Ngày công',
  teaching_history: 'Xem chi tiết trong popup',
  staff_profile: 'Mở Hồ sơ đội ngũ',
  policy: 'Mở Chính sách',
  delete_rebuild: 'Xử lý kỳ nháp',
  retry: 'Thử lại',
}

export default function TrainerPayroll({ profile }: Props) {
  const { trainers, branches, students } = useDatabase()
  const [view, setView] = useState<PayrollView>('runs')
  const [runs, setRuns] = useState<PayrollRunSummary[]>([])
  const [policies, setPolicies] = useState<PayrollPolicy[]>([])
  const [adjustments, setAdjustments] = useState<PayrollAdjustment[]>([])
  const [cashAccounts, setCashAccounts] = useState<CashAccount[]>([])
  const [periodId, setPeriodId] = useState(currentPeriod)
  const [statusFilter, setStatusFilter] = useState<RunStatusFilter>('all')
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [busyAction, setBusyAction] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [payrollFailure, setPayrollFailure] = useState<PayrollFailure | null>(null)
  const [violationDialog, setViolationDialog] = useState<PayrollViolation | null>(null)
  const [detail, setDetail] = useState<PayrollRunDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [expandedTrainerId, setExpandedTrainerId] = useState('')
  const [payoutAccountId, setPayoutAccountId] = useState('')
  const [payoutReference, setPayoutReference] = useState('')

  useEffect(() => {
    if (!violationDialog) return undefined
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setViolationDialog(null)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [violationDialog])
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
  const [adjustmentForm, setAdjustmentForm] = useState({ staffId: '', type: 'bonus' as 'bonus' | 'deduction', amount: '', reason: '', evidenceReference: '' })
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
    const [runsResult, policiesResult, accountsResult, liveResult, adjustmentsResult] = await Promise.allSettled([
      listPayrollRuns(36),
      listPayrollPolicies(),
      listCashAccounts(),
      listStaffPayrollAttendance(periodId),
      listPayrollAdjustments(periodId),
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
    if (adjustmentsResult.status === 'fulfilled') setAdjustments(adjustmentsResult.value)
    else setAdjustments([])
    const failure = [runsResult, policiesResult, accountsResult, liveResult, adjustmentsResult].find((result) => result.status === 'rejected')
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
        storedTeachingSlotCount: loaded.run.storedTeachingSlotCount,
        trainerCount: loaded.run.trainerCount,
        teachingSlotCount: loaded.run.teachingSlotCount,
        attendanceCount: loaded.run.teachingSlotCount,
        attendanceEventCount: loaded.run.attendanceEventCount,
        staffCount: loaded.run.staffCount,
        workdayStaffCount: loaded.run.workdayStaffCount,
        attendanceReviewRequiredCount: loaded.run.attendanceReviewRequiredCount,
        calendarReviewRequiredCount: loaded.run.calendarReviewRequiredCount,
        teachingEvidenceReviewRequiredCount: loaded.run.teachingEvidenceReviewRequiredCount,
        teachingEvidenceReviewRequiredSessionIds: loaded.run.teachingEvidenceReviewRequiredSessionIds,
        validationViolationCount: loaded.run.validationViolationCount,
        validationViolations: loaded.run.validationViolations,
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
    setPayrollFailure(null)
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
    setPayrollFailure(null)
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
      const failure = friendlyFailure(cause)
      setError(failure.message)
      setPayrollFailure(failure)
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
      if (confirmation.kind === 'delete-run' || confirmation.kind === 'rebuild-run') {
        await deleteDraftPayrollRun(confirmation.id)
        if (detail?.run.id === confirmation.id) setDetail(null)
        if (confirmation.kind === 'rebuild-run' && activePolicies.length) {
          const initial = activePolicies[0]
          setSelectedPolicyIds(activePolicies.map((policy) => policy.id))
          setDefaultPolicyId(initial.id)
          setPolicyApplicationMode('staff_profile')
          setTrainerPolicyAssignments({})
          setShowRunSetup(true)
          setMessage('Đã gỡ bản nháp công thức cũ. Kiểm tra chính sách rồi lập lại kỳ theo ca dạy độc nhất.')
        } else {
          setMessage('Đã xóa kỳ nháp. Bạn có thể tạo lại theo chính sách mới.')
        }
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

  const submitAdjustment = async () => {
    if (busyAction) return
    const amount = Number(adjustmentForm.amount)
    if (!adjustmentForm.staffId) {
      setError('Chọn nhân viên nhận thưởng hoặc bị khấu trừ.')
      return
    }
    if (!Number.isSafeInteger(amount) || amount < 1_000) {
      setError('Số tiền cần là số nguyên từ 1.000đ.')
      return
    }
    if (adjustmentForm.reason.trim().length < 5) {
      setError('Nhập lý do ít nhất 5 ký tự để lưu bằng chứng.')
      return
    }
    setBusyAction('adjustment:create')
    setMessage('')
    setError('')
    setPayrollFailure(null)
    try {
      await savePayrollAdjustment({
        periodId,
        staffId: adjustmentForm.staffId,
        type: adjustmentForm.type,
        amount,
        reason: adjustmentForm.reason.trim(),
        evidenceReference: adjustmentForm.evidenceReference.trim(),
      })
      setAdjustmentForm((current) => ({ ...current, amount: '', reason: '', evidenceReference: '' }))
      setMessage(`Đã lưu ${adjustmentForm.type === 'bonus' ? 'thưởng' : 'khấu trừ'} cho kỳ ${periodLabel(periodId)}. Khoản này sẽ vào snapshot khi tạo kỳ.`)
      await refresh()
    } catch (cause) {
      const failure = friendlyFailure(cause)
      setError(failure.message)
      setPayrollFailure(failure)
    } finally {
      setBusyAction('')
    }
  }

  const voidAdjustment = async (adjustmentId: string) => {
    if (busyAction) return
    setBusyAction(`adjustment:void:${adjustmentId}`)
    setMessage('')
    setError('')
    setPayrollFailure(null)
    try {
      await voidPayrollAdjustment(adjustmentId)
      setMessage('Đã hủy khoản thưởng/phạt. Lịch sử kiểm toán vẫn được giữ.')
      await refresh()
    } catch (cause) {
      const failure = friendlyFailure(cause)
      setError(failure.message)
      setPayrollFailure(failure)
    } finally {
      setBusyAction('')
    }
  }

  const handleViolationAction = (violation: PayrollViolation) => {
    setError('')
    if (violation.remediation === 'teaching_history') {
      // Keep the current payroll run/drawer mounted. Navigating to the legacy
      // training-history route used to unmount this page and discard the
      // selected period context. The dialog gives the operator the complete
      // evidence needed to reconcile the duplicate before leaving this run.
      setViolationDialog(violation)
      return
    }
    setPayrollFailure(null)
    if (violation.remediation === 'workdays') {
      setShowRunSetup(false)
      setView('workdays')
      return
    }
    if (violation.remediation === 'policy') {
      setShowRunSetup(false)
      setView('policies')
      return
    }
    if (violation.remediation === 'staff_profile') {
      window.location.hash = '#/admin-hr'
      return
    }
    if (violation.remediation === 'delete_rebuild') {
      const run = runs.find((item) => item.periodId === (violation.periodId || periodId) && item.status === 'draft')
      setShowRunSetup(false)
      if (run) setPendingConfirmation({ kind: 'rebuild-run', id: run.id, label: periodLabel(run.periodId) })
      else setView('runs')
      return
    }
    if (showRunSetup) void createConfiguredRun()
    else void refresh()
  }

  const slides: AuraMetricSlide[] = liveRows.length ? liveRows.map((row, index) => ({
    id: `staff-${row.staffId}`,
    eyebrow: `${row.name} · ${periodLabel(periodId)}`,
    value: money(row.finalAmount),
    detail: `${money(row.baseSalaryEarned)} cơ bản · ${money(row.teachingPayAmount)} ca dạy · ${money(row.commissionAmount)} HH ${row.referralCommissionRate ? `${row.referralCommissionRate}%` : ''}`,
    icon: <Banknote size={20} />,
    tone: (['pink', 'orange', 'sunset', 'ink'] as const)[index % 4],
    actionLabel: row.reviewRequired || !row.policyConfigured ? 'Cần đối soát' : `Dự tính toàn kỳ · dữ liệu đến ${liveAsOfDate ? dateLabel(liveAsOfDate) : 'hiện tại'}`,
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
  const runPreflight = useMemo(() => ({
    staffCount: liveRows.length,
    teachingSlotCount: liveRows.reduce((total, row) => total + row.teachingSlotCount, 0),
    reviewRequiredCount: liveRows.filter((row) => row.reviewRequired).length,
    unconfiguredPolicyCount: liveRows.filter((row) => !row.policyConfigured).length,
  }), [liveRows])
  const preflightViolations = useMemo<PayrollViolation[]>(() => liveRows.flatMap((row) => {
    const violations: PayrollViolation[] = []
    if (!row.policyConfigured) violations.push({
      code: 'STAFF_POLICY_UNCONFIGURED',
      severity: 'warning',
      title: `${row.name} chưa có chính sách phù hợp`,
      detail: 'Gán chính sách theo đúng nhóm Chính thức, Thử việc, Part-time hoặc CTV trước khi gửi duyệt.',
      remediation: 'staff_profile',
      staffId: row.staffId,
      staffName: row.name,
      periodId,
    })
    if (row.reviewRequired) violations.push({
      code: 'STAFF_WORKDAY_REVIEW_REQUIRED',
      severity: 'warning',
      title: `${row.name} còn ngày công cần đối soát`,
      detail: `${row.pendingDays} ngày chưa chốt${row.calendarApproved ? '' : ' · lịch làm việc chi nhánh chưa duyệt'}. Ca dạy vẫn được nhóm theo PT + ngày + giờ.`,
      remediation: 'workdays',
      staffId: row.staffId,
      staffName: row.name,
      periodId,
    })
    return violations
  }), [liveRows, periodId])
  const adjustmentTotals = useMemo(() => adjustments.filter((item) => item.status === 'active').reduce((result, item) => {
    if (item.type === 'bonus') result.bonus += item.amount
    else result.deduction += item.amount
    return result
  }, { bonus: 0, deduction: 0 }), [adjustments])
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
      <button type="button" role="tab" aria-selected={view === 'adjustments'} className={view === 'adjustments' ? 'is-active' : ''} onClick={() => setView('adjustments')}><Gift size={17} /> Thưởng / phạt</button>
      <button type="button" role="tab" aria-selected={view === 'policies'} className={view === 'policies' ? 'is-active' : ''} onClick={() => setView('policies')}><Settings2 size={17} /> Chính sách</button>
      <AuraHelpPopover title="Cách tính lương" label="Cách tính lương"><p>Tiền ca chỉ lấy từ ca đã điểm danh; hai học viên cùng HLV, ngày và giờ vẫn là một ca. Hoa hồng tách riêng, chỉ bằng 2–10% dòng tiền thực thu trong kỳ của hợp đồng có mã giới thiệu PT; khoản hoàn hoặc đảo thu làm giảm hoa hồng.</p></AuraHelpPopover>
    </div>

    {(message || (error && !payrollFailure)) && <div className={`payroll-page__notice ${error ? 'is-error' : 'is-success'}`} role="status">
      {error ? <AlertTriangle size={18} /> : <CheckCircle2 size={18} />}
      <span>{error || message}</span>
      <button type="button" aria-label="Đóng thông báo" onClick={() => { setError(''); setMessage(''); setPayrollFailure(null) }}><X size={16} /></button>
    </div>}

    {payrollFailure && !showRunSetup && <section className="payroll-violations" role="alert" aria-label="Chi tiết lỗi kỳ lương">
      <header><AlertTriangle size={20} /><div><strong>{payrollFailure.message}</strong><span>{payrollFailure.violations.length} vấn đề cần xử lý</span></div><button type="button" aria-label="Đóng cảnh báo" onClick={() => { setPayrollFailure(null); setError('') }}><X size={17} /></button></header>
      <div className="payroll-violations__list">{payrollFailure.violations.length ? payrollFailure.violations.map((violation, index) => <article key={`${violation.code}:${violation.sessionId || violation.staffId || index}`}>
        <div><span>{violation.code}</span><strong>{violation.title}</strong><p>{violation.detail}</p>{(violation.staffName || violation.staffId || violation.trainerId || violation.studentId || violation.studentIds?.length || violation.date || violation.sessionId || violation.supportId) && <small>{[violationFacts(violation, trainers, students, branches), violation.supportId ? `Mã đối soát ${violation.supportId}` : ''].filter(Boolean).join(' · ')}</small>}</div>
        <button type="button" onClick={() => handleViolationAction(violation)}>{remediationLabel[violation.remediation]}<ChevronRight size={15} /></button>
      </article>) : <article><div><strong>Chưa nhận được chi tiết từ máy chủ</strong><p>Hãy thử lại một lần. Aura sẽ ghi mã đối soát nếu giao dịch tiếp tục thất bại.</p></div><button type="button" onClick={() => void refresh()}>Thử lại<RefreshCw size={15} /></button></article>}</div>
    </section>}

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
              <div className="payroll-run-card__metrics"><span><b>{run.staffCount}</b> nhân viên</span><span><b>{run.requiresRebuild ? run.storedTeachingSlotCount || run.attendanceEventCount : run.teachingSlotCount}</b> {run.requiresRebuild ? 'lượt dữ liệu cũ' : 'ca dạy'}</span><span><b>{run.attendanceReviewRequiredCount + run.calendarReviewRequiredCount + run.teachingEvidenceReviewRequiredCount + run.validationViolationCount}</b> cần đối soát</span></div>
              <p>{run.policyName || `Chính sách v${run.policyVersion}`}<ChevronRight size={17} /></p>
            </button>
            <div className="payroll-run-card__actions">
              {run.status === 'draft' && <><button className="is-danger-ghost" type="button" disabled={!!busyAction} onClick={() => setPendingConfirmation({ kind: 'delete-run', id: run.id, label: periodLabel(run.periodId) })}><Trash2 size={15} /> Xóa nháp</button><button type="button" disabled={!!busyAction || run.requiresRebuild || run.attendanceReviewRequired || !payrollPeriodEnded(run.periodId)} title={run.requiresRebuild ? 'Xóa kỳ nháp cũ và tạo lại trước khi gửi duyệt' : !payrollPeriodEnded(run.periodId) ? 'Chỉ gửi duyệt sau khi kỳ lương đã kết thúc' : run.attendanceReviewRequired ? 'Đối soát đủ ngày công, lịch làm việc và bằng chứng ca dạy trước khi gửi duyệt' : undefined} onClick={() => void runAction('review', run)}><FileCheck2 size={15} /> {run.requiresRebuild ? 'Cần tạo lại' : !payrollPeriodEnded(run.periodId) ? 'Chờ hết kỳ' : run.attendanceReviewRequired ? 'Chờ đối soát' : 'Gửi duyệt'}</button></>}
              {run.status === 'reviewed' && <button type="button" disabled={!!busyAction} onClick={() => void runAction('lock', run)}><LockKeyhole size={15} /> Khóa kỳ</button>}
              {run.status === 'locked' && <button type="button" onClick={() => void openRun(run.id)}><WalletCards size={15} /> Chi lương</button>}
              {run.status === 'paid' && <span><CheckCircle2 size={15} /> Đã hoàn tất</span>}
            </div>
          </article>)}
        </div> : <div className="payroll-page__empty"><UsersRound size={34} /><strong>Chưa có kỳ lương phù hợp</strong><p>Chọn kỳ khác hoặc tạo bản nháp từ dữ liệu điểm danh chính thức.</p></div>}
      </section>
    </> : view === 'adjustments' ? <section className="payroll-adjustments" aria-label="Thưởng và phạt theo kỳ">
      <div className="payroll-adjustments__summary">
        <div><span>Thưởng theo kỳ</span><strong>{money(adjustmentTotals.bonus)}</strong></div>
        <div><span>Khấu trừ theo kỳ</span><strong>{money(adjustmentTotals.deduction)}</strong></div>
        <p><ShieldCheck size={17} /> Thưởng tháng cố định được cài ở <button type="button" onClick={() => { window.location.hash = '#/admin-hr' }}>Hồ sơ đội ngũ</button>. Tab này dùng cho khoản phát sinh riêng từng kỳ và luôn lưu người tạo, lý do, bằng chứng.</p>
      </div>
      <div className="payroll-adjustments__layout">
        <div className="payroll-adjustments__form">
          <div className="payroll-page__section-title"><div><span>Khoản phát sinh</span><strong>Thêm thưởng / phạt</strong></div><small>{periodLabel(periodId)}</small></div>
          <label><span>Nhân viên</span><select value={adjustmentForm.staffId} onChange={(event) => setAdjustmentForm((current) => ({ ...current, staffId: event.target.value }))}><option value="">Chọn nhân viên</option>{liveRows.map((row) => <option key={row.staffId} value={row.staffId}>{row.name} · {branchById.get(row.branchId)?.name || 'Chưa gắn chi nhánh'}</option>)}</select></label>
          <div className="payroll-adjustments__type" role="radiogroup" aria-label="Loại điều chỉnh"><button type="button" role="radio" aria-checked={adjustmentForm.type === 'bonus'} className={adjustmentForm.type === 'bonus' ? 'is-active' : ''} onClick={() => setAdjustmentForm((current) => ({ ...current, type: 'bonus' }))}>Thưởng</button><button type="button" role="radio" aria-checked={adjustmentForm.type === 'deduction'} className={adjustmentForm.type === 'deduction' ? 'is-active is-deduction' : ''} onClick={() => setAdjustmentForm((current) => ({ ...current, type: 'deduction' }))}>Phạt / khấu trừ</button></div>
          <label><span>Số tiền</span><input type="number" min="1000" step="1000" inputMode="numeric" value={adjustmentForm.amount} onChange={(event) => setAdjustmentForm((current) => ({ ...current, amount: event.target.value }))} placeholder="Ví dụ: 200000" /></label>
          <label><span>Lý do bắt buộc</span><textarea rows={3} maxLength={500} value={adjustmentForm.reason} onChange={(event) => setAdjustmentForm((current) => ({ ...current, reason: event.target.value }))} placeholder="Nêu rõ thành tích hoặc vi phạm" /></label>
          <label><span>Bằng chứng / tham chiếu</span><input maxLength={200} value={adjustmentForm.evidenceReference} onChange={(event) => setAdjustmentForm((current) => ({ ...current, evidenceReference: event.target.value }))} placeholder="Biên bản, link hoặc mã ca" /></label>
          <button className="payroll-page__primary" type="button" disabled={!canManage || !!busyAction} onClick={() => void submitAdjustment()}><Save size={17} /> {busyAction === 'adjustment:create' ? 'Đang lưu…' : 'Lưu khoản phát sinh'}</button>
        </div>
        <div className="payroll-adjustments__history">
          <div className="payroll-page__section-title"><div><span>Nhật ký kỳ</span><strong>{adjustments.filter((item) => item.status === 'active').length} khoản đang áp dụng</strong></div><small>Không sửa chứng từ đã duyệt</small></div>
          {adjustments.length ? <div className="payroll-adjustments__list">{adjustments.map((item) => <article className={item.status === 'voided' ? 'is-voided' : ''} key={item.id}>
            <span className={item.type === 'bonus' ? 'is-bonus' : 'is-deduction'}>{item.type === 'bonus' ? 'Thưởng' : 'Khấu trừ'}</span>
            <div><strong>{item.staffSnapshot.name || trainerById.get(item.staffId)?.name || item.staffId}</strong><p>{item.reason}</p><small>{item.evidenceReference || 'Không có tham chiếu bổ sung'}{item.status === 'voided' ? ' · Đã hủy' : ''}</small></div>
            <b>{item.type === 'bonus' ? '+' : '−'}{money(item.amount)}</b>
            {item.status === 'active' && <button type="button" aria-label={`Hủy khoản của ${item.staffSnapshot.name || item.staffId}`} disabled={!!busyAction} onClick={() => void voidAdjustment(item.id)}><Trash2 size={15} /> Hủy</button>}
          </article>)}</div> : <div className="payroll-page__empty"><Gift size={30} /><strong>Chưa có thưởng/phạt phát sinh</strong><p>Thưởng tháng cố định vẫn tự lấy từ hồ sơ nhân viên. Chỉ thêm ở đây khi có khoản riêng của kỳ.</p></div>}
        </div>
      </div>
    </section> : <section className={`payroll-policy ${showPolicyForm ? 'is-creating' : ''}`} aria-label="Chính sách lương">
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
        {payrollFailure && <div className="payroll-violations payroll-violations--modal" role="alert">
          <header><AlertTriangle size={20} /><div><strong>{payrollFailure.message}</strong><span>{payrollFailure.violations.length || 1} vấn đề cần xử lý</span></div><button type="button" aria-label="Đóng cảnh báo" onClick={() => { setPayrollFailure(null); setError('') }}><X size={17} /></button></header>
          <div className="payroll-violations__list">{payrollFailure.violations.length ? payrollFailure.violations.map((violation, index) => <article key={`${violation.code}:${violation.sessionId || violation.staffId || violation.trainerId || index}`}><div><span>{violation.code}</span><strong>{violation.title}</strong><p>{violation.detail}</p>{(violation.staffName || violation.staffId || violation.trainerId || violation.studentId || violation.studentIds?.length || violation.date || violation.sessionId || violation.supportId) && <small>{[violationFacts(violation, trainers, students, branches), violation.supportId ? `Mã đối soát ${violation.supportId}` : ''].filter(Boolean).join(' · ')}</small>}</div><button type="button" onClick={() => handleViolationAction(violation)}>{remediationLabel[violation.remediation]}<ChevronRight size={15} /></button></article>) : <article><div><strong>Chưa nhận được chi tiết từ máy chủ</strong><p>Thử lại để Aura tạo mã đối soát chi tiết.</p></div><button type="button" onClick={() => void createConfiguredRun()}>Thử lại<RefreshCw size={15} /></button></article>}</div>
        </div>}
        <div className="payroll-run-setup__preflight" aria-label="Đối soát nhanh trước khi tạo kỳ">
          <span><small>Nhân viên</small><b>{runPreflight.staffCount}</b></span>
          <span><small>Ca tính lương</small><b>{runPreflight.teachingSlotCount}</b></span>
          <span className={runPreflight.reviewRequiredCount ? 'has-warning' : ''}><small>Cần đối soát</small><b>{runPreflight.reviewRequiredCount}</b></span>
          <span className={runPreflight.unconfiguredPolicyCount ? 'has-warning' : ''}><small>Thiếu chính sách</small><b>{runPreflight.unconfiguredPolicyCount}</b></span>
        </div>
        {!payrollPeriodEnded(periodId) && <p className="payroll-run-setup__warning"><Clock3 size={16} /> Có thể tạo bản nháp để xem dự tính, nhưng chỉ được gửi duyệt sau khi tháng này kết thúc.</p>}
        {(runPreflight.reviewRequiredCount > 0 || runPreflight.unconfiguredPolicyCount > 0) && <p className="payroll-run-setup__warning"><AlertTriangle size={16} /> Bản nháp vẫn có thể tạo. Hãy hoàn tất ngày công, lịch làm việc và chính sách trước khi gửi duyệt.</p>}
        {preflightViolations.length > 0 && <div className="payroll-preflight-issues" aria-label="Danh sách nhân viên cần đối soát">{preflightViolations.map((violation, index) => <button type="button" key={`${violation.code}:${violation.staffId}:${index}`} onClick={() => handleViolationAction(violation)}><AlertTriangle size={15} /><span><strong>{violation.title}</strong><small>{violation.detail}</small></span><ChevronRight size={15} /></button>)}</div>}
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

    {violationDialog && <div className="payroll-correction-modal" role="dialog" aria-modal="true" aria-labelledby="payroll-correction-title" onMouseDown={(event) => { if (event.target === event.currentTarget) setViolationDialog(null) }}>
      <section className="payroll-correction-modal__panel">
        <header><div><span>Đối soát ca dạy</span><strong id="payroll-correction-title">{violationDialog.title}</strong></div><button type="button" aria-label="Đóng chi tiết lỗi" onClick={() => setViolationDialog(null)}><X size={20} /></button></header>
        <div className="payroll-correction-modal__alert"><AlertTriangle size={21} /><div><strong>Không tự gộp hoặc xóa buổi</strong><p>{violationDialog.detail}</p></div></div>
        <dl className="payroll-correction-modal__facts">
          <div><dt>Thông tin đối soát</dt><dd>{violationFacts(violationDialog, trainers, students, branches)}</dd></div>
          {violationDialog.sessionIds?.length ? <div><dt>Mã các ca liên quan</dt><dd className="payroll-correction-modal__session-list">{violationDialog.sessionIds.map((sessionId) => <code key={sessionId}>{sessionId}</code>)}</dd></div> : null}
        </dl>
        <p className="payroll-correction-modal__guide">Hãy kiểm tra từng mã ca trong lịch sử tập và chỉ điều chỉnh bản ghi sai. Kỳ lương hiện tại vẫn được giữ nguyên phía sau popup; nếu kỳ đã duyệt hoặc đã khóa, tạo khoản điều chỉnh/kỳ bù thay vì sửa chứng từ cũ.</p>
        <footer><button className="payroll-page__secondary" type="button" onClick={() => setViolationDialog(null)}>Đóng, giữ kỳ lương</button></footer>
      </section>
    </div>}

    {pendingConfirmation && <div className="payroll-confirm" role="region" aria-label="Xác nhận thao tác"><section><span className="payroll-confirm__icon"><AlertTriangle size={24} /></span><strong>{pendingConfirmation.kind === 'rebuild-run' ? 'Lập lại kỳ theo ca chuẩn?' : pendingConfirmation.kind === 'delete-run' ? 'Xóa kỳ lương nháp?' : pendingConfirmation.action === 'delete' ? 'Xóa chính sách?' : pendingConfirmation.action === 'hide' ? 'Ẩn chính sách?' : 'Mở lại chính sách?'}</strong><p>{pendingConfirmation.kind === 'rebuild-run' ? `${pendingConfirmation.label} đang là bản nháp công thức cũ. Bản nháp và các dòng tính cũ sẽ được gỡ; sau đó Aura mở ngay bước chọn chính sách để lập lại. Chứng từ đã khóa không bị ảnh hưởng.` : pendingConfirmation.kind === 'delete-run' ? `${pendingConfirmation.label} chưa duyệt sẽ bị xóa cùng các dòng tính lương để bạn lập lại theo chính sách mới.` : pendingConfirmation.action === 'delete' ? `${pendingConfirmation.label} chưa được kỳ lương nào sử dụng và sẽ bị xóa.` : pendingConfirmation.action === 'hide' ? `${pendingConfirmation.label} sẽ không còn xuất hiện khi lập kỳ mới; các kỳ cũ không thay đổi.` : `${pendingConfirmation.label} sẽ lại xuất hiện trong danh sách chính sách có thể chọn.`}</p><div><button type="button" disabled={!!busyAction} onClick={() => setPendingConfirmation(null)}>Giữ lại</button><button className={pendingConfirmation.kind === 'delete-run' || pendingConfirmation.kind === 'rebuild-run' || pendingConfirmation.action === 'delete' ? 'is-danger' : ''} type="button" disabled={!!busyAction} onClick={() => void confirmDestructiveAction()}>{busyAction ? 'Đang xử lý…' : pendingConfirmation.kind === 'rebuild-run' ? 'Gỡ bản cũ & tiếp tục' : 'Xác nhận'}</button></div></section></div>}

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
          {detail.run.crossBranchWarningCount ? <p className="payroll-trainer-item__review"><AlertTriangle size={15} /> {detail.run.crossBranchWarningCount} ca có học viên tập khác cơ sở. Đây là cảnh báo đối soát, không chặn tính lương và mỗi PT + ngày + giờ vẫn chỉ tính một ca.</p> : null}
          {detail.run.validationViolations.length > 0 && <section className="payroll-violations payroll-violations--drawer" role="alert" aria-label="Cảnh báo trùng buổi trong kỳ lương">
            <header><AlertTriangle size={20} /><div><strong>Phát hiện {detail.run.validationViolations.length} học viên có nhiều buổi trong cùng ngày</strong><span>Đã rà soát các buổi hoàn thành trong {periodLabel(detail.run.periodId)}</span></div></header>
            <p className="payroll-violations__note">Các bản ghi này không được tự gộp hoặc tự xóa. Hãy mở lịch sử ca dạy để đối soát từng mã ca; kỳ đã duyệt/khóa vẫn giữ nguyên chứng từ và cần xử lý bằng điều chỉnh hoặc kỳ bù.</p>
            <div className="payroll-violations__list">{detail.run.validationViolations.map((violation, index) => <article key={`${violation.code}:${violation.studentId || index}:${violation.date || ''}`}>
              <div><span>{violation.code}</span><strong>{violation.title}</strong><p>{violation.detail}</p><small>{violationFacts(violation, trainers, students, branches)}</small></div>
              <button type="button" onClick={() => handleViolationAction(violation)}>Xem chi tiết & điều chỉnh<ChevronRight size={15} /></button>
            </article>)}</div>
          </section>}
          {detail.run.requiresRebuild && <div className="payroll-drawer__legacy-warning"><AlertTriangle size={20} /><div><strong>{detail.run.sourceDataStale ? 'Dữ liệu ca dạy vừa được điều chỉnh' : 'Kỳ lương dùng công thức cũ'}</strong><p>{detail.run.status === 'draft' ? detail.run.sourceDataStale ? 'Kỳ nháp đang giữ số liệu trước khi điều chỉnh ca. Hãy xóa và lập lại để tiền ca lấy đúng PT, ngày và giờ mới nhất.' : 'Hãy lập lại kỳ để mỗi PT + ngày + giờ chỉ tính một ca; tiền ca không cộng theo số học viên và hoa hồng giới thiệu chỉ lấy từ dòng tiền thực thu.' : 'Kỳ đã duyệt hoặc khóa được giữ nguyên để bảo toàn chứng từ. Chỉ các kỳ mới dùng công thức ca dạy độc nhất và hoa hồng theo dòng tiền.'}</p>{!detail.run.sourceDataStale && detail.run.storedTeachingSlotCount !== detail.run.teachingSlotCount && <small>Dữ liệu cũ: {detail.run.storedTeachingSlotCount || 0} lượt · Preview chuẩn: {detail.run.teachingSlotCount} ca.</small>}</div>{detail.run.status === 'draft' && <button type="button" onClick={() => { setPendingConfirmation({ kind: 'rebuild-run', id: detail.run.id, label: periodLabel(detail.run.periodId) }); setDetail(null) }}><RefreshCw size={15} /> Đối soát & lập lại</button>}</div>}
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
                  <div className="payroll-drawer__numbers"><span>{item.workdaySummary.paidDays} công đã chốt · {item.workdaySummary.estimatedPaidDays}/{item.workdaySummary.eligibleWorkdays} dự tính · {item.sessionCount} ca</span><strong>{money(item.finalAmount)}</strong></div>
                  <ChevronRight className="payroll-trainer-item__chevron" size={18} />
                </button>
                {expanded && <div className="payroll-trainer-item__detail">
                  <div className="payroll-trainer-item__components"><span>Lương cơ bản <b>{money(item.baseSalaryAmount)}</b></span><span>Ca dạy <b>{money(item.teachingPayAmount)}</b></span><span>Hoa hồng GT <b>{money(item.commissionAmount)}</b><small>{item.referralCommission ? `${item.referralCommission.rate}% trên ${money(item.referralCommission.netCashAmount)} thực thu` : 'Kỳ cũ chưa có bằng chứng dòng tiền'}</small></span><span>Thưởng <b>{money(item.bonusAmount)}</b><small>{item.manualBonusAmount ? `${money(item.recurringBonusAmount)} cố định + ${money(item.manualBonusAmount)} theo kỳ` : 'Thưởng tháng từ hồ sơ đội ngũ'}</small></span><span>Khấu trừ <b>{money(item.deductionAmount)}</b><small>{item.manualDeductionAmount ? `${money(item.manualDeductionAmount)} phạt theo kỳ` : 'Hoàn hoa hồng hoặc khoản đã duyệt'}</small></span></div>
                  <p className="payroll-trainer-item__formula"><ShieldCheck size={15} /> {item.attendanceEventCount} lượt điểm danh → <b>{item.sessionCount} ca tính tiền</b>. Hai học viên cùng ngày, giờ và PT chỉ tính một ca; ngày công không nhân thêm tiền ca.</p>
                  {item.payrollAdjustments.length > 0 && <div className="payroll-item-adjustments">{item.payrollAdjustments.map((adjustment) => <span key={adjustment.id}><em>{adjustment.type === 'bonus' ? 'Thưởng' : 'Phạt'}</em><strong>{adjustment.type === 'bonus' ? '+' : '−'}{money(adjustment.amount)}</strong><small>{adjustment.reason}{adjustment.evidenceReference ? ` · ${adjustment.evidenceReference}` : ''}</small></span>)}</div>}
                  {(item.attendanceReviewRequired || item.calendarReviewRequired) && <p className="payroll-trainer-item__review"><AlertTriangle size={15} /> {item.calendarReviewRequired ? 'Lịch làm việc chưa duyệt. ' : ''}{item.attendanceReviewRequired ? 'Ngày công còn thiếu hoặc cần xác minh.' : ''}</p>}
                  {item.workdayDays.length ? <div className="payroll-workday-table" role="table" aria-label={`Bảng ngày công của ${name}`}>
                    <div className="payroll-workday-table__head" role="row"><span role="columnheader">Ngày</span><span role="columnheader">Tình trạng</span><span role="columnheader">Ca dạy</span><span role="columnheader">Nguồn</span></div>
                    {item.workdayDays.map((day) => <div className="payroll-workday-table__row" role="row" key={day.date}>
                      <time role="cell">{dateLabel(day.date)}</time>
                      <span role="cell">{payrollWorkdayLabel(day.status, day.holidayName)}</span>
                      <b role="cell" className={day.teachingSlotCount ? 'has-teaching' : ''}>{day.teachingSlotCount} ca</b>
                      <small role="cell">{day.source === 'admin_override' ? 'Admin chốt' : day.source === 'teaching_slots' ? 'Ca dạy' : 'Lịch chuẩn'}</small>
                    </div>)}
                  </div> : <p className="payroll-trainer-item__legacy">Kỳ cũ chưa lưu bảng ngày công theo ngày. Mở tab Ngày công để đối soát trực tiếp.</p>}
                  <div className="payroll-trainer-item__tiers"><span>Ca 1–8 <b>{item.tierSummary.standardCount}</b><small>{money(item.tierSummary.standardAmount)}</small></span><span>Từ ca 9 <b>{item.tierSummary.afterThresholdCount}</b><small>{money(item.tierSummary.afterThresholdAmount)}</small></span><span>Ca tối <b>{item.tierSummary.afterThresholdEveningCount}</b><small>{money(item.tierSummary.afterThresholdEveningAmount)}</small></span></div>
                  {item.teachingSlots.length ? <div className="payroll-teaching-slots">{item.teachingSlots.map((slot) => <div key={slot.key} className={`payroll-teaching-slot${slot.crossBranchWarning ? ' is-warning' : ''}`}><time>{dateLabel(slot.date)} · {String(slot.hour).padStart(2, '0')}:00</time><span>Ca #{slot.dailyPosition} · {slot.studentCount} học viên{slot.crossBranchWarning ? ` · khác cơ sở (${slot.branchIds?.map((id) => branchById.get(id)?.name || id).join(', ')})` : ''}{slot.policyName ? ` · ${slot.policyName}` : ''}</span><em>{teachingTierLabel(slot.tier)}</em><strong>{money(slot.rate)}</strong></div>)}</div> : <p className="payroll-trainer-item__legacy">Kỳ cũ chưa lưu snapshot từng ca. Tạo kỳ mới để xem chi tiết ngày, giờ và số học viên.</p>}
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
