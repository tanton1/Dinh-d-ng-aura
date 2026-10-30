import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { User } from 'firebase/auth'
import { AnimatePresence, motion } from 'motion/react'
import { AlertCircle, CheckCircle, Clock, DollarSign, PauseCircle, Plus, RefreshCw, Search, Undo2, WalletCards, X } from 'lucide-react'
import type { StudentContract, UserProfile } from '../../../types'
import { useDatabase } from '../../../contexts/DatabaseContext'
import { useAuth } from '../../../contexts/AuthContext'
import { listFinanceReceivables, listFinanceStudentLabels, type ReceivableCategory, type ReceivableFilter, type ReceivablesPage, type ReceivablesSummary } from '../../../services/scopedReportingService'
import { useLocalTimeBoundaries } from '../../../hooks/useLocalTimeBoundaries'
import {
  listFinanceLedger,
  type FinanceLedgerEntry,
} from '../../../services/financeLedgerService'
import DateRangeFilter from './DateRangeFilter'
import AuraMetricCarousel, { type AuraMetricSlide } from './AuraMetricCarousel'
import AuraHelpPopover from './AuraHelpPopover'
import { listCashAccounts, type CashAccount } from '../../../services/cashbookService'
import FinanceIntentBoundary, { FinancePendingOperations } from './FinanceIntentBoundary'
import type { FinanceIntentOutcome, FinanceOperationDraft } from '../../../services/financeOperationIntent'
import '../../../styles-finance-management.css'

interface Props {
  user: User | null
  profile: UserProfile | null
  category?: Exclude<ReceivableCategory, 'debt'>
}

type DebtFilter = Exclude<ReceivableFilter, 'owing' | 'settled'>

function initialDebtFilter(): DebtFilter {
  const focus = new URLSearchParams(window.location.hash.split('?')[1] || '').get('focus')
  return focus === 'overdue' ? 'overdue' : focus === 'this-week' ? 'this-week' : focus === 'this-month' ? 'this-month' : 'all'
}

function money(value: number) {
  const amount = Number(value)
  return `${Math.round(Number.isFinite(amount) ? amount : 0).toLocaleString('vi-VN')}đ`
}

function contractBalance(contract: StudentContract) {
  const total = Number(contract.totalPrice || 0) - Number(contract.discount || 0)
  const paid = Number(contract.paidAmount || 0)
  const debt = (Number.isFinite(total) ? total : 0) - (Number.isFinite(paid) ? paid : 0)
  return debt
}

function contractDebt(contract: StudentContract) {
  return Math.max(0, contractBalance(contract))
}

function dateKey(value: unknown) {
  const key = String(value || '').trim().slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(key) ? key : ''
}

