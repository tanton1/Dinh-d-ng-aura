import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  CalendarClock,
  Check,
  CircleDollarSign,
  Clock3,
  FilePenLine,
  FilePlus2,
  FileText,
  LoaderCircle,
  MoreHorizontal,
  PauseCircle,
  PlayCircle,
  PlusCircle,
  Printer,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Trash2,
  UserRoundCog,
  WalletCards,
  X,
} from 'lucide-react'
import type { Student, StudentContract } from '../../types'
import type { ViewId } from '../../types'
import { prepareContractRenewal, type PreparedContractRenewal } from '../../services/contractRenewalService'
import { listCashAccounts, type CashAccount } from '../../services/cashbookService'
import { useAuth } from '../../contexts/AuthContext'
import ContractPaymentPlanEditor from '../../components/contracts/ContractPaymentPlanEditor'
import { dividePaymentPlan, paymentPlanError, type PaymentPlanInstallment } from '../../domain/contracts/paymentPlan'
import { clearContractCreate, readContractCreate, rememberContractCreate } from '../contracts/contractCreateRecovery'
import FinanceIntentBoundary, { FinancePendingOperations } from '../../components/admin/pt/FinanceIntentBoundary'
import type { FinanceIntentOutcome, FinanceOperationDraft } from '../../services/financeOperationIntent'
import { getStudent360ContractWorkspace, mutateStudent360Contract, refreshStudent360Projection } from './student360Service'
import type {
  Student360ContractInstallment,
  Student360ContractMutation,
  Student360ContractRecord,
  Student360ContractWorkspace as Workspace,
  Student360Overview,
} from './types'
import './Student360ContractWorkspace.css'

const ContractSettlementPanel = lazy(() => import('./ContractSettlementPanel'))
const RenewContractModal = lazy(() => import('../../components/admin/pt/RenewContractModal'))
const ContractInvoice = lazy(() => import('../../components/admin/pt/ContractInvoice'))
const money = new Intl.NumberFormat('vi-VN')
const date = new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' })

type FormMode = 'create' | 'edit'
type Confirmation =
  | { action: 'freeze' | 'reopen'; title: string; message: string }
  | { action: 'cancel'; title: string; message: string }
  | { action: 'payment' | 'refund'; title: string; message: string; installment: Student360ContractInstallment }

interface ContractForm {
  packageId: string
  branchId: string
  startDate: string
  endDate: string
  totalSessions: number
  trainerIds: string[]
  nutritionPTIds: string[]
  totalPrice: number
  discount: number
  installments: PaymentPlanInstallment[]
  installmentsCustomized: boolean
  initialPayment: number
  initialPaymentMethod: 'cash' | 'transfer' | 'card'
  initialCashAccountId: string
  note: string
}

interface AddSessionsForm {
  extraSessions: number
  extraDurationMonths: number
  extraPrice: number
  paymentDueDate: string
  reason: string
}

interface Props {
  studentId: string
  overview: Student360Overview
  source: string
  isDemo: boolean
  onNavigate: (view: ViewId, studentId?: string, studentName?: string) => void
  onChanged: () => Promise<void>
  onNotice: (message: string) => void
}

function dateLabel(value?: string | null) {
  if (!value) return 'Chưa cập nhật'
  const parsed = new Date(`${value.slice(0, 10)}T12:00:00+07:00`)
  return Number.isNaN(parsed.getTime()) ? value : date.format(parsed)
}

function addMonths(value: string, months: number) {
  const [year, month, day] = value.split('-').map(Number)
  const targetMonth = month - 1 + months
  const targetYear = year + Math.floor(targetMonth / 12)
  const normalizedMonth = ((targetMonth % 12) + 12) % 12
  const lastDay = new Date(Date.UTC(targetYear, normalizedMonth + 1, 0)).getUTCDate()
  return `${targetYear}-${String(normalizedMonth + 1).padStart(2, '0')}-${String(Math.min(day, lastDay)).padStart(2, '0')}`
}

function statusLabel(contract: Student360ContractRecord) {
  const value = contract.status
  if (contract.handoverStatus === 'pending') return 'Chờ nối tiếp'
  if (contract.completionReason === 'quota_exhausted') return 'Hoàn tất · Hết buổi'
  if (contract.renewalSupersededBy) return 'Đã chuyển sang gói mới'
  if (value === 'active') return 'Đang hiệu lực'
  if (value === 'future') return 'Sắp hiệu lực'
  if (value === 'frozen') return 'Đang bảo lưu'
  if (value === 'cancelled') return 'Đã hủy'
  return 'Đã hết hạn'
}

function installmentLabel(value: Student360ContractInstallment['status']) {
  if (value === 'paid') return 'Đã thu'
  if (value === 'cancelled') return 'Đã hủy'
  return 'Chờ thu'
}

function toInvoiceStudent(workspace: Workspace): Student {
  return {
    id: workspace.student.id,
    name: workspace.student.name,
    phone: workspace.student.phone,
    email: workspace.student.email,
    sessionsPerWeek: 0,
    availableSlots: [],
  }
}

function toInvoiceContract(contract: Student360ContractRecord): StudentContract {
  return {
    ...contract,
    // Invoice view only supports the persisted contract statuses.  Invalid
    // records are never billable, so render them as expired here while the
    // Student 360 workspace continues to expose the canonical `invalid`
    // status and its data-quality warning.
    status: contract.status === 'invalid' ? 'expired' : contract.status,
    branchId: contract.branchId,
    trainerId: contract.trainerId,
    frozenAt: contract.frozenAt || undefined,
    totalPrice: contract.totalPrice || 0,
    paidAmount: contract.paidAmount || 0,
    discount: contract.discount || 0,
    installments: contract.installments.map((item) => ({ ...item, amount: item.amount || 0 })),
    extensions: contract.extensions.map((item) => ({ ...item, createdAt: item.createdAt || '' })),
    pausePeriods: contract.pausePeriods.map((item) => ({ ...item, type: item.type === 'preservation' ? 'preservation' as const : 'off' as const })),
  }
}

