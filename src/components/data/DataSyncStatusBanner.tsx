import { AlertTriangle, CloudOff, RefreshCw, Save, ShieldCheck } from 'lucide-react'
import { formatSyncTimestamp, type DataSyncState } from '../../dataSync/profileSync'
import './data-sync-status.css'

interface DataSyncStatusBannerProps {
  state: DataSyncState
  compact?: boolean
}

const copy = {
  synced: {
    title: 'Đã đồng bộ',
    description: 'Dữ liệu mới nhất đã được xác nhận trên Aura.',
  },
  'pending-local-change': {
    title: 'Đang lưu thay đổi',
    description: 'Vui lòng giữ kết nối cho đến khi Aura xác nhận dữ liệu.',
  },
  'offline-readonly': {
    title: 'Đang xem dữ liệu ngoại tuyến',
    description: 'Đây là bản đã đồng bộ gần nhất. Chỉnh sửa tạm khóa để tránh mất dữ liệu.',
  },
  'sync-failed': {
    title: 'Chưa thể đồng bộ',
    description: 'Aura chưa ghi nhận thay đổi. Hãy kiểm tra mạng rồi thử lưu lại.',
  },
  conflict: {
    title: 'Dữ liệu đã thay đổi ở nơi khác',
    description: 'Aura giữ bản máy chủ an toàn. Hãy tải lại trước khi chỉnh sửa tiếp.',
  },
  'stale-cache': {
    title: 'Đang hiển thị bản lưu gần nhất',
    description: 'Aura đang kiểm tra bản mới trên máy chủ. Tạm thời chưa nên chỉnh sửa.',
  },
} satisfies Record<DataSyncState['status'], { title: string; description: string }>

export default function DataSyncStatusBanner({ state, compact = false }: DataSyncStatusBannerProps) {
  if (state.status === 'synced' && compact) return null
  const content = copy[state.status]
  const timestamp = formatSyncTimestamp(state.cachedAt)
  const Icon = state.status === 'synced'
    ? ShieldCheck
    : state.status === 'pending-local-change'
      ? Save
      : state.status === 'offline-readonly' || state.status === 'stale-cache'
        ? CloudOff
        : state.status === 'conflict'
          ? AlertTriangle
          : RefreshCw

  return (
    <aside className={`data-sync-status data-sync-status--${state.status}`} role={state.status === 'sync-failed' || state.status === 'conflict' ? 'alert' : 'status'} data-testid="data-sync-status">
      <span className="data-sync-status__icon"><Icon size={18} aria-hidden="true" /></span>
      <span className="data-sync-status__copy">
        <strong>{content.title}</strong>
        {!compact && <small>{state.message ?? content.description}</small>}
        {timestamp && state.status !== 'synced' && <em>Lần đồng bộ gần nhất: {timestamp}</em>}
      </span>
    </aside>
  )
}
