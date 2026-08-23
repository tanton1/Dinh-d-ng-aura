import { useMemo, useRef, useState } from 'react'
import { CalendarClock, CircleAlert, X } from 'lucide-react'
import { createMySessionRequest } from '../../services/sessionOperationsService'

interface RequestableSession {
  id: string
  date: string
  hour: number | null
  revision: number
}

interface Props {
  onClose: () => void
  onCreated?: (message: string) => void
  session: RequestableSession
}

function newKey() {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('vi-VN', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' })
    .format(new Date(`${value}T00:00:00+07:00`))
}

export default function SessionRequestModal({ onClose, onCreated, session }: Props) {
  const [type, setType] = useState<'cancel' | 'reschedule'>('cancel')
  const [newDate, setNewDate] = useState('')
  const [newHour, setNewHour] = useState('')
  const [reason, setReason] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState('')
  const idempotencyKey = useRef(newKey())
  const sessionLabel = useMemo(() => `${formatDate(session.date)} · ${session.hour === null ? '--:--' : `${String(session.hour).padStart(2, '0')}:00`}`, [session.date, session.hour])

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (isSubmitting) return
    setError('')
    if (reason.trim().length < 3) return setError('Vui lòng nhập lý do từ 3 ký tự.')
    if (type === 'reschedule' && (!newDate || newHour === '')) return setError('Vui lòng chọn đầy đủ ngày và giờ mới.')

    setIsSubmitting(true)
    try {
      const result = await createMySessionRequest({
        sessionId: session.id,
        expectedRevision: session.revision,
        type,
        newDate: type === 'reschedule' ? newDate : undefined,
        newHour: type === 'reschedule' ? Number(newHour) : undefined,
        reason: reason.trim(),
        idempotencyKey: idempotencyKey.current,
      })
      const policyMessage = result.expectedCountsTowardContract
        ? `Đây là lượt ${result.expectedSequence} trong tháng; khi được duyệt, buổi đã xếp sẽ được tính vào gói tập.`
        : 'Đây là lượt đổi/hủy miễn tính buổi của tháng; khi được duyệt sẽ không trừ buổi.'
      onCreated?.(`Đã gửi yêu cầu. ${policyMessage}`)
      onClose()
    } catch (caught) {
      setError((caught instanceof Error ? caught.message : 'Chưa thể gửi yêu cầu.').replace(/^Firebase:\s*/i, ''))
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="student-policy-modal" role="dialog" aria-modal="true" aria-labelledby="session-policy-title">
      <button className="student-policy-modal__backdrop" type="button" aria-label="Đóng" onClick={onClose} />
      <section className="student-policy-sheet">
        <header>
          <span><CalendarClock size={21} /></span>
          <div><small>AURA · QUY ĐỊNH LỊCH</small><h2 id="session-policy-title">Đổi hoặc hủy buổi tập</h2></div>
          <button type="button" aria-label="Đóng" onClick={onClose}><X size={20} /></button>
        </header>
        <div className="student-policy-note"><CircleAlert size={18} /><p><strong>Gửi trước giờ tập ít nhất 12 giờ.</strong> Mỗi tháng có 1 lượt đổi/hủy không tính buổi. Từ lượt thứ 2, buổi đã lên lịch vẫn được ghi nhận vào gói tập.</p></div>
        <div className="student-policy-current"><small>BUỔI ĐANG CHỌN</small><strong>{sessionLabel}</strong></div>
        <form onSubmit={handleSubmit}>
          <div className="student-policy-segment" aria-label="Loại yêu cầu"><button type="button" className={type === 'cancel' ? 'active' : ''} onClick={() => setType('cancel')}>Hủy buổi</button><button type="button" className={type === 'reschedule' ? 'active' : ''} onClick={() => setType('reschedule')}>Đổi lịch</button></div>
          {type === 'reschedule' && <div className="student-policy-fields two-columns"><label><span>Ngày tập mới</span><input type="date" required value={newDate} onChange={(event) => setNewDate(event.target.value)} /></label><label><span>Giờ tập mới</span><select required value={newHour} onChange={(event) => setNewHour(event.target.value)}><option value="">Chọn giờ</option>{[6,7,8,9,10,11,14,15,16,17,18,19,20].map((value) => <option value={value} key={value}>{String(value).padStart(2, '0')}:00</option>)}</select></label></div>}
          <label className="student-policy-reason"><span>Lý do</span><textarea required maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Cho Aura biết lý do để vận hành hỗ trợ tốt hơn…" /></label>
          {error && <p className="student-policy-error" role="alert">{error}</p>}
          <footer><button type="button" className="secondary" onClick={onClose}>Để sau</button><button type="submit" disabled={isSubmitting}>{isSubmitting ? 'Đang gửi…' : 'Gửi yêu cầu'}</button></footer>
        </form>
      </section>
    </div>
  )
}
