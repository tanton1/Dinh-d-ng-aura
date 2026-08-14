import {
  AlertTriangle,
  BellRing,
  CheckCircle2,
  Clock3,
  RefreshCw,
  Send,
  Settings2,
  ShieldCheck,
  Smartphone,
  Users,
  XCircle,
} from 'lucide-react'
import { useEffect, useRef } from 'react'
import type { PushAdminOverview, SystemPushSettings } from '../../../types'
import { formatPushTime } from './pushTypes'

interface PushOverviewPanelProps {
  settings: SystemPushSettings
  overview: PushAdminOverview | null
  loading: boolean
  loadError: string
  permission: NotificationPermission | 'unsupported'
  hasCurrentToken: boolean
  deviceBusy: boolean
  deviceMessage: { tone: 'success' | 'error'; text: string } | null
  onCompose: () => void
  onOpenAutomation: () => void
  onRefresh: () => void
  onEnableDevice: () => void
  onSendDeviceTest: () => void
}

function MetricCard({
  label,
  value,
  helper,
  icon,
  tone = 'neutral',
}: {
  label: string
  value: string | number
  helper: string
  icon: React.ReactNode
  tone?: 'neutral' | 'success' | 'danger'
}) {
  return (
    <article className={`push-metric push-metric--${tone}`}>
      <div className="push-metric__icon" aria-hidden="true">{icon}</div>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
        <small>{helper}</small>
      </div>
    </article>
  )
}

export function PushOverviewPanel({
  settings,
  overview,
  loading,
  loadError,
  permission,
  hasCurrentToken,
  deviceBusy,
  deviceMessage,
  onCompose,
  onOpenAutomation,
  onRefresh,
  onEnableDevice,
  onSendDeviceTest,
}: PushOverviewPanelProps) {
  const deviceMessageRef = useRef<HTMLDivElement>(null)
  const automationReady = settings.enabled && settings.automationEnabled && settings.autoMealReminders
  const deviceReady = permission === 'granted' && hasCurrentToken
  const accepted = overview?.webPushAccepted24h ?? 0
  const failed = overview?.webPushFailures24h ?? 0
  const acceptanceRate = accepted + failed > 0
    ? `${Math.round((accepted / (accepted + failed)) * 100)}%`
    : '—'

  useEffect(() => {
    if (!deviceMessage) return
    const frame = window.requestAnimationFrame(() => {
      deviceMessageRef.current?.scrollIntoView({ block: 'nearest' })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [deviceMessage])

  return (
    <div className="push-panel-stack" data-testid="push-overview">
      <section className="push-status-banner" aria-label="Trạng thái hệ thống Push">
        <div className="push-status-banner__copy">
          <span className={`push-status-dot ${automationReady ? 'is-live' : 'is-paused'}`} />
          <div>
            <strong>{automationReady ? 'Push đang vận hành' : 'Tự động hóa đang tạm dừng'}</strong>
            <p>
              {automationReady
                ? `Nhắc bữa ăn theo múi giờ ${settings.timezone}.`
                : 'Gửi thủ công vẫn dùng được; kiểm tra cấu hình tự động để bật lịch nhắc.'}
            </p>
          </div>
        </div>
        <div className="push-status-banner__actions">
          <button type="button" className="push-button push-button--ghost" onClick={onRefresh} disabled={loading}>
            <RefreshCw size={17} className={loading ? 'is-spinning' : ''} />
            Làm mới
          </button>
          <button type="button" className="push-button push-button--primary" onClick={onCompose}>
            <Send size={17} />
            Soạn thông báo
          </button>
        </div>
      </section>

      {loadError && (
        <div className="push-alert push-alert--warning" role="alert">
          <AlertTriangle size={18} />
          <span>{loadError}</span>
        </div>
      )}

      <section className="push-metric-grid" aria-label="Chỉ số Push">
        <MetricCard
          label="Học viên hoạt động"
          value={loading ? '…' : overview?.activeUsers ?? 0}
          helper="Tài khoản có thể nhận inbox"
          icon={<Users size={20} />}
        />
        <MetricCard
          label="Thiết bị đã đăng ký"
          value={loading ? '…' : overview?.activeDevices ?? 0}
          helper={`${overview?.pushEnabledUsers ?? 0} học viên đã bật Push`}
          icon={<Smartphone size={20} />}
          tone={(overview?.activeDevices ?? 0) > 0 ? 'success' : 'neutral'}
        />
        <MetricCard
          label="FCM chấp nhận · 24 giờ"
          value={loading ? '…' : accepted}
          helper={`Tỷ lệ chấp nhận ${acceptanceRate}`}
          icon={<CheckCircle2 size={20} />}
          tone="success"
        />
        <MetricCard
          label="Lỗi thiết bị · 24 giờ"
          value={loading ? '…' : failed}
          helper="Token lỗi hoặc thiết bị không còn hợp lệ"
          icon={failed > 0 ? <XCircle size={20} /> : <ShieldCheck size={20} />}
          tone={failed > 0 ? 'danger' : 'success'}
        />
      </section>

      <div className="push-overview-grid">
        <section className="push-card">
          <div className="push-section-heading">
            <div>
              <span className="push-section-heading__eyebrow">Tự động hóa</span>
              <h2>Lịch nhắc đang áp dụng</h2>
            </div>
            <button type="button" className="push-text-button" onClick={onOpenAutomation}>
              <Settings2 size={17} /> Cấu hình
            </button>
          </div>

          <div className="push-schedule-row">
            <div><span>Sáng</span><strong>{settings.mealReminderTimes.breakfast}</strong></div>
            <div><span>Trưa</span><strong>{settings.mealReminderTimes.lunch}</strong></div>
            <div><span>Tối</span><strong>{settings.mealReminderTimes.dinner}</strong></div>
          </div>
          <div className="push-inline-meta">
            <Clock3 size={16} />
            <span>Lần chạy gần nhất: {formatPushTime(overview?.latestAutomationAt)}</span>
          </div>
        </section>

        <section className="push-card">
          <div className="push-section-heading">
            <div>
              <span className="push-section-heading__eyebrow">Thiết bị quản trị</span>
              <h2>Kiểm tra Push thật</h2>
            </div>
            <span className={`push-status-pill ${deviceReady ? 'is-success' : 'is-neutral'}`}>
              {deviceReady ? 'Sẵn sàng' : 'Chưa kết nối'}
            </span>
          </div>

          <p className="push-card__description">
            Bật thông báo cho trình duyệt này, sau đó gửi một bản kiểm tra chỉ đến tài khoản quản trị hiện tại.
          </p>
          <div className="push-device-actions">
            {!deviceReady && (
              <button type="button" className="push-button push-button--secondary" onClick={onEnableDevice} disabled={deviceBusy || permission === 'unsupported'}>
                <BellRing size={17} />
                {deviceBusy ? 'Đang kết nối…' : permission === 'denied' ? 'Kiểm tra quyền trình duyệt' : 'Bật Push trên thiết bị'}
              </button>
            )}
            <button type="button" className="push-button push-button--primary" onClick={onSendDeviceTest} disabled={!deviceReady || deviceBusy}>
              <Send size={17} />
              {deviceBusy ? 'Đang gửi…' : 'Gửi bản kiểm tra'}
            </button>
          </div>
          {deviceMessage && (
            <div ref={deviceMessageRef} className={`push-alert push-alert--${deviceMessage.tone}`} role="status">
              {deviceMessage.tone === 'success' ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />}
              <span>{deviceMessage.text}</span>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
