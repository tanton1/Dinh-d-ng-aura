import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react'
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
import { listCashAccounts, type CashAccount } from '../../services/cashbookService'
import { recordContractPayment, recordRefund } from '../../services/financeLedgerService'
import { getStudent360ContractWorkspace, mutateStudent360Contract, refreshStudent360Projection } from './student360Service'
import type {
  Student360ContractInstallment,
  Student360ContractMutation,
  Student360ContractRecord,
  Student360ContractWorkspace as Workspace,
  Student360Overview,
} from './types'

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
  installments: Student360ContractInstallment[]
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

function statusLabel(value: Student360ContractRecord['status']) {
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
     usage: { storedUsedSessions: contract.storedUsedSessions, chargedSessions: contract.chargedSessions, exemptSessions: contract.exemptSessions, pendingReconciliationSessions: contract.pendingReconciliationSessions, usedSessions: contract.usedSessions, remainingSessions: contract.remainingSessions, reconciliationStatus: contract.reconciliationStatus },
   } : null
  return {
    schemaVersion: 1,
    student: { id: overview.studentId, name: overview.identity.name, phone: overview.identity.phone, email: overview.identity.email },
    activeContractId: record?.id || null,
    permissions: { canManageContract: true, canCreateContract: true, canEditFinancialTerms: true, canCollectPayments: true, canViewFinancialAmounts: true },
    contracts: record ? [record] : [],
    packages: [{ id: 'package-demo', name: contract?.packageName || 'PT 1:1 · 6 tháng', totalSessions: contract?.totalSessions || 72, price: contract?.payment?.total || 18_000_000, durationMonths: 6, branchId: overview.assignments.branchId || null }],
    trainers: overview.assignments.trainerIds.map((id, index) => ({ id, name: overview.assignments.trainerNames[index] || id, branchId: overview.assignments.branchId || null })),
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
    totalSessions: contract?.totalSessions ?? selectedPackage?.totalSessions ?? 0,
    trainerIds: contract?.trainerIds || [],
    nutritionPTIds: contract?.nutritionPTIds || [],
    totalPrice: contract?.totalPrice ?? selectedPackage?.price ?? 0,
    discount: contract?.discount || 0,
    installments: contract?.installments || [],
    note: contract?.note || '',
  }
}

