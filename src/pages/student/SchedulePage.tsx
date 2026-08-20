import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertCircle,
  CalendarCheck,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Dumbbell,
  Link2,
  LoaderCircle,
  RefreshCw,
  RotateCcw,
  Save,
  UserRound,
} from 'lucide-react'
import { PageHeader } from '../../components/ui'
import {
  listMyStudentPtSchedule,
  saveMyStudentAvailability,
  type StudentPtScheduleData,
  type StudentPtSession,
} from '../../services/studentPtScheduleService'
import type { ViewId } from '../../types'
import '../../styles-coaching.css'
import './StudentSchedulePage.css'

const DEFAULT_DAYS = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7']
const DEFAULT_HOURS = [6, 7, 8, 9, 10, 11, 14, 15, 16, 17, 18, 19, 20]
const DAY_LABELS = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7']

const statusLabels: Record<string, string> = {
  scheduled: 'Đã xếp lịch',
  completed: 'Đã hoàn thành',
  cancelled: 'Đã hủy',
  canceled_by_student: 'Học viên báo nghỉ',
}

function toIsoDate(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function addDays(date: Date, amount: number) {
  const next = new Date(date)
  next.setDate(next.getDate() + amount)
  return next
}

function fromIsoDate(value: string) {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year, month - 1, day)
}

function startOfWeek(date: Date) {
  const weekday = date.getDay()
  return addDays(date, weekday === 0 ? -6 : 1 - weekday)
}

function dayCode(dateValue: string) {
  const date = new Date(`${dateValue}T00:00:00+07:00`)
  const weekday = date.getDay()
  return weekday === 0 ? 'CN' : `T${weekday + 1}`
}

function slotIdForSession(session: StudentPtSession) {
  return session.hour === null ? '' : `${dayCode(session.date)}-${session.hour}`
}

