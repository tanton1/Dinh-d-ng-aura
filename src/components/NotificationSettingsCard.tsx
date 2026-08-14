import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Bell, CheckCircle2, Clock3, ShieldCheck, Smartphone, Volume2 } from 'lucide-react'
import type { NotificationSettings } from '../types'
import { getStoredFcmToken, requestFcmPermissionAndToken, unregisterFcmToken } from '../services/fcmService'

const DEFAULT_SETTINGS: NotificationSettings = {
  enabled: true,
  fcmEnabled: false,
  mealReminders: true,
  workoutReminders: true,
  learningUpdates: true,
  coachMessages: true,
  quietHoursEnabled: true,
  quietHoursStart: '21:30',
  quietHoursEnd: '07:00',
  timezone: 'Asia/Ho_Chi_Minh',
  maxDaily: 3,
  mealReminderTimes: {
    breakfast: '07:30',
    lunch: '12:00',
    dinner: '18:30',
  },
}

function mergeSettings(value?: NotificationSettings, dinnerFallback?: string): NotificationSettings {
  const mealTimes = value?.mealReminderTimes
  return {
    ...DEFAULT_SETTINGS,
    ...(value ?? {}),
    mealReminderTimes: {
      breakfast: mealTimes?.breakfast ?? DEFAULT_SETTINGS.mealReminderTimes!.breakfast,
      lunch: mealTimes?.lunch ?? DEFAULT_SETTINGS.mealReminderTimes!.lunch,
      dinner: mealTimes?.dinner ?? dinnerFallback ?? DEFAULT_SETTINGS.mealReminderTimes!.dinner,
    },
  }
}

interface NotificationSettingsCardProps {
  userId?: string
  settings?: NotificationSettings
  mealReminderTime?: string
  onSave?: (values: { notificationSettings: NotificationSettings; mealReminderTime: string }) => Promise<void>
}

