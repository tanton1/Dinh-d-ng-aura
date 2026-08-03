import { useEffect, useMemo, useState } from 'react'
import {
  AlertCircle,
  Ban,
  CalendarCheck,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Dumbbell,
  HeartPulse,
  LoaderCircle,
  MessageCircle,
  Plus,
  RotateCcw,
  Save,
  SkipForward,
  Trash2,
  X,
} from 'lucide-react'
import { PageHeader } from '../../components/ui'
import {
  createPtScheduleEventId,
  listLocalPtScheduleEvents,
  listPtScheduleEvents,
  removeLocalPtScheduleEvent,
  saveLocalPtScheduleEvent,
  setLocalPtScheduleEventStatus,
  setPtScheduleEventStatus,
  type PtScheduleEvent,
  type PtScheduleEventDraft,
  type PtScheduleEventStatus,
  type PtScheduleEventType,
} from '../../services/ptCoachingScheduleService'
import type { ViewId } from '../../types'
import '../../styles-coaching.css'

const dayLabels = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7']
const activityLabels: Record<PtScheduleEventType, string> = {
  workout: 'Buổi tập theo giáo án',
  checkin: 'Check-in với PT',
  recovery: 'Phục hồi chủ động',
}
const statusLabels: Record<PtScheduleEventStatus, string> = {
  planned: 'Đã lên lịch',
  done: 'Đã hoàn thành',
  skipped: 'Đã bỏ qua',
  cancelled: 'Đã hủy',
}

