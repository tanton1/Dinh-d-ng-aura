import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, ArrowRight, Check, CircleAlert, Clock3, LoaderCircle, RefreshCw } from 'lucide-react'
import { firebaseFunctions } from '../../lib/firebaseFunctions'
import { useWorkspaceAccountId } from '../../hooks/useWorkspaceSync'
import { useStaffDashboardPanelVisibility } from '../../hooks/useStaffDashboardPanel'
import { claimOperationalAction, getOperationalActionSummary, listOperationalActions, resolveOperationalAction, snoozeOperationalAction, type OperationalAction, type OperationalActionSummary } from '../../services/actionCenterService'
import './OperationalActionCenter.css'

interface Props {
  isDemo?: boolean
  onOpenStudent?: (studentId: string) => void
}

function errorMessage(error: unknown) {
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : ''
  if (code.includes('permission-denied')) return 'Tài khoản chưa có quyền xem các tác vụ trong phạm vi này.'
  if (code.includes('unauthenticated')) return 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.'
  return 'Chưa tải được Action Center. Vui lòng thử lại.'
}

function severityLabel(value: OperationalAction['severity']) {
  return value === 'critical' ? 'Ưu tiên cao' : value === 'warning' ? 'Cần xử lý' : 'Theo dõi'
}

export default function OperationalActionCenter({ isDemo = false, onOpenStudent }: Props) {
  const accountId = useWorkspaceAccountId()
  return <ActionCenterPanel key={`${accountId}|${isDemo}`} accountId={accountId} isDemo={isDemo} onOpenStudent={onOpenStudent} />
}

