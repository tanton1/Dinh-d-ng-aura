import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertCircle, ArrowLeft, Building2, CalendarDays, CheckCircle2, Clock3, RefreshCw, Search, UserRound, UsersRound } from 'lucide-react'
import type { ViewId } from '../../types'
import { getOperationsDashboard, type OperationsDashboardData } from '../../services/operationsDashboardService'
import './AdminTodaySessionsPage.css'

type TodayRow = OperationsDashboardData['today']['rows'][number]
type DetailStatus = TodayRow['attendanceStatus'] | 'upcoming'
type AttendanceFilter = 'all' | DetailStatus

const statusLabels: Record<DetailStatus, string> = {
  upcoming: 'Sắp tới',
  pending: 'Chờ PT',
  present: 'Có tập',
  late: 'Đi trễ',
  no_show: 'Vắng',
}

function vietnamTodayKey() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date())
}

function todayRange() {
  const key = vietnamTodayKey()
  return { startAt: `${key}T00:00:00+07:00`, endAt: `${key}T23:59:59+07:00` }
}

function todayCaption() {
  return new Intl.DateTimeFormat('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh', weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric',
  }).format(new Date())
}

function vietnamCurrentHour() {
  return Number(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', hourCycle: 'h23' }).format(new Date()))
}

function detailStatus(row: TodayRow): DetailStatus {
  if (row.attendanceStatus !== 'pending') return row.attendanceStatus
  return row.billingStatus !== 'charged' && row.hour !== null && row.hour > vietnamCurrentHour() ? 'upcoming' : 'pending'
}

function loadErrorMessage(error: unknown) {
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : ''
  if (code.includes('permission-denied')) return 'Tài khoản chưa có quyền xem ca tập trong phạm vi này.'
  if (code.includes('unauthenticated')) return 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.'
  return 'Dịch vụ ca tập hôm nay chưa phản hồi. Hãy thử tải lại.'
}

interface ShiftGroup {
  key: string
  hour: number | null
  trainerId: string
  trainerName: string
  rows: TodayRow[]
}

function groupRows(rows: TodayRow[]) {
  const groups = new Map<string, ShiftGroup>()
  for (const row of rows) {
    const key = `${row.hour ?? 'unknown'}:${row.trainerId || row.trainerName}`
    const current = groups.get(key) ?? { key, hour: row.hour, trainerId: row.trainerId, trainerName: row.trainerName, rows: [] }
    current.rows.push(row)
    groups.set(key, current)
  }
  return [...groups.values()].sort((left, right) => (left.hour ?? 99) - (right.hour ?? 99) || left.trainerName.localeCompare(right.trainerName, 'vi'))
}

export default function AdminTodaySessionsPage({ onNavigate }: { onNavigate: (view: ViewId) => void }) {
  const [data, setData] = useState<OperationsDashboardData | null>(null)
  const [branchId, setBranchId] = useState('all')
  const [filter, setFilter] = useState<AttendanceFilter>('all')
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async (forceRefresh = false) => {
    forceRefresh ? setRefreshing(true) : setLoading(true)
    setError('')
    try {
      const result = await getOperationsDashboard({ ...todayRange(), branchId, forceRefresh })
      setData(result)
    } catch (loadError) {
      setError(loadErrorMessage(loadError))
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [branchId])

  useEffect(() => { void load() }, [load])

  const summary = useMemo(() => {
    const rows = data?.today.rows ?? []
    return {
      shifts: groupRows(rows).length,
      upcoming: rows.filter((row) => detailStatus(row) === 'upcoming').length,
      present: rows.filter((row) => detailStatus(row) === 'present').length,
      late: rows.filter((row) => detailStatus(row) === 'late').length,
      noShow: rows.filter((row) => detailStatus(row) === 'no_show').length,
      pending: rows.filter((row) => detailStatus(row) === 'pending').length,
    }
  }, [data])

  const visibleRows = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase('vi')
    return (data?.today.rows ?? []).filter((row) => {
      if (filter !== 'all' && detailStatus(row) !== filter) return false
      if (!normalizedQuery) return true
      return `${row.studentName} ${row.trainerName}`.toLocaleLowerCase('vi').includes(normalizedQuery)
    })
  }, [data, filter, query])
  const shifts = useMemo(() => groupRows(visibleRows), [visibleRows])

  const filters: Array<{ id: AttendanceFilter; label: string; value: number }> = [
    { id: 'all', label: 'Ca dạy', value: summary.shifts },
    { id: 'upcoming', label: 'Sắp tới', value: summary.upcoming },
    { id: 'present', label: 'Có tập', value: summary.present },
    { id: 'late', label: 'Đi trễ', value: summary.late },
    { id: 'no_show', label: 'Vắng', value: summary.noShow },
    { id: 'pending', label: 'Chờ PT', value: summary.pending },
  ]

  return <main className="today-sessions-page">
    <header className="today-sessions-page__header">
      <button type="button" className="today-sessions-page__back" onClick={() => onNavigate('admin-dashboard')} aria-label="Quay lại Tổng quan"><ArrowLeft size={18} /></button>
      <div><small>AURA OPERATIONS · HIỆN DIỆN</small><h1>Ca tập hôm nay</h1><p><CalendarDays size={14} /> {todayCaption()}</p></div>
      <div className="today-sessions-page__actions">
        {data && data.filters.branches.length > 1 ? <label><Building2 size={15} /><select value={branchId} onChange={(event) => setBranchId(event.target.value)} aria-label="Lọc ca theo chi nhánh"><option value="all">Tất cả cơ sở</option>{data.filters.branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label> : null}
        <button type="button" onClick={() => void load(true)} disabled={refreshing} aria-label="Làm mới ca tập"><RefreshCw size={17} className={refreshing ? 'is-spinning' : ''} /><span>Làm mới</span></button>
      </div>
    </header>

    <nav className="today-sessions-page__metrics" aria-label="Lọc theo tình trạng ca tập">
      {filters.map((item) => <button key={item.id} type="button" className={`${filter === item.id ? 'is-active' : ''} is-${item.id}`} aria-pressed={filter === item.id} onClick={() => setFilter(item.id)}><small>{item.label}</small><b>{item.value}</b></button>)}
    </nav>

    <section className="today-sessions-page__toolbar" aria-label="Tìm kiếm ca tập">
      <label><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tìm học viên hoặc PT" aria-label="Tìm học viên hoặc PT" /></label>
      <span>{visibleRows.length} lượt học viên · {shifts.length} ca dạy</span>
    </section>

    {error ? <div className="today-sessions-page__notice is-error"><AlertCircle size={20} /><span>{error}</span><button type="button" onClick={() => void load(true)}>Thử lại</button></div> : null}
    {data?.today.truncated ? <div className="today-sessions-page__notice"><AlertCircle size={19} /><span>Danh sách hôm nay vượt giới hạn hiển thị nhanh. Hãy chọn từng chi nhánh để xem đầy đủ hơn.</span></div> : null}

    {loading && !data ? <div className="today-sessions-page__loading" role="status"><i /><i /><i /></div> : null}
    {!loading && !error && shifts.length === 0 ? <div className="today-sessions-page__empty"><CheckCircle2 size={30} /><strong>Không có ca phù hợp</strong><span>Hãy đổi tình trạng, từ khóa hoặc chi nhánh đang chọn.</span></div> : null}

    <div className="today-sessions-page__list">
      {shifts.map((shift) => <article key={shift.key} className="today-session-shift">
        <header><time>{shift.hour === null ? '—' : `${String(shift.hour).padStart(2, '0')}:00`}</time><div><small>PT PHỤ TRÁCH</small><strong>{shift.trainerName}</strong></div><span><UsersRound size={14} /> {shift.rows.length} học viên</span></header>
        <div>{shift.rows.map((row) => {
          const state = detailStatus(row)
          return <section key={row.id} className={`is-${state}`}>
            <span className="today-session-shift__avatar"><UserRound size={18} /></span>
            <div><strong>{row.studentName}</strong><small>{row.billingStatus === 'charged' ? 'Đã tính buổi' : 'Chưa tính buổi'}</small></div>
            <em className={`today-session-shift__status is-${state}`}>{state === 'pending' || state === 'upcoming' ? <Clock3 size={13} /> : <CheckCircle2 size={13} />}{statusLabels[state]}</em>
          </section>
        })}</div>
      </article>)}
    </div>
  </main>
}
