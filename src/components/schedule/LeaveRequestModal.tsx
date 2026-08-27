import { useMemo, useRef, useState } from 'react'
import { CalendarRange, CircleAlert, ShieldCheck, X } from 'lucide-react'
import { createMyContractPauseRequest } from '../../services/sessionOperationsService'

interface Props {
  onClose: () => void
  onCreated?: (message: string) => void
  contractId: string
  policy?: {
    offMaxDaysPerRequest?: number
    offRegistrationCutoffHour?: number
    offLimitsByDuration?: { threeMonths: number; sixMonths: number; twelveMonths: number }
  }
}

function newKey() {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function duration(startDate: string, endDate: string) {
  if (!startDate || !endDate) return 0
  const start = Date.parse(`${startDate}T00:00:00+07:00`)
  const end = Date.parse(`${endDate}T00:00:00+07:00`)
  return Number.isFinite(start) && Number.isFinite(end) && end >= start ? Math.round((end - start) / 86_400_000) + 1 : 0
}

export default function LeaveRequestModal({ onClose, onCreated, contractId, policy }: Props) {
  const [type, setType] = useState<'off' | 'preservation'>('off')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [reason, setReason] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState('')
  const idempotencyKey = useRef(newKey())
  const durationDays = useMemo(() => duration(startDate, endDate), [startDate, endDate])
  const offMaxDays = policy?.offMaxDaysPerRequest ?? 14
  const cutoffHour = policy?.offRegistrationCutoffHour ?? 10
  const offLimits = policy?.offLimitsByDuration ?? { threeMonths: 1, sixMonths: 3, twelveMonths: 6 }

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (isSubmitting) return
    setError('')
    if (!durationDays) return setError('Khoảng ngày chưa hợp lệ.')
    if (type === 'off' && durationDays > offMaxDays) return setError(`OFF tối đa ${offMaxDays} ngày. Hãy chuyển sang Bảo lưu.`)
    if (type === 'preservation' && durationDays <= offMaxDays) return setError(`Khoảng nghỉ từ ${offMaxDays} ngày trở xuống dùng chế độ OFF.`)
    if (reason.trim().length < 3) return setError('Vui lòng nhập lý do từ 3 ký tự.')
    setIsSubmitting(true)
    try {
      const result = await createMyContractPauseRequest({ contractId, type, startDate, endDate, reason: reason.trim(), idempotencyKey: idempotencyKey.current })
      const allowance = type === 'off' ? ` Lượt OFF đang dùng/chờ duyệt: ${result.offUsedOrPending}/${result.offLimit}.` : ''
      onCreated?.(`Đã gửi yêu cầu ${type === 'off' ? 'OFF' : 'bảo lưu'} ${result.durationDays} ngày.${allowance} Khi được duyệt, ngày hết hạn hợp đồng sẽ được cộng tương ứng.`)
      onClose()
    } catch (caught) {
      setError((caught instanceof Error ? caught.message : 'Chưa thể gửi yêu cầu.').replace(/^Firebase:\s*/i, ''))
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="student-policy-modal" role="dialog" aria-modal="true" aria-labelledby="pause-policy-title">
      <button className="student-policy-modal__backdrop" type="button" aria-label="Đóng" onClick={onClose} />
      <section className="student-policy-sheet">
        <header><span><CalendarRange size={21} /></span><div><small>AURA · HỢP ĐỒNG</small><h2 id="pause-policy-title">Đăng ký OFF / Bảo lưu</h2></div><button type="button" aria-label="Đóng" onClick={onClose}><X size={20} /></button></header>
        <div className="student-policy-note"><CircleAlert size={18} /><p><strong>OFF tối đa {offMaxDays} ngày/lần</strong> và gửi trước {String(cutoffHour).padStart(2, '0')}:00 Chủ nhật của tuần nghỉ. Dài hơn phải chọn Bảo lưu.</p></div>
        <div className="student-policy-note is-success"><ShieldCheck size={18} /><p>Hợp đồng 3 tháng có {offLimits.threeMonths} lượt OFF, 6 tháng có {offLimits.sixMonths} lượt, 12 tháng có {offLimits.twelveMonths} lượt. Thời gian được duyệt sẽ cộng vào ngày hết hạn.</p></div>
        <form onSubmit={handleSubmit}>
          <div className="student-policy-segment"><button type="button" className={type === 'off' ? 'active' : ''} onClick={() => setType('off')}>OFF ≤ {offMaxDays} ngày</button><button type="button" className={type === 'preservation' ? 'active' : ''} onClick={() => setType('preservation')}>Bảo lưu &gt; {offMaxDays} ngày</button></div>
          <div className="student-policy-fields two-columns"><label><span>Từ ngày</span><input type="date" required value={startDate} onChange={(event) => setStartDate(event.target.value)} /></label><label><span>Đến ngày</span><input type="date" required value={endDate} onChange={(event) => setEndDate(event.target.value)} /></label></div>
          {durationDays > 0 && <div className="student-policy-duration"><span>Thời gian đề nghị</span><strong>{durationDays} ngày</strong></div>}
          <label className="student-policy-reason"><span>Lý do</span><textarea required maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Công tác, du lịch, sức khỏe…" /></label>
          {error && <p className="student-policy-error" role="alert">{error}</p>}
          <footer><button type="button" className="secondary" onClick={onClose}>Để sau</button><button type="submit" disabled={isSubmitting}>{isSubmitting ? 'Đang gửi…' : 'Gửi yêu cầu'}</button></footer>
        </form>
      </section>
    </div>
  )
}