function demoWorkspace(overview: Student360Overview): Workspace {
  const contract = overview.contract
  const record: Student360ContractRecord | null = contract ? {
    id: contract.id,
    studentId: overview.studentId,
    branchId: overview.assignments.branchId || null,
    packageId: 'package-demo',
    packageName: contract.packageName,
    trainerId: overview.assignments.trainerIds[0] || null,
    trainerIds: overview.assignments.trainerIds,
    nutritionPTIds: overview.assignments.nutritionCoachIds,
    startDate: contract.startDate || '',
    endDate: contract.endDate || '',
    frozenAt: null,
    totalSessions: contract.totalSessions,
    usedSessions: contract.usedSessions,
    status: contract.status as Student360ContractRecord['status'],
    nextPaymentDate: contract.payment?.nextPaymentDate || null,
    installments: [],
    extensions: contract.extensions.map((item, index) => ({ id: item.id || `extension-${index}`, oldEndDate: item.oldEndDate || '', newEndDate: item.newEndDate || '', reason: item.reason || '', createdAt: null })),
    pausePeriods: contract.pausePeriods.map((item, index) => ({ requestId: item.requestId || `pause-${index}`, type: item.type, startDate: item.startDate, endDate: item.endDate, durationDays: item.durationDays || 0 })),
     note: '', revision: 1, updatedAt: overview.generatedAt, updatedByName: 'Admin Aura',
     totalPrice: contract.payment?.total || 0, paidAmount: contract.payment?.paid || 0, discount: 0,
     usage: { storedUsedSessions: contract.storedUsedSessions, chargedSessions: contract.chargedSessions, attendedSessions: contract.chargedSessions, noShowSessions: 0, chargedNoShowSessions: 0, exemptSessions: contract.exemptSessions, pendingReconciliationSessions: contract.pendingReconciliationSessions, usedSessions: contract.usedSessions, remainingSessions: contract.remainingSessions, reconciliationStatus: contract.reconciliationStatus },
   } : null
  return {
    schemaVersion: 1,
    student: { id: overview.studentId, name: overview.identity.name, phone: overview.identity.phone, email: overview.identity.email },
    activeContractId: record?.id || null,
    permissions: { canManageContract: true, canCreateContract: true, canEditFinancialTerms: true, canCollectPayments: true, canViewFinancialAmounts: true },
    contracts: record ? [record] : [],
    packages: [{ id: 'package-demo', name: contract?.packageName || 'PT 1:1 · 6 tháng', totalSessions: contract?.totalSessions || 72, price: contract?.payment?.total || 18_000_000, durationMonths: 6, branchId: overview.assignments.branchId || null }],
    trainers: overview.assignments.trainerIds.map((id, index) => ({
      id,
      name: overview.assignments.trainerNames[index] || id,
      branchId: overview.assignments.branchId || null,
      branchName: overview.assignments.branchName || null,
      status: 'active',
      referencedByContract: true,
    })),
    branches: [{ id: overview.assignments.branchId || 'branch-demo', name: overview.assignments.branchName || 'Aura Fitness' }],
  }
}

function formFor(workspace: Workspace, contract?: Student360ContractRecord): ContractForm {
  const selectedPackage = workspace.packages.find((item) => item.id === contract?.packageId) || workspace.packages[0]
  const startDate = contract?.startDate || new Date().toISOString().slice(0, 10)
  return {
    packageId: contract?.packageId || selectedPackage?.id || '',
    branchId: contract?.branchId || workspace.branches[0]?.id || '',
    startDate,
    endDate: contract?.endDate || addMonths(startDate, selectedPackage?.durationMonths || 1),
    totalSessions: contract?.handoverStatus === 'pending' && contract.packageSessions ? contract.packageSessions + (contract.carriedOverSessions || 0) : contract?.totalSessions ?? selectedPackage?.totalSessions ?? 0,
    trainerIds: contract?.trainerIds || [],
    nutritionPTIds: contract?.nutritionPTIds || [],
    totalPrice: contract?.totalPrice ?? selectedPackage?.price ?? 0,
    discount: contract?.discount || 0,
    installments: (contract?.installments || []).map(item => ({ ...item, amount: item.amount || 0 })),
    installmentsCustomized: Boolean(contract),
    initialPayment: 0,
    initialPaymentMethod: 'transfer',
    initialCashAccountId: '',
    note: contract?.note || '',
  }
}

export default function Student360ContractWorkspace(props: Props) {
  const { user, profile, authzReady } = useAuth()
  const authority = JSON.stringify([props.studentId, user?.uid, profile?.uid, profile?.role, profile?.accessRole, profile?.authzVersion, profile?.disabled, profile?.branchId, [...(profile?.positions || [])].sort(), authzReady])
  return <ContractWorkspaceSession key={authority} {...props} ownerUid={user?.uid || profile?.uid || ''} />
}

