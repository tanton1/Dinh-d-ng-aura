import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Clock3,
  Database,
  Moon,
  Save,
  ShieldCheck,
  TimerReset,
  Utensils,
} from 'lucide-react'
import type { PushAutomationLog, SystemPushSettings } from '../../../types'
import { formatPushTime } from './pushTypes'

interface PushAutomationPanelProps {
  settings: SystemPushSettings
  latestLog?: PushAutomationLog
  saving: boolean
  saved: boolean
  error: string
  onChange: (settings: SystemPushSettings) => void
  onSave: () => void
}

function TimeField({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (value: string) => void
}) {
  return (
    <label className="push-time-field">
      <span>{label}</span>
      <input type="time" value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  )
}

export function PushAutomationPanel({
  settings,
  latestLog,
  saving,
  saved,
  error,
  onChange,
  onSave,
}: PushAutomationPanelProps) {
  const isEnabled = settings.enabled && settings.automationEnabled && settings.autoMealReminders
  const update = <K extends keyof SystemPushSettings>(key: K, value: SystemPushSettings[K]) => {
    onChange({ ...settings, [key]: value })
  }
  const updateMealTime = (key: keyof SystemPushSettings['mealReminderTimes'], value: string) => {
    onChange({
      ...settings,
      mealReminderTimes: { ...settings.mealReminderTimes, [key]: value },
    })
  }
  const toggleAutomation = (enabled: boolean) => {
    onChange({
      ...settings,
      enabled,
      automationEnabled: enabled,
      autoMealReminders: enabled,
    })
  }

  return (
    <div className="push-panel-stack" data-testid="push-automation">
      <section className={`push-automation-switch ${isEnabled ? 'is-enabled' : ''}`}>
        <div className="push-automation-switch__icon"><Utensils size={22} /></div>
        <div className="push-automation-switch__copy">
          <span className="push-section-heading__eyebrow">Lịch nhắc chủ động</span>
          <h2>Nhắc cập nhật nhật ký bữa ăn</h2>
          <p>Aura tự kiểm tra nhật ký và chỉ nhắc đúng bữa còn thiếu, trong giới hạn an toàn mỗi ngày.</p>
        </div>
        <label className="push-switch">
          <input
            type="checkbox"
            checked={isEnabled}
            onChange={(event) => toggleAutomation(event.target.checked)}
            aria-label="Bật nhắc nhật ký bữa ăn tự động"
          />
          <span aria-hidden="true" />
        </label>
      </section>

      <div className="push-automation-grid">
        <section className="push-card">
          <div className="push-section-heading">
            <div>
              <span className="push-section-heading__eyebrow">Thời điểm gửi</span>
              <h2>Nhịp bữa ăn</h2>
            </div>
            <Clock3 size={21} aria-hidden="true" />
          </div>
          <p className="push-card__description">Scheduler chạy định kỳ và so khớp các mốc bên dưới theo múi giờ đã chọn.</p>
          <div className="push-time-grid">
            <TimeField label="Bữa sáng" value={settings.mealReminderTimes.breakfast} onChange={(value) => updateMealTime('breakfast', value)} />
            <TimeField label="Bữa trưa" value={settings.mealReminderTimes.lunch} onChange={(value) => updateMealTime('lunch', value)} />
            <TimeField label="Bữa tối" value={settings.mealReminderTimes.dinner} onChange={(value) => updateMealTime('dinner', value)} />
          </div>
        </section>

        <section className="push-card">
          <div className="push-section-heading">
            <div>
              <span className="push-section-heading__eyebrow">Giới hạn an toàn</span>
              <h2>Giờ yên lặng và tần suất</h2>
            </div>
            <Moon size={21} aria-hidden="true" />
          </div>
          <div className="push-form-grid push-form-grid--two">
            <TimeField label="Bắt đầu yên lặng" value={settings.quietHoursStart} onChange={(value) => update('quietHoursStart', value)} />
            <TimeField label="Kết thúc yên lặng" value={settings.quietHoursEnd} onChange={(value) => update('quietHoursEnd', value)} />
          </div>
          <div className="push-form-grid push-form-grid--two">
            <label className="push-field">
              <span>Múi giờ</span>
              <select value={settings.timezone} onChange={(event) => update('timezone', event.target.value)}>
                <option value="Asia/Ho_Chi_Minh">Việt Nam · GMT+7</option>
                <option value="Asia/Bangkok">Bangkok · GMT+7</option>
                <option value="Asia/Singapore">Singapore · GMT+8</option>
              </select>
            </label>
            <label className="push-field">
              <span>Tối đa mỗi ngày</span>
              <span className="push-input-suffix">
                <input
                  type="number"
                  min={1}
                  max={8}
                  value={settings.maxDailyPerUser}
                  onChange={(event) => update('maxDailyPerUser', Math.max(1, Math.min(8, Number(event.target.value) || 1)))}
                />
                <small>thông báo</small>
              </span>
            </label>
          </div>
        </section>
      </div>

      <section className="push-card">
        <div className="push-section-heading">
          <div>
            <span className="push-section-heading__eyebrow">Sức khỏe scheduler</span>
            <h2>Lần chạy gần nhất</h2>
          </div>
          <span className={`push-status-pill ${latestLog && latestLog.webPushFailureCount === 0 ? 'is-success' : 'is-neutral'}`}>
            {latestLog ? 'Đã có dữ liệu' : 'Chưa ghi nhận'}
          </span>
        </div>
        <div className="push-health-grid">
          <div><span>Thời gian</span><strong>{formatPushTime(latestLog?.createdAt)}</strong></div>
          <div><span>Đã đánh giá</span><strong>{latestLog?.evaluatedUsers ?? 0}</strong></div>
          <div><span>Ứng viên nhắc</span><strong>{latestLog?.candidates ?? 0}</strong></div>
          <div><span>FCM chấp nhận</span><strong>{latestLog?.webPushSentCount ?? 0}</strong></div>
          <div><span>Lỗi thiết bị</span><strong>{latestLog?.webPushFailureCount ?? 0}</strong></div>
        </div>
      </section>

      <details className="push-infrastructure">
        <summary>
          <span><Database size={19} /> Cấu hình hạ tầng nâng cao</span>
          <ChevronDown size={18} aria-hidden="true" />
        </summary>
        <div className="push-infrastructure__body">
          <div className="push-alert push-alert--info">
            <ShieldCheck size={18} />
            <span>VAPID public key có thể hiển thị công khai. Không nhập private key hoặc service-account JSON tại đây.</span>
          </div>
          <label className="push-field">
            <span>VAPID public key</span>
            <textarea
              rows={3}
              value={settings.vapidPublicKey}
              onChange={(event) => update('vapidPublicKey', event.target.value.trim())}
              placeholder="Để trống để dùng khóa mặc định của Firebase"
              spellCheck={false}
            />
          </label>
          <div className="push-form-grid push-form-grid--two">
            <label className="push-field">
              <span>Firebase Project ID</span>
              <input value={settings.fcmProjectId} readOnly aria-readonly="true" />
            </label>
            <label className="push-field">
              <span>Messaging Sender ID</span>
              <input value={settings.fcmSenderId} readOnly aria-readonly="true" />
            </label>
          </div>
        </div>
      </details>

      {error && (
        <div className="push-alert push-alert--error" role="alert">
          <AlertTriangle size={18} /> <span>{error}</span>
        </div>
      )}
      {saved && (
        <div className="push-alert push-alert--success" role="status">
          <CheckCircle2 size={18} /> <span>Đã lưu cấu hình và đồng bộ cho scheduler.</span>
        </div>
      )}

      <div className="push-save-bar">
        <div>
          <TimerReset size={19} />
          <span>Mọi thay đổi chỉ có hiệu lực sau khi lưu.</span>
        </div>
        <button type="button" className="push-button push-button--primary push-button--large" onClick={onSave} disabled={saving}>
          <Save size={18} />
          {saving ? 'Đang lưu…' : 'Lưu cấu hình'}
        </button>
      </div>
    </div>
  )
}