function toIsoDate(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function fromIsoDate(value: string) {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year, month - 1, day)
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

function createDraft(date: string): PtScheduleEventDraft {
  return { date, time: '18:00', durationMinutes: 60, title: '', type: 'workout', note: '' }
}

function createDemoActivities(today: Date, clientId: string): PtScheduleEvent[] {
  const common = { clientId, coachId: 'demo-coach', timeZone: 'Asia/Ho_Chi_Minh' }
  return [
    { ...common, id: 'demo-strength', date: toIsoDate(today), time: '18:00', durationMinutes: 60, title: 'Upper Body Strength', type: 'workout', note: 'Giáo án tuần 3 · 6 bài tập', status: 'planned' },
    { ...common, id: 'demo-checkin', date: toIsoDate(addDays(today, 1)), time: '20:00', durationMinutes: 20, title: 'Check-in tuần với PT', type: 'checkin', note: 'Đánh giá mức tạ, giấc ngủ và đau mỏi', status: 'planned' },
    { ...common, id: 'demo-recovery', date: toIsoDate(addDays(today, 2)), time: '07:30', durationMinutes: 25, title: 'Mobility & Recovery', type: 'recovery', note: 'Giãn cơ và phục hồi chủ động', status: 'planned' },
  ]
}

function ActivityIcon({ type }: { type: PtScheduleEventType }) {
  if (type === 'workout') return <Dumbbell size={22} />
  if (type === 'checkin') return <MessageCircle size={22} />
  return <HeartPulse size={22} />
}

export default function SchedulePage({ onNavigate, isDemo = false, ownerId = 'guest' }: { onNavigate: (view: ViewId) => void; isDemo?: boolean; ownerId?: string }) {
  const today = useMemo(() => new Date(), [])
  const todayIso = toIsoDate(today)
  const [activities, setActivities] = useState<PtScheduleEvent[]>(() => {
    if (!isDemo) return []
    const stored = listLocalPtScheduleEvents(ownerId)
    return stored.length ? stored : createDemoActivities(today, ownerId)
  })
  const [weekOffset, setWeekOffset] = useState(0)
  const [selectedDate, setSelectedDate] = useState(todayIso)
  const [editorOpen, setEditorOpen] = useState(false)
  const [draft, setDraft] = useState<PtScheduleEventDraft>(() => createDraft(todayIso))
  const [formError, setFormError] = useState<string | null>(null)
  const [loading, setLoading] = useState(!isDemo)
  const [cloudError, setCloudError] = useState<string | null>(null)
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null)
  const [pendingEventId, setPendingEventId] = useState<string | null>(null)

  const weekStart = useMemo(() => addDays(startOfWeek(today), weekOffset * 7), [today, weekOffset])
  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, index) => addDays(weekStart, index)), [weekStart])

  useEffect(() => {
    if (!isDemo || listLocalPtScheduleEvents(ownerId).length) return
    activities.forEach((activity) => {
      saveLocalPtScheduleEvent(ownerId, activity.id, {
        date: activity.date,
        time: activity.time,
        durationMinutes: activity.durationMinutes,
        title: activity.title,
        type: activity.type,
        note: activity.note,
        workoutRef: activity.workoutRef,
      }, activity)
    })
  }, [activities, isDemo, ownerId])

  const loadCloudSchedule = async () => {
    if (isDemo) return
    setLoading(true)
    setCloudError(null)
    try {
      const from = new Date(Math.min(weekDays[0].getTime(), today.getTime()))
      const to = new Date(Math.max(weekDays[6].getTime(), addDays(today, 35).getTime()))
      setActivities(await listPtScheduleEvents({ clientId: ownerId, fromDate: toIsoDate(from), toDate: toIsoDate(to) }))
    } catch (caught) {
      setCloudError(caught instanceof Error ? caught.message : 'Không thể tải lịch PT cloud.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadCloudSchedule()
    // Reload when navigating to a different week; demo data stays local.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDemo, ownerId, weekOffset])

  useEffect(() => {
    if (!editorOpen) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setEditorOpen(false)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [editorOpen])

  const selectedActivities = useMemo(() => activities.filter((activity) => activity.date === selectedDate).sort((left, right) => left.time.localeCompare(right.time)), [activities, selectedDate])
  const upcomingActivities = useMemo(() => activities.filter((activity) => activity.date >= todayIso && activity.status === 'planned').sort((left, right) => `${left.date}${left.time}`.localeCompare(`${right.date}${right.time}`)).slice(0, 5), [activities, todayIso])
  const weekActivities = useMemo(() => {
    const first = toIsoDate(weekDays[0])
    const last = toIsoDate(weekDays[6])
    return activities.filter((activity) => activity.date >= first && activity.date <= last && activity.status !== 'cancelled')
  }, [activities, weekDays])
  const weekCompletion = weekActivities.length ? Math.round(weekActivities.filter((item) => item.status === 'done').length / weekActivities.length * 100) : 0

  const weekLabel = `${new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: 'short' }).format(weekDays[0])} – ${new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: 'short', year: 'numeric' }).format(weekDays[6])}`
  const selectedLabel = new Intl.DateTimeFormat('vi-VN', { weekday: 'long', day: 'numeric', month: 'long' }).format(fromIsoDate(selectedDate))

  const openEditor = (date = selectedDate) => {
    if (!isDemo) return
    setDraft(createDraft(date))
    setFormError(null)
    setEditorOpen(true)
  }

  const saveActivity = () => {
    const title = draft.title.trim()
    if (!title) return setFormError('Hãy nhập tên hoạt động.')
    if (!draft.date || !draft.time || draft.durationMinutes < 5 || draft.durationMinutes > 240) return setFormError('Ngày, giờ và thời lượng từ 5 đến 240 phút phải hợp lệ.')
    const eventId = createPtScheduleEventId()
    const saved = saveLocalPtScheduleEvent(ownerId, eventId, { ...draft, title, note: draft.note.trim() })
    setActivities((current) => [saved, ...current.filter((item) => item.id !== eventId)])
    setSelectedDate(draft.date)
    setEditorOpen(false)
  }

  const updateStatus = async (activity: PtScheduleEvent, status: 'done' | 'skipped') => {
    if (pendingEventId) return
    const snapshot = activities
    setActivities((current) => current.map((item) => item.id === activity.id ? { ...item, status } : item))
    setPendingEventId(activity.id)
    setMessage(null)
    try {
      const saved = isDemo
        ? setLocalPtScheduleEventStatus(ownerId, activity.id, status)
        : await setPtScheduleEventStatus({
          clientId: ownerId,
          eventId: activity.id,
          status,
          expectedUpdatedAt: activity.updatedAt,
        })
      setActivities((current) => current.map((item) => item.id === saved.id ? saved : item))
      setMessage({ tone: 'success', text: status === 'done' ? 'Đã xác nhận hoàn thành hoạt động.' : 'Đã đánh dấu bỏ qua hoạt động.' })
    } catch (caught) {
      setActivities(snapshot)
      setMessage({ tone: 'error', text: caught instanceof Error ? caught.message : 'Không thể cập nhật lịch PT.' })
    } finally {
      setPendingEventId(null)
    }
  }

  const removeActivity = (id: string) => {
    if (!isDemo) return
    removeLocalPtScheduleEvent(ownerId, id)
    setActivities((current) => current.filter((activity) => activity.id !== id))
  }

  const goToday = () => { setWeekOffset(0); setSelectedDate(todayIso) }
  const moveWeek = (amount: number) => {
    const nextOffset = weekOffset + amount
    setWeekOffset(nextOffset)
    setSelectedDate(toIsoDate(addDays(startOfWeek(today), nextOffset * 7)))
  }
  const selectUpcoming = (activity: PtScheduleEvent) => {
    setWeekOffset(Math.floor((fromIsoDate(activity.date).getTime() - startOfWeek(today).getTime()) / (7 * 86_400_000)))
    setSelectedDate(activity.date)
  }

  return (
    <div className="page schedule-page pt-schedule-page" aria-busy={loading}>
      <PageHeader
        eyebrow="PT COACHING"
        title="Lịch coaching & tập luyện"
        description={isDemo ? 'Lập lịch mẫu cho buổi tập, check-in và phục hồi trên thiết bị này.' : 'Theo dõi lịch do PT sắp xếp và xác nhận hoạt động của bạn. Lịch này độc lập với Aura Academy.'}
        action={isDemo ? <button type="button" className="primary-button" onClick={() => openEditor()}><Plus size={18} /> Thêm lịch PT</button> : undefined}
      />

      <div className="pt-schedule-banner"><div><i><CalendarCheck size={20} /></i><span><strong>Kế hoạch tuần của bạn</strong><small>{weekActivities.length} hoạt động · Hoàn thành {weekCompletion}%</small></span></div><small>{isDemo ? 'Bản demo được lưu cục bộ trên thiết bị.' : 'Lịch được đồng bộ từ PT; bạn chỉ có thể xác nhận hoàn thành hoặc bỏ qua.'}</small></div>
      {message && <div className={`pt-schedule-message page-message ${message.tone}`} role={message.tone === 'error' ? 'alert' : 'status'} aria-live="polite">{message.tone === 'success' ? <Check size={16} /> : <AlertCircle size={16} />}{message.text}</div>}
      {cloudError && <div className="pt-schedule-cloud-error" role="alert"><AlertCircle size={18} /><span><strong>Chưa thể đồng bộ lịch PT</strong><small>{cloudError}</small></span><button type="button" className="outline-button" onClick={() => void loadCloudSchedule()}><RotateCcw size={15} /> Thử lại</button></div>}

      <section className="schedule-layout">
        <div className="calendar-panel card">
          <div className="calendar-header"><button type="button" aria-label="Tuần trước" onClick={() => moveWeek(-1)}><ChevronLeft size={19} /></button><div><strong>{weekLabel}</strong><button type="button" onClick={goToday}>Hôm nay</button></div><button type="button" aria-label="Tuần sau" onClick={() => moveWeek(1)}><ChevronRight size={19} /></button></div>
          <div className="week-strip">{weekDays.map((date) => { const iso = toIsoDate(date); const activity = activities.find((item) => item.date === iso && item.status !== 'cancelled'); return <button type="button" key={iso} className={selectedDate === iso ? 'active' : ''} aria-pressed={selectedDate === iso} aria-label={`${dayLabels[date.getDay()]} ngày ${date.getDate()}, ${activity ? 'có lịch' : 'không có lịch'}`} onClick={() => setSelectedDate(iso)}><span>{dayLabels[date.getDay()]}</span><strong>{date.getDate()}</strong>{activity && <i className={activity.type === 'workout' ? undefined : activity.type === 'checkin' ? 'orange' : 'green'} />}</button> })}</div>
          <div className="day-label"><span>{selectedLabel.toLocaleUpperCase('vi')}</span><small>{selectedActivities.length} hoạt động PT</small></div>

          {loading ? <div className="schedule-empty-inline" role="status"><LoaderCircle className="spin" size={28} /><h3>Đang đồng bộ lịch PT</h3><p>Aura đang tải kế hoạch coaching của bạn.</p></div>
            : selectedActivities.length ? selectedActivities.map((activity) => <article className={`timeline-event featured ${activity.status}`} key={activity.id}>
              <div className="event-time"><strong>{activity.time}</strong><span>{activity.durationMinutes} phút</span></div><div className="event-line"><i /></div>
              <div className="event-detail"><div className="event-icon purple"><ActivityIcon type={activity.type} /></div><div><span>{activityLabels[activity.type].toLocaleUpperCase('vi')}</span><h3>{activity.title}</h3><p>{activity.note || `${activity.durationMinutes} phút`}</p><em className={`pt-activity-status ${activity.status}`}>{statusLabels[activity.status]}</em>{activity.cancellationReason && <small className="pt-cancellation-reason">Lý do: {activity.cancellationReason}</small>}</div><div className="schedule-event-actions">{activity.type === 'workout' && activity.status === 'planned' && <button type="button" className="primary-button" onClick={() => onNavigate('workout')}>Bắt đầu</button>}{activity.status === 'planned' && <><button type="button" className="outline-button" aria-label={`Đánh dấu hoàn thành ${activity.title}`} title="Đánh dấu hoàn thành" onClick={() => void updateStatus(activity, 'done')} disabled={Boolean(pendingEventId)}>{pendingEventId === activity.id ? <LoaderCircle className="spin" size={16} /> : <Check size={16} />}</button><button type="button" className="outline-button" aria-label={`Bỏ qua ${activity.title}`} title="Bỏ qua hoạt động" onClick={() => void updateStatus(activity, 'skipped')} disabled={Boolean(pendingEventId)}><SkipForward size={16} /></button></>}{isDemo && <button type="button" className="outline-button schedule-delete" aria-label={`Xóa ${activity.title}`} onClick={() => removeActivity(activity.id)}><Trash2 size={16} /></button>}</div></div>
            </article>) : <div className="schedule-empty-inline"><CalendarDays size={28} /><h3>{isDemo ? 'Chưa có lịch PT trong ngày này' : 'PT chưa sắp lịch cho ngày này'}</h3><p>{isDemo ? 'Thêm buổi tập, check-in hoặc phiên phục hồi.' : 'Khi PT cập nhật kế hoạch, hoạt động sẽ xuất hiện tại đây.'}</p>{isDemo && <button type="button" className="outline-button" onClick={() => openEditor(selectedDate)}><Plus size={16} /> Thêm vào ngày này</button>}</div>}
        </div>

        <aside className="schedule-side"><article className="card next-week"><div className="section-heading"><div><h2>Sắp tới</h2><p>Hoạt động PT gần nhất</p></div><button type="button" className="text-button" onClick={goToday}>Tuần hiện tại</button></div>{upcomingActivities.length ? upcomingActivities.map((activity) => { const date = fromIsoDate(activity.date); return <button type="button" className="upcoming-item" key={activity.id} onClick={() => selectUpcoming(activity)}><span className={`upcoming-date ${activity.type === 'workout' ? '' : activity.type === 'checkin' ? 'orange' : 'green'}`}><strong>{date.getDate()}</strong><small>THG {date.getMonth() + 1}</small></span><span><small>{activity.time} · {activityLabels[activity.type]}</small><strong>{activity.title}</strong><em>{activity.durationMinutes} phút</em></span><ChevronRight size={17} /></button> }) : <div className="schedule-empty-state compact"><CalendarCheck size={26} /><h3>Chưa có lịch sắp tới</h3><p>{isDemo ? 'Thêm hoạt động vào kế hoạch cá nhân.' : 'PT chưa giao hoạt động mới.'}</p></div>}</article>
          <article className="card consistency-card"><div className="consistency-icon"><CalendarDays size={24} /></div><div><span className="eyebrow">TUÂN THỦ GIÁO ÁN</span><h3>{weekCompletion}% kế hoạch tuần</h3><p>Chỉ tính buổi tập, check-in và phục hồi của PT Coaching.</p></div><div className="consistency-dots">{weekDays.slice(0, 5).map((date, index) => { const dayItems = activities.filter((item) => item.date === toIsoDate(date)); const done = dayItems.some((item) => item.status === 'done'); return <span className={done ? 'done' : selectedDate === toIsoDate(date) ? 'current' : ''} key={toIsoDate(date)}>{done ? '✓' : index + 1}</span> })}</div></article>
          <button type="button" className="reschedule-button" onClick={goToday}><RotateCcw size={17} /> Quay về tuần hiện tại</button>
        </aside>
      </section>

      {isDemo && editorOpen && <div className="modal-backdrop" role="presentation" onClick={() => setEditorOpen(false)}><section className="schedule-modal" role="dialog" aria-modal="true" aria-labelledby="schedule-editor-title" onClick={(event) => event.stopPropagation()}><header><div><span className="eyebrow">LỊCH PT COACHING · DEMO</span><h2 id="schedule-editor-title">Thêm hoạt động</h2><p>Lịch mẫu được lưu trên thiết bị và không đồng bộ lên cloud.</p></div><button type="button" className="icon-button" aria-label="Đóng" onClick={() => setEditorOpen(false)}><X size={18} /></button></header><div className="schedule-form-grid"><label className="span-2"><span>Tên hoạt động *</span><input autoFocus maxLength={160} value={draft.title} onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))} placeholder="Ví dụ: Lower Body Strength" /></label><label><span>Ngày</span><input type="date" value={draft.date} onChange={(event) => setDraft((current) => ({ ...current, date: event.target.value }))} /></label><label><span>Giờ bắt đầu</span><input type="time" value={draft.time} onChange={(event) => setDraft((current) => ({ ...current, time: event.target.value }))} /></label><label><span>Loại hoạt động</span><select value={draft.type} onChange={(event) => setDraft((current) => ({ ...current, type: event.target.value as PtScheduleEventType }))}><option value="workout">Buổi tập theo giáo án</option><option value="checkin">Check-in với PT</option><option value="recovery">Phục hồi chủ động</option></select></label><label><span>Thời lượng (phút)</span><input type="number" min="5" max="240" value={draft.durationMinutes} onChange={(event) => setDraft((current) => ({ ...current, durationMinutes: Math.max(5, Number(event.target.value) || 5) }))} /></label><label className="span-2"><span>Ghi chú</span><textarea rows={3} maxLength={4_000} value={draft.note} onChange={(event) => setDraft((current) => ({ ...current, note: event.target.value }))} placeholder="Mục tiêu buổi tập, chỉ dẫn của PT hoặc nội dung check-in..." /></label></div>{formError && <div className="builder-save-error" role="alert">{formError}</div>}<footer><button type="button" className="outline-button" onClick={() => setEditorOpen(false)}>Hủy</button><button type="button" className="primary-button" onClick={saveActivity}><Save size={16} /> Lưu lịch PT</button></footer></section></div>}
    </div>
  )
}
