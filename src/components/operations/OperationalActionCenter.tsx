import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, ArrowRight, Check, CircleAlert, Clock3, LoaderCircle, RefreshCw } from 'lucide-react'
import { firebaseFunctions } from '../../lib/firebaseFunctions'
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
  const [rows, setRows] = useState<OperationalAction[]>([])
  const [summary, setSummary] = useState<OperationalActionSummary | null>(null)
  const [loading, setLoading] = useState(!isDemo)
  const [loadingMore, setLoadingMore] = useState(false)
  const nextCursorRef = useRef<string | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState('')

  const load = useCallback(async (append = false) => {
    if (isDemo || !firebaseFunctions) {
      setLoading(false)
      return
    }
    if (append) setLoadingMore(true)
    else setLoading(true)
    setError('')
    try {
      const listPromise = listOperationalActions({ pageSize: 5, ...(append && nextCursorRef.current ? { cursor: nextCursorRef.current } : {}) })
      const totalsPromise = append ? Promise.resolve(null) : getOperationalActionSummary()
      const [list, totals] = await Promise.all([listPromise, totalsPromise])
      setRows((current) => {
        if (!append) return list.rows
        const byId = new Map(current.map((item) => [item.actionId, item]))
        list.rows.forEach((item) => byId.set(item.actionId, item))
        return [...byId.values()]
      })
      nextCursorRef.current = list.nextCursor
      setHasMore(list.hasMore)
      if (totals) setSummary(totals)
    } catch (reason) {
      setError(errorMessage(reason))
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }, [isDemo])

  useEffect(() => { void load() }, [load])

  const run = async (row: OperationalAction, action: 'claim' | 'resolve' | 'snooze') => {
    setBusyId(row.actionId)
    try {
      const next = action === 'claim'
        ? await claimOperationalAction(row.actionId)
        : action === 'resolve'
          ? await resolveOperationalAction(row.actionId, 'Đã xử lý tại Action Center')
          : await snoozeOperationalAction(row.actionId, new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString())
      setRows((current) => action === 'resolve' || action === 'snooze'
        ? current.filter((item) => item.actionId !== row.actionId)
        : current.map((item) => item.actionId === row.actionId ? next : item))
      setSummary((current) => current ? { ...current, total: action === 'resolve' ? Math.max(0, current.total - 1) : current.total } : current)
    } catch (reason) {
      setError(errorMessage(reason))
    } finally {
      setBusyId('')
    }
  }

  return <section className="operational-action-center" aria-labelledby="operational-action-center-title">
    <header className="operational-action-center__header">
      <div><small>AURA · ACTION CENTER</small><h2 id="operational-action-center-title">Tác vụ vận hành</h2><p>Việc cần xử lý được gom từ hợp đồng, lịch và chăm sóc học viên.</p></div>
      <div className="operational-action-center__header-actions"><span>{summary?.total ?? (loading ? '—' : rows.length)} việc</span><button type="button" onClick={() => void load()} disabled={loading} aria-label="Làm mới Action Center"><RefreshCw className={loading ? 'is-spinning' : ''} size={16} /></button></div>
    </header>
    {error && <div className="operational-action-center__error" role="alert"><AlertTriangle size={16} />{error}</div>}
    {loading ? <div className="operational-action-center__loading"><LoaderCircle className="is-spinning" size={20} /> Đang tải tác vụ…</div>
      : !rows.length ? <div className="operational-action-center__empty"><Check size={20} /><strong>Không có tác vụ đang mở</strong><span>Các hàng đợi trong phạm vi của bạn đang ổn định.</span></div>
        : <div className="operational-action-center__list">{rows.map((row) => <article key={row.actionId} className={`operational-action-center__item is-${row.severity}`}>
          <div className="operational-action-center__icon">{row.severity === 'critical' ? <CircleAlert size={18} /> : row.severity === 'warning' ? <Clock3 size={18} /> : <AlertTriangle size={18} />}</div>
          <div className="operational-action-center__body"><div className="operational-action-center__eyebrow"><span>{severityLabel(row.severity)}</span>{row.status === 'in_progress' && <b>Đang xử lý</b>}</div><strong>{row.title}</strong><p>{row.redactedSummary}</p><div className="operational-action-center__actions">{row.studentId && onOpenStudent && <button type="button" onClick={() => onOpenStudent(row.studentId as string)}>Mở học viên <ArrowRight size={14} /></button>}{row.status === 'open' && <button type="button" disabled={busyId === row.actionId} onClick={() => void run(row, 'claim')}>{busyId === row.actionId ? 'Đang xử lý…' : 'Nhận việc'}</button>}{row.status === 'in_progress' && <><button type="button" disabled={busyId === row.actionId} onClick={() => void run(row, 'snooze')}>{busyId === row.actionId ? 'Đang lưu…' : 'Tạm hoãn 1 ngày'}</button><button type="button" disabled={busyId === row.actionId} onClick={() => void run(row, 'resolve')}>{busyId === row.actionId ? 'Đang lưu…' : 'Đánh dấu xong'}</button></>}</div></div>
        </article>)}</div>}
    {!loading && !error && hasMore && <button className="operational-action-center__load-more" type="button" onClick={() => void load(true)} disabled={loadingMore}>{loadingMore ? 'Đang tải thêm…' : 'Xem thêm tác vụ'}</button>}
  </section>
}