export default function NotificationSettingsCard({
  userId,
  settings,
  mealReminderTime,
  onSave,
}: NotificationSettingsCardProps) {
  const [draft, setDraft] = useState(() => mergeSettings(settings, mealReminderTime))
  const [saving, setSaving] = useState(false)
  const [enablingPush, setEnablingPush] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    setDraft(mergeSettings(settings, mealReminderTime))
  }, [mealReminderTime, settings])

  const pushSupported = useMemo(
    () => typeof window !== 'undefined' && 'Notification' in window && 'serviceWorker' in navigator,
    [],
  )
  const permission = pushSupported ? Notification.permission : 'denied'
  const deviceReady = Boolean(userId && getStoredFcmToken(userId)) && draft.fcmEnabled === true && permission === 'granted'
  const notificationsOn = draft.enabled !== false

  const deviceStatus = !pushSupported
    ? { label: 'Không hỗ trợ', color: '#9f1239', background: '#fff1f2' }
    : permission === 'denied'
      ? { label: 'Đang bị chặn', color: '#9f1239', background: '#fff1f2' }
      : deviceReady
        ? { label: 'Đã kết nối', color: '#047857', background: '#ecfdf5' }
        : { label: 'Chưa kết nối', color: '#a16207', background: '#fffbeb' }

  const update = (patch: Partial<NotificationSettings>) => {
    setDraft((current) => ({ ...current, ...patch }))
    setSaved(false)
    setError('')
  }

  const updateMealTime = (key: 'breakfast' | 'lunch' | 'dinner', value: string) => {
    setDraft((current) => ({
      ...current,
      mealReminderTimes: { ...current.mealReminderTimes!, [key]: value },
    }))
    setSaved(false)
    setError('')
  }

  const persist = async (next = draft) => {
    if (!onSave) return
    setSaving(true)
    setSaved(false)
    setError('')
    try {
      if (userId && next.enabled === false) {
        await unregisterFcmToken(userId)
        next = { ...next, fcmEnabled: false }
        setDraft(next)
      }
      await onSave({
        notificationSettings: next,
        mealReminderTime: next.mealReminderTimes?.dinner ?? '18:30',
      })
      setSaved(true)
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Không thể lưu cài đặt nhắc nhở.')
    } finally {
      setSaving(false)
    }
  }

  const enablePush = async () => {
    if (!userId) {
      setError('Bạn cần đăng nhập để bật thông báo trên thiết bị này.')
      return
    }
    if (!pushSupported) {
      setError('Trình duyệt này chưa hỗ trợ Web Push. Hãy mở Aura bằng Chrome, Edge hoặc Safari phiên bản mới.')
      return
    }

    setEnablingPush(true)
    setError('')
    try {
      const token = await requestFcmPermissionAndToken(userId)
      if (!token) {
        setError(Notification.permission === 'denied'
          ? 'Trình duyệt đang chặn thông báo. Hãy cho phép Aura trong cài đặt của trình duyệt rồi thử lại.'
          : 'Chưa thể kết nối thiết bị. Hãy kiểm tra mạng, tải lại trang rồi thử lại.')
        return
      }
      const next = { ...draft, enabled: true, fcmEnabled: true }
      setDraft(next)
      await persist(next)
    } catch (pushError) {
      setError(pushError instanceof Error ? pushError.message : 'Không thể bật thông báo trên thiết bị này.')
    } finally {
      setEnablingPush(false)
    }
  }

  const handlePrimaryAction = () => {
    if (!notificationsOn || deviceReady) void persist()
    else void enablePush()
  }

  return (
    <section
      aria-labelledby="notification-settings-title"
      style={{
        position: 'relative',
        overflow: 'hidden',
        padding: '22px clamp(16px, 4vw, 24px)',
        border: '1px solid rgba(236, 72, 153, .16)',
        borderRadius: 24,
        background: 'linear-gradient(145deg, #fff 0%, #fff7fb 58%, #fff2e9 100%)',
        boxShadow: '0 14px 34px rgba(236, 72, 153, .09)',
      }}
    >
      <div style={{ position: 'absolute', inset: '0 0 auto', height: 4, background: 'linear-gradient(90deg, #ec4899, #ff873f)' }} />

      <header style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
          <span style={{ display: 'grid', placeItems: 'center', width: 42, height: 42, flex: '0 0 auto', borderRadius: 14, color: '#fff', background: 'linear-gradient(135deg, #ec4899, #ff873f)' }}>
            <Bell size={20} />
          </span>
          <div style={{ minWidth: 0 }}>
            <h3 id="notification-settings-title" style={{ margin: 0, fontSize: 18, fontWeight: 850 }}>Nhắc nhở của bạn</h3>
            <p style={{ margin: '4px 0 0', color: '#766d78', fontSize: 12, lineHeight: 1.4 }}>Chọn nội dung cần nhận, Aura tự giữ nhịp và tránh làm phiền.</p>
          </div>
        </div>
        <span style={{ flex: '0 0 auto', padding: '6px 9px', borderRadius: 999, color: deviceStatus.color, background: deviceStatus.background, fontSize: 10, fontWeight: 850 }}>
          {deviceStatus.label}
        </span>
      </header>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '13px 14px', borderRadius: 16, background: 'rgba(255,255,255,.82)', border: '1px solid rgba(92,54,72,.09)' }}>
        <div style={{ minWidth: 0 }}>
          <strong style={{ display: 'block', fontSize: 13 }}>Nhận thông báo từ Aura</strong>
          <small style={{ display: 'block', marginTop: 3, color: '#766d78', fontSize: 11, lineHeight: 1.35 }}>
            {deviceReady ? 'Thiết bị này đã sẵn sàng nhận nhắc nhở.' : 'Bật một lần để kết nối thiết bị hiện tại.'}
          </small>
        </div>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 7, flex: '0 0 auto', cursor: 'pointer', color: notificationsOn ? '#c52b6b' : '#8d8490', fontSize: 11, fontWeight: 850 }}>
          <input type="checkbox" checked={notificationsOn} onChange={(event) => update({ enabled: event.target.checked })} style={{ width: 19, height: 19, accentColor: '#ec4899' }} />
          {notificationsOn ? 'Bật' : 'Tắt'}
        </label>
      </div>

      <div style={{ marginTop: 18 }}>
        <div style={{ marginBottom: 9, color: '#211923', fontSize: 12, fontWeight: 850 }}>1. Nội dung muốn nhận</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 9 }}>
          {([
            ['mealReminders', 'Bữa ăn & nhật ký', 'Nhắc khi đến giờ ăn mà chưa có nhật ký.'],
            ['workoutReminders', 'Tập luyện & lịch PT', 'Lịch tập và lịch hẹn quan trọng.'],
            ['learningUpdates', 'Academy & streak', 'Bài học mới và nhịp học tập.'],
            ['coachMessages', 'HLV & Aura AI', 'Phản hồi mới từ HLV hoặc Aura AI.'],
          ] as const).map(([key, title, description]) => (
            <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '11px 12px', borderRadius: 14, background: 'rgba(255,255,255,.72)', border: '1px solid rgba(92,54,72,.08)', cursor: 'pointer' }}>
              <input type="checkbox" checked={draft[key] !== false} onChange={(event) => update({ [key]: event.target.checked })} style={{ width: 18, height: 18, accentColor: '#ec4899' }} />
              <span style={{ minWidth: 0, flex: 1 }}>
                <strong style={{ display: 'block', fontSize: 12 }}>{title}</strong>
                <small style={{ display: 'block', marginTop: 2, color: '#766d78', fontSize: 10, lineHeight: 1.35 }}>{description}</small>
              </span>
            </label>
          ))}
        </div>
      </div>

      <div style={{ marginTop: 18 }}>
        <div style={{ marginBottom: 9, color: '#211923', fontSize: 12, fontWeight: 850 }}>2. Nhịp bữa ăn</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8 }}>
          {([
            ['breakfast', 'Bữa sáng'],
            ['lunch', 'Bữa trưa'],
            ['dinner', 'Bữa tối'],
          ] as const).map(([key, label]) => (
            <label key={key} style={{ color: '#766d78', fontSize: 10, fontWeight: 750 }}>
              {label}
              <input type="time" value={draft.mealReminderTimes?.[key] ?? ''} onChange={(event) => updateMealTime(key, event.target.value)} style={{ display: 'block', boxSizing: 'border-box', width: '100%', marginTop: 5, padding: '9px 7px', border: '1px solid rgba(92,54,72,.14)', borderRadius: 10, background: '#fff', color: '#211923', fontSize: 12 }} />
            </label>
          ))}
        </div>
      </div>

      <details style={{ marginTop: 16, borderRadius: 14, background: 'rgba(255,255,255,.62)', border: '1px solid rgba(92,54,72,.08)' }}>
        <summary style={{ padding: '12px 13px', color: '#594d58', fontSize: 12, fontWeight: 800, cursor: 'pointer' }}>
          Cài đặt nâng cao · Giờ yên tĩnh & giới hạn
        </summary>
        <div style={{ padding: '0 13px 13px' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#766d78', fontSize: 11, cursor: 'pointer' }}>
            <input type="checkbox" checked={draft.quietHoursEnabled !== false} onChange={(event) => update({ quietHoursEnabled: event.target.checked })} style={{ width: 17, height: 17, accentColor: '#ec4899' }} />
            <Clock3 size={15} /> Không gửi trong giờ yên tĩnh
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 9, marginTop: 11 }}>
            <label style={{ color: '#766d78', fontSize: 10, fontWeight: 750 }}>
              Bắt đầu
              <input type="time" value={draft.quietHoursStart ?? '21:30'} onChange={(event) => update({ quietHoursStart: event.target.value })} style={{ display: 'block', boxSizing: 'border-box', width: '100%', marginTop: 5, padding: '9px 8px', border: '1px solid rgba(92,54,72,.14)', borderRadius: 10, background: '#fff', color: '#211923', fontSize: 12 }} />
            </label>
            <label style={{ color: '#766d78', fontSize: 10, fontWeight: 750 }}>
              Kết thúc
              <input type="time" value={draft.quietHoursEnd ?? '07:00'} onChange={(event) => update({ quietHoursEnd: event.target.value })} style={{ display: 'block', boxSizing: 'border-box', width: '100%', marginTop: 5, padding: '9px 8px', border: '1px solid rgba(92,54,72,.14)', borderRadius: 10, background: '#fff', color: '#211923', fontSize: 12 }} />
            </label>
            <label style={{ color: '#766d78', fontSize: 10, fontWeight: 750 }}>
              Tối đa mỗi ngày
              <select value={draft.maxDaily ?? 3} onChange={(event) => update({ maxDaily: Number(event.target.value) })} style={{ display: 'block', boxSizing: 'border-box', width: '100%', marginTop: 5, padding: '9px 8px', border: '1px solid rgba(92,54,72,.14)', borderRadius: 10, background: '#fff', color: '#211923', fontSize: 12, fontWeight: 800 }}>
                {[1, 2, 3, 4, 5].map((value) => <option key={value} value={value}>{value} lần</option>)}
              </select>
            </label>
          </div>
        </div>
      </details>

      {error && (
        <p role="alert" style={{ display: 'flex', alignItems: 'flex-start', gap: 7, margin: '13px 0 0', padding: '10px 12px', borderRadius: 11, color: '#b4234d', background: '#fff0f5', fontSize: 11, lineHeight: 1.4 }}>
          <AlertTriangle size={15} style={{ flex: '0 0 auto', marginTop: 1 }} /> {error}
        </p>
      )}

      <div style={{ display: 'grid', gap: 8, marginTop: 16 }}>
        <button type="button" onClick={handlePrimaryAction} disabled={saving || enablingPush} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: 44, padding: '0 16px', border: 0, borderRadius: 13, color: '#fff', background: 'linear-gradient(135deg, #ec4899, #ff873f)', boxShadow: '0 8px 20px rgba(236,72,153,.18)', fontSize: 12, fontWeight: 850, cursor: saving || enablingPush ? 'wait' : 'pointer' }}>
          {!notificationsOn ? <Bell size={16} /> : deviceReady ? <ShieldCheck size={16} /> : <Smartphone size={16} />}
          {saving ? 'Đang lưu…' : enablingPush ? 'Đang kết nối thiết bị…' : !notificationsOn ? 'Lưu trạng thái tắt' : deviceReady ? 'Lưu thay đổi' : 'Bật Push và lưu'}
        </button>
        <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, color: saved ? '#16845a' : '#8d8490', fontSize: 10, fontWeight: saved ? 800 : 600 }}>
          {saved ? <CheckCircle2 size={14} /> : <Volume2 size={13} />}
          {saved ? 'Đã lưu cài đặt' : 'Bạn có thể thay đổi hoặc tắt bất cứ lúc nào'}
        </span>
      </div>
    </section>
  )
}
