import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertCircle, Check, Copy, Hourglass, RefreshCw } from 'lucide-react'
import {
  installmentPaymentErrorMessage,
  listInstallmentPaymentClaims,
  rejectInstallmentPaymentClaim,
  type InstallmentClaimRow,
} from '../../../services/installmentPaymentService'
import './InstallmentClaimQueue.css'

interface Props {
  /** Same scope as the receivables list: 'all', 'none' or a branch id. */
  branchId: string
  /** Bumped by the parent after a payment is posted, so confirmed claims leave. */
  refreshKey: number
  onCollect: (claim: InstallmentClaimRow) => void
}

function money(value: number) {
  return `${value.toLocaleString('vi-VN')}đ`
}

function day(key: string | null) {
  if (!key) return ''
  const [year, month, date] = key.split('-')
  return `${date}/${month}/${year}`
}

function moment(value: string | null) {
  if (!value) return ''
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? '' : new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Ho_Chi_Minh' }).format(parsed)
}

export default function InstallmentClaimQueue({ branchId, refreshKey, onCollect }: Props) {
  const [claims, setClaims] = useState<InstallmentClaimRow[]>([])
  const [total, setTotal] = useState<number | null>(null)
  const [cursor, setCursor] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [rejecting, setRejecting] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState('')
  const sequence = useRef(0)

  const load = useCallback(async (append = false, after: string | null = null) => {
    const current = ++sequence.current
    setLoading(true)
    setError('')
    try {
      const page = await listInstallmentPaymentClaims({ branchId: branchId === 'all' ? undefined : branchId, cursor: append ? after : null })
      if (current !== sequence.current) return
      setClaims((existing) => append ? [...new Map([...existing, ...page.claims].map((item) => [item.id, item])).values()] : page.claims)
      if (page.total !== null) setTotal(page.total)
      setCursor(page.nextCursor)
      setHasMore(page.hasMore)
    } catch (cause) {
      if (current === sequence.current) setError(installmentPaymentErrorMessage(cause))
    } finally {
      if (current === sequence.current) setLoading(false)
    }
  }, [branchId])

  useEffect(() => {
    void load(false)
    return () => { sequence.current += 1 }
  }, [load, refreshKey])

  const reject = async (claim: InstallmentClaimRow) => {
    if (busy) return
    if (reason.trim().length < 3) { setError('Hãy ghi lý do để học viên biết cần làm gì tiếp theo.'); return }
    setBusy(true)
    setError('')
    try {
      await rejectInstallmentPaymentClaim({ claimId: claim.id, reason: reason.trim(), expectedRevision: claim.revision })
      setRejecting(null)
      setReason('')
      await load(false)
    } catch (cause) {
      setError(installmentPaymentErrorMessage(cause))
    } finally {
      setBusy(false)
    }
  }

  const copy = async (claim: InstallmentClaimRow) => {
    try {
      await navigator.clipboard.writeText(claim.transferContent || claim.transferCode)
      setCopied(claim.id)
      window.setTimeout(() => setCopied((value) => value === claim.id ? '' : value), 1500)
    } catch { /* Clipboard is optional; the code stays visible. */ }
  }

  // Always visible, so finance can find where transfer reports arrive even
  // before the first one; the empty state stays a single compact row.
  const empty = !loading && !error && claims.length === 0

  return (
    <section className={`installment-claims${empty ? ' is-empty' : ''}`} aria-labelledby="installment-claims-title">
      <div className="finance-management__section-head">
        <h2 id="installment-claims-title"><Hourglass size={17} /> Chờ xác nhận chuyển khoản</h2>
        <div className="installment-claims__head-tools">
          <strong aria-live="polite">{loading && !claims.length ? 'Đang tải…' : `${(total ?? claims.length).toLocaleString('vi-VN')} báo`}</strong>
          <button type="button" onClick={() => void load(false)} disabled={loading} aria-label="Làm mới danh sách chờ xác nhận"><RefreshCw size={15} className={loading ? 'animate-spin' : ''} /></button>
        </div>
      </div>
      <p className="installment-claims__hint">{empty
        ? 'Chưa có học viên nào báo chuyển khoản. Khi học viên bấm "Tôi đã chuyển khoản" trên trang thanh toán, báo sẽ hiện ở đây để bạn đối chiếu sao kê và ghi nhận. Tài khoản nhận VietQR cấu hình ở Sổ quỹ → VietQR.'
        : 'Học viên đã bấm "Tôi đã chuyển khoản". Tìm giao dịch trong sao kê theo nội dung chuyển khoản, rồi ghi nhận để phiếu thu và lịch trả góp tự cập nhật.'}</p>
      {error && <p role="alert" className="finance-management__notice"><AlertCircle size={14} /> {error}</p>}
      <div className="installment-claims__list">
        {claims.map((claim) => <article key={claim.id} className={claim.actionable ? '' : 'is-stale'}>
          <div className="installment-claims__row">
            <div className="installment-claims__main">
              <h3><a href={`#/student-360?studentId=${encodeURIComponent(claim.studentId)}&source=admin-pt-students`}>{claim.studentName || `Học viên ${claim.studentId}`}</a></h3>
              <p>{claim.packageName}{claim.sequence && claim.installmentCount ? ` · Kỳ ${claim.sequence}/${claim.installmentCount}` : ''}{claim.dueDate ? ` · hạn ${day(claim.dueDate)}` : ''}{claim.studentPhone ? ` · ${claim.studentPhone}` : ''}</p>
              <p className="installment-claims__code">
                <span>Nội dung</span><b>{claim.transferContent || claim.transferCode}</b>
                <button type="button" onClick={() => void copy(claim)} aria-label={`Chép nội dung ${claim.transferContent || claim.transferCode}`}>{copied === claim.id ? <Check size={13} /> : <Copy size={13} />}</button>
              </p>
              {claim.note && <p className="installment-claims__note">"{claim.note}"</p>}
              {claim.proofUrl
                ? <a className="installment-claims__proof" href={claim.proofUrl} target="_blank" rel="noopener noreferrer" aria-label={`Xem ảnh biên lai của ${claim.studentName}`}>
                    <img src={claim.proofUrl} alt="" loading="lazy" />
                    <span><b>Ảnh biên lai</b><small>{claim.proofUploadedAt ? `Gửi lúc ${moment(claim.proofUploadedAt)}` : 'Bấm để xem lớn'}</small></span>
                  </a>
                : <p className="installment-claims__no-proof">{claim.proofUploadedAt ? 'Có ảnh biên lai nhưng chưa tạo được link xem. Bấm làm mới.' : 'Chưa có ảnh biên lai.'}</p>}
              {!claim.actionable && <p className="installment-claims__stale"><AlertCircle size={13} /> {claim.staleReason}</p>}
            </div>
            <div className="installment-claims__side">
              <b>{money(claim.amount)}</b>
              {claim.installmentAmount > 0 && claim.installmentAmount !== claim.amount && <small className="installment-claims__partial">{claim.amount < claim.installmentAmount ? 'Trả một phần' : 'Trả thêm'} · kỳ {money(claim.installmentAmount)}</small>}
              <small>Báo lúc {moment(claim.submittedAt)}</small>
              <div className="installment-claims__actions">
                {claim.actionable && claim.contract && <button type="button" className="finance-management__collect-button" onClick={() => onCollect(claim)} aria-label={`Ghi nhận ${money(claim.amount)} của ${claim.studentName}`}>Ghi nhận</button>}
                <button type="button" className="installment-claims__reject" onClick={() => { setRejecting(rejecting === claim.id ? null : claim.id); setReason(claim.actionable ? '' : 'Kỳ này không còn chờ thu.') }}>{claim.actionable ? 'Từ chối' : 'Đóng'}</button>
              </div>
            </div>
          </div>
          {rejecting === claim.id && <div className="installment-claims__reject-form">
            <label>
              <span>Lý do gửi cho học viên</span>
              <textarea maxLength={300} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Chưa thấy giao dịch trong sao kê ngày 07/11. Bạn gửi giúp ảnh biên lai qua Zalo Aura." />
            </label>
            <div>
              <button type="button" onClick={() => { setRejecting(null); setReason('') }} disabled={busy}>Hủy</button>
              <button type="button" className="is-danger" onClick={() => void reject(claim)} disabled={busy}>{busy ? 'Đang gửi…' : 'Gửi và từ chối'}</button>
            </div>
          </div>}
        </article>)}
      </div>
      {hasMore && <button type="button" className="finance-management__load-more" disabled={loading} onClick={() => void load(true, cursor)}>{loading ? 'Đang tải…' : 'Tải thêm'}</button>}
    </section>
  )
}
