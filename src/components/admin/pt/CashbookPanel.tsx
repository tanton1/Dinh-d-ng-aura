import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, ArrowRightLeft, CheckCircle2, Eye, FilePenLine, Landmark, Plus, Printer, ReceiptText, RefreshCw, RotateCcw, Send, Wallet, X } from 'lucide-react'
import {
  approveAndPostExpenseVoucher,
  createManualReceiptVoucher,
  getS2eCashDetailBook,
  initializeCashAccount,
  listAccountingCatalog,
  listCashAccounts,
  listCashTransactions,
  listExpenseVouchers,
  listReceiptVouchers,
  reverseExpenseVoucher,
  reverseManualReceiptVoucher,
  saveS2eCashDetailSettings,
  saveExpenseVoucherDraft,
  transferCash,
  type CashAccountType,
  type ExpenseVoucher,
  type JournalLine,
  type ReceiptVoucher,
  type S2eCashDetailSettings,
} from '../../../services/cashbookService'
import { reverseContractPayment } from '../../../services/financeLedgerService'
import { useAuth } from '../../../contexts/AuthContext'
import { formatVietnamDate, formatVietnamDateTime, vietnamDateKey, vietnamToday } from '../../../utils/vietnamDate'
import S2eCashDetailBook from './S2eCashDetailBook'
import useCashbookPages from './useCashbookPages'
import './CashbookPanel.css'

type PanelMode = 'none' | 'account' | 'receipt' | 'voucher' | 'transfer'
type LedgerTab = 's2e' | 'receipts' | 'vouchers' | 'cash'

const today = vietnamToday
const monthStart = () => `${today().slice(0, 7)}-01`
const dayAfter = (value: string) => {
  const date = new Date(`${value}T12:00:00+07:00`)
  date.setUTCDate(date.getUTCDate() + 1)
  return date.toISOString().slice(0, 10)
}
const money = (value: number) => `${Math.round(value || 0).toLocaleString('vi-VN')}đ`
const paymentMethodLabels: Record<string, string> = { cash: 'Tiền mặt', bank_transfer: 'Chuyển khoản', e_wallet: 'Ví điện tử' }

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

const emptyReceipt = (accountId = '') => ({ accountId, purposeCode: '', effectiveAt: today(), payerName: '', payerAddress: '', description: '', amount: '', paymentMethod: 'cash' })

function errorMessage(value: unknown, fallback: string) {
  if (!(value instanceof Error)) return fallback
  return value.message.replace(/^Firebase:\s*/i, '').replace(/\(functions\/[\w-]+\)\.?$/i, '').trim() || fallback
}

// A new visit to the same query gets a new identity. Late responses and an
// earlier A -> B -> A visit cannot expose rows from another account or filter.
function useCashbookRead<T>(key: string | null, read: () => Promise<T>) {
  const identity = useMemo(() => ({ key }), [key])
  const reader = useRef(read)
  reader.current = read
  const [result, setResult] = useState<{ identity: typeof identity; data: T | null; error: unknown } | null>(null)
  useEffect(() => {
    if (identity.key === null) { setResult(null); return }
    let active = true
    const run = reader.current
    // StrictMode cleanup and immediately closed surfaces do not start a read.
    void Promise.resolve().then(async () => {
      if (!active) return
      try { const data = await run(); if (active) setResult({ identity, data, error: null }) }
      catch (error) { if (active) setResult({ identity, data: null, error }) }
    })
    return () => { active = false }
  }, [identity])
  const current = key !== null && result?.identity === identity ? result : null
  return { data: current?.data ?? null, error: current?.error ?? null, loading: key !== null && !current }
}

type Props = { branches: Array<{ id: string; name: string }> }
export default function CashbookPanel(props: Props) {
  const { user, profile, authzReady, hasCapability } = useAuth()
  const authority = JSON.stringify([user?.uid, profile?.uid, profile?.role, profile?.accessRole, profile?.authzVersion, profile?.branchId, profile?.disabled, [...(profile?.positions || [])].sort(), authzReady])
  const [blockedAuthority, setBlockedAuthority] = useState<string | null>(null)
  const onAccessDenied = useCallback(() => setBlockedAuthority(authority), [authority])
  if (!authzReady || !user || profile?.uid !== user.uid || profile.disabled || !hasCapability('finance.operations.manage')) return <p role="alert">Cần đăng nhập bằng tài khoản có quyền tài chính để mở sổ quỹ.</p>
  if (blockedAuthority === authority) return <section className="cashbook-panel"><p role="alert">Quyền xem sổ quỹ đã thay đổi. Vui lòng tải lại để kiểm tra quyền hiện tại.</p><button onClick={() => setBlockedAuthority(null)}>Kiểm tra lại quyền</button></section>
  return <CashbookSession key={authority} {...props} onAccessDenied={onAccessDenied} />
}

