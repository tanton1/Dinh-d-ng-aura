import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { AlertTriangle, CheckCircle2, RefreshCw, ShieldCheck, X } from 'lucide-react'
import { renewPtContract, type RenewalPackageOption, type RenewalPipelineRow } from '../../../services/contractRenewalService'
import type { Student, StudentContract } from '../../../types'
import { useDatabase } from '../../../contexts/DatabaseContext'

interface ModernProps {
  row: RenewalPipelineRow
  packages: RenewalPackageOption[]
  onClose: () => void
  onSuccess: () => Promise<void> | void
}
interface LegacyProps { isOpen: boolean; student: Student; latestContract: StudentContract; onClose: () => void }
type Props = ModernProps | LegacyProps

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

const money = (value: number) => `${new Intl.NumberFormat('vi-VN').format(Math.max(0, value))}đ`

export default function RenewContractModal(props: Props) {
  const { packages: legacyPackages } = useDatabase()
  if ('isOpen' in props && !props.isOpen) return null
  if ('row' in props) return <RenewContractDialog {...props} />
  const remaining = Math.max(0, props.latestContract.totalSessions - props.latestContract.usedSessions)
  const todayOrdinal = Math.floor(new Date().setHours(0, 0, 0, 0) / 86_400_000)
  const endOrdinal = Math.floor(new Date(`${props.latestContract.endDate}T00:00:00`).getTime() / 86_400_000)
  const daysLeft = endOrdinal - todayOrdinal
  const row: RenewalPipelineRow = {
    caseId: props.latestContract.id,
    student: { id: props.student.id, name: props.student.name, phone: props.student.phone || '', email: props.student.email || '' },
    contract: {
      id: props.latestContract.id, packageId: props.latestContract.packageId, packageName: props.latestContract.packageName,
      startDate: props.latestContract.startDate, endDate: props.latestContract.endDate,
      status: props.latestContract.status === 'cancelled' ? 'expired' : props.latestContract.status,
      totalSessions: props.latestContract.totalSessions, usedSessions: props.latestContract.usedSessions,
      totalPrice: props.latestContract.totalPrice, paidAmount: props.latestContract.paidAmount,
      discount: props.latestContract.discount || 0, branchId: props.latestContract.branchId || '',
      trainerId: props.latestContract.trainerId || '', trainerIds: props.latestContract.trainerIds || [],
      nutritionPTIds: props.latestContract.nutritionPTIds || [], revision: props.latestContract.revision || 0,
    },
    branchName: '', risk: { category: remaining <= 0 ? 'exhausted' : daysLeft < 0 ? 'expired' : daysLeft <= 7 || remaining <= 1 ? 'critical' : daysLeft <= 30 || remaining <= 3 ? 'upcoming' : 'early', daysLeft, sessionsLeft: remaining },
    expectedValue: props.latestContract.totalPrice, stage: 'uncontacted', caseRevision: 0,
    nextFollowUpAt: null, lastContactAt: null, note: '', renewedContractId: null,
  }
  return <RenewContractDialog row={row} packages={legacyPackages.map((item) => ({ ...item, branchId: item.branchId || '' }))} onClose={props.onClose} onSuccess={props.onClose} />
}

