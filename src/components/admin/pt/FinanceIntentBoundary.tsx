import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useAuth } from '../../../contexts/AuthContext'
import {
  beginFinanceIntent, financeIntentOwnerKey, listPendingFinanceIntents, readFinanceIntent,
  settleFinanceIntent, subscribeFinanceIntentChanges,
  type FinanceIntentOutcome, type FinanceIntentRecord, type FinanceIntentScope, type FinanceOperationDraft,
} from '../../../services/financeOperationIntent'
import { financeIntentProjectId, manageFinanceOperation } from '../../../services/financeOperationService'
import './FinanceIntentBoundary.css'

interface Controls {
  blocked: boolean
  busy: boolean
  submit: (draft: FinanceOperationDraft) => Promise<void>
}
interface Props {
  contractId: string
  onCompleted: (outcome: FinanceIntentOutcome) => void | Promise<void>
  children?: (controls: Controls) => ReactNode
}

function useFinanceOwner() {
  const { user, profile, authzReady, hasCapability, backendMode } = useAuth()
  const ownerUid = backendMode === 'firebase' && authzReady && user?.uid && profile?.uid === user.uid && !profile.disabled && hasCapability('finance.operations.manage') ? user.uid : ''
  const authority = JSON.stringify([user?.uid, profile?.uid, profile?.role, profile?.accessRole, profile?.authzVersion, profile?.disabled, profile?.branchId, [...(profile?.positions || [])].sort(), ownerUid])
  return { ownerUid, authority }
}

function message(cause: unknown) {
  return cause instanceof Error ? cause.message : 'Chưa xác định được kết quả. Yêu cầu gốc vẫn được giữ để kiểm tra lại.'
}

const buttonClass = 'finance-intent-button'

export default function FinanceIntentBoundary(props: Props) {
  const { ownerUid, authority } = useFinanceOwner()
  if (!ownerUid || !financeIntentProjectId) return <>
    <p role="alert">Cần đăng nhập bằng tài khoản có quyền tài chính để ghi nhận giao dịch.</p>
    {props.children?.({ blocked: true, busy: false, submit: async () => {} })}
  </>
  return <IntentSession key={JSON.stringify([authority, props.contractId])} {...props} scope={{ ownerUid, projectId: financeIntentProjectId, contractId: props.contractId }} />
}

