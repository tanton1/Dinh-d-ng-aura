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
  Plus,
  Trash2,
  Edit3,
  Target,
  X,
  Tag,
  ToggleLeft,
  ToggleRight,
  Filter,
  Layers
} from 'lucide-react'
import { PageHeader } from '../../components/ui'
import type { 
  AdminUserRecord, 
  SystemPushSettings, 
  PushBroadcastLog, 
  AppNotification,
  PushTemplate,
  FitnessGoalTarget,
  NotificationCategory
} from '../../types'
import { 
  getSystemPushSettings, 
  saveSystemPushSettings, 
  dispatchAdminPushBroadcast, 
  getPushBroadcastLogs, 
  sendBrowserNativePushNotification, 
  getPushTemplates,
  savePushTemplate,
  deletePushTemplate,
  togglePushTemplateActive,
  DEFAULT_PUSH_SETTINGS 
} from '../../services/notificationService'
import { requestFcmPermissionAndToken } from '../../services/fcmService'

interface AdminNotificationsPageProps {
  onNavigate?: (view: any) => void
  users?: AdminUserRecord[]
  currentUserUid?: string
}

export default function AdminNotificationsPage({ onNavigate, users = [], currentUserUid }: AdminNotificationsPageProps) {
  const [activeTab, setActiveTab] = useState<'dispatch' | 'goal_templates' | 'settings' | 'tester' | 'logs'>('dispatch')

  // Dispatch Form State
  const [targetType, setTargetType] = useState<
    'all' | 'goal_lose_fat' | 'goal_gain_muscle' | 'goal_maintain' | 'coaching' | 'academy' | 'missing_meals' | 'individual' | 'pref_workout' | 'pref_nutrition' | 'pref_learning' | 'pref_coach'
  >('all')
  const [selectedUserId, setSelectedUserId] = useState<string>('')
  const [notifType, setNotifType] = useState<AppNotification['type']>('REMINDER')
  const [title, setTitle] = useState('Nhắc nhở cập nhật nhật ký ăn uống 🥗')
  const [message, setMessage] = useState('Hôm nay bạn chưa tải lên hình ảnh bữa ăn nào. Hãy cập nhật ngay để theo dõi tiến trình dinh dưỡng cùng HLV nhé!')
  const [actionUrl, setActionUrl] = useState('/nutrition')
  const [sendBrowserPush, setSendBrowserPush] = useState(true)
  const [respectUserPreferences, setRespectUserPreferences] = useState(true)

  const [dispatching, setDispatching] = useState(false)
  const [dispatchSuccess, setDispatchSuccess] = useState<{ count: number; filteredOutCount?: number } | null>(null)

  // Settings State
  const [settings, setSettings] = useState<SystemPushSettings>(DEFAULT_PUSH_SETTINGS)
  const [savingSettings, setSavingSettings] = useState(false)
  const [settingsSaved, setSettingsSaved] = useState(false)

  // Goal Push Templates State
  const [pushTemplates, setPushTemplates] = useState<PushTemplate[]>([])
  const [loadingTemplates, setLoadingTemplates] = useState(false)
  const [templateGoalFilter, setTemplateGoalFilter] = useState<FitnessGoalTarget | 'all'>('all')
  const [templateCategoryFilter, setTemplateCategoryFilter] = useState<NotificationCategory | 'all'>('all')

  // Modal State for Adding / Editing Templates
  const [showModal, setShowModal] = useState(false)
  const [editingTemplate, setEditingTemplate] = useState<PushTemplate | null>(null)
  const [formTitle, setFormTitle] = useState('')
  const [formMessage, setFormMessage] = useState('')
  const [formType, setFormType] = useState<PushTemplate['type']>('REMINDER')
  const [formCategory, setFormCategory] = useState<NotificationCategory>('nutrition')
  const [formTargetGoal, setFormTargetGoal] = useState<FitnessGoalTarget>('lose-fat')
  const [formScheduledTime, setFormScheduledTime] = useState('12:00')
  const [formTriggerLabel, setFormTriggerLabel] = useState('')
  const [formActionUrl, setFormActionUrl] = useState('/nutrition')
  const [formActive, setFormActive] = useState(true)
  const [savingTemplate, setSavingTemplate] = useState(false)

  // Delete Confirmation State
  const [deletingId, setDeletingId] = useState<string | null>(null)

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

  // Load Settings, Push Templates, and Logs on mount
  useEffect(() => {
    async function initData() {
      const s = await getSystemPushSettings()
      setSettings(s)

      setLoadingTemplates(true)
      const tmpls = await getPushTemplates()
      setPushTemplates(tmpls)
      setLoadingTemplates(false)

      setLoadingLogs(true)
      const l = await getPushBroadcastLogs()
      setLogs(l)
      setLoadingLogs(false)
    }
    initData()
  }, [])

  // Filter target users count estimation based on goal, role, or user preferences
  const targetUsersList = useMemo(() => {
    if (!users || users.length === 0) return []

    if (targetType === 'individual') {
      return users.filter(u => u.uid === selectedUserId)
    }
    if (targetType === 'goal_lose_fat') {
      return users.filter(u => (u as any).goals?.includes('lose-fat') || (u as any).nutritionProfile?.goal === 'lose-fat')
    }
    if (targetType === 'goal_gain_muscle') {
      return users.filter(u => (u as any).goals?.includes('gain-muscle') || (u as any).nutritionProfile?.goal === 'gain-muscle')
    }
    if (targetType === 'goal_maintain') {
      return users.filter(u => (u as any).goals?.includes('maintain') || (u as any).nutritionProfile?.goal === 'maintain')
    }
    if (targetType === 'coaching') {
      return users.filter(u => u.role === 'coach' || u.role === 'admin')
    }
    if (targetType === 'academy') {
      return users.filter(u => u.role === 'student')
    }
    if (targetType === 'pref_workout') {
      return users.filter(u => (u as any).notificationSettings?.workoutReminders !== false)
    }
    if (targetType === 'pref_nutrition') {
      return users.filter(u => (u as any).notificationSettings?.mealReminders !== false)
    }
    if (targetType === 'pref_learning') {
      return users.filter(u => (u as any).notificationSettings?.learningUpdates !== false)
    }
    if (targetType === 'pref_coach') {
      return users.filter(u => (u as any).notificationSettings?.coachMessages !== false)
    }
    return users // 'all' or 'missing_meals'
  }, [users, targetType, selectedUserId])

  // Filter Push Templates by Target Goal & Student Preference Category
  const filteredTemplates = useMemo(() => {
    return pushTemplates.filter(t => {
      const matchGoal = templateGoalFilter === 'all' || t.targetGoal === templateGoalFilter
      const matchCategory = templateCategoryFilter === 'all' || t.category === templateCategoryFilter
      return matchGoal && matchCategory
    })
  }, [pushTemplates, templateGoalFilter, templateCategoryFilter])

  // Apply a template directly to Dispatch Form
  const applyTemplateToDispatch = (tmpl: PushTemplate) => {
    setTitle(tmpl.title)
    setMessage(tmpl.message)
    setNotifType(tmpl.type)
    if (tmpl.category) setFormCategory(tmpl.category)
    setActionUrl(tmpl.actionUrl || '/nutrition')

    // Automatically pick audience based on goal or category
    if (tmpl.targetGoal === 'lose-fat') setTargetType('goal_lose_fat')
    else if (tmpl.targetGoal === 'gain-muscle') setTargetType('goal_gain_muscle')
    else if (tmpl.targetGoal === 'maintain') setTargetType('goal_maintain')
    else if (tmpl.category === 'workout') setTargetType('pref_workout')
    else if (tmpl.category === 'nutrition') setTargetType('pref_nutrition')
    else if (tmpl.category === 'learning') setTargetType('pref_learning')
    else if (tmpl.category === 'coach') setTargetType('pref_coach')
    else setTargetType('all')

    setActiveTab('dispatch')
  }

  // Open Modal for New Template
  const handleOpenAddModal = () => {
    setEditingTemplate(null)
    setFormTitle('')
    setFormMessage('')
    setFormType('REMINDER')
    setFormCategory('nutrition')
    setFormTargetGoal('lose-fat')
    setFormScheduledTime('12:00')
    setFormTriggerLabel('Bữa trưa Calo Deficit')
    setFormActionUrl('/nutrition')
    setFormActive(true)
    setShowModal(true)
  }

  // Open Modal for Editing Template
  const handleOpenEditModal = (tmpl: PushTemplate) => {
    setEditingTemplate(tmpl)
    setFormTitle(tmpl.title)
    setFormMessage(tmpl.message)
    setFormType(tmpl.type)
    setFormCategory(tmpl.category || 'general')
    setFormTargetGoal(tmpl.targetGoal)
    setFormScheduledTime(tmpl.scheduledTime || '12:00')
    setFormTriggerLabel(tmpl.triggerLabel || '')
    setFormActionUrl(tmpl.actionUrl || '/nutrition')
    setFormActive(tmpl.active)
    setShowModal(true)
  }

  // Submit Template Save (Create or Edit)
  const handleSaveTemplateSubmit = async () => {
    if (!formTitle.trim() || !formMessage.trim()) return

    setSavingTemplate(true)
    const newOrUpdated: PushTemplate = {
      id: editingTemplate ? editingTemplate.id : `tmpl_${Date.now().toString(36)}`,
      title: formTitle.trim(),
      message: formMessage.trim(),
      type: formType,
      category: formCategory,
      targetGoal: formTargetGoal,
      scheduledTime: formScheduledTime,
      triggerLabel: formTriggerLabel.trim() || undefined,
      actionUrl: formActionUrl,
      active: formActive,
      createdAt: editingTemplate ? editingTemplate.createdAt : new Date().toISOString()
    }

    try {
      await savePushTemplate(newOrUpdated)
      const refreshed = await getPushTemplates()
      setPushTemplates(refreshed)
      setShowModal(false)
    } catch (err) {
      console.error('Error saving template:', err)
    } finally {
      setSavingTemplate(false)
    }
  }

  // Delete Template Handler
  const handleDeleteTemplateConfirm = async (id: string) => {
    try {
      await deletePushTemplate(id)
      const refreshed = await getPushTemplates()
      setPushTemplates(refreshed)
      setDeletingId(null)
    } catch (err) {
      console.error('Error deleting template:', err)
    }
  }

  // Toggle Template Active Handler
  const handleToggleActiveHandler = async (id: string, currentActive: boolean) => {
    try {
      await togglePushTemplateActive(id, !currentActive)
      const refreshed = await getPushTemplates()
      setPushTemplates(refreshed)
    } catch (err) {
      console.error('Error toggling template active status:', err)
    }
  }

  // Handle Dispatch Broadcast
  const handleDispatch = async () => {
    if (!title.trim() || !message.trim()) return

    setDispatching(true)
    setDispatchSuccess(null)

    const targetUserIds = targetUsersList.map(u => u.uid)
    const effectiveIds = targetUserIds.length > 0 ? targetUserIds : ['demo_user_1', 'demo_user_2']

    try {
      const res = await dispatchAdminPushBroadcast({
        title: title.trim(),
        message: message.trim(),
        type: notifType,
        targetType: targetType === 'individual' ? 'individual' : targetType === 'all' ? 'all' : 'category',
        targetUserIds: effectiveIds,
        actionUrl,
        sendBrowserPush,
        respectCategoryPreferences: respectUserPreferences
      })

      setDispatchSuccess({ count: res.sentCount, filteredOutCount: res.filteredOutCount })
      
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
        const token = currentUserUid ? await requestFcmPermissionAndToken(currentUserUid) : null
        setCurrentFcmToken(token || '')
        setRequestingToken(false)
      }
    }
  }

  // Filter logs
  const filteredLogs = useMemo(() => {
    if (logFilter === 'all') return logs
    return logs.filter(l => l.type === logFilter)
  }, [logs, logFilter])

  // Helper for Goal Badge UI
  const renderGoalBadge = (goal: FitnessGoalTarget) => {
    switch (goal) {
      case 'lose-fat':
        return (
          <span style={{ fontSize: 11, fontWeight: 800, padding: '3px 10px', borderRadius: 20, background: '#fff0f5', color: '#ff1a8c', border: '1px solid #fbcfe8', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <Flame size={12} /> Giảm Mỡ (Lose Fat)
          </span>
        )
      case 'gain-muscle':
        return (
          <span style={{ fontSize: 11, fontWeight: 800, padding: '3px 10px', borderRadius: 20, background: '#fff7ed', color: '#c2410c', border: '1px solid #fed7aa', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <Dumbbell size={12} /> Tăng Cơ (Gain Muscle)
          </span>
        )
      case 'maintain':
        return (
          <span style={{ fontSize: 11, fontWeight: 800, padding: '3px 10px', borderRadius: 20, background: '#ecfdf5', color: '#047857', border: '1px solid #a7f3d0', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <Utensils size={12} /> Duy Trì Vóc Dáng
          </span>
        )
      case 'health':
        return (
          <span style={{ fontSize: 11, fontWeight: 800, padding: '3px 10px', borderRadius: 20, background: '#f0f9ff', color: '#0369a1', border: '1px solid #bae6fd', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <Sparkles size={12} /> Sức Khỏe & Giãn Cơ
          </span>
        )
      default:
        return (
          <span style={{ fontSize: 11, fontWeight: 800, padding: '3px 10px', borderRadius: 20, background: '#f1f5f9', color: '#475569', border: '1px solid #cbd5e1', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <Target size={12} /> Tất Cả Mục Tiêu
          </span>
        )
    }
  }

  // Helper for Student Notification Preference Category Badge UI
  const renderCategoryBadge = (category?: NotificationCategory) => {
    switch (category) {
      case 'workout':
        return (
          <span style={{ fontSize: 11, fontWeight: 800, padding: '3px 10px', borderRadius: 20, background: '#fff1f2', color: '#e11d48', border: '1px solid #fecdd3', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            🏋️ Tập luyện & Lịch trình
          </span>
        )
      case 'nutrition':
        return (
          <span style={{ fontSize: 11, fontWeight: 800, padding: '3px 10px', borderRadius: 20, background: '#fff7ed', color: '#ea580c', border: '1px solid #ffedd5', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            🥗 Dinh dưỡng & Nước uống
          </span>
        )
      case 'learning':
        return (
          <span style={{ fontSize: 11, fontWeight: 800, padding: '3px 10px', borderRadius: 20, background: '#fdf2f8', color: '#db2777', border: '1px solid #fbcfe8', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            🎓 Bài giảng & Kiến thức
          </span>
        )
      case 'coach':
        return (
          <span style={{ fontSize: 11, fontWeight: 800, padding: '3px 10px', borderRadius: 20, background: '#faf5ff', color: '#9333ea', border: '1px solid #f3e8ff', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            💬 HLV & Aura AI
          </span>
        )
      default:
        return (
          <span style={{ fontSize: 11, fontWeight: 800, padding: '3px 10px', borderRadius: 20, background: '#f8fafc', color: '#64748b', border: '1px solid #e2e8f0', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            📢 Thông báo chung
          </span>
        )
    }
  }

  return (
    <div className="page admin-notifications-page" style={{ paddingBottom: 60 }}>
      <PageHeader 
        eyebrow="AURA · ADMIN MANAGEMENT" 
        title="Cài đặt & Quản lý Push Notifications" 
        description="Gửi thông báo đẩy, tạo & chỉnh sửa các mẫu Push phân loại theo từng mục tiêu học viên, và quản lý tự động hóa hệ thống."
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
          { id: 'goal_templates', label: 'Mẫu Push Theo Mục Tiêu', icon: Target, badge: pushTemplates.length },
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
              {tab.badge !== undefined && (
                <span style={{
                  fontSize: 11,
                  fontWeight: 800,
                  padding: '2px 7px',
                  borderRadius: 12,
                  background: isActive ? '#ff1a8c' : '#e2e8f0',
                  color: isActive ? '#ffffff' : '#475569'
                }}>
                  {tab.badge}
                </span>
              )}
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
                  { id: 'all', label: 'Tất cả học viên', desc: `Phát sóng tới toàn bộ ${users.length || ''} tài khoản` },
                  { id: 'pref_workout', label: '🏋️ Tập luyện & Lịch trình', desc: 'Lọc học viên bật nhận giờ tập gym' },
                  { id: 'pref_nutrition', label: '🥗 Dinh dưỡng & Nước uống', desc: 'Lọc học viên bật nhận nhắc bữa ăn' },
                  { id: 'pref_learning', label: '🎓 Bài giảng & Kiến thức', desc: 'Lọc học viên bật nhận Streak & bài học' },
                  { id: 'pref_coach', label: '💬 HLV & Aura AI Assistant', desc: 'Lọc học viên bật nhận phản hồi HLV' },
                  { id: 'goal_lose_fat', label: '🔥 Học viên Giảm Mỡ', desc: 'Học viên có mục tiêu thâm hụt Calo' },
                  { id: 'goal_gain_muscle', label: '💪 Học viên Tăng Cơ', desc: 'Học viên nâng tạ & xây dựng cơ bắp' },
                  { id: 'goal_maintain', label: '🥑 Học viên Duy Trì', desc: 'Học viên cân bằng thể trạng' },
                  { id: 'coaching', label: 'Khách PT Coaching', desc: 'Dành cho khách hàng có HLV PT' },
                  { id: 'academy', label: 'Học viên Academy', desc: 'Tài khoản đăng ký khóa học' },
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

              {/* Audience Count Summary Banner */}
              <div style={{ marginTop: 12, background: '#f8fafc', padding: '8px 14px', borderRadius: 10, border: '1px solid #e2e8f0', fontSize: 12, color: '#475569', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}>
                <Users size={14} style={{ color: '#ff1a8c' }} />
                <span>Ước tính số học viên sẽ nhận thông báo: <strong style={{ color: '#ff1a8c' }}>{targetUsersList.length || 'Tất cả'} học viên</strong></span>
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

              {/* Goal Template Quick Selector */}
              <div style={{ marginBottom: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                  <span style={{ fontSize: 11, fontWeight: 800, color: '#64748b' }}>CHỌN MẪU THÔNG BÁO THEO MỤC TIÊU:</span>
                  <button
                    type="button"
                    onClick={() => setActiveTab('goal_templates')}
                    style={{ border: 'none', background: 'transparent', color: '#ff1a8c', fontSize: 11, fontWeight: 800, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}
                  >
                    <Plus size={12} /> Quản lý thư viện mẫu
                  </button>
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {pushTemplates.map((tmpl) => (
                    <button
                      key={tmpl.id}
                      type="button"
                      onClick={() => applyTemplateToDispatch(tmpl)}
                      style={{
                        padding: '6px 12px',
                        borderRadius: 20,
                        border: '1px solid #fbcfe8',
                        background: '#fff0f5',
                        color: '#ff1a8c',
                        fontSize: 12,
                        fontWeight: 700,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6
                      }}
                    >
                      <span>{tmpl.title}</span>
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

                {/* Respect User Preferences Toggle */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: '#fff0f5', padding: 12, borderRadius: 12, border: '1px solid #fbcfe8', marginTop: 4 }}>
                  <input
                    type="checkbox"
                    id="respectUserPreferencesToggle"
                    checked={respectUserPreferences}
                    onChange={(e) => setRespectUserPreferences(e.target.checked)}
                    style={{ width: 18, height: 18, accentColor: '#ff1a8c', cursor: 'pointer' }}
                  />
                  <label htmlFor="respectUserPreferencesToggle" style={{ fontSize: 13, fontWeight: 700, color: '#9f1239', cursor: 'pointer' }}>
                    Tôn trọng Cài đặt Danh mục thông báo cá nhân của học viên (Tự động lọc bớt người dùng tắt nhận loại tin này)
                  </label>
                </div>

                {/* Send Native Push Toggle */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: '#f8fafc', padding: 12, borderRadius: 12, border: '1px solid #e2e8f0' }}>
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
                  <div style={{ background: '#ecfdf5', border: '1px solid #a7f3d0', padding: 12, borderRadius: 12, color: '#065f46', fontSize: 13, fontWeight: 700, display: 'flex', flexDirection: 'column', gap: 4, marginTop: 8 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <CheckCircle2 size={18} style={{ color: '#10b981' }} />
                      <span>Thành công! Đã phát sóng thông báo tới {dispatchSuccess.count} học viên mục tiêu.</span>
                    </div>
                    {dispatchSuccess.filteredOutCount && dispatchSuccess.filteredOutCount > 0 ? (
                      <span style={{ fontSize: 12, color: '#047857', marginLeft: 26 }}>
                        🛡️ Đã đồng bộ & loại trừ {dispatchSuccess.filteredOutCount} học viên do họ đã tắt nhận danh mục thông báo này trong Hồ sơ cá nhân.
                      </span>
                    ) : null}
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
                  gap: 8
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
                <span>Người dùng chỉ cần cấp quyền Notification 1 lần duy nhất để nhận thông điệp ngay cả khi đang đóng trình duyệt!</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: GOAL-BASED PUSH TEMPLATES MANAGEMENT */}
      {activeTab === 'goal_templates' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* Top Control Bar */}
          <div style={{ background: '#ffffff', borderRadius: 20, padding: 20, border: '1px solid #f1f5f9', boxShadow: '0 2px 12px rgba(0,0,0,0.03)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 14 }}>
            <div>
              <h3 style={{ fontSize: 16, fontWeight: 800, color: '#0f172a', margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                <Target size={20} style={{ color: '#ff1a8c' }} />
                Quản lý Mẫu Thông Báo Push Theo Mục Tiêu
              </h3>
              <p style={{ fontSize: 13, color: '#64748b', margin: '4px 0 0 0' }}>
                Thêm, sửa, xóa và thiết lập kích hoạt tự động các kịch bản nhắc nhở thiết kế chuẩn chuyên môn cho từng mục tiêu học viên.
              </p>
            </div>

            <button
              type="button"
              onClick={handleOpenAddModal}
              style={{
                padding: '10px 18px',
                borderRadius: 12,
                border: 'none',
                background: 'linear-gradient(135deg, #ff1a8c 0%, #ff7b54 100%)',
                color: '#ffffff',
                fontSize: 13,
                fontWeight: 800,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                boxShadow: '0 4px 12px rgba(255, 26, 140, 0.3)'
              }}
            >
              <Plus size={16} />
              <span>Thêm Mẫu Push Mới</span>
            </button>
          </div>

          {/* Goal & Category Filter Pills */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, background: '#ffffff', padding: 16, borderRadius: 18, border: '1px solid #f1f5f9' }}>
            {/* Goal Filter */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <span style={{ fontSize: 12, fontWeight: 800, color: '#475569', display: 'flex', alignItems: 'center', gap: 6 }}>
                <Target size={14} style={{ color: '#ff1a8c' }} />
                <span>Lọc theo Mục Tiêu Gym:</span>
              </span>
              <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 2 }}>
                {[
                  { id: 'all', label: 'Tất cả mục tiêu', icon: Layers },
                  { id: 'lose-fat', label: '🔥 Giảm Mỡ / Giảm Cân', icon: Flame },
                  { id: 'gain-muscle', label: '💪 Tăng Cơ / Nâng Tạ', icon: Dumbbell },
                  { id: 'maintain', label: '🥑 Duy Trì Vóc Dáng', icon: Utensils },
                  { id: 'health', label: '🧘 Sức Khỏe & Giãn Cơ', icon: Sparkles }
                ].map((f) => {
                  const Icon = f.icon
                  const isSelected = templateGoalFilter === f.id
                  return (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => setTemplateGoalFilter(f.id as any)}
                      style={{
                        padding: '6px 14px',
                        borderRadius: 20,
                        border: isSelected ? '2px solid #ff1a8c' : '1px solid #cbd5e1',
                        background: isSelected ? '#fff0f5' : '#ffffff',
                        color: isSelected ? '#ff1a8c' : '#475569',
                        fontSize: 12,
                        fontWeight: 800,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        whiteSpace: 'nowrap',
                        transition: 'all 0.15s'
                      }}
                    >
                      <Icon size={14} />
                      <span>{f.label}</span>
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Category Preference Filter */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, borderTop: '1px solid #f8fafc', paddingTop: 10 }}>
              <span style={{ fontSize: 12, fontWeight: 800, color: '#475569', display: 'flex', alignItems: 'center', gap: 6 }}>
                <Filter size={14} style={{ color: '#ff1a8c' }} />
                <span>Lọc theo Nhóm Cài Đặt Học Viên Muốn Nhận:</span>
              </span>
              <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 2 }}>
                {[
                  { id: 'all', label: 'Tất cả nhóm' },
                  { id: 'workout', label: '🏋️ Tập luyện & Lịch trình' },
                  { id: 'nutrition', label: '🥗 Dinh dưỡng & Nước uống' },
                  { id: 'learning', label: '🎓 Bài giảng & Kiến thức' },
                  { id: 'coach', label: '💬 HLV & Aura AI Assistant' },
                  { id: 'general', label: '📢 Thông báo chung' }
                ].map((cat) => {
                  const isSelected = templateCategoryFilter === cat.id
                  return (
                    <button
                      key={cat.id}
                      type="button"
                      onClick={() => setTemplateCategoryFilter(cat.id as any)}
                      style={{
                        padding: '6px 14px',
                        borderRadius: 20,
                        border: isSelected ? '2px solid #ff1a8c' : '1px solid #cbd5e1',
                        background: isSelected ? '#fff0f5' : '#ffffff',
                        color: isSelected ? '#ff1a8c' : '#475569',
                        fontSize: 12,
                        fontWeight: 800,
                        cursor: 'pointer',
                        whiteSpace: 'nowrap',
                        transition: 'all 0.15s'
                      }}
                    >
                      <span>{cat.label}</span>
                    </button>
                  )
                })}
              </div>
            </div>
          </div>

          {/* Templates Grid */}
          {filteredTemplates.length === 0 ? (
            <div style={{ background: '#ffffff', borderRadius: 20, padding: 40, textAlign: 'center', border: '1px solid #f1f5f9' }}>
              <Target size={36} style={{ color: '#cbd5e1', margin: '0 auto 12px' }} />
              <h4 style={{ fontSize: 15, fontWeight: 800, color: '#0f172a', margin: '0 0 6px 0' }}>Chưa có mẫu thông báo nào trong danh mục này</h4>
              <p style={{ fontSize: 13, color: '#64748b', margin: 0 }}>Hãy bấm "Thêm Mẫu Push Mới" để tạo kịch bản chăm sóc học viên tự động.</p>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 16 }}>
              {filteredTemplates.map((tmpl) => (
                <div
                  key={tmpl.id}
                  style={{
                    background: '#ffffff',
                    borderRadius: 18,
                    padding: 18,
                    border: tmpl.active ? '1px solid #f1f5f9' : '1px dashed #cbd5e1',
                    opacity: tmpl.active ? 1 : 0.7,
                    boxShadow: tmpl.active ? '0 4px 15px rgba(0,0,0,0.03)' : 'none',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                    gap: 12,
                    position: 'relative'
                  }}
                >
                  {/* Top Bar: Goal & Category Badges + Active Toggle */}
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, flexWrap: 'wrap', gap: 6 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                        {renderGoalBadge(tmpl.targetGoal)}
                        {renderCategoryBadge(tmpl.category)}
                      </div>

                      {/* Active Status Switch */}
                      <button
                        type="button"
                        onClick={() => handleToggleActiveHandler(tmpl.id, tmpl.active)}
                        style={{
                          border: 'none',
                          background: 'transparent',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 4,
                          fontSize: 11,
                          fontWeight: 800,
                          color: tmpl.active ? '#10b981' : '#94a3b8'
                        }}
                      >
                        {tmpl.active ? <ToggleRight size={24} style={{ color: '#10b981' }} /> : <ToggleLeft size={24} style={{ color: '#cbd5e1' }} />}
                        <span>{tmpl.active ? 'Đang bật' : 'Đã tắt'}</span>
                      </button>
                    </div>

                    {/* Trigger Time / Tag */}
                    {(tmpl.scheduledTime || tmpl.triggerLabel) && (
                      <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
                        <Clock size={12} style={{ color: '#ff1a8c' }} />
                        <span>{tmpl.scheduledTime ? `Giờ tự động: ${tmpl.scheduledTime}` : ''} {tmpl.triggerLabel ? `(${tmpl.triggerLabel})` : ''}</span>
                      </div>
                    )}

                    {/* Title & Message */}
                    <h4 style={{ fontSize: 14, fontWeight: 800, color: '#0f172a', margin: '0 0 6px 0', lineHeight: 1.3 }}>
                      {tmpl.title}
                    </h4>
                    <p style={{ fontSize: 12, color: '#475569', margin: 0, lineHeight: 1.5, display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                      {tmpl.message}
                    </p>
                  </div>

                  {/* Bottom Actions Row */}
                  <div style={{ borderTop: '1px solid #f1f5f9', paddingTop: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <button
                      type="button"
                      onClick={() => applyTemplateToDispatch(tmpl)}
                      style={{
                        padding: '6px 12px',
                        borderRadius: 8,
                        border: 'none',
                        background: '#fff0f5',
                        color: '#ff1a8c',
                        fontSize: 11,
                        fontWeight: 800,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 4
                      }}
                    >
                      <Send size={12} />
                      <span>Gửi ngay mẫu này</span>
                    </button>

                    <div style={{ display: 'flex', gap: 6 }}>
                      <button
                        type="button"
                        onClick={() => handleOpenEditModal(tmpl)}
                        style={{
                          padding: '6px 10px',
                          borderRadius: 8,
                          border: '1px solid #cbd5e1',
                          background: '#ffffff',
                          color: '#0f172a',
                          fontSize: 11,
                          fontWeight: 700,
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 4
                        }}
                      >
                        <Edit3 size={12} />
                        <span>Sửa</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => setDeletingId(tmpl.id)}
                        style={{
                          padding: '6px 10px',
                          borderRadius: 8,
                          border: '1px solid #fecaca',
                          background: '#fef2f2',
                          color: '#ef4444',
                          fontSize: 11,
                          fontWeight: 700,
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 4
                        }}
                      >
                        <Trash2 size={12} />
                        <span>Xóa</span>
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* TAB 3: SYSTEM PUSH SETTINGS */}
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

      {/* TAB 4: WEB PUSH TESTER */}
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

      {/* TAB 5: BROADCAST HISTORY & LOGS */}
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

      {/* CREATE / EDIT TEMPLATE MODAL */}
      {showModal && (
        <div style={{
          position: 'fixed',
          inset: 0,
          backgroundColor: 'rgba(15, 23, 42, 0.6)',
          backdropFilter: 'blur(4px)',
          display: 'grid',
          placeItems: 'center',
          zIndex: 9999,
          padding: 16
        }}>
          <div style={{
            background: '#ffffff',
            borderRadius: 20,
            width: '100%',
            maxWidth: 580,
            padding: 24,
            boxShadow: '0 20px 40px rgba(0,0,0,0.2)',
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
            maxHeight: '90vh',
            overflowY: 'auto'
          }}>
            {/* Modal Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid #f1f5f9', paddingBottom: 12 }}>
              <h3 style={{ fontSize: 17, fontWeight: 800, color: '#0f172a', margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                <Target size={20} style={{ color: '#ff1a8c' }} />
                <span>{editingTemplate ? 'Chỉnh sửa Mẫu Push Notification' : 'Thêm Mẫu Push Notification Theo Mục Tiêu'}</span>
              </h3>
              <button
                type="button"
                onClick={() => setShowModal(false)}
                style={{ border: 'none', background: 'transparent', color: '#64748b', cursor: 'pointer', padding: 4 }}
              >
                <X size={20} />
              </button>
            </div>

            {/* Form Fields */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={{ fontSize: 12, fontWeight: 700, color: '#475569', marginBottom: 4, display: 'block' }}>
                  Mục tiêu học viên hướng tới (Target Goal):
                </label>
                <select
                  value={formTargetGoal}
                  onChange={(e) => setFormTargetGoal(e.target.value as FitnessGoalTarget)}
                  style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '1px solid #cbd5e1', fontSize: 13, background: '#ffffff', fontWeight: 700 }}
                >
                  <option value="lose-fat">🔥 Giảm Mỡ / Giảm Cân (Lose Fat)</option>
                  <option value="gain-muscle">💪 Tăng Cơ / Xây Bắp (Gain Muscle)</option>
                  <option value="maintain">🥑 Duy Trì Vóc Dáng (Maintain)</option>
                  <option value="health">🧘 Sức Khỏe & Giãn Cơ (Health)</option>
                  <option value="all">🎯 Tất cả các mục tiêu (General)</option>
                </select>
              </div>

              {/* Category Preference Matching Box */}
              <div style={{ background: '#fff0f5', padding: 12, borderRadius: 12, border: '1px solid #fbcfe8' }}>
                <label style={{ fontSize: 12, fontWeight: 800, color: '#9f1239', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span>🏷️ Nhóm thông báo học viên (Khớp với Cài đặt Thông báo Học viên nhận):</span>
                </label>
                <select
                  value={formCategory}
                  onChange={(e) => setFormCategory(e.target.value as NotificationCategory)}
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    borderRadius: 10,
                    border: '1px solid #f43f5e',
                    fontSize: 13,
                    background: '#ffffff',
                    fontWeight: 800,
                    color: '#0f172a'
                  }}
                >
                  <option value="workout">🏋️ Tập luyện & Lịch trình (Giờ tập gym & bài tập hôm nay)</option>
                  <option value="nutrition">🥗 Dinh dưỡng & Nước uống (Nhắc ghi chép bữa ăn & uống nước)</option>
                  <option value="learning">🎓 Bài giảng & Kiến thức (Bài học mới & Streak học tập)</option>
                  <option value="coach">💬 HLV & Aura AI Assistant (Phản hồi từ HLV cá nhân & trợ lý AI)</option>
                  <option value="general">📢 Thông báo chung / Hệ thống (Thông điệp chung hệ thống)</option>
                </select>
                <span style={{ fontSize: 11, color: '#881337', marginTop: 4, display: 'block', fontWeight: 600 }}>
                  🛡️ Khi phát sóng, hệ thống sẽ tự động đồng bộ & lọc loại trừ học viên đã tắt nhận loại thông báo này trong Hồ sơ.
                </span>
              </div>

              <div>
                <label style={{ fontSize: 12, fontWeight: 700, color: '#475569', marginBottom: 4, display: 'block' }}>
                  Tiêu đề thông báo (Title):
                </label>
                <input
                  type="text"
                  value={formTitle}
                  onChange={(e) => setFormTitle(e.target.value)}
                  placeholder="Ví dụ: 🥗 Bữa trưa thâm hụt Calo Giảm Mỡ"
                  style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '1px solid #cbd5e1', fontSize: 13, fontWeight: 700 }}
                />
              </div>

              <div>
                <label style={{ fontSize: 12, fontWeight: 700, color: '#475569', marginBottom: 4, display: 'block' }}>
                  Nội dung thông báo (Message):
                </label>
                <textarea
                  rows={3}
                  value={formMessage}
                  onChange={(e) => setFormMessage(e.target.value)}
                  placeholder="Mô tả chi tiết lời nhắc hoặc lời khuyên chuyên môn..."
                  style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '1px solid #cbd5e1', fontSize: 13, fontFamily: 'inherit' }}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 700, color: '#475569', marginBottom: 4, display: 'block' }}>
                    Phân loại Push:
                  </label>
                  <select
                    value={formType}
                    onChange={(e) => setFormType(e.target.value as any)}
                    style={{ width: '100%', padding: '9px 12px', borderRadius: 10, border: '1px solid #cbd5e1', fontSize: 13, background: '#ffffff' }}
                  >
                    <option value="REMINDER">⏰ Nhắc nhở (Reminder)</option>
                    <option value="WORKOUT">🏋️ Tập luyện (Workout)</option>
                    <option value="MOTIVATION">🔥 Động viên (Motivation)</option>
                    <option value="ANNOUNCEMENT">📢 Thông báo (Announcement)</option>
                    <option value="PROMOTION">🎁 Ưu đãi (Promotion)</option>
                  </select>
                </div>

                <div>
                  <label style={{ fontSize: 12, fontWeight: 700, color: '#475569', marginBottom: 4, display: 'block' }}>
                    Giờ tự động nhắc (Time):
                  </label>
                  <input
                    type="time"
                    value={formScheduledTime}
                    onChange={(e) => setFormScheduledTime(e.target.value)}
                    style={{ width: '100%', padding: '8px 12px', borderRadius: 10, border: '1px solid #cbd5e1', fontSize: 13 }}
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 700, color: '#475569', marginBottom: 4, display: 'block' }}>
                    Nhãn gợi nhớ (Trigger Tag):
                  </label>
                  <input
                    type="text"
                    value={formTriggerLabel}
                    onChange={(e) => setFormTriggerLabel(e.target.value)}
                    placeholder="Ví dụ: Bữa trưa Calo Deficit"
                    style={{ width: '100%', padding: '9px 12px', borderRadius: 10, border: '1px solid #cbd5e1', fontSize: 12 }}
                  />
                </div>

                <div>
                  <label style={{ fontSize: 12, fontWeight: 700, color: '#475569', marginBottom: 4, display: 'block' }}>
                    Đường dẫn khi bấm (Action URL):
                  </label>
                  <select
                    value={formActionUrl}
                    onChange={(e) => setFormActionUrl(e.target.value)}
                    style={{ width: '100%', padding: '9px 12px', borderRadius: 10, border: '1px solid #cbd5e1', fontSize: 13, background: '#ffffff' }}
                  >
                    <option value="/nutrition">🥗 Dinh dưỡng (/nutrition)</option>
                    <option value="/workout">🏋️ Tập luyện (/workout)</option>
                    <option value="/progress">📊 Tiến độ (/progress)</option>
                    <option value="/courses">🎓 Học viện (/courses)</option>
                    <option value="/schedule">📅 Lịch PT (/schedule)</option>
                  </select>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: '#f8fafc', padding: 12, borderRadius: 12, border: '1px solid #e2e8f0' }}>
                <input
                  type="checkbox"
                  id="templateActiveCheck"
                  checked={formActive}
                  onChange={(e) => setFormActive(e.target.checked)}
                  style={{ width: 18, height: 18, accentColor: '#ff1a8c', cursor: 'pointer' }}
                />
                <label htmlFor="templateActiveCheck" style={{ fontSize: 13, fontWeight: 700, color: '#0f172a', cursor: 'pointer' }}>
                  Kích hoạt mẫu này cho kịch bản tự động hóa Push Notifications
                </label>
              </div>
            </div>

            {/* Modal Actions */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 10, borderTop: '1px solid #f1f5f9', paddingTop: 14 }}>
              <button
                type="button"
                onClick={() => setShowModal(false)}
                style={{ padding: '8px 18px', borderRadius: 10, border: '1px solid #cbd5e1', background: '#ffffff', color: '#475569', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}
              >
                Hủy
              </button>

              <button
                type="button"
                disabled={!formTitle.trim() || !formMessage.trim() || savingTemplate}
                onClick={handleSaveTemplateSubmit}
                style={{
                  padding: '8px 22px',
                  borderRadius: 10,
                  border: 'none',
                  background: 'linear-gradient(135deg, #ff1a8c 0%, #ff7b54 100%)',
                  color: '#ffffff',
                  fontSize: 13,
                  fontWeight: 800,
                  cursor: 'pointer',
                  boxShadow: '0 4px 12px rgba(255, 26, 140, 0.3)'
                }}
              >
                {savingTemplate ? 'Đang lưu...' : editingTemplate ? 'Cập Nhật Mẫu' : 'Tạo Mẫu Mới'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* DELETE CONFIRMATION DIALOG */}
      {deletingId && (
        <div style={{
          position: 'fixed',
          inset: 0,
          backgroundColor: 'rgba(15, 23, 42, 0.6)',
          backdropFilter: 'blur(4px)',
          display: 'grid',
          placeItems: 'center',
          zIndex: 9999,
          padding: 16
        }}>
          <div style={{
            background: '#ffffff',
            borderRadius: 20,
            width: '100%',
            maxWidth: 420,
            padding: 24,
            boxShadow: '0 20px 40px rgba(0,0,0,0.2)',
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
            textAlign: 'center'
          }}>
            <div style={{ width: 48, height: 48, borderRadius: '50%', background: '#fef2f2', color: '#ef4444', display: 'grid', placeItems: 'center', margin: '0 auto' }}>
              <Trash2 size={24} />
            </div>

            <div>
              <h3 style={{ fontSize: 17, fontWeight: 800, color: '#0f172a', margin: '0 0 6px 0' }}>Xác nhận xóa Mẫu Push?</h3>
              <p style={{ fontSize: 13, color: '#64748b', margin: 0, lineHeight: 1.4 }}>
                Hành động này sẽ xóa vĩnh viễn mẫu thông báo đẩy này khỏi thư viện và hệ thống tự động hóa.
              </p>
            </div>

            <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 4 }}>
              <button
                type="button"
                onClick={() => setDeletingId(null)}
                style={{ padding: '10px 20px', borderRadius: 12, border: '1px solid #cbd5e1', background: '#ffffff', color: '#475569', fontSize: 13, fontWeight: 700, cursor: 'pointer', flex: 1 }}
              >
                Hủy bỏ
              </button>

              <button
                type="button"
                onClick={() => handleDeleteTemplateConfirm(deletingId)}
                style={{ padding: '10px 20px', borderRadius: 12, border: 'none', background: '#ef4444', color: '#ffffff', fontSize: 13, fontWeight: 800, cursor: 'pointer', flex: 1, boxShadow: '0 4px 12px rgba(239, 68, 68, 0.3)' }}
              >
                Đồng ý Xóa
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