function RenewContractDialog({ row, packages, onClose, onSuccess }: ModernProps) {
  const today = vietnamToday()
  const sourceEnded = row.contract.endDate < today || row.risk.sessionsLeft <= 0
  const [packageId, setPackageId] = useState(row.contract.packageId)
  const [startDate, setStartDate] = useState(sourceEnded ? today : nextDay(row.contract.endDate))
  const [carryOver, setCarryOver] = useState(row.risk.sessionsLeft > 0)
  const [discount, setDiscount] = useState(0)
  const [initialPayment, setInitialPayment] = useState(0)
  const [paymentMethod, setPaymentMethod] = useState('transfer')
  const [installmentCount, setInstallmentCount] = useState(1)
  const [installmentDates, setInstallmentDates] = useState<string[]>([])
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [idempotencyKey] = useState(() => crypto.randomUUID())

  const availablePackages = useMemo(() => packages.filter((item) => !item.branchId || !row.contract.branchId || item.branchId === row.contract.branchId), [packages, row.contract.branchId])
  const selectedPackage = availablePackages.find((item) => item.id === packageId) || availablePackages[0]
  const finalPrice = Math.max(0, Number(selectedPackage?.price || 0) - discount)
  const debt = Math.max(0, finalPrice - initialPayment)
  const endDate = addMonths(startDate, Number(selectedPackage?.durationMonths || 0))
  const totalSessions = Number(selectedPackage?.totalSessions || 0) + (carryOver ? row.risk.sessionsLeft : 0)

  useEffect(() => {
    if (availablePackages.length && !availablePackages.some((item) => item.id === packageId)) {
      setPackageId(availablePackages[0].id)
    }
  }, [availablePackages, packageId])
  useEffect(() => {
    if (!debt) { setInstallmentDates([]); return }
    setInstallmentDates((current) => Array.from({ length: installmentCount }, (_, index) => current[index] || addMonths(startDate, index + 1)))
  }, [debt, installmentCount, startDate])

  const installments = useMemo(() => {
    if (!debt) return []
    const base = Math.floor(debt / installmentCount)
    const remainder = debt % installmentCount
    return Array.from({ length: installmentCount }, (_, index) => ({ id: `installment-${index + 1}`, date: installmentDates[index] || '', amount: base + (index === 0 ? remainder : 0) }))
  }, [debt, installmentCount, installmentDates])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!selectedPackage) { setError('Vui lòng chọn gói tập hợp lệ.'); return }
    if (discount > selectedPackage.price) { setError('Giảm giá không thể vượt giá gói.'); return }
    if (initialPayment > finalPrice) { setError('Thanh toán đầu kỳ không thể vượt thành tiền.'); return }
    if (installments.some((item) => !item.date || item.date < startDate || (endDate && item.date > endDate))) { setError('Ngày trả góp phải nằm trong thời hạn hợp đồng mới.'); return }
    setSubmitting(true); setError('')
    try {
      await renewPtContract({
        sourceContractId: row.contract.id, packageId: selectedPackage.id, startDate,
        expectedSourceRevision: row.contract.revision, idempotencyKey, carryOver, discount, initialPayment,
        paymentMethod: initialPayment ? paymentMethod : undefined, installments,
        trainerIds: row.contract.trainerIds.length ? row.contract.trainerIds : row.contract.trainerId ? [row.contract.trainerId] : [],
        nutritionPTIds: row.contract.nutritionPTIds, note,
      })
      await onSuccess()
    } catch (submitError) { setError(submitError instanceof Error ? submitError.message : 'Không thể tái ký hợp đồng.') }
    finally { setSubmitting(false) }
  }

  return <div className="renewal-modal-layer" onMouseDown={(event) => event.target === event.currentTarget && !submitting && onClose()}>
    <section className="renewal-modal" role="dialog" aria-modal="true" aria-labelledby="renewal-modal-title">
      <div className="renewal-modal__handle" />
      <header><div><span><RefreshCw size={15} /> TÁI KÝ NGUYÊN TỬ</span><h2 id="renewal-modal-title">Tạo hợp đồng tiếp theo</h2><p>{row.student.name} · {row.contract.packageName}</p></div><button type="button" onClick={onClose} disabled={submitting} aria-label="Đóng"><X /></button></header>
      <form id="renewal-contract-form" onSubmit={submit}>
        <div className="renewal-source-card"><div><span>Hợp đồng hiện tại</span><strong>{row.contract.packageName}</strong><small>Đến {new Date(`${row.contract.endDate}T00:00:00`).toLocaleDateString('vi-VN')}</small></div><div><span>Còn lại</span><strong>{row.risk.sessionsLeft} buổi</strong><small>{riskSummary(row)}</small></div></div>
        <section className="renewal-form-section"><h3>1. Chọn lộ trình mới</h3><div className="renewal-form-grid">
          <label className="is-wide">Gói tập<select required value={packageId} onChange={(event) => setPackageId(event.target.value)}><option value="">Chọn gói tập</option>{availablePackages.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.totalSessions} buổi · {money(item.price)}</option>)}</select></label>
          <label>Ngày bắt đầu<input type="date" required min={today} value={startDate} onChange={(event) => setStartDate(event.target.value)} /></label>
          <label>Ngày kết thúc<input value={endDate ? new Date(`${endDate}T00:00:00`).toLocaleDateString('vi-VN') : '—'} readOnly /></label>
          {row.risk.sessionsLeft > 0 && <label className="renewal-switch is-wide"><input type="checkbox" checked={carryOver} onChange={(event) => setCarryOver(event.target.checked)} /><span><CheckCircle2 /> Chuyển {row.risk.sessionsLeft} buổi chưa dùng sang hợp đồng mới</span></label>}
        </div><div className="renewal-preview"><span>Tổng sau tái ký</span><strong>{totalSessions} buổi</strong><small>{selectedPackage?.durationMonths || 0} tháng · giữ nguyên PT đang phụ trách</small></div></section>
        <section className="renewal-form-section"><h3>2. Giá trị & thanh toán đầu kỳ</h3><div className="renewal-form-grid">
          <label>Giá gói<input value={money(selectedPackage?.price || 0)} readOnly /></label><label>Giảm giá<input type="number" min="0" max={selectedPackage?.price || 0} value={discount} onChange={(event) => setDiscount(Math.max(0, Number(event.target.value) || 0))} /></label>
          <label>Thu ngay<input type="number" min="0" max={finalPrice} value={initialPayment} onChange={(event) => setInitialPayment(Math.max(0, Number(event.target.value) || 0))} /></label><label>Phương thức<select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)} disabled={!initialPayment}><option value="transfer">Chuyển khoản</option><option value="cash">Tiền mặt</option><option value="card">Thẻ</option></select></label>
        </div><div className="renewal-money-summary"><div><span>Thành tiền</span><strong>{money(finalPrice)}</strong></div><div><span>Còn phải thu</span><strong>{money(debt)}</strong></div></div></section>
        {debt > 0 && <section className="renewal-form-section"><h3>3. Lịch trả góp</h3><label className="renewal-count">Số kỳ<select value={installmentCount} onChange={(event) => setInstallmentCount(Number(event.target.value))}>{[1, 2, 3, 4, 5, 6].map((value) => <option key={value} value={value}>{value} kỳ</option>)}</select></label><div className="renewal-installments">{installments.map((item, index) => <label key={item.id}><span>Kỳ {index + 1} · {money(item.amount)}</span><input type="date" required min={startDate} max={endDate} value={item.date} onChange={(event) => setInstallmentDates((current) => current.map((date, itemIndex) => itemIndex === index ? event.target.value : date))} /></label>)}</div></section>}
        <section className="renewal-form-section"><h3>{debt > 0 ? '4' : '3'}. Ghi chú</h3><textarea value={note} onChange={(event) => setNote(event.target.value)} maxLength={500} placeholder="Thỏa thuận, ưu đãi hoặc lưu ý khi tái ký…" /></section>
        <div className="renewal-atomic-note"><ShieldCheck /><p><strong>Một giao dịch an toàn</strong><span>Hợp đồng mới, liên kết hợp đồng cũ, pipeline và khoản thu đầu kỳ được ghi cùng nhau. Nếu một bước lỗi, toàn bộ thao tác sẽ không được lưu.</span></p></div>
        {error && <div className="renewal-modal-error"><AlertTriangle />{error}</div>}
      </form>
      <footer><button type="button" onClick={onClose} disabled={submitting}>Hủy</button><button type="submit" form="renewal-contract-form" className="is-primary" disabled={submitting || !selectedPackage}>{submitting ? 'Đang tái ký…' : 'Xác nhận tái ký'}<RefreshCw size={17} className={submitting ? 'is-spinning' : ''} /></button></footer>
    </section>
  </div>
}

function riskSummary(row: RenewalPipelineRow) {
  if (row.risk.category === 'expired') return `quá hạn ${Math.abs(row.risk.daysLeft)} ngày`
  if (row.risk.category === 'exhausted') return 'đã dùng hết số buổi'
  return `còn ${row.risk.daysLeft} ngày`
}
