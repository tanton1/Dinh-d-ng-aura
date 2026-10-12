import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertCircle,
  ArrowLeft,
  CalendarCheck2,
  CheckCircle2,
  ChevronRight,
  RefreshCw,
  Save,
  Search,
  Settings2,
  UserRoundCheck,
  X,
} from 'lucide-react'
import {
  getStaffPayrollAttendanceDetail,
  fillMissingStaffAttendanceDays,
  saveStaffAttendanceDay,
  saveWorkCalendar,
  type StaffAttendanceStatus,
  type StaffWorkday,
  type StaffPayrollAttendanceResult,
  type WorkCalendarHoliday,
} from '../../../services/staffPayrollService'
import '../../../styles-staff-workdays.css'

interface Props {
  branches: Array<{ id: string; name: string }>
  periodId: string
  attendance: StaffPayrollAttendanceResult | null
  loading: boolean
  onPeriodChange: (periodId: string) => void
  onReload: () => Promise<void>
}

const editableStatuses: Array<{ id: StaffAttendanceStatus; label: string }> = [
  { id: 'present', label: 'Có mặt' },
  { id: 'remote', label: 'Làm từ xa' },
  { id: 'business_trip', label: 'Công tác' },
  { id: 'training', label: 'Đào tạo' },
  { id: 'paid_leave', label: 'Nghỉ phép có lương' },
  { id: 'unpaid_leave', label: 'Nghỉ không lương' },
  { id: 'unexcused_absence', label: 'Vắng không phép' },
  { id: 'sick_leave', label: 'Nghỉ ốm · cần duyệt' },
  { id: 'maternity_leave', label: 'Nghỉ thai sản · cần duyệt' },
  { id: 'pending', label: 'Chưa chốt' },
]

const weekdayLabels = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7']

function money(value: unknown) {
  const parsed = Number(value)
  return `${Math.round(Number.isFinite(parsed) ? parsed : 0).toLocaleString('vi-VN')}đ`
}

function statusLabel(day: StaffWorkday) {
  if (day.status === 'auto_present_teaching') return `Tự tính đủ công · ${day.teachingSlotCount} ca dạy`
  if (day.status === 'weekly_rest') return 'Nghỉ tuần'
  if (day.status === 'paid_holiday') return day.holidayName || 'Nghỉ lễ'
  if (day.status === 'outside_employment') return 'Ngoài thời gian làm việc'
  if (day.status === 'upcoming') return 'Chưa đến ngày'
  return editableStatuses.find((item) => item.id === day.status)?.label || 'Chưa chốt'
}

function teachingCountLabel(value: number) {
  return `${Math.max(0, Math.trunc(value || 0))} ca`
}

function friendlyError(cause: unknown) {
  const message = cause instanceof Error ? cause.message : ''
  if (/aborted|thay đổi/i.test(message)) return 'Dữ liệu vừa được người khác cập nhật. Hãy tải lại trước khi lưu.'
  if (/permission|quyền/i.test(message)) return 'Tài khoản chưa có quyền quản lý ngày công.'
  return message || 'Không thể xử lý dữ liệu ngày công.'
}

