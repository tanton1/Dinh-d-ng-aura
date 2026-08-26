import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { User } from 'firebase/auth'
import { AnimatePresence, motion } from 'motion/react'
import { AlertCircle, CheckCircle, Clock, DollarSign, Plus, RefreshCw, Search, Undo2, WalletCards, X } from 'lucide-react'
import type { StudentContract, UserProfile } from '../../../types'
import { useDatabase } from '../../../contexts/DatabaseContext'
import {
  listFinanceLedger,
  recordContractPayment,
  recordRefund,
  reverseContractPayment,
  type FinanceLedgerEntry,
} from '../../../services/financeLedgerService'
import DateRangeFilter from './DateRangeFilter'
import AuraMetricCarousel, { type AuraMetricSlide } from './AuraMetricCarousel'
import AuraHelpPopover from './AuraHelpPopover'
import { listCashAccounts, type CashAccount } from '../../../services/cashbookService'
import '../../../styles-finance-management.css'

interface Props {
  user: User | null
  profile: UserProfile | null
}

type DebtFilter = 'all' | 'overdue' | 'this-week' | 'this-month' | 'overpaid'

function initialDebtFilter(): DebtFilter {
  const focus = new URLSearchParams(window.location.hash.split('?')[1] || '').get('focus')
  return focus === 'overdue' ? 'overdue' : focus === 'this-week' ? 'this-week' : focus === 'this-month' ? 'this-month' : 'all'
}

function money(value: number) {
  const amount = Number(value)
  return `${Math.round(Number.isFinite(amount) ? amount : 0).toLocaleString('vi-VN')}đ`
}

function contractDebt(contract: StudentContract) {
  const total = Number(contract.totalPrice || 0) - Number(contract.discount || 0)
  const paid = Number(contract.paidAmount || 0)
  const debt = (Number.isFinite(total) ? total : 0) - (Number.isFinite(paid) ? paid : 0)
  return Math.max(0, debt)
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
  return [...(contract.installments || [])]
    .filter((item) => item.status === 'pending' && dateKey(item.date))
    .sort((left, right) => dateKey(left.date).localeCompare(dateKey(right.date)))
}

function amountDueInRange(contract: StudentContract, startKey: string, endKey: string) {
  const debt = contractDebt(contract)
  if (!debt || contract.status === 'frozen') return 0
  const pending = pendingInstallments(contract)
  if (pending.length) {
    const due = pending
      .filter((item) => dateKey(item.date) >= startKey && dateKey(item.date) <= endKey)
      .reduce((sum, item) => sum + Math.max(0, Number(item.amount) || 0), 0)
    return Math.min(debt, due)
  }
  const nextPaymentDate = dateKey(contract.nextPaymentDate)
  return nextPaymentDate >= startKey && nextPaymentDate <= endKey ? debt : 0
}