function IntentSession({ scope, children, onCompleted }: Props & { scope: FinanceIntentScope }) {
  const [record, setRecord] = useState<FinanceIntentRecord | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [storageFailed, setStorageFailed] = useState(false)
  const [stale, setStale] = useState(false)
  const alive = useRef(false)
  const running = useRef(false)
  const initialRevision = useRef<number | null>(null)
  const readSequence = useRef(0)
  const completion = useRef(onCompleted)
  completion.current = onCompleted

  useEffect(() => {
    alive.current = true
    const load = async () => {
      const sequence = ++readSequence.current
      try {
        const current = await readFinanceIntent(scope)
        if (!alive.current || sequence !== readSequence.current) return
        if (initialRevision.current === null) initialRevision.current = current?.revision || 0
        else if (current?.outcome && current.revision !== initialRevision.current && !running.current) setStale(true)
        setRecord(current)
        setStorageFailed(false)
      } catch (cause) {
        if (alive.current && sequence === readSequence.current) { setError(message(cause)); setStorageFailed(true) }
      } finally { if (alive.current && sequence === readSequence.current) setLoading(false) }
    }
    void load()
    const unsubscribe = subscribeFinanceIntentChanges(financeIntentOwnerKey(scope), () => { void load() })
    return () => { alive.current = false; readSequence.current++; unsubscribe() }
    // The outer boundary remounts on authority or contract changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const process = async (current: FinanceIntentRecord, action: 'submit' | 'cancel') => {
    if (!alive.current) return
    const outcome = current.outcome || await manageFinanceOperation(scope.ownerUid, action, current.operation)
    // A response can settle its original owner's local record after sign-out,
    // but must never update the new owner's visible workspace.
    const settled = await settleFinanceIntent(scope, current.operation.payload.idempotencyKey, outcome)
    if (!alive.current) return
    setRecord(settled)
    setStale(true)
    await completion.current(outcome)
  }

  const run = async (action: () => Promise<void>) => {
    if (!alive.current || running.current) return
    running.current = true
    setBusy(true)
    setError('')
    try { await action() }
    catch (cause) { if (alive.current) setError(message(cause)) }
    finally { running.current = false; if (alive.current) setBusy(false) }
  }

  const submit = async (draft: FinanceOperationDraft) => {
    if (loading || storageFailed || stale || initialRevision.current === null) return
    await run(async () => {
      const intent = await beginFinanceIntent(scope, draft, initialRevision.current!)
      if (!alive.current) return
      setRecord(intent.record)
      if (!intent.created) {
        setError('Có yêu cầu trước chưa rõ kết quả. Hãy kiểm tra yêu cầu đó trước khi ghi khoản mới.')
        return
      }
      await process(intent.record, 'submit')
    })
  }

  const recover = (action: 'submit' | 'cancel') => run(async () => {
    const current = await readFinanceIntent(scope)
    if (!current || current.operation.payload.idempotencyKey !== record?.operation.payload.idempotencyKey) throw new Error('Yêu cầu đã thay đổi ở tab khác. Hãy đóng và mở lại màn hình.')
    await process(current, action)
  })

  const pending = record && !record.outcome ? record : null
  const type = pending?.operation.type
  return <>
    {loading && <p role="status" className="finance-intent-status">Đang kiểm tra yêu cầu đã lưu trên thiết bị…</p>}
    {error && <p role="alert" className="finance-intent-error">{error}</p>}
    {pending && <section aria-label="Yêu cầu tài chính chưa rõ kết quả" className="finance-intent-panel">
      <strong>{type === 'payment' ? 'Khoản thu' : type === 'refund' ? 'Khoản hoàn tiền' : 'Bút toán đảo'} đang chờ xác định kết quả</strong>
      {'amount' in pending.operation.payload && <p className="finance-intent-amount">{pending.operation.payload.amount.toLocaleString('vi-VN')}đ</p>}
      <p>Yêu cầu lúc {new Date(pending.createdAt).toLocaleString('vi-VN')}. Thông tin ban đầu được giữ nguyên khi kiểm tra lại.</p>
      <div className="finance-intent-actions"><button type="button" className={`${buttonClass} finance-intent-button--primary`} disabled={busy || storageFailed} onClick={() => void recover('submit')}>{busy ? 'Đang kiểm tra…' : 'Kiểm tra / gửi lại yêu cầu'}</button><button type="button" className={buttonClass} disabled={busy || storageFailed} onClick={() => void recover('cancel')}>Dừng yêu cầu chưa ghi</button></div>
      <p className="finance-intent-note">Dừng yêu cầu chỉ ngăn giao dịch chưa ghi nhận. Nếu đã ghi thành công, Aura sẽ trả lại chứng từ đã có.</p>
    </section>}
    {stale && !pending && <p role="status" className="finance-intent-status">Kết quả đã được cập nhật. Hãy đóng và mở lại biểu mẫu để ghi khoản mới.</p>}
    {children?.({ blocked: loading || storageFailed || stale || Boolean(pending), busy, submit })}
  </>
}

export function FinancePendingOperations({ contractId, describeContract, onCompleted }: { contractId?: string; describeContract?: (id: string) => string; onCompleted: (outcome: FinanceIntentOutcome) => void | Promise<void> }) {
  const { ownerUid, authority } = useFinanceOwner()
  if (!ownerUid || !financeIntentProjectId) return null
  return <PendingList key={JSON.stringify([authority, contractId])} ownerUid={ownerUid} contractId={contractId} describeContract={describeContract} onCompleted={onCompleted} />
}

function PendingList({ ownerUid, contractId, describeContract, onCompleted }: { ownerUid: string; contractId?: string; describeContract?: (id: string) => string; onCompleted: (outcome: FinanceIntentOutcome) => void | Promise<void> }) {
  const [records, setRecords] = useState<FinanceIntentRecord[]>([])
  const [selected, setSelected] = useState<FinanceIntentRecord | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true, sequence = 0
    const owner = { ownerUid, projectId: financeIntentProjectId }
    const load = async () => {
      const request = ++sequence
      try { const rows = await listPendingFinanceIntents(owner); if (active && sequence === request) { setRecords(rows); setError('') } }
      catch (cause) { if (active && sequence === request) setError(message(cause)) }
    }
    void load()
    const unsubscribe = subscribeFinanceIntentChanges(financeIntentOwnerKey(owner), () => { void load() })
    return () => { active = false; unsubscribe() }
  }, [ownerUid])
  const visible = records.filter(record => !contractId || record.scope.contractId === contractId)
  return <>
    {error && <p role="alert" className="finance-intent-error">{error}</p>}
    {visible.length > 0 && <aside aria-label="Yêu cầu cần kiểm tra" className="finance-intent-panel">
      <strong>{visible.length} yêu cầu tài chính chưa rõ kết quả trên thiết bị này</strong>
      {visible.map(record => <div className="finance-intent-row" key={record.scopeKey}>
        <span>{describeContract?.(record.scope.contractId) || 'Hợp đồng đã thao tác'} · {record.operation.type === 'reversal' ? 'Đảo bút toán' : `${'amount' in record.operation.payload ? record.operation.payload.amount.toLocaleString('vi-VN') : ''}đ`} · {new Date(record.createdAt).toLocaleString('vi-VN')}</span>
        <button type="button" className={buttonClass} onClick={() => setSelected(record)}>Xem yêu cầu</button>
      </div>)}
    </aside>}
    {selected && <section role="dialog" aria-label="Kiểm tra yêu cầu tài chính" className="finance-intent-panel">
      <button type="button" className={buttonClass} onClick={() => setSelected(null)}>Đóng yêu cầu</button>
      <FinanceIntentBoundary contractId={selected.scope.contractId} onCompleted={async outcome => { setSelected(null); await onCompleted(outcome) }} />
    </section>}
  </>
}
