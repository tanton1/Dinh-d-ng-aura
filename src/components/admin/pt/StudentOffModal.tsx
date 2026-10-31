import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { getStudentOffContext, saveStudentOff, type StudentOffCommand, type StudentOffContext, type StudentOffResult } from '../../../services/sessionOperationsService'
import './StudentOffModal.css'

interface Props {
  contractId: string
  requestId?: string
  onClose: () => void
  onSaved: (result: StudentOffResult) => void
}

const formatDate = (value: string) => value ? value.slice(0, 10).split('-').reverse().join('/') : '—'
const daysBetween = (start: string, end: string) => Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000) + 1
const addDays = (value: string, days: number) => new Date(Date.parse(`${value}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10)

function cutoffDate(start: string, hour: number) {
  const weekday = new Date(`${start}T00:00:00Z`).getUTCDay()
  return new Date(`${addDays(start, weekday === 0 ? -7 : -weekday)}T${String(hour).padStart(2, '0')}:00:00+07:00`)
}

export default function StudentOffModal({ contractId, requestId, onClose, onSaved }: Props) {
  const titleId = useId()
  const dialog = useRef<HTMLDialogElement>(null)
  const mounted = useRef(false)
  const sending = useRef(false)
  const pending = useRef<StudentOffCommand | null>(null)
  const [context, setContext] = useState<StudentOffContext | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [reason, setReason] = useState('')
  const [exception, setException] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [uncertain, setUncertain] = useState(false)
  const [result, setResult] = useState<StudentOffResult | null>(null)
  useEffect(() => {
    mounted.current = true
    const element = dialog.current
    element?.showModal()
    return () => { mounted.current = false; element?.close() }
  }, [])
  useEffect(() => {
    let active = true
    setError('')
    setContext(null)
    void getStudentOffContext(contractId, requestId).then(value => {
      if (!active) return
      setContext(value)
      setStart(value.request?.startDate || '')
      setEnd(value.request?.endDate || '')
    }).catch(cause => { if (active) setError(cause instanceof Error ? cause.message : 'Không tải được quy định OFF.') })
    return () => { active = false }
  }, [contractId, requestId, attempt])
  const days = start && end ? daysBetween(start, end) : 0
  const approved = context?.request?.status !== 'pending'
  const oldDays = context?.request?.status === 'approved' ? daysBetween(context.request.startDate, context.request.endDate) : 0
  const delta = approved ? days - oldDays : 0
  const validDays = Boolean(context && Number.isFinite(days) && days > 0 && days <= context.policy.maxDays && start >= context.startDate && end <= context.maxOffEndDate)
  const cutoff = context && start ? cutoffDate(start, context.policy.cutoffHour) : null
  const late = Boolean(cutoff && context && new Date(context.now).getTime() >= cutoff.getTime())
  const exhausted = Boolean(context && context.policy.offUsed >= context.policy.offLimit)
  const nextEnd = context && validDays ? addDays(context.endDate, delta) : ''
  const submit = async () => {
    if (!context || sending.current) return
    if (!pending.current) pending.current = {
      action: requestId ? 'edit' : 'create', contractId, ...(requestId ? { requestId, expectedRevision: context.request!.revision } : {}),
      expectedContractRevision: context.contractRevision, startDate: start, endDate: end, reason, exceptionReason: exception, idempotencyKey: crypto.randomUUID(),
    }
    sending.current = true
    setSaving(true)
    setError('')
    try {
      const saved = await saveStudentOff(pending.current)
      if (mounted.current) { setResult(saved); setUncertain(false) }
    } catch (cause) {
      if (!mounted.current) return
      const code = cause && typeof cause === 'object' && 'code' in cause ? String(cause.code) : ''
      const definitive = /invalid-argument|failed-precondition|permission-denied|unauthenticated|not-found|already-exists|resource-exhausted|aborted/.test(code)
      if (definitive) pending.current = null
      setUncertain(!definitive)
      setError(cause instanceof Error ? cause.message : 'Chưa xác nhận được kết quả lưu OFF.')
    } finally {
      sending.current = false
      if (mounted.current) setSaving(false)
    }
  }
  const close = () => { if (!sending.current) { if (result) onSaved(result); else onClose() } }
  return createPortal(<dialog ref={dialog} className="student-off-dialog" aria-labelledby={titleId} onCancel={event => { event.preventDefault(); close() }}>
    <form onSubmit={event => { event.preventDefault(); void submit() }}>
      <header><div><h2 id={titleId}>{requestId ? 'Sửa ngày OFF' : 'Tạo OFF'}</h2>{context && <p>{context.studentName} · {context.packageName}</p>}</div><button type="button" aria-label="Đóng OFF" disabled={saving} onClick={close}><X size={20} /></button></header>
      {!context && !error && <p role="status">Đang tải quy định OFF…</p>}
      {error && <div className="student-off-dialog__warning" role="alert">{error}{!context && <button type="button" onClick={() => setAttempt(value => value + 1)}>Tải lại</button>}</div>}
      {result ? <div className="student-off-dialog__success" role="status">
        <strong>{requestId ? 'Đã cập nhật ngày OFF.' : 'Đã tạo OFF.'}</strong>
        <p>{formatDate(start)} – {formatDate(end)} · {result.durationDays} ngày</p>
        {result.status === 'pending' ? <p>Yêu cầu vẫn chờ duyệt; ngày hết hạn chưa thay đổi.</p> : <p>Hết hạn hợp đồng: <b>{formatDate(result.newEndDate)}</b></p>}
        {result.cancelledSessionCount > 0 && <p>Đã hủy {result.cancelledSessionCount} buổi trong khoảng OFF.</p>}
        {result.rescheduleNeededCount > 0 && <p className="student-off-dialog__warning">Có {result.rescheduleNeededCount} buổi đã hủy nằm ngoài ngày OFF mới. Hãy xếp lại trong Lịch tập.</p>}
      </div> : context && <>
        <p className="student-off-dialog__policy">Tối đa {context.policy.maxDays} ngày/lượt · Còn {Math.max(0, context.policy.offLimit - context.policy.offUsed)} lượt{requestId ? ' (gồm lượt đang sửa)' : ''}</p>
        {exhausted && <p className="student-off-dialog__warning" role="alert">Hợp đồng đã đăng ký đủ lượt OFF.</p>}
        <fieldset disabled={saving || uncertain}>
          <div className="student-off-dialog__dates">
            <label>Từ ngày<input autoFocus required aria-label="OFF từ ngày" type="date" min={context.startDate} max={context.maxOffEndDate} value={start} onChange={event => { setStart(event.target.value); if (!end || end < event.target.value) setEnd(event.target.value) }} /></label>
            <label>Đến ngày<input required aria-label="OFF đến ngày" type="date" min={start || context.startDate} max={context.maxOffEndDate} value={end} onChange={event => setEnd(event.target.value)} /></label>
          </div>
          {start && end && !validDays && <p className="student-off-dialog__warning" role="alert">Chọn từ 1–{context.policy.maxDays} ngày, trong thời hạn {formatDate(context.startDate)} – {formatDate(context.maxOffEndDate)}.</p>}
          {validDays && <p className="student-off-dialog__preview">{days} ngày OFF{approved ? <> · Hết hạn mới <strong>{formatDate(nextEnd)}</strong>{delta !== 0 && ` (${delta > 0 ? '+' : ''}${delta} ngày)`}</> : ' · Chờ duyệt'}</p>}
          <label>{requestId ? 'Lý do chỉnh sửa' : 'Lý do OFF'}<textarea required minLength={3} maxLength={1000} rows={2} value={reason} onChange={event => setReason(event.target.value)} /></label>
          {late && <div className="student-off-dialog__exception"><p>Đã qua giờ chốt {context.policy.cutoffHour}:00 ngày {formatDate(new Date(cutoff!.getTime() + 7 * 3600000).toISOString().slice(0, 10))}.</p><label>Lý do ngoại lệ<textarea required minLength={3} maxLength={1000} rows={2} value={exception} onChange={event => setException(event.target.value)} /></label></div>}
        </fieldset>
        {uncertain ? <p role="status">Chưa nhận được xác nhận. Bấm “Kiểm tra & lưu lại” để tiếp tục đúng thao tác đã gửi.</p> : <p className="student-off-dialog__hint">{approved ? 'Buổi chưa tập trong khoảng OFF sẽ được hủy.' : 'Sửa ngày không tự duyệt yêu cầu.'}{oldDays > 0 && ' Buổi đã hủy trước đó cần xếp lại nếu nằm ngoài ngày OFF mới.'}</p>}
      </>}
      <footer><button type="button" disabled={saving} onClick={close}>{result ? 'Xong' : 'Đóng'}</button>{context && !result && <button type="submit" className="is-primary" disabled={saving || !uncertain && (!validDays || exhausted || reason.trim().length < 3 || late && exception.trim().length < 3)}>{saving ? 'Đang lưu…' : uncertain ? 'Kiểm tra & lưu lại' : requestId ? 'Lưu ngày OFF' : 'Tạo OFF'}</button>}</footer>
    </form>
  </dialog>, document.body)
}
