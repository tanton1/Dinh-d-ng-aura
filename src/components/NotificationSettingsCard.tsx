import { useEffect, useMemo, useState } from 'react'
import { Bell, CheckCircle2, Clock3, Smartphone, Volume2 } from 'lucide-react'
import type { NotificationSettings } from '../types'
import { requestFcmPermissionAndToken, unregisterFcmToken } from '../services/fcmService'

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

  const permission = useMemo<NotificationPermission>(() => {
    if (typeof window === 'undefined' || !('Notification' in window)) return 'denied'
    return Notification.permission
  }, [saved, enablingPush])

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
      setError('Bạn cần đăng nhập bằng tài khoản thật để bật Push Notification.')
      return
    }
    setEnablingPush(true)
    setError('')
    try {
      const token = await requestFcmPermissionAndToken(userId)
      if (!token) {
        setError(permission === 'denied'
          ? 'Trình duyệt đang chặn thông báo. Hãy cho phép Aura trong cài đặt trình duyệt rồi thử lại.'
          : 'Chưa thể đăng ký thiết bị. Kiểm tra VAPID key và thử lại sau.')
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

  return (
    <section
      aria-labelledby="notification-settings-title"
      style={{
        position: 'relative',
        overflow: 'hidden',
        padding: 24,
        border: '1px solid rgba(236, 72, 153, .16)',
        borderRadius: 22,
        background: 'linear-gradient(145deg, #fff 0%, #fff7fb 58%, #fff2e9 100%)',
        boxShadow: '0 12px 30px rgba(236, 72, 153, .08)',
      }}
    >
      <div style={{ position: 'absolute', inset: '0 0 auto', height: 4, background: 'linear-gradient(90deg, #ec4899, #ff873f)' }} />
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 18 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ display: 'grid', placeItems: 'center', width: 40, height: 40, borderRadius: 13, color: '#fff', background: 'linear-gradient(135deg, #ec4899, #ff873f)' }}>
              <Bell size={20} />
            </span>
            <div>
              <h3 id="notification-settings-title" style={{ margin: 0, fontSize: 18, fontWeight: 850 }}>Nhắc nhở thông minh</h3>
              <p style={{ margin: '4px 0 0', color: '#766d78', fontSize: 12 }}>Aura chỉ gửi đúng lúc, không làm phiền quá mức.</p>
            </div>
          </div>
        </div>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 12, fontWeight: 800, color: draft.enabled ? '#c52b6b' : '#8d8490' }}>
          <input
            type="checkbox"
            checked={draft.enabled !== false}
            onChange={(event) => update({ enabled: event.target.checked })}
            style={{ width: 19, height: 19, accentColor: '#ec4899' }}
          />
          {draft.enabled !== false ? 'Đang bật' : 'Đang tắt'}
        </label>
      </div>

      <div style={{ display: 'grid', gap: 10 }}>
        {[
          ['mealReminders', 'Bữa ăn & nhật ký', 'Nhắc cập nhật bữa ăn khi chưa có log trong ngày.'],
          ['workoutReminders', 'Tập luyện & lịch PT', 'Nhắc trước buổi tập và lịch hẹn sắp tới.'],
          ['learningUpdates', 'Academy & streak', 'Nhắc bài học ngắn để giữ nhịp học tập.'],
          ['coachMessages', 'HLV & Aura AI', 'Thông báo khi có phản hồi mới từ HLV hoặc AI.'],
        ].map(([key, title, description]) => (
          <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderRadius: 15, background: 'rgba(255,255,255,.72)', border: '1px solid rgba(92,54,72,.08)', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={draft[key as keyof NotificationSettings] !== false}
              onChange={(event) => update({ [key]: event.target.checked })}
              style={{ width: 18, height: 18, accentColor: '#ec4899' }}
            />
            <span style={{ minWidth: 0, flex: 1 }}>
              <strong style={{ display: 'block', fontSize: 13 }}>{title}</strong>
              <small style={{ display: 'block', marginTop: 2, color: '#766d78', fontSize: 11, lineHeight: 1.35 }}>{description}</small>
            </span>
          </label>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 10, marginTop: 14 }}>
        {([
          ['breakfast', 'Bữa sáng'],
          ['lunch', 'Bữa trưa'],
          ['dinner', 'Bữa tối'],
        ] as const).map(([key, label]) => (
          <label key={key} style={{ color: '#766d78', fontSize: 11, fontWeight: 750 }}>
            {label}
            <input
              type="time"
              value={draft.mealReminderTimes?.[key] ?? ''}
              onChange={(event) => updateMealTime(key, event.target.value)}
              style={{ display: 'block', width: '100%', marginTop: 5, padding: '9px 8px', border: '1px solid rgba(92,54,72,.14)', borderRadius: 10, background: '#fff', color: '#211923', fontSize: 13 }}
            />
          </label>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 14 }}>
        <label style={{ color: '#766d78', fontSize: 11, fontWeight: 750 }}>
          Bắt đầu giờ yên tĩnh
          <input type="time" value={draft.quietHoursStart ?? '21:30'} onChange={(event) => update({ quietHoursStart: event.target.value })} style={{ display: 'block', width: '100%', marginTop: 5, padding: '9px 8px', border: '1px solid rgba(92,54,72,.14)', borderRadius: 10, background: '#fff', color: '#211923', fontSize: 13 }} />
        </label>
        <label style={{ color: '#766d78', fontSize: 11, fontWeight: 750 }}>
          Kết thúc giờ yên tĩnh
          <input type="time" value={draft.quietHoursEnd ?? '07:00'} onChange={(event) => update({ quietHoursEnd: event.target.value })} style={{ display: 'block', width: '100%', marginTop: 5, padding: '9px 8px', border: '1px solid rgba(92,54,72,.14)', borderRadius: 10, background: '#fff', color: '#211923', fontSize: 13 }} />
        </label>
      </div>

      <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginTop: 14, padding: '11px 13px', borderRadius: 12, color: '#766d78', background: 'rgba(255,255,255,.72)', border: '1px solid rgba(92,54,72,.08)', fontSize: 12, fontWeight: 750 }}>
        <span>Giới hạn nhắc nhở mỗi ngày</span>
        <select
          value={draft.maxDaily ?? 3}
          onChange={(event) => update({ maxDaily: Number(event.target.value) })}
          style={{ minWidth: 76, padding: '7px 8px', border: '1px solid rgba(92,54,72,.14)', borderRadius: 9, background: '#fff', color: '#211923', fontSize: 13, fontWeight: 800 }}
        >
          {[1, 2, 3, 4, 5].map((value) => <option key={value} value={value}>{value} lần</option>)}
        </select>
      </label>

      <label style={{ display: 'flex', alignItems: 'center', gap: 9, marginTop: 13, color: '#766d78', fontSize: 12, cursor: 'pointer' }}>
        <input type="checkbox" checked={draft.quietHoursEnabled !== false} onChange={(event) => update({ quietHoursEnabled: event.target.checked })} style={{ width: 17, height: 17, accentColor: '#ec4899' }} />
        <Clock3 size={15} /> Không gửi thông báo trong giờ yên tĩnh
      </label>

      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, marginTop: 16 }}>
        {draft.fcmEnabled && permission === 'granted' ? (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: '#16845a', fontSize: 12, fontWeight: 800 }}><CheckCircle2 size={16} /> Thiết bị đã nhận Push</span>
        ) : (
          <button type="button" onClick={enablePush} disabled={enablingPush} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, minHeight: 40, padding: '0 14px', border: 0, borderRadius: 11, color: '#fff', background: 'linear-gradient(135deg, #ec4899, #ff873f)', fontSize: 12, fontWeight: 850, cursor: enablingPush ? 'wait' : 'pointer' }}>
            <Smartphone size={16} /> {enablingPush ? 'Đang kết nối thiết bị…' : 'Bật thông báo trên thiết bị này'}
          </button>
        )}
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: '#8d8490', fontSize: 11 }}><Volume2 size={14} /> Có thể tắt bất cứ lúc nào</span>
      </div>

      {error && <p role="alert" style={{ margin: '12px 0 0', padding: '10px 12px', borderRadius: 10, color: '#b4234d', background: '#fff0f5', fontSize: 12 }}>{error}</p>}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 16 }}>
        <button type="button" onClick={() => void persist()} disabled={saving} style={{ minHeight: 40, padding: '0 18px', border: 0, borderRadius: 11, color: '#fff', background: 'linear-gradient(135deg, #ec4899, #ff873f)', fontSize: 12, fontWeight: 850, cursor: saving ? 'wait' : 'pointer' }}>
          {saving ? 'Đang lưu…' : 'Lưu cài đặt nhắc nhở'}
        </button>
        {saved && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: '#16845a', fontSize: 12, fontWeight: 800 }}><CheckCircle2 size={15} /> Đã lưu</span>}
      </div>
    </section>
  )
}