export default function Student360ContractWorkspace({ studentId, overview, source, isDemo, onNavigate, onChanged, onNotice }: Props) {
  const [workspace, setWorkspace] = useState<Workspace | null>(null)
  const [selectedId, setSelectedId] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [formMode, setFormMode] = useState<FormMode | null>(null)
  const [form, setForm] = useState<ContractForm | null>(null)
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
    setLoading(true)
    setError('')
    try {
      const next = isDemo ? demoWorkspace(overview) : await getStudent360ContractWorkspace(studentId)
      setWorkspace(next)
      setSelectedId((current) => next.contracts.some((item) => item.id === current) ? current : next.activeContractId || next.contracts[0]?.id || '')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không thể tải nghiệp vụ hợp đồng.')
    } finally {
      setLoading(false)
    }
  }, [isDemo, overview, studentId])

  useEffect(() => { void load() }, [load])
  const selected = useMemo(() => workspace?.contracts.find((item) => item.id === selectedId) || null, [selectedId, workspace])
  const selectedUsage = selected?.usage
  const selectedUsedSessions = selectedUsage?.usedSessions ?? selected?.usedSessions ?? 0
  const selectedRemainingSessions = selectedUsage?.remainingSessions ?? Math.max(0, (selected?.totalSessions || 0) - selectedUsedSessions)
  const outstanding = selected && selected.totalPrice !== undefined
    ? Math.max(0, selected.totalPrice - (selected.discount || 0) - (selected.paidAmount || 0))
    : null

  const mutate = async (input: Student360ContractMutation, success: string) => {
    setSaving(true)
    try {
      if (!isDemo) await mutateStudent360Contract(input)
      await load()
      await onChanged()
      setFormMode(null)
      setExtendOpen(false)
      setAddSessionsForm(null)
      setConfirmation(null)
      setReason('')
      onNotice(success)
    } catch (cause) {
      onNotice(cause instanceof Error ? cause.message : 'Không thể cập nhật hợp đồng.')
    } finally {
      setSaving(false)
    }
  }

  const openForm = (mode: FormMode) => {
    if (!workspace) return
    setFormMode(mode)
    setForm(formFor(workspace, mode === 'edit' ? selected || undefined : undefined))
  }

  const updatePackage = (packageId: string) => {
    if (!workspace || !form) return
    const item = workspace.packages.find((value) => value.id === packageId)
    if (!item) return
    setForm({ ...form, packageId, totalSessions: item.totalSessions, totalPrice: item.price, endDate: addMonths(form.startDate, item.durationMonths) })
  }

  const saveForm = async () => {
    if (!workspace || !form) return
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
      payload.totalPrice = form.totalPrice
      payload.discount = form.discount
      payload.installments = form.installments
    }
    if (formMode === 'create') {
      await mutate({ studentId, action: 'create', contract: payload }, 'Đã tạo hợp đồng mới trong Học viên 360.')
    } else if (selected) {
      await mutate({ studentId, contractId: selected.id, expectedRevision: selected.revision, action: 'edit', contract: payload }, 'Đã cập nhật hợp đồng và lưu audit.')
    }
  }

  const openFinance = async () => {
    if (!workspace?.permissions.canCollectPayments) return
    setFinanceOpen(true)
    if (cashAccounts.length) return
    try {
      const result = await listCashAccounts()
      const allowed = result.accounts.filter((item) => item.status === 'active' && (!selected?.branchId || item.branchId === selected.branchId))
      setCashAccounts(allowed)
      setCashAccountId(allowed[0]?.id || '')
    } catch (cause) {
      onNotice(cause instanceof Error ? cause.message : 'Không thể tải danh sách quỹ.')
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

  const executeConfirmation = async () => {
    if (!confirmation || !selected) return
    if (confirmation.action === 'payment' || confirmation.action === 'refund') {
      const installment = confirmation.installment
      if (!cashAccountId) return onNotice('Hãy chọn quỹ nhận hoặc chi tiền.')
      setSaving(true)
      try {
        if (!isDemo) {
          if (confirmation.action === 'payment') {
            await recordContractPayment({ contractId: selected.id, amount: installment.amount || 0, effectiveAt: new Date().toISOString(), paymentMethod, cashAccountId, installmentId: installment.id, idempotencyKey: crypto.randomUUID(), note: `Thu kỳ ${installment.id} từ Học viên 360` })
          } else {
            await recordRefund({ contractId: selected.id, amount: installment.amount || 0, effectiveAt: new Date().toISOString(), paymentMethod, cashAccountId, installmentId: installment.id, reason: reason.trim() || `Hoàn khoản thu kỳ ${installment.id} từ Học viên 360` })
          }
          await refreshStudent360Projection(studentId).catch(() => undefined)
        }
        setConfirmation(null)
        setReason('')
        await load()
        await onChanged()
        onNotice(confirmation.action === 'payment' ? 'Đã thu tiền và tạo phiếu thu.' : 'Đã ghi bút toán hoàn tiền và mở lại kỳ thu.')
      } catch (cause) {
        onNotice(cause instanceof Error ? cause.message : 'Không thể xử lý khoản thanh toán.')
      } finally {
        setSaving(false)
      }
      return
    }
    if (confirmation.action === 'cancel') {
      await mutate({ studentId, contractId: selected.id, expectedRevision: selected.revision, action: 'cancel', reason: reason.trim(), cancelDebt: false }, 'Đã hủy hợp đồng; công nợ cũ vẫn được giữ để đối soát.')
      return
    }
    await mutate({ studentId, contractId: selected.id, expectedRevision: selected.revision, action: confirmation.action, reason: reason.trim() }, confirmation.action === 'freeze' ? 'Đã bảo lưu hợp đồng.' : 'Đã mở lại hợp đồng và cộng thời gian bảo lưu.')
  }

  if (loading) return <div className="student360-contract-workspace-state"><LoaderCircle className="is-spinning" /><strong>Đang tải hồ sơ hợp đồng…</strong><span>Chỉ tải dữ liệu của học viên đang mở.</span></div>
  if (error || !workspace) return <div className="student360-contract-workspace-state is-error"><AlertTriangle /><strong>Chưa tải được nghiệp vụ hợp đồng</strong><span>{error}</span><button type="button" onClick={() => void load()}>Thử lại</button></div>

  return <div className="student360-contract-workspace">
    <section className="student360-contract-commandbar">
      <div><small>TRUNG TÂM NGHIỆP VỤ</small><strong>Thao tác ngay tại Học viên 360</strong><span>Mọi thay đổi được kiểm tra phiên bản, lưu audit và đưa vào CRM Timeline.</span></div>
      <div>
        {selected && workspace.permissions.canViewFinancialAmounts && <button type="button" onClick={() => setInvoiceOpen(true)}><Printer /> Xem / In HĐ</button>}
        {selected && workspace.permissions.canManageContract && <button type="button" onClick={() => openForm('edit')}><FilePenLine /> Chỉnh sửa</button>}
        {selected && workspace.permissions.canEditFinancialTerms && ['active', 'future', 'frozen'].includes(selected.status) && <button type="button" onClick={openAddSessions}><PlusCircle /> Mua thêm buổi</button>}
        {selected && workspace.permissions.canManageContract && selected.status !== 'cancelled' && <button type="button" onClick={() => { setNewEndDate(selected.endDate); setReason(''); setExtendOpen(true) }}><CalendarClock /> Gia hạn ngày</button>}
        {selected && workspace.permissions.canManageContract && selected.status === 'active' && <button type="button" onClick={() => setConfirmation({ action: 'freeze', title: 'Xác nhận bảo lưu', message: 'Học viên sẽ tạm ngừng nhận lịch mới. Quyền lợi và lịch sử vẫn được giữ nguyên.' })}><PauseCircle /> Bảo lưu</button>}
        {selected && workspace.permissions.canManageContract && selected.status === 'frozen' && <button type="button" onClick={() => setConfirmation({ action: 'reopen', title: 'Mở lại hợp đồng', message: 'Aura sẽ cộng số ngày bảo lưu vào ngày hết hạn và cho phép xếp lịch trở lại.' })}><PlayCircle /> Mở bảo lưu</button>}
        {selected && workspace.permissions.canManageContract && selected.status !== 'cancelled' && <button type="button" className="is-danger" onClick={() => { setReason(''); setConfirmation({ action: 'cancel', title: 'Hủy hợp đồng', message: 'Hợp đồng sẽ dừng hiệu lực. Công nợ không bị xóa và lịch sử vẫn được giữ.' }) }}><Trash2 /> Hủy HĐ</button>}
        {workspace.permissions.canCreateContract && <button type="button" onClick={() => openForm('create')}><FilePlus2 /> Tạo hợp đồng</button>}
        {overview.permissions.canViewRenewal && <button type="button" onClick={() => onNavigate(source.startsWith('staff') ? 'staff-renewals' : 'admin-renewals', studentId, workspace.student.name)}><Sparkles /> Tái ký</button>}
      </div>
    </section>

    {workspace.contracts.length > 1 && <section className="student360-contract-history-strip" aria-label="Lịch sử hợp đồng">
      {workspace.contracts.map((item) => <button type="button" key={item.id} className={selectedId === item.id ? 'active' : ''} aria-current={selectedId === item.id ? 'true' : undefined} title={`${item.packageName} · ${dateLabel(item.startDate)} → ${dateLabel(item.endDate)}`} onClick={() => setSelectedId(item.id)}><span className={`is-${item.status}`}>{statusLabel(item.status)}</span><strong>{item.packageName}</strong><small>#{item.id.slice(-8)} · {item.usage?.usedSessions ?? item.usedSessions}/{item.totalSessions} buổi</small></button>)}
    </section>}

    {!selected ? <div className="student360-contract-workspace-state"><FileText /><strong>Chưa có hợp đồng</strong><span>Tạo hợp đồng đầu tiên ngay tại đây, không cần quay lại hồ sơ cũ.</span>{workspace.permissions.canCreateContract && <button type="button" onClick={() => openForm('create')}>Tạo hợp đồng mới</button>}</div> : <>
      <section className="student360-contract-live-summary">
        <header><div><span className={`is-${selected.status}`}>{statusLabel(selected.status)}</span><h3>{selected.packageName}</h3><p>Mã {selected.id} · Revision {selected.revision}</p></div><strong>{selectedRemainingSessions}<small>buổi còn lại</small></strong></header>
        <div className="student360-contract-facts">
          <div><FileText /><span>Quyền lợi<b>{selectedUsedSessions}/{selected.totalSessions} buổi</b></span></div>
          <div><Clock3 /><span>Hiệu lực<b>{dateLabel(selected.startDate)} → {dateLabel(selected.endDate)}</b></span></div>
          <div><UserRoundCog /><span>PT phụ trách<b>{workspace.trainers.filter((item) => selected.trainerIds.includes(item.id)).map((item) => item.name).join(' · ') || 'Chưa phân công'}</b></span></div>
          <div><ShieldCheck /><span>Cập nhật gần nhất<b>{dateLabel(selected.updatedAt)}{selected.updatedByName ? ` · ${selected.updatedByName}` : ''}</b></span></div>
        </div>
        {selectedUsage && <div className="student360-contract-usage-chips"><span><b>{selectedUsage.chargedSessions}</b> buổi tính quota</span><span><b>{selectedUsage.exemptSessions}</b> buổi miễn trừ</span><span><b>{selectedUsage.pendingReconciliationSessions}</b> chờ đối soát</span></div>}
        {selectedUsage && selectedUsage.reconciliationStatus !== 'matched' && <div className="student360-contract-reconciliation"><AlertTriangle /><span><strong>Cần đối soát số buổi</strong><small>{selectedUsage.chargedSessions} buổi tính từ lịch sử · {selectedUsage.exemptSessions} buổi miễn trừ · {selectedUsage.pendingReconciliationSessions} buổi chờ xác nhận.</small></span></div>}
      </section>

      {workspace.permissions.canViewFinancialAmounts && <section className="student360-contract-payment-board">
        <header><div><WalletCards /><span><strong>Thanh toán & trả góp</strong><small>Thu tiền sinh phiếu thu; hoàn tiền sinh bút toán đối ứng.</small></span></div>{workspace.permissions.canCollectPayments && <button type="button" onClick={() => void openFinance()}><CircleDollarSign /> {financeOpen ? 'Đóng quản lý' : 'Quản lý thu tiền'}</button>}</header>
        <div className="student360-contract-money"><span>Giá trị <b>{money.format(selected.totalPrice || 0)}đ</b></span><span>Đã thu <b>{money.format(selected.paidAmount || 0)}đ</b></span><span>Còn nợ <b>{money.format(outstanding || 0)}đ</b></span></div>
        {financeOpen && workspace.permissions.canCollectPayments && <div className="student360-contract-cash-controls"><label>Quỹ nhận/chi<select value={cashAccountId} onChange={(event) => setCashAccountId(event.target.value)}><option value="">Chọn quỹ bắt buộc</option>{cashAccounts.map((item) => <option key={item.id} value={item.id}>{item.name} · {money.format(item.balance)}đ</option>)}</select></label><label>Phương thức<select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)}><option value="transfer">Chuyển khoản</option><option value="cash">Tiền mặt</option><option value="wallet">Ví điện tử</option></select></label></div>}
        <div className="student360-contract-installments">{selected.installments.map((item, index) => <article key={item.id} className={`is-${item.status}`}><span>{index + 1}</span><div><strong>{item.amount === undefined ? 'Đã ẩn số tiền' : `${money.format(item.amount)}đ`}</strong><small>Hạn {dateLabel(item.date)}</small></div><b>{installmentLabel(item.status)}</b>{financeOpen && item.status === 'pending' && <button type="button" onClick={() => setConfirmation({ action: 'payment', title: 'Xác nhận thu tiền', message: `Aura sẽ thu ${money.format(item.amount || 0)}đ vào quỹ đã chọn và tự tạo phiếu thu.`, installment: item })}>Thu tiền</button>}{financeOpen && item.status === 'paid' && <button type="button" onClick={() => { setReason(''); setConfirmation({ action: 'refund', title: 'Xác nhận hoàn tiền', message: `Aura sẽ tạo bút toán hoàn ${money.format(item.amount || 0)}đ; chứng từ thu cũ không bị xóa.`, installment: item }) }}><RotateCcw /> Hoàn tác</button>}</article>)}{selected.installments.length === 0 && <p>Hợp đồng chưa có lịch trả góp.</p>}</div>
      </section>}

      {(selected.pausePeriods.length > 0 || selected.extensions.length > 0) && <section className="student360-contract-ledger">
        <div><h3>OFF & bảo lưu</h3>{selected.pausePeriods.map((item) => <article key={item.requestId}><PauseCircle /><span><strong>{item.type === 'preservation' ? 'Bảo lưu' : 'OFF'} · {item.durationDays} ngày</strong><small>{dateLabel(item.startDate)} → {dateLabel(item.endDate)}</small></span></article>)}{selected.pausePeriods.length === 0 && <p>Chưa có kỳ OFF hoặc bảo lưu.</p>}</div>
        <div><h3>Lịch sử gia hạn ngày</h3>{selected.extensions.map((item) => <article key={item.id}><CalendarClock /><span><strong>{dateLabel(item.oldEndDate)} → {dateLabel(item.newEndDate)}</strong><small>{item.reason || 'Không có ghi chú'}</small></span></article>)}{selected.extensions.length === 0 && <p>Chưa gia hạn ngày hợp đồng.</p>}</div>
      </section>}
    </>}

    {formMode && form && <div className="student360-dialog-layer"><button type="button" className="student360-dialog-backdrop" aria-label="Đóng" onClick={() => setFormMode(null)} /><form className="student360-dialog student360-contract-form" onSubmit={(event) => { event.preventDefault(); void saveForm() }}><header><div><small>HỢP ĐỒNG 360</small><h2>{formMode === 'create' ? 'Tạo hợp đồng mới' : 'Chỉnh sửa hợp đồng'}</h2></div><button type="button" onClick={() => setFormMode(null)}><X /></button></header><div className="student360-contract-form-grid">
      <label>Gói tập<select required value={form.packageId} onChange={(event) => updatePackage(event.target.value)}><option value="">Chọn gói</option>{workspace.packages.filter((item) => !item.branchId || item.branchId === form.branchId).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label>Chi nhánh<select required value={form.branchId} onChange={(event) => setForm({ ...form, branchId: event.target.value })}>{workspace.branches.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label>Ngày bắt đầu<input required type="date" value={form.startDate} onChange={(event) => setForm({ ...form, startDate: event.target.value })} /></label>
      <label>Ngày kết thúc<input required type="date" min={form.startDate} value={form.endDate} onChange={(event) => setForm({ ...form, endDate: event.target.value })} /></label>
      <label>Tổng số buổi<input required type="number" min={formMode === 'edit' ? selected?.usedSessions || 0 : 0} value={form.totalSessions} onChange={(event) => setForm({ ...form, totalSessions: Number(event.target.value) })} /></label>
      {workspace.permissions.canEditFinancialTerms && <><label>Giá trị hợp đồng<input required type="number" min="0" value={form.totalPrice} onChange={(event) => setForm({ ...form, totalPrice: Number(event.target.value) })} /></label><label>Giảm giá<input required type="number" min="0" max={form.totalPrice} value={form.discount} onChange={(event) => setForm({ ...form, discount: Number(event.target.value) })} /></label></>}
    </div><fieldset><legend>PT chính/phụ</legend><div className="student360-contract-person-picker">{workspace.trainers.filter((item) => !item.branchId || item.branchId === form.branchId).map((item) => <label key={item.id}><input type="checkbox" checked={form.trainerIds.includes(item.id)} onChange={() => setForm({ ...form, trainerIds: form.trainerIds.includes(item.id) ? form.trainerIds.filter((id) => id !== item.id) : [...form.trainerIds, item.id] })} />{item.name}</label>)}</div></fieldset><fieldset><legend>Coach dinh dưỡng</legend><div className="student360-contract-person-picker">{workspace.trainers.filter((item) => !item.branchId || item.branchId === form.branchId).map((item) => <label key={item.id}><input type="checkbox" checked={form.nutritionPTIds.includes(item.id)} onChange={() => setForm({ ...form, nutritionPTIds: form.nutritionPTIds.includes(item.id) ? form.nutritionPTIds.filter((id) => id !== item.id) : [...form.nutritionPTIds, item.id] })} />{item.name}</label>)}</div></fieldset>{workspace.permissions.canEditFinancialTerms && <fieldset><legend>Kế hoạch trả góp</legend><div className="student360-contract-form-installments">{form.installments.map((item) => <div key={item.id}><input type="date" disabled={item.status !== 'pending'} value={item.date} onChange={(event) => setForm({ ...form, installments: form.installments.map((value) => value.id === item.id ? { ...value, date: event.target.value } : value) })} /><input type="number" min="0" disabled={item.status !== 'pending'} value={item.amount || 0} onChange={(event) => setForm({ ...form, installments: form.installments.map((value) => value.id === item.id ? { ...value, amount: Number(event.target.value) } : value) })} /><span>{installmentLabel(item.status)}</span>{item.status === 'pending' && <button type="button" onClick={() => setForm({ ...form, installments: form.installments.filter((value) => value.id !== item.id) })}><X /></button>}</div>)}<button type="button" onClick={() => setForm({ ...form, installments: [...form.installments, { id: `installment-${crypto.randomUUID()}`, date: form.startDate, amount: 0, status: 'pending' }] })}>+ Thêm kỳ thanh toán</button></div></fieldset>}<label>Ghi chú<textarea rows={3} maxLength={1000} value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} /></label><footer><button type="button" onClick={() => setFormMode(null)}>Hủy</button><button type="submit" disabled={saving}>{saving ? 'Đang lưu…' : 'Lưu hợp đồng'}</button></footer></form></div>}

    {extendOpen && selected && <div className="student360-dialog-layer"><button type="button" className="student360-dialog-backdrop" aria-label="Đóng" onClick={() => setExtendOpen(false)} /><form className="student360-dialog" onSubmit={(event) => { event.preventDefault(); void mutate({ studentId, contractId: selected.id, expectedRevision: selected.revision, action: 'extend', newEndDate, reason }, 'Đã gia hạn ngày và lưu vào CRM Timeline.') }}><header><div><small>GIA HẠN NGÀY</small><h2>Điều chỉnh hạn sử dụng</h2></div><button type="button" onClick={() => setExtendOpen(false)}><X /></button></header><p>Hạn hiện tại: <strong>{dateLabel(selected.endDate)}</strong></p><label>Ngày hết hạn mới<input required type="date" min={selected.endDate} value={newEndDate} onChange={(event) => setNewEndDate(event.target.value)} /></label><label>Lý do<textarea required minLength={2} rows={3} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Ví dụ: bù thời gian gián đoạn đã xác minh…" /></label><footer><button type="button" onClick={() => setExtendOpen(false)}>Hủy</button><button type="submit" disabled={saving}>{saving ? 'Đang lưu…' : 'Xác nhận gia hạn'}</button></footer></form></div>}

    {addSessionsForm && selected && <div className="student360-dialog-layer"><button type="button" className="student360-dialog-backdrop" aria-label="Đóng" onClick={() => setAddSessionsForm(null)} /><form className="student360-dialog student360-contract-addon" onSubmit={(event) => { event.preventDefault(); void saveAddSessions() }}><header><div><small>QUYỀN LỢI BỔ SUNG</small><h2>Mua thêm buổi</h2></div><button type="button" onClick={() => setAddSessionsForm(null)}><X /></button></header><div className="student360-contract-form-grid"><label>Số buổi mua thêm<input required type="number" min="1" max="100000" value={addSessionsForm.extraSessions} onChange={(event) => setAddSessionsForm({ ...addSessionsForm, extraSessions: Number(event.target.value) })} /></label><label>Gia hạn thêm (tháng)<input required type="number" min="0" max="120" value={addSessionsForm.extraDurationMonths} onChange={(event) => setAddSessionsForm({ ...addSessionsForm, extraDurationMonths: Number(event.target.value) })} /></label><label>Giá trị phát sinh<input required type="number" min="0" value={addSessionsForm.extraPrice} onChange={(event) => setAddSessionsForm({ ...addSessionsForm, extraPrice: Number(event.target.value) })} /></label>{addSessionsForm.extraPrice > 0 && <label>Ngày hẹn thanh toán<input required type="date" min={new Date().toISOString().slice(0, 10)} value={addSessionsForm.paymentDueDate} onChange={(event) => setAddSessionsForm({ ...addSessionsForm, paymentDueDate: event.target.value })} /></label>}</div><div className="student360-contract-addon-preview"><span><small>Tổng quyền lợi mới</small><strong>{selected.totalSessions + Math.max(0, addSessionsForm.extraSessions || 0)} buổi</strong></span><span><small>Hạn sử dụng mới</small><strong>{dateLabel(addMonths(selected.endDate, Math.max(0, addSessionsForm.extraDurationMonths || 0)))}</strong></span><span><small>Giá trị hợp đồng mới</small><strong>{money.format((selected.totalPrice || 0) + Math.max(0, addSessionsForm.extraPrice || 0))}đ</strong></span></div><label>Nội dung thỏa thuận<textarea required minLength={2} maxLength={500} rows={3} value={addSessionsForm.reason} onChange={(event) => setAddSessionsForm({ ...addSessionsForm, reason: event.target.value })} placeholder="Ví dụ: mua thêm 12 buổi theo báo giá ngày…" /></label><p className="student360-contract-addon-note"><ShieldCheck /> Aura tạo khoản phải thu riêng; tiền chỉ được ghi nhận sau khi thu qua phiếu thu, không tự tăng số đã thanh toán.</p><footer><button type="button" onClick={() => setAddSessionsForm(null)}>Hủy</button><button type="submit" disabled={saving || addSessionsForm.extraSessions < 1 || addSessionsForm.reason.trim().length < 2}>{saving ? 'Đang ghi nhận…' : 'Xác nhận mua thêm'}</button></footer></form></div>}

    {confirmation && <div className="student360-dialog-layer"><button type="button" className="student360-dialog-backdrop" aria-label="Đóng" onClick={() => setConfirmation(null)} /><section className="student360-dialog student360-confirm-dialog" role="alertdialog" aria-modal="true"><header><div><small>XÁC NHẬN NGHIỆP VỤ</small><h2>{confirmation.title}</h2></div><button type="button" onClick={() => setConfirmation(null)}><X /></button></header><p>{confirmation.message}</p>{(confirmation.action === 'cancel' || confirmation.action === 'refund') && <label>{confirmation.action === 'cancel' ? 'Lý do hủy' : 'Lý do hoàn tiền'}<textarea required minLength={2} rows={3} value={reason} onChange={(event) => setReason(event.target.value)} /></label>}<footer><button type="button" onClick={() => setConfirmation(null)}>Quay lại</button><button type="button" className={confirmation.action === 'cancel' ? 'is-danger' : ''} disabled={saving || ((confirmation.action === 'cancel' || confirmation.action === 'refund') && reason.trim().length < 2)} onClick={() => void executeConfirmation()}>{saving ? 'Đang xử lý…' : 'Xác nhận'}</button></footer></section></div>}

    {invoiceOpen && selected && <Suspense fallback={<div className="student360-dialog-layer"><div className="student360-contract-workspace-state"><LoaderCircle className="is-spinning" /> Đang mở hợp đồng…</div></div>}><ContractInvoice student={toInvoiceStudent(workspace)} contract={toInvoiceContract(selected)} onClose={() => setInvoiceOpen(false)} /></Suspense>}
  </div>
}
