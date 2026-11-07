import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import qrcode from 'qrcode-generator'
import { AlertCircle, Check, CheckCircle2, Clock3, Copy, Download, Hourglass, LoaderCircle, RefreshCw, Store, X } from 'lucide-react'
import {
  demoInstallmentPayment,
  getMyInstallmentPayment,
  installmentPaymentErrorMessage,
  submitMyInstallmentPaymentClaim,
  type InstallmentPaymentView,
} from '../../services/installmentPaymentService'
import type { StudentPtContractSummary } from '../../services/studentPtScheduleService'
import './InstallmentPaymentSheet.css'

interface Props {
  contractId: string
  installmentId: string | null
  todayKey: string
  isDemo?: boolean
  demoContract?: StudentPtContractSummary
  onClose: () => void
  onChanged?: (message: string) => void
}

type Tone = 'info' | 'warning' | 'danger' | 'success'

function money(value: number) {
  return `${Math.round(value).toLocaleString('vi-VN')}đ`
}

function day(key: string | null) {
  if (!key) return ''
  const [year, month, date] = key.split('-')
  return `${date}/${month}/${year}`
}

function moment(value: string | null) {
  if (!value) return ''
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? '' : new Intl.DateTimeFormat('vi-VN', { timeStyle: 'short', dateStyle: 'short', timeZone: 'Asia/Ho_Chi_Minh' }).format(parsed)
}

function dueBadge(view: InstallmentPaymentView): { tone: Tone; label: string } {
  if (view.state === 'paid') return { tone: 'success', label: 'Đã thanh toán' }
  const days = view.installment?.daysUntilDue
  if (days === null || days === undefined) return { tone: 'info', label: 'Chờ thanh toán' }
  if (days > 0) return { tone: 'info', label: `Còn ${days} ngày` }
  if (days === 0) return { tone: 'warning', label: 'Đến hạn hôm nay' }
  return { tone: 'danger', label: `Quá hạn ${Math.abs(days)} ngày` }
}

function buildQr(payload: string) {
  const qr = qrcode(0, 'M')
  qr.addData(payload, 'Byte')
  qr.make()
  const count = qr.getModuleCount()
  let path = ''
  for (let row = 0; row < count; row += 1) {
    for (let column = 0; column < count; column += 1) {
      if (qr.isDark(row, column)) path += `M${column + 4} ${row + 4}h1v1h-1z`
    }
  }
  return { qr, count, size: count + 8, path }
}

function saveQrImage(qr: ReturnType<typeof qrcode>, view: InstallmentPaymentView) {
  const transfer = view.transfer
  if (!transfer || !view.installment) return
  const count = qr.getModuleCount()
  const cell = 8
  const quiet = cell * 4
  const width = count * cell + quiet * 2
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = width + 104
  const context = canvas.getContext('2d')
  if (!context) return
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.fillStyle = '#19161a'
  for (let row = 0; row < count; row += 1) {
    for (let column = 0; column < count; column += 1) {
      if (qr.isDark(row, column)) context.fillRect(quiet + column * cell, quiet + row * cell, cell, cell)
    }
  }
  context.textAlign = 'center'
  context.font = '700 22px system-ui, sans-serif'
  context.fillText(money(view.installment.amount), width / 2, width + 22)
  context.font = '15px system-ui, sans-serif'
  context.fillText(`${transfer.bankName} · ${transfer.accountNumber}`, width / 2, width + 52)
  context.fillText(`Nội dung: ${transfer.content}`, width / 2, width + 80)
  canvas.toBlob((blob) => {
    if (!blob) return
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `aura-thanh-toan-${transfer.content.replace(/\s+/g, '-').toLowerCase()}.png`
    document.body.appendChild(link)
    link.click()
    link.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 2000)
  }, 'image/png')
}

async function copyText(value: string) {
  try {
    await navigator.clipboard.writeText(value)
    return true
  } catch {
    const field = document.createElement('textarea')
    field.value = value
    field.setAttribute('readonly', '')
    field.style.position = 'fixed'
    field.style.opacity = '0'
    document.body.appendChild(field)
    field.select()
    const copied = document.execCommand('copy')
    field.remove()
    return copied
  }
}

