import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertCircle,
  CalendarCheck,
  CalendarDays,
  Check,
  Clock3,
  Dumbbell,
  Link2,
  LoaderCircle,
  RefreshCw,
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
import './StudentSchedulePage.css'

const DEFAULT_DAYS = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7']
const DEFAULT_HOURS = [6, 7, 8, 9, 10, 11, 14, 15, 16, 17, 18, 19, 20]

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
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

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

  return (
    <div className="student-schedule-page" aria-busy={loading}>
      <PageHeader eyebrow="AURA PT · LỊCH HỌC VIÊN" title="Lịch rảnh & lịch tập của bạn" description="Chọn thời gian có thể tập và theo dõi các ca PT đã được vận hành xếp cho đúng hồ sơ của bạn." />

      {loading && <div className="student-schedule-state" role="status"><LoaderCircle className="spin" size={30} /><strong>Đang liên kết lịch học viên</strong><span>Aura đang tải ma trận giờ rảnh và các ca tập của bạn.</span></div>}
      {!loading && error && <div className="student-schedule-state is-error" role="alert"><AlertCircle size={28} /><strong>Chưa thể đồng bộ lịch học viên</strong><span>{error}</span><button type="button" onClick={() => void load()}><RefreshCw size={16} /> Thử lại</button></div>}
      {!loading && !error && data && !data.linked && <div className="student-schedule-state is-warning"><Link2 size={28} /><strong>Chưa liên kết hồ sơ PT Gym</strong><span>Tài khoản này chưa được ghép với hồ sơ học viên đã migrate. Vui lòng liên hệ quản trị viên để liên kết UID.</span></div>}

      {!loading && !error && data?.student && <>
        <section className="student-schedule-summary" aria-label="Tổng quan lịch học viên">
          <article><span><CalendarCheck size={20} /></span><div><small>Trạng thái lịch</small><strong>{data.student.isScheduleConfirmed ? 'Đã gửi vận hành' : 'Đang cập nhật'}</strong></div></article>
          <article><span><Clock3 size={20} /></span><div><small>Khung giờ rảnh</small><strong>{selectedSlots.size} khung</strong></div></article>
          <article><span><Dumbbell size={20} /></span><div><small>Nhịp tập mục tiêu</small><strong>{data.student.sessionsPerWeek} buổi/tuần</strong></div></article>
          <article><span><Link2 size={20} /></span><div><small>Ca sắp tới</small><strong>{upcomingSessions.length} buổi</strong></div></article>
        </section>

        {activeContract && <section className="student-contract-strip"><div><small>GÓI TẬP ĐANG LIÊN KẾT</small><strong>{activeContract.packageName}</strong></div><div><span>{activeContract.usedSessions}/{activeContract.totalSessions} buổi</span><div><i style={{ width: `${Math.min(100, activeContract.totalSessions ? activeContract.usedSessions / activeContract.totalSessions * 100 : 0)}%` }} /></div></div></section>}
        {message && <div className="student-schedule-message" role="status"><Check size={17} /> {message}</div>}

        <section className="student-availability-card">
          <header><div><small>MA TRẬN THỜI GIAN RẢNH</small><h2>Chọn giờ bạn có thể tập hằng tuần</h2><p>Ô có biểu tượng liên kết là ca đã xếp trùng với thời gian rảnh của bạn.</p></div><span>{selectedSlots.size} ô đã chọn</span></header>
          <div className="student-schedule-legend"><span><i className="is-available" /> Có thể tập</span><span><i className="is-booked" /> Đã xếp ca</span><span><i className="is-linked" /> Đã liên kết</span></div>
          <div className="student-schedule-matrix-scroll" role="region" aria-label="Ma trận thời gian rảnh" tabIndex={0}>
            <table className="student-schedule-matrix">
              <thead><tr><th>Giờ</th>{workingDays.map((day) => <th key={day}>{day}</th>)}</tr></thead>
              <tbody>{workingHours.map((hour) => <tr key={hour}><th>{String(hour).padStart(2, '0')}:00</th>{workingDays.map((day) => {
                const slotId = `${day}-${hour}`
                const selected = selectedSlots.has(slotId)
                const linkedSessions = sessionsBySlot.get(slotId) ?? []
                const booked = linkedSessions.length > 0
                return <td key={slotId}><button type="button" className={`${selected ? 'is-available' : ''} ${booked ? 'is-booked' : ''} ${selected && booked ? 'is-linked' : ''}`} aria-pressed={selected} aria-label={`${day} ${hour} giờ, ${selected ? 'đã chọn' : 'chưa chọn'}${booked ? `, có ${linkedSessions.length} ca đã xếp` : ''}`} onClick={() => toggleSlot(slotId)}>{selected && booked ? <Link2 size={16} /> : booked ? <Dumbbell size={16} /> : selected ? <Check size={16} /> : <span>+</span>}{booked && <small>{linkedSessions.length}</small>}</button></td>
              })}</tr>)}</tbody>
            </table>
          </div>
          <footer><div><strong>{dirty ? 'Có thay đổi chưa lưu' : 'Dữ liệu đã đồng bộ'}</strong><span>Phiên bản lịch rảnh #{data.student.availabilityRevision}</span></div><button type="button" disabled={!dirty || saving} onClick={() => void save()}>{saving ? <LoaderCircle className="spin" size={17} /> : <Save size={17} />}{saving ? 'Đang lưu...' : 'Lưu lịch rảnh'}</button></footer>
        </section>

        <section className="student-linked-sessions">
          <header><div><small>LỊCH TẬP ĐÃ XẾP</small><h2>Các ca PT được liên kết</h2><p>Mỗi ca được đối chiếu với ma trận giờ rảnh ở phía trên.</p></div><span>{upcomingSessions.length} ca sắp tới</span></header>
          <div className="student-session-list">{upcomingSessions.length ? upcomingSessions.map((session) => {
            const slotId = slotIdForSession(session)
            const matched = selectedSlots.has(slotId)
            return <article key={session.id}><time><strong>{formatSessionDate(session.date)}</strong><span>{session.hour === null ? 'Chưa rõ giờ' : `${String(session.hour).padStart(2, '0')}:00`}</span></time><div className="student-session-icon"><Dumbbell size={20} /></div><div><h3>Buổi tập PT</h3><p><UserRound size={14} /> {session.trainerName}</p><span className={matched ? 'is-linked' : 'needs-review'}>{matched ? <><Link2 size={13} /> Khớp lịch rảnh</> : <><AlertCircle size={13} /> Cần rà soát</>}</span></div><em>{statusLabels[session.status] ?? session.status}</em></article>
          }) : <div className="student-session-empty"><CalendarDays size={28} /><strong>Chưa có ca tập sắp tới</strong><span>Khi vận hành xếp lịch, ca tập sẽ xuất hiện và tự liên kết vào ma trận.</span></div>}</div>
        </section>

        {historySessions.length > 0 && <section className="student-session-history"><h2>Lịch sử gần đây</h2><div>{historySessions.map((session) => <article key={session.id}><span>{formatSessionDate(session.date)} · {session.hour === null ? '--:--' : `${String(session.hour).padStart(2, '0')}:00`}</span><strong>{session.trainerName}</strong><em>{statusLabels[session.status] ?? session.status}</em></article>)}</div></section>}
      </>}
    </div>
  )
}