export default function StaffWorkdayPayrollPanel({ branches, periodId, attendance, loading, onPeriodChange, onReload }: Props) {
  const [branchId, setBranchId] = useState('')
  const [query, setQuery] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [selectedId, setSelectedId] = useState('')
  const [detail, setDetail] = useState<Awaited<ReturnType<typeof getStaffPayrollAttendanceDetail>> | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [busyDay, setBusyDay] = useState('')
  const [calendarBusy, setCalendarBusy] = useState(false)
  const [fillBusy, setFillBusy] = useState(false)
  const [weeklyRestDays, setWeeklyRestDays] = useState<number[]>([0])
  const [holidays, setHolidays] = useState<WorkCalendarHoliday[]>([])
  const [holidayDate, setHolidayDate] = useState('')
  const [holidayName, setHolidayName] = useState('')
  const detailSequence = useRef(0)
  const rows = attendance?.rows || []
  const attendanceError = !attendance && !loading ? 'Chưa tải được dữ liệu ngày công của kỳ này.' : ''

  useEffect(() => {
    detailSequence.current += 1
    setDetail(null)
    setSelectedId('')
    setDetailLoading(false)
  }, [periodId])

  const loadDetail = useCallback(async (staffId: string) => {
    const sequence = detailSequence.current + 1
    detailSequence.current = sequence
    setSelectedId(staffId)
    setDetail(null)
    setDetailLoading(true)
    setError('')
    try {
      const loaded = await getStaffPayrollAttendanceDetail(periodId, staffId)
      if (sequence !== detailSequence.current) return
      setDetail(loaded)
      setWeeklyRestDays(loaded.calendar.weeklyRestDays.length ? loaded.calendar.weeklyRestDays : [0])
      setHolidays(loaded.calendar.holidays)
    } catch (cause) {
      if (sequence !== detailSequence.current) return
      setDetail(null)
      setError(friendlyError(cause))
    } finally {
      if (sequence === detailSequence.current) setDetailLoading(false)
    }
  }, [periodId])

  const scopedRows = useMemo(() => branchId ? rows.filter((row) => row.branchId === branchId) : rows, [branchId, rows])
  const visibleRows = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('vi-VN')
    return normalized ? scopedRows.filter((row) => `${row.name} ${row.employeeCode}`.toLocaleLowerCase('vi-VN').includes(normalized)) : scopedRows
  }, [query, scopedRows])

  const summary = useMemo(() => ({
    total: scopedRows.length,
    review: scopedRows.filter((row) => row.reviewRequired).length,
    paidDays: scopedRows.reduce((total, row) => total + row.paidDays, 0),
    eligibleWorkdays: scopedRows.reduce((total, row) => total + row.eligibleWorkdays, 0),
    payroll: scopedRows.reduce((total, row) => total + row.finalAmount, 0),
  }), [scopedRows])

  const updateDay = async (day: StaffWorkday, status: StaffAttendanceStatus) => {
    if (!detail || !day.eligible) return
    setBusyDay(day.date)
    setError('')
    try {
      await saveStaffAttendanceDay({ staffId: detail.staffId, date: day.date, status })
      await onReload()
      await loadDetail(detail.staffId)
      setNotice(`Đã cập nhật ngày công ${day.date.split('-').reverse().join('/')}.`)
    } catch (cause) {
      setError(friendlyError(cause))
    } finally {
      setBusyDay('')
    }
  }

  const toggleRestDay = (day: number) => {
    setWeeklyRestDays((current) => current.includes(day) ? current.filter((value) => value !== day) : [...current, day].sort())
  }

  const addHoliday = () => {
    if (!holidayDate.startsWith(`${periodId}-`) || holidayName.trim().length < 2) {
      setError('Chọn ngày thuộc kỳ hiện tại và nhập tên ngày nghỉ lễ.')
      return
    }
    setHolidays((current) => [...current.filter((item) => item.date !== holidayDate), { date: holidayDate, name: holidayName.trim(), paid: true }].sort((left, right) => left.date.localeCompare(right.date)))
    setHolidayDate('')
    setHolidayName('')
  }

  const approveCalendar = async () => {
    if (!detail) return
    setCalendarBusy(true)
    setError('')
    try {
      await saveWorkCalendar({
        periodId,
        branchId: detail.identity.branchId,
        weeklyRestDays,
        holidays,
        expectedRevision: detail.calendar.revision,
      })
      await onReload()
      await loadDetail(detail.staffId)
      setNotice('Đã duyệt lịch làm việc của chi nhánh cho kỳ này.')
    } catch (cause) {
      setError(friendlyError(cause))
    } finally {
      setCalendarBusy(false)
    }
  }

  const fillMissingDays = async () => {
    if (!detail || !detail.workdays.pendingDays) return
    setFillBusy(true)
    setError('')
    try {
      const result = await fillMissingStaffAttendanceDays({ staffId: detail.staffId, periodId })
      await onReload()
      await loadDetail(detail.staffId)
      setNotice(result.createdCount ? `Đã chốt ${result.createdCount} ngày công còn thiếu là Có mặt.` : 'Không còn ngày công trống cần xử lý.')
    } catch (cause) {
      setError(friendlyError(cause))
    } finally {
      setFillBusy(false)
    }
  }

  return <section className={`staff-workdays ${detail || detailLoading && selectedId ? 'is-detail-page' : ''}`} aria-label="Quản lý ngày công nhân viên">
    <div className="staff-workdays__summary">
      <article><span>Nhân sự</span><strong>{summary.total}</strong><small>theo chi nhánh đã chọn</small></article>
      <article className={summary.review ? 'is-warning' : ''}><span>Cần đối soát</span><strong>{summary.review}</strong><small>thiếu công hoặc quyền lợi</small></article>
      <article><span>Công đã ghi nhận</span><strong>{summary.paidDays}/{summary.eligibleWorkdays}</strong><small>ngày đã chốt / ngày đủ điều kiện cả kỳ</small></article>
      <article><span>Dự tính toàn kỳ</span><strong>{money(summary.payroll)}</strong><small>gồm lương cơ bản dự phóng</small></article>
    </div>

    <div className="staff-workdays__toolbar">
      <label><span>Kỳ</span><input type="month" value={periodId} onChange={(event) => { onPeriodChange(event.target.value); setDetail(null); setSelectedId('') }} /></label>
      <label><span>Chi nhánh</span><select value={branchId} onChange={(event) => { setBranchId(event.target.value); setDetail(null); setSelectedId('') }}><option value="">Tất cả</option>{branches.map((branch) => <option value={branch.id} key={branch.id}>{branch.name}</option>)}</select></label>
      <label className="is-search"><span>Tìm nhân viên</span><Search size={16} /><input value={query} placeholder="Tên nhân viên" onChange={(event) => setQuery(event.target.value)} /></label>
      <button type="button" aria-label="Tải lại ngày công" disabled={loading} onClick={() => void onReload()}><RefreshCw size={18} /></button>
    </div>

    {(error || attendanceError) && <div className="staff-workdays__notice is-error"><AlertCircle size={19} /><span>{error || attendanceError}</span></div>}
    {attendance?.truncated && <div className="staff-workdays__notice is-warning"><AlertCircle size={19} /><span>Dữ liệu kỳ này đã chạm giới hạn an toàn; các con số là phần đã tải. Bộ lọc chỉ áp dụng cho dữ liệu đã tải, không bổ sung phần còn thiếu. Cần đối soát nguồn dữ liệu trước khi chốt.</span></div>}
    {attendance && (attendance.referralDiagnostics.unresolvedEntryCount + attendance.referralDiagnostics.ambiguousCodeEntryCount + attendance.referralDiagnostics.invalidRateEntryCount > 0) && <div className="staff-workdays__notice is-warning"><AlertCircle size={19} /><span>Có giao dịch giới thiệu cần kiểm tra mã nhân viên hoặc tỷ lệ; số tiền này chưa nên xem là đã chốt.</span></div>}
    {notice && <div className="staff-workdays__notice"><CheckCircle2 size={19} /><span>{notice}</span><button type="button" aria-label="Đóng thông báo" onClick={() => setNotice('')}><X size={15} /></button></div>}

    <div className={`staff-workdays__layout ${detail || detailLoading && selectedId ? 'is-detail-page' : 'is-list-page'}`}>
      {!detail && !(detailLoading && selectedId) && <div className="staff-workdays__people">
        <header><div><span>Danh sách nhân sự</span><strong>{visibleRows.length} người</strong></div><small>Bấm để chốt công</small></header>
        {loading && !rows.length ? <div className="staff-workdays__skeleton" /> : visibleRows.length ? visibleRows.map((row) => <button type="button" key={row.staffId} className={selectedId === row.staffId ? 'is-active' : ''} onClick={() => void loadDetail(row.staffId)}>
          <span className="staff-workdays__avatar">{row.name.slice(0, 1).toUpperCase()}</span>
          <span className="staff-workdays__person"><strong>{row.name}</strong><small>{row.employeeCode || 'Chưa có mã NV'} · {row.employmentType === 'collaborator' ? 'CTV' : 'Nhân viên'} · {branches.find((branch) => branch.id === row.branchId)?.name || 'Chưa gắn chi nhánh'}</small></span>
          <span className="staff-workdays__numbers"><b>{row.paidDays} đã ghi nhận · {row.estimatedPaidDays ?? row.paidDays}/{row.eligibleWorkdays} dự tính</b><small>{teachingCountLabel(row.teachingSlotCount)} · {money(row.finalAmount)} dự tính toàn kỳ</small></span>
          {row.reviewRequired && <em>!</em>}<ChevronRight size={17} />
        </button>) : <div className="staff-workdays__empty"><UserRoundCheck size={27} /><strong>Không có nhân sự phù hợp</strong><p>Đổi bộ lọc hoặc kiểm tra hồ sơ đội ngũ.</p></div>}
      </div>}

      {(detail || detailLoading && selectedId) && <div className="staff-workdays__detail">
        {detailLoading && !detail ? <div className="staff-workdays__skeleton" /> : detail ? <>
          <button className="staff-workdays__back" type="button" onClick={() => { detailSequence.current += 1; setDetail(null); setSelectedId('') }}><ArrowLeft size={18} /> Danh sách ngày công</button><header className="staff-workdays__detail-head"><div><span>{detail.identity.employeeCode || 'NHÂN VIÊN AURA'}</span><strong>{detail.identity.name}</strong><small>{detail.workdays.employmentType === 'collaborator' ? 'CTV · không lương cơ bản' : `${detail.workdays.employmentType === 'part_time' ? 'Part-time' : detail.workdays.employmentLevel === 'senior' ? 'Senior' : detail.workdays.employmentLevel === 'probation' ? 'Thử việc' : 'Chính thức'} · Lương cơ bản ${money(detail.workdays.baseSalary)} · ${money(detail.workdays.dailyRate)}/ngày chuẩn`} · Tự tính {detail.workdays.autoPaidDays} ngày</small></div><div><b>{detail.workdays.paidDays}/{detail.workdays.eligibleWorkdays}</b><small>ngày đã ghi nhận / ngày đủ điều kiện cả kỳ · dự tính {detail.workdays.estimatedPaidDays}/{detail.workdays.eligibleWorkdays}</small>{detail.workdays.workdayEnabled && detail.workdays.pendingDays > 0 && <button type="button" disabled={fillBusy} onClick={() => void fillMissingDays()}>{fillBusy ? 'Đang chốt…' : `Chốt ${detail.workdays.pendingDays} ngày thiếu`}</button>}</div></header>

          <div className="staff-workdays__calendar-card">
            <div className="staff-workdays__calendar-title"><div><CalendarCheck2 size={18} /><span><strong>Lịch ngày công</strong><small>Chọn trạng thái trực tiếp trên từng ngày làm việc</small></span></div>{detail.workdays.reviewRequired && <em>Cần đối soát</em>}</div>
            <div className="staff-workdays__days">
              {detail.workdays.days.map((day) => <label key={day.date} className={`is-${day.status} ${day.eligible ? '' : 'is-readonly'}`} title={`${statusLabel(day)} · ${teachingCountLabel(day.teachingSlotCount)}`}>
                <time>{Number(day.date.slice(-2))}<small>{weekdayLabels[day.weekday]}</small></time>
                <span className="staff-workdays__day-content">
                  {day.eligible ? <select aria-label={`Ngày ${day.date}`} value={day.status === 'auto_present_teaching' ? day.status : editableStatuses.some((item) => item.id === day.status) ? day.status : 'pending'} disabled={busyDay === day.date} onChange={(event) => void updateDay(day, event.target.value as StaffAttendanceStatus)}>{day.status === 'auto_present_teaching' && <option value="auto_present_teaching" disabled>Tự tính đủ công</option>}{editableStatuses.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select> : <span>{statusLabel(day)}</span>}
                  <b className={day.teachingSlotCount ? 'has-teaching' : ''}>{teachingCountLabel(day.teachingSlotCount)}</b>
                </span>
              </label>)}
            </div>
          </div>

          <div className="staff-workdays__calendar-settings">
            <header><div><Settings2 size={18} /><span><strong>Lịch chuẩn chi nhánh</strong><small>Ngày lễ được loại khỏi mẫu số; nghỉ có lương không bị trừ công.</small></span></div><em className={detail.calendar.approved ? 'is-approved' : ''}>{detail.calendar.approved ? 'Đã duyệt' : 'Chưa duyệt'}</em></header>
            <div className="staff-workdays__rest-days"><span>Ngày nghỉ hằng tuần</span>{weekdayLabels.map((label, day) => <button type="button" key={label} className={weeklyRestDays.includes(day) ? 'is-active' : ''} onClick={() => toggleRestDay(day)}>{label}</button>)}</div>
            <div className="staff-workdays__holiday-form"><label><span>Ngày lễ</span><input type="date" min={`${periodId}-01`} max={`${periodId}-31`} value={holidayDate} onChange={(event) => setHolidayDate(event.target.value)} /></label><label><span>Tên ngày lễ</span><input value={holidayName} maxLength={100} placeholder="VD: Quốc khánh" onChange={(event) => setHolidayName(event.target.value)} /></label><button type="button" onClick={addHoliday}>Thêm</button></div>
            {!!holidays.length && <div className="staff-workdays__holidays">{holidays.map((holiday) => <span key={holiday.date}>{holiday.date.split('-').reverse().join('/')} · {holiday.name}<button type="button" aria-label={`Xóa ${holiday.name}`} onClick={() => setHolidays((current) => current.filter((item) => item.date !== holiday.date))}><X size={13} /></button></span>)}</div>}
            <button className="staff-workdays__save" type="button" disabled={calendarBusy || !weeklyRestDays.length} onClick={() => void approveCalendar()}><Save size={16} /> {calendarBusy ? 'Đang lưu…' : 'Duyệt lịch chuẩn kỳ này'}</button>
          </div>
        </> : null}
      </div>}
    </div>
  </section>
}
