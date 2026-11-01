import { useEffect, useRef, useState, type FormEvent } from 'react'
import { X, ArrowRight, AlertTriangle, Check } from 'lucide-react'
import type { ContractAmendmentCommand, ContractAmendmentPreview, ContractAmendmentTerms, Student360ContractRecord, Student360ContractWorkspace } from './types'
import './ContractAmendmentDialog.css'

type Props = {
  contract: Student360ContractRecord
  packages: Student360ContractWorkspace['packages']
  onPreview: (terms: ContractAmendmentTerms) => Promise<ContractAmendmentPreview>
  onConfirm: (command: ContractAmendmentCommand) => Promise<void>
  onClose: () => void
}
const money = (value: number) => `${new Intl.NumberFormat('vi-VN').format(value)}đ`
const dateLabel = (value: string) => value.split('-').reverse().join('/')
function addMonths(value: string, months: number) {
  const [year, month, day] = value.split('-').map(Number)
  const result = new Date(Date.UTC(year, month - 1 + months, 1))
  const last = new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)).getUTCDate()
  result.setUTCDate(Math.min(day, last))
  return result.toISOString().slice(0, 10)
}

export default function ContractAmendmentDialog({ contract, packages, onPreview, onConfirm, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null)
  const comparison = useRef<HTMLElement>(null)
  const pending = useRef<ContractAmendmentCommand | null>(null)
  const inFlight = useRef(false)
  const [terms, setTerms] = useState<ContractAmendmentTerms>({ packageId: contract.packageId, totalSessions: contract.totalSessions,
    totalPrice: contract.totalPrice || 0, discount: contract.discount || 0, endDate: contract.endDate })
  const [reason, setReason] = useState('')
  const [preview, setPreview] = useState<ContractAmendmentPreview | null>(null)
  const [busy, setBusy] = useState(false)
  const [retry, setRetry] = useState(false)
  const [error, setError] = useState('')
  const [cancelBookings, setCancelBookings] = useState(false)
  useEffect(() => { dialog.current?.showModal(); return () => dialog.current?.close() }, [])
  useEffect(() => {
    const section = comparison.current, body = section?.parentElement
    if (preview && section && body) body.scrollTop += section.getBoundingClientRect().top - body.getBoundingClientRect().top - 12
  }, [preview])
  const update = (next: ContractAmendmentTerms) => { setTerms(next); setPreview(null); setCancelBookings(false); setError('') }
  const selectPackage = (id: string) => {
    const next = packages.find(row => row.id === id)
    if (!next) return
    const previous = packages.find(row => row.id === contract.packageId)
    const extensionDays = previous ? Math.max(0, Math.round((Date.parse(contract.endDate) - Date.parse(addMonths(contract.startDate, previous.durationMonths))) / 86400000)) : 0
    const endDate = new Date(Date.parse(addMonths(contract.startDate, next.durationMonths)) + extensionDays * 86400000).toISOString().slice(0, 10)
    update({ packageId: id, totalSessions: next.totalSessions + (contract.carriedOverSessions || 0), totalPrice: next.price, discount: 0, endDate })
  }
  const inspect = async () => {
    if (inFlight.current) return
    inFlight.current = true; setBusy(true); setError('')
    try { setPreview(await onPreview(terms)); setCancelBookings(false) }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Không thể kiểm tra thay đổi.'); setPreview(null) }
    finally { inFlight.current = false; setBusy(false) }
  }
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (inFlight.current) return
    if (!preview && !pending.current) { await inspect(); return }
    if (!pending.current) {
      if (!preview || preview.blockers.length || (preview.affectedBookings.length && !cancelBookings)) return
      pending.current = { action: 'amend', studentId: contract.studentId, contractId: contract.id,
        expectedRevision: preview.revision, contract: structuredClone(terms), reason: reason.trim(),
        snapshotHash: preview.snapshotHash, cancelAffectedBookings: cancelBookings }
    }
    inFlight.current = true; setBusy(true); setError('')
    try { await onConfirm(pending.current) }
    catch (cause) {
      const code = cause && typeof cause === 'object' && 'code' in cause ? String(cause.code) : ''
      const uncertain = /unavailable|deadline-exceeded|internal|resource-exhausted|network/.test(code) || !code
      setRetry(uncertain)
      if (!uncertain) { pending.current = null; setPreview(null) }
      setError(uncertain ? 'Chưa xác định được kết quả. Bấm “Kiểm tra lại yêu cầu” để xác minh cùng thao tác, tránh ghi trùng.' : cause instanceof Error ? cause.message : 'Không thể điều chỉnh hợp đồng.')
    } finally { inFlight.current = false; setBusy(false) }
  }
  const blocked = Boolean(preview?.blockers.length)
  return <dialog ref={dialog} className="contract-amendment" aria-labelledby="amendment-title" onCancel={event => { event.preventDefault(); if (!busy) onClose() }}>
    <form onSubmit={event => void submit(event)}>
      <header><div><h2 id="amendment-title">Điều chỉnh gói tập</h2><p>{contract.packageName} · Đã dùng {preview?.used ?? contract.usedSessions} buổi</p></div><button type="button" aria-label="Đóng điều chỉnh" disabled={busy} onClick={onClose}><X size={22} /></button></header>
      <div className="contract-amendment-body">
        <fieldset disabled={busy || retry}>
          <label>Gói tập<select value={terms.packageId} onChange={event => selectPackage(event.target.value)}>
            {!packages.some(row => row.id === contract.packageId) && <option value={contract.packageId}>{contract.packageName}</option>}
            {packages.filter(row => !row.branchId || row.branchId === contract.branchId).map(row => <option key={row.id} value={row.id}>{row.name}</option>)}
          </select></label>
          <div className="contract-amendment-fields"><label>Tổng số buổi<input type="number" min="1" max="5000" step="1" required value={terms.totalSessions} onChange={event => update({ ...terms, totalSessions: Number(event.target.value) })} /></label><label>Ngày hết hạn<input type="date" required value={terms.endDate} onChange={event => update({ ...terms, endDate: event.target.value })} /></label></div>
          <label>Giá trị sau giảm giá (đ)<input type="number" min="0" step="1" required value={terms.totalPrice - terms.discount} onChange={event => update({ ...terms, totalPrice: Number(event.target.value), discount: 0 })} /></label>
          <p className="contract-amendment-hint">Tổng buổi bao gồm cả buổi đã dùng{contract.carriedOverSessions ? ' và buổi chuyển tiếp' : ''}. Ngày hết hạn tính từ ngày bắt đầu hợp đồng, có giữ thời gian đã gia hạn.</p>
          <label>Lý do điều chỉnh<textarea required minLength={2} maxLength={500} rows={2} value={reason} onChange={event => setReason(event.target.value)} placeholder="Thỏa thuận thay đổi với học viên…" /></label>
        </fieldset>
        {preview && <section ref={comparison} className="contract-amendment-comparison" aria-label="So sánh trước và sau">
          <div className="contract-amendment-columns"><span>Nội dung</span><span>Hiện tại</span><strong>Sau điều chỉnh</strong></div>
          {[
            ['Gói tập', preview.before.packageName, preview.after.packageName],
            ['Tổng số buổi', `${preview.before.totalSessions}`, `${preview.after.totalSessions}`],
            ['Còn được tập', `${preview.before.remainingSessions} buổi`, `${preview.after.remainingSessions} buổi`],
            ['Hết hạn', dateLabel(preview.before.endDate), dateLabel(preview.after.endDate)],
            ['Giá trị', money(preview.before.netValue), money(preview.after.netValue)],
          ].map(([label, before, after]) => <div className="contract-amendment-columns" key={label}><span>{label}</span><span>{before}</span><strong>{after}</strong></div>)}
          <div className="contract-amendment-money"><span>Đã thu <b>{money(preview.cash)}</b></span><span>{preview.after.refundDue > 0 ? 'Cần hoàn' : 'Còn phải thu'} <b>{money(preview.after.refundDue || preview.after.receivable)}</b></span></div>
          <p className="contract-amendment-hint">Giữ {money(preview.recognized)} doanh thu đã ghi nhận. Phần chưa dùng được tính theo thỏa thuận mới.{preview.after.refundDue > 0 ? ' Khoản cần hoàn được xử lý qua phiếu hoàn tiền sau khi điều chỉnh.' : ''}</p>
          {preview.installments.some(row => row.status === 'pending') && <details><summary>Lịch thanh toán sau điều chỉnh</summary>{preview.installments.filter(row => row.status === 'pending').map(row => <p key={row.id}>{dateLabel(row.date)} <strong>{money(row.amount || 0)}</strong></p>)}</details>}
          {preview.affectedBookings.length > 0 && <div className="contract-amendment-warning"><p>{preview.affectedBookings.length} lịch chưa tính phí nằm ngoài thời hạn mới:</p><ul>{preview.affectedBookings.map(row => <li key={row.id}>{dateLabel(row.date)}{row.hour == null ? '' : ` · ${row.hour}h`}</li>)}</ul><label><input type="checkbox" checked={cancelBookings} disabled={busy || retry} onChange={event => setCancelBookings(event.target.checked)} />Hủy các lịch này khi xác nhận điều chỉnh</label></div>}
          {blocked && <div className="contract-amendment-warning" role="alert"><AlertTriangle size={18} /><ul>{preview.blockers.map(message => <li key={message}>{message}</li>)}</ul><button type="button" disabled={busy} onClick={() => void inspect()}>Kiểm tra lại</button></div>}
        </section>}
        {error && <p className="contract-amendment-error" role="alert">{error}</p>}
      </div>
      <footer><button type="button" disabled={busy} onClick={onClose}>Đóng</button><button type="submit" className="contract-amendment-confirm" disabled={busy || (!retry && (blocked || Boolean(preview?.affectedBookings.length && !cancelBookings)))}>{busy ? 'Đang xử lý…' : retry ? 'Kiểm tra lại yêu cầu' : preview ? <><Check size={18} />Xác nhận điều chỉnh</> : <>Xem thay đổi<ArrowRight size={18} /></>}</button></footer>
    </form>
  </dialog>
}
