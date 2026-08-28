import { useCallback, useEffect, useMemo, useState } from 'react'
import { CalendarDays, CheckCircle2, ChevronDown, CircleAlert, Clock3, Info, RefreshCw, SlidersHorizontal, UserRound, UsersRound } from 'lucide-react'
import { getStudentContractUsage, listStudentTrainingHistory, listTrainerTeachingHistory, type ContractUsageSummary, type TrainingHistoryPage, type TrainingHistoryStatus } from '../../../services/businessReportingService'
import '../../../styles-training-history.css'

type Props = {
  subject: 'student' | 'trainer'
  subjectId: string
  subjectName: string
  contractId?: string
}

function vietnamDateKey(value = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(value)
  const part = (type: string) => parts.find((item) => item.type === type)?.value || ''
  return `${part('year')}-${part('month')}-${part('day')}`
}

function todayKey() {
  return vietnamDateKey()
}

function daysAgoKey(days: number) {
  const date = new Date()
  date.setDate(date.getDate() - days)
  return vietnamDateKey(date)
}

const statusOptions: Array<{ value: TrainingHistoryStatus; label: string }> = [
  { value: 'all', label: 'Tất cả trạng thái' },
  { value: 'scheduled', label: 'Đã lên lịch' },
  { value: 'completed', label: 'Đã hoàn thành' },
  { value: 'student_cancelled', label: 'HV báo nghỉ' },
  { value: 'trainer_cancelled', label: 'PT hủy' },
  { value: 'no_show', label: 'Vắng mặt' },
]

function statusLabel(status: string) {
  const found = statusOptions.find((item) => item.value === status)
  if (found) return found.label
  if (status === 'rescheduled') return 'Đã đổi lịch'
  if (status === 'attended') return 'Đã hoàn thành'
  if (status === 'corrected') return 'Đã điều chỉnh'
  return status || 'Không xác định'
}