function overdueAmount(contract: StudentContract, todayKey: string) {
  const debt = contractDebt(contract)
  if (!debt || contract.status === 'frozen') return 0
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

function searchKey(value: unknown) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .toLowerCase()
    .trim()
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

export default function FinanceManagement({ profile }: Props) {
  const { branches, contracts, students } = useDatabase()
  const [selectedBranchId, setSelectedBranchId] = useState('all')
  const [dateRange, setDateRange] = useState<{ start: Date; end: Date }>(currentMonthRange)
  const [debtFilter, setDebtFilter] = useState<DebtFilter>(initialDebtFilter)
  const [ledgerEntries, setLedgerEntries] = useState<FinanceLedgerEntry[]>([])
  const [ledgerCursor, setLedgerCursor] = useState<string | null>(null)
  const [ledgerHasMore, setLedgerHasMore] = useState(false)
  const [ledgerLoading, setLedgerLoading] = useState(false)
  const [ledgerError, setLedgerError] = useState('')
  const [showHistory, setShowHistory] = useState(false)
  const [selectedContract, setSelectedContract] = useState<StudentContract | null>(null)
  const [selectedInstallmentId, setSelectedInstallmentId] = useState<string | null>(null)
  const [payAmount, setPayAmount] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [entryToReverse, setEntryToReverse] = useState<FinanceLedgerEntry | null>(null)
  const [alertMessage, setAlertMessage] = useState<string | null>(null)
  const [cashAccounts, setCashAccounts] = useState<CashAccount[]>([])
  const [selectedCashAccountId, setSelectedCashAccountId] = useState('')
  const [debtSearch, setDebtSearch] = useState('')
  const [visibleDebtCount, setVisibleDebtCount] = useState(20)
  const requestSequence = useRef(0)
  const receivablesRef = useRef<HTMLElement>(null)

  const effectiveBranchId = profile?.branchId && profile.role !== 'admin' && profile.role !== 'super_admin'
    ? profile.branchId
    : selectedBranchId

  const updateDateRange = useCallback((start: Date, end: Date) => {
    setDateRange((current) => current.start.getTime() === start.getTime() && current.end.getTime() === end.getTime()
      ? current
      : { start, end })
  }, [])

  const loadLedger = useCallback(async (append = false) => {
    const sequence = ++requestSequence.current
    setLedgerLoading(true)
    setLedgerError('')
    try {
      const query = {
        pageSize: 50,
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
      if (sequence !== requestSequence.current) return
      setLedgerEntries((current) => {
        if (!append) return page.entries
        const byId = new Map(current.map((entry) => [entry.id, entry]))
        page.entries.forEach((entry) => byId.set(entry.id, entry))
        return Array.from(byId.values())
      })
      setLedgerCursor(page.nextCursor)
      setLedgerHasMore(page.hasMore)
    } catch (cause) {
      if (sequence !== requestSequence.current) return
      setLedgerError(ledgerErrorMessage(cause))
      if (!append) {
        setLedgerEntries([])
      }
    } finally {
      if (sequence === requestSequence.current) setLedgerLoading(false)
    }
  }, [dateRange, effectiveBranchId, ledgerCursor])

  useEffect(() => {
    void loadLedger(false)
    // ledgerCursor is intentionally excluded: a new cursor must not automatically fetch the next page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateRange, effectiveBranchId])

  useEffect(() => {
    let active = true
    void listCashAccounts().then((result) => { if (active) setCashAccounts(result.accounts.filter((item) => item.status === 'active')) }).catch(() => { if (active) setCashAccounts([]) })
    return () => { active = false }
  }, [])

  const filteredContracts = useMemo(() => contracts.filter((contract) => {
    if (effectiveBranchId === 'all') return true
    if (effectiveBranchId === 'none') return !contract.branchId
    return contract.branchId === effectiveBranchId
  }), [contracts, effectiveBranchId])

  const totalDebt = filteredContracts.reduce((sum, contract) => sum + contractDebt(contract), 0)

  const debtGroups = useMemo<Record<DebtFilter, StudentContract[]>>(() => {
    const overpaid = filteredContracts.filter((contract) => Number(contract.paidAmount || 0) > Number(contract.totalPrice || 0) - Number(contract.discount || 0))
    const debtContracts = filteredContracts.filter((contract) => Number(contract.totalPrice || 0) - Number(contract.discount || 0) > Number(contract.paidAmount || 0))
    const now = new Date()
    const todayKey = localDateKey(now)
    const startOfWeek = new Date(now)
    startOfWeek.setDate(now.getDate() - now.getDay())
    startOfWeek.setHours(0, 0, 0, 0)
    const endOfWeek = new Date(startOfWeek)
    endOfWeek.setDate(startOfWeek.getDate() + 6)
    endOfWeek.setHours(23, 59, 59, 999)
    const startOfMonthKey = localDateKey(new Date(now.getFullYear(), now.getMonth(), 1))
    const endOfMonthKey = localDateKey(new Date(now.getFullYear(), now.getMonth() + 1, 0))

    const dueDateOf = (contract: StudentContract) => {
      const nextInstallment = pendingInstallments(contract)[0]
      return nextInstallment?.date || contract.nextPaymentDate || ''
    }
    const sorted = [...debtContracts].sort((left, right) => {
      const leftDate = dueDateOf(left)
      const rightDate = dueDateOf(right)
      const leftTime = leftDate ? new Date(leftDate).getTime() : Number.POSITIVE_INFINITY
      const rightTime = rightDate ? new Date(rightDate).getTime() : Number.POSITIVE_INFINITY
      if (leftTime !== rightTime) return leftTime - rightTime
      const leftDebt = Number(left.totalPrice || 0) - Number(left.discount || 0) - Number(left.paidAmount || 0)
      const rightDebt = Number(right.totalPrice || 0) - Number(right.discount || 0) - Number(right.paidAmount || 0)
      return rightDebt - leftDebt
    })
    const dated = sorted.filter((contract) => contract.status !== 'frozen' && dueDateOf(contract))
    return {
      all: sorted,
      overdue: dated.filter((contract) => overdueAmount(contract, todayKey) > 0),
      'this-week': dated.filter((contract) => {
        const dueDate = new Date(dueDateOf(contract))
        return dueDate >= startOfWeek && dueDate <= endOfWeek
      }),
      'this-month': dated.filter((contract) => amountDueInRange(contract, startOfMonthKey, endOfMonthKey) > 0),
      overpaid,
    }
  }, [filteredContracts])

  const currentDebtMetrics = useMemo(() => {
    const now = new Date()
    const todayKey = localDateKey(now)
    const startOfMonthKey = localDateKey(new Date(now.getFullYear(), now.getMonth(), 1))
    const endOfMonthKey = localDateKey(new Date(now.getFullYear(), now.getMonth() + 1, 0))
    return {
      overdue: filteredContracts.reduce((sum, contract) => sum + overdueAmount(contract, todayKey), 0),
      thisMonth: filteredContracts.reduce((sum, contract) => sum + amountDueInRange(contract, startOfMonthKey, endOfMonthKey), 0),
    }
  }, [filteredContracts])

  const studentById = useMemo(() => new Map(students.map((student) => [student.id, student])), [students])
  const contractsWithDebt = debtGroups[debtFilter]
  const searchedContractsWithDebt = useMemo(() => {
    const query = searchKey(debtSearch)
    if (!query) return contractsWithDebt
    return contractsWithDebt.filter((contract) => {
      const student = studentById.get(contract.studentId)
      return searchKey([
        student?.name,
        student?.phone,
        student?.email,
        contract.packageName,
        contract.id,
      ].join(' ')).includes(query)
    })
  }, [contractsWithDebt, debtSearch, studentById])
  const visibleContractsWithDebt = searchedContractsWithDebt.slice(0, visibleDebtCount)

  useEffect(() => setVisibleDebtCount(20), [debtFilter, debtSearch, effectiveBranchId])

  const cashEntries = useMemo(() => ledgerEntries.filter((entry) => {
    if (entry.cashImpact !== null && Number.isFinite(entry.cashImpact)) return entry.cashImpact !== 0
    return ['payment', 'refund', 'adjustment', 'reversal'].includes(entry.type)
  }), [ledgerEntries])

  const studentName = (studentId: string) => studentById.get(studentId)?.name || 'Học viên đã xóa'

  const openPayment = (contract: StudentContract) => {
    const debt = contractDebt(contract)
    setSelectedContract(contract)
    setSelectedInstallmentId(null)
    setPayAmount(String(Math.max(0, debt)))
    setSelectedCashAccountId(cashAccounts.find((item) => !contract.branchId || item.branchId === contract.branchId)?.id || '')
  }

  const submitPayment = async () => {
    if (!selectedContract || isSubmitting) return
    const amount = Number(payAmount)
    if (!Number.isSafeInteger(amount) || amount === 0) {
      setAlertMessage('Số tiền phải là số nguyên khác 0.')
      return
    }
    setIsSubmitting(true)
    try {
      if (amount > 0) {
        await recordContractPayment({
          contractId: selectedContract.id,
          amount,
          effectiveAt: new Date().toISOString(),
          paymentMethod: 'transfer',
          idempotencyKey: crypto.randomUUID(),
          cashAccountId: selectedCashAccountId || undefined,
          installmentId: selectedInstallmentId || undefined,
          note: selectedInstallmentId ? 'Thanh toán kỳ trả góp' : 'Thanh toán công nợ',
        })
      } else {
        await recordRefund({
          contractId: selectedContract.id,
          amount: Math.abs(amount),
          effectiveAt: new Date().toISOString(),
          paymentMethod: 'transfer',
          installmentId: selectedInstallmentId || undefined,
          cashAccountId: selectedCashAccountId || undefined,
          reason: selectedInstallmentId ? 'Hoàn tiền kỳ trả góp' : 'Hoàn tiền từ trang tài chính',
        })
      }
      setSelectedContract(null)
      setSelectedInstallmentId(null)
      setPayAmount('')
      await loadLedger(false)
      setAlertMessage(amount > 0 ? 'Đã ghi khoản thu và projection hợp đồng trong cùng transaction.' : 'Đã ghi hoàn tiền và projection hợp đồng trong cùng transaction.')
    } catch (error) {
      setAlertMessage(error instanceof Error ? error.message : 'Không thể ghi sổ tài chính.')
    } finally {
      setIsSubmitting(false)
    }
  }

  const submitReversal = async () => {
    if (!entryToReverse || isSubmitting) return
    setIsSubmitting(true)
    try {
      await reverseContractPayment(entryToReverse.id, 'Hoàn tác từ trang tài chính')
      setEntryToReverse(null)
      await loadLedger(false)
      setAlertMessage('Đã tạo bút toán đảo. Chứng từ gốc vẫn được giữ nguyên để kiểm toán.')
    } catch (error) {
      setAlertMessage(error instanceof Error ? error.message : 'Không thể tạo bút toán đảo.')
    } finally {
      setIsSubmitting(false)
    }
  }

  const financeSlides: AuraMetricSlide[] = [
    {
      id: 'total-debt',
      eyebrow: 'Tổng nợ',
      value: money(totalDebt),
      detail: `${debtGroups.all.length.toLocaleString('vi-VN')} hợp đồng còn phải thu`,
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
      value: money(currentDebtMetrics.overdue),
      detail: `${debtGroups.overdue.length.toLocaleString('vi-VN')} hợp đồng cần ưu tiên xử lý`,
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
      value: money(currentDebtMetrics.thisMonth),
      detail: `${debtGroups['this-month'].length.toLocaleString('vi-VN')} hợp đồng có kỳ đến hạn`,
      icon: <Clock size={20} />,
      tone: 'sunset',
      actionLabel: 'Xem tháng này',
      onSelect: () => {
        setDebtFilter('this-month')
        receivablesRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      },
    },
  ]

  const debtFilterOptions: Array<{ id: DebtFilter; label: string; count: number }> = [
    { id: 'all', label: 'Đang nợ', count: debtGroups.all.length },
    { id: 'overdue', label: 'Quá hạn', count: debtGroups.overdue.length },
    { id: 'this-week', label: 'Tuần này', count: debtGroups['this-week'].length },
    { id: 'this-month', label: 'Tháng này', count: debtGroups['this-month'].length },
    { id: 'overpaid', label: 'Thanh toán dư', count: debtGroups.overpaid.length },
  ]

  return (
    <div className="finance-management space-y-6 pb-28">
      <AuraMetricCarousel slides={financeSlides} label="Tổng quan trả góp" />

      {ledgerError && <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">{ledgerError}</div>}

      <div className="finance-management__filters">
        <DateRangeFilter compact excludeFuture initialRange="Tháng này" onFilter={updateDateRange} />
        {(!profile?.branchId || profile.role === 'admin' || profile.role === 'super_admin') && (
          <select aria-label="Lọc chi nhánh công nợ" value={selectedBranchId} onChange={(event) => setSelectedBranchId(event.target.value)}>
            <option value="all">Tất cả chi nhánh</option>
            <option value="none">Chưa phân chi nhánh</option>
            {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
          </select>
        )}
        <button type="button" onClick={() => setShowHistory(true)} className="finance-management__tool-button" aria-label="Mở lịch sử thu trả góp" title="Lịch sử thu"><WalletCards size={17} /></button>
        <button type="button" onClick={() => void loadLedger(false)} disabled={ledgerLoading} className="finance-management__tool-button" aria-label="Làm mới trả góp" title="Làm mới"><RefreshCw size={17} className={ledgerLoading ? 'animate-spin' : ''} /></button>
        <AuraHelpPopover title="Trả góp & công nợ"><p>Ba slide chỉ phản ánh số tiền còn phải thu theo hợp đồng. Bộ lọc ngày áp dụng cho lịch sử giao dịch; dữ liệu tiền thu thực tế vẫn lấy từ ledger canonical.</p></AuraHelpPopover>
      </div>

      <section ref={receivablesRef} className="finance-management__receivables">
        <div className="finance-management__section-head">
          <div className="finance-management__section-title"><h2><DollarSign size={20} /> Công nợ</h2><AuraHelpPopover title="Danh sách công nợ"><p>Số dư lấy từ hợp đồng. Lọc Quá hạn để ưu tiên thu hồi; Thanh toán dư là khoản khách đã nộp vượt số phải thu.</p></AuraHelpPopover></div>
          <strong>{searchedContractsWithDebt.length.toLocaleString('vi-VN')} hồ sơ</strong>
        </div>
        <div className="finance-management__debt-tools">
          <label className="finance-management__debt-search">
            <Search size={17} />
            <input value={debtSearch} onChange={(event) => setDebtSearch(event.target.value)} placeholder="Tên, SĐT, email, gói…" aria-label="Tìm công nợ" />
            {debtSearch && <button type="button" onClick={() => setDebtSearch('')} aria-label="Xóa từ khóa"><X size={15} /></button>}
          </label>
          <div className="finance-management__debt-filters" aria-label="Nhóm công nợ">
            {debtFilterOptions.map((filter) => <button key={filter.id} type="button" onClick={() => setDebtFilter(filter.id)} className={debtFilter === filter.id ? 'is-active' : ''} aria-pressed={debtFilter === filter.id}><span>{filter.label}</span><b>{filter.count}</b></button>)}
          </div>
        </div>
        <div className="finance-management__receivables-list space-y-3">
          {visibleContractsWithDebt.map((contract) => {
            const debt = contractDebt(contract)
            const nextInstallment = pendingInstallments(contract)[0]
            const dueDate = nextInstallment?.date || contract.nextPaymentDate
            const overdue = overdueAmount(contract, localDateKey()) > 0
            const student = studentById.get(contract.studentId)
            return <article key={contract.id} className={overdue ? 'is-overdue' : ''} title={`Hợp đồng ${contract.id}`}><div className="finance-management__debt-row"><div className="min-w-0"><div className="finance-management__debt-name"><h3>{studentName(contract.studentId)}</h3>{overdue && <span>Quá hạn</span>}{contract.status === 'frozen' && <span className="is-frozen">Bảo lưu</span>}</div><p>{student?.phone || 'Chưa có SĐT'} · {contract.packageName}</p></div><div className="finance-management__debt-amount"><b className={debt >= 0 ? 'is-debt' : 'is-credit'}>{debt >= 0 ? money(debt) : `+${money(Math.abs(debt))}`}</b><div className="finance-management__debt-meta"><span>{debt >= 0 ? 'Phải thu' : 'Dư'}</span>{dueDate && debt > 0 && <small><Clock size={12} /> {new Date(dueDate).toLocaleDateString('vi-VN')}</small>}{debt > 0 && <button onClick={() => openPayment(contract)} className="finance-management__collect-button" aria-label={`Thu tiền của ${studentName(contract.studentId)}`}><Plus size={14} /><span>Thu</span></button>}</div></div></div></article>
          })}
          {searchedContractsWithDebt.length === 0 && <div className="finance-management__empty"><CheckCircle size={36} /><p>{debtSearch ? 'Không tìm thấy hồ sơ phù hợp.' : 'Không có hợp đồng trong nhóm này.'}</p></div>}
        </div>
        {visibleDebtCount < searchedContractsWithDebt.length && <button type="button" className="finance-management__load-more" onClick={() => setVisibleDebtCount((current) => current + 20)}>Xem thêm 20 hồ sơ · còn {(searchedContractsWithDebt.length - visibleDebtCount).toLocaleString('vi-VN')}</button>}
      </section>

      <AnimatePresence>
        {showHistory && <Modal onClose={() => setShowHistory(false)} title="Sổ giao dịch">
          <p className="mb-4 rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3 text-xs text-emerald-200">{cashEntries.length.toLocaleString('vi-VN')} giao dịch tiền đã tải. Bút toán doanh thu thực hiện không được trộn vào công nợ trả góp.</p>
          <div className="space-y-2">{cashEntries.map((entry) => <div key={entry.id} className="rounded-xl border border-zinc-800 bg-zinc-950 p-3"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate text-sm font-semibold text-white">{studentName(entry.studentId)}</p><p className="mt-1 text-xs text-zinc-500">{entry.referenceCode} · {entryLabel(entry.type)}</p><p className="mt-1 text-xs text-zinc-600">{new Date(entry.effectiveAt).toLocaleString('vi-VN')}</p></div><div className="text-right"><b className={(entry.cashImpact ?? entry.amount) >= 0 ? 'text-emerald-400' : 'text-amber-400'}>{money(entry.cashImpact ?? entry.amount)}</b>{entry.type === 'payment' && entry.status === 'posted' && <button onClick={() => setEntryToReverse(entry)} className="mt-2 flex items-center gap-1 text-xs font-semibold text-amber-400"><Undo2 className="h-3.5 w-3.5" /> Tạo bút toán đảo</button>}</div></div></div>)}</div>
          {ledgerHasMore && <button onClick={() => void loadLedger(true)} disabled={ledgerLoading} className="mt-4 min-h-11 w-full rounded-xl border border-zinc-700 bg-zinc-800 text-sm font-bold text-white disabled:opacity-50">{ledgerLoading ? 'Đang tải…' : 'Tải thêm giao dịch'}</button>}
          {!ledgerLoading && cashEntries.length === 0 && <p className="py-8 text-center text-sm text-zinc-500">Chưa có dòng tiền trong bộ lọc.</p>}
        </Modal>}

        {selectedContract && <Modal onClose={() => { setSelectedContract(null); setSelectedInstallmentId(null) }} title="Thu công nợ">
          <p className="text-sm text-zinc-400">Học viên: <b className="text-white">{studentName(selectedContract.studentId)}</b></p>
          <div className="mt-4 rounded-xl border border-zinc-800 bg-zinc-950 p-4 text-sm"><div className="flex justify-between text-zinc-500"><span>Tổng hợp đồng</span><span className="text-zinc-300">{money(Number(selectedContract.totalPrice || 0) - Number(selectedContract.discount || 0))}</span></div><div className="mt-2 flex justify-between text-zinc-500"><span>Đã thanh toán</span><span className="text-zinc-300">{money(Number(selectedContract.paidAmount || 0))}</span></div></div>
          {(selectedContract.installments || []).some((item) => item.status === 'pending') && <div className="mt-4"><p className="mb-2 text-xs font-bold text-zinc-500">Chọn nhanh kỳ trả góp</p><div className="flex flex-wrap gap-2">{selectedContract.installments?.filter((item) => item.status === 'pending').map((item) => <button key={item.id} onClick={() => { setSelectedInstallmentId(item.id); setPayAmount(String(item.amount)) }} className={`rounded-lg border px-3 py-2 text-xs ${selectedInstallmentId === item.id ? 'border-pink-500 bg-pink-500/10 text-pink-300' : 'border-zinc-700 bg-zinc-900 text-zinc-300'}`}>{new Date(item.date).toLocaleDateString('vi-VN')} · {money(item.amount)}</button>)}</div></div>}
          <label className="mt-4 block text-xs font-bold text-zinc-500">Số tiền; nhập số âm để hoàn tiền</label>
          <input type="number" value={payAmount} onChange={(event) => { setPayAmount(event.target.value); setSelectedInstallmentId(null) }} className="mt-2 min-h-12 w-full rounded-xl border border-zinc-700 bg-zinc-950 px-4 text-lg font-bold text-white" />
          <label className="mt-4 block text-xs font-bold text-zinc-500">Quỹ nhận/chi</label>
          <select value={selectedCashAccountId} onChange={(event) => setSelectedCashAccountId(event.target.value)} className="mt-2 min-h-12 w-full rounded-xl border border-zinc-700 bg-zinc-950 px-4 text-sm font-bold text-white"><option value="">Chưa phản ánh vào sổ quỹ</option>{cashAccounts.map((item) => <option key={item.id} value={item.id}>{item.name} · {money(item.balance)}</option>)}</select>
          {!cashAccounts.length && <p className="mt-2 text-xs text-amber-400">Chưa có quỹ. Mở Sổ quỹ và nhập số dư đầu kỳ đã kiểm kê trước khi thu/hoàn.</p>}
          <button onClick={() => void submitPayment()} disabled={isSubmitting || !payAmount || Number(payAmount) === 0} className="mt-4 min-h-12 w-full rounded-xl bg-gradient-to-r from-pink-500 to-orange-500 font-bold text-white disabled:opacity-50">{isSubmitting ? 'Đang ghi sổ…' : Number(payAmount) < 0 ? 'Ghi khoản hoàn tiền' : 'Ghi khoản thu'}</button>
        </Modal>}

        {entryToReverse && <Modal onClose={() => setEntryToReverse(null)} title="Đảo bút toán">
          <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 text-sm text-zinc-300">Chứng từ <b className="text-white">{entryToReverse.referenceCode}</b> sẽ không bị xóa. Hệ thống tạo một bút toán âm ở kỳ hiện tại và cập nhật projection hợp đồng trong cùng transaction.</div>
          <button onClick={() => void submitReversal()} disabled={isSubmitting} className="mt-4 min-h-12 w-full rounded-xl bg-amber-500 font-bold text-zinc-950 disabled:opacity-50">{isSubmitting ? 'Đang xử lý…' : 'Xác nhận tạo bút toán đảo'}</button>
        </Modal>}

        {alertMessage && <Modal onClose={() => setAlertMessage(null)} title="Thông báo"><div className="flex items-start gap-3 rounded-xl border border-pink-500/20 bg-pink-500/5 p-4"><AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-pink-400" /><p className="text-sm text-zinc-200">{alertMessage}</p></div></Modal>}
      </AnimatePresence>
    </div>
  )
}

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return <div className="finance-modal-layer fixed inset-0 z-[80] flex items-end justify-center p-3 sm:items-center"><motion.button type="button" aria-label="Đóng" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} className="finance-modal__backdrop absolute inset-0 bg-black/80 backdrop-blur-sm" /><motion.section initial={{ opacity: 0, y: 40 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 40 }} className="finance-modal relative max-h-[calc(100dvh-32px)] w-full max-w-xl overflow-y-auto rounded-t-3xl border border-zinc-800 bg-zinc-900 p-5 pb-[max(20px,env(safe-area-inset-bottom))] shadow-2xl sm:rounded-3xl"><div className="finance-modal__head mb-5 flex items-center justify-between gap-3"><h2 className="text-xl font-bold text-white">{title}</h2><button onClick={onClose} className="flex h-10 w-10 items-center justify-center rounded-full bg-zinc-800 text-zinc-400"><X className="h-5 w-5" /></button></div>{children}</motion.section></div>
}
