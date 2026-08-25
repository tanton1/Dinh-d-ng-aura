import React, { useEffect, useMemo, useState } from 'react'
import { motion } from 'motion/react'
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Building2,
  Calendar,
  DollarSign,
  RefreshCw,
  Users,
} from 'lucide-react'
import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { LOGO_URL } from '../../../constants'
import { useDatabase } from '../../../contexts/DatabaseContext'
import {
  emptyFinanceLedgerSummary,
  listFinanceLedger,
  type FinanceLedgerEntry,
  type FinanceLedgerSummary,
} from '../../../services/financeLedgerService'
import TrainerDashboard from './TrainerDashboard'

const COLORS = ['#f43f8c', '#fb7185', '#fb923c', '#fbbf24']
type TimeRange = '7days' | '30days' | 'thisMonth' | 'lastMonth' | 'year'

interface Props {
  onNavigate?: (screen: string) => void
}

interface ReportRange {
  currentStart: Date
  currentEnd: Date
  previousStart: Date
  previousEnd: Date
}

function startOfDay(value: Date) {
  const result = new Date(value)
  result.setHours(0, 0, 0, 0)
  return result
}

function endOfDay(value: Date) {
  const result = new Date(value)
  result.setHours(23, 59, 59, 999)
  return result
}

function reportRange(value: TimeRange, now = new Date()): ReportRange {
  let currentStart = startOfDay(now)
  let currentEnd = endOfDay(now)

  if (value === '7days' || value === '30days') {
    const days = value === '30days' ? 30 : 7
    currentStart.setDate(currentStart.getDate() - days + 1)
    const previousEnd = new Date(currentStart.getTime() - 1)
    const previousStart = startOfDay(previousEnd)
    previousStart.setDate(previousStart.getDate() - days + 1)
    return { currentStart, currentEnd, previousStart, previousEnd }
  }

  if (value === 'thisMonth') {
    currentStart = new Date(now.getFullYear(), now.getMonth(), 1)
    currentEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999)
    return {
      currentStart,
      currentEnd,
      previousStart: new Date(now.getFullYear(), now.getMonth() - 1, 1),
      previousEnd: new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999),
    }
  }

  if (value === 'lastMonth') {
    currentStart = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    currentEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999)
    return {
      currentStart,
      currentEnd,
      previousStart: new Date(now.getFullYear(), now.getMonth() - 2, 1),
      previousEnd: new Date(now.getFullYear(), now.getMonth() - 1, 0, 23, 59, 59, 999),
    }
  }

  currentStart = new Date(now.getFullYear(), 0, 1)
  currentEnd = new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999)
  return {
    currentStart,
    currentEnd,
    previousStart: new Date(now.getFullYear() - 1, 0, 1),
    previousEnd: new Date(now.getFullYear() - 1, 11, 31, 23, 59, 59, 999),
  }
}

function growth(current: number, previous: number) {
  if (previous === 0) return current > 0 ? 100 : 0
  return ((current - previous) / previous) * 100
}

function money(value: number) {
  return `${Math.round(value).toLocaleString('vi-VN')}đ`
}

function entryLabel(type: FinanceLedgerEntry['type']) {
  if (type === 'refund') return 'Hoàn tiền'
  if (type === 'reversal') return 'Đảo bút toán'
  if (type === 'adjustment') return 'Điều chỉnh'
  return 'Thu tiền'
}

