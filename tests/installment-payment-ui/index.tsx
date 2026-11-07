import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import InstallmentPaymentSheet from '../../src/features/installment-payment/InstallmentPaymentSheet'
import InstallmentClaimQueue from '../../src/components/admin/pt/InstallmentClaimQueue'
import TransferProfileForm from '../../src/components/admin/pt/TransferProfileForm'
import type { InstallmentClaimRow } from '../../src/services/installmentPaymentService'
import { setScenario } from './functionsStub'
import '../../src/styles-aura-tokens.css'
import '../../src/styles-finance-management.css'
import '../../src/styles-operations-hub.css'

const scenarios = [
  ['due_today', 'Đến hạn hôm nay'], ['overdue', 'Quá hạn'], ['upcoming', 'Còn 3 ngày'],
  ['rejected', 'Bị từ chối'], ['no_account', 'Chưa có tài khoản'], ['paid', 'Đã thanh toán'],
] as const

function App() {
  const [surface, setSurface] = useState<'student' | 'finance' | 'cashbook'>('student')
  const [open, setOpen] = useState(false)
  const [message, setMessage] = useState('')
  const [collected, setCollected] = useState<InstallmentClaimRow | null>(null)
  return <main style={{ maxWidth: 760, margin: '0 auto', padding: 16, fontFamily: 'var(--aura-font)', color: 'var(--aura-ink)' }}>
    <nav aria-label="Bề mặt kiểm thử" style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
      {(['student', 'finance', 'cashbook'] as const).map((value) => <button key={value} type="button" aria-pressed={surface === value} onClick={() => setSurface(value)}>{value === 'student' ? 'Học viên' : value === 'finance' ? 'Kế toán' : 'Sổ quỹ'}</button>)}
    </nav>
    {surface === 'student' && <section>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
        {scenarios.map(([value, label]) => <button key={value} type="button" onClick={() => { setScenario(value); setOpen(true) }}>{label}</button>)}
      </div>
      <button type="button" className="student-payment-pay" onClick={() => setOpen(true)}>Thanh toán kỳ 2</button>
      {message && <p role="status">{message}</p>}
      {open && <InstallmentPaymentSheet contractId="contract-1" installmentId="installment-2" todayKey="2026-11-07" onClose={() => setOpen(false)} onChanged={setMessage} />}
    </section>}
    {surface === 'finance' && <div className="finance-management">
      <InstallmentClaimQueue branchId="all" refreshKey={0} onCollect={setCollected} />
      {collected && <p role="status">Mở form thu: {collected.studentName} · {collected.amount} · {collected.installmentId} · quỹ {collected.cashAccountId}</p>}
    </div>}
    {surface === 'cashbook' && <div className="cashbook-panel">
      <TransferProfileForm
        accounts={[
          { id: 'bank-a', name: 'VCB chi nhánh Quận 1', type: 'bank', branchId: 'branch-a', currency: 'VND', balance: 0, status: 'active', openingBalanceAt: '', transferProfile: { enabled: true, bankBin: '970436', bankName: 'Vietcombank', accountNumber: '1023456789', accountName: 'CONG TY TNHH AURA FITNESS' } },
          { id: 'bank-b', name: 'Techcombank Thủ Đức', type: 'bank', branchId: 'branch-b', currency: 'VND', balance: 0, status: 'active', openingBalanceAt: '', transferProfile: null },
          { id: 'cash-a', name: 'Tiền mặt Quận 1', type: 'cash', branchId: 'branch-a', currency: 'VND', balance: 0, status: 'active', openingBalanceAt: '' },
        ]}
        branches={[{ id: 'branch-a', name: 'Quận 1' }, { id: 'branch-b', name: 'Thủ Đức' }]}
        onSaved={setMessage}
        onClose={() => setMessage('Đã đóng form')}
      />
      {message && <p role="status">{message}</p>}
    </div>}
  </main>
}

createRoot(document.getElementById('root')!).render(<App />)
