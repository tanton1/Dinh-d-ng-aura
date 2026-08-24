import { useEffect, useMemo, useState, type FormEvent } from 'react'
import {
  AlertTriangle, ArrowLeft, ArrowRight, BadgeCheck, Check, CheckCircle2,
  CircleDollarSign, FileCheck2, RefreshCw, ShieldCheck, Sparkles, X,
} from 'lucide-react'
import {
  createRenewalQuote,
  getContractRenewalCaseDetail,
  renewPtContract,
  submitRenewalApproval,
  type RenewalPipelineResponse,
  type RenewalPipelineRow,
  type RenewalScope,
} from '../../../services/contractRenewalService'
import type { Student, StudentContract } from '../../../types'

interface ModernProps {
  row: RenewalPipelineRow
  options: RenewalPipelineResponse['options']
  scope: RenewalScope
  onClose: () => void
  onSuccess: () => Promise<void> | void
}
interface LegacyProps { isOpen: boolean; student: Student; latestContract: StudentContract; onClose: () => void }
type Props = ModernProps | LegacyProps

const money = (value: number) => `${new Intl.NumberFormat('vi-VN').format(Math.max(0, value))}đ`

function addMonths(value: string, months: number) {
  if (!value || !months) return ''
  const [year, month, day] = value.split('-').map(Number)
  const targetMonthIndex = month - 1 + months
  const targetYear = year + Math.floor(targetMonthIndex / 12)
  const targetMonth = ((targetMonthIndex % 12) + 12) % 12
  const lastDay = new Date(targetYear, targetMonth + 1, 0).getDate()
  return `${targetYear}-${String(targetMonth + 1).padStart(2, '0')}-${String(Math.min(day, lastDay)).padStart(2, '0')}`
}

