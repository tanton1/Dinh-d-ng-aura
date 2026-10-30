import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import FinanceIntentBoundary from '../../components/admin/pt/FinanceIntentBoundary'
import { listCashAccounts, type CashAccount } from '../../services/cashbookService'
import {
  getContractSettlement, manageContractSettlement,
  type ContractSettlementCommand, type ContractSettlementProposal, type ContractSettlementResponse,
} from '../../services/contractSettlementService'
import type { FinanceIntentOutcome } from '../../services/financeOperationIntent'
import './ContractSettlementPanel.css'

interface Props {
  contractId: string
  branchId: string | null
  onChanged: () => Promise<void>
}

const money = (value: number) => `${value.toLocaleString('vi-VN')}đ`
const today = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date())
const blankProposal = (): ContractSettlementProposal => ({ cutoffDate: '', reason: '', waivedFutureAmount: 0, feeAmount: 0, feeReason: '', serviceReductionAmount: 0, serviceReductionReason: '', writeOffAmount: 0, writeOffReason: '', effectiveAt: new Date().toISOString() })
const errorMessage = (cause: unknown) => cause instanceof Error ? cause.message : 'Chưa tải được quyết toán. Hãy thử lại.'
const adjustmentFields = [
  ['feeAmount', 'feeReason', 'Phí chấm dứt'],
  ['serviceReductionAmount', 'serviceReductionReason', 'Giảm giá trị dịch vụ đã ghi nhận'],
  ['writeOffAmount', 'writeOffReason', 'Xóa nợ có phê duyệt'],
] as const
const statusLabels = { review_required: 'Cần kiểm tra', pending_approval: 'Chờ duyệt', approved: 'Đã duyệt', settled: 'Đã hoàn tất' }

export default function ContractSettlementPanel(props: Props) {
  const { user, profile, authzReady } = useAuth()
  const authority = JSON.stringify([props.contractId, user?.uid, profile?.uid, profile?.role, profile?.accessRole, profile?.authzVersion, profile?.disabled, profile?.branchId, [...(profile?.positions || [])].sort(), authzReady])
  return <SettlementSession key={authority} {...props} />
}

