import { useEffect, useState } from 'react'
import { Plus, X } from 'lucide-react'
import { dividePaymentPlan, paymentDueDate, paymentPlanError, type PaymentPlanInstallment } from '../../domain/contracts/paymentPlan'
import './ContractPaymentPlanEditor.css'

interface Props {
  installments: PaymentPlanInstallment[]
  remainingAmount: number
  startDate: string
  endDate?: string
  minDate?: string
  maxDate?: string
  maxInstallments?: number
  onChange: (items: PaymentPlanInstallment[]) => void
}
const money = (value: number) => `${new Intl.NumberFormat('vi-VN').format(value)}đ`

export default function ContractPaymentPlanEditor({ installments, remainingAmount, startDate, endDate, minDate, maxDate, maxInstallments = 24, onChange }: Props) {
  const pending = installments.filter(item => item.status === 'pending')
  const lockedCount = installments.length - pending.length
  const [count, setCount] = useState(Math.max(1, pending.length))
  useEffect(() => { setCount(Math.max(1, pending.length)) }, [pending.length])
  const total = pending.reduce((sum, item) => sum + item.amount, 0)
  const difference = remainingAmount - total
  const issue = paymentPlanError(installments, remainingAmount, { minDate, maxDate, maxInstallments })
  const update = (id: string, patch: Partial<PaymentPlanInstallment>) => onChange(installments.map(item => item.id === id && item.status === 'pending' ? { ...item, ...patch } : item))
  const maximumCount = Math.max(1, maxInstallments - lockedCount)
  return <section className="contract-payment-plan" aria-label="Kế hoạch trả góp">
    <header><strong>Lịch thanh toán</strong><span>Còn phải thu <b>{money(Math.max(0, remainingAmount))}</b></span></header>
    {remainingAmount > 0 && <div className="contract-payment-plan__distribution">
      <select aria-label="Số kỳ trả góp" value={Math.min(count, maximumCount)} onChange={event => setCount(Number(event.target.value))}>{Array.from({ length: maximumCount }, (_, index) => <option key={index + 1} value={index + 1}>{index + 1} kỳ</option>)}</select>
      <button type="button" onClick={() => onChange(dividePaymentPlan(remainingAmount, Math.min(count, maximumCount), startDate, endDate, installments))}>Chia đều</button>
    </div>}
    {installments.length > 0 && <div className="contract-payment-plan__columns" aria-hidden="true"><span>Kỳ</span><span>Ngày đến hạn</span><span>Số tiền (đ)</span></div>}
    {installments.map((item, index) => <div className="contract-payment-plan__row" key={item.id}>
      <span className="contract-payment-plan__ordinal">{index + 1}</span>
      <input aria-label={`Ngày đến hạn kỳ ${index + 1}`} type="date" required disabled={item.status !== 'pending'} min={minDate} max={maxDate} value={item.date} onChange={event => update(item.id, { date: event.target.value })} />
      <input aria-label={`Số tiền kỳ ${index + 1}`} type="number" inputMode="numeric" min="1" step="1" required disabled={item.status !== 'pending'} value={item.amount || ''} onChange={event => update(item.id, { amount: Number(event.target.value) })} />
      {item.status === 'pending' ? <button className="contract-payment-plan__remove" type="button" aria-label={`Xóa kỳ ${index + 1}`} onClick={() => onChange(installments.filter(row => row.id !== item.id))}><X size={16} /></button> : <span className="contract-payment-plan__locked">{item.status === 'paid' ? 'Đã thu' : 'Đã hủy'}</span>}
    </div>)}
    {remainingAmount > 0 && installments.length < maxInstallments && <button className="contract-payment-plan__add" type="button" onClick={() => onChange([...installments, { id: `installment-${crypto.randomUUID()}`, date: paymentDueDate(startDate, pending.length + 1, endDate), amount: Math.max(0, difference), status: 'pending' }])}><Plus size={16} /> Thêm kỳ thanh toán</button>}
    <div aria-live="polite">{issue && <p className="contract-payment-plan__error" role="alert">{difference !== 0 ? `${difference > 0 ? 'Còn thiếu' : 'Vượt'} ${money(Math.abs(difference))}. Điều chỉnh số tiền các kỳ.` : issue}</p>}</div>
  </section>
}
