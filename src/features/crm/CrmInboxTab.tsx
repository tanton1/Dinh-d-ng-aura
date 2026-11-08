import { ExternalLink, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { durationLabel, formatTime } from './crmFormat'
import { crmErrorMessage, type CrmService } from './crmService'
import type { CrmConversation, CrmInboxFilter } from './crmTypes'
import { Avatar, Empty, ErrorBanner, Loading, PlatformBadge, Spinner, StageChip } from './crmUi'

const FILTERS: Array<{ id: CrmInboxFilter; label: string }> = [
  { id: 'awaiting', label: 'Chờ trả lời' },
  { id: 'mine', label: 'Của tôi' },
  { id: 'new', label: 'Khách mới' },
  { id: 'all', label: 'Tất cả' },
]
const REFRESH_MS = 60_000
const INBOX_SLA_MS = 5 * 60_000

export function CrmInboxTab({ service, branchId, refreshKey, onOpenCustomer }: {
  service: CrmService
  branchId?: string
  refreshKey: number
  onOpenCustomer: (customerId: string) => void
}) {
  const [filter, setFilter] = useState<CrmInboxFilter>('awaiting')
  const [rows, setRows] = useState<CrmConversation[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState('')
  const [now, setNow] = useState(() => Date.now())
  const request = useRef(0)

  const load = useCallback(async (quiet = false) => {
    const ticket = ++request.current
    if (!quiet) setLoading(true)
    setError('')
    try {
      const page = await service.inbox({ branchId, filter, pageSize: 30 })
      if (ticket !== request.current) return
      setRows(page.rows)
      setCursor(page.nextCursor)
      setNow(Date.now())
    } catch (cause) {
      if (ticket === request.current) setError(crmErrorMessage(cause, 'Chưa tải được hộp thư.'))
    } finally {
      if (ticket === request.current) setLoading(false)
    }
  }, [branchId, filter, service])

  useEffect(() => { void load() }, [load, refreshKey])

  // Refresh only while the tab is visible; the webhook keeps data fresh.
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load(true)
    }, REFRESH_MS)
    return () => window.clearInterval(timer)
  }, [load])

  const loadMore = async () => {
    if (!cursor) return
    setLoadingMore(true)
    try {
      const page = await service.inbox({ branchId, filter, pageSize: 30, cursor })
      setRows((current) => [...current, ...page.rows.filter((row) => !current.some((item) => item.key === row.key))])
      setCursor(page.nextCursor)
    } catch (cause) {
      setError(crmErrorMessage(cause, 'Chưa tải thêm được hội thoại.'))
    } finally {
      setLoadingMore(false)
    }
  }

  return <div className="crm-inbox">
    <div className="crm-toolbar">
      <div className="crm-filters" role="group" aria-label="Lọc hội thoại">
        {FILTERS.map((item) => <button key={item.id} type="button" aria-pressed={filter === item.id} className={filter === item.id ? 'is-active' : ''} onClick={() => setFilter(item.id)}>{item.label}</button>)}
      </div>
      <button type="button" className="crm-icon-button" onClick={() => void load()} aria-label="Làm mới hộp thư" disabled={loading}>{loading ? <Spinner /> : <RefreshCw size={16} />}</button>
    </div>
    <ErrorBanner message={error} onRetry={() => void load()} />
    {loading && !rows.length ? <Loading label="Đang tải hội thoại…" />
      : !rows.length ? <Empty title={filter === 'awaiting' ? 'Không còn khách chờ trả lời' : 'Chưa có hội thoại'} />
        : <ul className="crm-list">
          {rows.map((row) => {
            const waited = row.awaitingReply && row.awaitingSince ? now - new Date(row.awaitingSince).getTime() : 0
            const tone = !row.awaitingReply ? '' : waited > 3 * INBOX_SLA_MS ? 'is-late' : waited > INBOX_SLA_MS ? 'is-due' : 'is-fresh'
            return <li key={row.key} className={`crm-thread ${row.unread ? 'is-unread' : ''}`}>
              <button type="button" className="crm-thread__open" onClick={() => row.customerId && onOpenCustomer(row.customerId)} disabled={!row.customerId}>
                <Avatar name={row.displayName} />
                <span className="crm-thread__body">
                  <span className="crm-thread__top">
                    <strong>{row.displayName}</strong>
                    <PlatformBadge platform={row.platform} />
                    {row.studentId && <span className="crm-chip crm-chip--success">Học viên</span>}
                  </span>
                  <span className="crm-thread__preview">{row.lastMessageFrom === 'page' ? 'Bạn: ' : ''}{row.preview || '…'}</span>
                  <span className="crm-thread__meta">
                    <StageChip stage={row.customerStage} />
                    <span>{row.ownerName || 'Chưa giao'}</span>
                    {row.phoneHints > 0 && <span className="crm-thread__hint">Có số trong chat</span>}
                  </span>
                </span>
                <span className="crm-thread__side">
                  {row.awaitingReply ? <span className={`crm-wait ${tone}`}>Chờ {durationLabel(waited)}</span> : <span className="crm-thread__time">{formatTime(row.lastMessageAt)}</span>}
                </span>
              </button>
              <a className="crm-thread__pancake" href={row.pancakeUrl} target="_blank" rel="noopener noreferrer" aria-label={`Mở hội thoại của ${row.displayName} trên Pancake`}>
                <ExternalLink size={15} aria-hidden="true" /> <span>Pancake</span>
              </a>
            </li>
          })}
        </ul>}
    {cursor && <button type="button" className="crm-more" onClick={() => void loadMore()} disabled={loadingMore}>{loadingMore ? <Spinner /> : null} Xem thêm</button>}
  </div>
}