function SettlementSession({ contractId, branchId, onChanged }: Props) {
  const { hasCapability } = useAuth()
  const [data, setData] = useState<ContractSettlementResponse | null>(null)
  const [proposal, setProposal] = useState(blankProposal)
  const [cutoff, setCutoff] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [pendingCommand, setPendingCommand] = useState<ContractSettlementCommand | null>(null)
  const [cashOpen, setCashOpen] = useState(false)
  const [cashAccounts, setCashAccounts] = useState<CashAccount[]>([])
  const [cashLoading, setCashLoading] = useState(false)
  const [cashError, setCashError] = useState('')
  const [cashAccountId, setCashAccountId] = useState('')
  const [cashAmount, setCashAmount] = useState('')
  const [cashReason, setCashReason] = useState('')
  const [paymentMethod, setPaymentMethod] = useState('transfer')
  const alive = useRef(false)
  const reads = useRef(0)
  const cashReads = useRef(0)
  const mutationRunning = useRef(false)
  const initialized = useRef(false)

  useEffect(() => { alive.current = true; return () => { alive.current = false; reads.current++; cashReads.current++ } }, [])

  const load = useCallback(async () => {
    const sequence = ++reads.current
    setLoading(true)
    setError('')
    setData(null)
    try {
      const result = await getContractSettlement({ contractId, ...(cutoff ? { cutoffDate: cutoff } : {}) })
      if (!alive.current || sequence !== reads.current) return
      setData(result)
      if (!initialized.current) {
        initialized.current = true
        setProposal(current => result.settlement?.proposal || { ...current, cutoffDate: result.preview.cutoffDate || '' })
      }
    } catch (cause) { if (alive.current && sequence === reads.current) setError(errorMessage(cause)) }
    finally { if (alive.current && sequence === reads.current) setLoading(false) }
  }, [contractId, cutoff])

  useEffect(() => { void load(); return () => { reads.current++ } }, [load])

  const runCommand = async (command: ContractSettlementCommand) => {
    if (mutationRunning.current) return
    mutationRunning.current = true
    setBusy(true)
    setError('')
    setPendingCommand(command)
    reads.current++
    try {
      const result = await manageContractSettlement(command)
      if (!alive.current) return
      setData(result)
      setPendingCommand(null)
      if (result.settlement?.proposal) setProposal(result.settlement.proposal)
      await onChanged()
    } catch (cause) {
      if (alive.current) {
        setError(errorMessage(cause))
        const code = cause && typeof cause === 'object' && 'code' in cause ? String(cause.code) : ''
        // A definitive rejection did not commit. Network/unknown outcomes keep
        // their exact command for idempotent recovery instead.
        if (/invalid-argument|failed-precondition|aborted|permission-denied|not-found/.test(code)) {
          setPendingCommand(null)
          setData(null)
        }
      }
    }
    finally { mutationRunning.current = false; if (alive.current) setBusy(false) }
  }

  const command = (action: ContractSettlementCommand['action']) => {
    if (!data || busy || pendingCommand) return
    void runCommand({ contractId, action, operationId: crypto.randomUUID(), expectedRevision: data.revision, expectedSnapshotHash: data.preview.snapshotHash,
      ...(action === 'submit' ? { proposal: { ...proposal, waivedFutureAmount: data.preview.unservedValue, reason: proposal.reason.trim(), effectiveAt: new Date().toISOString() } } : {}) })
  }

  const loadCash = async () => {
    const sequence = ++cashReads.current
    setCashLoading(true)
    setCashAccounts([])
    setCashAccountId('')
    setCashError('')
    try {
      const result = await listCashAccounts()
      if (!alive.current || sequence !== cashReads.current) return
      const accounts = result.accounts.filter(item => item.status === 'active' && (!branchId || item.branchId === branchId))
      setCashAccounts(accounts)
      setCashAccountId(accounts[0]?.id || '')
    } catch (cause) { if (alive.current && sequence === cashReads.current) setCashError(errorMessage(cause)) }
    finally { if (alive.current && sequence === cashReads.current) setCashLoading(false) }
  }

  const cashCompleted = async (_outcome: FinanceIntentOutcome) => {
    if (!alive.current) return
    setCashOpen(false)
    cashReads.current++
    await load()
    if (alive.current) await onChanged()
  }

  const preview = data?.preview
  const serviceRevenue = preview?.serviceRecognizedRevenue ?? preview?.recognizedRevenue ?? 0
  const status = data?.status || 'review_required'
  const editing = status === 'review_required' && Boolean(data?.permissions.canSubmit)
  const approved = status === 'approved' || status === 'settled'
  const shownProposal = editing ? { ...proposal, waivedFutureAmount: preview?.unservedValue ?? 0 } : data?.settlement?.proposal
  const proposedAmount = preview && shownProposal ? preview.originalNetValue - shownProposal.waivedFutureAmount + shownProposal.feeAmount - shownProposal.serviceReductionAmount - shownProposal.writeOffAmount : null
  const target = approved ? data?.settlement?.settlementAmount : proposedAmount
  const due = approved ? preview?.dueAmount : undefined
  const refund = approved ? preview?.refundAmount : undefined
  const cashLimit = Math.max(due || 0, refund || 0)
  const refunding = (refund || 0) > 0
  const blocked = Boolean(preview?.blockers.length)
  const fieldsValid = preview && proposal.cutoffDate && proposal.cutoffDate <= today() && proposal.reason.trim().length >= 2
    && (!preview.cutoffDate || proposal.cutoffDate === preview.cutoffDate)
    && [preview.unservedValue, proposal.feeAmount, proposal.serviceReductionAmount, proposal.writeOffAmount].every(value => Number.isSafeInteger(value) && value >= 0)
    && proposal.serviceReductionAmount <= serviceRevenue
    && proposal.writeOffAmount <= Math.max(0, serviceRevenue - proposal.serviceReductionAmount - preview.canonicalCash)
    && (!proposal.feeAmount || proposal.feeReason.trim().length >= 2)
    && (!proposal.serviceReductionAmount || proposal.serviceReductionReason.trim().length >= 2)
    && (!proposal.writeOffAmount || proposal.writeOffReason.trim().length >= 2)
    && proposedAmount !== null && proposedAmount >= 0
  const cashValid = Number.isSafeInteger(Number(cashAmount)) && Number(cashAmount) > 0 && Number(cashAmount) <= cashLimit && cashAccountId && cashReason.trim().length >= 2
  const disabled = busy || loading || Boolean(pendingCommand)
  const adjustments = adjustmentFields.filter(([amountKey]) => (shownProposal?.[amountKey] ?? 0) > 0)
  const balance = approved ? cashLimit : Math.abs((target ?? serviceRevenue) - (preview?.canonicalCash ?? 0))
  const resultRefunding = approved ? refunding : (target ?? serviceRevenue) < (preview?.canonicalCash ?? 0)
  const balanceLabel = balance === 0 ? (approved ? 'Không còn chênh lệch' : 'Dự kiến không thu / hoàn')
    : `${approved ? '' : 'Dự kiến '}${resultRefunding ? (approved ? 'Cần hoàn khách' : 'hoàn khách') : (approved ? 'Cần thu thêm' : 'cần thu thêm')}`

  return <section className="contract-settlement" aria-label="Quyết toán khi nghỉ">
    <header className="contract-settlement__header"><h3>Quyết toán khi nghỉ</h3><span className={`contract-settlement__status is-${status}`}>{statusLabels[status]}</span></header>
    {loading && <p role="status">Đang tính số tiền…</p>}
    {error && <p role="alert" className="contract-settlement__alert">{error}</p>}
    {pendingCommand && !busy && <div className="contract-settlement__actions"><p>Chưa nhận được kết quả. Kiểm tra lại yêu cầu vừa gửi.</p><button type="button" onClick={() => void runCommand(pendingCommand)}>Kiểm tra kết quả</button></div>}
    {!data && !loading && !pendingCommand && <button type="button" onClick={() => void load()}>Tải lại</button>}
    {data && preview && <>
      <dl className="contract-settlement__figures"><div><dt>Đã thu</dt><dd>{money(preview.canonicalCash)}</dd></div><div><dt>Dịch vụ đã dùng</dt><dd>{money(serviceRevenue)}</dd></div></dl>
      <div className="contract-settlement__result" data-testid="settlement-result" aria-live="polite"><span>{balanceLabel}</span><strong>{money(balance)}</strong>{approved && status !== 'settled' && cashLimit === 0 && <small>Đã cân đối. Xác nhận hoàn tất hồ sơ.</small>}</div>
      {Boolean(preview.warnings?.length) && <div className="contract-settlement__alert" role="note">{preview.warnings!.map(item => <p key={item.code}>{item.message}</p>)}</div>}
      {blocked && <div role="alert" className="contract-settlement__alert"><strong>Cần kiểm tra trước khi tiếp tục</strong><ul>{preview.blockers.map(item => <li key={item.code}>{item.message}</li>)}</ul></div>}
      {editing ? <form onSubmit={event => { event.preventDefault(); if (fieldsValid && !blocked) command('submit') }}>
        <fieldset disabled={disabled}>
          <div className="contract-settlement__form-grid"><label>Ngày nghỉ<input type="date" required max={today()} value={proposal.cutoffDate} onChange={event => { const value = event.target.value; setProposal(current => ({ ...current, cutoffDate: value })); setCutoff(value) }} /></label><label>Lý do nghỉ<textarea required minLength={2} maxLength={500} rows={2} value={proposal.reason} placeholder="Theo thỏa thuận với học viên" onChange={event => setProposal({ ...proposal, reason: event.target.value })} /></label></div>
          <p className="contract-settlement__waiver" data-testid="settlement-waiver">Không thu phần chưa tập: <strong>{money(preview.unservedValue)}</strong></p>
          <details className="contract-settlement__details"><summary>Điều chỉnh thêm{adjustments.length > 0 && <span>{adjustments.length} khoản</span>}</summary>
            <div className="contract-settlement__adjustments">{adjustmentFields.map(([amountKey, reasonKey, label]) => <div key={amountKey}><label>{label} (đ)<input type="number" min="0" step="1" required value={proposal[amountKey]} onChange={event => setProposal({ ...proposal, [amountKey]: Number(event.target.value) })} /></label>{proposal[amountKey] > 0 && <label>Lý do {label.toLowerCase()}<input required minLength={2} maxLength={500} value={proposal[reasonKey]} onChange={event => setProposal({ ...proposal, [reasonKey]: event.target.value })} /></label>}</div>)}</div>
            <p className="contract-settlement__note">Chỉ nhập khi có thỏa thuận riêng. Xóa nợ chỉ áp dụng cho dịch vụ đã dùng còn chưa trả.</p>
          </details>
          {adjustments.length > 0 && <ul className="contract-settlement__adjustment-summary" data-testid="settlement-adjustment-summary">{adjustments.map(([amountKey, reasonKey, label]) => <li key={amountKey}><span>{label}: <strong>{money(proposal[amountKey])}</strong></span>{proposal[reasonKey] && <small>{proposal[reasonKey]}</small>}</li>)}</ul>}
          <button type="submit" className="contract-settlement__primary" disabled={disabled || blocked || !fieldsValid}>{busy ? 'Đang gửi…' : 'Gửi duyệt'}</button>
        </fieldset>
      </form> : shownProposal && <div className="contract-settlement__proposal"><p>Ngày nghỉ: <strong>{shownProposal.cutoffDate.split('-').reverse().join('/')}</strong> · {shownProposal.reason}</p><p data-testid="settlement-waiver">Không thu phần chưa tập: <strong>{money(shownProposal.waivedFutureAmount)}</strong></p>{adjustments.length > 0 && <ul className="contract-settlement__adjustment-summary" data-testid="settlement-adjustment-summary">{adjustments.map(([amountKey, reasonKey, label]) => <li key={amountKey}><span>{label}: <strong>{money(shownProposal[amountKey])}</strong></span><small>{shownProposal[reasonKey]}</small></li>)}</ul>}</div>}
      {status === 'review_required' && !editing && <p>Chờ người phụ trách tài chính xử lý.</p>}
      {status === 'pending_approval' && <div className="contract-settlement__actions">{data.permissions.canApprove && <button type="button" className="contract-settlement__primary" disabled={disabled || blocked} onClick={() => command('approve')}>Xác nhận duyệt</button>}{data.permissions.canSubmit && <button type="button" disabled={disabled} onClick={() => command('withdraw')}>Sửa đề xuất</button>}</div>}
      {status === 'approved' && <div className="contract-settlement__actions">{hasCapability('finance.operations.manage') && cashLimit > 0 && !cashOpen && <button type="button" className="contract-settlement__primary" disabled={disabled || blocked} onClick={() => { setCashAmount(String(cashLimit)); setCashReason(`${refunding ? 'Hoàn tiền' : 'Thu tiền'} khi học viên nghỉ`); setCashOpen(true); void loadCash() }}>{refunding ? 'Hoàn tiền' : 'Thu tiền'}</button>}{data.permissions.canClose && due === 0 && refund === 0 && <button type="button" className="contract-settlement__primary" disabled={disabled || blocked || cashOpen} onClick={() => command('close')}>Hoàn tất</button>}</div>}
      {cashOpen && status === 'approved' && <div className="contract-settlement__cash"><header><h4>{refunding ? 'Hoàn tiền' : 'Thu tiền'}</h4><button type="button" onClick={() => { cashReads.current++; setCashOpen(false) }}>Đóng biểu mẫu</button></header><FinanceIntentBoundary contractId={contractId} onCompleted={cashCompleted}>{({ blocked: intentBlocked, busy: cashBusy, submit }) => <form onSubmit={event => { event.preventDefault(); if (!cashValid || blocked || disabled || intentBlocked || cashBusy) return; const payload = { contractId, amount: Number(cashAmount), effectiveAt: new Date().toISOString(), paymentMethod, cashAccountId, expectedPaidAmount: preview.paidProjection, expectedSettlementRevision: data.revision }; void submit(refunding ? { type: 'refund', payload: { ...payload, reason: cashReason.trim() } } : { type: 'payment', payload: { ...payload, note: cashReason.trim() } }) }}><fieldset disabled={intentBlocked || cashBusy || disabled || blocked}>
        <div className="contract-settlement__form-grid"><label>Số tiền quyết toán (đ)<input type="number" required min="1" max={cashLimit} step="1" value={cashAmount} onChange={event => setCashAmount(event.target.value)} /></label><label>Quỹ nhận/chi<select required disabled={cashLoading || Boolean(cashError)} value={cashAccountId} onChange={event => setCashAccountId(event.target.value)}><option value="">Chọn quỹ</option>{cashAccounts.map(item => <option key={item.id} value={item.id}>{item.name} · {money(item.balance)}</option>)}</select></label><label>Phương thức<select value={paymentMethod} onChange={event => setPaymentMethod(event.target.value)}><option value="transfer">Chuyển khoản</option><option value="cash">Tiền mặt</option><option value="wallet">Ví điện tử</option></select></label><label>Nội dung thu/hoàn<input required minLength={2} maxLength={500} value={cashReason} onChange={event => setCashReason(event.target.value)} /></label></div>
        {cashLoading && <p role="status">Đang tải quỹ…</p>}{cashError && <div role="alert"><p>{cashError}</p><button type="button" onClick={() => void loadCash()}>Tải lại quỹ</button></div>}{!cashLoading && !cashError && !cashAccounts.length && <p role="alert">Chưa có quỹ hoạt động của chi nhánh. Kiểm tra Sổ quỹ trước khi thu/hoàn.</p>}
        <p className="contract-settlement__note">Tối đa {money(cashLimit)} theo số đã duyệt.</p><button type="submit" className="contract-settlement__primary" disabled={!cashValid || cashLoading || Boolean(cashError) || intentBlocked || cashBusy || disabled || blocked}>{cashBusy ? 'Đang lưu…' : refunding ? 'Lưu phiếu hoàn' : 'Lưu phiếu thu'}</button>
      </fieldset></form>}</FinanceIntentBoundary></div>}
      <details className="contract-settlement__details contract-settlement__calculation"><summary>Chi tiết cách tính</summary><dl><div><dt>Giá trị hợp đồng</dt><dd>{money(preview.originalNetValue)}</dd></div><div><dt>Phần chưa tập</dt><dd>{money(preview.unservedValue)}</dd></div>{target !== null && target !== undefined && <div><dt>{approved ? 'Tổng phải trả đã duyệt' : 'Tổng phải trả dự kiến'}</dt><dd>{money(target)}</dd></div>}</dl><p className="contract-settlement__note">Dịch vụ đã dùng + phí − giảm dịch vụ − xóa nợ. So với tiền đã thu để tính phần thu thêm hoặc hoàn lại.</p></details>
      {!cashOpen && !pendingCommand && status !== 'settled' && <button type="button" className="contract-settlement__refresh" disabled={busy || loading} onClick={() => void load()}>Cập nhật</button>}
    </>}
  </section>
}