function formatSessionDate(value: string) {
  return new Intl.DateTimeFormat('vi-VN', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' })
    .format(new Date(`${value}T00:00:00+07:00`))
}

function sameSlots(left: Iterable<string>, right: Iterable<string>) {
  return [...left].sort().join('|') === [...right].sort().join('|')
}

export default function SchedulePage({ onNavigate: _onNavigate, isDemo = false }: { onNavigate: (view: ViewId) => void; isDemo?: boolean; ownerId?: string }) {
  const today = useMemo(() => new Date(), [])
  const range = useMemo(() => ({ from: toIsoDate(addDays(today, -30)), to: toIsoDate(addDays(today, 180)) }), [today])
  const [data, setData] = useState<StudentPtScheduleData | null>(null)
  const [selectedSlots, setSelectedSlots] = useState<Set<string>>(new Set())
  const [weekOffset, setWeekOffset] = useState(0)
  const [selectedDate, setSelectedDate] = useState(toIsoDate(today))
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const weekStart = useMemo(() => addDays(startOfWeek(today), weekOffset * 7), [today, weekOffset])
  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, index) => addDays(weekStart, index)), [weekStart])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      if (isDemo) {
        const demo: StudentPtScheduleData = {
          schemaVersion: 1,
          linked: true,
          student: { id: 'demo-student', name: 'An Nguyễn', branchId: 'demo-branch', sessionsPerWeek: 3, availableSlots: ['T2-18', 'T3-18', 'T4-19', 'T5-18', 'T6-19'], isScheduleConfirmed: true, availabilityRevision: 1 },
          scheduleConfig: { workingDays: DEFAULT_DAYS, workingHours: DEFAULT_HOURS },
          sessions: [
            { id: 'demo-1', date: toIsoDate(addDays(today, 1)), hour: 18, status: 'scheduled', trainerId: 'demo-trainer', trainerName: 'PT Minh', branchId: 'demo-branch', verifiedByStudent: false, scheduleEntryId: '', revision: 1, timeZone: 'Asia/Ho_Chi_Minh' },
            { id: 'demo-2', date: toIsoDate(addDays(today, 3)), hour: 19, status: 'scheduled', trainerId: 'demo-trainer', trainerName: 'PT Minh', branchId: 'demo-branch', verifiedByStudent: false, scheduleEntryId: '', revision: 1, timeZone: 'Asia/Ho_Chi_Minh' },
          ],
          contracts: [{ id: 'demo-contract', packageName: 'PT Personal 24 buổi', status: 'active', startDate: toIsoDate(addDays(today, -30)), endDate: toIsoDate(addDays(today, 90)), totalSessions: 24, usedSessions: 8 }],
        }
        setData(demo)
        setSelectedSlots(new Set(demo.student?.availableSlots ?? []))
        return
      }
      const response = await listMyStudentPtSchedule(range.from, range.to)
      setData(response)
      setSelectedSlots(new Set(response.student?.availableSlots ?? []))
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Chưa thể đồng bộ lịch học viên.')
    } finally {
      setLoading(false)
    }
  }, [isDemo, range.from, range.to, today])

  useEffect(() => { void load() }, [load])

  const workingDays = data?.scheduleConfig.workingDays?.length ? data.scheduleConfig.workingDays : DEFAULT_DAYS
  const workingHours = data?.scheduleConfig.workingHours?.length ? data.scheduleConfig.workingHours : DEFAULT_HOURS
  const originalSlots = data?.student?.availableSlots ?? []
  const dirty = !sameSlots(selectedSlots, originalSlots)
  const upcomingSessions = useMemo(() => (data?.sessions ?? [])
    .filter((session) => session.date >= toIsoDate(today) && session.status === 'scheduled')
    .sort((left, right) => `${left.date}-${left.hour ?? 99}`.localeCompare(`${right.date}-${right.hour ?? 99}`)), [data?.sessions, today])
  const historySessions = useMemo(() => (data?.sessions ?? [])
    .filter((session) => session.status !== 'scheduled' || session.date < toIsoDate(today))
    .sort((left, right) => `${right.date}-${right.hour ?? 99}`.localeCompare(`${left.date}-${left.hour ?? 99}`))
    .slice(0, 8), [data?.sessions, today])
  const sessionsBySlot = useMemo(() => {
    const result = new Map<string, StudentPtSession[]>()
    upcomingSessions.forEach((session) => {
      const slotId = slotIdForSession(session)
      if (!slotId) return
      result.set(slotId, [...(result.get(slotId) ?? []), session])
    })
    return result
  }, [upcomingSessions])
  const activeContract = data?.contracts.find((contract) => contract.status === 'active') ?? data?.contracts[0]
  const selectedSessions = useMemo(() => (data?.sessions ?? [])
    .filter((session) => session.date === selectedDate)
    .sort((left, right) => (left.hour ?? 99) - (right.hour ?? 99)), [data?.sessions, selectedDate])
  const weekSessions = useMemo(() => {
    const first = toIsoDate(weekDays[0])
    const last = toIsoDate(weekDays[6])
    return (data?.sessions ?? []).filter((session) => session.date >= first && session.date <= last && session.status !== 'cancelled')
  }, [data?.sessions, weekDays])
  const completedThisWeek = weekSessions.filter((session) => session.status === 'completed').length
  const weekCompletion = weekSessions.length ? Math.round(completedThisWeek / weekSessions.length * 100) : 0
  const weekLabel = `${new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: 'short' }).format(weekDays[0])} – ${new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: 'short', year: 'numeric' }).format(weekDays[6])}`
  const selectedLabel = new Intl.DateTimeFormat('vi-VN', { weekday: 'long', day: 'numeric', month: 'long' }).format(fromIsoDate(selectedDate))

  const toggleSlot = (slotId: string) => {
    if (saving) return
    setMessage(null)
    setSelectedSlots((current) => {
      const next = new Set(current)
      if (next.has(slotId)) next.delete(slotId)
      else next.add(slotId)
      return next
    })
  }

  const save = async () => {
    if (!data?.student || !dirty || saving) return
    setSaving(true)
    setError(null)
    setMessage(null)
    try {
      if (isDemo) {
        setData((current) => current?.student ? { ...current, student: { ...current.student, availableSlots: [...selectedSlots], availabilityRevision: current.student.availabilityRevision + 1, isScheduleConfirmed: true } } : current)
      } else {
        const result = await saveMyStudentAvailability({ availableSlots: [...selectedSlots], expectedRevision: data.student.availabilityRevision })
        setData((current) => current?.student ? { ...current, student: { ...current.student, availableSlots: result.availableSlots, availabilityRevision: result.availabilityRevision, isScheduleConfirmed: result.isScheduleConfirmed } } : current)
        setSelectedSlots(new Set(result.availableSlots))
      }
      setMessage('Đã lưu lịch rảnh. Bộ phận vận hành sẽ rà soát các ca cần xếp lại.')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Không thể lưu lịch rảnh.')
    } finally {
      setSaving(false)
    }
  }

  const goToday = () => { setWeekOffset(0); setSelectedDate(toIsoDate(today)) }
  const moveWeek = (amount: number) => {
    const nextOffset = weekOffset + amount
    setWeekOffset(nextOffset)
    setSelectedDate(toIsoDate(addDays(startOfWeek(today), nextOffset * 7)))
  }
  const selectUpcoming = (session: StudentPtSession) => {
    setWeekOffset(Math.floor((fromIsoDate(session.date).getTime() - startOfWeek(today).getTime()) / (7 * 86_400_000)))
    setSelectedDate(session.date)
  }

  return (
    <div className="page schedule-page pt-schedule-page student-schedule-page student-schedule-page--classic" aria-busy={loading}>
      <PageHeader eyebrow="AURA FITNESS · LỊCH HỌC VIÊN" title="Lịch tập luyện" description="Xem lịch tuần, các buổi PT sắp tới và cập nhật khung giờ bạn có thể tập." />

      {loading && <div className="student-schedule-state" role="status"><LoaderCircle className="spin" size={30} /><strong>Đang liên kết lịch học viên</strong><span>Aura đang tải lịch tuần và khung giờ rảnh của bạn.</span></div>}
      {!loading && error && <div className="student-schedule-state is-error" role="alert"><AlertCircle size={28} /><strong>Chưa thể đồng bộ lịch học viên</strong><span>{error}</span><button type="button" onClick={() => void load()}><RefreshCw size={16} /> Thử lại</button></div>}
      {!loading && !error && data && !data.linked && <div className="student-schedule-state is-warning"><Link2 size={28} /><strong>Chưa liên kết hồ sơ học viên</strong><span>Tài khoản này chưa được ghép với hồ sơ PT đã chuyển dữ liệu. Vui lòng liên hệ quản trị viên.</span></div>}

      {!loading && !error && data?.student && <>
        <div className="pt-schedule-banner"><div><i><CalendarCheck size={20} /></i><span><strong>Kế hoạch tuần của bạn</strong><small>{weekSessions.length} buổi · Hoàn thành {weekCompletion}%</small></span></div><small>Lịch được đồng bộ từ bộ phận vận hành và đối chiếu với thời gian rảnh của bạn.</small></div>

        <section className="schedule-layout">
          <div className="calendar-panel card">
            <div className="calendar-header"><button type="button" aria-label="Tuần trước" onClick={() => moveWeek(-1)}><ChevronLeft size={19} /></button><div><strong>{weekLabel}</strong><button type="button" onClick={goToday}>Hôm nay</button></div><button type="button" aria-label="Tuần sau" onClick={() => moveWeek(1)}><ChevronRight size={19} /></button></div>
            <div className="week-strip">{weekDays.map((date) => {
              const iso = toIsoDate(date)
              const session = (data.sessions ?? []).find((item) => item.date === iso && item.status !== 'cancelled')
              return <button type="button" key={iso} className={selectedDate === iso ? 'active' : ''} aria-pressed={selectedDate === iso} aria-label={`${DAY_LABELS[date.getDay()]} ngày ${date.getDate()}, ${session ? 'có lịch' : 'không có lịch'}`} onClick={() => setSelectedDate(iso)}><span>{DAY_LABELS[date.getDay()]}</span><strong>{date.getDate()}</strong>{session && <i />}</button>
            })}</div>
            <div className="day-label"><span>{selectedLabel.toLocaleUpperCase('vi')}</span><small>{selectedSessions.length} buổi tập</small></div>

            {selectedSessions.length ? selectedSessions.map((session) => {
              const matched = selectedSlots.has(slotIdForSession(session))
              return <article className={`timeline-event featured ${session.status}`} key={session.id}>
                <div className="event-time"><strong>{session.hour === null ? '--:--' : `${String(session.hour).padStart(2, '0')}:00`}</strong><span>Buổi PT</span></div><div className="event-line"><i /></div>
                <div className="event-detail"><div className="event-icon purple"><Dumbbell size={22} /></div><div><span>HUẤN LUYỆN CÁ NHÂN</span><h3>Buổi tập PT</h3><p><UserRound size={13} /> {session.trainerName}</p><em className={`pt-activity-status ${session.status}`}>{statusLabels[session.status] ?? session.status}</em><small className={matched ? 'student-classic-match is-linked' : 'student-classic-match needs-review'}>{matched ? <><Link2 size={12} /> Khớp lịch rảnh</> : <><AlertCircle size={12} /> Cần rà soát lịch rảnh</>}</small></div></div>
              </article>
            }) : <div className="schedule-empty-inline"><CalendarDays size={28} /><h3>Chưa có lịch trong ngày này</h3><p>Khi vận hành xếp lịch, buổi tập sẽ xuất hiện tại đây.</p></div>}
          </div>

          <aside className="schedule-side">
            <article className="card next-week"><div className="section-heading"><div><h2>Sắp tới</h2><p>Các buổi PT gần nhất</p></div><button type="button" className="text-button" onClick={goToday}>Tuần hiện tại</button></div>{upcomingSessions.length ? upcomingSessions.slice(0, 5).map((session) => {
              const date = fromIsoDate(session.date)
              return <button type="button" className="upcoming-item" key={session.id} onClick={() => selectUpcoming(session)}><span className="upcoming-date"><strong>{date.getDate()}</strong><small>THG {date.getMonth() + 1}</small></span><span><small>{session.hour === null ? 'Chưa rõ giờ' : `${String(session.hour).padStart(2, '0')}:00`} · Buổi tập PT</small><strong>{session.trainerName}</strong><em>{statusLabels[session.status] ?? session.status}</em></span><ChevronRight size={17} /></button>
            }) : <div className="schedule-empty-state compact"><CalendarCheck size={26} /><h3>Chưa có lịch sắp tới</h3><p>Buổi tập mới sẽ xuất hiện sau khi được xếp lịch.</p></div>}</article>
            <article className="card consistency-card"><div className="consistency-icon"><CalendarDays size={24} /></div><div><span className="eyebrow">TIẾN ĐỘ GÓI TẬP</span><h3>{activeContract ? `${activeContract.usedSessions}/${activeContract.totalSessions} buổi` : 'Chưa có gói tập'}</h3><p>{activeContract?.packageName ?? 'Liên hệ vận hành để cập nhật hợp đồng.'}</p></div><div className="consistency-dots">{weekDays.slice(0, 5).map((date) => {
              const dayItems = (data.sessions ?? []).filter((item) => item.date === toIsoDate(date))
              const done = dayItems.some((item) => item.status === 'completed')
              return <span className={done ? 'done' : selectedDate === toIsoDate(date) ? 'current' : ''} key={toIsoDate(date)}>{done ? '✓' : date.getDate()}</span>
            })}</div></article>
            <button type="button" className="reschedule-button" onClick={goToday}><RotateCcw size={17} /> Quay về tuần hiện tại</button>
          </aside>
        </section>

        {activeContract && <section className="student-contract-strip"><div><small>GÓI TẬP ĐANG LIÊN KẾT</small><strong>{activeContract.packageName}</strong></div><div><span>{activeContract.usedSessions}/{activeContract.totalSessions} buổi</span><div><i style={{ width: `${Math.min(100, activeContract.totalSessions ? activeContract.usedSessions / activeContract.totalSessions * 100 : 0)}%` }} /></div></div></section>}
        {message && <div className="student-schedule-message" role="status"><Check size={17} /> {message}</div>}

        <section className="student-availability-card">
          <header><div><small>MA TRẬN THỜI GIAN RẢNH</small><h2>Chọn giờ bạn có thể tập hằng tuần</h2><p>Ma trận được giữ lại và liên kết trực tiếp với lịch tập phía trên.</p></div><span>{selectedSlots.size} ô đã chọn</span></header>
          <div className="student-schedule-legend"><span><i className="is-available" /> Có thể tập</span><span><i className="is-booked" /> Đã xếp ca</span><span><i className="is-linked" /> Đã liên kết</span></div>
          <div className="student-schedule-matrix-scroll" role="region" aria-label="Ma trận thời gian rảnh" tabIndex={0}>
            <table className="student-schedule-matrix"><thead><tr><th>Giờ</th>{workingDays.map((day) => <th key={day}>{day}</th>)}</tr></thead><tbody>{workingHours.map((hour) => <tr key={hour}><th>{String(hour).padStart(2, '0')}:00</th>{workingDays.map((day) => {
              const slotId = `${day}-${hour}`
              const selected = selectedSlots.has(slotId)
              const linkedSessions = sessionsBySlot.get(slotId) ?? []
              const booked = linkedSessions.length > 0
              return <td key={slotId}><button type="button" className={`${selected ? 'is-available' : ''} ${booked ? 'is-booked' : ''} ${selected && booked ? 'is-linked' : ''}`} aria-pressed={selected} aria-label={`${day} ${hour} giờ, ${selected ? 'đã chọn' : 'chưa chọn'}${booked ? `, có ${linkedSessions.length} ca đã xếp` : ''}`} onClick={() => toggleSlot(slotId)}>{selected && booked ? <Link2 size={16} /> : booked ? <Dumbbell size={16} /> : selected ? <Check size={16} /> : <span>+</span>}{booked && <small>{linkedSessions.length}</small>}</button></td>
            })}</tr>)}</tbody></table>
          </div>
          <footer><div><strong>{dirty ? 'Có thay đổi chưa lưu' : 'Dữ liệu đã đồng bộ'}</strong><span>Phiên bản lịch rảnh #{data.student.availabilityRevision}</span></div><button type="button" disabled={!dirty || saving} onClick={() => void save()}>{saving ? <LoaderCircle className="spin" size={17} /> : <Save size={17} />}{saving ? 'Đang lưu...' : 'Lưu lịch rảnh'}</button></footer>
        </section>

        {historySessions.length > 0 && <section className="student-session-history"><h2>Lịch sử gần đây</h2><div>{historySessions.map((session) => <article key={session.id}><span>{formatSessionDate(session.date)} · {session.hour === null ? '--:--' : `${String(session.hour).padStart(2, '0')}:00`}</span><strong>{session.trainerName}</strong><em>{statusLabels[session.status] ?? session.status}</em></article>)}</div></section>}
      </>}
    </div>
  )
}
