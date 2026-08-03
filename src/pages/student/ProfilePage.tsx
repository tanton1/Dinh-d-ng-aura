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
  ShieldCheck,
  Smartphone,
  Target,
  UserRound,
} from 'lucide-react'
import { PageHeader, Toggle } from '../../components/ui'

const EMPTY_GOALS: string[] = []

export interface ProfileNotificationSettings {
  enabled?: boolean
  workoutReminders?: boolean
  learningUpdates?: boolean
  coachMessages?: boolean
  [key: string]: boolean | undefined
}

export interface ProfileUpdateInput {
  displayName?: string
  goals?: string[]
  heightCm?: number | null
  weightKg?: number | null
  notificationSettings?: ProfileNotificationSettings
}

interface ProfilePageProps {
  displayName?: string
  email?: string
  membership?: string
  goals?: string[]
  heightCm?: number | null
  weightKg?: number | null
  notificationSettings?: ProfileNotificationSettings | boolean | null
  onSave?: (values: ProfileUpdateInput) => Promise<void>
  onSignOut?: () => void | Promise<void>
}

function normalizeNotificationSettings(value: ProfilePageProps['notificationSettings']): ProfileNotificationSettings {
  if (typeof value === 'boolean') return { enabled: value }
  return value ? { ...value } : { enabled: false }
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
  notificationSettings,
  onSave,
  onSignOut,
}: ProfilePageProps) {
  const [editing, setEditing] = useState(false)
  const [nameInput, setNameInput] = useState(displayName)
  const [goalsInput, setGoalsInput] = useState(goals.join(', '))
  const [heightInput, setHeightInput] = useState(heightCm == null ? '' : String(heightCm))
  const [weightInput, setWeightInput] = useState(weightKg == null ? '' : String(weightKg))
  const [savingProfile, setSavingProfile] = useState(false)
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
  }, [displayName, editing, goalsSignature, heightCm, weightKg])

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
  }

  const saveProfile = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!onSave || savingProfile) return

    const normalizedName = nameInput.trim()
    const normalizedGoals = [...new Set(goalsInput.split(/[\n,]+/).map((item) => item.trim()).filter(Boolean))]
    const normalizedHeight = heightInput.trim() === '' ? null : Number(heightInput)
    const normalizedWeight = weightInput.trim() === '' ? null : Number(weightInput)

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
      })
      setEditing(false)
      setSuccess('Hồ sơ đã được lưu thành công.')
    } catch {
      setError('Chưa thể lưu hồ sơ. Vui lòng kiểm tra kết nối và thử lại.')
    } finally {
      setSavingProfile(false)
    }
  }

  const toggleNotifications = async () => {
    if (!onSave || savingNotification) return
    const previous = notificationValues
    const next = { ...previous, enabled: !notificationEnabled }
    setNotificationValues(next)
    setSavingNotification(true)
    setError(null)
    setSuccess(null)
    try {
      await onSave({ notificationSettings: next })
      setSuccess(next.enabled ? 'Đã bật thông báo Aura.' : 'Đã tắt thông báo Aura.')
    } catch {
      setNotificationValues(previous)
      setError('Chưa thể lưu cài đặt thông báo. Vui lòng thử lại.')
    } finally {
      setSavingNotification(false)
    }
  }

  return (
    <div className="page profile-page">
      <PageHeader eyebrow="TÀI KHOẢN" title="Hồ sơ cá nhân" description="Quản lý thông tin, mục tiêu và trải nghiệm Aura của bạn." />

      <section className="profile-layout">
        <aside className="profile-summary card">
          <div className="profile-avatar">
            <span>{initials}</span>
            <button type="button" disabled aria-label="Đổi ảnh đại diện · Sắp ra mắt" title="Đổi ảnh đại diện · Sắp ra mắt"><Pencil size={15} /></button>
          </div>
          <h2>{displayName}</h2><p>{email || 'Chưa có email'}</p><span className="member-badge">AURA {membershipLabel} · HỒ SƠ AN TOÀN</span>
          <div className="profile-quick-stats">
            <div><strong>{goals.length || '—'}</strong><span>Mục tiêu</span></div>
            <div><strong>{typeof heightCm === 'number' ? heightCm : '—'}</strong><span>Chiều cao (cm)</span></div>
            <div><strong>{typeof weightKg === 'number' ? weightKg : '—'}</strong><span>Cân nặng (kg)</span></div>
          </div>
          <button className="outline-button full" type="button" onClick={beginEdit} disabled={!onSave}><Pencil size={16} /> {onSave ? 'Chỉnh sửa hồ sơ' : 'Chỉnh sửa · Sắp ra mắt'}</button>
          <div className="coach-contact" aria-label="Huấn luyện viên cá nhân sắp ra mắt">
            <div className="avatar green"><UserRound size={17} /></div><div><small>HUẤN LUYỆN VIÊN CÁ NHÂN</small><strong>Sắp ra mắt</strong></div><button type="button" disabled aria-label="Tính năng huấn luyện viên cá nhân sắp ra mắt"><ChevronRight size={18} /></button>
          </div>
        </aside>

        <div className="profile-settings">
          <article className="card profile-goal-card">
            <div className="section-heading"><div><h2>Mục tiêu & thể trạng</h2><p>Chỉ hiển thị thông tin đã lưu trong hồ sơ của bạn</p></div>{!editing && <button className="text-button" type="button" onClick={beginEdit} disabled={!onSave}>{onSave ? 'Chỉnh sửa' : 'Sắp ra mắt'}</button>}</div>

            {editing ? (
              <form className="course-form-grid" onSubmit={saveProfile}>
                <label className="span-2"><span>Tên hiển thị</span><input required maxLength={80} autoComplete="name" value={nameInput} onChange={(event) => setNameInput(event.target.value)} /></label>
                <label className="span-2"><span>Mục tiêu · phân cách bằng dấu phẩy hoặc xuống dòng</span><textarea maxLength={700} value={goalsInput} onChange={(event) => setGoalsInput(event.target.value)} placeholder="Ví dụ: Tăng sức mạnh, Cải thiện độ linh hoạt" /></label>
                <label><span>Chiều cao (cm)</span><input type="number" min="80" max="250" step="0.1" inputMode="decimal" value={heightInput} onChange={(event) => setHeightInput(event.target.value)} placeholder="Chưa thiết lập" /></label>
                <label><span>Cân nặng (kg)</span><input type="number" min="20" max="500" step="0.1" inputMode="decimal" value={weightInput} onChange={(event) => setWeightInput(event.target.value)} placeholder="Chưa thiết lập" /></label>
                <div className="span-2 editor-footer"><span>Chỉ các trường trên được cập nhật</span><div><button className="outline-button" type="button" onClick={cancelEdit} disabled={savingProfile}>Hủy</button><button className="primary-button" type="submit" disabled={savingProfile}>{savingProfile ? <LoaderCircle className="spin" size={17} /> : <Save size={17} />} {savingProfile ? 'Đang lưu...' : 'Lưu hồ sơ'}</button></div></div>
              </form>
            ) : (
              <div className="profile-goal-grid">
                <div><span><Target size={19} /></span><small>Mục tiêu</small><strong>{goalsLabel}</strong></div>
                <div><span><Ruler size={19} /></span><small>Chiều cao · Cân nặng</small><strong>{formatMeasurement(heightCm, 'cm')} · {formatMeasurement(weightKg, 'kg')}</strong></div>
                <div><span><Bell size={19} /></span><small>Thông báo</small><strong>{notificationEnabled ? 'Đang bật' : 'Đang tắt'}</strong></div>
              </div>
            )}
          </article>

          {error && <div className="builder-save-error" role="alert">{error}</div>}
          {success && <div className="goal-tip" role="status"><CheckCircle2 size={17} /><span>{success}</span></div>}

          <article className="card settings-group">
            <h2>Cài đặt trải nghiệm</h2>
            <button className="setting-row" type="button" onClick={() => void toggleNotifications()} disabled={!onSave || savingNotification} aria-pressed={notificationEnabled}>
              <span className="setting-row__icon"><Bell /></span>
              <span className="setting-row__copy"><strong>Thông báo Aura</strong><small>{savingNotification ? 'Đang đồng bộ...' : onSave ? notificationEnabled ? 'Đang bật nhắc lịch và cập nhật học tập' : 'Đang tắt' : 'Chưa kết nối lưu cài đặt'}</small></span>
              {savingNotification ? <LoaderCircle className="spin" size={19} /> : <Toggle checked={notificationEnabled} />}
            </button>
            <UpcomingSettingRow icon={<Moon />} title="Giao diện tối" description="Tùy chọn giao diện theo thiết bị" />
            <UpcomingSettingRow icon={<Globe2 />} title="Ngôn ngữ & đơn vị" description="Tiếng Việt · Kilogram (kg)" />
            <UpcomingSettingRow icon={<Smartphone />} title="Thiết bị đã đăng nhập" description="Quản lý các phiên đăng nhập" />
          </article>

          <article className="card settings-group">
            <h2>Tài khoản & quyền riêng tư</h2>
            <UpcomingSettingRow icon={<CreditCard />} title={`Quản lý gói Aura ${membershipLabel}`} description="Thông tin thanh toán và gia hạn" />
            <UpcomingSettingRow icon={<LockKeyhole />} title="Bảo mật tài khoản" description="Mật khẩu và xác thực hai lớp" />
            <UpcomingSettingRow icon={<ShieldCheck />} title="Quyền riêng tư & dữ liệu sức khỏe" />
            <UpcomingSettingRow icon={<Download />} title="Tải dữ liệu của tôi" />
          </article>

          <article className="card settings-group compact">
            <UpcomingSettingRow icon={<CircleHelp />} title="Trung tâm trợ giúp" />
            <UpcomingSettingRow icon={<UserRound />} title="Góp ý cho Aura Fitness" />
            <button className="logout-button" type="button" onClick={() => void onSignOut?.()} disabled={!onSignOut}><LogOut size={18} /> Đăng xuất</button>
          </article>
        </div>
      </section>
    </div>
  )
}
