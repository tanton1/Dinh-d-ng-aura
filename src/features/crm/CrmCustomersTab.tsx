import { Search } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { CRM_STAGES, STAGE_LABELS, ago } from './crmFormat'
import { crmErrorMessage, type CrmService } from './crmService'
import type { CrmCustomerCard, CrmStage } from './crmTypes'
import { Avatar, Empty, ErrorBanner, Loading, PlatformBadge, Spinner, StageChip } from './crmUi'

export function CrmCustomersTab({ service, branchId, careOnly, refreshKey, onOpenCustomer }: {
  service: CrmService
  branchId?: string
  careOnly: boolean
  refreshKey: number
  onOpenCustomer: (customerId: string) => void
}) {
  const [query, setQuery] = useState('')
  const [submitted, setSubmitted] = useState('')
  const [stage, setStage] = useState<CrmStage | ''>('')
  const [rows, setRows] = useState<CrmCustomerCard[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState('')
  const scope = careOnly ? 'care' : 'branch'

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const page = await service.customers({ branchId, query: submitted || undefined, stage, scope })
      setRows(page.rows)
      setCursor(page.nextCursor)
    } catch (cause) {
      setError(crmErrorMessage(cause, 'Chưa tải được danh sách khách.'))
    } finally {
      setLoading(false)
    }
  }, [branchId, scope, service, stage, submitted])

  useEffect(() => { void load() }, [load, refreshKey])

  const loadMore = async () => {
    if (!cursor) return
    setLoadingMore(true)
    try {
      const page = await service.customers({ branchId, query: submitted || undefined, stage, scope, cursor })
      setRows((current) => [...current, ...page.rows.filter((row) => !current.some((item) => item.id === row.id))])
      setCursor(page.nextCursor)
    } catch (cause) {
      setError(crmErrorMessage(cause, 'Chưa tải thêm được khách.'))
    } finally {
      setLoadingMore(false)
    }
  }

  return <div className="crm-customers">
    <div className="crm-toolbar crm-toolbar--wrap">
      <form className="crm-search" role="search" onSubmit={(event) => { event.preventDefault(); setSubmitted(query.trim()) }}>
        <Search size={16} aria-hidden="true" />
        <label className="crm-sr-only" htmlFor="crm-customer-search">Tìm khách</label>
        <input id="crm-customer-search" value={query} placeholder="Tên, số điện thoại hoặc 4 số cuối" onChange={(event) => setQuery(event.target.value)} />
        <button type="submit" className="crm-button">Tìm</button>
      </form>
      <label className="crm-select">
        <span className="crm-sr-only">Giai đoạn</span>
        <select value={stage} onChange={(event) => setStage(event.target.value as CrmStage | '')}>
          <option value="">Mọi giai đoạn</option>
          {CRM_STAGES.map((item) => <option key={item} value={item}>{STAGE_LABELS[item]}</option>)}
        </select>
      </label>
    </div>
    {careOnly && <p className="crm-hint">Danh sách học viên bạn đang chăm sóc.</p>}
    <ErrorBanner message={error} onRetry={() => void load()} />
    {loading && !rows.length ? <Loading label="Đang tải khách…" />
      : !rows.length ? <Empty title="Không tìm thấy khách">{submitted ? 'Thử tên không dấu, số điện thoại đầy đủ hoặc 4 số cuối.' : undefined}</Empty>
        : <ul className="crm-list">
          {rows.map((row) => <li key={row.id}>
            <button type="button" className="crm-row" onClick={() => onOpenCustomer(row.id)}>
              <Avatar name={row.displayName} tone={row.studentId ? 'neutral' : 'pink'} />
              <span className="crm-row__body">
                <span className="crm-row__top"><strong>{row.displayName}</strong><PlatformBadge platform={row.platform} /></span>
                <span className="crm-row__line">{[row.phone, row.goal].filter(Boolean).join(' · ') || 'Chưa có số điện thoại'}</span>
              </span>
              <span className="crm-row__side">
                <StageChip stage={row.stage} />
                <small>{row.careOwnerName ? `CS: ${row.careOwnerName}` : row.ownerName || 'Chưa giao'} · {ago(row.updatedAt)}</small>
              </span>
            </button>
          </li>)}
        </ul>}
    {cursor && <button type="button" className="crm-more" onClick={() => void loadMore()} disabled={loadingMore}>{loadingMore ? <Spinner /> : null} Xem thêm</button>}
  </div>
}
