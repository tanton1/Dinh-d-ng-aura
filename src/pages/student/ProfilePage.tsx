import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import {
  Bell,
  CheckCircle2,
  ChevronRight,
  CircleHelp,
  CreditCard,
  Download,
  Globe2,
  LoaderCircle,
  LockKeyhole,
  LogOut,
  Moon,
  Pencil,
  Ruler,
  Save,
  Scale,
  ShieldCheck,
  Smartphone,
  Target,
  UserRound,
  Zap,
  BookOpen,
  Calendar,
  Dumbbell,
  Utensils,
  Sparkles,
} from 'lucide-react'
import { PageHeader, Toggle } from '../../components/ui'
import { requestFcmPermissionAndToken } from '../../services/fcmService'
import { sendBrowserNativePushNotification } from '../../services/notificationService'
import { useAuth } from '../../contexts/AuthContext'

const EMPTY_GOALS: string[] = []

export interface ProfileNotificationSettings {
  enabled?: boolean
  workoutReminders?: boolean
  mealReminders?: boolean
  learningUpdates?: boolean
  coachMessages?: boolean
  [key: string]: boolean | undefined
}

export interface ProfileUpdateInput {
  displayName?: string
  goals?: string[]
  heightCm?: number | null
  weightKg?: number | null
  targetWeightDeltaKg?: number | null
  targetTimeframeMonths?: number | null
  targetSpeedPace?: 'slow' | 'standard' | 'fast' | null
  notificationSettings?: ProfileNotificationSettings
  mealReminderTime?: string
}

interface ProfilePageProps {
  displayName?: string
  email?: string
  membership?: string
  goals?: string[]
  heightCm?: number | null
  weightKg?: number | null
  targetWeightDeltaKg?: number | null
  targetTimeframeMonths?: number | null
  targetSpeedPace?: 'slow' | 'standard' | 'fast' | null
  notificationSettings?: ProfileNotificationSettings
  mealReminderTime?: string | boolean | null
  onSave?: (values: ProfileUpdateInput) => Promise<void>
  onSignOut?: () => void | Promise<void>
}

function normalizeNotificationSettings(value: ProfilePageProps['notificationSettings']): ProfileNotificationSettings {
  if (typeof value === 'boolean') return { enabled: value, workoutReminders: value, learningUpdates: value }
  return value ? {
    enabled: value.enabled ?? false,
    workoutReminders: value.workoutReminders ?? false,
    learningUpdates: value.learningUpdates ?? false,
    coachMessages: value.coachMessages ?? false,
    ...value
  } : { enabled: false, workoutReminders: false, learningUpdates: false, coachMessages: false }
}

function formatMeasurement(value: number | null | undefined, unit: string) {
  return typeof value === 'number' && Number.isFinite(value) ? `${value.toLocaleString('vi-VN')} ${unit}` : 'Chưa thiết lập'
}

function UpcomingSettingRow({ icon, title, description }: { icon: ReactNode; title: string; description?: string }) {
  return (
    <button className="setting-row" type="button" disabled title={`${title} · Sắp ra mắt`}>
      <span className="setting-row__icon">{icon}</span>
      <span className="setting-row__copy"><strong>{title}</strong>{description && <small>{description}</small>}</span>
      <span className="status-badge draft">Sắp ra mắt</span>
    </button>
  )
}