function ContractWorkspaceSession({ studentId, overview, source, isDemo, onNavigate, onChanged, onNotice, ownerUid }: Props & { ownerUid: string }) {
  const mounted = useRef(true)
  const cashRequest = useRef(0)
  const workspaceRequest = useRef(0)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; cashRequest.current++; workspaceRequest.current++ } }, [])
  const [workspace, setWorkspace] = useState<Workspace | null>(null)
  const [selectedId, setSelectedId] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [createChoiceOpen, setCreateChoiceOpen] = useState(false)
  const [preparingRenewal, setPreparingRenewal] = useState(false)
  const [preparedRenewal, setPreparedRenewal] = useState<PreparedContractRenewal | null>(null)
  const [formMode, setFormMode] = useState<FormMode | null>(null)
  const [paymentPlanOnly, setPaymentPlanOnly] = useState(false)
  const [form, setForm] = useState<ContractForm | null>(null)
  const createId = useRef('')
  const createDraft = useRef<ContractForm | null>(null)
  const [pendingCreate, setPendingCreate] = useState<Extract<Student360ContractMutation, { action: 'create' }> | null>(() => readContractCreate(ownerUid, studentId)?.input || null)
  const mutationInFlight = useRef(false)
  const [initialCashAccounts, setInitialCashAccounts] = useState<CashAccount[]>([])
  const [initialCashLoading, setInitialCashLoading] = useState(false)
  const [initialCashError, setInitialCashError] = useState('')
  const [initialCashAttempt, setInitialCashAttempt] = useState(0)
  const [extendOpen, setExtendOpen] = useState(false)
  const [addSessionsForm, setAddSessionsForm] = useState<AddSessionsForm | null>(null)
  const [newEndDate, setNewEndDate] = useState('')
  const [reason, setReason] = useState('')
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null)
  const [invoiceOpen, setInvoiceOpen] = useState(false)
  const [financeOpen, setFinanceOpen] = useState(false)
  const [cashAccounts, setCashAccounts] = useState<CashAccount[]>([])
  const [cashAccountId, setCashAccountId] = useState('')
  const [paymentMethod, setPaymentMethod] = useState('transfer')

  const load = useCallback(async () => {
    const sequence = ++workspaceRequest.current
    setLoading(true)
    setError('')
    try {
      const next = isDemo ? demoWorkspace(overview) : await getStudent360ContractWorkspace(studentId)
      if (!mounted.current || sequence !== workspaceRequest.current) return
      setWorkspace(next)
      setSelectedId((current) => next.contracts.some((item) => item.id === current) ? current : next.activeContractId || next.contracts[0]?.id || '')
    } catch (cause) {
      if (mounted.current && sequence === workspaceRequest.current) {
        const code = cause && typeof cause === 'object' && 'code' in cause ? String(cause.code) : ''
        if (/permission-denied|unauthenticated/.test(code)) { setWorkspace(null); setSelectedId('') }
        setError(cause instanceof Error ? cause.message : 'Không thể tải nghiệp vụ hợp đồng.')
      }
    } finally {
      if (mounted.current && sequence === workspaceRequest.current) setLoading(false)
    }
  }, [isDemo, overview, studentId])

  useEffect(() => { void load() }, [load])
  const selected = useMemo(() => workspace?.contracts.find((item) => item.id === selectedId) || null, [selectedId, workspace])
  useEffect(() => { cashRequest.current++; setFinanceOpen(false); setCashAccounts([]); setCashAccountId('') }, [selectedId])
  const trainerById = useMemo(() => new Map((workspace?.trainers || []).map((item) => [item.id, item])), [workspace?.trainers])
  const selectableTrainers = useMemo(() => {
    if (!workspace || !form) return []
    return workspace.trainers.filter((item) => item.status !== 'inactive' && (!item.branchId || item.branchId === form.branchId))
  }, [form, workspace])
  const assignmentIssues = useMemo(() => {
    if (!form) return []
    const rows: Array<{ id: string; kind: 'trainer' | 'nutrition'; name: string; reason: string }> = []
    const inspect = (id: string, kind: 'trainer' | 'nutrition') => {
      const trainer = trainerById.get(id)
      if (!trainer) {
        rows.push({ id, kind, name: 'PT/coach không còn trong hệ thống', reason: 'Không tìm thấy hồ sơ nhân sự' })
      } else if (trainer.status === 'inactive') {
        rows.push({ id, kind, name: trainer.name, reason: 'Nhân sự đã ngừng hoạt động' })
      } else if (form.branchId && trainer.branchId && trainer.branchId !== form.branchId) {
        rows.push({ id, kind, name: trainer.name, reason: `Đang thuộc ${trainer.branchName || 'chi nhánh khác'}` })
      }
    }
    form.trainerIds.forEach((id) => inspect(id, 'trainer'))
    form.nutritionPTIds.forEach((id) => inspect(id, 'nutrition'))
    return rows
  }, [form, trainerById])
  const waitingContract = workspace?.contracts.find((item) => item.handoverStatus === 'pending' || (item.status === 'future' && item.sourceContractId))
  const renewalSource = workspace?.contracts.find((item) => ['active', 'frozen'].includes(item.status) && !item.renewedByContractId)
    || workspace?.contracts.find((item) => item.status === 'expired' && !item.renewedByContractId && !item.renewalSupersededBy)
  const selectedUsage = selected?.usage
  const selectedUsedSessions = selectedUsage?.usedSessions ?? selected?.usedSessions ?? 0
  const selectedEntitlement = selected?.handoverStatus === 'pending' && selected.packageSessions
    ? selected.packageSessions + (selected.carriedOverSessions || 0) : selected?.totalSessions || 0
  const selectedRemainingSessions = Math.min(selectedUsage?.remainingSessions ?? Number.MAX_SAFE_INTEGER,
    Math.max(0, selectedEntitlement - selectedUsedSessions - (selected?.carryOverTransferredSessions || 0)))
  const outstanding = selected && selected.totalPrice !== undefined
    ? Math.max(0, selected.totalPrice - (selected.discount || 0) - (selected.paidAmount || 0))
    : null

  const formRemaining = form ? form.totalPrice - form.discount - (formMode === 'create' ? form.initialPayment : selected?.paidAmount || 0) : 0
  const formInstallments = useMemo(() => {
    if (!form) return []
    if (formRemaining === 0) return form.installments.filter(item => item.status !== 'pending')
    return formMode === 'create' && !form.installmentsCustomized
      ? dividePaymentPlan(formRemaining, 1, form.startDate, form.endDate) : form.installments
  }, [form, formMode, formRemaining])

  // Load funds only when the creator actually enters a payment. The selected
  // existing contract must not determine the new contract's cash-account scope.
  const needsInitialCash = formMode === 'create' && Boolean(form?.initialPayment) && !pendingCreate && Boolean(workspace?.permissions.canCollectPayments)
  const initialBranch = form?.branchId || ''
  useEffect(() => {
    if (!needsInitialCash) return
    let active = true
    setInitialCashAccounts([]); setInitialCashError(''); setInitialCashLoading(true)
    void listCashAccounts().then(result => {
      if (!active) return
      const accounts = result.accounts.filter(item => item.status === 'active' && (!item.branchId || item.branchId === initialBranch))
      setInitialCashAccounts(accounts)
      setForm(current => current ? { ...current, initialCashAccountId: accounts.some(item => item.id === current.initialCashAccountId) ? current.initialCashAccountId : accounts[0]?.id || '' } : current)
    }).catch(cause => { if (active) setInitialCashError(cause instanceof Error ? cause.message : 'Không thể tải quỹ nhận tiền.') })
      .finally(() => { if (active) setInitialCashLoading(false) })
    return () => { active = false }
  }, [needsInitialCash, initialBranch, initialCashAttempt])

  const mutate = async (input: Student360ContractMutation, success: string) => {
    if (mutationInFlight.current) return
    mutationInFlight.current = true
    setSaving(true)
    try {
      if (input.action === 'create' && !isDemo) rememberContractCreate({ ownerUid, input })
      const result = !isDemo ? await mutateStudent360Contract(input) : null
      if (input.action === 'create') { clearContractCreate(ownerUid, studentId, input.contractId); setPendingCreate(null); createId.current = ''; createDraft.current = null }
      if (!mounted.current) return
      if (input.action === 'create' && result?.contractId) setSelectedId(result.contractId)
      setFormMode(null)
      setExtendOpen(false)
      setAddSessionsForm(null)
      setConfirmation(null)
      setReason('')
      onNotice(result?.receiptVoucherNumber ? `${success} Đã tạo phiếu thu ${result.receiptVoucherNumber}.` : success)
      await load()
      try { await onChanged() } catch { if (mounted.current) onNotice(`${success} Vui lòng tải lại hồ sơ để xem dữ liệu mới.`) }
    } catch (cause) {
      if (input.action === 'create') {
        const code = cause && typeof cause === 'object' && 'code' in cause ? String(cause.code) : ''
        if (/invalid-argument|failed-precondition|aborted|permission-denied|not-found/.test(code)) { clearContractCreate(ownerUid, studentId, input.contractId); setPendingCreate(null) }
      }
      onNotice(cause instanceof Error ? cause.message : 'Không thể cập nhật hợp đồng.')
    } finally {
      mutationInFlight.current = false
      setSaving(false)
    }
  }

  const openForm = (mode: FormMode, independent = false) => {
    if (!workspace) return
    setPaymentPlanOnly(false)
    if (mode === 'create' && pendingCreate) {
      setCreateChoiceOpen(false); setFormMode('create')
      setForm(createDraft.current ? structuredClone(createDraft.current) : {
        ...formFor(workspace), ...pendingCreate.contract, installmentsCustomized: true,
        initialPayment: pendingCreate.initialPayment?.amount || 0,
        initialPaymentMethod: pendingCreate.initialPayment?.paymentMethod || 'transfer',
        initialCashAccountId: pendingCreate.initialPayment?.cashAccountId || '',
      } as ContractForm)
      return
    }
    if (mode === 'create' && !independent && (renewalSource || waitingContract)) { setCreateChoiceOpen(true); return }
    setCreateChoiceOpen(false)
    setFormMode(mode)
    if (mode === 'create') createId.current = crypto.randomUUID()
    setForm(formFor(workspace, mode === 'edit' ? selected || undefined : undefined))
  }

  const openRenewal = async () => {
    if (!renewalSource) return
    if (isDemo) { onNotice('Cần đăng nhập để tạo hợp đồng nối tiếp và báo giá.'); return }
    setPreparingRenewal(true)
    try {
      const prepared = await prepareContractRenewal(renewalSource.id)
      setPreparedRenewal(prepared)
      setCreateChoiceOpen(false)
    } catch (cause) { onNotice(cause instanceof Error ? cause.message : 'Không thể mở hồ sơ nối tiếp.') }
    finally { setPreparingRenewal(false) }
  }

  const updatePackage = (packageId: string) => {
    if (!workspace || !form) return
    const item = workspace.packages.find((value) => value.id === packageId)
    if (!item) return
    setForm({ ...form, packageId, totalSessions: item.totalSessions, totalPrice: item.price, endDate: addMonths(form.startDate, item.durationMonths) })
  }

  const removeAssignmentIssue = (id: string, kind: 'trainer' | 'nutrition') => {
    if (!form) return
    setForm(kind === 'trainer'
      ? { ...form, trainerIds: form.trainerIds.filter((value) => value !== id) }
      : { ...form, nutritionPTIds: form.nutritionPTIds.filter((value) => value !== id) })
  }

  const removeAllAssignmentIssues = () => {
    if (!form || !assignmentIssues.length) return
    const invalidTrainerIds = new Set(assignmentIssues.filter((item) => item.kind === 'trainer').map((item) => item.id))
    const invalidNutritionIds = new Set(assignmentIssues.filter((item) => item.kind === 'nutrition').map((item) => item.id))
    setForm({
      ...form,
      trainerIds: form.trainerIds.filter((id) => !invalidTrainerIds.has(id)),
      nutritionPTIds: form.nutritionPTIds.filter((id) => !invalidNutritionIds.has(id)),
    })
  }

  const saveForm = async () => {
    if (!workspace || !form) return
    if (formMode === 'create' && pendingCreate) {
      await mutate(pendingCreate, 'Đã tạo hợp đồng mới trong Học viên 360.')
      return
    }
    const payload: Record<string, unknown> = {
      packageId: form.packageId,
      branchId: form.branchId,
      startDate: form.startDate,
      endDate: form.endDate,
      totalSessions: form.totalSessions,
      trainerIds: form.trainerIds,
      nutritionPTIds: form.nutritionPTIds,
      note: form.note,
    }
    if (workspace.permissions.canEditFinancialTerms) {
      const issue = paymentPlanError(formInstallments, formRemaining, formMode === 'create' ? { minDate: form.startDate, maxDate: form.endDate } : {})
      if (issue) { onNotice(issue); return }
      payload.totalPrice = form.totalPrice
      payload.discount = form.discount
      payload.installments = formInstallments
    }
    if (formMode === 'create') {
      if (!Number.isSafeInteger(form.initialPayment) || form.initialPayment < 0) { onNotice('Số tiền trả trước không hợp lệ.'); return }
      if (form.initialPayment > 0 && (!workspace.permissions.canCollectPayments || initialCashLoading || !initialCashAccounts.some(item => item.id === form.initialCashAccountId && (!item.branchId || item.branchId === form.branchId)))) { onNotice('Vui lòng chọn quỹ nhận tiền trả trước hợp lệ.'); return }
      if (!createId.current) createId.current = crypto.randomUUID()
      const command = { studentId, contractId: createId.current, action: 'create' as const, contract: structuredClone(payload), ...(form.initialPayment > 0 ? { initialPayment: { amount: form.initialPayment, paymentMethod: form.initialPaymentMethod, cashAccountId: form.initialCashAccountId } } : {}) }
      createDraft.current = structuredClone({ ...form, installments: formInstallments, installmentsCustomized: true })
      setPendingCreate(command)
      await mutate(command, 'Đã tạo hợp đồng mới trong Học viên 360.')
    } else if (selected) {
      await mutate(paymentPlanOnly
        ? { studentId, contractId: selected.id, expectedRevision: selected.revision, action: 'edit_payment_plan', installments: formInstallments }
        : { studentId, contractId: selected.id, expectedRevision: selected.revision, action: 'edit', contract: payload }, paymentPlanOnly ? 'Đã cập nhật lịch thanh toán.' : 'Đã cập nhật hợp đồng và lưu audit.')
    }
  }

  const openFinance = async () => {
    if (!workspace?.permissions.canCollectPayments || selected?.status === 'cancelled') return
    if (financeOpen) { cashRequest.current++; setFinanceOpen(false); return }
    setFinanceOpen(true)
    const sequence = ++cashRequest.current
    setCashAccounts([])
    setCashAccountId('')
    try {
      const result = await listCashAccounts()
      if (!mounted.current || sequence !== cashRequest.current) return
      const allowed = result.accounts.filter((item) => item.status === 'active' && (!selected?.branchId || item.branchId === selected.branchId))
      setCashAccounts(allowed)
      setCashAccountId(allowed[0]?.id || '')
    } catch (cause) {
      if (mounted.current && sequence === cashRequest.current) onNotice(cause instanceof Error ? cause.message : 'Không thể tải danh sách quỹ.')
    }
  }

  const openAddSessions = () => {
    if (!selected) return
    setAddSessionsForm({
      extraSessions: 1,
      extraDurationMonths: 0,
      extraPrice: 0,
      paymentDueDate: new Date().toISOString().slice(0, 10),
      reason: '',
    })
  }

  const saveAddSessions = async () => {
    if (!selected || !addSessionsForm) return
    await mutate({
      studentId,
      contractId: selected.id,
      expectedRevision: selected.revision,
      action: 'add_sessions',
      extraSessions: addSessionsForm.extraSessions,
      extraDurationMonths: addSessionsForm.extraDurationMonths,
      extraPrice: addSessionsForm.extraPrice,
      ...(addSessionsForm.extraPrice ? { paymentDueDate: addSessionsForm.paymentDueDate } : {}),
      reason: addSessionsForm.reason,
    }, addSessionsForm.extraPrice
      ? 'Đã bổ sung buổi và tạo kỳ phải thu. Có thể thu tiền ngay trong bảng Thanh toán.'
      : 'Đã bổ sung quyền lợi buổi tập và lưu CRM Timeline.')
  }

  const financeCompleted = async (outcome: FinanceIntentOutcome) => {
    if (!mounted.current) return
    setConfirmation(null)
    setReason('')
    if (outcome.state === 'committed') await refreshStudent360Projection(studentId).catch(() => undefined)
    if (!mounted.current) return
    await load()
    if (!mounted.current) return
    await onChanged()
    if (mounted.current) onNotice(outcome.state === 'committed' ? 'Đã xác nhận giao dịch được ghi nhận và cập nhật thanh toán.' : 'Đã dừng yêu cầu chưa ghi nhận. Có thể mở lại biểu mẫu để tạo yêu cầu mới.')
  }

  const submitInstallment = async (submit: (draft: FinanceOperationDraft) => Promise<void>) => {
    if (!confirmation || !selected || selected.status === 'cancelled' || (confirmation.action !== 'payment' && confirmation.action !== 'refund')) return
    if (isDemo) return onNotice('Cần đăng nhập để ghi nhận thanh toán.')
    if (!cashAccountId) return onNotice('Hãy chọn quỹ nhận hoặc chi tiền.')
    const installment = confirmation.installment
    const payload = { contractId: selected.id, amount: installment.amount || 0, effectiveAt: new Date().toISOString(), paymentMethod, cashAccountId, installmentId: installment.id, expectedPaidAmount: selected.paidAmount || 0 }
    await submit(confirmation.action === 'payment'
      ? { type: 'payment', payload: { ...payload, note: `Thu kỳ ${installment.id} từ Học viên 360` } }
      : { type: 'refund', payload: { ...payload, reason: reason.trim() || `Hoàn khoản thu kỳ ${installment.id} từ Học viên 360` } })
  }

  const executeConfirmation = async () => {
    if (!confirmation || !selected || confirmation.action === 'payment' || confirmation.action === 'refund') return
    if (confirmation.action === 'cancel') {
      await mutate({ studentId, contractId: selected.id, expectedRevision: selected.revision, action: 'cancel', reason: reason.trim(), cancelDebt: false }, 'Đã hủy hợp đồng; công nợ cũ vẫn được giữ để đối soát.')
      return
    }
    await mutate({ studentId, contractId: selected.id, expectedRevision: selected.revision, action: confirmation.action, reason: reason.trim() }, confirmation.action === 'freeze' ? 'Đã bảo lưu hợp đồng.' : 'Đã mở lại hợp đồng và cộng thời gian bảo lưu.')
  }

  const refreshSettlementSummary = async () => {
    let projectionFailed = false
    let projectionError: unknown
    try {
      if (overview.permissions.canRefreshProjection) await refreshStudent360Projection(studentId)
    } catch (cause) { projectionFailed = true; projectionError = cause }
    if (!mounted.current) return
    // The read rechecks current authority even if rebuilding the cached
    // projection failed. Its failure must not be hidden by the earlier error.
    await onChanged()
    if (projectionFailed) throw projectionError
  }

  if (loading && !workspace) return <div className="student360-contract-workspace-state"><LoaderCircle className="is-spinning" /><strong>Đang tải hồ sơ hợp đồng…</strong><span>Chỉ tải dữ liệu của học viên đang mở.</span></div>
  if (!workspace) return <div className="student360-contract-workspace-state is-error"><AlertTriangle /><strong>Chưa tải được nghiệp vụ hợp đồng</strong><span>{error}</span><button type="button" onClick={() => void load()}>Thử lại</button></div>

  return <div className="student360-contract-workspace">
    {loading && <p role="status">Đang cập nhật hồ sơ hợp đồng…</p>}
    {pendingCreate && !formMode && workspace.permissions.canCreateContract && <div className="student360-contract-reconciliation" role="status"><span>Có yêu cầu tạo hợp đồng đang chờ xác nhận kết quả.</span><button type="button" onClick={() => openForm('create')}>Kiểm tra hợp đồng đã gửi</button></div>}
    {error && <div role="alert" className="student360-contract-reconciliation"><AlertTriangle /><span>{error}</span><button type="button" onClick={() => void load()}>Thử lại</button></div>}
    <section className="student360-contract-commandbar">
      <div><small>Thao tác hợp đồng</small><strong>{selected ? selected.packageName : 'Quản lý quyền lợi học viên'}</strong><span>Thay đổi được lưu vào nhật ký để đối soát.</span></div>
      <div>
        {selected && selected.status !== 'cancelled' && workspace.permissions.canManageContract && <button type="button" onClick={() => openForm('edit')}><FilePenLine /> Chỉnh sửa</button>}
        {workspace.permissions.canCreateContract && <button type="button" onClick={() => openForm('create')}><FilePlus2 /> Tạo hợp đồng</button>}
        {selected && <details className="student360-contract-more-actions"><summary><MoreHorizontal /> Thêm</summary><div>
          {workspace.permissions.canViewFinancialAmounts && <button type="button" onClick={() => setInvoiceOpen(true)}><Printer /> Xem / In hợp đồng</button>}
          {workspace.permissions.canEditFinancialTerms && ['active', 'future', 'frozen'].includes(selected.status) && <button type="button" onClick={openAddSessions}><PlusCircle /> Mua thêm buổi</button>}
          {workspace.permissions.canManageContract && selected.status !== 'cancelled' && <button type="button" onClick={() => { setNewEndDate(selected.endDate); setReason(''); setExtendOpen(true) }}><CalendarClock /> Gia hạn ngày</button>}
          {workspace.permissions.canManageContract && selected.status === 'active' && <button type="button" onClick={() => setConfirmation({ action: 'freeze', title: 'Xác nhận bảo lưu', message: 'Học viên sẽ tạm ngừng nhận lịch mới. Quyền lợi và lịch sử vẫn được giữ nguyên.' })}><PauseCircle /> Bảo lưu</button>}
          {workspace.permissions.canManageContract && selected.status === 'frozen' && <button type="button" onClick={() => setConfirmation({ action: 'reopen', title: 'Mở lại hợp đồng', message: 'Aura sẽ cộng số ngày bảo lưu vào ngày hết hạn và cho phép xếp lịch trở lại.' })}><PlayCircle /> Mở bảo lưu</button>}
          {overview.permissions.canViewRenewal && <button type="button" onClick={() => onNavigate(source.startsWith('staff') ? 'staff-renewals' : 'admin-renewals', studentId, workspace.student.name)}><Sparkles /> Mở hồ sơ tái ký</button>}
          {workspace.permissions.canManageContract && selected.status !== 'cancelled' && <button type="button" className="is-danger" onClick={() => { setReason(''); setConfirmation({ action: 'cancel', title: 'Hủy hợp đồng', message: 'Hợp đồng sẽ dừng hiệu lực. Công nợ không bị xóa và lịch sử vẫn được giữ.' }) }}><Trash2 /> Hủy hợp đồng</button>}
        </div></details>}
      </div>
    </section>

    {selected && !isDemo && workspace.permissions.canCollectPayments && <FinancePendingOperations contractId={selected.id} describeContract={() => `${workspace.student.name} · ${selected.packageName}`} onCompleted={financeCompleted} />}
    {workspace.contracts.length > 1 && <section className="student360-contract-history-strip" aria-label="Lịch sử hợp đồng">
      {workspace.contracts.map((item) => <button type="button" key={item.id} className={selectedId === item.id ? 'active' : ''} aria-current={selectedId === item.id ? 'true' : undefined} title={`${item.packageName} · ${dateLabel(item.startDate)} → ${dateLabel(item.endDate)}`} onClick={() => setSelectedId(item.id)}><span className={`is-${item.status}`}>{statusLabel(item)}</span><strong>{item.packageName}</strong><small>{dateLabel(item.startDate)} → {dateLabel(item.endDate)}</small></button>)}
    </section>}

    {!selected ? <div className="student360-contract-workspace-state"><FileText /><strong>Chưa có hợp đồng</strong><span>Tạo hợp đồng đầu tiên ngay tại đây, không cần quay lại hồ sơ cũ.</span>{workspace.permissions.canCreateContract && <button type="button" onClick={() => openForm('create')}>Tạo hợp đồng mới</button>}</div> : <>
      <section className="student360-contract-live-summary">
        <header><div><span className={`is-${selected.status}`}>{statusLabel(selected)}</span><h3>{selected.packageName}</h3><p>{dateLabel(selected.startDate)} → {dateLabel(selected.endDate)}</p></div><strong>{selectedRemainingSessions}<small>buổi còn lại</small></strong></header>
        <div className="student360-contract-facts">
          <div><FileText /><span>Quyền lợi<b>{selectedUsedSessions}/{selectedEntitlement} buổi tính quota</b></span></div>
          <div><Clock3 /><span>Hiệu lực<b>{dateLabel(selected.startDate)} → {dateLabel(selected.endDate)}</b></span></div>
          <div><UserRoundCog /><span>PT phụ trách<b>{workspace.trainers.filter((item) => selected.trainerIds.includes(item.id)).map((item) => item.name).join(' · ') || 'Chưa phân công'}</b></span></div>
          <div><ShieldCheck /><span>Cập nhật gần nhất<b>{dateLabel(selected.updatedAt)}{selected.updatedByName ? ` · ${selected.updatedByName}` : ''}</b></span></div>
        </div>
        {selected.sourceContractId && <div className="student360-renewal-dates" aria-label="Mốc hợp đồng nối tiếp">
          <div><small>Ngày ký / mua</small><strong>{dateLabel(selected.signedDate || '')}</strong></div>
          <div><small>Bắt đầu dự kiến</small><strong>{dateLabel(selected.plannedActivationDate || selected.originalStartDate || selected.startDate)}</strong></div>
          <div><small>Kích hoạt thực tế</small><strong>{selected.activationDate ? dateLabel(selected.activationDate) : 'Chờ nối tiếp'}</strong></div>
          <p>{selected.activationMode === 'fixed_date' ? 'Bắt đầu ngày cố định.' : 'Tự mở khi gói cũ hết buổi hoặc hết hạn; giữ hạn kết thúc khi mở sớm.'} {selected.carryOverPending ? `Dự kiến chuyển tối đa ${selected.plannedCarryOverSessions || 0} buổi; chốt số thực tế lúc bàn giao.` : selected.carriedOverSessions ? `Đã nhận ${selected.carriedOverSessions} buổi từ gói trước.` : ''}</p>
        </div>}
        {Boolean(selected.carryOverTransferredSessions) && <p className="student360-contract-addon-note">Đã chuyển {selected.carryOverTransferredSessions} buổi sang hợp đồng nối tiếp.</p>}
        {selectedUsage && <div className="student360-contract-usage-chips"><span><b>{selectedUsage.attendedSessions}</b> buổi đã tập</span><span><b>{selectedUsage.chargedNoShowSessions}</b> vắng tính buổi</span><span><b>{selectedUsage.exemptSessions}</b> buổi miễn trừ</span><span><b>{selectedUsage.chargedSessions}</b> buổi tính quota</span><span><b>{selectedUsage.pendingReconciliationSessions}</b> chờ đối soát</span></div>}
        {selectedUsage && selectedUsage.reconciliationStatus !== 'matched' && <div className="student360-contract-reconciliation"><AlertTriangle /><span><strong>Cần đối soát số buổi</strong><small>Đã tập {selectedUsage.attendedSessions} · vắng tính buổi {selectedUsage.chargedNoShowSessions} · miễn trừ {selectedUsage.exemptSessions} · {selectedUsage.pendingReconciliationSessions} buổi chờ xác nhận.</small></span></div>}
      </section>

      {selected.status === 'cancelled' && workspace.permissions.canViewFinancialAmounts && !isDemo && <Suspense fallback={<p role="status">Đang mở quyết toán…</p>}><ContractSettlementPanel contractId={selected.id} branchId={selected.branchId} onChanged={refreshSettlementSummary} /></Suspense>}

      {workspace.permissions.canViewFinancialAmounts && selected.status !== 'cancelled' && <section className="student360-contract-payment-board">
        <header><div><WalletCards /><span><strong>Thanh toán & trả góp</strong><small>Thu tiền sinh phiếu thu; hoàn tiền sinh bút toán đối ứng.</small></span></div><div className="student360-payment-actions">{workspace.permissions.canManageContract && workspace.permissions.canEditFinancialTerms && <button type="button" onClick={() => { openForm('edit'); setPaymentPlanOnly(true) }}><FilePenLine /> Chỉnh lịch thanh toán</button>}{workspace.permissions.canCollectPayments && <button type="button" onClick={() => void openFinance()}><CircleDollarSign /> {financeOpen ? 'Đóng quản lý' : 'Quản lý thu tiền'}</button>}</div></header>
        <div className="student360-contract-money"><span>Giá trị <b>{money.format(selected.totalPrice || 0)}đ</b></span><span>Đã thu <b>{money.format(selected.paidAmount || 0)}đ</b></span><span>Còn nợ <b>{money.format(outstanding || 0)}đ</b></span></div>
        {financeOpen && workspace.permissions.canCollectPayments && <div className="student360-contract-cash-controls"><label>Quỹ nhận/chi<select value={cashAccountId} onChange={(event) => setCashAccountId(event.target.value)}><option value="">Chọn quỹ bắt buộc</option>{cashAccounts.map((item) => <option key={item.id} value={item.id}>{item.name} · {money.format(item.balance)}đ</option>)}</select></label><label>Phương thức<select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)}><option value="transfer">Chuyển khoản</option><option value="cash">Tiền mặt</option><option value="wallet">Ví điện tử</option></select></label></div>}
        <div className="student360-contract-installments">{selected.installments.map((item, index) => <article key={item.id} className={`is-${item.status}`}><span>{index + 1}</span><div><strong>{item.amount === undefined ? 'Đã ẩn số tiền' : `${money.format(item.amount)}đ`}</strong><small>Hạn {dateLabel(item.date)}</small></div><b>{installmentLabel(item.status)}</b>{financeOpen && item.status === 'pending' && <button type="button" onClick={() => setConfirmation({ action: 'payment', title: 'Xác nhận thu tiền', message: `Aura sẽ thu ${money.format(item.amount || 0)}đ vào quỹ đã chọn và tự tạo phiếu thu.`, installment: item })}>Thu tiền</button>}{financeOpen && item.status === 'paid' && <button type="button" onClick={() => { setReason(''); setConfirmation({ action: 'refund', title: 'Xác nhận hoàn tiền', message: `Aura sẽ tạo bút toán hoàn ${money.format(item.amount || 0)}đ; chứng từ thu cũ không bị xóa.`, installment: item }) }}><RotateCcw /> Hoàn tác</button>}</article>)}{selected.installments.length === 0 && <p>Hợp đồng chưa có lịch trả góp.</p>}</div>
      </section>}

      {(selected.pausePeriods.length > 0 || selected.extensions.length > 0) && <section className="student360-contract-ledger">
        <div><h3>OFF & bảo lưu</h3>{selected.pausePeriods.map((item) => <article key={item.requestId}><PauseCircle /><span><strong>{item.type === 'preservation' ? 'Bảo lưu' : 'OFF'} · {item.durationDays} ngày</strong><small>{dateLabel(item.startDate)} → {dateLabel(item.endDate)}</small></span></article>)}{selected.pausePeriods.length === 0 && <p>Chưa có kỳ OFF hoặc bảo lưu.</p>}</div>
        <div><h3>Lịch sử gia hạn ngày</h3>{selected.extensions.map((item) => <article key={item.id}><CalendarClock /><span><strong>{dateLabel(item.oldEndDate)} → {dateLabel(item.newEndDate)}</strong><small>{item.reason || 'Không có ghi chú'}</small></span></article>)}{selected.extensions.length === 0 && <p>Chưa gia hạn ngày hợp đồng.</p>}</div>
      </section>}
    </>}

    {formMode && form && <div className="student360-dialog-layer"><button type="button" className="student360-dialog-backdrop" aria-label="Đóng" onClick={() => setFormMode(null)} /><form className="student360-dialog student360-contract-form" onSubmit={(event) => { event.preventDefault(); void saveForm() }}><header><div><small>HỢP ĐỒNG 360</small><h2>{formMode === 'create' ? 'Tạo hợp đồng mới' : paymentPlanOnly ? 'Chỉnh lịch thanh toán' : 'Chỉnh sửa hợp đồng'}</h2></div><button type="button" onClick={() => setFormMode(null)}><X /></button></header>{pendingCreate && formMode === 'create' && !saving && <p role="alert">Yêu cầu tạo hợp đồng chưa rõ kết quả. Thông tin gốc được giữ nguyên khi kiểm tra lại.</p>}<fieldset className="student360-contract-create-fields" disabled={saving || (formMode === 'create' && Boolean(pendingCreate))}>{!paymentPlanOnly && <><div className="student360-contract-form-grid">
      <label>Gói tập<select required value={form.packageId} onChange={(event) => updatePackage(event.target.value)}><option value="">Chọn gói</option>{workspace.packages.filter((item) => !item.branchId || item.branchId === form.branchId).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label>Chi nhánh<select required value={form.branchId} onChange={(event) => setForm({ ...form, branchId: event.target.value })}>{workspace.branches.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label>Ngày bắt đầu<input required type="date" readOnly={formMode === 'edit' && selected?.handoverStatus === 'pending' && selected.activationMode === 'automatic'} value={form.startDate} onChange={(event) => setForm({ ...form, startDate: event.target.value })} /></label>
      <label>Ngày kết thúc<input required type="date" min={form.startDate} value={form.endDate} onChange={(event) => setForm({ ...form, endDate: event.target.value })} /></label>
      <label>Tổng số buổi<input required type="number" min={formMode === 'edit' ? selected?.usedSessions || 0 : 0} value={form.totalSessions} onChange={(event) => setForm({ ...form, totalSessions: Number(event.target.value) })} /></label>
      {workspace.permissions.canEditFinancialTerms && <><label>Giá trị hợp đồng<input required type="number" min="0" value={form.totalPrice} onChange={(event) => setForm({ ...form, totalPrice: Number(event.target.value) })} /></label><label>Giảm giá<input required type="number" min="0" max={form.totalPrice} value={form.discount} onChange={(event) => setForm({ ...form, discount: Number(event.target.value) })} /></label></>}
    </div>
      {assignmentIssues.length > 0 && <section className="student360-contract-assignment-issues" role="alert">
        <header><span><AlertTriangle /><strong>Liên kết PT cần xử lý</strong></span><button type="button" onClick={removeAllAssignmentIssues}>Gỡ tất cả</button></header>
        <p>Các liên kết cũ vẫn được hiện để bạn chủ động gỡ. Lịch sử ca dạy và hoa hồng không bị xóa.</p>
        <div>{assignmentIssues.map((item) => <article key={`${item.kind}-${item.id}`}><span><strong>{item.name}</strong><small>{item.kind === 'trainer' ? 'PT chính/phụ' : 'Coach dinh dưỡng'} · {item.reason}</small></span><button type="button" onClick={() => removeAssignmentIssue(item.id, item.kind)}>Gỡ</button></article>)}</div>
      </section>}
      <fieldset><legend>PT chính/phụ</legend><div className="student360-contract-person-picker">{selectableTrainers.map((item) => <label key={item.id}><input type="checkbox" checked={form.trainerIds.includes(item.id)} onChange={() => setForm({ ...form, trainerIds: form.trainerIds.includes(item.id) ? form.trainerIds.filter((id) => id !== item.id) : [...form.trainerIds, item.id] })} />{item.name}</label>)}</div></fieldset>
      <fieldset><legend>Coach dinh dưỡng</legend><div className="student360-contract-person-picker">{selectableTrainers.map((item) => <label key={item.id}><input type="checkbox" checked={form.nutritionPTIds.includes(item.id)} onChange={() => setForm({ ...form, nutritionPTIds: form.nutritionPTIds.includes(item.id) ? form.nutritionPTIds.filter((id) => id !== item.id) : [...form.nutritionPTIds, item.id] })} />{item.name}</label>)}</div></fieldset>
      </>}
      {formMode === 'create' && workspace.permissions.canCollectPayments && <fieldset className="student360-contract-upfront"><legend>Thanh toán</legend>
        <div className="student360-contract-form-grid">
          <label>Số tiền trả trước<input type="number" inputMode="numeric" min="0" step="1" max={Math.max(0, form.totalPrice - form.discount)} value={form.initialPayment || ''} placeholder="0" onChange={event => setForm({ ...form, initialPayment: Number(event.target.value) })} /></label>
          {form.initialPayment > 0 && <><label>Phương thức thanh toán<select aria-label="Phương thức thanh toán" value={form.initialPaymentMethod} onChange={event => setForm({ ...form, initialPaymentMethod: event.target.value as ContractForm['initialPaymentMethod'] })}><option value="transfer">Chuyển khoản</option><option value="cash">Tiền mặt</option><option value="card">Thẻ</option></select></label>
          <label>Quỹ nhận tiền<select aria-label="Quỹ nhận tiền" required disabled={initialCashLoading} value={form.initialCashAccountId} onChange={event => setForm({ ...form, initialCashAccountId: event.target.value })}><option value="">{initialCashLoading ? 'Đang tải quỹ…' : 'Chọn quỹ nhận tiền'}</option>{pendingCreate && !initialCashAccounts.some(item => item.id === form.initialCashAccountId) && <option value={form.initialCashAccountId}>Quỹ đã chọn trong yêu cầu</option>}{initialCashAccounts.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label></>}
        </div>
        {initialCashError && form.initialPayment > 0 && !pendingCreate && <p role="alert">{initialCashError} <button type="button" onClick={() => setInitialCashAttempt(value => value + 1)}>Tải lại quỹ</button></p>}
        {!initialCashLoading && !initialCashError && form.initialPayment > 0 && !pendingCreate && initialCashAccounts.length === 0 && <p role="alert">Chưa có quỹ nhận tiền đang hoạt động tại chi nhánh này.</p>}
        {form.initialPayment > 0 && <p className="student360-contract-upfront-note">Khi lưu thành công, tự tạo phiếu thu {money.format(form.initialPayment)}đ.</p>}
      </fieldset>}
      {workspace.permissions.canEditFinancialTerms && <ContractPaymentPlanEditor installments={formInstallments} remainingAmount={formRemaining} startDate={form.startDate} endDate={form.endDate} minDate={formMode === 'create' ? form.startDate : undefined} maxDate={formMode === 'create' ? form.endDate : undefined} onChange={items => setForm({ ...form, installments: items, installmentsCustomized: true })} />}
      {!paymentPlanOnly && <label>Ghi chú<textarea rows={3} maxLength={1000} value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} /></label>}</fieldset><footer><button type="button" onClick={() => setFormMode(null)}>Hủy</button><button type="submit" disabled={saving || (!paymentPlanOnly && assignmentIssues.length > 0)}>{saving ? 'Đang lưu…' : pendingCreate && formMode === 'create' ? 'Kiểm tra / tạo lại hợp đồng' : !paymentPlanOnly && assignmentIssues.length ? `Gỡ ${assignmentIssues.length} liên kết để lưu` : paymentPlanOnly ? 'Lưu lịch thanh toán' : 'Lưu hợp đồng'}</button></footer></form></div>}

    {extendOpen && selected && <div className="student360-dialog-layer"><button type="button" className="student360-dialog-backdrop" aria-label="Đóng" onClick={() => setExtendOpen(false)} /><form className="student360-dialog" onSubmit={(event) => { event.preventDefault(); void mutate({ studentId, contractId: selected.id, expectedRevision: selected.revision, action: 'extend', newEndDate, reason }, 'Đã gia hạn ngày và lưu vào CRM Timeline.') }}><header><div><small>GIA HẠN NGÀY</small><h2>Điều chỉnh hạn sử dụng</h2></div><button type="button" onClick={() => setExtendOpen(false)}><X /></button></header><p>Hạn hiện tại: <strong>{dateLabel(selected.endDate)}</strong></p><label>Ngày hết hạn mới<input required type="date" min={selected.endDate} value={newEndDate} onChange={(event) => setNewEndDate(event.target.value)} /></label><label>Lý do<textarea required minLength={2} rows={3} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Ví dụ: bù thời gian gián đoạn đã xác minh…" /></label><footer><button type="button" onClick={() => setExtendOpen(false)}>Hủy</button><button type="submit" disabled={saving}>{saving ? 'Đang lưu…' : 'Xác nhận gia hạn'}</button></footer></form></div>}

    {addSessionsForm && selected && <div className="student360-dialog-layer"><button type="button" className="student360-dialog-backdrop" aria-label="Đóng" onClick={() => setAddSessionsForm(null)} /><form className="student360-dialog student360-contract-addon" onSubmit={(event) => { event.preventDefault(); void saveAddSessions() }}><header><div><small>QUYỀN LỢI BỔ SUNG</small><h2>Mua thêm buổi</h2></div><button type="button" onClick={() => setAddSessionsForm(null)}><X /></button></header><div className="student360-contract-form-grid"><label>Số buổi mua thêm<input required type="number" min="1" max="100000" value={addSessionsForm.extraSessions} onChange={(event) => setAddSessionsForm({ ...addSessionsForm, extraSessions: Number(event.target.value) })} /></label><label>Gia hạn thêm (tháng)<input required type="number" min="0" max="120" value={addSessionsForm.extraDurationMonths} onChange={(event) => setAddSessionsForm({ ...addSessionsForm, extraDurationMonths: Number(event.target.value) })} /></label><label>Giá trị phát sinh<input required type="number" min="0" value={addSessionsForm.extraPrice} onChange={(event) => setAddSessionsForm({ ...addSessionsForm, extraPrice: Number(event.target.value) })} /></label>{addSessionsForm.extraPrice > 0 && <label>Ngày hẹn thanh toán<input required type="date" min={new Date().toISOString().slice(0, 10)} value={addSessionsForm.paymentDueDate} onChange={(event) => setAddSessionsForm({ ...addSessionsForm, paymentDueDate: event.target.value })} /></label>}</div><div className="student360-contract-addon-preview"><span><small>Tổng quyền lợi mới</small><strong>{selected.totalSessions + Math.max(0, addSessionsForm.extraSessions || 0)} buổi</strong></span><span><small>Hạn sử dụng mới</small><strong>{dateLabel(addMonths(selected.endDate, Math.max(0, addSessionsForm.extraDurationMonths || 0)))}</strong></span><span><small>Giá trị hợp đồng mới</small><strong>{money.format((selected.totalPrice || 0) + Math.max(0, addSessionsForm.extraPrice || 0))}đ</strong></span></div><label>Nội dung thỏa thuận<textarea required minLength={2} maxLength={500} rows={3} value={addSessionsForm.reason} onChange={(event) => setAddSessionsForm({ ...addSessionsForm, reason: event.target.value })} placeholder="Ví dụ: mua thêm 12 buổi theo báo giá ngày…" /></label><p className="student360-contract-addon-note"><ShieldCheck /> Aura tạo khoản phải thu riêng; tiền chỉ được ghi nhận sau khi thu qua phiếu thu, không tự tăng số đã thanh toán.</p><footer><button type="button" onClick={() => setAddSessionsForm(null)}>Hủy</button><button type="submit" disabled={saving || addSessionsForm.extraSessions < 1 || addSessionsForm.reason.trim().length < 2}>{saving ? 'Đang ghi nhận…' : 'Xác nhận mua thêm'}</button></footer></form></div>}

    {confirmation && <div className="student360-dialog-layer"><button type="button" className="student360-dialog-backdrop" aria-label="Đóng" onClick={() => setConfirmation(null)} /><section className="student360-dialog student360-confirm-dialog" role="alertdialog" aria-modal="true">
      <header><div><small>XÁC NHẬN NGHIỆP VỤ</small><h2>{confirmation.title}</h2></div><button type="button" onClick={() => setConfirmation(null)}><X /></button></header><p>{confirmation.message}</p>
      {(confirmation.action === 'payment' || confirmation.action === 'refund') && selected ? <FinanceIntentBoundary contractId={selected.id} onCompleted={financeCompleted}>{({ blocked, busy, submit }) => <>
        {confirmation.action === 'refund' && <label>Lý do hoàn tiền<textarea required minLength={2} rows={3} disabled={blocked || busy} value={reason} onChange={(event) => setReason(event.target.value)} /></label>}
        <footer><button type="button" onClick={() => setConfirmation(null)}>Quay lại</button><button type="button" disabled={blocked || busy || !cashAccountId || (confirmation.action === 'refund' && reason.trim().length < 2)} onClick={() => void submitInstallment(submit)}>{busy ? 'Đang xử lý…' : 'Xác nhận'}</button></footer>
      </>}</FinanceIntentBoundary> : <>
        {confirmation.action === 'cancel' && <label>Lý do hủy<textarea required minLength={2} rows={3} value={reason} onChange={(event) => setReason(event.target.value)} /></label>}
        <footer><button type="button" onClick={() => setConfirmation(null)}>Quay lại</button><button type="button" className={confirmation.action === 'cancel' ? 'is-danger' : ''} disabled={saving || (confirmation.action === 'cancel' && reason.trim().length < 2)} onClick={() => void executeConfirmation()}>{saving ? 'Đang xử lý…' : 'Xác nhận'}</button></footer>
      </>}
    </section></div>}

    {createChoiceOpen && <div className="student360-dialog-layer"><button type="button" className="student360-dialog-backdrop" aria-label="Đóng lựa chọn hợp đồng" onClick={() => !preparingRenewal && setCreateChoiceOpen(false)} /><section className="student360-dialog" role="dialog" aria-modal="true" aria-labelledby="renewal-choice-title">
      <header><div><small>HỢP ĐỒNG TIẾP THEO</small><h2 id="renewal-choice-title">{waitingContract ? 'Đã có hợp đồng chờ nối tiếp' : 'Tạo hợp đồng nối tiếp'}</h2></div><button type="button" disabled={preparingRenewal} onClick={() => setCreateChoiceOpen(false)} aria-label="Đóng"><X /></button></header>
      {waitingContract ? <><p>{waitingContract.packageName} đang chờ nối tiếp. Bạn có thể kiểm tra ngày bắt đầu và quyền lợi trước khi mua thêm.</p><footer><button type="button" onClick={() => { setSelectedId(waitingContract.id); setCreateChoiceOpen(false) }}>Xem hợp đồng đang chờ</button></footer></> : <>
        <p>Hợp đồng nguồn: <strong>{renewalSource?.packageName}</strong> · hết hạn {dateLabel(renewalSource?.endDate || '')}.</p>
        <p>Nối tiếp tự động giữ quyền tập ở gói cũ đến khi hết buổi hoặc hết hạn. Gói mới có thể thanh toán trước và mở sớm khi cần.</p>
        <footer><button type="button" disabled={preparingRenewal} onClick={() => openForm('create', true)}>Tạo hợp đồng độc lập</button>{overview.permissions.canViewRenewal && <button type="button" disabled={preparingRenewal} onClick={() => void openRenewal()}>{preparingRenewal ? 'Đang mở…' : 'Tiếp tục nối tiếp'}</button>}</footer>
      </>}
    </section></div>}
    {preparedRenewal && <Suspense fallback={<div role="status">Đang mở hợp đồng nối tiếp…</div>}><RenewContractModal row={preparedRenewal.row} options={preparedRenewal.options} scope={preparedRenewal.scope} onClose={() => setPreparedRenewal(null)} onSuccess={async () => { setPreparedRenewal(null); await load(); await onChanged(); onNotice('Đã tạo hợp đồng nối tiếp và ghi nhận thanh toán.'); }} /></Suspense>}
    {invoiceOpen && selected && <Suspense fallback={<div className="student360-dialog-layer"><div className="student360-contract-workspace-state"><LoaderCircle className="is-spinning" /> Đang mở hợp đồng…</div></div>}><ContractInvoice student={toInvoiceStudent(workspace)} contract={toInvoiceContract(selected)} onClose={() => setInvoiceOpen(false)} /></Suspense>}
  </div>
}
