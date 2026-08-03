import { useEffect, useMemo, useState } from 'react'
import {
  AlertCircle,
  Ban,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Dumbbell,
  HeartPulse,
  LoaderCircle,
  MessageCircle,
  Pencil,
  Plus,
  RotateCcw,
  Save,
  X,
} from 'lucide-react'
import {
  createPtScheduleEventId,
  isPtScheduleCloudAvailable,
  listLocalPtScheduleEvents,
  listPtScheduleEvents,
  saveLocalPtScheduleEvent,
  savePtScheduleEvent,
  setLocalPtScheduleEventStatus,
  setPtScheduleEventStatus,
  type PtScheduleEvent,
  type PtScheduleEventDraft,
  type PtScheduleEventStatus,
  type PtScheduleEventType,
} from '../../services/ptCoachingScheduleService'
import type { PtCoachingStatus } from '../../services/ptCoachingClientService'

interface PtClientSchedulePanelProps {
  clientId: string
  clientName: string
  coachingStatus: PtCoachingStatus
  relationshipReady?: boolean
}

const typeLabels: Record<PtScheduleEventType, string> = {
  workout: 'Buổi tập theo giáo án',
  checkin: 'Check-in với PT',
  recovery: 'Phục hồi chủ động',
}

const statusLabels: Record<PtScheduleEventStatus, string> = {
  planned: 'Đã lên lịch',
  done: 'Hoàn thành',
  skipped: 'Bỏ qua',
  cancelled: 'Đã hủy',
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

function emptyDraft(): PtScheduleEventDraft {
  return {
    date: toIsoDate(new Date()),
    time: '18:00',
    durationMinutes: 60,
    title: '',
    type: 'workout',
    note: '',
  }
}

function draftFromEvent(event: PtScheduleEvent): PtScheduleEventDraft {
  return {
    date: event.date,
    time: event.time,
    durationMinutes: event.durationMinutes,
    title: event.title,
    type: event.type,
    note: event.note,
    workoutRef: event.workoutRef,
  }
}

function formatEventDate(event: PtScheduleEvent) {
  const [year, month, day] = event.date.split('-').map(Number)
  const date = new Date(year, month - 1, day)
  return new Intl.DateTimeFormat('vi-VN', { weekday: 'short', day: '2-digit', month: '2-digit' }).format(date)
}

function EventIcon({ type }: { type: PtScheduleEventType }) {
  if (type === 'workout') return <Dumbbell size={18} />
  if (type === 'checkin') return <MessageCircle size={18} />
  return <HeartPulse size={18} />
}

export default function PtClientSchedulePanel({
  clientId,
  clientName,
  coachingStatus,
  relationshipReady = true,
}: PtClientSchedulePanelProps) {
  const cloud = isPtScheduleCloudAvailable()
  const [events, setEvents] = useState<PtScheduleEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null)
  const [editingId, setEditingId] = useState<string | 'new' | null>(null)
  const [draft, setDraft] = useState<PtScheduleEventDraft>(() => emptyDraft())
  const [saving, setSaving] = useState(false)
  const [confirmCancelId, setConfirmCancelId] = useState<string | null>(null)
  const [cancelReason, setCancelReason] = useState('')
  const [cancelling, setCancelling] = useState(false)

  const canCreate = relationshipReady && (coachingStatus === 'active' || coachingStatus === 'onboarding')
  const orderedEvents = useMemo(() => [...events].sort((left, right) => (
    `${left.date}${left.time}${left.id}`.localeCompare(`${right.date}${right.time}${right.id}`)
  )), [events])

  const load = async () => {
    setLoading(true)
    setLoadError(null)
    try {
      if (!relationshipReady) {
        setEvents([])
        return
      }
      if (!cloud) {
        setEvents(listLocalPtScheduleEvents(clientId))
        return
      }
      const today = new Date()
      const result = await listPtScheduleEvents({
        clientId,
        fromDate: toIsoDate(addDays(today, -7)),
        toDate: toIsoDate(addDays(today, 45)),
      })
      setEvents(result)
    } catch (caught) {
      setLoadError(caught instanceof Error ? caught.message : 'Không thể tải lịch coaching.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
    // The selected client owns an independent schedule lifecycle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, cloud, relationshipReady])

  useEffect(() => {
    if (!editingId && !confirmCancelId) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || saving || cancelling) return
      setEditingId(null)
      setConfirmCancelId(null)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [cancelling, confirmCancelId, editingId, saving])

  const openCreate = () => {
    setDraft(emptyDraft())
    setEditingId('new')
    setMessage(null)
  }

  const openEdit = (event: PtScheduleEvent) => {
    setDraft(draftFromEvent(event))
    setEditingId(event.id)
    setMessage(null)
  }

  const updateDraft = <Key extends keyof PtScheduleEventDraft>(key: Key, value: PtScheduleEventDraft[Key]) => {
    setDraft((current) => ({ ...current, [key]: value }))
  }

  const save = async () => {
    const title = draft.title.trim()
    if (!title) return setMessage({ tone: 'error', text: 'Hãy nhập tên hoạt động.' })
    if (!draft.date || !draft.time || draft.durationMinutes < 5 || draft.durationMinutes > 240) {
      return setMessage({ tone: 'error', text: 'Ngày, giờ và thời lượng từ 5 đến 240 phút phải hợp lệ.' })
    }
    const previous = editingId && editingId !== 'new' ? events.find((event) => event.id === editingId) : undefined
    const eventId = previous?.id ?? createPtScheduleEventId()
    const normalizedDraft = { ...draft, title, note: draft.note.trim() }
    const optimistic: PtScheduleEvent = {
      ...normalizedDraft,
      id: eventId,
      clientId,
      coachId: previous?.coachId ?? '',
      status: previous?.status ?? 'planned',
      timeZone: previous?.timeZone ?? 'Asia/Ho_Chi_Minh',
      createdAt: previous?.createdAt,
      updatedAt: previous?.updatedAt,
    }
    const snapshot = events
    setEvents((current) => [optimistic, ...current.filter((event) => event.id !== eventId)])
    setSaving(true)
    setMessage(null)
    try {
      const saved = cloud
        ? await savePtScheduleEvent({
          clientId,
          eventId,
          expectedUpdatedAt: previous?.updatedAt,
          event: normalizedDraft,
        })
        : saveLocalPtScheduleEvent(clientId, eventId, normalizedDraft, previous)
      setEvents((current) => [saved, ...current.filter((event) => event.id !== saved.id)])
      setEditingId(null)
      setMessage({ tone: 'success', text: previous ? 'Đã cập nhật lịch coaching.' : 'Đã tạo lịch coaching mới.' })
    } catch (caught) {
      setEvents(snapshot)
      setMessage({ tone: 'error', text: caught instanceof Error ? caught.message : 'Không thể lưu lịch coaching.' })
    } finally {
      setSaving(false)
    }
  }

  const cancel = async () => {
    const event = events.find((item) => item.id === confirmCancelId)
    if (!event) return
    const snapshot = events
    setEvents((current) => current.map((item) => item.id === event.id ? {
      ...item,
      status: 'cancelled',
      cancellationReason: cancelReason.trim() || undefined,
    } : item))
    setCancelling(true)
    setMessage(null)
    try {
      const saved = cloud
        ? await setPtScheduleEventStatus({
          clientId,
          eventId: event.id,
          status: 'cancelled',
          expectedUpdatedAt: event.updatedAt,
          cancellationReason: cancelReason.trim() || undefined,
        })
        : setLocalPtScheduleEventStatus(clientId, event.id, 'cancelled', cancelReason)
      setEvents((current) => current.map((item) => item.id === saved.id ? saved : item))
      setConfirmCancelId(null)
      setCancelReason('')
      setMessage({ tone: 'success', text: 'Đã hủy lịch và giữ lại lịch sử.' })
    } catch (caught) {
      setEvents(snapshot)
      setMessage({ tone: 'error', text: caught instanceof Error ? caught.message : 'Không thể hủy lịch coaching.' })
    } finally {
      setCancelling(false)
    }
  }

  return (
    <section className="pt-client-schedule-panel" aria-busy={loading || saving || cancelling}>
      <div className="pt-client-schedule-heading">
        <span><CalendarDays size={20} /></span>
        <div><strong>Lịch của {clientName}</strong><small>{!relationshipReady ? 'Lưu hồ sơ coaching trước khi tạo lịch cloud' : cloud ? 'Đồng bộ cloud · hiển thị từ 7 ngày trước đến 45 ngày tới' : 'Dữ liệu demo lưu trên thiết bị này'}</small></div>
        <button type="button" className="primary-button" onClick={openCreate} disabled={!canCreate || saving}><Plus size={16} /> Tạo lịch</button>
      </div>

      {!relationshipReady
        ? <div className="pt-schedule-lock-note"><Ban size={16} /><span>Khách hàng chưa có quan hệ PT Coaching. Hãy thiết lập và lưu hồ sơ trước khi mở lịch.</span></div>
        : !canCreate && <div className="pt-schedule-lock-note"><Ban size={16} /><span>Khách hàng đang {coachingStatus === 'paused' ? 'tạm dừng' : 'đã hoàn thành coaching'}. Có thể xem hoặc hủy lịch cũ nhưng chưa thể tạo lịch mới.</span></div>}
      {message && <div className={`pt-schedule-message ${message.tone}`} role={message.tone === 'error' ? 'alert' : 'status'} aria-live="polite">{message.tone === 'success' ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}{message.text}</div>}

      {editingId && <div className="pt-schedule-editor" role="group" aria-labelledby="pt-schedule-editor-title">
        <div className="pt-schedule-editor__title"><div><strong id="pt-schedule-editor-title">{editingId === 'new' ? 'Tạo lịch coaching' : 'Sửa lịch coaching'}</strong><small>Thông tin này được chia sẻ với khách hàng.</small></div><button type="button" className="icon-button" aria-label="Đóng trình sửa lịch" onClick={() => setEditingId(null)} disabled={saving}><X size={17} /></button></div>
        <div className="pt-schedule-form">
          <label className="span-2"><span>Tên hoạt động *</span><input autoFocus maxLength={160} value={draft.title} onChange={(event) => updateDraft('title', event.target.value)} placeholder="Ví dụ: Lower Body Strength" /></label>
          <label><span>Ngày</span><input type="date" value={draft.date} onChange={(event) => updateDraft('date', event.target.value)} /></label>
          <label><span>Giờ bắt đầu</span><input type="time" value={draft.time} onChange={(event) => updateDraft('time', event.target.value)} /></label>
          <label><span>Loại hoạt động</span><select value={draft.type} onChange={(event) => updateDraft('type', event.target.value as PtScheduleEventType)}><option value="workout">Buổi tập theo giáo án</option><option value="checkin">Check-in với PT</option><option value="recovery">Phục hồi chủ động</option></select></label>
          <label><span>Thời lượng (phút)</span><input type="number" min={5} max={240} value={draft.durationMinutes} onChange={(event) => updateDraft('durationMinutes', Number(event.target.value) || 5)} /></label>
          <label className="span-2"><span>Ghi chú chia sẻ</span><textarea rows={3} maxLength={4_000} value={draft.note} onChange={(event) => updateDraft('note', event.target.value)} placeholder="Mục tiêu, nội dung check-in hoặc chỉ dẫn phục hồi..." /></label>
        </div>
        <div className="pt-schedule-editor__actions"><button type="button" className="outline-button" onClick={() => setEditingId(null)} disabled={saving}>Đóng</button><button type="button" className="primary-button" onClick={() => void save()} disabled={saving}>{saving ? <LoaderCircle className="spin" size={16} /> : <Save size={16} />}{saving ? 'Đang lưu...' : 'Lưu lịch'}</button></div>
      </div>}

      {loading ? <div className="pt-schedule-panel-state" role="status"><LoaderCircle className="spin" size={24} /><strong>Đang tải lịch coaching</strong></div>
        : loadError ? <div className="pt-schedule-panel-state error" role="alert"><AlertCircle size={24} /><strong>Chưa thể tải lịch</strong><p>{loadError}</p><button type="button" className="outline-button" onClick={() => void load()}><RotateCcw size={15} /> Thử lại</button></div>
          : !orderedEvents.length ? <div className="pt-schedule-panel-state"><CalendarDays size={25} /><strong>Chưa có lịch coaching</strong><p>Tạo buổi tập, check-in hoặc phục hồi đầu tiên cho khách hàng.</p></div>
            : <div className="pt-client-schedule-list">{orderedEvents.map((event) => <article className={`pt-client-schedule-event ${event.status}`} key={event.id}>
              <span className={`pt-client-schedule-event__icon ${event.type}`}><EventIcon type={event.type} /></span>
              <div className="pt-client-schedule-event__copy"><small>{formatEventDate(event)} · {event.time} · {event.durationMinutes} phút</small><strong>{event.title}</strong><p>{event.note || typeLabels[event.type]}</p><i className={`pt-activity-status ${event.status}`}>{statusLabels[event.status]}</i>{event.cancellationReason && <em>Lý do: {event.cancellationReason}</em>}</div>
              {event.status === 'planned' && <div className="pt-client-schedule-event__actions"><button type="button" className="icon-button" aria-label={`Sửa ${event.title}`} onClick={() => openEdit(event)} disabled={saving || cancelling}><Pencil size={16} /></button><button type="button" className="icon-button danger" aria-label={`Hủy ${event.title}`} onClick={() => { setConfirmCancelId(event.id); setCancelReason('') }} disabled={saving || cancelling}><Ban size={16} /></button></div>}
            </article>)}</div>}

      {confirmCancelId && <div className="pt-schedule-cancel-confirm" role="alertdialog" aria-labelledby="pt-cancel-title"><div><Ban size={18} /><span><strong id="pt-cancel-title">Xác nhận hủy lịch?</strong><small>Lịch vẫn được giữ lại để đối soát.</small></span></div><label><span>Lý do hủy (không bắt buộc)</span><textarea autoFocus rows={2} maxLength={500} value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} /></label><footer><button type="button" className="outline-button" onClick={() => setConfirmCancelId(null)} disabled={cancelling}>Quay lại</button><button type="button" className="danger-button" onClick={() => void cancel()} disabled={cancelling}>{cancelling ? <LoaderCircle className="spin" size={15} /> : <Ban size={15} />}{cancelling ? 'Đang hủy...' : 'Xác nhận hủy'}</button></footer></div>}
    </section>
  )
}