export default function ProfilePage({
  displayName = 'Thành viên Aura',
  email = '',
  membership = 'free',
  goals = EMPTY_GOALS,
  heightCm,
  weightKg,
  targetWeightDeltaKg,
  targetTimeframeMonths,
  targetSpeedPace,
  notificationSettings,
  mealReminderTime = "12:00",
  onSave,
  onSignOut,
}: ProfilePageProps) {
  const [editing, setEditing] = useState(false)
  const [nameInput, setNameInput] = useState(displayName)
  const [goalsInput, setGoalsInput] = useState(goals.join(', '))
  const [heightInput, setHeightInput] = useState(heightCm == null ? '' : String(heightCm))
  const [weightInput, setWeightInput] = useState(weightKg == null ? '' : String(weightKg))
  const [targetDeltaInput, setTargetDeltaInput] = useState(targetWeightDeltaKg == null ? '' : String(targetWeightDeltaKg))
  const [timeframeInput, setTimeframeInput] = useState(targetTimeframeMonths == null ? '3' : String(targetTimeframeMonths))
  const [speedPaceInput, setSpeedPaceInput] = useState<'slow' | 'standard' | 'fast'>(targetSpeedPace || 'standard')
  const [mealReminderTimeInput, setMealReminderTimeInput] = useState(mealReminderTime)
  const [savingProfile, setSavingProfile] = useState(false)
  const { user, profile } = useAuth()
  const [notificationValues, setNotificationValues] = useState<ProfileNotificationSettings>(() => normalizeNotificationSettings(notificationSettings))
  const [savingNotification, setSavingNotification] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const goalsSignature = goals.join('\u001f')
  const notificationSignature = typeof notificationSettings === 'boolean'
    ? String(notificationSettings)
    : JSON.stringify(notificationSettings ?? {})

  useEffect(() => {
    if (editing) return
    setNameInput(displayName)
    setGoalsInput(goals.join(', '))
    setHeightInput(heightCm == null ? '' : String(heightCm))
    setWeightInput(weightKg == null ? '' : String(weightKg))
    setTargetDeltaInput(targetWeightDeltaKg == null ? '' : String(targetWeightDeltaKg))
    setTimeframeInput(targetTimeframeMonths == null ? '3' : String(targetTimeframeMonths))
    setSpeedPaceInput(targetSpeedPace || 'standard')
    setMealReminderTimeInput(mealReminderTime)
  }, [displayName, editing, goalsSignature, heightCm, weightKg, targetWeightDeltaKg, targetTimeframeMonths, targetSpeedPace, mealReminderTime])

  useEffect(() => {
    setNotificationValues(normalizeNotificationSettings(notificationSettings))
  }, [notificationSignature])

  const initials = useMemo(() => {
    const parts = displayName.trim().split(/\s+/).filter(Boolean)
    return parts.map((part) => part[0]).slice(-2).join('').toUpperCase() || 'AF'
  }, [displayName])
  const notificationEnabled = notificationValues.enabled === true
  const membershipLabel = membership.trim().toUpperCase() || 'FREE'
  const goalsLabel = goals.length > 0 ? goals.join(', ') : 'Chưa thiết lập'

  const beginEdit = () => {
    if (!onSave) return
    setNameInput(displayName)
    setGoalsInput(goals.join(', '))
    setHeightInput(heightCm == null ? '' : String(heightCm))
    setWeightInput(weightKg == null ? '' : String(weightKg))
    setTargetDeltaInput(targetWeightDeltaKg == null ? '' : String(targetWeightDeltaKg))
    setTimeframeInput(targetTimeframeMonths == null ? '3' : String(targetTimeframeMonths))
    setSpeedPaceInput(targetSpeedPace || 'standard')
    setError(null)
    setSuccess(null)
    setEditing(true)
  }

  const cancelEdit = () => {
    setEditing(false)
    setError(null)
    setNameInput(displayName)
    setGoalsInput(goals.join(', '))
    setHeightInput(heightCm == null ? '' : String(heightCm))
    setWeightInput(weightKg == null ? '' : String(weightKg))
    setTargetDeltaInput(targetWeightDeltaKg == null ? '' : String(targetWeightDeltaKg))
    setTimeframeInput(targetTimeframeMonths == null ? '3' : String(targetTimeframeMonths))
    setSpeedPaceInput(targetSpeedPace || 'standard')
  }

  const saveProfile = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!onSave || savingProfile) return

    const normalizedName = nameInput.trim()
    const normalizedGoals = [...new Set(goalsInput.split(/[\n,]+/).map((item) => item.trim()).filter(Boolean))]
    const normalizedHeight = heightInput.trim() === '' ? null : Number(heightInput)
    const normalizedWeight = weightInput.trim() === '' ? null : Number(weightInput)
    const normalizedDelta = targetDeltaInput.trim() === '' ? null : Number(targetDeltaInput)
    const normalizedTimeframe = timeframeInput.trim() === '' ? null : Number(timeframeInput)
    const normalizedPace = speedPaceInput

    if (normalizedName.length < 2 || normalizedName.length > 80) {
      setError('Tên hiển thị cần từ 2 đến 80 ký tự.')
      return
    }
    if (normalizedGoals.length > 8 || normalizedGoals.some((goal) => goal.length > 80)) {
      setError('Bạn có thể lưu tối đa 8 mục tiêu, mỗi mục tiêu không quá 80 ký tự.')
      return
    }
    if (normalizedHeight !== null && (!Number.isFinite(normalizedHeight) || normalizedHeight < 80 || normalizedHeight > 250)) {
      setError('Chiều cao cần nằm trong khoảng 80–250 cm hoặc để trống.')
      return
    }
    if (normalizedWeight !== null && (!Number.isFinite(normalizedWeight) || normalizedWeight < 20 || normalizedWeight > 500)) {
      setError('Cân nặng cần nằm trong khoảng 20–500 kg hoặc để trống.')
      return
    }

    setSavingProfile(true)
    setError(null)
    setSuccess(null)
    try {
      await onSave({
        displayName: normalizedName,
        goals: normalizedGoals,
        heightCm: normalizedHeight,
        weightKg: normalizedWeight,
        targetWeightDeltaKg: normalizedDelta,
        targetTimeframeMonths: normalizedTimeframe,
        targetSpeedPace: normalizedPace,
      })
      setEditing(false)
      setSuccess('Hồ sơ đã được lưu thành công.')
    } catch {
      setError('Chưa thể lưu hồ sơ. Vui lòng kiểm tra kết nối và thử lại.')
    } finally {
      setSavingProfile(false)
    }
  }

  const [browserPermission, setBrowserPermission] = useState<NotificationPermission>(() => {
    return typeof window !== 'undefined' && 'Notification' in window ? Notification.permission : 'default'
  })

  const handleEnableWebPush = async () => {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      setError('Trình duyệt của bạn không hỗ trợ Web Push Notification.')
      return
    }

    try {
      const permission = await Notification.requestPermission()
      setBrowserPermission(permission)

      if (permission === 'granted') {
        if (user?.uid) {
          await requestFcmPermissionAndToken(user.uid)
        }
        
        const nextSettings: ProfileNotificationSettings = {
          ...notificationValues,
          enabled: true,
          workoutReminders: true,
          mealReminders: true,
          learningUpdates: true,
          coachMessages: true,
        }
        setNotificationValues(nextSettings)
        if (onSave) {
          await onSave({ notificationSettings: nextSettings })
        }

        sendBrowserNativePushNotification(
          '🔥 Aura Fitness Push Notification',
          'Chúc mừng! Bạn đã bật nhận thông báo trực tiếp trên thiết bị này.'
        )
        setSuccess('Đã kích hoạt thành công Push Notification trên thiết bị!')
      } else if (permission === 'denied') {
        setError('Quyền thông báo đã bị từ chối trong cài đặt trình duyệt.')
      }
    } catch (e) {
      console.error(e)
      setError('Có lỗi xảy ra khi yêu cầu quyền thông báo.')
    }
  }

  const handleTestPushNotification = () => {
    sendBrowserNativePushNotification(
      '🔔 Thử nghiệm thông báo đẩy Aura',
      'Đây là thông báo thử nghiệm từ hệ thống Aura Fitness! Hệ thống đang hoạt động hoàn hảo.'
    )
    setSuccess('Đã phát thử nghiệm thông báo đẩy trực tiếp tới thiết bị.')
  }

  const toggleNotificationKey = async (key: keyof ProfileNotificationSettings) => {
    if (!onSave || savingNotification) return
    const previous = notificationValues
    const nextValue = !previous[key]
    const next = { ...previous, [key]: nextValue }

    if (key !== 'enabled' && nextValue && !previous.enabled) {
      next.enabled = true
    }

    setNotificationValues(next)
    setSavingNotification(true)
    setError(null)
    setSuccess(null)
    try {
      await onSave({ notificationSettings: next })
      setSuccess('Đã cập nhật cài đặt thông báo.')
    } catch {
      setNotificationValues(previous)
      setError('Chưa thể lưu cài đặt thông báo. Vui lòng thử lại.')
    } finally {
      setSavingNotification(false)
    }
  }

  return (
    <div className="page profile-page">
      <section className="profile-layout" style={{ maxWidth: '600px', margin: '0 auto' }}>
        {error && (
          <div style={{
            padding: '12px 16px',
            borderRadius: '12px',
            backgroundColor: '#fef2f2',
            border: '1px solid #fecaca',
            color: '#991b1b',
            fontSize: '13px',
            fontWeight: 600,
            marginBottom: '16px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}>
            <span>⚠️ {error}</span>
          </div>
        )}
        {success && (
          <div style={{
            padding: '12px 16px',
            borderRadius: '12px',
            backgroundColor: '#f0fdf4',
            border: '1px solid #bbf7d0',
            color: '#166534',
            fontSize: '13px',
            fontWeight: 600,
            marginBottom: '16px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}>
            <span>✅ {success}</span>
          </div>
        )}

        <aside className="profile-summary-new">
          <div className="profile-summary-bg"></div>
          <div className="profile-top-row">
            <div className="profile-avatar-wrapper">
              <div className="avatar-circle">
                <span>{initials}</span>
                <button className="edit-btn" aria-label="Đổi ảnh đại diện"><Pencil size={12} /></button>
              </div>
              <div className="status-indicator">
                <span className="dot"></span> Đang hoạt động
              </div>
            </div>
            <div className="profile-info-wrapper">
              <div className="pills-row">
                <span className="hello-pill">Xin chào 👋</span>
                <button className="view-profile-pill">Xem hồ sơ <ChevronRight size={14} /></button>
              </div>
              <h2>{displayName}</h2>
              <p>{email || 'Chưa có email'}</p>
              <span className="member-badge">AURA {membershipLabel} · HỒ SƠ AN TOÀN</span>
            </div>
          </div>

          <div className="profile-stats-card">
            <div className="stats-grid">
              <div className="stat-col">
                <span className="stat-icon red-icon"><Target size={20} /></span>
                <strong>{goals.length || '1'}</strong>
                <small>Mục tiêu</small>
              </div>
              <div className="stat-col">
                <span className="stat-icon purple-icon"><Ruler size={20} /></span>
                <strong>{typeof heightCm === 'number' ? heightCm : '—'} <span className="unit">cm</span></strong>
                <small>Chiều cao</small>
              </div>
              <div className="stat-col">
                <span className="stat-icon orange-icon"><Scale size={20} /></span>
                <strong>{typeof weightKg === 'number' ? weightKg : '—'} <span className="unit">kg</span></strong>
                <small>Cân nặng</small>
              </div>
              <div className="stat-col">
                <span className="stat-icon pink-icon"><Calendar size={20} /></span>
                <strong>32</strong>
                <small>Ngày tham gia</small>
              </div>
            </div>
            <button className="outline-button-pink full" type="button" onClick={beginEdit} disabled={!onSave}>
              <Pencil size={15} /> {onSave ? 'Chỉnh sửa hồ sơ' : 'Chỉnh sửa hồ sơ'}
            </button>
          </div>
        </aside>

        <div className="coach-card-new" aria-label="Huấn luyện viên cá nhân sắp ra mắt">
          <div className="avatar-circle-sm"><UserRound size={24} /></div>
          <div className="info">
            <small>HUẤN LUYỆN VIÊN CÁ NHÂN</small>
            <strong>Sắp ra mắt</strong>
            <p>Bạn sẽ được thông báo khi có HLV phù hợp!</p>
          </div>
          <ChevronRight className="arrow" size={20} />
        </div>

        <article className="section-card">
          <div className="section-header-row">
            <h2>Mục tiêu & thể trạng</h2>
            {!editing && (
              <button className="text-button pink" type="button" onClick={beginEdit} disabled={!onSave}>
                Chỉnh sửa <ChevronRight size={16} />
              </button>
            )}
          </div>
          
          {editing ? (
            <form className="course-form-grid" onSubmit={saveProfile}>
              <label className="span-2"><span>Tên hiển thị</span><input required maxLength={80} autoComplete="name" value={nameInput} onChange={(event) => setNameInput(event.target.value)} /></label>
              <label className="span-2"><span>Mục tiêu chính · phân cách bằng dấu phẩy hoặc xuống dòng</span><textarea maxLength={700} value={goalsInput} onChange={(event) => setGoalsInput(event.target.value)} placeholder="Ví dụ: Giảm mỡ, Tăng cơ, Cải thiện sức bền" /></label>
              <label><span>Chiều cao (cm)</span><input type="number" min="80" max="250" step="0.1" inputMode="decimal" value={heightInput} onChange={(event) => setHeightInput(event.target.value)} placeholder="Chưa thiết lập" /></label>
              <label><span>Cân nặng (kg)</span><input type="number" min="20" max="500" step="0.1" inputMode="decimal" value={weightInput} onChange={(event) => setWeightInput(event.target.value)} placeholder="Chưa thiết lập" /></label>
              
              <label>
                <span>Mục tiêu thay đổi cân nặng (kg)</span>
                <input type="number" step="0.5" min="-50" max="50" value={targetDeltaInput} onChange={(e) => setTargetDeltaInput(e.target.value)} placeholder="Ví dụ: -5 (giảm) hoặc +3 (tăng)" />
                <small style={{ color: '#6b7280', fontSize: '11px', marginTop: '2px', display: 'block' }}>Nhập số âm (-) để giảm, số dương (+) để tăng cân</small>
              </label>
              <label>
                <span>Thời gian thực hiện (1–12 tháng)</span>
                <select value={timeframeInput} onChange={(e) => setTimeframeInput(e.target.value)}>
                  <option value="1">1 tháng</option>
                  <option value="2">2 tháng</option>
                  <option value="3">3 tháng (Khuyên dùng)</option>
                  <option value="4">4 tháng</option>
                  <option value="6">6 tháng</option>
                  <option value="9">9 tháng</option>
                  <option value="12">12 tháng (1 năm)</option>
                </select>
              </label>
              <label className="span-2">
                <span>Tốc độ tiến trình</span>
                <select value={speedPaceInput} onChange={(e) => setSpeedPaceInput(e.target.value as any)}>
                  <option value="slow">Thong thả & Bền vững (Chậm nhưng chắc chắn)</option>
                  <option value="standard">Tiêu chuẩn & An toàn (Được đề xuất)</option>
                  <option value="fast">Nhanh & Quyết liệt (Cần kỷ luật cao)</option>
                </select>
              </label>
              <div className="span-2 editor-footer">
                <span>Các thông tin sẽ được đồng bộ cùng Aura AI</span>
                <div>
                  <button className="outline-button" type="button" onClick={cancelEdit} disabled={savingProfile}>Hủy</button>
                  <button className="primary-button" type="submit" disabled={savingProfile}>{savingProfile ? <LoaderCircle className="spin" size={17} /> : <Save size={17} />} {savingProfile ? 'Đang lưu...' : 'Lưu hồ sơ'}</button>
                </div>
              </div>
            </form>
          ) : (
            <div className="list-group">
              <div className="list-item">
                <div className="icon-wrapper red-soft"><Target size={20}/></div>
                <div className="item-content">
                  <small>Mục tiêu chính</small>
                  <strong>{goalsLabel || 'Chưa thiết lập'}</strong>
                </div>
                <div className="item-action">
                  <span className="status-pill pink-soft">Đang thực hiện</span>
                </div>
              </div>
              
              <div className="list-item">
                <div className="icon-wrapper purple-soft"><Ruler size={20}/></div>
                <div className="item-content">
                  <small>Chiều cao · Cân nặng</small>
                  <strong>{formatMeasurement(heightCm, 'cm')} · {formatMeasurement(weightKg, 'kg')}</strong>
                </div>
                <div className="item-action">
                  <span className="status-text green">BMI {heightCm && weightKg ? (weightKg / Math.pow(heightCm / 100, 2)).toFixed(1) : '--'}</span>
                </div>
              </div>

              <div className="list-item">
                <div className="icon-wrapper orange-soft"><Scale size={20}/></div>
                <div className="item-content">
                  <small>Thay đổi cân nặng mong muốn</small>
                  <strong>
                    {targetWeightDeltaKg != null
                      ? targetWeightDeltaKg < 0
                        ? `Giảm ${Math.abs(targetWeightDeltaKg)} kg`
                        : targetWeightDeltaKg > 0
                        ? `Tăng ${targetWeightDeltaKg} kg`
                        : 'Duy trì cân nặng'
                      : 'Chưa thiết lập'}
                  </strong>
                </div>
                <div className="item-action">
                  <span className="status-text dark">Còn {Math.abs(targetWeightDeltaKg || 0)} kg</span>
                </div>
              </div>
              
              <div className="list-item">
                <div className="icon-wrapper red-soft"><Calendar size={20}/></div>
                <div className="item-content">
                  <small>Thời gian thực hiện</small>
                  <strong>{profile?.targetTimeframeMonths || 3} tháng</strong>
                </div>
                <div className="item-action">
                  <div className="progress-mini">
                    <span className="progress-text pink">32%</span>
                    <div className="progress-bar-bg"><div className="progress-bar-fill pink" style={{width: '32%'}}></div></div>
                  </div>
                </div>
              </div>

              <div className="list-item">
                <div className="icon-wrapper red-soft"><Zap size={20}/></div>
                <div className="item-content">
                  <small>Tốc độ tiến trình</small>
                  <strong>{profile?.targetSpeedPace === 'slow' ? 'Thong thả' : profile?.targetSpeedPace === 'fast' ? 'Nhanh' : 'Tiêu chuẩn (~0.5 kg/tuần)'}</strong>
                </div>
                <div className="item-action">
                  <span className="status-text pink">Ổn định</span>
                </div>
              </div>
            </div>
          )}
        </article>

        {/* Push Notification Settings Card - Tone Gradient Pink-Orange */}
        <article className="section-card" style={{ marginTop: '24px' }}>
          <div style={{
            background: 'linear-gradient(135deg, #f43f5e 0%, #fb923c 100%)',
            borderRadius: '18px',
            padding: '22px 24px',
            color: '#ffffff',
            marginBottom: '20px',
            boxShadow: '0 12px 28px -6px rgba(244, 63, 94, 0.35)',
            position: 'relative',
            overflow: 'hidden'
          }}>
            <div style={{
              position: 'absolute',
              right: '-25px',
              top: '-25px',
              width: '140px',
              height: '140px',
              background: 'rgba(255, 255, 255, 0.12)',
              borderRadius: '50%',
              pointerEvents: 'none'
            }} />

            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '16px', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                <div style={{
                  width: '46px',
                  height: '46px',
                  borderRadius: '14px',
                  background: 'rgba(255, 255, 255, 0.22)',
                  backdropFilter: 'blur(8px)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#ffffff',
                  flexShrink: 0
                }}>
                  <Bell size={24} />
                </div>
                <div>
                  <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 800, color: '#ffffff', letterSpacing: '-0.02em' }}>
                    Cài đặt Push Notification
                  </h2>
                  <p style={{ margin: '4px 0 0', fontSize: '13px', color: 'rgba(255, 255, 255, 0.95)', lineHeight: 1.4 }}>
                    Nhận thông báo nhắc nhở giờ tập, dinh dưỡng & lời khuyên từ HLV trực tiếp trên thiết bị
                  </p>
                </div>
              </div>

              <div>
                {browserPermission === 'granted' ? (
                  <span style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '6px 12px',
                    borderRadius: '20px',
                    background: 'rgba(255, 255, 255, 0.28)',
                    backdropFilter: 'blur(4px)',
                    color: '#ffffff',
                    fontSize: '12px',
                    fontWeight: 700
                  }}>
                    <CheckCircle2 size={14} /> Đã cấp quyền thiết bị
                  </span>
                ) : browserPermission === 'denied' ? (
                  <span style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '6px 12px',
                    borderRadius: '20px',
                    background: 'rgba(190, 18, 60, 0.5)',
                    backdropFilter: 'blur(4px)',
                    color: '#ffffff',
                    fontSize: '12px',
                    fontWeight: 700
                  }}>
                    ⚠️ Đã bị chặn trong cài đặt
                  </span>
                ) : (
                  <span style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '6px 12px',
                    borderRadius: '20px',
                    background: 'rgba(255, 255, 255, 0.22)',
                    backdropFilter: 'blur(4px)',
                    color: '#ffffff',
                    fontSize: '12px',
                    fontWeight: 700
                  }}>
                    Chưa kích hoạt trên thiết bị
                  </span>
                )}
              </div>
            </div>

            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '12px',
              marginTop: '16px',
              paddingTop: '14px',
              borderTop: '1px solid rgba(255, 255, 255, 0.22)',
              flexWrap: 'wrap'
            }}>
              <span style={{ fontSize: '13px', color: '#ffffff', fontWeight: 600 }}>
                {browserPermission === 'granted'
                  ? 'Quyền Push Notification trên thiết bị này đã sẵn sàng!'
                  : 'Cho phép nhận thông báo trực tiếp trên màn hình khóa điện thoại hoặc máy tính.'}
              </span>

              <div style={{ display: 'flex', gap: '10px' }}>
                {browserPermission === 'granted' && (
                  <button
                    type="button"
                    onClick={handleTestPushNotification}
                    style={{
                      padding: '8px 16px',
                      borderRadius: '10px',
                      border: '1px solid rgba(255, 255, 255, 0.4)',
                      background: 'rgba(255, 255, 255, 0.18)',
                      color: '#ffffff',
                      fontSize: '13px',
                      fontWeight: 700,
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '6px',
                      transition: 'all 0.15s ease'
                    }}
                  >
                    <Zap size={15} /> Thử gửi Push
                  </button>
                )}

                <button
                  type="button"
                  onClick={handleEnableWebPush}
                  style={{
                    padding: '8px 18px',
                    borderRadius: '10px',
                    border: 'none',
                    background: '#ffffff',
                    color: '#f43f5e',
                    fontSize: '13px',
                    fontWeight: 800,
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
                    transition: 'all 0.15s ease'
                  }}
                >
                  <Smartphone size={16} />
                  {browserPermission === 'granted' ? 'Đồng bộ lại quyền thiết bị' : 'Bật Push Notification ngay'}
                </button>
              </div>
            </div>
          </div>

          <div className="section-header-row" style={{ marginBottom: '14px' }}>
            <h2 style={{ fontSize: '16px', fontWeight: 700, margin: 0, color: '#0f172a' }}>Danh mục thông báo muốn nhận</h2>
            <small style={{ color: '#64748b', fontSize: '12px' }}>Tự do chọn các loại thông báo bạn muốn hệ thống gửi</small>
          </div>

          <div className="list-group">
            <div 
              className="list-item" 
              onClick={() => toggleNotificationKey('workoutReminders')}
              style={{ cursor: 'pointer' }}
            >
              <div className="icon-wrapper" style={{ background: 'linear-gradient(135deg, #f43f5e, #fb923c)', color: '#ffffff' }}>
                <Dumbbell size={18} />
              </div>
              <div className="item-content">
                <small style={{ color: '#f43f5e', fontWeight: 700 }}>Tập luyện & Lịch trình</small>
                <strong>Nhắc nhở giờ tập gym & bài tập hôm nay</strong>
                <p style={{ margin: '2px 0 0', fontSize: '12px', color: '#64748b' }}>Thông báo trước giờ tập 15-30 phút để duy trì tính kỷ luật</p>
              </div>
              <div className="item-action">
                <Toggle checked={notificationValues.workoutReminders !== false} />
              </div>
            </div>

            <div 
              className="list-item" 
              onClick={() => toggleNotificationKey('mealReminders')}
              style={{ cursor: 'pointer' }}
            >
              <div className="icon-wrapper" style={{ background: 'linear-gradient(135deg, #ec4899, #f97316)', color: '#ffffff' }}>
                <Utensils size={18} />
              </div>
              <div className="item-content">
                <small style={{ color: '#ec4899', fontWeight: 700 }}>Dinh dưỡng & Nước uống</small>
                <strong>Nhắc nhở ghi chép bữa ăn & uống nước</strong>
                <p style={{ margin: '2px 0 0', fontSize: '12px', color: '#64748b' }}>Nhắc nhở chụp ảnh bữa ăn đúng khung giờ ({mealReminderTime || '12:00'})</p>
              </div>
              <div className="item-action">
                <Toggle checked={notificationValues.mealReminders !== false} />
              </div>
            </div>

            <div 
              className="list-item" 
              onClick={() => toggleNotificationKey('learningUpdates')}
              style={{ cursor: 'pointer' }}
            >
              <div className="icon-wrapper" style={{ background: 'linear-gradient(135deg, #f43f5e, #fb923c)', color: '#ffffff' }}>
                <BookOpen size={18} />
              </div>
              <div className="item-content">
                <small style={{ color: '#f43f5e', fontWeight: 700 }}>Bài giảng & Kiến thức</small>
                <strong>Cập nhật bài học mới & chuỗi học tập (Streak)</strong>
                <p style={{ margin: '2px 0 0', fontSize: '12px', color: '#64748b' }}>Nhắc nhở hoàn thành bài học để giữ chuỗi ngày liên tục</p>
              </div>
              <div className="item-action">
                <Toggle checked={notificationValues.learningUpdates !== false} />
              </div>
            </div>

            <div 
              className="list-item" 
              onClick={() => toggleNotificationKey('coachMessages')}
              style={{ cursor: 'pointer' }}
            >
              <div className="icon-wrapper" style={{ background: 'linear-gradient(135deg, #ec4899, #f97316)', color: '#ffffff' }}>
                <Sparkles size={18} />
              </div>
              <div className="item-content">
                <small style={{ color: '#ec4899', fontWeight: 700 }}>HLV & Aura AI Assistant</small>
                <strong>Phản hồi từ HLV cá nhân & trợ lý AI</strong>
                <p style={{ margin: '2px 0 0', fontSize: '12px', color: '#64748b' }}>Nhận xét thực đơn, đánh giá form tập & khuyến nghị riêng cho bạn</p>
              </div>
              <div className="item-action">
                <Toggle checked={notificationValues.coachMessages !== false} />
              </div>
            </div>
          </div>
        </article>
      </section>
    </div>
  )
}
