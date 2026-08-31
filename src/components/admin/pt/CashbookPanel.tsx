import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowLeft, ArrowRight, ArrowRightLeft, CheckCircle2, Eye, FilePenLine, Landmark, Plus, Printer, ReceiptText, RefreshCw, RotateCcw, Send, Wallet, X } from 'lucide-react'
import {
  approveAndPostExpenseVoucher,
  initializeCashAccount,
  listAccountingCatalog,
  listCashAccounts,
  listCashTransactions,
  listExpenseVouchers,
  listReceiptVouchers,
  reverseExpenseVoucher,
  saveExpenseVoucherDraft,
  transferCash,
  type AccountingAccount,
  type CashAccount,
  type CashAccountType,
  type CashTransaction,
  type ExpensePurpose,
  type ExpenseVoucher,
  type JournalLine,
  type ReceiptVoucher,
} from '../../../services/cashbookService'
import { reverseContractPayment } from '../../../services/financeLedgerService'

type PanelMode = 'none' | 'account' | 'voucher' | 'transfer'
type LedgerTab = 'receipts' | 'vouchers' | 'cash'

const today = () => new Date().toISOString().slice(0, 10)
const money = (value: number) => `${Math.round(value || 0).toLocaleString('vi-VN')}đ`

const statusLabels: Record<ExpenseVoucher['status'], string> = {
  draft: 'Nháp',
  pending_approval: 'Chờ duyệt',
  posted: 'Đã ghi sổ',
  reversed: 'Đã đảo',
}

const emptyVoucher = (accountId = '') => ({
  voucherId: '',
  expectedRevision: 0,
  accountId,
  purposeCode: '',
  effectiveAt: today(),
  payeeName: '',
  payeeAddress: '',
  description: '',
  amountBeforeTax: '',
  vatAmount: '',
  invoiceNumber: '',
  originalDocumentCount: '0',
  attachmentUrl: '',
})

function errorMessage(value: unknown, fallback: string) {
  if (!(value instanceof Error)) return fallback
  return value.message.replace(/^Firebase:\s*/i, '').replace(/\(functions\/[\w-]+\)\.?$/i, '').trim() || fallback
}