function formatDate(value: string) {
  if (!value) return 'Chưa xác định ngày'
  const parsed = new Date(`${value.slice(0, 10)}T12:00:00+07:00`)
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString('vi-VN', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' })
}

function attendanceLabel(record: TrainingHistoryPage['records'][number]) {
  const status = record.attendance?.attendanceStatus
  if (status === 'present') return 'Có tập'
  if (status === 'late') return `Đi trễ${record.attendance?.lateMinutes ? ` ${record.attendance.lateMinutes}${record.attendance.lateMinutes === 15 ? '+' : ''} phút` : ''}`
  if (status === 'no_show') return 'Không đến'
  if (record.attendance?.billingStatus === 'charged') return 'Đã tính · chờ PT'
  return 'Chưa tính / xác nhận'
}

type TrainerTeachingShift = {
  key: string
  date: string
  hour: number | null
  branchId: string
  studentCount: number
  records: TrainingHistoryPage['records']
}

function groupTrainerTeachingShifts(records: TrainingHistoryPage['records']): TrainerTeachingShift[] {
  const groups = new Map<string, TrainerTeachingShift>()
  records.forEach((record) => {
    const key = record.date && record.hour !== null
      ? `${record.date}|${record.hour}`
      : `unknown|${record.id}`
    const current = groups.get(key)
    if (current) current.records.push(record)
    else groups.set(key, { key, date: record.date, hour: record.hour, branchId: record.branchId, studentCount: 1, records: [record] })
  })
  return [...groups.values()].map((shift) => ({
    ...shift,
    studentCount: new Set(shift.records.map((record) => record.studentId || record.counterpartId || record.id)).size,
    records: [...shift.records].sort((left, right) => left.counterpartName.localeCompare(right.counterpartName, 'vi')),
  }))
}

export default function TrainingHistoryPanel({ subject, subjectId, subjectName, contractId }: Props) {
  const [startDate, setStartDate] = useState(() => daysAgoKey(89))
  const [endDate, setEndDate] = useState(todayKey)
  const [status, setStatus] = useState<TrainingHistoryStatus>('all')
  const [page, setPage] = useState<TrainingHistoryPage | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [contractUsage, setContractUsage] = useState<ContractUsageSummary[]>([])
  const [usageError, setUsageError] = useState('')
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false)
  const trainerShifts = useMemo(() => subject === 'trainer' ? groupTrainerTeachingShifts(page?.records ?? []) : [], [page?.records, subject])
  const selectedUsage = useMemo(() => {
    if (subject !== 'student') return null
    return contractUsage.find((item) => item.contractId === contractId)
      ?? contractUsage.find((item) => item.status === 'active')
      ?? contractUsage[0]
      ?? null
  }, [contractId, contractUsage, subject])

  const load = useCallback(async (append = false) => {
    if (!subjectId) return
    setLoading(true)
    setError('')
    try {
      const query = { startDate, endDate, status, pageSize: 50, cursor: append ? page?.nextCursor : null }
      const response = subject === 'student'
        ? await listStudentTrainingHistory(subjectId, query)
        : await listTrainerTeachingHistory(subjectId, query)
      setPage((current) => append && current ? { ...response, records: [...current.records, ...response.records] } : response)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không thể tải lịch sử buổi tập.')
      if (!append) setPage(null)
    } finally {
      setLoading(false)
    }
  }, [endDate, page?.nextCursor, startDate, status, subject, subjectId])

  useEffect(() => { void load(false) }, [subjectId, startDate, endDate, status]) // eslint-disable-line react-hooks/exhaustive-deps

  const loadUsage = useCallback(async () => {
    if (subject !== 'student' || !subjectId) return
    setUsageError('')
    try {
      const response = await getStudentContractUsage(subjectId, contractId)
      setContractUsage(response.summaries)
    } catch (cause) {
      setContractUsage([])
      setUsageError(cause instanceof Error ? cause.message : 'Không thể đối chiếu số buổi gói tập.')
    }
  }, [contractId, subject, subjectId])

  useEffect(() => { void loadUsage() }, [loadUsage])

  const setPreset = (days: number) => {
    setStartDate(daysAgoKey(days - 1))
    setEndDate(todayKey())
  }

  const counterpartLabel = subject === 'student' ? 'PT phụ trách' : 'Học viên'
  return <section className="training-history" aria-busy={loading}>
    <header className="training-history__header">
      <div><span><CalendarDays size={15} /> Nhật ký vận hành</span><h3>{subject === 'student' ? 'Lịch sử tập' : 'Lịch dạy PT'}</h3><p>{subjectName || 'Hồ sơ Aura'}</p></div>
      <button type="button" aria-label="Làm mới lịch sử" onClick={() => { void load(false); void loadUsage() }} disabled={loading}><RefreshCw size={16} className={loading ? 'is-spinning' : ''} /><span>Làm mới</span></button>
    </header>
    <div className="training-history__filters">
      <div className="training-history__presets"><button type="button" onClick={() => setPreset(30)}>30 ngày</button><button type="button" onClick={() => setPreset(90)}>90 ngày</button><button type="button" onClick={() => setPreset(180)}>6 tháng</button></div>
      <button type="button" className={`training-history__filter-toggle${showAdvancedFilters ? ' is-active' : ''}`} onClick={() => setShowAdvancedFilters((current) => !current)}><SlidersHorizontal size={15} /> Bộ lọc</button>
      {showAdvancedFilters && <div className="training-history__advanced">
        <label><span>Từ ngày</span><input type="date" value={startDate} max={endDate} onChange={(event) => setStartDate(event.target.value)} /></label>
        <label><span>Đến ngày</span><input type="date" value={endDate} min={startDate} max={todayKey()} onChange={(event) => setEndDate(event.target.value)} /></label>
        <label><span>Trạng thái</span><select value={status} onChange={(event) => setStatus(event.target.value as TrainingHistoryStatus)}>{statusOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
      </div>}
    </div>
    {error && <div className="training-history__notice"><CircleAlert size={18} /> {error}</div>}
    {usageError && subject === 'student' ? <div className="training-history__notice"><CircleAlert size={18} /> {usageError}</div> : null}
    {selectedUsage ? <section className="training-history__contract-usage">
      <div><small>GÓI ĐANG ĐỐI CHIẾU</small><strong>{selectedUsage.packageName}</strong><span>{selectedUsage.usedSessions}/{selectedUsage.totalSessions} buổi đã tính · còn {selectedUsage.remainingSessions}</span></div>
      <div><span><b>{selectedUsage.attendedSessions}</b>Có tập</span><span><b>{selectedUsage.noShowSessions + selectedUsage.policyChargedSessions}</b>Vắng tính buổi</span><span><b>{selectedUsage.legacyProjectionAdjustment}</b>Dữ liệu cũ</span></div>
      {selectedUsage.legacyProjectionAdjustment > 0 ? <p><Info size={13} /> Phần dữ liệu cũ được tách riêng, không giả thành một buổi có mặt.</p> : null}
    </section> : null}
    {page && <>{subject === 'trainer' && page.summary.teaching ? <div className="training-history__summary"><div><strong>{page.summary.teaching.totalShifts}</strong><span>Ca dạy</span></div><div><strong>{page.summary.teaching.pairedShifts}</strong><span>Ca đôi</span></div><div><strong>{page.summary.teaching.learnerBookings}</strong><span>Lượt học viên</span></div><div><strong>{page.summary.noShow}</strong><span>Vắng mặt</span></div></div> : <div className="training-history__summary"><div><strong>{page.summary.usage?.chargedSessions ?? (page.summary.completed + page.summary.noShow)}</strong><span>Đã tính trong kỳ</span></div><div><strong>{page.summary.usage?.attendedSessions ?? page.summary.completed}</strong><span>Có tập</span></div><div><strong>{page.summary.usage?.noShowSessions ?? page.summary.noShow}</strong><span>Vắng vẫn tính</span></div><div><strong>{page.summary.usage?.exemptSessions ?? 0}</strong><span>Được miễn</span></div></div>}<p className="training-history__scope-note"><Info size={13} /> {subject === 'trainer' ? 'Một ca được tính theo cùng PT, ngày và giờ; ca có hai học viên chỉ tính một ca dạy.' : 'Thẻ gói và lịch sử cùng dùng công thức contract-usage-v2; các chỉ số trong kỳ chỉ tính khoảng ngày đang chọn.'}</p></>}
    <div className="training-history__records">
      {loading && !page ? <div className="training-history__empty">Đang tải lịch sử an toàn…</div> : null}
      {!loading && !error && page && page.records.length === 0 ? <div className="training-history__empty">Không có buổi tập nào trong bộ lọc này.</div> : null}
      {subject === 'trainer' ? trainerShifts.map((shift) => <article className="training-history__shift" key={shift.key}>
        <header><div className="training-history__date"><strong>{shift.date.slice(8) || '—'}</strong><span>{shift.date.slice(5, 7) || '—'}</span></div><div><small>CA DẠY</small><h4>{formatDate(shift.date)} {shift.hour !== null ? `· ${String(shift.hour).padStart(2, '0')}:00` : ''}</h4><p><UsersRound size={14} /> {shift.studentCount} học viên</p></div><em className={shift.studentCount >= 2 ? 'is-paired' : ''}>{shift.studentCount >= 2 ? 'Ca đôi' : 'Ca đơn'}</em></header>
        <div className="training-history__shift-students">{shift.records.map((record, index) => <section key={record.id}><span className="training-history__student-order">{index + 1}</span><div className="training-history__shift-student-main"><strong>{record.counterpartName}</strong><small>Mã buổi {record.id.slice(-10)} · HĐ {record.contractId ? record.contractId.slice(-10) : 'chưa liên kết'}</small>{record.events.length ? <details><summary><ChevronDown size={14} /> {record.events.length} sự kiện</summary><ul>{record.events.map((event) => <li key={event.id}><b>{statusLabel(event.type)}</b>{event.reason ? ` · ${event.reason}` : ''}</li>)}</ul></details> : null}</div><div className="training-history__shift-state"><span className={`training-history__status training-history__status--${record.status}`}>{statusLabel(record.status)}</span><small>{record.attendance?.attendanceStatus && record.attendance.attendanceStatus !== 'pending' ? <CheckCircle2 size={14} /> : <Clock3 size={14} />}{attendanceLabel(record)}</small></div></section>)}</div>
      </article>) : page?.records.map((record) => <article className="training-history__record" key={record.id}><div className="training-history__date"><strong>{record.date.slice(8) || '—'}</strong><span>{record.date.slice(5, 7) || '—'}</span></div><div className="training-history__record-main"><div className="training-history__record-title"><strong>{formatDate(record.date)} {record.hour !== null ? `· ${String(record.hour).padStart(2, '0')}:00` : ''}</strong><span className={`training-history__status training-history__status--${record.status}`}>{statusLabel(record.status)}</span></div><p><UserRound size={14} /> {counterpartLabel}: <b>{record.counterpartName}</b></p><small>Mã buổi {record.id.slice(-10)} · HĐ {record.contractId ? record.contractId.slice(-10) : 'chưa liên kết'}</small>{record.events.length ? <details><summary><ChevronDown size={14} /> {record.events.length} sự kiện thay đổi</summary><ul>{record.events.map((event) => <li key={event.id}><b>{statusLabel(event.type)}</b>{event.reason ? ` · ${event.reason}` : ''}</li>)}</ul></details> : null}</div><div className="training-history__attendance">{record.attendance?.attendanceStatus && record.attendance.attendanceStatus !== 'pending' ? <CheckCircle2 size={18} /> : <Clock3 size={18} />}<span>{attendanceLabel(record)}</span></div></article>)}
    </div>
    {page?.summary.truncated ? <p className="training-history__truncated">Tóm tắt bị giới hạn để bảo vệ hiệu năng. Hãy thu hẹp khoảng thời gian để xem số liệu đầy đủ.</p> : null}
    {page?.hasMore ? <button type="button" className="training-history__more" disabled={loading} onClick={() => void load(true)}>{loading ? 'Đang tải…' : 'Tải thêm lịch sử'}</button> : null}
  </section>
}
