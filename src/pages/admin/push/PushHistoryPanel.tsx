import { useMemo, useState } from 'react'
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  Clock3,
  CopyPlus,
  Filter,
  Inbox,
  Send,
  Smartphone,
} from 'lucide-react'
import type { PushAutomationLog, PushBroadcastLog } from '../../../types'
import { categoryLabel, formatPushTime } from './pushTypes'

type HistoryFilter = 'all' | 'manual' | 'automation' | 'errors'

interface PushHistoryPanelProps {
  broadcasts: PushBroadcastLog[]
  automations: PushAutomationLog[]
  loading: boolean
  onReuse: (log: PushBroadcastLog) => void
}

type HistoryEntry =
  | { kind: 'manual'; id: string; timestamp: unknown; log: PushBroadcastLog }
  | { kind: 'automation'; id: string; timestamp: unknown; log: PushAutomationLog }

function timestampNumber(value: unknown) {
  const candidate = value && typeof value === 'object' && 'toDate' in value
    ? (value as { toDate?: () => Date }).toDate?.()
    : value
  const date = candidate instanceof Date ? candidate : new Date(String(candidate ?? ''))
  return Number.isNaN(date.getTime()) ? 0 : date.getTime()
}

export function PushHistoryPanel({ broadcasts, automations, loading, onReuse }: PushHistoryPanelProps) {
  const [filter, setFilter] = useState<HistoryFilter>('all')
  const entries = useMemo<HistoryEntry[]>(() => {
    const merged: HistoryEntry[] = [
      ...broadcasts.map((log) => ({ kind: 'manual' as const, id: `manual-${log.id}`, timestamp: log.createdAt, log })),
      ...automations.map((log) => ({ kind: 'automation' as const, id: `automation-${log.id}`, timestamp: log.createdAt, log })),
    ]
    return merged
      .filter((entry) => {
        if (filter === 'manual') return entry.kind === 'manual'
        if (filter === 'automation') return entry.kind === 'automation'
        if (filter === 'errors') {
          return entry.kind === 'manual'
            ? (entry.log.webPushFailureCount ?? 0) > 0
            : entry.log.webPushFailureCount > 0
        }
        return true
      })
      .sort((a, b) => timestampNumber(b.timestamp) - timestampNumber(a.timestamp))
  }, [automations, broadcasts, filter])

  return (
    <div className="push-panel-stack" data-testid="push-history">
      <section className="push-card push-history-header">
        <div>
          <span className="push-section-heading__eyebrow">Nhật ký vận hành</span>
          <h2>Gửi thủ công và tự động hóa</h2>
          <p>Theo dõi riêng số inbox được tạo, thiết bị được FCM chấp nhận và lỗi phát sinh.</p>
        </div>
        <div className="push-history-filter" role="group" aria-label="Lọc lịch sử thông báo">
          <Filter size={17} aria-hidden="true" />
          {([
            ['all', 'Tất cả'],
            ['manual', 'Thủ công'],
            ['automation', 'Tự động'],
            ['errors', 'Có lỗi'],
          ] as Array<[HistoryFilter, string]>).map(([value, label]) => (
            <button key={value} type="button" className={filter === value ? 'is-active' : ''} onClick={() => setFilter(value)}>
              {label}
            </button>
          ))}
        </div>
      </section>

      {loading ? (
        <div className="push-empty-state"><Clock3 size={28} /><strong>Đang tải lịch sử…</strong></div>
      ) : entries.length === 0 ? (
        <div className="push-empty-state">
          <Inbox size={30} />
          <strong>Chưa có bản ghi phù hợp</strong>
          <span>Nhật ký mới sẽ xuất hiện tại đây sau khi hệ thống chạy.</span>
        </div>
      ) : (
        <section className="push-history-list" aria-label="Danh sách lịch sử Push">
          {entries.map((entry) => {
            if (entry.kind === 'automation') {
              const hasError = entry.log.webPushFailureCount > 0
              return (
                <article key={entry.id} className="push-history-item">
                  <div className={`push-history-item__icon ${hasError ? 'is-danger' : 'is-automation'}`}>
                    {hasError ? <AlertTriangle size={19} /> : <Bot size={19} />}
                  </div>
                  <div className="push-history-item__content">
                    <div className="push-history-item__title">
                      <div><strong>Nhắc bữa ăn tự động</strong><span>Tự động hóa</span></div>
                      <time>{formatPushTime(entry.log.createdAt)}</time>
                    </div>
                    <div className="push-history-metrics">
                      <span><Inbox size={15} /> {entry.log.createdNotifications} inbox</span>
                      <span><Smartphone size={15} /> {entry.log.webPushSentCount} FCM chấp nhận</span>
                      <span className={hasError ? 'is-danger' : ''}><AlertTriangle size={15} /> {entry.log.webPushFailureCount} lỗi</span>
                      <span>{entry.log.evaluatedUsers} tài khoản đã đánh giá</span>
                    </div>
                  </div>
                </article>
              )
            }

            const hasError = (entry.log.webPushFailureCount ?? 0) > 0
            return (
              <article key={entry.id} className="push-history-item">
                <div className={`push-history-item__icon ${hasError ? 'is-danger' : 'is-manual'}`}>
                  {hasError ? <AlertTriangle size={19} /> : <Send size={19} />}
                </div>
                <div className="push-history-item__content">
                  <div className="push-history-item__title">
                    <div>
                      <strong>{entry.log.title}</strong>
                      <span>Thủ công · {categoryLabel(entry.log.category)}</span>
                    </div>
                    <time>{formatPushTime(entry.log.createdAt)}</time>
                  </div>
                  <p>{entry.log.message}</p>
                  <div className="push-history-metrics">
                    <span><Inbox size={15} /> {entry.log.sentCount} inbox</span>
                    <span><CheckCircle2 size={15} /> {entry.log.webPushSentCount ?? 0} FCM chấp nhận</span>
                    <span className={hasError ? 'is-danger' : ''}><AlertTriangle size={15} /> {entry.log.webPushFailureCount ?? 0} lỗi</span>
                    {(entry.log.filteredOutCount ?? 0) > 0 && <span>{entry.log.filteredOutCount} không đủ điều kiện</span>}
                  </div>
                  <div className="push-history-item__actions">
                    <button type="button" className="push-text-button" onClick={() => onReuse(entry.log)}>
                      <CopyPlus size={16} /> Dùng lại nội dung
                    </button>
                  </div>
                </div>
              </article>
            )
          })}
        </section>
      )}
    </div>
  )
}