export default function CashbookPanel({ branches }: { branches: Array<{ id: string; name: string }> }) {
  const [accounts, setAccounts] = useState<CashAccount[]>([])
  const [transactions, setTransactions] = useState<CashTransaction[]>([])
  const [vouchers, setVouchers] = useState<ExpenseVoucher[]>([])
  const [receipts, setReceipts] = useState<ReceiptVoucher[]>([])
  const [purposes, setPurposes] = useState<ExpensePurpose[]>([])
  const [accountingAccounts, setAccountingAccounts] = useState<AccountingAccount[]>([])
  const [approvalThreshold, setApprovalThreshold] = useState(10_000_000)
  const [selectedAccount, setSelectedAccount] = useState('')
  const [activeTab, setActiveTab] = useState<LedgerTab>('receipts')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [mode, setMode] = useState<PanelMode>('none')
  const [selectedReceipt, setSelectedReceipt] = useState<ReceiptVoucher | null>(null)
  const [voucherStep, setVoucherStep] = useState(1)
  const [voucherForm, setVoucherForm] = useState(emptyVoucher())
  const [basicForm, setBasicForm] = useState({ name: '', type: 'cash' as CashAccountType, branchId: '', amount: '', toAccountId: '' })

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [accountPage, transactionPage, voucherPage, receiptPage, catalog] = await Promise.all([
        listCashAccounts(),
        listCashTransactions({ accountId: selectedAccount || undefined, pageSize: 100 }),
        listExpenseVouchers({ pageSize: 100 }),
        listReceiptVouchers({ accountId: selectedAccount || undefined, pageSize: 100 }),
        listAccountingCatalog(),
      ])
      setAccounts(accountPage.accounts)
      setTransactions(transactionPage.transactions)
      setVouchers(voucherPage.vouchers)
      setReceipts(receiptPage.vouchers)
      setPurposes(catalog.expensePurposes)
      setAccountingAccounts(catalog.accounts)
      setApprovalThreshold(catalog.approvalSeparationThreshold)
      if (!selectedAccount) {
        const firstActiveAccount = accountPage.accounts.find((item) => item.status === 'active')
        if (firstActiveAccount) setSelectedAccount(firstActiveAccount.id)
      }
    } catch (value) {
      setError(errorMessage(value, 'Không thể tải sổ quỹ. Chức năng được khóa an toàn cho đến khi backend sẵn sàng.'))
    } finally {
      setLoading(false)
    }
  }, [selectedAccount])

  useEffect(() => { void load() }, [load])

  const activeAccounts = useMemo(() => accounts.filter((item) => item.status === 'active'), [accounts])
  const totalBalance = useMemo(() => activeAccounts.reduce((sum, item) => sum + item.balance, 0), [activeAccounts])
  const pendingCount = useMemo(() => vouchers.filter((item) => item.status === 'pending_approval').length, [vouchers])
  const selectedCashAccount = accounts.find((item) => item.id === voucherForm.accountId)
  const selectedPurpose = purposes.find((item) => item.code === voucherForm.purposeCode)

  const journalPreview = useMemo<JournalLine[]>(() => {
    const net = Math.max(0, Math.round(Number(voucherForm.amountBeforeTax) || 0))
    const vat = selectedPurpose?.vatAllowed ? Math.max(0, Math.round(Number(voucherForm.vatAmount) || 0)) : 0
    if (!selectedCashAccount || !selectedPurpose || !net) return []
    const names = new Map(accountingAccounts.map((item) => [item.code, item.name]))
    const cashCode = selectedCashAccount.type === 'bank' ? '1121' : selectedCashAccount.type === 'wallet' ? '1128' : '1111'
    const lines: JournalLine[] = [{ side: 'debit', accountCode: selectedPurpose.debitAccountCode, accountName: names.get(selectedPurpose.debitAccountCode) || '', debit: net, credit: 0, description: voucherForm.description || selectedPurpose.label }]
    if (vat) lines.push({ side: 'debit', accountCode: '1331', accountName: names.get('1331') || '', debit: vat, credit: 0, description: 'Thuế GTGT đầu vào đủ điều kiện khấu trừ' })
    lines.push({ side: 'credit', accountCode: cashCode, accountName: names.get(cashCode) || '', debit: 0, credit: net + vat, description: 'Chi tiền theo phiếu chi' })
    return lines
  }, [accountingAccounts, selectedCashAccount, selectedPurpose, voucherForm.amountBeforeTax, voucherForm.description, voucherForm.vatAmount])

  const closeForm = () => {
    setMode('none')
    setVoucherStep(1)
    setVoucherForm(emptyVoucher(selectedAccount))
    setBasicForm({ name: '', type: 'cash', branchId: '', amount: '', toAccountId: '' })
  }

  const openVoucher = (voucher?: ExpenseVoucher) => {
    if (!activeAccounts.length) {
      setError('Chưa có tài khoản quỹ đang hoạt động. Hãy mở quỹ trước khi lập phiếu chi.')
      return
    }
    setError('')
    setMessage('')
    setVoucherStep(1)
    setMode('voucher')
    setVoucherForm(voucher ? {
      voucherId: voucher.id,
      expectedRevision: voucher.revision,
      accountId: voucher.accountId,
      purposeCode: voucher.purposeCode,
      effectiveAt: voucher.effectiveAt.slice(0, 10) || today(),
      payeeName: voucher.payeeName,
      payeeAddress: voucher.payeeAddress,
      description: voucher.description,
      amountBeforeTax: String(voucher.amountBeforeTax),
      vatAmount: String(voucher.vatAmount || ''),
      invoiceNumber: voucher.invoiceNumber,
      originalDocumentCount: String(voucher.originalDocumentCount || 0),
      attachmentUrl: voucher.attachmentUrls[0] || '',
    } : emptyVoucher(selectedAccount || activeAccounts[0].id))
  }

  const validateVoucherStep = (step: number) => {
    if (step === 1 && (!voucherForm.accountId || !voucherForm.purposeCode || !voucherForm.effectiveAt)) return 'Hãy chọn tài khoản chi, ngày hạch toán và mục đích chi.'
    if (step === 2 && (!voucherForm.payeeName.trim() || !voucherForm.description.trim())) return 'Hãy nhập người nhận tiền và nội dung chi.'
    if (step === 3 && (!Number.isSafeInteger(Number(voucherForm.amountBeforeTax)) || Number(voucherForm.amountBeforeTax) <= 0)) return 'Số tiền trước thuế phải là số nguyên dương.'
    if (step === 3 && Number(voucherForm.vatAmount || 0) < 0) return 'Thuế GTGT không hợp lệ.'
    if (step === 3 && voucherForm.attachmentUrl && !/^https:\/\//i.test(voucherForm.attachmentUrl)) return 'Liên kết chứng từ phải bắt đầu bằng https://.'
    return ''
  }

  const nextVoucherStep = () => {
    const validation = validateVoucherStep(voucherStep)
    if (validation) return setError(validation)
    setError('')
    setVoucherStep((value) => Math.min(4, value + 1))
  }

  const saveVoucher = async (submit: boolean) => {
    const validation = [1, 2, 3].map(validateVoucherStep).find(Boolean)
    if (validation) return setError(validation)
    setBusy(true)
    setError('')
    setMessage('')
    try {
      const result = await saveExpenseVoucherDraft({
        voucherId: voucherForm.voucherId || undefined,
        expectedRevision: voucherForm.expectedRevision,
        accountId: voucherForm.accountId,
        purposeCode: voucherForm.purposeCode,
        effectiveAt: new Date(`${voucherForm.effectiveAt}T12:00:00+07:00`).toISOString(),
        payeeName: voucherForm.payeeName,
        payeeAddress: voucherForm.payeeAddress,
        description: voucherForm.description,
        amountBeforeTax: Number(voucherForm.amountBeforeTax),
        vatAmount: selectedPurpose?.vatAllowed ? Number(voucherForm.vatAmount || 0) : 0,
        invoiceNumber: voucherForm.invoiceNumber,
        originalDocumentCount: Number(voucherForm.originalDocumentCount || 0),
        attachmentUrls: voucherForm.attachmentUrl ? [voucherForm.attachmentUrl] : [],
        submit,
      })
      closeForm()
      setActiveTab('vouchers')
      setMessage(submit ? `Đã gửi ${result.voucherNumber} chờ phê duyệt.` : `Đã lưu nháp ${result.voucherNumber}.`)
      await load()
    } catch (value) {
      setError(errorMessage(value, 'Không thể lưu phiếu chi.'))
    } finally {
      setBusy(false)
    }
  }

  const submitBasicForm = async () => {
    if (busy) return
    setBusy(true)
    setError('')
    setMessage('')
    try {
      const amount = Number(basicForm.amount)
      if (!Number.isSafeInteger(amount) || amount < 0) throw new Error('Số tiền không hợp lệ.')
      if (mode === 'account') await initializeCashAccount({ name: basicForm.name, type: basicForm.type, branchId: basicForm.branchId, openingBalance: amount, openingBalanceAt: new Date().toISOString(), idempotencyKey: crypto.randomUUID() })
      if (mode === 'transfer') await transferCash({ fromAccountId: selectedAccount, toAccountId: basicForm.toAccountId, amount, effectiveAt: new Date().toISOString(), idempotencyKey: crypto.randomUUID() })
      closeForm()
      setMessage(mode === 'account' ? 'Đã mở tài khoản quỹ.' : 'Đã chuyển quỹ và tạo đủ hai giao dịch đối ứng.')
      await load()
    } catch (value) {
      setError(errorMessage(value, 'Không thể ghi sổ quỹ.'))
    } finally {
      setBusy(false)
    }
  }

  const approveVoucher = async (voucher: ExpenseVoucher) => {
    if (!window.confirm(`Phê duyệt và ghi sổ phiếu ${voucher.voucherNumber} với số tiền ${money(voucher.totalAmount)}?`)) return
    setBusy(true)
    setError('')
    try {
      await approveAndPostExpenseVoucher({ voucherId: voucher.id, expectedRevision: voucher.revision })
      setMessage(`Đã ghi sổ phiếu ${voucher.voucherNumber}.`)
      await load()
    } catch (value) {
      setError(errorMessage(value, 'Không thể phê duyệt phiếu chi.'))
    } finally { setBusy(false) }
  }

  const reverseVoucher = async (voucher: ExpenseVoucher) => {
    const reason = window.prompt(`Lý do đảo phiếu ${voucher.voucherNumber}:`)?.trim()
    if (!reason) return
    if (!window.confirm('Phiếu gốc sẽ được giữ nguyên và hệ thống tạo bút toán đảo. Tiếp tục?')) return
    setBusy(true)
    setError('')
    try {
      await reverseExpenseVoucher({ voucherId: voucher.id, reason })
      setMessage(`Đã tạo chứng từ đảo cho ${voucher.voucherNumber}.`)
      await load()
    } catch (value) {
      setError(errorMessage(value, 'Không thể đảo phiếu chi.'))
    } finally { setBusy(false) }
  }

  const reverseReceipt = async (receipt: ReceiptVoucher) => {
    const reason = window.prompt(`Lý do đảo phiếu thu ${receipt.voucherNumber}:`)?.trim()
    if (!reason) return
    if (!window.confirm('Hệ thống sẽ đảo đồng thời phiếu thu, bút toán, sổ quỹ và số tiền đã thu trên hợp đồng. Tiếp tục?')) return
    setBusy(true)
    setError('')
    try {
      const result = await reverseContractPayment(receipt.ledgerEntryId, reason)
      setSelectedReceipt(null)
      setMessage(`Đã tạo ${result.receiptVoucherNumber || 'chứng từ đảo'} cho ${receipt.voucherNumber}.`)
      await load()
    } catch (value) {
      setError(errorMessage(value, 'Không thể đảo phiếu thu.'))
    } finally { setBusy(false) }
  }

  return <section className="cashbook-panel">
    <div className="cashbook-summary">
      <div><span>TỔNG SỐ DƯ ĐÃ ĐỐI SOÁT</span><strong>{loading ? '…' : money(totalBalance)}</strong><small>{activeAccounts.length} tài khoản đang hoạt động · {receipts.length} phiếu thu · {pendingCount} phiếu chờ duyệt</small></div>
      <Wallet />
    </div>

    <div className="cashbook-toolbar">
      <select value={selectedAccount} onChange={(event) => setSelectedAccount(event.target.value)} aria-label="Lọc theo tài khoản quỹ">
        <option value="">Tất cả tài khoản</option>
        {activeAccounts.map((item) => <option key={item.id} value={item.id}>{item.name} · {money(item.balance)}</option>)}
      </select>
      <button onClick={() => { closeForm(); setMode('account') }}><Plus size={16} /> Mở quỹ</button>
      <button onClick={() => openVoucher()}><FilePenLine size={16} /> Lập phiếu chi</button>
      <button disabled={!selectedAccount || activeAccounts.length < 2} onClick={() => { closeForm(); setMode('transfer') }}><ArrowRightLeft size={16} /> Chuyển quỹ</button>
      <button onClick={() => void load()} aria-label="Tải lại"><RefreshCw size={16} /></button>
    </div>

    {error && <div className="cashbook-error" role="alert">{error}</div>}
    {message && <div className="cashbook-message"><CheckCircle2 size={18} /> {message}</div>}

    {(mode === 'account' || mode === 'transfer') && <div className="cashbook-form">
      {mode === 'account' && <>
        <label>Tên quỹ/tài khoản<input value={basicForm.name} onChange={(event) => setBasicForm((value) => ({ ...value, name: event.target.value }))} /></label>
        <label>Loại tài khoản<select value={basicForm.type} onChange={(event) => setBasicForm((value) => ({ ...value, type: event.target.value as CashAccountType }))}><option value="cash">Tiền mặt</option><option value="bank">Ngân hàng</option><option value="wallet">Ví điện tử</option></select></label>
        <label>Chi nhánh<select value={basicForm.branchId} onChange={(event) => setBasicForm((value) => ({ ...value, branchId: event.target.value }))}><option value="">Chọn chi nhánh</option>{branches.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      </>}
      {mode === 'transfer' && <label>Quỹ nhận<select value={basicForm.toAccountId} onChange={(event) => setBasicForm((value) => ({ ...value, toAccountId: event.target.value }))}><option value="">Chọn quỹ nhận</option>{activeAccounts.filter((item) => item.id !== selectedAccount).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
      <label>{mode === 'account' ? 'Số dư đầu kỳ đã kiểm kê' : 'Số tiền'}<input type="number" min="0" step="1" value={basicForm.amount} onChange={(event) => setBasicForm((value) => ({ ...value, amount: event.target.value }))} /></label>
      <div className="cashbook-form__actions"><button className="cashbook-primary" onClick={() => void submitBasicForm()} disabled={busy}>Xác nhận</button><button onClick={closeForm}><X size={15} /> Hủy</button></div>
    </div>}

    {mode === 'voucher' && <div className="expense-voucher">
      <div className="expense-voucher__steps">{['Nghiệp vụ', 'Người nhận', 'Chứng từ', 'Kiểm tra'].map((label, index) => <button key={label} className={voucherStep === index + 1 ? 'is-active' : voucherStep > index + 1 ? 'is-done' : ''} onClick={() => { if (index + 1 < voucherStep) setVoucherStep(index + 1) }}><span>{index + 1}</span>{label}</button>)}</div>
      <div className="expense-voucher__body">
        <div className="expense-voucher__title"><div><small>PHIẾU CHI</small><h3>{voucherForm.voucherId ? 'Chỉnh sửa phiếu nháp' : 'Lập chứng từ mới'}</h3></div><button onClick={closeForm} aria-label="Đóng"><X size={18} /></button></div>
        {voucherStep === 1 && <div className="expense-voucher__grid">
          <label>Tài khoản chi<select value={voucherForm.accountId} onChange={(event) => setVoucherForm((value) => ({ ...value, accountId: event.target.value }))}>{activeAccounts.map((item) => <option key={item.id} value={item.id}>{item.name} · {money(item.balance)}</option>)}</select></label>
          <label>Ngày hạch toán<input type="date" value={voucherForm.effectiveAt} onChange={(event) => setVoucherForm((value) => ({ ...value, effectiveAt: event.target.value }))} /></label>
          <label className="expense-voucher__wide">Mục đích chi<select value={voucherForm.purposeCode} onChange={(event) => setVoucherForm((value) => ({ ...value, purposeCode: event.target.value, vatAmount: purposes.find((item) => item.code === event.target.value)?.vatAllowed ? value.vatAmount : '' }))}><option value="">Chọn đúng bản chất nghiệp vụ</option>{purposes.map((item) => <option key={item.code} value={item.code}>{item.label} · Nợ {item.debitAccountCode}</option>)}</select></label>
          {selectedPurpose && <p className="expense-voucher__approval-note expense-voucher__wide">Nghiệp vụ này ghi Nợ tài khoản {selectedPurpose.debitAccountCode}. {selectedPurpose.expenseImpact ? 'Được tính vào chi phí hoạt động.' : 'Không ghi nhận lại chi phí tại thời điểm thanh toán.'}</p>}
        </div>}
        {voucherStep === 2 && <div className="expense-voucher__grid">
          <label>Người nhận tiền<input value={voucherForm.payeeName} onChange={(event) => setVoucherForm((value) => ({ ...value, payeeName: event.target.value }))} placeholder="Cá nhân hoặc nhà cung cấp" /></label>
          <label>Địa chỉ người nhận<input value={voucherForm.payeeAddress} onChange={(event) => setVoucherForm((value) => ({ ...value, payeeAddress: event.target.value }))} /></label>
          <label className="expense-voucher__wide">Nội dung chi<textarea rows={3} value={voucherForm.description} onChange={(event) => setVoucherForm((value) => ({ ...value, description: event.target.value }))} placeholder="Diễn giải đủ để đối soát chứng từ" /></label>
        </div>}
        {voucherStep === 3 && <div className="expense-voucher__grid">
          <label>Tiền trước thuế<input type="number" min="1" step="1" value={voucherForm.amountBeforeTax} onChange={(event) => setVoucherForm((value) => ({ ...value, amountBeforeTax: event.target.value }))} /></label>
          <label>Thuế GTGT<input type="number" min="0" step="1" disabled={!selectedPurpose?.vatAllowed} value={voucherForm.vatAmount} onChange={(event) => setVoucherForm((value) => ({ ...value, vatAmount: event.target.value }))} /></label>
          <label>Số hóa đơn<input value={voucherForm.invoiceNumber} onChange={(event) => setVoucherForm((value) => ({ ...value, invoiceNumber: event.target.value }))} /></label>
          <label>Số chứng từ gốc<input type="number" min="0" max="100" step="1" value={voucherForm.originalDocumentCount} onChange={(event) => setVoucherForm((value) => ({ ...value, originalDocumentCount: event.target.value }))} /></label>
          <label className="expense-voucher__wide">Liên kết chứng từ đính kèm<input type="url" value={voucherForm.attachmentUrl} onChange={(event) => setVoucherForm((value) => ({ ...value, attachmentUrl: event.target.value }))} placeholder="https://..." /></label>
          <div className="expense-voucher__total expense-voucher__wide"><span>Tổng thanh toán</span><strong>{money(Number(voucherForm.amountBeforeTax || 0) + (selectedPurpose?.vatAllowed ? Number(voucherForm.vatAmount || 0) : 0))}</strong></div>
        </div>}
        {voucherStep === 4 && <div className="expense-voucher__review">
          <div><span>Tài khoản chi</span><strong>{selectedCashAccount?.name}</strong></div><div><span>Người nhận</span><strong>{voucherForm.payeeName}</strong></div><div><span>Nội dung</span><strong>{voucherForm.description}</strong></div><div><span>Tổng tiền</span><strong>{money(Number(voucherForm.amountBeforeTax || 0) + Number(voucherForm.vatAmount || 0))}</strong></div>
          <div className="expense-voucher__journal"><h4>Bút toán Nợ / Có</h4>{journalPreview.map((line, index) => <div key={`${line.accountCode}-${index}`}><span>{line.side === 'debit' ? 'NỢ' : 'CÓ'} {line.accountCode} · {line.accountName}</span><strong>{money(line.debit || line.credit)}</strong></div>)}</div>
          <p className="expense-voucher__approval-note">Phiếu từ {money(approvalThreshold)} phải được một tài khoản khác phê duyệt. Sau khi ghi sổ, chứng từ không được sửa hoặc xóa; nếu sai phải lập chứng từ đảo.</p>
        </div>}
        <div className="expense-voucher__actions">
          <button onClick={() => setVoucherStep((value) => Math.max(1, value - 1))} disabled={voucherStep === 1}><ArrowLeft size={16} /> Quay lại</button>
          <div>{voucherStep === 4 && <><button onClick={() => void saveVoucher(false)} disabled={busy}><Landmark size={16} /> Lưu nháp</button><button className="cashbook-primary" onClick={() => void saveVoucher(true)} disabled={busy}><Send size={16} /> Gửi duyệt</button></>}{voucherStep < 4 && <button className="cashbook-primary" onClick={nextVoucherStep}>Tiếp tục <ArrowRight size={16} /></button>}</div>
        </div>
      </div>
    </div>}

    <div className="cashbook-ledger-tabs"><button className={activeTab === 'receipts' ? 'is-active' : ''} onClick={() => setActiveTab('receipts')}>Phiếu thu <span>{receipts.length}</span></button><button className={activeTab === 'vouchers' ? 'is-active' : ''} onClick={() => setActiveTab('vouchers')}>Phiếu chi <span>{vouchers.length}</span></button><button className={activeTab === 'cash' ? 'is-active' : ''} onClick={() => setActiveTab('cash')}>Biến động quỹ <span>{transactions.length}</span></button></div>

    {activeTab === 'receipts' && <div className="expense-voucher-list receipt-voucher-list">{receipts.map((receipt) => <article key={receipt.id}>
      <div className="expense-voucher-list__main"><div><ReceiptText size={16} /><b>{receipt.voucherNumber}</b><span className={`expense-voucher-status status-${receipt.status}`}>{statusLabels[receipt.status]}</span></div><p>{receipt.payerName} · {accounts.find((item) => item.id === receipt.accountId)?.name || 'Quỹ đã lưu'}</p><small>{receipt.effectiveAt ? new Date(receipt.effectiveAt).toLocaleDateString('vi-VN') : ''} · {receipt.description}</small></div>
      <div className="expense-voucher-list__amount"><strong className={receipt.documentType === 'receipt_voucher_reversal' ? 'negative' : 'positive'}>{receipt.documentType === 'receipt_voucher_reversal' ? '−' : '+'}{money(receipt.totalAmount)}</strong><div><button onClick={() => setSelectedReceipt(receipt)}><Eye size={15} /> Xem / In</button>{receipt.status === 'posted' && receipt.documentType === 'receipt_voucher' && <button disabled={busy || !receipt.ledgerEntryId} onClick={() => void reverseReceipt(receipt)}><RotateCcw size={15} /> Đảo phiếu</button>}</div></div>
    </article>)}{!loading && receipts.length === 0 && <p>Chưa có phiếu thu trong quỹ đã chọn. Phiếu sẽ tự tạo khi thu tiền hợp đồng hoặc thu đầu kỳ tái ký.</p>}</div>}

    {activeTab === 'vouchers' && <div className="expense-voucher-list">{vouchers.map((voucher) => <article key={voucher.id}>
      <div className="expense-voucher-list__main"><div><b>{voucher.voucherNumber}</b><span className={`expense-voucher-status status-${voucher.status}`}>{statusLabels[voucher.status]}</span></div><p>{voucher.purposeLabel} · {voucher.payeeName}</p><small>{voucher.effectiveAt ? new Date(voucher.effectiveAt).toLocaleDateString('vi-VN') : ''} · {voucher.description}</small></div>
      <div className="expense-voucher-list__amount"><strong>{money(voucher.totalAmount)}</strong><div>{voucher.status === 'draft' && <button onClick={() => openVoucher(voucher)}><FilePenLine size={15} /> Sửa</button>}{voucher.status === 'pending_approval' && <button className="cashbook-primary" disabled={busy} onClick={() => void approveVoucher(voucher)}><CheckCircle2 size={15} /> Duyệt & ghi sổ</button>}{voucher.status === 'posted' && voucher.documentType === 'expense_voucher' && <button disabled={busy} onClick={() => void reverseVoucher(voucher)}><RotateCcw size={15} /> Đảo phiếu</button>}</div></div>
    </article>)}{!loading && vouchers.length === 0 && <p>Chưa có phiếu chi. Hãy lập phiếu đầu tiên để chi tiền đúng chứng từ và bút toán.</p>}</div>}

    {activeTab === 'cash' && <div className="cashbook-list">{transactions.map((item) => <article key={item.id}><div><b>{item.referenceCode}</b><span>{item.category || item.type} · {new Date(item.effectiveAt).toLocaleString('vi-VN')}</span></div><strong className={item.amount >= 0 ? 'positive' : 'negative'}>{money(item.amount)}</strong></article>)}{!loading && transactions.length === 0 && <p>Chưa có giao dịch. Hãy mở quỹ bằng số dư đã kiểm kê tại ngày chuyển đổi.</p>}</div>}

    {selectedReceipt && <div className="receipt-voucher-modal" role="dialog" aria-modal="true" aria-label={`Phiếu thu ${selectedReceipt.voucherNumber}`} onClick={() => setSelectedReceipt(null)}>
      <article className="receipt-voucher-document" onClick={(event) => event.stopPropagation()}>
        <div className="receipt-voucher-document__toolbar"><span>{selectedReceipt.derived ? 'Phiếu đối soát từ sổ tài chính lịch sử · Chỉ đọc' : 'Chứng từ gốc · Đã liên kết sổ quỹ'}</span><div><button onClick={() => window.print()}><Printer size={16} /> In phiếu</button><button onClick={() => setSelectedReceipt(null)}><X size={16} /> Đóng</button></div></div>
        <header><div><b>AURA FITNESS</b><small>Chứng từ kế toán điện tử</small></div><div><strong>{selectedReceipt.documentType === 'receipt_voucher_reversal' ? 'PHIẾU THU ĐẢO' : 'PHIẾU THU'}</strong><small>Số: {selectedReceipt.voucherNumber}</small></div></header>
        <div className="receipt-voucher-document__date">Ngày {selectedReceipt.effectiveAt ? new Date(selectedReceipt.effectiveAt).toLocaleDateString('vi-VN') : '—'}</div>
        <dl className="receipt-voucher-document__fields">
          <div><dt>Người nộp tiền</dt><dd>{selectedReceipt.payerName}</dd></div>
          <div><dt>Địa chỉ</dt><dd>{selectedReceipt.payerAddress || 'Không ghi nhận'}</dd></div>
          <div><dt>Lý do thu</dt><dd>{selectedReceipt.description}</dd></div>
          <div><dt>Số tiền</dt><dd><strong>{money(selectedReceipt.totalAmount)}</strong></dd></div>
          <div><dt>Viết bằng chữ</dt><dd>{selectedReceipt.amountInWords}</dd></div>
          <div><dt>Phương thức</dt><dd>{selectedReceipt.paymentMethod || 'Theo tài khoản quỹ'}</dd></div>
          <div><dt>Hợp đồng</dt><dd>{selectedReceipt.contractId || '—'}</dd></div>
          <div><dt>Tài khoản quỹ</dt><dd>{accounts.find((item) => item.id === selectedReceipt.accountId)?.name || selectedReceipt.accountId}</dd></div>
          {selectedReceipt.reason && <div><dt>Lý do đảo</dt><dd>{selectedReceipt.reason}</dd></div>}
        </dl>
        <section className="receipt-voucher-document__journal"><h4>Định khoản</h4>{selectedReceipt.journalLines.map((line, index) => <div key={`${line.accountCode}-${index}`}><span>{line.side === 'debit' ? 'Nợ' : 'Có'} {line.accountCode} · {line.accountName}</span><strong>{money(line.debit || line.credit)}</strong></div>)}</section>
        <div className="receipt-voucher-document__links"><span>Ledger: {selectedReceipt.ledgerEntryId}</span><span>Nhật ký: {selectedReceipt.journalEntryId}</span><span>Sổ quỹ: {selectedReceipt.cashTransactionId}</span></div>
        <footer><div><b>Người nộp tiền</b><span>Ký, họ tên</span></div><div><b>Người lập phiếu</b><span>Ký, họ tên</span></div><div><b>Thủ quỹ</b><span>Ký, họ tên</span></div><div><b>Kế toán</b><span>Ký, họ tên</span></div></footer>
      </article>
    </div>}
  </section>
}
