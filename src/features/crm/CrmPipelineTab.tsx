import { RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { ago, dueLabel, STAGE_TONES } from './crmFormat'
import { crmErrorMessage, type CrmService } from './crmService'
import type { CrmPipeline } from './crmTypes'
import { Empty, ErrorBanner, Loading, PlatformBadge, Spinner } from './crmUi'

export function CrmPipelineTab({ service, branchId, refreshKey, onOpenCustomer }: {
  service: CrmService
  branchId?: string
  refreshKey: number
  onOpenCustomer: (customerId: string) => void
}) {
  const [owner, setOwner] = useState<'all' | 'me'>('all')
  const [pipeline, setPipeline] = useState<CrmPipeline | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      setPipeline(await service.pipeline({ branchId, owner }))
    } catch (cause) {
      setError(crmErrorMessage(cause, 'Chưa tải được pipeline.'))
    } finally {
      setLoading(false)
    }
  }, [branchId, owner, service])

  useEffect(() => { void load() }, [load, refreshKey])

  const open = pipeline?.columns.filter((column) => !['won', 'lost', 'nurture'].includes(column.stage)).reduce((sum, column) => sum + column.count, 0) || 0

  return <div className="crm-pipeline">
    <div className="crm-toolbar">
      <div className="crm-filters" role="group" aria-label="Người phụ trách">
        <button type="button" aria-pressed={owner === 'all'} className={owner === 'all' ? 'is-active' : ''} onClick={() => setOwner('all')}>Cả chi nhánh</button>
        <button type="button" aria-pressed={owner === 'me'} className={owner === 'me' ? 'is-active' : ''} onClick={() => setOwner('me')}>Của tôi</button>
      </div>
      <span className="crm-toolbar__summary">{pipeline ? `${open} khách đang trong phễu` : ''}</span>
      <button type="button" className="crm-icon-button" onClick={() => void load()} aria-label="Làm mới pipeline" disabled={loading}>{loading ? <Spinner /> : <RefreshCw size={16} />}</button>
    </div>
    <ErrorBanner message={error} onRetry={() => void load()} />
    {loading && !pipeline ? <Loading label="Đang tải pipeline…" /> : pipeline && <div className="crm-board" aria-label="Pipeline theo giai đoạn">
      {pipeline.columns.map((column) => <section key={column.stage} className={`crm-column crm-column--${STAGE_TONES[column.stage]}`} aria-label={`${column.label}: ${column.count} khách`}>
        <header><h2>{column.label}</h2><span>{column.count}</span></header>
        {column.rows.length ? <ul>
          {column.rows.map((row) => <li key={row.id}>
            <button type="button" className="crm-card" onClick={() => onOpenCustomer(row.id)}>
              <span className="crm-card__top"><strong>{row.displayName}</strong><PlatformBadge platform={row.platform} /></span>
              {row.phone && <span className="crm-card__line">{row.phone}</span>}
              {row.goal && <span className="crm-card__line crm-card__goal">{row.goal}</span>}
              <span className="crm-card__meta">
                <span>{row.ownerName || 'Chưa giao'}</span>
                {row.openStepCount > 0 && row.nextStepAt ? <span className={new Date(row.nextStepAt).getTime() < Date.now() ? 'is-late' : ''}>{dueLabel(row.nextStepAt)}</span> : <span>{ago(row.updatedAt)}</span>}
              </span>
            </button>
          </li>)}
        </ul> : <Empty title="Trống" />}
        {column.count > column.rows.length && <p className="crm-column__more">+{column.count - column.rows.length} khách khác · tìm ở tab Khách hàng</p>}
      </section>)}
    </div>}
  </div>
}
