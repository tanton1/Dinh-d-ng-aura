import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowRightLeft, Landmark, Plus, RefreshCw, Wallet } from 'lucide-react'
import { initializeCashAccount, listCashAccounts, listCashTransactions, recordCashExpense, transferCash, type CashAccount, type CashAccountType, type CashTransaction } from '../../../services/cashbookService'

function money(value: number) { return `${Math.round(value).toLocaleString('vi-VN')}đ` }

export default function CashbookPanel({ branches }: { branches: Array<{ id: string; name: string }> }) {
  const [accounts, setAccounts] = useState<CashAccount[]>([])
  const [transactions, setTransactions] = useState<CashTransaction[]>([])
  const [selectedAccount, setSelectedAccount] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [mode, setMode] = useState<'none' | 'account' | 'expense' | 'transfer'>('none')
  const [busy, setBusy] = useState(false)
  const [form, setForm] = useState({ name: '', type: 'cash' as CashAccountType, branchId: '', amount: '', category: '', note: '', toAccountId: '' })
  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const [accountPage, transactionPage] = await Promise.all([listCashAccounts(), listCashTransactions({ accountId: selectedAccount || undefined, pageSize: 100 })])
      setAccounts(accountPage.accounts); setTransactions(transactionPage.transactions)
    } catch { setError('Không thể tải sổ quỹ. Chức năng được khóa an toàn cho đến khi backend sẵn sàng.') }
    finally { setLoading(false) }
  }, [selectedAccount])
  useEffect(() => { void load() }, [load])
  const totalBalance = useMemo(() => accounts.filter((item) => item.status === 'active').reduce((sum, item) => sum + item.balance, 0), [accounts])
  const submit = async () => {
    if (busy) return
    setBusy(true); setError('')
    try {
      const amount = Number(form.amount)
      if (mode === 'account') await initializeCashAccount({ name: form.name, type: form.type, branchId: form.branchId, openingBalance: amount, openingBalanceAt: new Date().toISOString(), idempotencyKey: crypto.randomUUID() })
      if (mode === 'expense') await recordCashExpense({ accountId: selectedAccount, amount, category: form.category, note: form.note, effectiveAt: new Date().toISOString(), idempotencyKey: crypto.randomUUID() })
      if (mode === 'transfer') await transferCash({ fromAccountId: selectedAccount, toAccountId: form.toAccountId, amount, effectiveAt: new Date().toISOString(), idempotencyKey: crypto.randomUUID() })
      setMode('none'); setForm({ name: '', type: 'cash', branchId: '', amount: '', category: '', note: '', toAccountId: '' }); await load()
    } catch (value) { setError(value instanceof Error ? value.message : 'Không thể ghi sổ quỹ.') }
    finally { setBusy(false) }
  }
  return <section className="cashbook-panel">
    <div className="cashbook-summary"><div><span>TỔNG SỐ DƯ ĐÃ ĐỐI SOÁT</span><strong>{loading ? '…' : money(totalBalance)}</strong><small>{accounts.length} tài khoản tiền mặt/ngân hàng/ví</small></div><Wallet /></div>
    <div className="cashbook-toolbar">
      <select value={selectedAccount} onChange={(event) => setSelectedAccount(event.target.value)}><option value="">Tất cả tài khoản</option>{accounts.map((item) => <option key={item.id} value={item.id}>{item.name} · {money(item.balance)}</option>)}</select>
      <button onClick={() => setMode('account')}><Plus size={16} /> Mở quỹ</button><button disabled={!selectedAccount} onClick={() => setMode('expense')}><Landmark size={16} /> Ghi khoản chi</button><button disabled={!selectedAccount || accounts.length < 2} onClick={() => setMode('transfer')}><ArrowRightLeft size={16} /> Chuyển quỹ</button><button onClick={() => void load()}><RefreshCw size={16} /></button>
    </div>
    {error && <div className="cashbook-error">{error}</div>}
    {mode !== 'none' && <div className="cashbook-form">
      {mode === 'account' && <><input placeholder="Tên quỹ/tài khoản" value={form.name} onChange={(e) => setForm((v) => ({ ...v, name: e.target.value }))} /><select value={form.type} onChange={(e) => setForm((v) => ({ ...v, type: e.target.value as CashAccountType }))}><option value="cash">Tiền mặt</option><option value="bank">Ngân hàng</option><option value="wallet">Ví điện tử</option></select><select value={form.branchId} onChange={(e) => setForm((v) => ({ ...v, branchId: e.target.value }))}><option value="">Chọn chi nhánh</option>{branches.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></>}
      {mode === 'expense' && <><input placeholder="Nhóm chi (thuê mặt bằng, điện nước...)" value={form.category} onChange={(e) => setForm((v) => ({ ...v, category: e.target.value }))} /><input placeholder="Ghi chú/chứng từ" value={form.note} onChange={(e) => setForm((v) => ({ ...v, note: e.target.value }))} /></>}
      {mode === 'transfer' && <select value={form.toAccountId} onChange={(e) => setForm((v) => ({ ...v, toAccountId: e.target.value }))}><option value="">Chọn quỹ nhận</option>{accounts.filter((item) => item.id !== selectedAccount).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>}
      <input type="number" min="0" placeholder={mode === 'account' ? 'Số dư đầu kỳ đã kiểm kê' : 'Số tiền'} value={form.amount} onChange={(e) => setForm((v) => ({ ...v, amount: e.target.value }))} />
      <div><button className="cashbook-primary" onClick={() => void submit()} disabled={busy}>Xác nhận ghi sổ</button><button onClick={() => setMode('none')}>Hủy</button></div>
    </div>}
    <div className="cashbook-list">{transactions.map((item) => <article key={item.id}><div><b>{item.referenceCode}</b><span>{item.category || item.type} · {new Date(item.effectiveAt).toLocaleString('vi-VN')}</span></div><strong className={item.amount >= 0 ? 'positive' : 'negative'}>{money(item.amount)}</strong></article>)}{!loading && transactions.length === 0 && <p>Chưa có giao dịch. Hãy mở quỹ bằng số dư đã kiểm kê tại ngày chuyển đổi.</p>}</div>
  </section>
}