export default function AdminReportDashboard({ onNavigate }: Props) {
  const { sessions, trainers, contracts, students, payments, branches } = useDatabase()
  const [timeRange, setTimeRange] = useState<TimeRange>('7days')
  const [selectedBranchId, setSelectedBranchId] = useState('all')
  const [activeTab, setActiveTab] = useState<'overview' | 'pt_report' | 'pt_details'>('overview')
  const [selectedTrainerId, setSelectedTrainerId] = useState<string | null>(null)
  const [currentSummary, setCurrentSummary] = useState<FinanceLedgerSummary>(emptyFinanceLedgerSummary)
  const [previousSummary, setPreviousSummary] = useState<FinanceLedgerSummary>(emptyFinanceLedgerSummary)
  const [recentEntries, setRecentEntries] = useState<FinanceLedgerEntry[]>([])
  const [financeLoading, setFinanceLoading] = useState(true)
  const [financeError, setFinanceError] = useState('')

  const range = useMemo(() => reportRange(timeRange), [timeRange])

  useEffect(() => {
    let active = true
    setFinanceLoading(true)
    setFinanceError('')
    const query = { pageSize: 5, branchId: selectedBranchId }
    void Promise.all([
      listFinanceLedger({ ...query, startAt: range.currentStart.toISOString(), endAt: range.currentEnd.toISOString() }),
      listFinanceLedger({ ...query, startAt: range.previousStart.toISOString(), endAt: range.previousEnd.toISOString() }),
    ]).then(([current, previous]) => {
      if (!active) return
      setCurrentSummary(current.summary)
      setPreviousSummary(previous.summary)
      setRecentEntries(current.entries)
    }).catch(() => {
      if (!active) return
      setFinanceError('Chưa tải được sổ tài chính canonical. Số liệu legacy không được cộng thay thế để tránh báo cáo sai.')
      setCurrentSummary(emptyFinanceLedgerSummary)
      setPreviousSummary(emptyFinanceLedgerSummary)
      setRecentEntries([])
    }).finally(() => {
      if (active) setFinanceLoading(false)
    })
    return () => { active = false }
  }, [range, selectedBranchId])

  const filteredStudents = useMemo(() => students.filter((item) => {
    if (selectedBranchId === 'all') return true
    if (selectedBranchId === 'none') return !item.branchId
    return item.branchId === selectedBranchId
  }), [selectedBranchId, students])

  const filteredContracts = useMemo(() => contracts.filter((item) => {
    if (selectedBranchId === 'all') return true
    if (selectedBranchId === 'none') return !item.branchId
    return item.branchId === selectedBranchId
  }), [contracts, selectedBranchId])

  const filteredTrainers = useMemo(() => trainers.filter((item) => {
    if (selectedBranchId === 'all') return true
    if (selectedBranchId === 'none') return !item.branchId
    return item.branchId === selectedBranchId
  }), [selectedBranchId, trainers])

  const filteredSessions = useMemo(() => sessions.filter((item) => {
    if (selectedBranchId === 'none' && item.branchId) return false
    if (selectedBranchId !== 'all' && selectedBranchId !== 'none' && item.branchId !== selectedBranchId) return false
    const date = new Date(item.date)
    return date >= range.currentStart && date <= range.currentEnd
  }), [range, selectedBranchId, sessions])

  const currentStudents = filteredStudents.filter((item) => {
    if (!item.joinDate) return false
    const date = new Date(item.joinDate)
    return date >= range.currentStart && date <= range.currentEnd
  }).length
  const previousStudents = filteredStudents.filter((item) => {
    if (!item.joinDate) return false
    const date = new Date(item.joinDate)
    return date >= range.previousStart && date <= range.previousEnd
  }).length

  const totalDebt = filteredContracts.reduce((sum, contract) => {
    const debt = Number(contract.totalPrice || 0) - Number(contract.discount || 0) - Number(contract.paidAmount || 0)
    return debt > 0 ? sum + debt : sum
  }, 0)

  const ptRows = filteredTrainers.map((trainer) => {
    const assigned = filteredSessions.filter((session) => session.trainerId === trainer.id)
    return {
      id: trainer.id,
      name: trainer.name,
      completed: assigned.filter((session) => session.status === 'completed').length,
      cancelled: assigned.filter((session) => ['cancelled', 'canceled_by_student', 'student_cancelled', 'trainer_cancelled'].includes(session.status)).length,
      scheduled: assigned.filter((session) => session.status === 'scheduled' || session.status === 'rescheduled').length,
    }
  })

  const legacyMismatchCount = useMemo(() => contracts.filter((contract) => {
    const legacyTotal = payments
      .filter((payment) => payment.contractId === contract.id)
      .reduce((sum, payment) => sum + Number(payment.amount || 0), 0)
    return Math.abs(legacyTotal - Number(contract.paidAmount || 0)) > 1000
  }).length, [contracts, payments])

  const missingBranchCount = students.filter((item) => !item.branchId).length + contracts.filter((item) => !item.branchId).length
  const invalidSessionCount = sessions.filter((item) => !item.studentId || !item.trainerId).length
  const overusedContractCount = contracts.filter((item) => Number(item.usedSessions || 0) > Number(item.totalSessions || 0)).length

  const revenueData = useMemo(() => {
    if (timeRange !== 'year') return currentSummary.dailySeries.map((item) => ({
      name: new Date(`${item.date}T00:00:00+07:00`).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' }),
      total: item.total,
    }))
    const monthly = new Map<string, number>()
    currentSummary.dailySeries.forEach((item) => {
      const month = item.date.slice(0, 7)
      monthly.set(month, Number(monthly.get(month) || 0) + item.total)
    })
    return Array.from(monthly, ([month, total]) => ({ name: `T${Number(month.slice(5, 7))}`, total }))
  }, [currentSummary.dailySeries, timeRange])

  const packageData = Object.entries(filteredContracts.filter((item) => item.status === 'active').reduce<Record<string, number>>((result, contract) => {
    result[contract.packageName || 'Không xác định'] = (result[contract.packageName || 'Không xác định'] || 0) + 1
    return result
  }, {})).map(([name, value]) => ({ name, value }))

  const revenueGrowth = growth(currentSummary.cashNet, previousSummary.cashNet)
  const studentGrowth = growth(currentStudents, previousStudents)

  return (
    <div className="space-y-6 pb-28">
      <header className="rounded-[28px] border border-pink-500/20 bg-gradient-to-br from-zinc-950 via-zinc-950 to-orange-950/40 p-5 shadow-xl shadow-pink-950/20">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-3">
            <img src={LOGO_URL} alt="Aura" className="h-11 w-11 object-contain" />
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-pink-400">Aura Operations</p>
              <h1 className="mt-1 text-2xl font-bold text-white md:text-3xl">Báo cáo & Thống kê</h1>
              <p className="mt-1 text-sm text-zinc-400">Tổng quan vận hành dùng dòng tiền canonical; kết quả kinh doanh được tách riêng theo doanh thu đã thực hiện.</p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:flex">
            <select value={selectedBranchId} onChange={(event) => setSelectedBranchId(event.target.value)} className="min-h-11 rounded-xl border border-zinc-700 bg-zinc-900 px-3 text-sm text-white">
              <option value="all">Tất cả chi nhánh</option>
              <option value="none">Chưa phân chi nhánh</option>
              {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
            </select>
            <select value={timeRange} onChange={(event) => setTimeRange(event.target.value as TimeRange)} className="min-h-11 rounded-xl border border-zinc-700 bg-zinc-900 px-3 text-sm text-white">
              <option value="7days">7 ngày</option>
              <option value="30days">30 ngày</option>
              <option value="thisMonth">Tháng này</option>
              <option value="lastMonth">Tháng trước</option>
              <option value="year">Năm nay</option>
            </select>
          </div>
        </div>
      </header>

      {financeError && <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">{financeError}</div>}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KPICard title="Dòng tiền ròng" value={financeLoading ? 'Đang tải…' : money(currentSummary.cashNet)} trend={`${revenueGrowth >= 0 ? '+' : ''}${revenueGrowth.toFixed(1)}%`} isPositive={revenueGrowth >= 0} icon={<DollarSign className="h-5 w-5 text-pink-400" />} />
        <KPICard title="Học viên mới" value={String(currentStudents)} trend={`${studentGrowth >= 0 ? '+' : ''}${studentGrowth.toFixed(1)}%`} isPositive={studentGrowth >= 0} icon={<Users className="h-5 w-5 text-orange-400" />} />
        <KPICard title="Buổi hoàn thành" value={String(filteredSessions.filter((item) => item.status === 'completed').length)} trend={`${filteredSessions.length} buổi`} isPositive icon={<Calendar className="h-5 w-5 text-emerald-400" />} />
        <KPICard title="Công nợ projection" value={money(totalDebt)} trend={`${filteredContracts.length} HĐ`} isPositive={totalDebt === 0} icon={<Building2 className="h-5 w-5 text-amber-400" />} />
      </div>

      <nav className="grid grid-cols-3 gap-1 rounded-2xl border border-zinc-800 bg-zinc-950 p-1">
        {[
          { id: 'overview', label: 'Tổng quan' },
          { id: 'pt_report', label: 'Vận hành PT' },
          { id: 'pt_details', label: 'Chi tiết PT' },
        ].map((tab) => (
          <button key={tab.id} onClick={() => {
            const next = tab.id as typeof activeTab
            setActiveTab(next)
            if (next === 'pt_details' && !selectedTrainerId) setSelectedTrainerId(filteredTrainers[0]?.id || null)
          }} className={`min-h-11 rounded-xl px-3 text-sm font-semibold ${activeTab === tab.id ? 'bg-gradient-to-r from-pink-500 to-orange-500 text-white' : 'text-zinc-400'}`}>{tab.label}</button>
        ))}
      </nav>

      {activeTab === 'overview' && (
        <>
          <div className="grid gap-4 lg:grid-cols-3">
            <section className="rounded-3xl border border-zinc-800 bg-zinc-950 p-5 lg:col-span-2">
              <div className="mb-5 flex items-center justify-between">
                <div>
                  <h2 className="font-bold text-white">Dòng tiền theo ngày hạch toán</h2>
                  <p className="mt-1 text-xs text-zinc-500">Không dùng ngày bắt đầu hợp đồng. P&L xem tại Tài chính.</p>
                </div>
                <span className="rounded-full bg-pink-500/10 px-3 py-1 text-xs font-bold text-pink-400">Canonical</span>
              </div>
              <div className="h-[280px]">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={revenueData} margin={{ top: 10, right: 10, left: -18, bottom: 0 }}>
                    <defs><linearGradient id="reportRevenue" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#f43f8c" stopOpacity={0.4} /><stop offset="95%" stopColor="#fb923c" stopOpacity={0} /></linearGradient></defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
                    <XAxis dataKey="name" stroke="#71717a" fontSize={11} tickLine={false} axisLine={false} />
                    <YAxis stroke="#71717a" fontSize={11} tickLine={false} axisLine={false} tickFormatter={(value) => `${Number(value) / 1_000_000}M`} />
                    <Tooltip contentStyle={{ backgroundColor: '#18181b', borderColor: '#3f3f46', borderRadius: 12 }} formatter={(value) => money(Number(value) || 0)} />
                    <Area type="monotone" dataKey="total" stroke="#f43f8c" strokeWidth={3} fill="url(#reportRevenue)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </section>

            <section className="rounded-3xl border border-zinc-800 bg-zinc-950 p-5">
              <h2 className="font-bold text-white">Hợp đồng đang hoạt động</h2>
              <p className="mt-1 text-xs text-zinc-500">Phân bố theo gói, không phải doanh thu.</p>
              <div className="mt-4 h-52">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart><Pie data={packageData} innerRadius={55} outerRadius={78} dataKey="value" paddingAngle={4}>{packageData.map((item, index) => <Cell key={item.name} fill={COLORS[index % COLORS.length]} />)}</Pie><Tooltip contentStyle={{ backgroundColor: '#18181b', borderColor: '#3f3f46', borderRadius: 12 }} /></PieChart>
                </ResponsiveContainer>
              </div>
              <div className="space-y-2">{packageData.slice(0, 5).map((item, index) => <div key={item.name} className="flex items-center justify-between text-xs"><span className="flex min-w-0 items-center gap-2 text-zinc-400"><i className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: COLORS[index % COLORS.length] }} /> <span className="truncate">{item.name}</span></span><b className="text-white">{item.value}</b></div>)}</div>
            </section>
          </div>

          <section className="rounded-3xl border border-zinc-800 bg-zinc-950 p-5">
            <div className="mb-4 flex items-center justify-between">
              <div><h2 className="font-bold text-white">Giao dịch canonical gần đây</h2><p className="mt-1 text-xs text-zinc-500">Payment legacy không được cộng vào bảng này.</p></div>
              <button onClick={() => onNavigate?.('admin-finance')} className="text-sm font-bold text-pink-400">Mở kết quả kinh doanh</button>
            </div>
            <div className="space-y-2">
              {recentEntries.map((entry) => {
                const studentName = students.find((item) => item.id === entry.studentId)?.name || 'Học viên đã xóa'
                return <div key={entry.id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-3"><div className="min-w-0"><p className="truncate text-sm font-semibold text-white">{studentName}</p><p className="mt-1 text-xs text-zinc-500">{entry.referenceCode} · {entryLabel(entry.type)} · {new Date(entry.effectiveAt).toLocaleString('vi-VN')}</p></div><b className={entry.amount >= 0 ? 'text-emerald-400' : 'text-amber-400'}>{money(entry.amount)}</b></div>
              })}
              {!financeLoading && recentEntries.length === 0 && <p className="py-8 text-center text-sm text-zinc-500">Chưa có bút toán canonical trong kỳ.</p>}
            </div>
          </section>
        </>
      )}

      {activeTab === 'pt_report' && (
        <section className="rounded-3xl border border-zinc-800 bg-zinc-950 p-5">
          <div className="mb-4"><h2 className="font-bold text-white">Vận hành PT</h2><p className="mt-1 text-xs text-zinc-500">Không ước tính hoa hồng ở trình duyệt; lương phải lấy từ payroll run đã duyệt.</p></div>
          <div className="space-y-2">{ptRows.map((row) => <button key={row.id} onClick={() => { setSelectedTrainerId(row.id); setActiveTab('pt_details') }} className="grid w-full grid-cols-[minmax(0,1fr)_repeat(3,auto)] items-center gap-3 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4 text-left"><span className="truncate font-semibold text-white">{row.name}</span><span className="text-xs text-emerald-400">{row.completed} xong</span><span className="text-xs text-amber-400">{row.cancelled} hủy</span><span className="text-xs text-zinc-400">{row.scheduled} chờ</span></button>)}</div>
        </section>
      )}

      {activeTab === 'pt_details' && (
        <div className="space-y-3">
          <div className="flex gap-2 overflow-x-auto rounded-2xl border border-zinc-800 bg-zinc-950 p-2">{filteredTrainers.map((trainer) => <button key={trainer.id} onClick={() => setSelectedTrainerId(trainer.id)} className={`min-h-10 shrink-0 rounded-xl px-4 text-sm font-semibold ${selectedTrainerId === trainer.id ? 'bg-gradient-to-r from-pink-500 to-orange-500 text-white' : 'bg-zinc-900 text-zinc-400'}`}>{trainer.name}</button>)}</div>
          {selectedTrainerId ? <div className="rounded-3xl border border-zinc-800 bg-zinc-950 p-2 md:p-4"><TrainerDashboard trainerId={selectedTrainerId} /></div> : <p className="rounded-3xl border border-zinc-800 bg-zinc-950 p-8 text-center text-zinc-500">Không có PT trong phạm vi đã chọn.</p>}
        </div>
      )}

      <section className="rounded-3xl border border-amber-500/20 bg-amber-500/5 p-5">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-400" />
          <div className="min-w-0 flex-1">
            <h2 className="font-bold text-white">Đối soát dữ liệu legacy — chỉ đọc</h2>
            <p className="mt-1 text-sm text-zinc-400">Không tự tạo payment, không xóa phiếu và không ghi đè paidAmount. Chênh lệch cần được duyệt thành adjustment/reversal riêng.</p>
            <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <DataQuality label="Phiếu legacy" value={payments.length} />
              <DataQuality label="HĐ lệch projection" value={legacyMismatchCount} warning={legacyMismatchCount > 0} />
              <DataQuality label="Thiếu chi nhánh" value={missingBranchCount} warning={missingBranchCount > 0} />
              <DataQuality label="Session/hợp đồng lỗi" value={invalidSessionCount + overusedContractCount} warning={invalidSessionCount + overusedContractCount > 0} />
            </div>
          </div>
          {financeLoading && <RefreshCw className="h-4 w-4 animate-spin text-pink-400" />}
        </div>
      </section>
    </div>
  )
}

function KPICard({ title, value, trend, isPositive, icon }: { title: string; value: string; trend: string; isPositive: boolean; icon: React.ReactNode }) {
  return <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="min-w-0 rounded-2xl border border-zinc-800 bg-zinc-950 p-4"><div className="flex items-start justify-between gap-2"><span className="rounded-xl bg-zinc-900 p-2">{icon}</span><span className={`flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-bold ${isPositive ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'}`}>{isPositive ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}{trend}</span></div><p className="mt-4 truncate text-[11px] font-bold uppercase tracking-wider text-zinc-500">{title}</p><p className="mt-1 truncate text-lg font-bold text-white sm:text-xl">{value}</p></motion.div>
}

function DataQuality({ label, value, warning = false }: { label: string; value: number; warning?: boolean }) {
  return <div className="rounded-xl border border-zinc-800 bg-zinc-950/80 p-3"><p className="text-[11px] text-zinc-500">{label}</p><p className={`mt-1 text-lg font-bold ${warning ? 'text-amber-400' : 'text-emerald-400'}`}>{value.toLocaleString('vi-VN')}</p></div>
}