function localDateKey(value = new Date()) {
  const year = value.getFullYear()
  const month = String(value.getMonth() + 1).padStart(2, '0')
  const day = String(value.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function pendingInstallments(contract: StudentContract) {
  return [...(Array.isArray(contract.installments) ? contract.installments : [])]
    .filter((item) => item && item.status === 'pending' && dateKey(item.date))
    .sort((left, right) => dateKey(left.date).localeCompare(dateKey(right.date)))
}

function currentPreservation(contract: StudentContract, todayKey: string) {
  return (Array.isArray(contract.pausePeriods) ? contract.pausePeriods : []).find((period) =>
    period && period.type === 'preservation' && dateKey(period.startDate) && dateKey(period.endDate)
    && dateKey(period.startDate) <= todayKey && dateKey(period.endDate) >= todayKey)
}

function isPreserved(contract: StudentContract, todayKey: string) {
  if (['cancelled', 'inactive', 'archived', 'draft'].includes(contract.status)) return false
  return contract.status === 'frozen' || Boolean(currentPreservation(contract, todayKey))
}

function overdueAmount(contract: StudentContract, todayKey: string) {
  const debt = contractDebt(contract)
  if (!debt || isPreserved(contract, todayKey)) return 0
  const pending = pendingInstallments(contract)
  if (pending.length) {
    const overdue = pending
      .filter((item) => dateKey(item.date) < todayKey)
      .reduce((sum, item) => sum + Math.max(0, Number(item.amount) || 0), 0)
    return Math.min(debt, overdue)
  }
  const nextPaymentDate = dateKey(contract.nextPaymentDate)
  return nextPaymentDate && nextPaymentDate < todayKey ? debt : 0
}

function currentMonthRange() {
  const now = new Date()
  return {
    start: new Date(now.getFullYear(), now.getMonth(), 1),
    end: new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999),
  }
}

function entryLabel(type: FinanceLedgerEntry['type']) {
  if (type === 'refund') return 'Hoàn tiền'
  if (type === 'reversal') return 'Đảo bút toán'
  if (type === 'adjustment') return 'Điều chỉnh'
  if (type === 'expense') return 'Chi phí vận hành'
  if (type === 'payroll') return 'Chi phí lương'
  return 'Thu tiền'
}

function callableErrorDetails(cause: unknown) {
  const raw = cause && typeof cause === 'object' ? cause as { code?: unknown; message?: unknown } : {}
  return {
    code: typeof raw.code === 'string' ? raw.code : '',
    message: typeof raw.message === 'string' ? raw.message : cause instanceof Error ? cause.message : '',
  }
}

function ledgerErrorMessage(cause: unknown) {
  const { code, message } = callableErrorDetails(cause)
  if (/permission-denied|unauthenticated/i.test(code)) return 'Tài khoản chưa có quyền đọc sổ cái tài chính.'
  if (/invalid-argument/i.test(code)) return 'Bộ lọc sổ cái chưa tương thích. Aura đã giữ nguyên dữ liệu và không dùng payment cũ thay thế.'
  if (/unavailable|deadline-exceeded/i.test(code)) return 'Dịch vụ sổ cái đang bận. Hãy thử tải lại sau ít phút.'
  return message || 'Không thể tải ledger canonical. Aura không dùng payment legacy thay thế để tránh cộng trùng doanh thu.'
}

export default function FinanceManagement(props: Props) {
  const { user, profile } = props
  const authority = JSON.stringify([user?.uid, profile?.uid, profile?.role, profile?.accessRole,
    profile?.authzVersion, profile?.branchId, profile?.disabled, [...(profile?.positions || [])].sort()])
  return <FinanceWorkspace key={authority} {...props} />
}

function FinanceWorkspace({ profile, category = 'all' }: Props) {
  const { branches } = useDatabase()
  const { backendMode } = useAuth()
  const [contracts, setContracts] = useState<ReceivablesPage['contracts']>([])
  const [students, setStudents] = useState<ReceivablesPage['students']>([])
  const [debtSummary, setDebtSummary] = useState<ReceivablesSummary | null>(null)
  const [debtLoading, setDebtLoading] = useState(backendMode === 'firebase')
  const [debtError, setDebtError] = useState('')
  const [debtCursor, setDebtCursor] = useState<string | null>(null)
  const [debtHasMore, setDebtHasMore] = useState(false)
  const debtRequestSequence = useRef(0)
  // Keep the existing local calendar semantics. Midnight advances the report
  // scope once; an unchanged resume never starts another read.
  const nextMidnight = new Date()
  nextMidnight.setHours(24, 0, 0, 0)
  const calendarClock = useLocalTimeBoundaries([nextMidnight.getTime()])
  const todayKey = localDateKey(new Date(calendarClock))
  const [selectedBranchId, setSelectedBranchId] = useState('all')
  const [dateRange, setDateRange] = useState<{ start: Date; end: Date }>(currentMonthRange)
  const [filterSelection, setFilterSelection] = useState({ category, filter: category === 'frozen' ? 'all' as DebtFilter : initialDebtFilter() })
  const debtFilter = filterSelection.category === category ? filterSelection.filter : 'all'
  const setDebtFilter = (filter: DebtFilter) => setFilterSelection({ category, filter })
  const categoryLabel = category === 'installments' ? 'Trả góp' : category === 'frozen' ? 'Bảo lưu' : 'Công nợ'
  const [ledgerEntries, setLedgerEntries] = useState<FinanceLedgerEntry[]>([])
  const [ledgerCursor, setLedgerCursor] = useState<string | null>(null)
  const [ledgerHasMore, setLedgerHasMore] = useState(false)
  const [ledgerLoading, setLedgerLoading] = useState(false)
  const [ledgerError, setLedgerError] = useState('')
  const [showHistory, setShowHistory] = useState(false)
  const [selectedContract, setSelectedContract] = useState<StudentContract | null>(null)
  const [selectedInstallmentId, setSelectedInstallmentId] = useState<string | null>(null)
  const [payAmount, setPayAmount] = useState('')
  const [entryToReverse, setEntryToReverse] = useState<FinanceLedgerEntry | null>(null)
  const [alertMessage, setAlertMessage] = useState<string | null>(null)
  const [cashAccounts, setCashAccounts] = useState<CashAccount[]>([])
  const [cashAccountsLoading, setCashAccountsLoading] = useState(false)
  const [cashAccountsError, setCashAccountsError] = useState('')
  const [selectedCashAccountId, setSelectedCashAccountId] = useState('')
  const [debtSearch, setDebtSearch] = useState('')
  const [debouncedDebtSearch, setDebouncedDebtSearch] = useState('')
  const requestSequence = useRef(0)
  const cashRequestSequence = useRef(0)
  const mounted = useRef(true)
  const historyVisible = useRef(showHistory)
  historyVisible.current = showHistory
  const receivablesRef = useRef<HTMLElement>(null)

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; requestSequence.current += 1; debtRequestSequence.current += 1 }
  }, [])

  const effectiveBranchId = profile?.branchId && profile.role !== 'admin' && profile.role !== 'super_admin'
    ? profile.branchId
    : selectedBranchId
  const ledgerScope = JSON.stringify([effectiveBranchId, dateRange.start.getTime(), dateRange.end.getTime()])
  const latestLedgerScope = useRef(ledgerScope)
  latestLedgerScope.current = ledgerScope

  const debtScope = JSON.stringify([effectiveBranchId, todayKey, category, debtFilter, debouncedDebtSearch])
  const latestDebtScope = useRef(debtScope)
  latestDebtScope.current = debtScope
  const loadDebts = useCallback(async (append = false, refresh = false) => {
    if (backendMode !== 'firebase') return
    const sequence = ++debtRequestSequence.current
    const isCurrent = () => mounted.current && sequence === debtRequestSequence.current && latestDebtScope.current === debtScope
    setDebtLoading(true); setDebtError('')
    if (!append) { setContracts([]); setStudents([]); setDebtSummary(null); setDebtCursor(null); setDebtHasMore(false) }
    try {
      const page = await listFinanceReceivables({ branchId: effectiveBranchId, today: todayKey, category, filter: debtFilter,
        search: debouncedDebtSearch, cursor: append ? debtCursor : null, includeSummary: !append, refresh })
      if (!isCurrent()) return
      setContracts(current => [...new Map([...(append ? current : []), ...page.contracts].map(item => [item.id, item])).values()])
      setStudents(current => [...new Map([...(append ? current : []), ...page.students].map(item => [item.id, item])).values()])
      if (page.summary) setDebtSummary(page.summary)
      setDebtCursor(page.nextCursor); setDebtHasMore(page.hasMore)
    } catch (error) { if (isCurrent()) setDebtError(error instanceof Error ? error.message : 'Chưa tải được công nợ. Hãy làm mới để thử lại.') }
    finally { if (isCurrent()) setDebtLoading(false) }
  }, [backendMode, effectiveBranchId, todayKey, category, debtFilter, debouncedDebtSearch, debtScope, debtCursor])

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedDebtSearch(debtSearch), 300)
    return () => window.clearTimeout(timer)
  }, [debtSearch])
  useEffect(() => {
    void loadDebts()
    return () => { debtRequestSequence.current++ }
    // Cursor changes only belong to the explicit next-page action.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debtScope, backendMode])

  const updateDateRange = useCallback((start: Date, end: Date) => {
    setDateRange((current) => current.start.getTime() === start.getTime() && current.end.getTime() === end.getTime()
      ? current
      : { start, end })
  }, [])

  const loadLedger = useCallback(async (append = false) => {
    if (!mounted.current || !historyVisible.current) return
    const sequence = ++requestSequence.current
    const isCurrent = () => mounted.current && historyVisible.current && latestLedgerScope.current === ledgerScope && sequence === requestSequence.current
    setLedgerLoading(true)
    setLedgerError('')
    if (!append) {
      setLedgerEntries([])
      setLedgerCursor(null)
      setLedgerHasMore(false)
    }
    try {
      const query = {
        pageSize: 50,
        includeSummary: false,
        cursor: append ? ledgerCursor : null,
        branchId: effectiveBranchId,
        // The installment workspace reads cash history from the canonical ledger.
        // in the management report and must not be mixed into this screen.
        types: ['payment', 'refund', 'adjustment', 'reversal', 'expense', 'payroll'] as FinanceLedgerEntry['type'][],
        startAt: dateRange.start.getTime() > 0 ? dateRange.start.toISOString() : undefined,
        endAt: dateRange.end.getFullYear() <= 9999 ? dateRange.end.toISOString() : undefined,
      }
      let page
      try {
        page = await listFinanceLedger(query)
      } catch (cause) {
        if (!isCurrent()) return
        const { code, message } = callableErrorDetails(cause)
        // Keep the cash workspace compatible while Functions and Vercel are
        // promoted in sequence. An older callable may reject newer type
        // filters; retrying without `types` remains canonical-only and the UI
        // still filters entries by their explicit cash impact.
        if (/invalid-argument/i.test(code) && /loại bút toán|entry type|ledger type/i.test(message)) {
          const { types: _types, ...compatibleQuery } = query
          page = await listFinanceLedger(compatibleQuery)
        } else {
          throw cause
        }
      }
      if (!isCurrent()) return
      setLedgerEntries((current) => {
        if (!append) return page.entries
        const byId = new Map(current.map((entry) => [entry.id, entry]))
        page.entries.forEach((entry) => byId.set(entry.id, entry))
        return Array.from(byId.values())
      })
      const studentIds = [...new Set(page.entries.map(entry => entry.studentId).filter(Boolean))]
      if (studentIds.length) {
        try {
          const labels = await listFinanceStudentLabels(studentIds)
          if (!isCurrent()) return
          setStudents(current => [...new Map([...current, ...labels].map(item => [item.id, item])).values()])
        } catch { /* Missing optional labels must never hide canonical cash history. */ }
      }
      // A rejected optional lookup can also finish after the scope has changed.
      if (!isCurrent()) return
      setLedgerCursor(page.nextCursor)
      setLedgerHasMore(page.hasMore)
    } catch (cause) {
      if (!isCurrent()) return
      setLedgerError(ledgerErrorMessage(cause))
      if (!append) {
        setLedgerEntries([])
      }
    } finally {
      if (isCurrent()) setLedgerLoading(false)
    }
  }, [dateRange, effectiveBranchId, ledgerCursor, ledgerScope])

  useEffect(() => {
    if (showHistory) void loadLedger(false)
    else {
      setLedgerEntries([])
      setLedgerCursor(null)
      setLedgerHasMore(false)
      setLedgerLoading(false)
      setLedgerError('')
    }
    return () => { requestSequence.current += 1 }
    // ledgerCursor is intentionally excluded: a new cursor must not automatically fetch the next page.
    // Reopening is an explicit fresh read; hidden history never reads after filters or mutations.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showHistory, dateRange, effectiveBranchId])

  const studentById = useMemo(() => new Map(students.map(student => [student.id, student])), [students])
  const visibleContractsWithDebt = contracts
  const completeSummary = debtSummary?.complete === true ? debtSummary : null
  const debtCount = (filter: DebtFilter) => completeSummary?.counts?.[filter] ?? null
  const metric = (value: number | null | undefined) => value == null ? '—' : money(value)
  const cashEntries = useMemo(() => ledgerEntries.filter((entry) => {
    if (entry.cashImpact !== null && Number.isFinite(entry.cashImpact)) return entry.cashImpact !== 0
    return ['payment', 'refund', 'adjustment', 'reversal'].includes(entry.type)
  }), [ledgerEntries])

  const studentName = (studentId: string) => studentById.get(studentId)?.name || (studentId ? `Học viên ${studentId}` : 'Chưa có tên học viên')

  const loadPaymentCashAccounts = async (contract: StudentContract) => {
    const sequence = ++cashRequestSequence.current
    const isCurrent = () => mounted.current && cashRequestSequence.current === sequence
    setCashAccounts([])
    setSelectedCashAccountId('')
    setCashAccountsLoading(true)
    setCashAccountsError('')
    try {
      const result = await listCashAccounts()
      if (!isCurrent()) return
      const accounts = result.accounts.filter((item) => item.status === 'active')
      setCashAccounts(accounts)
      setSelectedCashAccountId(accounts.find((item) => !contract.branchId || item.branchId === contract.branchId)?.id || '')
    } catch (cause) {
      if (!isCurrent()) return
      const { code } = callableErrorDetails(cause)
      setCashAccountsError(/permission-denied|unauthenticated/i.test(code)
        ? 'Tài khoản chưa có quyền đọc danh sách quỹ.'
        : 'Chưa tải được danh sách quỹ. Hãy thử lại.')
    } finally {
      if (isCurrent()) setCashAccountsLoading(false)
    }
  }

  const closePayment = () => {
    cashRequestSequence.current += 1
    setSelectedContract(null)
    setSelectedInstallmentId(null)
    setCashAccounts([])
    setSelectedCashAccountId('')
    setCashAccountsLoading(false)
    setCashAccountsError('')
  }

  const openPayment = (contract: StudentContract) => {
    if (contract.status === 'cancelled') {
      setAlertMessage('Mở hồ sơ học viên để rà soát và quyết toán hợp đồng đã hủy.')
      return
    }
    const balance = contractBalance(contract)
    setSelectedContract(contract)
    setSelectedInstallmentId(null)
    setPayAmount(String(balance))
    // A fresh read belongs to this explicit payment dialog, not the debt page.
    // Closing/reopening or changing authority fences every earlier response.
    void loadPaymentCashAccounts(contract)
  }

  const submitPayment = async (submit: (draft: FinanceOperationDraft) => Promise<void>) => {
    if (!selectedContract || cashAccountsLoading || cashAccountsError) return
    if (selectedContract.status === 'cancelled' || contracts.find(item => item.id === selectedContract.id)?.status === 'cancelled') {
      setAlertMessage('Hợp đồng đã hủy. Mở hồ sơ học viên để thu/hoàn theo quyết toán được duyệt.')
      return
    }
    const amount = Number(payAmount)
    if (!Number.isSafeInteger(amount) || amount === 0) {
      setAlertMessage('Số tiền phải là số nguyên khác 0.')
      return
    }
    if (!selectedCashAccountId) {
      setAlertMessage('Hãy chọn quỹ nhận/chi để sổ quỹ và bút toán kế toán luôn đối chiếu được.')
      return
    }
    const payload = { contractId: selectedContract.id, amount: Math.abs(amount), effectiveAt: new Date().toISOString(), paymentMethod: 'transfer', cashAccountId: selectedCashAccountId, installmentId: selectedInstallmentId || undefined, expectedPaidAmount: Number(selectedContract.paidAmount || 0) }
    await submit(amount > 0
      ? { type: 'payment', payload: { ...payload, note: selectedInstallmentId ? 'Thanh toán kỳ trả góp' : 'Thanh toán công nợ' } }
      : { type: 'refund', payload: { ...payload, reason: selectedInstallmentId ? 'Hoàn tiền kỳ trả góp' : 'Hoàn tiền từ trang tài chính' } })
  }

  const financeCompleted = async (outcome: FinanceIntentOutcome) => {
    if (!mounted.current) return
    closePayment()
    setEntryToReverse(null)
    setPayAmount('')
    await Promise.all([loadLedger(false), loadDebts(false, true)])
    if (mounted.current) setAlertMessage(outcome.state === 'committed' ? 'Đã xác nhận giao dịch được ghi nhận. Chứng từ và số dư đã được cập nhật.' : 'Đã dừng yêu cầu chưa ghi nhận. Bạn có thể mở lại biểu mẫu để tạo yêu cầu mới.')
  }

  const financeSlides: AuraMetricSlide[] = category === 'frozen' ? [
    { id: 'frozen-count', eyebrow: 'Đang bảo lưu', value: `${debtCount('all') ?? '—'} hợp đồng`, detail: 'Hợp đồng bảo lưu còn tiền phải thu', icon: <PauseCircle size={20} />, tone: 'orange', actionLabel: 'Xem danh sách', onSelect: () => setDebtFilter('all') },
    { id: 'frozen-debt', eyebrow: 'Còn phải thu', value: metric(completeSummary?.totals?.debt), detail: `${debtCount('all') ?? '—'} hợp đồng bảo lưu còn nợ`, icon: <DollarSign size={20} />, tone: 'pink', actionLabel: 'Xem danh sách', onSelect: () => setDebtFilter('all') },
  ] : [
    {
      id: 'total-debt',
      eyebrow: 'Tổng nợ',
      value: metric(completeSummary?.totals?.debt),
      detail: `${debtCount('all') ?? '—'} hợp đồng ${category === 'installments' ? 'trả góp' : 'còn phải thu'}`,
      icon: <DollarSign size={20} />,
      tone: 'pink',
      actionLabel: 'Xem tất cả',
      onSelect: () => {
        setDebtFilter('all')
        receivablesRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      },
    },
    {
      id: 'overdue-debt',
      eyebrow: 'Quá hạn',
      value: metric(completeSummary?.totals?.overdue),
      detail: `${debtCount('overdue') ?? '—'} hợp đồng cần ưu tiên xử lý`,
      icon: <AlertCircle size={20} />,
      tone: 'orange',
      actionLabel: 'Xem quá hạn',
      onSelect: () => {
        setDebtFilter('overdue')
        receivablesRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      },
    },
    {
      id: 'month-debt',
      eyebrow: 'Nợ thu tháng này',
      value: metric(completeSummary?.totals?.thisMonth),
      detail: `${debtCount('this-month') ?? '—'} hợp đồng có kỳ đến hạn`,
      icon: <Clock size={20} />,
      tone: 'sunset',
      actionLabel: 'Xem tháng này',
      onSelect: () => {
        setDebtFilter('this-month')
        receivablesRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      },
    },
  ]

  const debtFilterOptions: Array<{ id: DebtFilter; label: string; count: number | null }> = category === 'frozen' ? [] : [
    { id: 'all', label: 'Đang nợ', count: debtCount('all') },
    { id: 'overdue', label: 'Quá hạn', count: debtCount('overdue') },
    { id: 'this-week', label: 'Tuần này', count: debtCount('this-week') },
    { id: 'this-month', label: 'Tháng này', count: debtCount('this-month') },
    { id: 'overpaid', label: 'Thanh toán dư', count: debtCount('overpaid') },
  ]

  return (
    <div className="finance-management space-y-6 pb-28">
      <AuraMetricCarousel key={category} slides={financeSlides} label={`Tổng quan ${categoryLabel.toLowerCase()}`} />
      {debtLoading && <p role="status">Đang tải công nợ…</p>}
      {debtError && <p role="alert">{debtError}</p>}
      {debtSummary && <p role={debtSummary.complete ? 'status' : 'alert'}>{debtSummary.complete
        ? `Tổng hợp lúc ${new Date(debtSummary.asOf).toLocaleString('vi-VN')}. Danh sách tải theo trang; số tiền khi thanh toán được kiểm tra lại.`
        : 'Chưa đủ dữ liệu để tính tổng công nợ. Aura để trống các chỉ số; danh sách chi tiết vẫn có thể tải theo trang.'}</p>}

      <div className="finance-management__filters">
        <DateRangeFilter compact excludeFuture initialRange="Tháng này" onFilter={updateDateRange} />
        {(!profile?.branchId || profile.role === 'admin' || profile.role === 'super_admin') && (
          <select aria-label="Lọc chi nhánh công nợ" value={selectedBranchId} onChange={(event) => setSelectedBranchId(event.target.value)}>
            <option value="all">Tất cả chi nhánh</option>
            <option value="none">Chưa phân chi nhánh</option>
            {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
          </select>
        )}
        <button type="button" onClick={() => setShowHistory(true)} className="finance-management__tool-button" aria-label={category === 'all' ? 'Mở lịch sử thu trả góp' : 'Mở lịch sử giao dịch'} title="Lịch sử giao dịch"><WalletCards size={17} /></button>
        <button type="button" onClick={() => { void loadDebts(false, true); void loadLedger(false) }} disabled={ledgerLoading || debtLoading} className="finance-management__tool-button" aria-label={category === 'all' ? 'Làm mới trả góp' : `Làm mới ${categoryLabel.toLowerCase()}`} title="Làm mới"><RefreshCw size={17} className={ledgerLoading || debtLoading ? 'animate-spin' : ''} /></button>
        <AuraHelpPopover title="Phân nhóm hợp đồng"><p>Bảo lưu chỉ gồm hợp đồng đang bảo lưu còn tiền phải thu. Trả góp gồm hợp đồng còn nợ có kỳ chưa thanh toán, không đang bảo lưu. Hợp đồng đã hủy được quyết toán trong hồ sơ học viên.</p><p>Số liệu theo chi nhánh và tab đang xem. Từ khóa chỉ lọc danh sách. Bộ lọc ngày chỉ áp dụng cho lịch sử giao dịch của chi nhánh.</p></AuraHelpPopover>
      </div>

      <section ref={receivablesRef} className="finance-management__receivables">
        <div className="finance-management__section-head">
          <div className="finance-management__section-title"><h2>{category === 'frozen' ? <PauseCircle size={20} /> : <DollarSign size={20} />} {categoryLabel}</h2><AuraHelpPopover title={`Danh sách ${categoryLabel.toLowerCase()}`}><p>{category === 'frozen' ? 'Mở hồ sơ học viên để kiểm tra thời gian bảo lưu và mở lại hợp đồng. Khoản còn phải thu vẫn được giữ nguyên.' : 'Số dư lấy từ hợp đồng. Lọc Quá hạn để ưu tiên thu hồi; Thanh toán dư là khoản khách đã nộp vượt số phải thu.'}</p></AuraHelpPopover></div>
          <strong>{contracts.length.toLocaleString('vi-VN')} hồ sơ đã tải</strong>
        </div>
        <p>Danh sách theo mã hợp đồng, tải lần lượt từng trang.{category !== 'frozen' && ' Chọn Quá hạn để tập trung các khoản cần thu.'}</p>
        <div className={`finance-management__debt-tools${category === 'frozen' ? ' finance-management__debt-tools--search-only' : ''}`}>
          <label className="finance-management__debt-search">
            <Search size={17} />
            <input value={debtSearch} onChange={(event) => setDebtSearch(event.target.value)} placeholder="Tên, SĐT, email, gói…" aria-label="Tìm công nợ" />
            {debtSearch && <button type="button" onClick={() => setDebtSearch('')} aria-label="Xóa từ khóa"><X size={15} /></button>}
          </label>
          {debtFilterOptions.length > 0 && <div className="finance-management__debt-filters" aria-label="Nhóm công nợ">
            {debtFilterOptions.map((filter) => <button key={filter.id} type="button" onClick={() => setDebtFilter(filter.id)} className={debtFilter === filter.id ? 'is-active' : ''} aria-pressed={debtFilter === filter.id}><span>{filter.label}</span><b>{filter.count ?? '—'}</b></button>)}
          </div>}
        </div>
        <div className="finance-management__receivables-list space-y-3">
          {visibleContractsWithDebt.map((contract) => {
            const balance = contractBalance(contract)
            const debt = Math.max(0, balance)
            const nextInstallment = pendingInstallments(contract)[0]
            const dueDate = nextInstallment?.date || contract.nextPaymentDate
            const overdue = !contract.dataIssue && overdueAmount(contract, todayKey) > 0
            const student = studentById.get(contract.studentId)
            const preserved = isPreserved(contract, todayKey)
            const preservationStart = contract.status === 'frozen' ? dateKey(contract.frozenAt) : dateKey(currentPreservation(contract, todayKey)?.startDate)
            return <article key={contract.id} className={overdue ? 'is-overdue' : ''} title={`Hợp đồng ${contract.id}`}>
              <div className="finance-management__debt-row">
                <div className="min-w-0">
                  <div className="finance-management__debt-name"><h3><a href={`#/student-360?studentId=${encodeURIComponent(contract.studentId)}&source=admin-pt-students`} aria-label={`Hồ sơ ${studentName(contract.studentId)}`}>{studentName(contract.studentId)}</a></h3>{overdue && <span>Quá hạn</span>}{preserved && <span className="is-frozen">Bảo lưu</span>}{contract.status === 'expired' && <span className="is-review">Hết hạn</span>}{contract.status === 'cancelled' && <span className="is-review">Đã hủy</span>}</div>
                  <p>{student?.phone || 'Chưa có SĐT'} · {contract.packageName}</p>
                  <p className="finance-management__contract-code">HĐ {contract.id}</p>
                </div>
                <div className="finance-management__debt-amount">
                  <b className={balance < 0 ? 'is-credit' : 'is-debt'}>{contract.dataIssue ? 'Chưa xác định' : balance < 0 ? `+${money(Math.abs(balance))}` : money(debt)}</b>
                  <div className="finance-management__debt-meta"><span>{contract.dataIssue ? 'Cần kiểm tra dữ liệu' : balance < 0 ? 'Dư' : debt > 0 ? 'Phải thu' : 'Đã tất toán'}</span>{!contract.dataIssue && balance !== 0 && <button onClick={() => openPayment(contract)} className="finance-management__collect-button" aria-label={`${balance < 0 ? 'Hoàn tiền' : 'Thu tiền'} của ${studentName(contract.studentId)}`}>{balance < 0 ? <Undo2 size={14} /> : <Plus size={14} />}<span>{balance < 0 ? 'Hoàn' : 'Thu'}</span></button>}</div>
                  <small className="finance-management__due-date">{preserved ? (preservationStart ? `Bảo lưu từ ${new Date(`${preservationStart}T12:00:00`).toLocaleDateString('vi-VN')}` : 'Đang bảo lưu') : debt > 0 ? (dateKey(dueDate) ? <><Clock size={12} /> Hạn {new Date(`${dateKey(dueDate)}T12:00:00`).toLocaleDateString('vi-VN')}</> : 'Chưa có hạn thu') : balance < 0 ? 'Cần đối soát' : 'Đã tất toán'}</small>
                </div>
              </div>
            </article>
          })}
          {!debtLoading && !debtError && contracts.length === 0 && <div className="finance-management__empty"><CheckCircle size={36} /><p>{debtHasMore ? 'Chưa gặp hồ sơ phù hợp trong trang này. Tiếp tục tải để tìm thêm.' : debtSearch ? 'Không tìm thấy hồ sơ phù hợp.' : category === 'frozen' && debtFilter === 'all' ? 'Không có hợp đồng bảo lưu còn nợ.' : category === 'installments' && debtFilter === 'all' ? 'Không có hợp đồng trả góp còn nợ.' : 'Không có hợp đồng trong nhóm này.'}</p>{debtSearch && <button type="button" className="finance-management__reset-search" onClick={() => setDebtSearch('')}>Xóa tìm kiếm</button>}</div>}
        </div>
        {debtHasMore && <button type="button" className="finance-management__load-more" disabled={debtLoading} onClick={() => void loadDebts(true)}>{debtLoading ? 'Đang tải…' : 'Tải thêm hồ sơ'}</button>}
      </section>

      <FinancePendingOperations onCompleted={financeCompleted} describeContract={id => { const contract = contracts.find(item => item.id === id); return contract ? `${studentName(contract.studentId)} · ${contract.packageName}` : 'Hợp đồng đã thao tác' }} />
      <AnimatePresence>
        {showHistory && <Modal onClose={() => setShowHistory(false)} title="Sổ giao dịch">
          {ledgerError && <div role="alert" className="mb-4 rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">{ledgerError}<button type="button" onClick={() => void loadLedger(false)} disabled={ledgerLoading} className="ml-3 underline">Thử lại</button></div>}
          {ledgerLoading && <p role="status" className="mb-4 text-sm text-zinc-400">Đang tải giao dịch…</p>}
          <p className="mb-4 rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3 text-xs text-emerald-200">{cashEntries.length.toLocaleString('vi-VN')} giao dịch tiền đã tải. Lịch sử theo chi nhánh và khoảng ngày, gồm mọi nhóm hợp đồng.</p>
          <div className="space-y-2">{cashEntries.map((entry) => <div key={entry.id} className="rounded-xl border border-zinc-800 bg-zinc-950 p-3"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate text-sm font-semibold text-white">{studentName(entry.studentId)}</p><p className="mt-1 text-xs text-zinc-500">{entry.referenceCode} · {entryLabel(entry.type)}</p><p className="mt-1 text-xs text-zinc-600">{new Date(entry.effectiveAt).toLocaleString('vi-VN')}</p></div><div className="text-right"><b className={(entry.cashImpact ?? entry.amount) >= 0 ? 'text-emerald-400' : 'text-amber-400'}>{money(entry.cashImpact ?? entry.amount)}</b>{entry.type === 'payment' && entry.status === 'posted' && (entry.canReverse === true
            ? <button onClick={() => setEntryToReverse(entry)} className="mt-2 flex items-center gap-1 text-xs font-semibold text-amber-400"><Undo2 className="h-3.5 w-3.5" /> Tạo bút toán đảo</button>
            : entry.studentId
              ? <a href={`#/student-360?studentId=${encodeURIComponent(entry.studentId)}&source=admin-pt-students`} aria-label={`Rà soát giao dịch ${entry.referenceCode} trong hồ sơ học viên`} className="mt-2 block text-xs font-semibold text-amber-400">Rà soát trong hồ sơ</a>
              : <span className="mt-2 block text-xs text-zinc-400">Cần rà soát trước khi đảo bút toán</span>)}</div></div></div>)}</div>
          {ledgerHasMore && <button onClick={() => void loadLedger(true)} disabled={ledgerLoading} className="mt-4 min-h-11 w-full rounded-xl border border-zinc-700 bg-zinc-800 text-sm font-bold text-white disabled:opacity-50">{ledgerLoading ? 'Đang tải…' : 'Tải thêm giao dịch'}</button>}
          {!ledgerLoading && !ledgerError && cashEntries.length === 0 && <p className="py-8 text-center text-sm text-zinc-500">Chưa có dòng tiền trong bộ lọc.</p>}
        </Modal>}

        {selectedContract && <Modal onClose={closePayment} title={contractBalance(selectedContract) < 0 ? 'Hoàn thanh toán dư' : 'Thu công nợ'}>
          <FinanceIntentBoundary contractId={selectedContract.id} onCompleted={financeCompleted}>{({ blocked, busy, submit }) => <fieldset disabled={blocked || busy} className="finance-payment-fields">
          <p className="text-sm text-zinc-400">Học viên: <b className="text-white">{studentName(selectedContract.studentId)}</b></p>
          <div className="mt-4 rounded-xl border border-zinc-800 bg-zinc-950 p-4 text-sm"><div className="flex justify-between text-zinc-500"><span>Tổng hợp đồng</span><span className="text-zinc-300">{money(Number(selectedContract.totalPrice || 0) - Number(selectedContract.discount || 0))}</span></div><div className="mt-2 flex justify-between text-zinc-500"><span>Đã thanh toán</span><span className="text-zinc-300">{money(Number(selectedContract.paidAmount || 0))}</span></div></div>
          {contractBalance(selectedContract) > 0 && (selectedContract.installments || []).some((item) => item.status === 'pending') && <div className="mt-4"><p className="mb-2 text-xs font-bold text-zinc-500">Chọn nhanh kỳ trả góp</p><div className="flex flex-wrap gap-2">{selectedContract.installments?.filter((item) => item.status === 'pending').map((item) => <button key={item.id} onClick={() => { setSelectedInstallmentId(item.id); setPayAmount(String(item.amount)) }} className={`rounded-lg border px-3 py-2 text-xs ${selectedInstallmentId === item.id ? 'border-pink-500 bg-pink-500/10 text-pink-300' : 'border-zinc-700 bg-zinc-900 text-zinc-300'}`}>{new Date(item.date).toLocaleDateString('vi-VN')} · {money(item.amount)}</button>)}</div></div>}
          <label className="mt-4 block text-xs font-bold text-zinc-500">Số tiền; nhập số âm để hoàn tiền</label>
          <input type="number" value={payAmount} onChange={(event) => { setPayAmount(event.target.value); setSelectedInstallmentId(null) }} className="mt-2 min-h-12 w-full rounded-xl border border-zinc-700 bg-zinc-950 px-4 text-lg font-bold text-white" />
          <label className="mt-4 block text-xs font-bold text-zinc-500">Quỹ nhận/chi</label>
          <select aria-label="Quỹ nhận/chi" required disabled={cashAccountsLoading || Boolean(cashAccountsError)} value={selectedCashAccountId} onChange={(event) => setSelectedCashAccountId(event.target.value)} className="mt-2 min-h-12 w-full rounded-xl border border-zinc-700 bg-zinc-950 px-4 text-sm font-bold text-white"><option value="">Chọn quỹ bắt buộc</option>{cashAccounts.map((item) => <option key={item.id} value={item.id}>{item.name} · {money(item.balance)}</option>)}</select>
          {cashAccountsLoading && <p role="status" className="mt-2 text-xs text-zinc-400">Đang tải danh sách quỹ…</p>}
          {cashAccountsError && <div className="mt-2 text-xs text-amber-400"><p role="alert">{cashAccountsError}</p><button type="button" onClick={() => void loadPaymentCashAccounts(selectedContract)} className="mt-2 min-h-11 underline">Thử tải lại danh sách quỹ</button></div>}
          {!cashAccountsLoading && !cashAccountsError && !cashAccounts.length && <p className="mt-2 text-xs text-amber-400">Chưa có quỹ. Mở Sổ quỹ và nhập số dư đầu kỳ đã kiểm kê trước khi thu/hoàn.</p>}
          <button onClick={() => void submitPayment(submit)} disabled={blocked || busy || cashAccountsLoading || Boolean(cashAccountsError) || !selectedCashAccountId || !payAmount || Number(payAmount) === 0} className="mt-4 min-h-12 w-full rounded-xl bg-gradient-to-r from-pink-500 to-orange-500 font-bold text-white disabled:opacity-50">{busy ? 'Đang ghi sổ…' : Number(payAmount) < 0 ? 'Ghi khoản hoàn tiền' : 'Ghi khoản thu'}</button>
          </fieldset>}</FinanceIntentBoundary>
        </Modal>}

        {entryToReverse && <Modal onClose={() => setEntryToReverse(null)} title="Đảo bút toán">
          <FinanceIntentBoundary contractId={entryToReverse.contractId} onCompleted={financeCompleted}>{({ blocked, busy, submit }) => <>
          <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 text-sm text-zinc-300">Chứng từ <b className="text-white">{entryToReverse.referenceCode}</b> sẽ không bị xóa. Hệ thống tạo một bút toán âm ở kỳ hiện tại và cập nhật projection hợp đồng trong cùng transaction.</div>
          <button onClick={() => void submit({ type: 'reversal', payload: { entryId: entryToReverse.id, reason: 'Hoàn tác từ trang tài chính' } })} disabled={blocked || busy} className="mt-4 min-h-12 w-full rounded-xl bg-amber-500 font-bold text-zinc-950 disabled:opacity-50">{busy ? 'Đang xử lý…' : 'Xác nhận tạo bút toán đảo'}</button>
          </>}</FinanceIntentBoundary>
        </Modal>}

        {alertMessage && <Modal onClose={() => setAlertMessage(null)} title="Thông báo"><div className="flex items-start gap-3 rounded-xl border border-pink-500/20 bg-pink-500/5 p-4"><AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-pink-400" /><p className="text-sm text-zinc-200">{alertMessage}</p></div></Modal>}
      </AnimatePresence>
    </div>
  )
}

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return <div className="finance-modal-layer fixed inset-0 z-[80] flex items-end justify-center p-3 sm:items-center"><motion.button type="button" aria-label="Đóng" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} className="finance-modal__backdrop absolute inset-0 bg-black/80 backdrop-blur-sm" /><motion.section role="dialog" aria-modal="true" aria-label={title} initial={{ opacity: 0, y: 40 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 40 }} className="finance-modal relative max-h-[calc(100dvh-32px)] w-full max-w-xl overflow-y-auto rounded-t-3xl border border-zinc-800 bg-zinc-900 p-5 pb-[max(20px,env(safe-area-inset-bottom))] shadow-2xl sm:rounded-3xl"><div className="finance-modal__head mb-5 flex items-center justify-between gap-3"><h2 className="text-xl font-bold text-white">{title}</h2><button type="button" onClick={onClose} aria-label="Đóng" className="flex h-10 w-10 items-center justify-center rounded-full bg-zinc-800 text-zinc-400"><X className="h-5 w-5" /></button></div>{children}</motion.section></div>
}
