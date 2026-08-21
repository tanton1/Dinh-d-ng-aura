import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { User } from 'firebase/auth'
import { AnimatePresence, motion } from 'motion/react'
import { AlertCircle, CheckCircle, Clock, DollarSign, Plus, RefreshCw, TrendingUp, Undo2, X } from 'lucide-react'
import type { StudentContract, UserProfile } from '../../../types'
import { LOGO_URL } from '../../../constants'
import { useDatabase } from '../../../contexts/DatabaseContext'
import {
  emptyFinanceLedgerSummary,
  listFinanceLedger,
  recordContractPayment,
  recordRefund,
  reverseContractPayment,
  type FinanceLedgerEntry,
  type FinanceLedgerSummary,
} from '../../../services/financeLedgerService'
import DateRangeFilter from './DateRangeFilter'
import { listCashAccounts, type CashAccount } from '../../../services/cashbookService'

interface Props {
  user: User | null
  profile: UserProfile | null
}

type DebtFilter = 'all' | 'overdue' | 'this-week' | 'this-month' | 'overpaid'

function money(value: number) {
  return `${Math.round(value).toLocaleString('vi-VN')}đ`
}

function entryLabel(type: FinanceLedgerEntry['type']) {
  if (type === 'refund') return 'Hoàn tiền'
  if (type === 'reversal') return 'Đảo bút toán'
  if (type === 'adjustment') return 'Điều chỉnh'
  return 'Thu tiền'
}

