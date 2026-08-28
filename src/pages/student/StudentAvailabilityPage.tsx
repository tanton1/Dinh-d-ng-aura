import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertCircle,
  CalendarDays,
  CalendarRange,
  Check,
  ChevronLeft,
  ChevronRight,
  Dumbbell,
  Link2,
  LoaderCircle,
  RefreshCw,
  Save,
  X,
} from 'lucide-react'
import {
  asStudentPtScheduleError,
  listMyStudentPtSchedule,
  saveMyStudentAvailability,
  type StudentPtScheduleData,
  type StudentPtScheduleServiceError,
  type StudentPtSession,
} from '../../services/studentPtScheduleService'
import type { ViewId } from '../../types'
import './StudentSchedulePage.css'
import './StudentAvailabilityPage.css'

const DEFAULT_DAYS = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7']
const DEFAULT_HOURS = [6, 7, 8, 9, 10, 11, 14, 15, 16, 17, 18, 19, 20]
type AvailabilityWeekOffset = 0 | 1 | 2

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

function sameSlots(left: Iterable<string>, right: Iterable<string>) {
  return [...left].sort().join('|') === [...right].sort().join('|')
}

function issueCopy(issue: StudentPtScheduleServiceError) {
  switch (issue.issueCode) {
    case 'AUTH_REQUIRED':
      return { title: 'Phiên đăng nhập đã hết hạn', description: 'Vui lòng đăng nhập lại để cập nhật lịch rảnh.' }
    case 'ACCESS_SYNC_REQUIRED':
      return { title: 'Quyền tài khoản chưa đồng bộ', description: 'Hãy đăng xuất, đăng nhập lại hoặc liên hệ quản trị viên.' }
    case 'PROFILE_NOT_LINKED':
      return { title: 'Chưa liên kết hồ sơ học viên', description: 'Quản trị viên cần liên kết tài khoản với hồ sơ PT trước khi bạn gửi lịch rảnh.' }
    case 'REVISION_CONFLICT':
      return { title: 'Lịch rảnh vừa được cập nhật ở nơi khác', description: 'Aura đã tải phiên bản mới nhất. Hãy kiểm tra lại các khung muốn gửi.' }
    case 'AVAILABILITY_LOCKED':
      return { title: 'Lịch rảnh của tuần đã khóa', description: 'Hãy chọn tuần kế tiếp hoặc liên hệ vận hành nếu cần điều chỉnh.' }
    case 'MINIMUM_AVAILABILITY_REQUIRED':
      return { title: 'Cần xác nhận số khung giờ', description: issue.message }
    default:
      return { title: 'Chưa thể đồng bộ lịch rảnh', description: issue.message }
  }
}

function demoAvailabilityData(today: Date, weekStart: Date, weekId: string): StudentPtScheduleData {
  const slots = ['T2-18', 'T3-18', 'T4-19', 'T5-18', 'T6-19']
  return {
    schemaVersion: 4,
    linked: true,
    identityLink: { status: 'linked', source: 'auth_uid', studentId: 'demo-student', crmProfileIdConfigured: false },
    student: {
      id: 'demo-student',
      name: 'An Nguyễn',
      branchId: 'demo-branch',
      sessionsPerWeek: 3,
      availableSlots: slots,
      isScheduleConfirmed: true,
      availabilityRevision: 1,
      availability: {
        weekId,
        slots,
        minimumSlots: 5,
        requiredSessions: 3,
        revision: 1,
        status: 'submitted',
        locked: false,
        cutoffAt: addDays(weekStart, -1).toISOString(),
        submittedAt: today.toISOString(),
        source: 'weekly',
      },
    },
    scheduleConfig: { workingDays: DEFAULT_DAYS, workingHours: DEFAULT_HOURS },
    sessions: [],
    sessionsTruncated: false,
    contracts: [],
    contractAlerts: [],
    sessionRequests: [],
    pauseRequests: [],
  }
}

