import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import FinanceIntentBoundary from '../../components/admin/pt/FinanceIntentBoundary'
import { listCashAccounts, type CashAccount } from '../../services/cashbookService'
import {
  contractSettlementLabel, getContractSettlement, manageContractSettlement,
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
        if (result.settlement?.proposal) setProposal(result.settlement.proposal)
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
      ...(action === 'submit' ? { proposal: { ...proposal, reason: proposal.reason.trim(), effectiveAt: new Date().toISOString() } } : {}) })
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
  const shownProposal = editing ? proposal : data?.settlement?.proposal
  const proposedAmount = preview && shownProposal ? preview.originalNetValue - shownProposal.waivedFutureAmount + shownProposal.feeAmount - shownProposal.serviceReductionAmount - shownProposal.writeOffAmount : null
  const target = approved ? data?.settlement?.settlementAmount : proposedAmount
  const due = approved ? preview?.dueAmount : undefined
  const refund = approved ? preview?.refundAmount : undefined
  const cashLimit = Math.max(due || 0, refund || 0)
  const refunding = (refund || 0) > 0
  const blocked = Boolean(preview?.blockers.length)
  const fieldsValid = preview && proposal.cutoffDate && proposal.cutoffDate <= today() && proposal.reason.trim().length >= 2
    && [proposal.waivedFutureAmount, proposal.feeAmount, proposal.serviceReductionAmount, proposal.writeOffAmount].every(value => Number.isSafeInteger(value) && value >= 0)
    && proposal.waivedFutureAmount === preview.unservedValue
    && proposal.serviceReductionAmount <= serviceRevenue
    && proposal.writeOffAmount <= Math.max(0, serviceRevenue - proposal.serviceReductionAmount - preview.canonicalCash)
    && (!proposal.feeAmount || proposal.feeReason.trim().length >= 2)
    && (!proposal.serviceReductionAmount || proposal.serviceReductionReason.trim().length >= 2)
    && (!proposal.writeOffAmount || proposal.writeOffReason.trim().length >= 2)
    && proposedAmount !== null && proposedAmount >= 0
  const cashValid = Number.isSafeInteger(Number(cashAmount)) && Number(cashAmount) > 0 && Number(cashAmount) <= cashLimit && cashAccountId && cashReason.trim().length >= 2
  const disabled = busy || loading || Boolean(pendingCommand)

  return <section className="contract-settlement" aria-label="Quyết toán khi hủy">
    <header className="contract-settlement__header"><div><h3>Quyết toán khi hủy</h3><p>Hủy hiệu lực hợp đồng chưa kết thúc nghĩa vụ thanh toán.</p></div><span className={`contract-settlement__status is-${status}`}>{contractSettlementLabel(status)}</span></header>
    {loading && <p role="status">Đang đối soát dịch vụ và tiền đã ghi sổ…</p>}
    {error && <p role="alert" className="contract-settlement__alert">{error}</p>}
    {pendingCommand && !busy && <div className="contract-settlement__actions"><p>Chưa xác định kết quả. Kiểm tra lại cùng yêu cầu trước khi thao tác tiếp.</p><button type="button" onClick={() => void runCommand(pendingCommand)}>Kiểm tra / gửi lại quyết toán</button></div>}
    {!data && !loading && !pendingCommand && <button type="button" onClick={() => void load()}>Tải lại quyết toán</button>}
    {data && preview && <>
      <dl className="contract-settlement__figures"><div><dt>Giá trị sau giảm giá</dt><dd>{money(preview.originalNetValue)}</dd></div><div><dt>Thực thu theo sổ</dt><dd>{money(preview.canonicalCash)}</dd></div><div><dt>Dịch vụ đã ghi nhận</dt><dd>{money(serviceRevenue)}</dd></div><div><dt>Chưa thực hiện</dt><dd>{money(preview.unservedValue)}</dd></div></dl>
      {Boolean(preview.warnings?.length) && <div className="contract-settlement__alert" role="note">{preview.warnings!.map(item => <p key={item.code}>{item.message}</p>)}</div>}
      {blocked && <div role="alert" className="contract-settlement__alert"><strong>Cần xử lý trước khi lập quyết toán</strong><ul>{preview.blockers.map(item => <li key={item.code}>{item.message}</li>)}</ul><p>Xử lý các điểm đối soát rồi tải lại trước khi gửi đề xuất, duyệt hoặc thu/hoàn.</p></div>}
      {editing ? <form onSubmit={event => { event.preventDefault(); if (fieldsValid && !blocked) command('submit') }}>
        <fieldset disabled={disabled}>
          <div className="contract-settlement__form-grid"><label>Ngày chốt dịch vụ<input type="date" required max={today()} value={proposal.cutoffDate} onChange={event => { const value = event.target.value; setProposal(current => ({ ...current, cutoffDate: value })); setCutoff(value) }} /></label><label>Miễn phần chưa thực hiện (đ)<input type="number" required min="0" step="1" value={proposal.waivedFutureAmount} onChange={event => setProposal({ ...proposal, waivedFutureAmount: Number(event.target.value) })} /><small>Nhập đúng {money(preview.unservedValue)} sau khi đối soát.</small></label></div>
          <label>Lý do và thỏa thuận quyết toán<textarea required minLength={2} maxLength={500} rows={2} value={proposal.reason} onChange={event => setProposal({ ...proposal, reason: event.target.value })} /></label>
          <div className="contract-settlement__adjustments">{([
            ['feeAmount', 'feeReason', 'Phí chấm dứt'], ['serviceReductionAmount', 'serviceReductionReason', 'Giảm giá trị dịch vụ đã ghi nhận'], ['writeOffAmount', 'writeOffReason', 'Xóa nợ có phê duyệt'],
          ] as const).map(([amountKey, reasonKey, label]) => <div key={amountKey}><label>{label} (đ)<input type="number" min="0" step="1" required value={proposal[amountKey]} onChange={event => setProposal({ ...proposal, [amountKey]: Number(event.target.value) })} /></label><label>Lý do {label.toLowerCase()}<input required={proposal[amountKey] > 0} maxLength={500} value={proposal[reasonKey]} onChange={event => setProposal({ ...proposal, [reasonKey]: event.target.value })} /></label></div>)}</div>
          <p className="contract-settlement__note">Phí, giảm dịch vụ và xóa nợ mặc định bằng 0. Chỉ xóa nợ dịch vụ còn lại, không gồm phí mới hay tiền đã thu; doanh thu dịch vụ đã ghi nhận được giữ nguyên. Ghi sổ khi duyệt, theo ngày gửi đề xuất.</p>
          {target !== null && target !== undefined && <p className="contract-settlement__target">Nghĩa vụ đề xuất <strong>{money(target)}</strong><small>Giá trị hợp đồng − miễn phần chưa thực hiện + phí − giảm dịch vụ − xóa nợ.</small></p>}
          <button type="submit" className="contract-settlement__primary" disabled={disabled || blocked || !fieldsValid}>{busy ? 'Đang gửi…' : 'Gửi đề xuất quyết toán'}</button>
        </fieldset>
      </form> : shownProposal && <div className="contract-settlement__proposal"><dl><div><dt>Chốt dịch vụ</dt><dd>{shownProposal.cutoffDate}</dd></div><div><dt>Miễn phần chưa thực hiện</dt><dd>{money(shownProposal.waivedFutureAmount)}</dd></div><div><dt>Phí chấm dứt</dt><dd>{money(shownProposal.feeAmount)}{shownProposal.feeReason && <small>{shownProposal.feeReason}</small>}</dd></div><div><dt>Giảm dịch vụ</dt><dd>{money(shownProposal.serviceReductionAmount)}{shownProposal.serviceReductionReason && <small>{shownProposal.serviceReductionReason}</small>}</dd></div><div><dt>Xóa nợ</dt><dd>{money(shownProposal.writeOffAmount)}{shownProposal.writeOffReason && <small>{shownProposal.writeOffReason}</small>}</dd></div></dl><p>{shownProposal.reason}</p></div>}
      {status === 'review_required' && !editing && <p>Chờ nhân sự có quyền tài chính lập đề xuất quyết toán.</p>}
      {status === 'pending_approval' && <div className="contract-settlement__actions">{target !== null && target !== undefined && <p className="contract-settlement__target">Nghĩa vụ đề xuất <strong>{money(target)}</strong></p>}{data.permissions.canApprove && <button type="button" className="contract-settlement__primary" disabled={disabled || blocked} onClick={() => command('approve')}>Duyệt quyết toán</button>}{data.permissions.canSubmit && <button type="button" disabled={disabled} onClick={() => command('withdraw')}>Rút đề xuất để sửa</button>}</div>}
      {approved && <div className="contract-settlement__balance"><p>Nghĩa vụ đã duyệt <strong>{money(target ?? 0)}</strong></p><p>{(due || 0) > 0 ? 'Còn phải thu' : (refund || 0) > 0 ? 'Cần hoàn khách' : 'Chênh lệch còn lại'}<strong>{money(cashLimit)}</strong></p>{status === 'approved' && cashLimit === 0 && <small>Đã cân đối tiền; cần xác nhận hoàn tất quyết toán.</small>}</div>}
      {status === 'approved' && <div className="contract-settlement__actions">{hasCapability('finance.operations.manage') && cashLimit > 0 && !cashOpen && <button type="button" className="contract-settlement__primary" disabled={disabled || blocked} onClick={() => { setCashAmount(String(cashLimit)); setCashReason(''); setCashOpen(true); void loadCash() }}>{refunding ? 'Hoàn tiền quyết toán' : 'Thu tiền quyết toán'}</button>}{data.permissions.canClose && <button type="button" className="contract-settlement__primary" disabled={disabled || blocked || due !== 0 || refund !== 0 || cashOpen} onClick={() => command('close')}>Hoàn tất quyết toán</button>}</div>}
      {cashOpen && status === 'approved' && <div className="contract-settlement__cash"><header><h4>{refunding ? 'Hoàn tiền quyết toán' : 'Thu tiền quyết toán'}</h4><button type="button" onClick={() => { cashReads.current++; setCashOpen(false) }}>Đóng biểu mẫu</button></header><FinanceIntentBoundary contractId={contractId} onCompleted={cashCompleted}>{({ blocked: intentBlocked, busy: cashBusy, submit }) => <form onSubmit={event => { event.preventDefault(); if (!cashValid || blocked || disabled || intentBlocked || cashBusy) return; const payload = { contractId, amount: Number(cashAmount), effectiveAt: new Date().toISOString(), paymentMethod, cashAccountId, expectedPaidAmount: preview.paidProjection, expectedSettlementRevision: data.revision }; void submit(refunding ? { type: 'refund', payload: { ...payload, reason: cashReason.trim() } } : { type: 'payment', payload: { ...payload, note: cashReason.trim() } }) }}><fieldset disabled={intentBlocked || cashBusy || disabled || blocked}>
        <div className="contract-settlement__form-grid"><label>Số tiền quyết toán (đ)<input type="number" required min="1" max={cashLimit} step="1" value={cashAmount} onChange={event => setCashAmount(event.target.value)} /></label><label>Quỹ nhận/chi<select required disabled={cashLoading || Boolean(cashError)} value={cashAccountId} onChange={event => setCashAccountId(event.target.value)}><option value="">Chọn quỹ</option>{cashAccounts.map(item => <option key={item.id} value={item.id}>{item.name} · {money(item.balance)}</option>)}</select></label><label>Phương thức<select value={paymentMethod} onChange={event => setPaymentMethod(event.target.value)}><option value="transfer">Chuyển khoản</option><option value="cash">Tiền mặt</option><option value="wallet">Ví điện tử</option></select></label><label>Nội dung thu/hoàn<input required minLength={2} maxLength={500} value={cashReason} onChange={event => setCashReason(event.target.value)} /></label></div>
        {cashLoading && <p role="status">Đang tải quỹ…</p>}{cashError && <div role="alert"><p>{cashError}</p><button type="button" onClick={() => void loadCash()}>Tải lại quỹ</button></div>}{!cashLoading && !cashError && !cashAccounts.length && <p role="alert">Chưa có quỹ hoạt động của chi nhánh. Kiểm tra Sổ quỹ trước khi thu/hoàn.</p>}
        <p className="contract-settlement__note">Tối đa {money(cashLimit)} theo quyết toán đã duyệt. Giao dịch được ghi qua phiếu thu/hoàn hiện có.</p><button type="submit" className="contract-settlement__primary" disabled={!cashValid || cashLoading || Boolean(cashError) || intentBlocked || cashBusy || disabled || blocked}>{cashBusy ? 'Đang ghi sổ…' : refunding ? 'Ghi khoản hoàn quyết toán' : 'Ghi khoản thu quyết toán'}</button>
      </fieldset></form>}</FinanceIntentBoundary></div>}
      {!cashOpen && !pendingCommand && <button type="button" className="contract-settlement__refresh" disabled={busy || loading} onClick={() => void load()}>Đối soát lại</button>}
    </>}
  </section>
}