function ActionCenterPanel({ accountId, isDemo = false, onOpenStudent }: Props & { accountId: string }) {
  const visibility = useStaffDashboardPanelVisibility()
  const mounted = useRef(false)
  const generation = useRef(0)
  const pending = useRef<Promise<void> | null>(null)
  const mutation = useRef<object | null>(null)
  const [rows, setRows] = useState<OperationalAction[]>([])
  const [summary, setSummary] = useState<OperationalActionSummary | null>(null)
  const [started, setStarted] = useState(isDemo)
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const nextCursorRef = useRef<string | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState('')

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  const load = useCallback((append = false, afterMutation = false): Promise<void> => {
    if (isDemo || !accountId || !firebaseFunctions || !mounted.current || (mutation.current && !afterMutation)) return Promise.resolve()
    if (pending.current) return pending.current
    if (append && !nextCursorRef.current) return Promise.resolve()
    const epoch = ++generation.current
    const cursor = append ? nextCursorRef.current : null
    const current = () => mounted.current && epoch === generation.current && pending.current === promise
    setStarted(true)
    if (append) setLoadingMore(true)
    else setLoading(true)
    setError('')
    const promise = Promise.resolve().then(async () => {
      if (!current()) return
      const listPromise = listOperationalActions({ pageSize: 5, ...(cursor ? { cursor } : {}) })
      const totalsPromise = append ? Promise.resolve(null) : getOperationalActionSummary()
      const [list, totals] = await Promise.all([listPromise, totalsPromise])
      if (!current()) return
      setRows((current) => {
        if (!append) return list.rows
        const byId = new Map(current.map((item) => [item.actionId, item]))
        list.rows.forEach((item) => byId.set(item.actionId, item))
        return [...byId.values()]
      })
      nextCursorRef.current = list.nextCursor
      setHasMore(list.hasMore)
      if (totals) setSummary(totals)
    }).catch((reason: unknown) => {
      if (current()) setError(errorMessage(reason))
    }).finally(() => {
      if (current()) { setLoading(false); setLoadingMore(false) }
      if (pending.current === promise) pending.current = null
    })
    pending.current = promise
    return promise
  }, [accountId, isDemo])

  useEffect(() => { if (visibility.visible) void load() }, [load, visibility.visible])

  const run = async (row: OperationalAction, action: 'claim' | 'resolve' | 'snooze') => {
    if (mutation.current || loading || loadingMore) return
    const token = {}
    mutation.current = token
    const current = () => mounted.current && mutation.current === token
    generation.current += 1
    pending.current = null
    setBusyId(row.actionId)
    setError('')
    try {
      const next = action === 'claim'
        ? await claimOperationalAction(row.actionId)
        : action === 'resolve'
          ? await resolveOperationalAction(row.actionId, 'Đã xử lý tại Action Center')
          : await snoozeOperationalAction(row.actionId, new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString())
      if (!current()) return
      setRows((current) => action === 'resolve' || action === 'snooze'
        ? current.filter((item) => item.actionId !== row.actionId)
        : current.map((item) => item.actionId === row.actionId ? next : item))
      // Re-read authoritative totals, including severity counts and snoozed
      // visibility. A local decrement cannot represent those business rules.
      setSummary(null)
      await load(false, true)
    } catch (reason) {
      if (current()) setError(errorMessage(reason))
    } finally {
      if (current()) { mutation.current = null; setBusyId('') }
    }
  }

  const busy = Boolean(busyId) || loading || loadingMore
  return <section ref={visibility.ref} className="operational-action-center" aria-labelledby="operational-action-center-title">
    <header className="operational-action-center__header">
      <div><small>AURA · ACTION CENTER</small><h2 id="operational-action-center-title">Tác vụ vận hành</h2><p>Việc cần xử lý được gom từ hợp đồng, lịch và chăm sóc học viên.</p></div>
      <div className="operational-action-center__header-actions"><span>{summary?.total ?? (isDemo ? 0 : '—')} việc</span><button type="button" onClick={() => { visibility.reveal(); void load() }} disabled={busy} aria-label="Làm mới Action Center"><RefreshCw className={loading ? 'is-spinning' : ''} size={16} /></button></div>
    </header>
    {error && <div className="operational-action-center__error" role="alert"><AlertTriangle size={16} />{error}</div>}
    {!started ? <div className="operational-action-center__loading">Tác vụ sẽ được tải khi bạn xem phần này.</div>
      : loading ? <div className="operational-action-center__loading"><LoaderCircle className="is-spinning" size={20} /> Đang tải tác vụ…</div>
        : error && !rows.length ? <div className="operational-action-center__loading">Chưa có dữ liệu tác vụ. Hãy bấm làm mới để thử lại.</div>
      : !rows.length ? <div className="operational-action-center__empty"><Check size={20} /><strong>Không có tác vụ đang mở</strong><span>Các hàng đợi trong phạm vi của bạn đang ổn định.</span></div>
        : <div className="operational-action-center__list">{rows.map((row) => <article key={row.actionId} className={`operational-action-center__item is-${row.severity}`}>
          <div className="operational-action-center__icon">{row.severity === 'critical' ? <CircleAlert size={18} /> : row.severity === 'warning' ? <Clock3 size={18} /> : <AlertTriangle size={18} />}</div>
          <div className="operational-action-center__body"><div className="operational-action-center__eyebrow"><span>{severityLabel(row.severity)}</span>{row.status === 'in_progress' && <b>Đang xử lý</b>}</div><strong>{row.title}</strong><p>{row.redactedSummary}</p><div className="operational-action-center__actions">{row.studentId && onOpenStudent && <button type="button" onClick={() => onOpenStudent(row.studentId as string)}>Mở học viên <ArrowRight size={14} /></button>}{row.status === 'open' && <button type="button" disabled={busy} onClick={() => void run(row, 'claim')}>{busyId === row.actionId ? 'Đang xử lý…' : 'Nhận việc'}</button>}{row.status === 'in_progress' && <><button type="button" disabled={busy} onClick={() => void run(row, 'snooze')}>{busyId === row.actionId ? 'Đang lưu…' : 'Tạm hoãn 1 ngày'}</button><button type="button" disabled={busy} onClick={() => void run(row, 'resolve')}>{busyId === row.actionId ? 'Đang lưu…' : 'Đánh dấu xong'}</button></>}</div></div>
        </article>)}</div>}
    {!loading && !error && hasMore && <button className="operational-action-center__load-more" type="button" onClick={() => void load(true)} disabled={busy}>{loadingMore ? 'Đang tải thêm…' : 'Xem thêm tác vụ'}</button>}
  </section>
}