export default function StudentAvailabilityPage({ onNavigate, isDemo = false }: { onNavigate: (view: ViewId) => void; isDemo?: boolean }) {
  const today = useMemo(() => new Date(), [])
  const [weekOffset, setWeekOffset] = useState<AvailabilityWeekOffset>(1)
  const [data, setData] = useState<StudentPtScheduleData | null>(null)
  const [selectedSlots, setSelectedSlots] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [issue, setIssue] = useState<StudentPtScheduleServiceError | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [confirmBelowMinimum, setConfirmBelowMinimum] = useState(false)
  const weekStart = useMemo(() => addDays(startOfWeek(today), weekOffset * 7), [today, weekOffset])
  const weekId = useMemo(() => toIsoDate(weekStart), [weekStart])
  const range = useMemo(() => ({ from: toIsoDate(weekStart), to: toIsoDate(addDays(weekStart, 6)) }), [weekStart])

  const load = useCallback(async () => {
    setLoading(true)
    setIssue(null)
    setMessage(null)
    try {
      const response = isDemo
        ? demoAvailabilityData(today, weekStart, weekId)
        : await listMyStudentPtSchedule(range.from, range.to, weekId)
      setData(response)
      setSelectedSlots(new Set(response.student?.availability?.slots ?? response.student?.availableSlots ?? []))
    } catch (caught) {
      setIssue(asStudentPtScheduleError(caught))
    } finally {
      setLoading(false)
    }
  }, [isDemo, range.from, range.to, today, weekId, weekStart])

  useEffect(() => { void load() }, [load])

  const workingDays = data?.scheduleConfig.workingDays?.length ? data.scheduleConfig.workingDays : DEFAULT_DAYS
  const workingHours = data?.scheduleConfig.workingHours?.length ? data.scheduleConfig.workingHours : DEFAULT_HOURS
  const availability = data?.student?.availability
  const originalSlots = availability?.slots ?? data?.student?.availableSlots ?? []
  const minimumSlots = availability?.minimumSlots ?? Math.max(5, data?.student?.sessionsPerWeek ?? 1)
  const missingSlots = Math.max(0, minimumSlots - selectedSlots.size)
  const locked = availability?.locked === true
  const dirty = !sameSlots(selectedSlots, originalSlots)
  const statusKey = locked ? 'locked' : dirty ? 'dirty' : availability?.status === 'submitted' ? 'submitted' : 'draft'
  const statusLabel = statusKey === 'locked' ? 'Đã khóa' : statusKey === 'dirty' ? 'Chưa lưu' : statusKey === 'submitted' ? 'Đã gửi' : 'Chưa gửi'
  const cutoffLabel = availability?.cutoffAt
    ? new Intl.DateTimeFormat('vi-VN', { weekday: 'long', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date(availability.cutoffAt))
    : '10:00 Chủ nhật trước tuần tập'
  const guidance = missingSlots > 0
    ? {
        tone: 'warning',
        title: `Còn thiếu ${missingSlots} khung khuyến nghị`,
        message: `Bạn có thể gửi sau khi xác nhận, nhưng ít hơn ${minimumSlots} khung có thể khiến Aura khó xếp đủ buổi hoặc giữ đúng PT.`,
      }
    : selectedSlots.size < minimumSlots + 2
      ? { tone: 'ready', title: 'Đã đủ mức khuyến nghị', message: 'Thêm 2 khung nữa sẽ tăng cơ hội xếp đủ buổi và giãn đều ngày tập.' }
      : { tone: 'excellent', title: 'Lựa chọn rất tốt!', message: 'Nhiều khung rảnh giúp Aura ưu tiên ca đôi, cân bằng lịch PT và xếp đủ buổi.' }
  const sessionsBySlot = useMemo(() => {
    const result = new Map<string, StudentPtSession[]>()
    for (const session of data?.sessions ?? []) {
      if (session.status !== 'scheduled') continue
      const slotId = slotIdForSession(session)
      if (slotId) result.set(slotId, [...(result.get(slotId) ?? []), session])
    }
    return result
  }, [data?.sessions])
  const issueContent = issue ? issueCopy(issue) : null

  const toggleSlot = (slotId: string) => {
    if (saving || locked) return
    setIssue(null)
    setMessage(null)
    setSelectedSlots((current) => {
      const next = new Set(current)
      if (next.has(slotId)) next.delete(slotId)
      else next.add(slotId)
      return next
    })
  }

  const save = async (belowMinimumAccepted = false) => {
    if (!data?.student || !dirty || saving || locked) return
    if (selectedSlots.size < minimumSlots && !belowMinimumAccepted) {
      setConfirmBelowMinimum(true)
      return
    }
    setSaving(true)
    setIssue(null)
    setMessage(null)
    setConfirmBelowMinimum(false)
    try {
      if (isDemo) {
        setData((current) => current?.student ? {
          ...current,
          student: {
            ...current.student,
            availableSlots: [...selectedSlots],
            availabilityRevision: current.student.availabilityRevision + 1,
            isScheduleConfirmed: true,
            availability: current.student.availability ? {
              ...current.student.availability,
              slots: [...selectedSlots],
              revision: current.student.availability.revision + 1,
              status: 'submitted',
            } : undefined,
          },
        } : current)
      } else {
        const result = await saveMyStudentAvailability({
          weekId,
          availableSlots: [...selectedSlots],
          expectedRevision: availability?.revision ?? data.student.availabilityRevision,
          confirmBelowMinimum: belowMinimumAccepted,
        })
        setData((current) => current?.student ? {
          ...current,
          student: {
            ...current.student,
            availableSlots: result.availableSlots,
            availabilityRevision: result.availabilityRevision,
            isScheduleConfirmed: result.isScheduleConfirmed,
            availability: result.availability,
          },
        } : current)
        setSelectedSlots(new Set(result.availableSlots))
      }
      setMessage(selectedSlots.size < minimumSlots
        ? `Đã gửi ${selectedSlots.size} khung sau khi bạn xác nhận. Vận hành sẽ chủ động rà soát phương án xếp lịch.`
        : 'Đã gửi lịch rảnh. Bộ phận vận hành sẽ rà soát các ca cần xếp lại.')
    } catch (caught) {
      const nextIssue = asStudentPtScheduleError(caught)
      if (nextIssue.issueCode === 'REVISION_CONFLICT') await load()
      setIssue(nextIssue)
    } finally {
      setSaving(false)
    }
  }

  return <main className="page student-availability-page" aria-busy={loading}>
    <section className="student-availability-page__hero">
      <div><small>AURA FITNESS · LỊCH RẢNH</small><h1>Thời gian có thể tập</h1><p>Chọn các khung bạn thực sự có thể đến tập. Mỗi tuần được lưu độc lập và không thay đổi các buổi đã xếp.</p></div>
      <span><CalendarRange size={31} /></span>
      <button type="button" onClick={() => onNavigate('schedule')}><ChevronLeft size={17} /> Quay lại lịch học</button>
    </section>

    {loading && <div className="student-schedule-state" role="status"><LoaderCircle className="spin" size={28} /><strong>Đang tải lịch rảnh</strong><span>Aura đang kiểm tra tuần và các ca đã xếp.</span></div>}
    {!loading && issue && issueContent && <div className="student-schedule-state is-error" role="alert"><AlertCircle size={25} /><strong>{issueContent.title}</strong><span>{issueContent.description}</span>{issue.retryable && <button type="button" onClick={() => void load()}><RefreshCw size={16} /> Thử lại</button>}</div>}
    {!loading && !issue && data && !data.linked && <div className="student-schedule-state is-warning"><Link2 size={26} /><strong>Chưa liên kết hồ sơ học viên</strong><span>Vui lòng liên hệ Aura để ghép tài khoản với hồ sơ PT.</span></div>}
    {message && <div className="student-schedule-message" role="status"><Check size={17} /> {message}</div>}

    {!loading && data?.student && <section className="student-availability-card">
      <header><div><small>MA TRẬN THỜI GIAN RẢNH · TUẦN {weekId}</small><h2>Đăng ký thời gian có thể tập</h2><p>Aura khuyến nghị ít nhất {minimumSlots} khung. Lịch khóa lúc 10:00 Chủ nhật trước tuần tập.</p></div><button type="button" className={`student-availability-status-button is-${statusKey}`} onClick={() => document.querySelector('.student-schedule-matrix-scroll')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}><strong>{statusLabel}</strong><span>{selectedSlots.size}/{minimumSlots} khung</span></button></header>
      <div className="student-availability-week-switch"><button type="button" className={weekOffset === 0 ? 'active' : ''} onClick={() => setWeekOffset(0)}>Tuần này</button><button type="button" className={weekOffset === 1 ? 'active' : ''} onClick={() => setWeekOffset(1)}>Tuần sau</button><button type="button" className={weekOffset === 2 ? 'active' : ''} onClick={() => setWeekOffset(2)}>Tuần kế</button></div>
      {locked && <div className="student-schedule-state is-warning student-availability-lock-note" role="status"><AlertCircle size={22} /><div><strong>Tuần này đã chốt lịch rảnh</strong><span>Khóa từ {cutoffLabel}. Tuần đã chốt không tự mở lại.</span></div>{weekOffset < 2 && <button type="button" onClick={() => setWeekOffset((weekOffset + 1) as AvailabilityWeekOffset)}>Chọn tuần kế tiếp <ChevronRight size={16} /></button>}</div>}
      {!locked && <div className={`student-availability-guidance is-${guidance.tone}`} role="status" aria-live="polite"><span>{missingSlots > 0 ? <AlertCircle size={20} /> : <Check size={20} />}</span><div><strong>{guidance.title}</strong><p>{guidance.message}</p></div><em>{selectedSlots.size}/{minimumSlots}</em></div>}
      <div className="student-schedule-legend"><span><i className="is-available" /> Có thể tập</span><span><i className="is-booked" /> Đã xếp ca</span><span><i className="is-linked" /> Đã liên kết</span></div>
      <div className="student-schedule-matrix-scroll" role="region" aria-label="Ma trận thời gian rảnh" tabIndex={0}>
        <table className="student-schedule-matrix"><thead><tr><th>Giờ</th>{workingDays.map((day) => <th key={day}>{day}</th>)}</tr></thead><tbody>{workingHours.map((hour) => <tr key={hour}><th>{String(hour).padStart(2, '0')}:00</th>{workingDays.map((day) => {
          const slotId = `${day}-${hour}`
          const selected = selectedSlots.has(slotId)
          const linkedSessions = sessionsBySlot.get(slotId) ?? []
          const booked = linkedSessions.length > 0
          return <td key={slotId}><button type="button" disabled={locked} className={`${selected ? 'is-available' : ''} ${booked ? 'is-booked' : ''} ${selected && booked ? 'is-linked' : ''}`} aria-pressed={selected} aria-label={`${day} ${hour} giờ, ${selected ? 'đã chọn' : 'chưa chọn'}${booked ? `, có ${linkedSessions.length} ca đã xếp` : ''}`} onClick={() => toggleSlot(slotId)}>{selected && booked ? <Link2 size={16} /> : booked ? <Dumbbell size={16} /> : selected ? <Check size={16} /> : null}{booked && <small>{linkedSessions.length}</small>}</button></td>
        })}</tr>)}</tbody></table>
      </div>
      <footer><div><strong>{locked ? 'Đã khóa' : dirty ? 'Có thay đổi chưa lưu' : 'Dữ liệu đã đồng bộ'}</strong><span>Phiên bản tuần #{availability?.revision ?? data.student.availabilityRevision}</span></div><button type="button" disabled={!dirty || saving || locked} onClick={() => void save()}>{saving ? <LoaderCircle className="spin" size={17} /> : <Save size={17} />}{saving ? 'Đang lưu...' : locked ? 'Tuần đã khóa' : 'Gửi lịch rảnh'}</button></footer>
    </section>}

    {confirmBelowMinimum && <div className="student-availability-confirm" role="presentation">
      <button type="button" className="student-availability-confirm__backdrop" aria-label="Đóng cảnh báo" onClick={() => setConfirmBelowMinimum(false)} />
      <section role="dialog" aria-modal="true" aria-labelledby="availability-confirm-title">
        <header><span><AlertCircle size={23} /></span><button type="button" aria-label="Đóng" onClick={() => setConfirmBelowMinimum(false)}><X size={19} /></button></header>
        <h2 id="availability-confirm-title">Chỉ gửi {selectedSlots.size} khung?</h2>
        <p>Aura khuyến nghị ít nhất {minimumSlots} khung để xếp đủ buổi, giữ đúng PT và tránh các ngày tập quá sát nhau.</p>
        <div className="student-availability-confirm__summary"><CalendarDays size={18} /><span><strong>Thiếu {missingSlots} khung khuyến nghị</strong><small>Bạn vẫn có thể gửi nếu đây là toàn bộ thời gian thực sự rảnh.</small></span></div>
        <footer><button type="button" onClick={() => setConfirmBelowMinimum(false)}>Chọn thêm khung</button><button type="button" className="is-confirm" onClick={() => void save(true)}>Vẫn gửi {selectedSlots.size} khung</button></footer>
      </section>
    </div>}
  </main>
}
