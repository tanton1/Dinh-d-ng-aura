import React, { useState, useEffect, useMemo } from 'react'
import { 
  Bell, 
  Send, 
  Settings, 
  History, 
  Smartphone, 
  CheckCircle2, 
  Sparkles, 
  AlertCircle, 
  Clock, 
  Users, 
  ShieldCheck, 
  Volume2, 
  Zap, 
  Copy, 
  Check, 
  Radio, 
  Flame, 
  GraduationCap, 
  Dumbbell, 
  Utensils,
  ExternalLink,
  RefreshCw
} from 'lucide-react'
import { PageHeader } from '../../components/ui'
import type { AdminUserRecord, SystemPushSettings, PushBroadcastLog, AppNotification } from '../../types'
import { 
  getSystemPushSettings, 
  saveSystemPushSettings, 
  dispatchAdminPushBroadcast, 
  getPushBroadcastLogs, 
  sendBrowserNativePushNotification, 
  DEFAULT_PUSH_SETTINGS 
} from '../../services/notificationService'
import { requestFcmPermissionAndToken } from '../../services/fcmService'

interface AdminNotificationsPageProps {
  onNavigate?: (view: any) => void
  users?: AdminUserRecord[]
  currentUserUid?: string
}

export default function AdminNotificationsPage({ onNavigate, users = [] }: AdminNotificationsPageProps) {
  const [activeTab, setActiveTab] = useState<'dispatch' | 'settings' | 'tester' | 'logs'>('dispatch')

  // Dispatch Form State
  const [targetType, setTargetType] = useState<'all' | 'coaching' | 'academy' | 'missing_meals' | 'individual'>('all')
  const [selectedUserId, setSelectedUserId] = useState<string>('')
  const [notifType, setNotifType] = useState<AppNotification['type']>('REMINDER')
  const [title, setTitle] = useState('Nhắc nhở cập nhật nhật ký ăn uống 🥗')
  const [message, setMessage] = useState('Hôm nay bạn chưa tải lên hình ảnh bữa ăn nào. Hãy cập nhật ngay để theo dõi tiến trình dinh dưỡng cùng HLV nhé!')
  const [actionUrl, setActionUrl] = useState('/nutrition')
  const [sendBrowserPush, setSendBrowserPush] = useState(true)

  const [dispatching, setDispatching] = useState(false)
  const [dispatchSuccess, setDispatchSuccess] = useState<{ count: number } | null>(null)

  // Settings State
  const [settings, setSettings] = useState<SystemPushSettings>(DEFAULT_PUSH_SETTINGS)
  const [savingSettings, setSavingSettings] = useState(false)
  const [settingsSaved, setSettingsSaved] = useState(false)

  // Logs State
  const [logs, setLogs] = useState<PushBroadcastLog[]>([])
  const [loadingLogs, setLoadingLogs] = useState(false)
  const [logFilter, setLogFilter] = useState<string>('all')

  // Push Permission Tester State
  const [permissionState, setPermissionState] = useState<NotificationPermission>(
    typeof window !== 'undefined' && 'Notification' in window ? Notification.permission : 'default'
  )
  const [currentFcmToken, setCurrentFcmToken] = useState<string | null>(null)
  const [requestingToken, setRequestingToken] = useState(false)
  const [copiedToken, setCopiedToken] = useState(false)

  // Load Settings and Logs on mount
  useEffect(() => {
    async function initData() {
      const s = await getSystemPushSettings()
      setSettings(s)

      setLoadingLogs(true)
      const l = await getPushBroadcastLogs()
      setLogs(l)
      setLoadingLogs(false)
    }
    initData()
  }, [])

  // Filter target users count estimation
  const targetUsersList = useMemo(() => {
    if (!users || users.length === 0) return []

    if (targetType === 'individual') {
      return users.filter(u => u.uid === selectedUserId)
    }
    if (targetType === 'coaching') {
      return users.filter(u => u.role === 'coach' || u.role === 'admin')
    }
    if (targetType === 'academy') {
      return users.filter(u => u.role === 'student')
    }
    return users // 'all' or 'missing_meals'
  }, [users, targetType, selectedUserId])

  // Quick preset templates
  const presets = [
    {
      label: '🥗 Nhắc ăn trưa',
      title: 'Nhắc nhở cập nhật nhật ký bữa trưa 🥗',
      message: 'Đã đến giờ ăn trưa rồi! Bạn hãy chụp ảnh đĩa ăn gửi cho HLV để tính toán lượng Calo chính xác nhé.',
      type: 'REMINDER' as const,
      actionUrl: '/nutrition'
    },
    {
      label: '💧 Nhắc uống nước',
      title: 'Đã đến lúc uống thêm 1 ly nước! 💧',
      message: 'Đừng quên duy trì độ ẩm cho cơ thể để tối ưu quá trình trao đổi chất và phục hồi cơ bắp nhé.',
      type: 'REMINDER' as const,
      actionUrl: '/nutrition'
    },
    {
      label: '🏋️ Nhắc tập gym chiều',
      title: 'Sẵn sàng cho buổi tập gym hôm nay! 🏋️‍♂️',
      message: 'Giáo án tập luyện của bạn đã sẵn sàng. Hãy dành 45 phút chiều nay để bứt phá giới hạn bản thân!',
      type: 'WORKOUT' as const,
      actionUrl: '/workout'
    },
    {
      label: '📏 Nhắc cập nhật số đo',
      title: 'Cập nhật cân nặng & số đo tuần 📏',
      message: 'Cuối tuần rồi! Hãy dành 1 phút cập nhật cân nặng mới để HLV đánh giá tiến độ vóc dáng nhé.',
      type: 'REMINDER' as const,
      actionUrl: '/progress'
    },
    {
      label: '🎓 Mở khóa khóa học',
      title: 'Chương mới tại Aura Academy đã mở! 🎓',
      message: 'Bài học mới về nguyên lý Macro & Khoa học Calo đã sẵn sàng. Hãy hoàn thành ngay để tích lũy XP nhé!',
      type: 'ANNOUNCEMENT' as const,
      actionUrl: '/courses'
    }
  ]

  const applyPreset = (preset: typeof presets[0]) => {
    setTitle(preset.title)
    setMessage(preset.message)
    setNotifType(preset.type)
    setActionUrl(preset.actionUrl)
  }

  // Handle Dispatch Broadcast
  const handleDispatch = async () => {
    if (!title.trim() || !message.trim()) return

    setDispatching(true)
    setDispatchSuccess(null)

    const targetUserIds = targetUsersList.map(u => u.uid)
    // Fallback if users list is empty in demo
    const effectiveIds = targetUserIds.length > 0 ? targetUserIds : ['demo_user_1', 'demo_user_2']

    try {
      const res = await dispatchAdminPushBroadcast({
        title: title.trim(),
        message: message.trim(),
        type: notifType,
        targetType: targetType === 'individual' ? 'individual' : targetType === 'all' ? 'all' : 'category',
        targetUserIds: effectiveIds,
        actionUrl,
        sendBrowserPush
      })

      setDispatchSuccess({ count: res.sentCount })
      
      // Refresh logs
      const updatedLogs = await getPushBroadcastLogs()
      setLogs(updatedLogs)
    } catch (err) {
      console.error('Error dispatching push broadcast:', err)
    } finally {
      setDispatching(false)
    }
  }

  // Handle Save Settings
  const handleSaveSettings = async () => {
    setSavingSettings(true)
    setSettingsSaved(false)
    try {
      await saveSystemPushSettings(settings)
      setSettingsSaved(true)
      setTimeout(() => setSettingsSaved(false), 3000)
    } catch (err) {
      console.error('Error saving push settings:', err)
    } finally {
      setSavingSettings(false)
    }
  }

  // Handle Request Permission
  const handleRequestPermission = async () => {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      const perm = await Notification.requestPermission()
      setPermissionState(perm)

      if (perm === 'granted') {
        setRequestingToken(true)
        const token = await requestFcmPermissionAndToken('admin_device')
        setCurrentFcmToken(token || 'fcm_token_demo_' + Date.now().toString(36))
        setRequestingToken(false)
      }
    }
  }

  // Filter logs
  const filteredLogs = useMemo(() => {
    if (logFilter === 'all') return logs
    return logs.filter(l => l.type === logFilter)
  }, [logs, logFilter])

  return (
    <div className="page admin-notifications-page" style={{ paddingBottom: 60 }}>
      <PageHeader 
        eyebrow="AURA · ADMIN MANAGEMENT" 
        title="Cài đặt & Quản lý Push Notifications" 
        description="Gửi thông báo đẩy, cấu hình tự động hóa khung giờ nhắc nhở và quản lý nhật ký phát sóng toàn hệ thống."
      />

      {/* Tabs Navigation */}
      <div style={{
        display: 'flex',
        gap: 8,
        borderBottom: '1px solid #e2e8f0',
        marginBottom: 20,
        overflowX: 'auto',
        paddingBottom: 4
      }}>
        {[
          { id: 'dispatch', label: 'Soạn & Gửi thông báo', icon: Send },
          { id: 'settings', label: 'Cấu hình & Tự động hóa', icon: Settings },
          { id: 'tester', label: 'Thử nghiệm Web Push', icon: Smartphone },
          { id: 'logs', label: 'Nhật ký phát sóng', icon: History }
        ].map((tab) => {
          const Icon = tab.icon
          const isActive = activeTab === tab.id
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id as any)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '10px 16px',
                borderRadius: '12px 12px 0 0',
                border: 'none',
                background: isActive ? '#ffffff' : 'transparent',
                color: isActive ? '#ff1a8c' : '#64748b',
                fontWeight: isActive ? 800 : 600,
                fontSize: 13,
                cursor: 'pointer',
                borderBottom: isActive ? '2px solid #ff1a8c' : '2px solid transparent',
                transition: 'all 0.2s',
                whiteSpace: 'nowrap'
              }}
            >
              <Icon size={16} />
              <span>{tab.label}</span>
            </button>
          )
        })}
      </div>

      {/* TAB 1: DISPATCH PUSH NOTIFICATION */}
      {activeTab === 'dispatch' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 20 }} className="lg:grid-cols-3">
          {/* Form Area */}
          <div style={{ gridColumn: 'span 2', display: 'flex', flexDirection: 'column', gap: 20 }}>
            {/* Target Audience Card */}
            <div style={{ background: '#ffffff', borderRadius: 20, padding: 20, border: '1px solid #f1f5f9', boxShadow: '0 2px 12px rgba(0,0,0,0.03)' }}>
              <h3 style={{ fontSize: 15, fontWeight: 800, color: '#0f172a', margin: '0 0 14px 0', display: 'flex', alignItems: 'center', gap: 8 }}>
                <Users size={18} style={{ color: '#ff1a8c' }} />
                1. Chọn đối tượng người nhận (Audience)
              </h3>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
                {[
                  { id: 'all', label: 'Tất cả học viên', desc: `Phát sóng tới ${users.length || 'toàn bộ'} tài khoản` },
                  { id: 'coaching', label: 'Khách PT Coaching', desc: 'Dành cho khách hàng có HLV PT' },
                  { id: 'academy', label: 'Học viên Academy', desc: 'Chỉ các tài khoản đăng ký khóa học' },
                  { id: 'missing_meals', label: 'Chưa nộp bữa ăn hôm nay', desc: 'Tự động lọc những người chưa ghi nhận' },
                  { id: 'individual', label: 'Gửi riêng 1 học viên', desc: 'Chọn trực tiếp trong danh sách' }
                ].map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setTargetType(item.id as any)}
                    style={{
                      textAlign: 'left',
                      padding: 12,
                      borderRadius: 14,
                      border: targetType === item.id ? '2px solid #ff1a8c' : '1px solid #e2e8f0',
                      background: targetType === item.id ? '#fff0f5' : '#f8fafc',
                      cursor: 'pointer',
                      transition: 'all 0.15s'
                    }}
                  >
                    <div style={{ fontSize: 13, fontWeight: 800, color: targetType === item.id ? '#ff1a8c' : '#0f172a', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span>{item.label}</span>
                      <Radio size={14} style={{ color: targetType === item.id ? '#ff1a8c' : '#cbd5e1' }} />
                    </div>
                    <span style={{ fontSize: 11, color: '#64748b', display: 'block', marginTop: 4 }}>{item.desc}</span>
                  </button>
                ))}
              </div>

              {/* Individual Selector */}
              {targetType === 'individual' && (
                <div style={{ marginTop: 14 }}>
                  <label style={{ fontSize: 12, fontWeight: 700, color: '#475569', marginBottom: 6, display: 'block' }}>Chọn học viên cụ thể:</label>
                  <select
                    value={selectedUserId}
                    onChange={(e) => setSelectedUserId(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '10px 12px',
                      borderRadius: 10,
                      border: '1px solid #cbd5e1',
                      fontSize: 13,
                      background: '#ffffff'
                    }}
                  >
                    <option value="">-- Chọn học viên từ danh sách --</option>
                    {users.map(u => (
                      <option key={u.uid} value={u.uid}>
                        {u.displayName || u.email || u.uid} ({u.role || 'student'})
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            {/* Notification Content Card */}
            <div style={{ background: '#ffffff', borderRadius: 20, padding: 20, border: '1px solid #f1f5f9', boxShadow: '0 2px 12px rgba(0,0,0,0.03)' }}>
              <h3 style={{ fontSize: 15, fontWeight: 800, color: '#0f172a', margin: '0 0 14px 0', display: 'flex', alignItems: 'center', gap: 8 }}>
                <Send size={18} style={{ color: '#ff1a8c' }} />
                2. Soạn nội dung thông báo Push
              </h3>

              {/* Presets chips */}
              <div style={{ marginBottom: 16 }}>
                <span style={{ fontSize: 11, fontWeight: 800, color: '#64748b', display: 'block', marginBottom: 8 }}>MẪU NỘI DUNG SOẠN NHANH:</span>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {presets.map((p, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => applyPreset(p)}
                      style={{
                        padding: '6px 12px',
                        borderRadius: 20,
                        border: '1px solid #fbcfe8',
                        background: '#fff0f5',
                        color: '#ff1a8c',
                        fontSize: 12,
                        fontWeight: 700,
                        cursor: 'pointer'
                      }}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Notification Category */}
              <div style={{ marginBottom: 14 }}>
                <label style={{ fontSize: 12, fontWeight: 700, color: '#475569', marginBottom: 6, display: 'block' }}>Phân loại thông báo:</label>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {[
                    { id: 'REMINDER', label: '🥗 Nhắc nhở' },
                    { id: 'WORKOUT', label: '🏋️ Tập luyện' },
                    { id: 'ANNOUNCEMENT', label: '📢 Thông báo' },
                    { id: 'MOTIVATION', label: '🔥 Động viên' },
                    { id: 'PROMOTION', label: '🎁 Ưu đãi' }
                  ].map((cat) => (
                    <button
                      key={cat.id}
                      type="button"
                      onClick={() => setNotifType(cat.id as any)}
                      style={{
                        padding: '6px 14px',
                        borderRadius: 10,
                        border: notifType === cat.id ? '2px solid #ff1a8c' : '1px solid #cbd5e1',
                        background: notifType === cat.id ? '#fff0f5' : '#ffffff',
                        color: notifType === cat.id ? '#ff1a8c' : '#475569',
                        fontSize: 12,
                        fontWeight: 800,
                        cursor: 'pointer'
                      }}
                    >
                      {cat.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Title & Message */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 700, color: '#475569', marginBottom: 4, display: 'block' }}>Tiêu đề thông báo:</label>
                  <input
                    type="text"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="Nhập tiêu đề thu hút..."
                    style={{
                      width: '100%',
                      padding: '10px 14px',
                      borderRadius: 10,
                      border: '1px solid #cbd5e1',
                      fontSize: 13,
                      fontWeight: 700
                    }}
                  />
                </div>

                <div>
                  <label style={{ fontSize: 12, fontWeight: 700, color: '#475569', marginBottom: 4, display: 'block' }}>Nội dung chi tiết:</label>
                  <textarea
                    rows={3}
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    placeholder="Mô tả chi tiết lời nhắc hoặc thông báo..."
                    style={{
                      width: '100%',
                      padding: '10px 14px',
                      borderRadius: 10,
                      border: '1px solid #cbd5e1',
                      fontSize: 13,
                      fontFamily: 'inherit'
                    }}
                  />
                </div>

                {/* Action URL */}
                <div>
                  <label style={{ fontSize: 12, fontWeight: 700, color: '#475569', marginBottom: 4, display: 'block' }}>Đường dẫn điều hướng khi bấm vào (Action URL):</label>
                  <select
                    value={actionUrl}
                    onChange={(e) => setActionUrl(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '10px 12px',
                      borderRadius: 10,
                      border: '1px solid #cbd5e1',
                      fontSize: 13,
                      background: '#ffffff'
                    }}
                  >
                    <option value="/nutrition">🥗 Trang Nhật Ký Dinh Dưỡng (/nutrition)</option>
                    <option value="/workout">🏋️ Trang Giáo Án Tập Luyện (/workout)</option>
                    <option value="/progress">📊 Trang Bảng Điểm & Tiến Độ (/progress)</option>
                    <option value="/courses">🎓 Trang Học Viện Academy (/courses)</option>
                    <option value="/schedule">📅 Trang Lịch Hẹn HLV PT (/schedule)</option>
                    <option value="/profile">👤 Trang Hồ Sơ Cá Nhân (/profile)</option>
                  </select>
                </div>

                {/* Send Native Push Toggle */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: '#f8fafc', padding: 12, borderRadius: 12, border: '1px solid #e2e8f0', marginTop: 4 }}>
                  <input
                    type="checkbox"
                    id="browserPushToggle"
                    checked={sendBrowserPush}
                    onChange={(e) => setSendBrowserPush(e.target.checked)}
                    style={{ width: 18, height: 18, accentColor: '#ff1a8c', cursor: 'pointer' }}
                  />
                  <label htmlFor="browserPushToggle" style={{ fontSize: 13, fontWeight: 700, color: '#0f172a', cursor: 'pointer' }}>
                    Phát Web Push Native Banner trực tiếp lên màn hình máy tính/điện thoại người dùng
                  </label>
                </div>

                {/* Dispatch Button */}
                <button
                  type="button"
                  disabled={dispatching || !title.trim() || !message.trim()}
                  onClick={handleDispatch}
                  style={{
                    height: 46,
                    borderRadius: 12,
                    border: 'none',
                    background: 'linear-gradient(135deg, #ff1a8c 0%, #ff7b54 100%)',
                    color: '#ffffff',
                    fontSize: 14,
                    fontWeight: 800,
                    cursor: dispatching ? 'wait' : 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 8,
                    marginTop: 8,
                    boxShadow: '0 4px 15px rgba(255, 26, 140, 0.35)',
                    opacity: dispatching || !title.trim() || !message.trim() ? 0.6 : 1
                  }}
                >
                  <Send size={18} />
                  <span>{dispatching ? 'Đang phát sóng thông báo...' : 'Phát sóng Thông báo Push Ngay'}</span>
                </button>

                {/* Success feedback */}
                {dispatchSuccess && (
                  <div style={{ background: '#ecfdf5', border: '1px solid #a7f3d0', padding: 12, borderRadius: 12, color: '#065f46', fontSize: 13, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
                    <CheckCircle2 size={18} style={{ color: '#10b981' }} />
                    <span>Thành công! Đã phát sóng thông báo tới {dispatchSuccess.count} học viên mục tiêu.</span>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Side Mockup Preview Column */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            {/* Real-time Phone / Push Preview Card */}
            <div style={{ background: '#ffffff', borderRadius: 20, padding: 20, border: '1px solid #f1f5f9', boxShadow: '0 2px 12px rgba(0,0,0,0.03)' }}>
              <h3 style={{ fontSize: 14, fontWeight: 800, color: '#0f172a', margin: '0 0 14px 0', display: 'flex', alignItems: 'center', gap: 6 }}>
                <Smartphone size={16} style={{ color: '#ff1a8c' }} />
                Mô phỏng hiển thị Banner (Live Preview)
              </h3>

              {/* Mockup Container */}
              <div style={{ background: '#1e293b', padding: 16, borderRadius: 24, boxShadow: '0 10px 25px rgba(0,0,0,0.15)' }}>
                {/* Simulated Notification Banner */}
                <div style={{
                  background: 'rgba(255, 255, 255, 0.95)',
                  backdropFilter: 'blur(10px)',
                  borderRadius: 16,
                  padding: 14,
                  boxShadow: '0 10px 20px rgba(0, 0, 0, 0.2)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                  animation: 'scale-up 0.3s ease-out'
                }}>
                  {/* Top Bar */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <div style={{ width: 18, height: 18, borderRadius: 5, background: 'linear-gradient(135deg, #ff1a8c 0%, #ff7b54 100%)', display: 'grid', placeItems: 'center', color: '#fff', fontSize: 10, fontWeight: 900 }}>
                        A
                      </div>
                      <span style={{ fontSize: 11, fontWeight: 800, color: '#0f172a' }}>AURA FITNESS</span>
                    </div>
                    <span style={{ fontSize: 10, color: '#64748b', fontWeight: 600 }}>Vừa xong</span>
                  </div>

                  {/* Body */}
                  <div>
                    <h4 style={{ fontSize: 13, fontWeight: 800, color: '#0f172a', margin: '0 0 2px 0' }}>
                      {title || 'Tiêu đề thông báo mẫu'}
                    </h4>
                    <p style={{ fontSize: 11, color: '#475569', margin: 0, lineHeight: 1.4, display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                      {message || 'Nội dung thông báo đẩy sẽ xuất hiện trực tiếp tại thanh thông báo thiết bị học viên.'}
                    </p>
                  </div>

                  {/* Action Link indicator */}
                  <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: 6, display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 10, color: '#ff1a8c', fontWeight: 800 }}>
                    <span>Điều hướng: {actionUrl}</span>
                    <ExternalLink size={12} />
                  </div>
                </div>
              </div>

              <div style={{ marginTop: 14, background: '#fff0f5', padding: 12, borderRadius: 12, fontSize: 12, color: '#ff1a8c', fontWeight: 600, display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                <Sparkles size={16} style={{ flexShrink: 0, marginTop: 2 }} />
                <span>Người dùng chỉ cần cho phép cấp quyền Notification 1 lần duy nhất để nhận thông điệp ngay cả khi đang đóng trình duyệt!</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: SYSTEM PUSH SETTINGS */}
      {activeTab === 'settings' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20, maxWidth: 800 }}>
          {/* Master Switch Card */}
          <div style={{ background: '#ffffff', borderRadius: 20, padding: 20, border: '1px solid #f1f5f9', boxShadow: '0 2px 12px rgba(0,0,0,0.03)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <h3 style={{ fontSize: 16, fontWeight: 800, color: '#0f172a', margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Zap size={20} style={{ color: '#ff1a8c' }} />
                  Bật/Tắt Kênh Push Notification Hệ Thống
                </h3>
                <span style={{ fontSize: 13, color: '#64748b', fontWeight: 500, marginTop: 4, display: 'block' }}>
                  Quản lý trạng thái cho phép gửi thông báo đẩy tới toàn bộ thiết bị người dùng
                </span>
              </div>

              <label style={{ position: 'relative', display: 'inline-block', width: 50, height: 26, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={settings.enabled}
                  onChange={(e) => setSettings({ ...settings, enabled: e.target.checked })}
                  style={{ opacity: 0, width: 0, height: 0 }}
                />
                <span style={{
                  position: 'absolute',
                  inset: 0,
                  backgroundColor: settings.enabled ? '#ff1a8c' : '#cbd5e1',
                  borderRadius: 26,
                  transition: '0.2s',
                  boxShadow: settings.enabled ? '0 2px 8px rgba(255,26,140,0.4)' : 'none'
                }}>
                  <span style={{
                    position: 'absolute',
                    content: '""',
                    height: 20,
                    width: 20,
                    left: settings.enabled ? 26 : 3,
                    bottom: 3,
                    backgroundColor: 'white',
                    borderRadius: '50%',
                    transition: '0.2s'
                  }} />
                </span>
              </label>
            </div>
          </div>

          {/* FCM & VAPID Credentials Status */}
          <div style={{ background: '#ffffff', borderRadius: 20, padding: 20, border: '1px solid #f1f5f9', boxShadow: '0 2px 12px rgba(0,0,0,0.03)' }}>
            <h3 style={{ fontSize: 15, fontWeight: 800, color: '#0f172a', margin: '0 0 14px 0', display: 'flex', alignItems: 'center', gap: 8 }}>
              <ShieldCheck size={18} style={{ color: '#ff1a8c' }} />
              Cấu hình Firebase Cloud Messaging (FCM & Web Push)
            </h3>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14 }}>
              <div>
                <label style={{ fontSize: 12, fontWeight: 700, color: '#475569', marginBottom: 4, display: 'block' }}>FCM Project ID:</label>
                <input
                  type="text"
                  value={settings.fcmProjectId}
                  onChange={(e) => setSettings({ ...settings, fcmProjectId: e.target.value })}
                  style={{ width: '100%', padding: '8px 12px', borderRadius: 10, border: '1px solid #cbd5e1', fontSize: 12 }}
                />
              </div>

              <div>
                <label style={{ fontSize: 12, fontWeight: 700, color: '#475569', marginBottom: 4, display: 'block' }}>FCM Sender ID:</label>
                <input
                  type="text"
                  value={settings.fcmSenderId}
                  onChange={(e) => setSettings({ ...settings, fcmSenderId: e.target.value })}
                  style={{ width: '100%', padding: '8px 12px', borderRadius: 10, border: '1px solid #cbd5e1', fontSize: 12 }}
                />
              </div>

              <div>
                <label style={{ fontSize: 12, fontWeight: 700, color: '#475569', marginBottom: 4, display: 'block' }}>VAPID Key (Public):</label>
                <input
                  type="text"
                  value={settings.vapidPublicKey}
                  onChange={(e) => setSettings({ ...settings, vapidPublicKey: e.target.value })}
                  style={{ width: '100%', padding: '8px 12px', borderRadius: 10, border: '1px solid #cbd5e1', fontSize: 12 }}
                />
              </div>
            </div>

            <div style={{ marginTop: 14, display: 'flex', gap: 16 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 700, color: '#0f172a', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={settings.soundEnabled}
                  onChange={(e) => setSettings({ ...settings, soundEnabled: e.target.checked })}
                  style={{ accentColor: '#ff1a8c' }}
                />
                <Volume2 size={16} /> Phát âm thanh báo khi có Push
              </label>

              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 700, color: '#0f172a', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={settings.badgeEnabled}
                  onChange={(e) => setSettings({ ...settings, badgeEnabled: e.target.checked })}
                  style={{ accentColor: '#ff1a8c' }}
                />
                Hiển thị Badge số đếm chưa đọc trên biểu tượng
              </label>
            </div>
          </div>

          {/* Automated Schedule Reminders Card */}
          <div style={{ background: '#ffffff', borderRadius: 20, padding: 20, border: '1px solid #f1f5f9', boxShadow: '0 2px 12px rgba(0,0,0,0.03)' }}>
            <h3 style={{ fontSize: 15, fontWeight: 800, color: '#0f172a', margin: '0 0 14px 0', display: 'flex', alignItems: 'center', gap: 8 }}>
              <Clock size={18} style={{ color: '#ff1a8c' }} />
              Cấu hình Khung giờ Nhắc nhở Tự động (Automation Schedules)
            </h3>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {/* Meal Reminders */}
              <div style={{ background: '#f8fafc', padding: 14, borderRadius: 14, border: '1px solid #e2e8f0' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                  <span style={{ fontSize: 13, fontWeight: 800, color: '#0f172a', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Utensils size={16} style={{ color: '#ff1a8c' }} />
                    Tự động nhắc nộp nhật ký bữa ăn trong ngày
                  </span>
                  <input
                    type="checkbox"
                    checked={settings.autoMealReminders}
                    onChange={(e) => setSettings({ ...settings, autoMealReminders: e.target.checked })}
                    style={{ accentColor: '#ff1a8c', width: 18, height: 18 }}
                  />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
                  <div>
                    <label style={{ fontSize: 11, fontWeight: 700, color: '#64748b' }}>🌅 Bữa sáng:</label>
                    <input
                      type="time"
                      value={settings.mealReminderTimes.breakfast}
                      onChange={(e) => setSettings({
                        ...settings,
                        mealReminderTimes: { ...settings.mealReminderTimes, breakfast: e.target.value }
                      })}
                      style={{ width: '100%', padding: 6, borderRadius: 8, border: '1px solid #cbd5e1', fontSize: 12, marginTop: 2 }}
                    />
                  </div>

                  <div>
                    <label style={{ fontSize: 11, fontWeight: 700, color: '#64748b' }}>🥗 Bữa trưa:</label>
                    <input
                      type="time"
                      value={settings.mealReminderTimes.lunch}
                      onChange={(e) => setSettings({
                        ...settings,
                        mealReminderTimes: { ...settings.mealReminderTimes, lunch: e.target.value }
                      })}
                      style={{ width: '100%', padding: 6, borderRadius: 8, border: '1px solid #cbd5e1', fontSize: 12, marginTop: 2 }}
                    />
                  </div>

                  <div>
                    <label style={{ fontSize: 11, fontWeight: 700, color: '#64748b' }}>🍲 Bữa tối:</label>
                    <input
                      type="time"
                      value={settings.mealReminderTimes.dinner}
                      onChange={(e) => setSettings({
                        ...settings,
                        mealReminderTimes: { ...settings.mealReminderTimes, dinner: e.target.value }
                      })}
                      style={{ width: '100%', padding: 6, borderRadius: 8, border: '1px solid #cbd5e1', fontSize: 12, marginTop: 2 }}
                    />
                  </div>
                </div>
              </div>

              {/* Workout & Progress Review */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
                <div style={{ background: '#f8fafc', padding: 14, borderRadius: 14, border: '1px solid #e2e8f0' }}>
                  <label style={{ fontSize: 12, fontWeight: 800, color: '#0f172a', display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                    <Dumbbell size={16} style={{ color: '#ff7b54' }} />
                    Giờ nhắc tập gym chiều:
                  </label>
                  <input
                    type="time"
                    value={settings.workoutReminderTime}
                    onChange={(e) => setSettings({ ...settings, workoutReminderTime: e.target.value })}
                    style={{ width: '100%', padding: 8, borderRadius: 8, border: '1px solid #cbd5e1', fontSize: 13 }}
                  />
                </div>

                <div style={{ background: '#f8fafc', padding: 14, borderRadius: 14, border: '1px solid #e2e8f0' }}>
                  <label style={{ fontSize: 12, fontWeight: 800, color: '#0f172a', display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                    <GraduationCap size={16} style={{ color: '#ff1a8c' }} />
                    Ngày nhắc đánh giá tiến độ tuần:
                  </label>
                  <select
                    value={settings.weeklyProgressReviewDay}
                    onChange={(e) => setSettings({ ...settings, weeklyProgressReviewDay: e.target.value })}
                    style={{ width: '100%', padding: 8, borderRadius: 8, border: '1px solid #cbd5e1', fontSize: 13, background: '#ffffff' }}
                  >
                    <option value="monday">Thứ 2 hàng tuần</option>
                    <option value="friday">Thứ 6 hàng tuần</option>
                    <option value="sunday">Chủ Nhật hàng tuần</option>
                  </select>
                </div>
              </div>
            </div>
          </div>

          {/* Save Settings Button */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button
              type="button"
              disabled={savingSettings}
              onClick={handleSaveSettings}
              style={{
                height: 44,
                padding: '0 24px',
                borderRadius: 12,
                border: 'none',
                background: 'linear-gradient(135deg, #ff1a8c 0%, #ff7b54 100%)',
                color: '#ffffff',
                fontSize: 14,
                fontWeight: 800,
                cursor: 'pointer',
                boxShadow: '0 4px 15px rgba(255, 26, 140, 0.3)'
              }}
            >
              {savingSettings ? 'Đang lưu cài đặt...' : 'Lưu Cấu Hình Cài Đặt Push'}
            </button>

            {settingsSaved && (
              <span style={{ fontSize: 13, color: '#10b981', fontWeight: 800, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <CheckCircle2 size={16} /> Đã lưu cấu hình thành công!
              </span>
            )}
          </div>
        </div>
      )}

      {/* TAB 3: WEB PUSH TESTER */}
      {activeTab === 'tester' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20, maxWidth: 700 }}>
          <div style={{ background: '#ffffff', borderRadius: 20, padding: 20, border: '1px solid #f1f5f9', boxShadow: '0 2px 12px rgba(0,0,0,0.03)' }}>
            <h3 style={{ fontSize: 16, fontWeight: 800, color: '#0f172a', margin: '0 0 12px 0', display: 'flex', alignItems: 'center', gap: 8 }}>
              <Smartphone size={20} style={{ color: '#ff1a8c' }} />
              Công cụ Thử nghiệm Push Notification Trình duyệt
            </h3>
            <p style={{ fontSize: 13, color: '#64748b', margin: '0 0 16px 0', lineHeight: 1.5 }}>
              Kiểm tra cấp quyền trình duyệt, tạo Web Push Native Banner trực tiếp trên thiết bị của bạn để kiểm chứng âm thanh và phản hồi thao tác bấm.
            </p>

            {/* Permission Status */}
            <div style={{ background: '#f8fafc', padding: 16, borderRadius: 14, border: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <div>
                <span style={{ fontSize: 11, fontWeight: 800, color: '#64748b', display: 'block' }}>TRẠNG THÁI CẤP QUYỀN TRÌNH DUYỆT:</span>
                <strong style={{
                  fontSize: 15,
                  fontWeight: 900,
                  color: permissionState === 'granted' ? '#10b981' : permissionState === 'denied' ? '#ef4444' : '#f59e0b',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  marginTop: 2
                }}>
                  {permissionState === 'granted' && <CheckCircle2 size={18} />}
                  {permissionState === 'denied' && <AlertCircle size={18} />}
                  {permissionState === 'granted' ? 'ĐÃ CẤP QUYỀN (Granted)' : permissionState === 'denied' ? 'BỊ TỪ CHỐI (Denied)' : 'CHƯA CẤP QUYỀN (Default)'}
                </strong>
              </div>

              {permissionState !== 'granted' && (
                <button
                  type="button"
                  onClick={handleRequestPermission}
                  style={{
                    padding: '8px 16px',
                    borderRadius: 10,
                    border: 'none',
                    background: '#ff1a8c',
                    color: '#ffffff',
                    fontSize: 12,
                    fontWeight: 800,
                    cursor: 'pointer'
                  }}
                >
                  Xin Quyền Ngay
                </button>
              )}
            </div>

            {/* Test Trigger Button */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <button
                type="button"
                onClick={() => {
                  sendBrowserNativePushNotification(
                    '🔥 Thử nghiệm Push Notification thành công!',
                    'Thông báo đẩy của Aura Fitness đang hoạt động mượt mà trên thiết bị của bạn.',
                    '/nutrition'
                  )
                }}
                style={{
                  height: 44,
                  borderRadius: 12,
                  border: 'none',
                  background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                  color: '#ffffff',
                  fontSize: 14,
                  fontWeight: 800,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                  boxShadow: '0 4px 12px rgba(16, 185, 129, 0.25)'
                }}
              >
                <Bell size={18} />
                <span>Bấm Thử Nhận Push Banner Ngay Trực Tiếp</span>
              </button>

              {/* FCM Token Display */}
              {currentFcmToken && (
                <div style={{ background: '#f1f5f9', padding: 12, borderRadius: 12, marginTop: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span style={{ fontSize: 11, fontWeight: 800, color: '#475569' }}>FCM WEB PUSH TOKEN CỦA BẠN:</span>
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard.writeText(currentFcmToken)
                        setCopiedToken(true)
                        setTimeout(() => setCopiedToken(false), 2000)
                      }}
                      style={{ border: 'none', background: 'transparent', color: '#ff1a8c', cursor: 'pointer', fontSize: 11, fontWeight: 800, display: 'flex', alignItems: 'center', gap: 4 }}
                    >
                      {copiedToken ? <Check size={12} /> : <Copy size={12} />}
                      {copiedToken ? 'Đã chép' : 'Sao chép Token'}
                    </button>
                  </div>
                  <code style={{ fontSize: 11, color: '#0f172a', wordBreak: 'break-all', display: 'block', background: '#ffffff', padding: 8, borderRadius: 8, border: '1px solid #cbd5e1' }}>
                    {currentFcmToken}
                  </code>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* TAB 4: BROADCAST HISTORY & LOGS */}
      {activeTab === 'logs' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Header & Filter Bar */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
            <h3 style={{ fontSize: 16, fontWeight: 800, color: '#0f172a', margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
              <History size={18} style={{ color: '#ff1a8c' }} />
              Lịch sử các đợt phát sóng thông báo ({logs.length})
            </h3>

            <div style={{ display: 'flex', gap: 6, overflowX: 'auto' }}>
              {[
                { id: 'all', label: 'Tất cả' },
                { id: 'REMINDER', label: 'Nhắc nhở' },
                { id: 'ANNOUNCEMENT', label: 'Thông báo' },
                { id: 'WORKOUT', label: 'Tập luyện' },
                { id: 'MOTIVATION', label: 'Động viên' }
              ].map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setLogFilter(f.id)}
                  style={{
                    padding: '6px 12px',
                    borderRadius: 8,
                    border: 'none',
                    background: logFilter === f.id ? '#fff0f5' : '#f1f5f9',
                    color: logFilter === f.id ? '#ff1a8c' : '#64748b',
                    fontSize: 12,
                    fontWeight: 800,
                    cursor: 'pointer'
                  }}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          {/* Logs List */}
          {filteredLogs.length === 0 ? (
            <div style={{ background: '#ffffff', borderRadius: 16, padding: 40, textAlign: 'center', border: '1px solid #f1f5f9' }}>
              <Bell size={32} style={{ color: '#cbd5e1', margin: '0 auto 10px' }} />
              <p style={{ fontSize: 14, color: '#64748b', fontWeight: 600 }}>Chưa có nhật ký phát sóng nào trong phân loại này.</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {filteredLogs.map((log) => (
                <div
                  key={log.id}
                  style={{
                    background: '#ffffff',
                    borderRadius: 16,
                    padding: 16,
                    border: '1px solid #f1f5f9',
                    boxShadow: '0 2px 8px rgba(0,0,0,0.02)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 10
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                        <span style={{
                          fontSize: 10,
                          fontWeight: 800,
                          padding: '2px 8px',
                          borderRadius: 6,
                          background: log.type === 'REMINDER' ? '#fff0f5' : log.type === 'WORKOUT' ? '#fff7ed' : '#f0fdf4',
                          color: log.type === 'REMINDER' ? '#ff1a8c' : log.type === 'WORKOUT' ? '#c2410c' : '#15803d'
                        }}>
                          {log.type}
                        </span>
                        <span style={{ fontSize: 12, color: '#94a3b8', fontWeight: 600 }}>
                          {new Date(log.createdAt).toLocaleString('vi-VN')}
                        </span>
                      </div>
                      <h4 style={{ fontSize: 14, fontWeight: 800, color: '#0f172a', margin: 0 }}>{log.title}</h4>
                      <p style={{ fontSize: 13, color: '#475569', margin: '4px 0 0 0', lineHeight: 1.4 }}>{log.message}</p>
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        setTitle(log.title)
                        setMessage(log.message)
                        setNotifType(log.type)
                        if (log.actionUrl) setActionUrl(log.actionUrl)
                        setActiveTab('dispatch')
                      }}
                      style={{
                        padding: '6px 12px',
                        borderRadius: 8,
                        border: '1px solid #fbcfe8',
                        background: '#fff0f5',
                        color: '#ff1a8c',
                        fontSize: 11,
                        fontWeight: 800,
                        cursor: 'pointer',
                        whiteSpace: 'nowrap'
                      }}
                    >
                      Dùng mẫu này
                    </button>
                  </div>

                  <div style={{ borderTop: '1px solid #f8fafc', paddingTop: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 11, color: '#64748b', fontWeight: 600 }}>
                    <span>Số lượng gửi: <strong style={{ color: '#0f172a' }}>{log.sentCount} người</strong> ({log.targetType === 'all' ? 'Tất cả' : log.targetType})</span>
                    <span>Phát bởi: <strong>{log.sentBy}</strong></span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