export default function FinanceManagement({ profile }: Props) {
  const { branches, contracts, students, payments } = useDatabase()
  const [selectedBranchId, setSelectedBranchId] = useState('all')
  const [dateRange, setDateRange] = useState<{ start: Date; end: Date } | null>(null)
  const [debtFilter, setDebtFilter] = useState<DebtFilter>('all')
  const [ledgerEntries, setLedgerEntries] = useState<FinanceLedgerEntry[]>([])
  const [ledgerSummary, setLedgerSummary] = useState<FinanceLedgerSummary>(emptyFinanceLedgerSummary)
  const [ledgerCursor, setLedgerCursor] = useState<string | null>(null)
  const [ledgerHasMore, setLedgerHasMore] = useState(false)
  const [ledgerLoading, setLedgerLoading] = useState(false)
  const [ledgerError, setLedgerError] = useState('')
  const [showHistory, setShowHistory] = useState(false)
  const [showLegacyReconciliation, setShowLegacyReconciliation] = useState(false)
  const [selectedContract, setSelectedContract] = useState<StudentContract | null>(null)
  const [selectedInstallmentId, setSelectedInstallmentId] = useState<string | null>(null)
  const [payAmount, setPayAmount] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [entryToReverse, setEntryToReverse] = useState<FinanceLedgerEntry | null>(null)
  const [alertMessage, setAlertMessage] = useState<string | null>(null)
  const [cashAccounts, setCashAccounts] = useState<CashAccount[]>([])
  const [selectedCashAccountId, setSelectedCashAccountId] = useState('')
  const requestSequence = useRef(0)

  const effectiveBranchId = profile?.branchId && profile.role !== 'admin' && profile.role !== 'super_admin'
    ? profile.branchId
    : selectedBranchId

  const loadLedger = useCallback(async (append = false) => {
    const sequence = ++requestSequence.current
    setLedgerLoading(true)
    setLedgerError('')
    try {
      const page = await listFinanceLedger({
        pageSize: 50,
        cursor: append ? ledgerCursor : null,
        branchId: effectiveBranchId,
        startAt: dateRange && dateRange.start.getTime() > 0 ? dateRange.start.toISOString() : undefined,
        endAt: dateRange && dateRange.end.getFullYear() <= 9999 ? dateRange.end.toISOString() : undefined,
      })
      if (sequence !== requestSequence.current) return
      setLedgerEntries((current) => {
        if (!append) return page.entries
        const byId = new Map(current.map((entry) => [entry.id, entry]))
        page.entries.forEach((entry) => byId.set(entry.id, entry))
        return Array.from(byId.values())
      })
      setLedgerSummary(page.summary)
      setLedgerCursor(page.nextCursor)
      setLedgerHasMore(page.hasMore)
    } catch {
      if (sequence !== requestSequence.current) return
      setLedgerError('Không thể tải ledger canonical. Aura không dùng payment legacy thay thế để tránh cộng trùng doanh thu.')
      if (!append) {
        setLedgerEntries([])
        setLedgerSummary(emptyFinanceLedgerSummary)
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

  const totalDebt = filteredContracts.reduce((sum, contract) => {
    const debt = Number(contract.totalPrice || 0) - Number(contract.discount || 0) - Number(contract.paidAmount || 0)
    return debt > 0 ? sum + debt : sum
  }, 0)

  const contractsWithDebt = useMemo(() => {
    if (debtFilter === 'overpaid') return filteredContracts.filter((contract) => Number(contract.paidAmount || 0) > Number(contract.totalPrice || 0) - Number(contract.discount || 0))
    const debtContracts = filteredContracts.filter((contract) => Number(contract.totalPrice || 0) - Number(contract.discount || 0) > Number(contract.paidAmount || 0))
    if (debtFilter === 'all') return debtContracts

    const now = new Date()
    const startOfWeek = new Date(now)
    startOfWeek.setDate(now.getDate() - now.getDay())
    startOfWeek.setHours(0, 0, 0, 0)
    const endOfWeek = new Date(startOfWeek)
    endOfWeek.setDate(startOfWeek.getDate() + 6)
    endOfWeek.setHours(23, 59, 59, 999)
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999)

    return debtContracts.filter((contract) => {
      const nextInstallment = [...(contract.installments || [])]
        .filter((item) => item.status === 'pending')
        .sort((a, b) => String(a.date).localeCompare(String(b.date)))[0]
      const dateValue = nextInstallment?.date || contract.nextPaymentDate
      if (!dateValue || contract.status === 'frozen') return false
      const dueDate = new Date(dateValue)
      if (debtFilter === 'overdue') return dueDate < now
      if (debtFilter === 'this-week') return dueDate >= startOfWeek && dueDate <= endOfWeek
      return dueDate >= startOfMonth && dueDate <= endOfMonth
    })
  }, [debtFilter, filteredContracts])

  const legacyReconciliation = useMemo(() => {
    const rows = contracts.map((contract) => {
      const legacyTotal = payments
        .filter((payment) => payment.contractId === contract.id)
        .reduce((sum, payment) => sum + Number(payment.amount || 0), 0)
      const projection = Number(contract.paidAmount || 0)
      return { contractId: contract.id, legacyTotal, projection, difference: projection - legacyTotal }
    }).filter((row) => Math.abs(row.difference) > 1000)
    return {
      rows,
      legacyPaymentCount: payments.length,
      legacyTotal: payments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0),
    }
  }, [contracts, payments])

  const studentName = (studentId: string) => students.find((student) => student.id === studentId)?.name || 'Học viên đã xóa'

  const openPayment = (contract: StudentContract) => {
    const debt = Number(contract.totalPrice || 0) - Number(contract.discount || 0) - Number(contract.paidAmount || 0)
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

  return (
    <div className="space-y-6 pb-28">
      <header className="rounded-[28px] border border-pink-500/20 bg-gradient-to-br from-zinc-950 via-zinc-950 to-orange-950/40 p-5 shadow-xl shadow-pink-950/20">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3">
            <img src={LOGO_URL} alt="Aura" className="h-11 w-11 object-contain" />
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-pink-400">Aura Finance</p>
              <h1 className="mt-1 text-2xl font-bold text-white md:text-3xl">Tài chính & Công nợ</h1>
              <p className="mt-1 text-sm text-zinc-400">Ledger canonical bất biến; dữ liệu legacy chỉ dùng đối soát.</p>
            </div>
          </div>
          <button onClick={() => setShowLegacyReconciliation(true)} className="min-h-11 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 text-sm font-bold text-amber-300">Đối soát legacy · {legacyReconciliation.rows.length}</button>
        </div>
      </header>

      {ledgerError && <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">{ledgerError}</div>}

      <div className="flex flex-wrap items-center gap-2">
        <DateRangeFilter onFilter={(start, end) => setDateRange({ start, end })} />
        {(!profile?.branchId || profile.role === 'admin' || profile.role === 'super_admin') && (
          <select value={selectedBranchId} onChange={(event) => setSelectedBranchId(event.target.value)} className="min-h-11 rounded-xl border border-zinc-800 bg-zinc-950 px-4 text-sm font-medium text-zinc-300">
            <option value="all">Tất cả chi nhánh</option>
            <option value="none">Chưa phân chi nhánh</option>
            {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
          </select>
        )}
        <button onClick={() => void loadLedger(false)} disabled={ledgerLoading} className="flex min-h-11 items-center gap-2 rounded-xl border border-zinc-800 bg-zinc-950 px-4 text-sm font-semibold text-zinc-300 disabled:opacity-50"><RefreshCw className={`h-4 w-4 ${ledgerLoading ? 'animate-spin' : ''}`} /> Làm mới</button>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <button onClick={() => setShowHistory(true)} className="rounded-2xl border border-emerald-500/20 bg-zinc-950 p-4 text-left"><div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-zinc-500"><TrendingUp className="h-4 w-4 text-emerald-400" /> Doanh thu thuần</div><p className="mt-3 truncate text-xl font-bold text-white">{ledgerLoading && ledgerEntries.length === 0 ? 'Đang tải…' : money(ledgerSummary.netRevenue)}</p></button>
        <MetricCard label="Đã thu" value={money(ledgerSummary.collectedAmount)} color="text-emerald-400" />
        <MetricCard label="Hoàn/đảo" value={money(ledgerSummary.refundedAmount + ledgerSummary.reversedAmount)} color="text-amber-400" />
        <MetricCard label="Công nợ projection" value={money(totalDebt)} color="text-rose-400" />
      </div>

      <section>
        <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div><h2 className="flex items-center gap-2 text-lg font-bold text-white"><DollarSign className="h-5 w-5 text-pink-400" /> Danh sách cần thu</h2><p className="mt-1 text-xs text-zinc-500">Projection công nợ từ hợp đồng; mọi khoản thu mới đi qua transaction.</p></div>
          <div className="flex flex-wrap gap-2">{[
            { id: 'all', label: 'Tất cả' },
            { id: 'overdue', label: 'Quá hạn' },
            { id: 'this-week', label: 'Tuần này' },
            { id: 'this-month', label: 'Tháng này' },
            { id: 'overpaid', label: 'Thanh toán dư' },
          ].map((filter) => <button key={filter.id} onClick={() => setDebtFilter(filter.id as DebtFilter)} className={`min-h-9 rounded-lg px-3 text-xs font-semibold ${debtFilter === filter.id ? 'bg-gradient-to-r from-pink-500 to-orange-500 text-white' : 'bg-zinc-900 text-zinc-400'}`}>{filter.label}</button>)}</div>
        </div>
        <div className="space-y-3">
          {contractsWithDebt.map((contract) => {
            const debt = Number(contract.totalPrice || 0) - Number(contract.discount || 0) - Number(contract.paidAmount || 0)
            const nextInstallment = [...(contract.installments || [])].filter((item) => item.status === 'pending').sort((a, b) => String(a.date).localeCompare(String(b.date)))[0]
            const dueDate = nextInstallment?.date || contract.nextPaymentDate
            const overdue = contract.status !== 'frozen' && debt > 0 && Boolean(dueDate && new Date(dueDate) < new Date())
            return <article key={contract.id} className={`rounded-2xl border bg-zinc-950 p-4 ${overdue ? 'border-rose-500/40' : 'border-zinc-800'}`}><div className="flex items-center justify-between gap-3"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h3 className="truncate font-semibold text-white">{studentName(contract.studentId)}</h3>{overdue && <span className="rounded-full bg-rose-500 px-2 py-0.5 text-[10px] font-bold text-white">Quá hạn</span>}</div><p className="mt-1 truncate text-xs text-zinc-500">{contract.packageName} · HĐ {contract.id}</p><div className="mt-2 flex flex-wrap items-center gap-3 text-sm"><b className={debt >= 0 ? 'text-rose-400' : 'text-emerald-400'}>{debt >= 0 ? `Nợ ${money(debt)}` : `Dư ${money(Math.abs(debt))}`}</b>{dueDate && debt > 0 && <span className="flex items-center gap-1 text-xs text-zinc-500"><Clock className="h-3 w-3" /> Kỳ tiếp {new Date(dueDate).toLocaleDateString('vi-VN')}</span>}</div></div>{debt > 0 && <button onClick={() => openPayment(contract)} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-pink-500 to-orange-500 text-white"><Plus className="h-5 w-5" /></button>}</div></article>
          })}
          {contractsWithDebt.length === 0 && <div className="rounded-2xl border border-zinc-800 bg-zinc-950 py-10 text-center"><CheckCircle className="mx-auto h-9 w-9 text-emerald-400" /><p className="mt-3 text-sm text-zinc-400">Không có hợp đồng trong nhóm này.</p></div>}
        </div>
      </section>

      <AnimatePresence>
        {showHistory && <Modal onClose={() => setShowHistory(false)} title="Ledger canonical">
          <p className="mb-4 rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3 text-xs text-emerald-200">{ledgerSummary.transactionCount.toLocaleString('vi-VN')} bút toán trong bộ lọc. Payment legacy không xuất hiện ở đây.</p>
          <div className="space-y-2">{ledgerEntries.map((entry) => <div key={entry.id} className="rounded-xl border border-zinc-800 bg-zinc-950 p-3"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate text-sm font-semibold text-white">{studentName(entry.studentId)}</p><p className="mt-1 text-xs text-zinc-500">{entry.referenceCode} · {entryLabel(entry.type)}</p><p className="mt-1 text-xs text-zinc-600">{new Date(entry.effectiveAt).toLocaleString('vi-VN')}</p></div><div className="text-right"><b className={entry.amount >= 0 ? 'text-emerald-400' : 'text-amber-400'}>{money(entry.amount)}</b>{entry.type === 'payment' && entry.status === 'posted' && <button onClick={() => setEntryToReverse(entry)} className="mt-2 flex items-center gap-1 text-xs font-semibold text-amber-400"><Undo2 className="h-3.5 w-3.5" /> Tạo bút toán đảo</button>}</div></div></div>)}</div>
          {ledgerHasMore && <button onClick={() => void loadLedger(true)} disabled={ledgerLoading} className="mt-4 min-h-11 w-full rounded-xl border border-zinc-700 bg-zinc-800 text-sm font-bold text-white disabled:opacity-50">{ledgerLoading ? 'Đang tải…' : 'Tải thêm giao dịch'}</button>}
          {!ledgerLoading && ledgerEntries.length === 0 && <p className="py-8 text-center text-sm text-zinc-500">Chưa có bút toán canonical.</p>}
        </Modal>}

        {showLegacyReconciliation && <Modal onClose={() => setShowLegacyReconciliation(false)} title="Đối soát legacy — chỉ đọc">
          <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 text-sm text-amber-100">Aura không tự xóa, tạo phiếu tổng hợp hoặc cộng payment legacy vào doanh thu canonical.</div>
          <div className="mt-4 grid grid-cols-2 gap-2"><MetricCard label="Phiếu legacy" value={legacyReconciliation.legacyPaymentCount.toLocaleString('vi-VN')} color="text-white" /><MetricCard label="Tổng legacy" value={money(legacyReconciliation.legacyTotal)} color="text-amber-400" /></div>
          <h3 className="mt-5 text-sm font-bold text-white">{legacyReconciliation.rows.length} hợp đồng lệch projection</h3>
          <div className="mt-3 max-h-72 space-y-2 overflow-y-auto">{legacyReconciliation.rows.slice(0, 50).map((row) => <div key={row.contractId} className="rounded-xl border border-zinc-800 bg-zinc-950 p-3 text-xs"><p className="font-mono text-zinc-300">{row.contractId}</p><div className="mt-2 flex justify-between gap-3 text-zinc-500"><span>Legacy {money(row.legacyTotal)}</span><span>Projection {money(row.projection)}</span><b className="text-amber-400">Lệch {money(row.difference)}</b></div></div>)}</div>
          {legacyReconciliation.rows.length > 50 && <p className="mt-3 text-center text-xs text-zinc-500">Chỉ hiển thị 50 bản ghi đầu. Không có thao tác sửa dữ liệu tại đây.</p>}
        </Modal>}

        {selectedContract && <Modal onClose={() => { setSelectedContract(null); setSelectedInstallmentId(null) }} title="Ghi sổ công nợ">
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

        {entryToReverse && <Modal onClose={() => setEntryToReverse(null)} title="Tạo bút toán đảo">
          <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 text-sm text-zinc-300">Chứng từ <b className="text-white">{entryToReverse.referenceCode}</b> sẽ không bị xóa. Hệ thống tạo một bút toán âm ở kỳ hiện tại và cập nhật projection hợp đồng trong cùng transaction.</div>
          <button onClick={() => void submitReversal()} disabled={isSubmitting} className="mt-4 min-h-12 w-full rounded-xl bg-amber-500 font-bold text-zinc-950 disabled:opacity-50">{isSubmitting ? 'Đang xử lý…' : 'Xác nhận tạo bút toán đảo'}</button>
        </Modal>}

        {alertMessage && <Modal onClose={() => setAlertMessage(null)} title="Thông báo"><div className="flex items-start gap-3 rounded-xl border border-pink-500/20 bg-pink-500/5 p-4"><AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-pink-400" /><p className="text-sm text-zinc-200">{alertMessage}</p></div></Modal>}
      </AnimatePresence>
    </div>
  )
}

function MetricCard({ label, value, color }: { label: string; value: string; color: string }) {
  return <div className="min-w-0 rounded-2xl border border-zinc-800 bg-zinc-950 p-4"><p className="truncate text-[11px] font-bold uppercase tracking-wider text-zinc-500">{label}</p><p className={`mt-3 truncate text-lg font-bold sm:text-xl ${color}`}>{value}</p></div>
}

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return <div className="fixed inset-0 z-[80] flex items-end justify-center p-3 sm:items-center"><motion.button type="button" aria-label="Đóng" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} className="absolute inset-0 bg-black/80 backdrop-blur-sm" /><motion.section initial={{ opacity: 0, y: 40 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 40 }} className="relative max-h-[calc(100dvh-32px)] w-full max-w-xl overflow-y-auto rounded-t-3xl border border-zinc-800 bg-zinc-900 p-5 pb-[max(20px,env(safe-area-inset-bottom))] shadow-2xl sm:rounded-3xl"><div className="mb-5 flex items-center justify-between gap-3"><h2 className="text-xl font-bold text-white">{title}</h2><button onClick={onClose} className="flex h-10 w-10 items-center justify-center rounded-full bg-zinc-800 text-zinc-400"><X className="h-5 w-5" /></button></div>{children}</motion.section></div>
}