export default function InstallmentPaymentSheet({ contractId, installmentId, todayKey, isDemo = false, demoContract, onClose, onChanged }: Props) {
  const [view, setView] = useState<InstallmentPaymentView | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [note, setNote] = useState('')
  const [copied, setCopied] = useState('')
  const sequence = useRef(0)
  const sheetRef = useRef<HTMLElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  const load = useCallback(async () => {
    const current = ++sequence.current
    setLoading(true)
    setError('')
    try {
      let next: InstallmentPaymentView
      if (isDemo) {
        if (!demoContract) throw new Error('Không tìm thấy hợp đồng demo.')
        next = demoInstallmentPayment(demoContract, demoContract.installments.find((item) => item.id === installmentId) ?? null, todayKey)
      } else {
        next = await getMyInstallmentPayment(contractId, installmentId)
      }
      if (current === sequence.current) setView(next)
    } catch (cause) {
      if (current === sequence.current) setError(installmentPaymentErrorMessage(cause))
    } finally {
      if (current === sequence.current) setLoading(false)
    }
  }, [contractId, demoContract, installmentId, isDemo, todayKey])

  useEffect(() => {
    void load()
    return () => { sequence.current += 1 }
  }, [load])

  // Sheet contract from the design system: Escape closes, focus is trapped
  // inside and restored on close, and the page behind does not scroll.
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    closeRef.current?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onCloseRef.current(); return }
      if (event.key !== 'Tab' || !sheetRef.current) return
      const focusable = [...sheetRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), textarea, a[href]')]
      if (!focusable.length) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = overflow
      window.removeEventListener('keydown', onKey)
      previous?.focus?.()
    }
  }, [])

  const qr = useMemo(() => view?.transfer?.qrPayload ? buildQr(view.transfer.qrPayload) : null, [view?.transfer?.qrPayload])

  const copy = async (key: string, value: string) => {
    if (await copyText(value)) {
      setCopied(key)
      window.setTimeout(() => setCopied((current) => current === key ? '' : current), 1800)
    }
  }

  const report = async (action: 'submit' | 'withdraw') => {
    if (!view?.installment || busy) return
    setBusy(true)
    setError('')
    try {
      if (isDemo) {
        if (demoContract) setView(demoInstallmentPayment(demoContract, demoContract.installments.find((item) => item.id === installmentId) ?? null, todayKey, action === 'submit'))
      } else {
        const result = await submitMyInstallmentPaymentClaim({ contractId, installmentId, action, expectedAmount: view.installment.amount, note: note.trim() || undefined })
        setView((current) => current ? { ...current, state: result.state, claim: result.claim } : current)
      }
      setConfirming(false)
      onChanged?.(action === 'submit' ? 'Đã báo Aura. Bạn sẽ nhận thông báo khi khoản thanh toán được ghi nhận.' : 'Đã hủy báo chuyển khoản.')
    } catch (cause) {
      setError(installmentPaymentErrorMessage(cause))
      if ((cause as { details?: { reason?: string } })?.details?.reason === 'amount-changed') void load()
    } finally {
      setBusy(false)
    }
  }

  const badge = view ? dueBadge(view) : null
  const installment = view?.installment
  const title = installment?.sequence && installment.count ? `Thanh toán kỳ ${installment.sequence}/${installment.count}` : 'Thanh toán công nợ'
  const progress = view && view.contract.totalAmount > 0 ? Math.min(100, Math.round(view.contract.paidAmount / view.contract.totalAmount * 100)) : 0
  const transfer = view?.transfer

  return (
    <div className="aura-pay" role="dialog" aria-modal="true" aria-labelledby="aura-pay-title">
      <button type="button" className="aura-pay__backdrop" aria-label="Đóng thanh toán" tabIndex={-1} onClick={onClose} />
      <section className="aura-pay__sheet" ref={sheetRef}>
        <header className="aura-pay__header">
          <div><small>Aura · Thanh toán</small><h2 id="aura-pay-title">{title}</h2></div>
          <button type="button" ref={closeRef} className="aura-pay__close" aria-label="Đóng thanh toán" onClick={onClose}><X size={18} /></button>
        </header>

        {loading && !view && <div className="aura-pay__loading" role="status"><LoaderCircle size={20} className="aura-pay__spin" /> Đang tải thông tin thanh toán…</div>}
        {error && <div className="aura-pay__alert is-danger" role="alert"><AlertCircle size={18} /><span>{error}</span>{!view && <button type="button" onClick={() => void load()}><RefreshCw size={14} /> Thử lại</button>}</div>}

        {view && badge && <>
          <div className={`aura-pay__hero is-${badge.tone}`}>
            <span className="aura-pay__badge">{badge.tone === 'success' ? <CheckCircle2 size={14} /> : <Clock3 size={14} />} {badge.label}</span>
            <strong className="aura-pay__amount">{money(installment?.amount ?? view.contract.outstandingAmount)}</strong>
            <span>{view.contract.packageName}{installment?.dueDate ? ` · hạn ${day(installment.dueDate)}` : ''}</span>
          </div>

          <div className="aura-pay__progress" aria-label={`Đã trả ${progress}% giá trị hợp đồng`}>
            <div><span>Đã trả {money(view.contract.paidAmount)}</span><span>Tổng {money(view.contract.totalAmount)}</span></div>
            <i><b style={{ width: `${progress}%` }} /></i>
          </div>

          {view.state === 'paid' && <div className="aura-pay__result is-success">
            <CheckCircle2 size={22} />
            <div><strong>Kỳ này đã được ghi nhận</strong><p>{view.claim?.receiptVoucherNumber ? `Phiếu thu ${view.claim.receiptVoucherNumber}. ` : ''}Cảm ơn bạn đã thanh toán đúng cam kết với Aura.</p></div>
          </div>}

          {view.state === 'unavailable' && <div className="aura-pay__alert is-info" role="status"><AlertCircle size={18} /><span>{view.message} Bạn có thể liên hệ lễ tân Aura để được hỗ trợ.</span></div>}

          {view.state === 'submitted' && <div className="aura-pay__result is-pending">
            <Hourglass size={22} />
            <div>
              <strong>Đang chờ Aura xác nhận</strong>
              <p>Bạn đã báo chuyển khoản{view.claim?.submittedAt ? ` lúc ${moment(view.claim.submittedAt)}` : ''}. Kế toán sẽ khớp giao dịch và gửi thông báo cho bạn khi ghi nhận xong.</p>
              {view.claim?.note && <p className="aura-pay__note">Ghi chú: {view.claim.note}</p>}
              <button type="button" className="aura-pay__link" disabled={busy} onClick={() => void report('withdraw')}>Tôi chưa chuyển, hủy báo</button>
            </div>
          </div>}

          {(view.state === 'open' || view.state === 'rejected') && <>
            {view.state === 'rejected' && <div className="aura-pay__alert is-warning" role="status"><AlertCircle size={18} /><span><b>Aura chưa xác nhận được lần chuyển trước.</b> {view.claim?.rejectedReason}</span></div>}
            {transfer && qr ? <div className="aura-pay__qr-card">
              <svg className="aura-pay__qr" viewBox={`0 0 ${qr.size} ${qr.size}`} role="img" aria-label={`Mã VietQR chuyển ${money(installment?.amount ?? 0)} tới ${transfer.bankName}`} shapeRendering="crispEdges">
                <rect width={qr.size} height={qr.size} fill="#ffffff" />
                <path d={qr.path} fill="currentColor" />
              </svg>
              <p className="aura-pay__qr-hint">Quét bằng ứng dụng ngân hàng bất kỳ. Số tiền và nội dung đã điền sẵn.</p>
              <dl className="aura-pay__details">
                <div><dt>Ngân hàng</dt><dd>{transfer.bankName}</dd></div>
                <div><dt>Số tài khoản</dt><dd><span>{transfer.accountNumber}</span><button type="button" onClick={() => void copy('account', transfer.accountNumber)} aria-label="Chép số tài khoản">{copied === 'account' ? <Check size={15} /> : <Copy size={15} />}</button></dd></div>
                <div><dt>Chủ tài khoản</dt><dd>{transfer.accountName}</dd></div>
                <div><dt>Số tiền</dt><dd><span>{money(installment?.amount ?? 0)}</span><button type="button" onClick={() => void copy('amount', String(installment?.amount ?? ''))} aria-label="Chép số tiền">{copied === 'amount' ? <Check size={15} /> : <Copy size={15} />}</button></dd></div>
                <div className="is-key"><dt>Nội dung</dt><dd><span>{transfer.content}</span><button type="button" onClick={() => void copy('content', transfer.content)} aria-label="Chép nội dung chuyển khoản">{copied === 'content' ? <Check size={15} /> : <Copy size={15} />}</button></dd></div>
              </dl>
              <p className="aura-pay__keep">Giữ nguyên nội dung <b>{transfer.content}</b> để Aura khớp đúng kỳ của bạn.</p>
            </div> : <div className="aura-pay__alert is-info" role="status"><Store size={18} /><span>Chi nhánh của bạn chưa bật nhận chuyển khoản qua app. Bạn có thể thanh toán tại quầy lễ tân Aura.</span></div>}

            {confirming ? <div className="aura-pay__confirm">
              <label><span>Ghi chú cho kế toán (không bắt buộc)</span><textarea maxLength={300} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Tên tài khoản chuyển, giờ chuyển…" /></label>
              <div className="aura-pay__actions">
                <button type="button" className="aura-pay__secondary" disabled={busy} onClick={() => setConfirming(false)}>Quay lại</button>
                <button type="button" className="aura-pay__primary" disabled={busy} onClick={() => void report('submit')}>{busy ? 'Đang gửi…' : 'Xác nhận đã chuyển'}</button>
              </div>
            </div> : <div className="aura-pay__actions">
              {transfer && qr && <button type="button" className="aura-pay__secondary" onClick={() => saveQrImage(qr.qr, view)}><Download size={16} /> Lưu mã QR</button>}
              <button type="button" className="aura-pay__primary" onClick={() => setConfirming(true)}>Tôi đã chuyển khoản</button>
            </div>}
          </>}

          {view.state !== 'paid' && view.state !== 'unavailable' && <p className="aura-pay__counter"><Store size={15} /><span>Trả tại quầy: {transfer ? <>đọc mã <b>{transfer.content}</b> cho lễ tân để ghi nhận đúng kỳ.</> : 'báo lễ tân tên gói tập và kỳ bạn muốn thanh toán.'}</span></p>}
          {view.state === 'paid' && <div className="aura-pay__actions"><button type="button" className="aura-pay__primary" onClick={onClose}>Xong</button></div>}
        </>}
      </section>
    </div>
  )
}