function CashbookSession({ branches, onAccessDenied }: Props & { onAccessDenied: () => void }) {
  const [selectedAccount, setSelectedAccount] = useState('')
  const [activeTab, setActiveTab] = useState<LedgerTab>('receipts')
  const [periodStart, setPeriodStart] = useState(monthStart())
  const [periodEnd, setPeriodEnd] = useState(today())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [mode, setMode] = useState<PanelMode>('none')
  const [selectedReceipt, setSelectedReceipt] = useState<ReceiptVoucher | null>(null)
  const [voucherStep, setVoucherStep] = useState(1)
  const [voucherForm, setVoucherForm] = useState(emptyVoucher())
  const [receiptForm, setReceiptForm] = useState(emptyReceipt())
  const [basicForm, setBasicForm] = useState({ name: '', type: 'cash' as CashAccountType, branchId: '', amount: '', toAccountId: '' })
  const [refreshVersion, setRefreshVersion] = useState(0)
  const [catalogVersion, setCatalogVersion] = useState(0)
  const mounted = useRef(false)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const accountRead = useCashbookRead(String(refreshVersion), listCashAccounts)
  const pageKey = JSON.stringify([activeTab, selectedAccount, activeTab === 's2e' ? [periodStart, periodEnd] : null, refreshVersion])
  const listRead = useCashbookPages(activeTab === 's2e' ? null : pageKey, async cursor => {
    if (activeTab === 'vouchers') return { kind: 'vouchers' as const, ...await listExpenseVouchers({ accountId: selectedAccount || undefined, pageSize: 25, cursor }) }
    if (activeTab === 'cash') return { kind: 'cash' as const, ...await listCashTransactions({ accountId: selectedAccount || undefined, pageSize: 25, cursor }) }
    return { kind: 'receipts' as const, ...await listReceiptVouchers({ accountId: selectedAccount || undefined, pageSize: 25, cursor }) }
  })
  const s2eRead = useCashbookRead(activeTab === 's2e' ? pageKey : null, async () => {
    return { kind: 's2e' as const, book: await getS2eCashDetailBook({ accountId: selectedAccount || undefined, periodStart: `${periodStart}T00:00:00+07:00`, periodEnd: `${dayAfter(periodEnd)}T00:00:00+07:00` }) }
  })
  const pageRead = activeTab === 's2e' ? s2eRead : listRead
  const needsCatalog = mode === 'receipt' || mode === 'voucher'
  const catalogRead = useCashbookRead(needsCatalog ? JSON.stringify([mode, catalogVersion]) : null, listAccountingCatalog)
  const accounts = accountRead.data?.accounts || []
  const transactions = pageRead.data?.kind === 'cash' ? pageRead.data.transactions : []
  const vouchers = pageRead.data?.kind === 'vouchers' ? pageRead.data.vouchers : []
  const receipts = pageRead.data?.kind === 'receipts' ? pageRead.data.vouchers : []
  const s2eBook = pageRead.data?.kind === 's2e' ? pageRead.data.book : null
  const purposes = catalogRead.data?.expensePurposes || []
  const receiptPurposes = catalogRead.data?.receiptPurposes || []
  const accountingAccounts = catalogRead.data?.accounts || []
  const approvalThreshold = catalogRead.data?.approvalSeparationThreshold || 0
  const catalogReady = Boolean(catalogRead.data)
  const loading = pageRead.loading
  const readErrors = [accountRead.error, pageRead.error, catalogRead.error].filter(Boolean)
  const authorityError = readErrors.some(value => /(?:permission-denied|unauthenticated)$/.test(String((value as { code?: string })?.code || '')))
  // Unmount the entire private session, including drafts and sibling reads.
  useEffect(() => { if (authorityError) onAccessDenied() }, [authorityError, onAccessDenied])
  const load = useCallback(async () => {
    if (!mounted.current) return
    setError('')
    setSelectedReceipt(null)
    setRefreshVersion(value => value + 1)
  }, [])
  const selectAccount = (value: string) => { setSelectedReceipt(null); setSelectedAccount(value) }

  const activeAccounts = useMemo(() => accounts.filter((item) => item.status === 'active'), [accounts])
  const totalBalance = useMemo(() => activeAccounts.reduce((sum, item) => sum + item.balance, 0), [activeAccounts])
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
    setReceiptForm(emptyReceipt(selectedAccount))
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
      effectiveAt: vietnamDateKey(voucher.effectiveAt) || today(),
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

  const openReceipt = () => {
    if (!activeAccounts.length) return setError('Chưa có tài khoản quỹ đang hoạt động. Hãy mở quỹ trước khi lập phiếu thu.')
    setError('')
    setMessage('')
    setMode('receipt')
    setReceiptForm(emptyReceipt(selectedAccount || activeAccounts[0].id))
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
    if (busy || !catalogReady) return
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

  const submitReceipt = async () => {
    if (busy || !catalogReady) return
    const receiptAmount = Number(receiptForm.amount)
    if (!receiptForm.accountId || !receiptForm.purposeCode || !receiptForm.payerName.trim() || !receiptForm.description.trim()) return setError('Hãy nhập đủ tài khoản thu, loại nghiệp vụ, người nộp và nội dung thu.')
    if (!Number.isSafeInteger(receiptAmount) || receiptAmount <= 0) return setError('Số tiền thu phải là số nguyên dương.')
    setBusy(true)
    setError('')
    setMessage('')
    try {
      const result = await createManualReceiptVoucher({
        ...receiptForm,
        amount: receiptAmount,
        effectiveAt: new Date(`${receiptForm.effectiveAt}T12:00:00+07:00`).toISOString(),
        idempotencyKey: crypto.randomUUID(),
      })
      closeForm()
      setActiveTab('receipts')
      setMessage(`Đã ghi sổ ${result.voucherNumber}. Khoản thu chỉ được tính doanh thu theo đúng loại nghiệp vụ đã chọn.`)
      await load()
    } catch (value) {
      setError(errorMessage(value, 'Không thể lập phiếu thu.'))
    } finally { setBusy(false) }
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
      let reversalNumber = 'chứng từ đảo'
      if (receipt.source === 'manual_receipt') {
        const result = await reverseManualReceiptVoucher({ voucherId: receipt.id, reason })
        reversalNumber = result.voucherNumber || reversalNumber
      } else {
        const result = await reverseContractPayment(receipt.ledgerEntryId, reason)
        reversalNumber = result.receiptVoucherNumber || reversalNumber
      }
      setSelectedReceipt(null)
      setMessage(`Đã tạo ${reversalNumber} cho ${receipt.voucherNumber}.`)
      await load()
    } catch (value) {
      setError(errorMessage(value, 'Không thể đảo phiếu thu.'))
    } finally { setBusy(false) }
  }

  const saveS2eSettings = async (settings: S2eCashDetailSettings) => {
    setBusy(true)
    setError('')
    setMessage('')
    try {
      await saveS2eCashDetailSettings(settings)
      setMessage('Đã lưu thông tin hộ/cá nhân kinh doanh trên Mẫu S2e-HKD.')
      await load()
      return true
    } catch (value) {
      setError(errorMessage(value, 'Không thể lưu thông tin Mẫu S2e-HKD.'))
      return false
    } finally {
      setBusy(false)
    }
  }

  if (authorityError) return null

  return <section className="cashbook-panel cashbook-workspace">
    <div className="cashbook-summary">
      <div><span>Số dư các quỹ</span><strong>{accountRead.loading ? '…' : accountRead.error ? 'Chưa tải được' : money(totalBalance)}</strong><small>{accountRead.data ? `${activeAccounts.length} tài khoản đang hoạt động` : 'Đang kiểm tra tài khoản quỹ'}</small></div>
      <Wallet />
    </div>

    <div className="cashbook-controls">
      <div className="cashbook-filters">
        <select value={selectedAccount} onChange={(event) => selectAccount(event.target.value)} aria-label="Lọc theo tài khoản quỹ">
          <option value="">Tất cả tài khoản</option>
          {activeAccounts.map((item) => <option key={item.id} value={item.id}>{item.name} · {money(item.balance)}</option>)}
        </select>
        <button disabled={busy || !selectedAccount || activeAccounts.length < 2} onClick={() => { closeForm(); setMode('transfer') }} aria-label="Chuyển quỹ" title="Chuyển quỹ"><ArrowRightLeft size={15} /><span>Chuyển quỹ</span></button>
        <button disabled={busy || accountRead.loading || loading} onClick={() => { void load(); if (needsCatalog) setCatalogVersion(value => value + 1) }} aria-label="Tải lại" title="Tải lại"><RefreshCw size={15} /></button>
      </div>
      <div className="cashbook-create-actions" aria-label="Lập chứng từ">
        <button disabled={busy || !accountRead.data} onClick={() => { closeForm(); setMode('account') }}><Plus size={15} /> Mở quỹ</button>
        <button disabled={busy || !accountRead.data} onClick={openReceipt} aria-label="Lập phiếu thu"><ReceiptText size={15} /> Lập thu</button>
        <button disabled={busy || !accountRead.data} onClick={() => openVoucher()} aria-label="Lập phiếu chi"><FilePenLine size={15} /> Lập chi</button>
      </div>
    </div>

    {error && <div className="cashbook-error" role="alert">{error}</div>}
    {readErrors.length > 0 && <div className="cashbook-error" role="alert">{errorMessage(readErrors[0], 'Không thể tải dữ liệu sổ quỹ. Vui lòng thử lại.')}</div>}
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

    {needsCatalog && !catalogReady && <div className="cashbook-form"><p role="status">{catalogRead.loading ? 'Đang tải danh mục hạch toán…' : 'Chưa tải được danh mục hạch toán.'}</p>{!catalogRead.loading && <button onClick={() => setCatalogVersion(value => value + 1)}>Thử lại danh mục</button>}<button onClick={closeForm}>Đóng biểu mẫu</button></div>}

    {mode === 'receipt' && catalogReady && <div className="manual-receipt-form">
      <div className="manual-receipt-form__heading"><div><h3>Lập phiếu thu</h3><p>Chỉ khoản “Thu nhập khác” được tính doanh thu khi ghi phiếu.</p></div><button onClick={closeForm} aria-label="Đóng"><X size={18} /></button></div>
      <div className="manual-receipt-form__grid">
        <label>Tài khoản nhận<select value={receiptForm.accountId} onChange={(event) => setReceiptForm((value) => ({ ...value, accountId: event.target.value }))}>{activeAccounts.map((item) => <option key={item.id} value={item.id}>{item.name} · {money(item.balance)}</option>)}</select></label>
        <label>Ngày hạch toán<input type="date" value={receiptForm.effectiveAt} onChange={(event) => setReceiptForm((value) => ({ ...value, effectiveAt: event.target.value }))} /></label>
        <label className="manual-receipt-form__wide">Loại khoản thu<select value={receiptForm.purposeCode} onChange={(event) => setReceiptForm((value) => ({ ...value, purposeCode: event.target.value }))}><option value="">Chọn bản chất nghiệp vụ</option>{receiptPurposes.map((item) => <option key={item.code} value={item.code}>{item.label} · Có {item.creditAccountCode}{item.revenueImpact ? ' · Có tính doanh thu' : ' · Không phải doanh thu'}</option>)}</select></label>
        {receiptForm.purposeCode && <div className={`manual-receipt-form__classification manual-receipt-form__wide ${receiptPurposes.find((item) => item.code === receiptForm.purposeCode)?.revenueImpact ? 'is-revenue' : ''}`}><b>{receiptPurposes.find((item) => item.code === receiptForm.purposeCode)?.revenueImpact ? 'Khoản này được ghi nhận thu nhập' : 'Khoản này chỉ làm tăng tiền, không tăng doanh thu'}</b><span>Bút toán: Nợ tài khoản tiền / Có {receiptPurposes.find((item) => item.code === receiptForm.purposeCode)?.creditAccountCode}</span></div>}
        <label>Người nộp tiền<input value={receiptForm.payerName} onChange={(event) => setReceiptForm((value) => ({ ...value, payerName: event.target.value }))} placeholder="Cá nhân hoặc tổ chức" /></label>
        <label>Địa chỉ<input value={receiptForm.payerAddress} onChange={(event) => setReceiptForm((value) => ({ ...value, payerAddress: event.target.value }))} /></label>
        <label className="manual-receipt-form__wide">Nội dung thu<textarea rows={3} value={receiptForm.description} onChange={(event) => setReceiptForm((value) => ({ ...value, description: event.target.value }))} placeholder="Diễn giải và căn cứ chứng từ" /></label>
        <label>Số tiền<input type="number" min="1" step="1" value={receiptForm.amount} onChange={(event) => setReceiptForm((value) => ({ ...value, amount: event.target.value }))} /></label>
        <label>Phương thức<select value={receiptForm.paymentMethod} onChange={(event) => setReceiptForm((value) => ({ ...value, paymentMethod: event.target.value }))}><option value="cash">Tiền mặt</option><option value="bank_transfer">Chuyển khoản</option><option value="e_wallet">Ví điện tử</option></select></label>
      </div>
      <div className="manual-receipt-form__actions"><button onClick={closeForm}>Hủy</button><button className="cashbook-primary" disabled={busy} onClick={() => void submitReceipt()}><ReceiptText size={16} /> Ghi sổ phiếu thu</button></div>
    </div>}

    {mode === 'voucher' && catalogReady && <div className="expense-voucher">
      <div className="expense-voucher__steps">{['Nghiệp vụ', 'Người nhận', 'Chứng từ', 'Kiểm tra'].map((label, index) => <button key={label} className={voucherStep === index + 1 ? 'is-active' : voucherStep > index + 1 ? 'is-done' : ''} onClick={() => { if (index + 1 < voucherStep) setVoucherStep(index + 1) }}><span>{index + 1}</span>{label}</button>)}</div>
      <div className="expense-voucher__body">
        <div className="expense-voucher__title"><div><h3>{voucherForm.voucherId ? 'Sửa phiếu chi nháp' : 'Lập phiếu chi'}</h3></div><button onClick={closeForm} aria-label="Đóng"><X size={18} /></button></div>
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

    <div className="cashbook-ledger-tabs" aria-label="Sổ quỹ">{([['receipts', 'Phiếu thu'], ['vouchers', 'Phiếu chi'], ['cash', 'Biến động quỹ'], ['s2e', 'Sổ S2e-HKD']] as const).map(([tab, label]) => <button key={tab} className={activeTab === tab ? 'is-active' : ''} aria-pressed={activeTab === tab} onClick={() => { setSelectedReceipt(null); setActiveTab(tab) }}>{label}</button>)}</div>
    {activeTab !== 's2e' && loading && <p role="status">Đang tải sổ quỹ…</p>}
    {listRead.data && <div className="cashbook-page-summary" role="status"><p>{listRead.data.kind === 'cash' ? transactions.length : listRead.data.vouchers.length} chứng từ đã tải.</p><small>Cập nhật {formatVietnamDateTime(listRead.data.asOf)}</small></div>}

    {activeTab === 's2e' && <S2eCashDetailBook
      book={s2eBook}
      busy={busy}
      loading={loading}
      periodStart={periodStart}
      periodEnd={periodEnd}
      onPeriodStartChange={setPeriodStart}
      onPeriodEndChange={setPeriodEnd}
      onRefresh={() => void load()}
      onSaveSettings={saveS2eSettings}
    />}

    {activeTab === 'receipts' && <div className="expense-voucher-list receipt-voucher-list">{receipts.map((receipt) => <article key={receipt.listIdentity || receipt.id}>
      <div className="expense-voucher-list__main"><div><ReceiptText size={16} /><b>{receipt.voucherNumber}</b><span className={`expense-voucher-status status-${receipt.status}`}>{statusLabels[receipt.status]}</span></div><p>{receipt.payerName} · {accounts.find((item) => item.id === receipt.accountId)?.name || 'Quỹ đã lưu'}</p><small>{formatVietnamDate(receipt.effectiveAt)} · {receipt.description}</small></div>
      <div className="expense-voucher-list__amount"><strong className={receipt.documentType === 'receipt_voucher_reversal' ? 'negative' : 'positive'}>{receipt.documentType === 'receipt_voucher_reversal' ? '−' : '+'}{money(receipt.totalAmount)}</strong><div><button onClick={() => setSelectedReceipt(receipt)}><Eye size={15} /> Xem / In</button>{receipt.status === 'posted' && receipt.documentType === 'receipt_voucher' && <button disabled={busy || !receipt.ledgerEntryId} onClick={() => void reverseReceipt(receipt)}><RotateCcw size={15} /> Đảo phiếu</button>}</div></div>
    </article>)}{!loading && !pageRead.error && !listRead.data?.hasMore && receipts.length === 0 && <p>Chưa có phiếu thu trong quỹ đã chọn.</p>}</div>}

    {activeTab === 'vouchers' && <div className="expense-voucher-list">{vouchers.map((voucher) => <article key={voucher.id}>
      <div className="expense-voucher-list__main"><div><b>{voucher.voucherNumber}</b><span className={`expense-voucher-status status-${voucher.status}`}>{statusLabels[voucher.status]}</span></div><p>{voucher.purposeLabel} · {voucher.payeeName}</p><small>{formatVietnamDate(voucher.effectiveAt)} · {voucher.description}</small></div>
      <div className="expense-voucher-list__amount"><strong>{money(voucher.totalAmount)}</strong><div>{voucher.status === 'draft' && <button onClick={() => openVoucher(voucher)}><FilePenLine size={15} /> Sửa</button>}{voucher.status === 'pending_approval' && <button className="cashbook-primary" disabled={busy} onClick={() => void approveVoucher(voucher)}><CheckCircle2 size={15} /> Duyệt & ghi sổ</button>}{voucher.status === 'posted' && voucher.documentType === 'expense_voucher' && <button disabled={busy} onClick={() => void reverseVoucher(voucher)}><RotateCcw size={15} /> Đảo phiếu</button>}</div></div>
    </article>)}{!loading && !pageRead.error && !listRead.data?.hasMore && vouchers.length === 0 && <p>Chưa có phiếu chi.</p>}</div>}

    {activeTab === 'cash' && <div className="cashbook-list">{transactions.map((item) => <article key={item.id}><div><b>{item.referenceCode}</b><span>{item.category || item.type} · {formatVietnamDateTime(item.effectiveAt)}</span></div><strong className={item.amount >= 0 ? 'positive' : 'negative'}>{money(item.amount)}</strong></article>)}{!loading && !pageRead.error && !listRead.data?.hasMore && transactions.length === 0 && <p>Chưa có giao dịch. Hãy mở quỹ bằng số dư đã kiểm kê tại ngày chuyển đổi.</p>}</div>}

    {listRead.data?.hasMore && <div className="cashbook-pagination">
      {receipts.length + vouchers.length + transactions.length === 0 && <p>Chưa có chứng từ phù hợp trong phần đã tải. Tiếp tục tải thêm.</p>}
      {listRead.refreshRequired ? <button onClick={() => void load()} disabled={busy}>Tải lại danh sách</button>
        : <button onClick={listRead.loadMore} disabled={busy || listRead.appending}>{listRead.appending ? 'Đang tải thêm…' : listRead.error ? 'Thử tải thêm' : 'Tải thêm'}</button>}
    </div>}

    {selectedReceipt && <div className="receipt-voucher-modal" role="dialog" aria-modal="true" aria-label={`Phiếu thu ${selectedReceipt.voucherNumber}`} onClick={() => setSelectedReceipt(null)}>
      <article className="receipt-voucher-document" onClick={(event) => event.stopPropagation()}>
        <div className="receipt-voucher-document__toolbar"><span>{selectedReceipt.derived ? 'Phiếu đối soát từ sổ tài chính lịch sử · Chỉ đọc' : 'Chứng từ gốc · Đã liên kết sổ quỹ'}</span><div><button onClick={() => window.print()}><Printer size={16} /> In phiếu</button><button onClick={() => setSelectedReceipt(null)}><X size={16} /> Đóng</button></div></div>
        <header><div><b>AURA FITNESS</b><small>Chứng từ kế toán điện tử</small></div><div><strong>{selectedReceipt.documentType === 'receipt_voucher_reversal' ? 'PHIẾU THU ĐẢO' : 'PHIẾU THU'}</strong><small>Số: {selectedReceipt.voucherNumber}</small></div></header>
        <div className="receipt-voucher-document__date">Ngày {formatVietnamDate(selectedReceipt.effectiveAt) || '—'}</div>
        <dl className="receipt-voucher-document__fields">
          <div><dt>Người nộp tiền</dt><dd>{selectedReceipt.payerName}</dd></div>
          <div><dt>Địa chỉ</dt><dd>{selectedReceipt.payerAddress || 'Không ghi nhận'}</dd></div>
          <div><dt>Lý do thu</dt><dd>{selectedReceipt.description}</dd></div>
          <div><dt>Số tiền</dt><dd><strong>{money(selectedReceipt.totalAmount)}</strong></dd></div>
          <div><dt>Viết bằng chữ</dt><dd>{selectedReceipt.amountInWords}</dd></div>
          <div><dt>Phương thức</dt><dd>{paymentMethodLabels[selectedReceipt.paymentMethod] || selectedReceipt.paymentMethod || 'Theo tài khoản quỹ'}</dd></div>
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