function nextDay(value: string) {
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day + 1))
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`
}

function vietnamToday() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
}

export default function RenewContractModal(props: Props) {
  if ('isOpen' in props) {
    if (!props.isOpen) return null
    return <LegacyRenewalRedirect studentName={props.student.name} onClose={props.onClose} />
  }
  return <RenewContractWizard {...props} />
}

function LegacyRenewalRedirect({ studentName, onClose }: { studentName: string; onClose: () => void }) {
  return <div className="renewal-modal-layer" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <section className="renewal-modal renewal-modal--redirect" role="dialog" aria-modal="true" aria-labelledby="renewal-redirect-title">
      <div className="renewal-modal__handle" />
      <header><div><span><ShieldCheck size={15} /> LUỒNG TÁI KÝ AN TOÀN</span><h2 id="renewal-redirect-title">Mở hồ sơ tái ký tập trung</h2><p>{studentName}</p></div><button type="button" onClick={onClose} aria-label="Đóng"><X /></button></header>
      <div className="renewal-redirect-copy"><FileCheck2 /><h3>Không tạo hợp đồng rời khỏi pipeline</h3><p>Hồ sơ cần được đồng bộ vào hàng đợi để kiểm soát báo giá, phê duyệt ưu đãi, khoản thu và lịch sử chăm sóc trong cùng một giao dịch.</p></div>
      <footer><button type="button" onClick={onClose}>Để sau</button><button type="button" className="is-primary" onClick={() => { onClose(); window.location.hash = '#/admin-renewals' }}>Mở trang tái ký <ArrowRight size={17} /></button></footer>
    </section>
  </div>
}

function RenewContractWizard({ row, options, scope, onClose, onSuccess }: ModernProps) {
  const today = vietnamToday()
  const sourceEnded = row.contract.endDate < today || row.risk.sessionsLeft <= 0
  const [step, setStep] = useState(1)
  const [packageId, setPackageId] = useState(row.contract.packageId)
  const [startDate, setStartDate] = useState(sourceEnded ? today : nextDay(row.contract.endDate))
  const [carryOver, setCarryOver] = useState(row.risk.sessionsLeft > 0)
  const [discount, setDiscount] = useState(0)
  const [initialPayment, setInitialPayment] = useState(0)
  const [paymentMethod, setPaymentMethod] = useState('transfer')
  const [cashAccountId, setCashAccountId] = useState('')
  const [installmentCount, setInstallmentCount] = useState(1)
  const [installmentDates, setInstallmentDates] = useState<string[]>([])
  const [note, setNote] = useState('')
  const [approvalReason, setApprovalReason] = useState('Ưu đãi hỗ trợ tái ký theo nhu cầu thực tế của học viên.')
  const [quoteId, setQuoteId] = useState<string | null>(row.quoteId)
  const [approvalId, setApprovalId] = useState<string | null>(row.approvalId)
  const [approvalStatus, setApprovalStatus] = useState<string>('')
  const [caseRevision, setCaseRevision] = useState(row.revision)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [idempotencyKey] = useState(() => crypto.randomUUID())
  const scopeLabel = scope === 'system' ? 'toàn hệ thống' : scope === 'branch' ? 'theo chi nhánh' : 'hồ sơ được giao'

  const packages = useMemo(() => options.packages.filter((item) => !item.branchId || !row.branchId || item.branchId === row.branchId), [options.packages, row.branchId])
  const selectedPackage = packages.find((item) => item.id === packageId) || packages[0]
  const cashAccounts = useMemo(() => options.cashAccounts.filter((item) => !item.branchId || !row.branchId || item.branchId === row.branchId), [options.cashAccounts, row.branchId])
  const carriedSessions = carryOver ? row.risk.sessionsLeft : 0
  const finalPrice = Math.max(0, Number(selectedPackage?.price || 0) - discount)
  const debt = Math.max(0, finalPrice - initialPayment)
  const endDate = addMonths(startDate, Number(selectedPackage?.durationMonths || 0))
  const totalSessions = Number(selectedPackage?.totalSessions || 0) + carriedSessions
  const requiresApproval = Boolean(selectedPackage && ((selectedPackage.price > 0 && discount / selectedPackage.price > .1) || carriedSessions > 3))
  const quoteReady = Boolean(quoteId)
  const approvalReady = !requiresApproval || approvalStatus === 'approved'

  useEffect(() => {
    if (packages.length && !packages.some((item) => item.id === packageId)) setPackageId(packages[0].id)
  }, [packageId, packages])

  useEffect(() => {
    if (cashAccounts.length && !cashAccounts.some((item) => item.id === cashAccountId)) setCashAccountId(cashAccounts[0].id)
  }, [cashAccountId, cashAccounts])

  useEffect(() => {
    if (!debt) { setInstallmentDates([]); return }
    setInstallmentDates((current) => Array.from({ length: installmentCount }, (_, index) => current[index] || addMonths(startDate, index + 1)))
  }, [debt, installmentCount, startDate])

  useEffect(() => {
    if (!row.quoteId && !row.approvalId) return
    let active = true
    void getContractRenewalCaseDetail(row.caseId).then((detail) => {
      if (!active) return
      setQuoteId(detail.quote?.id || null)
      setApprovalId(detail.approval?.id || null)
      setApprovalStatus(String(detail.approval?.status || ''))
      setCaseRevision(detail.case.revision)
    }).catch(() => undefined)
    return () => { active = false }
  }, [row.approvalId, row.caseId, row.quoteId])

  const installments = useMemo(() => {
    if (!debt) return []
    const base = Math.floor(debt / installmentCount)
    const remainder = debt % installmentCount
    return Array.from({ length: installmentCount }, (_, index) => ({ id: `installment-${index + 1}`, date: installmentDates[index] || '', amount: base + (index === 0 ? remainder : 0) }))
  }, [debt, installmentCount, installmentDates])

  const resetCommercialApproval = () => {
    setQuoteId(null)
    setApprovalId(null)
    setApprovalStatus('')
  }

  const validateStep = (targetStep: number) => {
    setError('')
    if (!selectedPackage) return setError('Vui lòng chọn gói tập hợp lệ.'), false
    if (!startDate || startDate < today) return setError('Ngày bắt đầu không được trước hôm nay.'), false
    if (discount < 0 || discount > selectedPackage.price) return setError('Giảm giá không hợp lệ.'), false
    if (targetStep >= 3 && initialPayment > finalPrice) return setError('Thanh toán đầu kỳ vượt thành tiền.'), false
    if (targetStep >= 3 && initialPayment > 0 && !cashAccountId) return setError('Vui lòng chọn tài khoản quỹ nhận tiền.'), false
    if (targetStep >= 4 && installments.some((item) => !item.date || item.date < startDate || item.date > endDate)) return setError('Ngày trả góp phải nằm trong thời hạn hợp đồng.'), false
    return true
  }

  const createQuote = async () => {
    if (!validateStep(2) || !selectedPackage) return
    setSubmitting(true); setError('')
    try {
      const result = await createRenewalQuote({ caseId: row.caseId, packageId: selectedPackage.id, expectedRevision: caseRevision, discount, carryOverSessions: carriedSessions })
      setQuoteId(result.quoteId); setCaseRevision(result.revision); setApprovalId(null); setApprovalStatus('')
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Không thể tạo báo giá.') }
    finally { setSubmitting(false) }
  }

  const requestApproval = async () => {
    if (!quoteId || !approvalReason.trim()) { setError('Cần có báo giá và lý do xin duyệt.'); return }
    setSubmitting(true); setError('')
    try {
      const result = await submitRenewalApproval({ caseId: row.caseId, quoteId, expectedRevision: caseRevision, reason: approvalReason })
      setApprovalId(result.approvalId); setApprovalStatus('pending'); setCaseRevision(result.revision)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Không thể gửi phê duyệt.') }
    finally { setSubmitting(false) }
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!validateStep(4) || !selectedPackage) return
    if (!quoteReady) { setError('Hãy tạo báo giá trước khi xác nhận tái ký.'); setStep(2); return }
    if (!approvalReady) { setError('Ưu đãi đang chờ quản lý phê duyệt.'); setStep(2); return }
    setSubmitting(true); setError('')
    try {
      await renewPtContract({
        caseId: row.caseId, sourceContractId: row.sourceContractId, packageId: selectedPackage.id,
        quoteId: quoteId || undefined, approvalId: approvalId || undefined, startDate,
        expectedSourceRevision: row.contract.revision, expectedCaseRevision: caseRevision, idempotencyKey,
        carryOver, discount, initialPayment, paymentMethod: initialPayment ? paymentMethod : undefined,
        cashAccountId: initialPayment ? cashAccountId : undefined, installments,
        trainerIds: row.contract.trainerIds.length ? row.contract.trainerIds : row.contract.trainerId ? [row.contract.trainerId] : [],
        nutritionPTIds: row.contract.nutritionPTIds, note,
      })
      await onSuccess()
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Không thể hoàn tất tái ký.') }
    finally { setSubmitting(false) }
  }

  const nextStep = () => { if (validateStep(step + 1)) setStep((current) => Math.min(4, current + 1)) }

  return <div className="renewal-modal-layer" onMouseDown={(event) => event.target === event.currentTarget && !submitting && onClose()}>
    <section className="renewal-modal renewal-modal--wizard" role="dialog" aria-modal="true" aria-labelledby="renewal-modal-title">
      <div className="renewal-modal__handle" />
      <header><div><span><Sparkles size={15} /> AURA RENEWAL · {scopeLabel.toLocaleUpperCase('vi')}</span><h2 id="renewal-modal-title">Tạo hợp đồng tiếp theo</h2><p>{row.student.name} · {row.contract.packageName}</p></div><button type="button" onClick={onClose} disabled={submitting} aria-label="Đóng"><X /></button></header>
      <nav className="renewal-wizard-steps" aria-label="Các bước tái ký">
        {['Lộ trình', 'Báo giá', 'Thanh toán', 'Xác nhận'].map((label, index) => <button key={label} type="button" className={step === index + 1 ? 'is-active' : step > index + 1 ? 'is-complete' : ''} onClick={() => index + 1 < step && setStep(index + 1)}><i>{step > index + 1 ? <Check size={14} /> : index + 1}</i><span>{label}</span></button>)}
      </nav>
      <form id="renewal-contract-form" onSubmit={submit}>
        <div className="renewal-source-card"><div><span>Hợp đồng hiện tại</span><strong>{row.contract.packageName}</strong><small>Hết hạn {formatDate(row.contract.endDate)}</small></div><div><span>Trạng thái sử dụng</span><strong>{row.risk.sessionsLeft} buổi còn lại</strong><small>{row.risk.daysLeft < 0 ? `Quá ${Math.abs(row.risk.daysLeft)} ngày` : `Còn ${row.risk.daysLeft} ngày`}</small></div></div>

        {step === 1 && <section className="renewal-form-section renewal-step-panel"><div className="renewal-section-title"><span>01</span><div><h3>Lộ trình tiếp theo</h3><p>Chọn gói, thời điểm hiệu lực và số buổi chuyển tiếp.</p></div></div><div className="renewal-form-grid">
          <label className="is-wide">Gói tập<select required value={packageId} onChange={(event) => { setPackageId(event.target.value); resetCommercialApproval() }}><option value="">Chọn gói tập</option>{packages.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.totalSessions} buổi · {money(item.price)}</option>)}</select></label>
          <label>Ngày bắt đầu<input type="date" required min={today} value={startDate} onChange={(event) => setStartDate(event.target.value)} /></label>
          <label>Ngày kết thúc<input value={endDate ? formatDate(endDate) : '—'} readOnly /></label>
          {row.risk.sessionsLeft > 0 && <label className="renewal-switch is-wide"><input type="checkbox" checked={carryOver} onChange={(event) => { setCarryOver(event.target.checked); resetCommercialApproval() }} /><span><CheckCircle2 /> Chuyển {row.risk.sessionsLeft} buổi chưa dùng sang hợp đồng mới</span></label>}
        </div><div className="renewal-preview"><span>Tổng quyền lợi</span><strong>{totalSessions} buổi</strong><small>{selectedPackage?.durationMonths || 0} tháng · PT phụ trách được giữ nguyên</small></div></section>}

        {step === 2 && <section className="renewal-form-section renewal-step-panel"><div className="renewal-section-title"><span>02</span><div><h3>Báo giá & phê duyệt</h3><p>Ưu đãi trên 10% hoặc chuyển hơn 3 buổi phải được quản lý duyệt.</p></div></div><div className="renewal-form-grid"><label>Giá niêm yết<input value={money(selectedPackage?.price || 0)} readOnly /></label><label>Giảm giá<input type="number" min="0" max={selectedPackage?.price || 0} value={discount} onChange={(event) => { setDiscount(Math.max(0, Number(event.target.value) || 0)); resetCommercialApproval() }} /></label></div>
          <div className="renewal-money-summary"><div><span>Thành tiền</span><strong>{money(finalPrice)}</strong></div><div><span>Mức giảm</span><strong>{selectedPackage?.price ? `${Math.round(discount / selectedPackage.price * 100)}%` : '0%'}</strong></div></div>
          <div className={`renewal-approval-state ${quoteId ? 'is-approved' : ''}`}><FileCheck2 /><div><strong>{quoteId ? 'Báo giá đã tạo' : 'Chưa tạo báo giá'}</strong><span>{requiresApproval ? 'Trường hợp này cần thêm một người quản lý phê duyệt.' : 'Báo giá nằm trong chính sách thông thường.'}</span></div><button type="button" disabled={submitting || Boolean(quoteId)} onClick={() => void createQuote()}>{quoteId ? 'Đã tạo' : 'Tạo báo giá'}</button></div>
          {requiresApproval && quoteId && <div className="renewal-approval-box"><label>Lý do xin duyệt<textarea value={approvalReason} onChange={(event) => setApprovalReason(event.target.value)} maxLength={500} /></label><button type="button" disabled={submitting || Boolean(approvalId)} onClick={() => void requestApproval()}>{approvalStatus === 'approved' ? 'Đã duyệt' : approvalStatus === 'pending' ? 'Đang chờ duyệt' : 'Gửi quản lý duyệt'}</button>{approvalStatus === 'pending' && <small>Người tạo báo giá không thể tự duyệt; cần một Quản lý chi nhánh hoặc Admin khác.</small>}</div>}
        </section>}

        {step === 3 && <section className="renewal-form-section renewal-step-panel"><div className="renewal-section-title"><span>03</span><div><h3>Thu tiền & công nợ</h3><p>Khoản thu đầu kỳ được ghi đồng thời vào ledger và sổ quỹ.</p></div></div><div className="renewal-form-grid">
          <label>Thu ngay<input type="number" min="0" max={finalPrice} value={initialPayment} onChange={(event) => setInitialPayment(Math.max(0, Number(event.target.value) || 0))} /></label>
          <label>Phương thức<select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)} disabled={!initialPayment}><option value="transfer">Chuyển khoản</option><option value="cash">Tiền mặt</option><option value="card">Thẻ</option></select></label>
          {initialPayment > 0 && <label className="is-wide">Tài khoản quỹ<select required value={cashAccountId} onChange={(event) => setCashAccountId(event.target.value)}><option value="">Chọn quỹ nhận tiền</option>{cashAccounts.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
        </div><div className="renewal-money-summary"><div><span>Đã thu đầu kỳ</span><strong>{money(initialPayment)}</strong></div><div><span>Còn phải thu</span><strong>{money(debt)}</strong></div></div>
          {debt > 0 && <><label className="renewal-count">Số kỳ trả góp<select value={installmentCount} onChange={(event) => setInstallmentCount(Number(event.target.value))}>{[1, 2, 3, 4, 5, 6].map((value) => <option key={value} value={value}>{value} kỳ</option>)}</select></label><div className="renewal-installments">{installments.map((item, index) => <label key={item.id}><span>Kỳ {index + 1} · {money(item.amount)}</span><input type="date" required min={startDate} max={endDate} value={item.date} onChange={(event) => setInstallmentDates((current) => current.map((date, itemIndex) => itemIndex === index ? event.target.value : date))} /></label>)}</div></>}
        </section>}

        {step === 4 && <section className="renewal-form-section renewal-step-panel"><div className="renewal-section-title"><span>04</span><div><h3>Kiểm tra & xác nhận</h3><p>Một lần xác nhận tạo hợp đồng, thu tiền và đóng hồ sơ pipeline.</p></div></div><div className="renewal-review-grid">
          <article><Sparkles /><span>Lộ trình</span><strong>{selectedPackage?.name || '—'}</strong><small>{totalSessions} buổi · {formatDate(startDate)} – {formatDate(endDate)}</small></article>
          <article><CircleDollarSign /><span>Giá trị</span><strong>{money(finalPrice)}</strong><small>Thu ngay {money(initialPayment)} · còn {money(debt)}</small></article>
          <article><BadgeCheck /><span>Kiểm soát</span><strong>{requiresApproval ? approvalStatus === 'approved' ? 'Đủ điều kiện' : 'Chờ phê duyệt' : quoteId ? 'Trong chính sách' : 'Chưa có báo giá'}</strong><small>{quoteId ? `Báo giá ${quoteId.slice(0, 8)}` : 'Chưa có báo giá'}</small></article>
        </div><label>Ghi chú giao dịch<textarea value={note} onChange={(event) => setNote(event.target.value)} maxLength={500} placeholder="Thỏa thuận, ưu đãi hoặc lưu ý khi tái ký…" /></label><div className="renewal-atomic-note"><ShieldCheck /><p><strong>Giao dịch nguyên tử</strong><span>Nếu hợp đồng, báo giá, phê duyệt, ledger hoặc sổ quỹ có một bước lỗi, toàn bộ thao tác sẽ không được lưu.</span></p></div></section>}

        {error && <div className="renewal-modal-error" role="alert"><AlertTriangle />{error}</div>}
      </form>
      <footer><button type="button" onClick={() => step === 1 ? onClose() : setStep((current) => current - 1)} disabled={submitting}>{step === 1 ? 'Hủy' : <><ArrowLeft size={16} /> Quay lại</>}</button>{step < 4 ? <button type="button" className="is-primary" onClick={nextStep} disabled={submitting}>Tiếp tục <ArrowRight size={17} /></button> : <button type="submit" form="renewal-contract-form" className="is-primary" disabled={submitting || !selectedPackage || !quoteReady || !approvalReady}>{submitting ? 'Đang tái ký…' : 'Xác nhận tái ký'}<RefreshCw size={17} className={submitting ? 'is-spinning' : ''} /></button>}</footer>
    </section>
  </div>
}

function formatDate(value: string) {
  const date = new Date(`${value}T00:00:00`)
  return value && !Number.isNaN(date.getTime()) ? date.toLocaleDateString('vi-VN') : '—'
}
