import '../../styles-admin.css'
import './push/AdminNotificationsPage.css'
import { useCallback, useEffect, useState } from 'react'
import { Activity, History, Send, SlidersHorizontal } from 'lucide-react'
import { PageHeader } from '../../components/ui'
import type {
  AdminUserRecord,
  PushAdminOverview,
  PushAutomationLog,
  PushBroadcastLog,
  PushDispatchResult,
  PushTemplate,
  SystemPushSettings,
  ViewId,
} from '../../types'
import {
  DEFAULT_PUSH_SETTINGS,
  deletePushTemplate,
  dispatchAdminPushBroadcast,
  getPushAdminOverview,
  getPushAutomationLogs,
  getPushBroadcastLogs,
  getPushTemplates,
  getSystemPushSettings,
  savePushTemplate,
  saveSystemPushSettings,
  togglePushTemplateActive,
} from '../../services/notificationService'
import { getStoredFcmToken, requestFcmPermissionAndToken } from '../../services/fcmService'
import { PushAutomationPanel } from './push/PushAutomationPanel'
import { PushComposerPanel } from './push/PushComposerPanel'
import { PushHistoryPanel } from './push/PushHistoryPanel'
import { PushOverviewPanel } from './push/PushOverviewPanel'
import { PushTemplateDrawer } from './push/PushTemplateDrawer'
import {
  DEFAULT_PUSH_DRAFT,
  type PushAdminTab,
  type PushComposerDraft,
} from './push/pushTypes'

interface AdminNotificationsPageProps {
  onNavigate?: (view: ViewId) => void
  users?: AdminUserRecord[]
  currentUserUid?: string
}

const TABS: Array<{
  id: PushAdminTab
  label: string
  shortLabel: string
  icon: typeof Activity
}> = [
  { id: 'overview', label: 'Tổng quan', shortLabel: 'Tổng quan', icon: Activity },
  { id: 'compose', label: 'Gửi thông báo', shortLabel: 'Gửi', icon: Send },
  { id: 'automation', label: 'Tự động hóa', shortLabel: 'Tự động', icon: SlidersHorizontal },
  { id: 'history', label: 'Lịch sử', shortLabel: 'Lịch sử', icon: History },
]

function initialPermission(): NotificationPermission | 'unsupported' {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported'
  return Notification.permission
}

function errorMessage(error: unknown, fallback: string) {
  if (!(error instanceof Error) || !error.message) return fallback
  const normalizedMessage = error.message.trim().toLowerCase()
  if (normalizedMessage === 'internal' || normalizedMessage === 'functions/internal') {
    return `${fallback} Dịch vụ Push chưa phản hồi đúng; vui lòng thử lại sau khi làm mới trang.`
  }
  return error.message
}

function audienceFromTemplate(template: PushTemplate): PushComposerDraft['audience'] {
  if (template.targetGoal === 'lose-fat') return 'goal_lose_fat'
  if (template.targetGoal === 'gain-muscle') return 'goal_gain_muscle'
  if (template.targetGoal === 'maintain') return 'goal_maintain'
  if (template.targetGoal === 'health') return 'goal_health'
  if (template.category === 'nutrition') return 'pref_nutrition'
  if (template.category === 'workout') return 'pref_workout'
  if (template.category === 'learning') return 'pref_learning'
  if (template.category === 'coach') return 'pref_coach'
  return 'all'
}

export default function AdminNotificationsPage({
  users = [],
  currentUserUid,
}: AdminNotificationsPageProps) {
  const [activeTab, setActiveTab] = useState<PushAdminTab>('overview')
  const [settings, setSettings] = useState<SystemPushSettings>({
    ...DEFAULT_PUSH_SETTINGS,
    mealReminderTimes: { ...DEFAULT_PUSH_SETTINGS.mealReminderTimes },
  })
  const [overview, setOverview] = useState<PushAdminOverview | null>(null)
  const [templates, setTemplates] = useState<PushTemplate[]>([])
  const [broadcasts, setBroadcasts] = useState<PushBroadcastLog[]>([])
  const [automations, setAutomations] = useState<PushAutomationLog[]>([])
  const [draft, setDraft] = useState<PushComposerDraft>({ ...DEFAULT_PUSH_DRAFT })
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')

  const [dispatching, setDispatching] = useState(false)
  const [dispatchResult, setDispatchResult] = useState<PushDispatchResult | null>(null)
  const [dispatchError, setDispatchError] = useState('')

  const [savingSettings, setSavingSettings] = useState(false)
  const [settingsSaved, setSettingsSaved] = useState(false)
  const [settingsError, setSettingsError] = useState('')

  const [templateDrawerOpen, setTemplateDrawerOpen] = useState(false)
  const [templateBusy, setTemplateBusy] = useState(false)
  const [templateError, setTemplateError] = useState('')

  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>(initialPermission)
  const [currentFcmToken, setCurrentFcmToken] = useState<string | null>(() => currentUserUid ? getStoredFcmToken(currentUserUid) : null)
  const [deviceBusy, setDeviceBusy] = useState(false)
  const [deviceMessage, setDeviceMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null)

  const loadAdminPushData = useCallback(async () => {
    setLoading(true)
    setLoadError('')
    const [settingsResult, templatesResult, broadcastsResult, automationsResult, overviewResult] = await Promise.allSettled([
      getSystemPushSettings(),
      getPushTemplates(),
      getPushBroadcastLogs(),
      getPushAutomationLogs(),
      getPushAdminOverview(),
    ])

    if (settingsResult.status === 'fulfilled') setSettings(settingsResult.value)
    if (templatesResult.status === 'fulfilled') setTemplates(templatesResult.value)
    if (broadcastsResult.status === 'fulfilled') setBroadcasts(broadcastsResult.value)
    if (automationsResult.status === 'fulfilled') setAutomations(automationsResult.value)
    if (overviewResult.status === 'fulfilled') setOverview(overviewResult.value)

    const failures = [settingsResult, templatesResult, broadcastsResult, automationsResult, overviewResult]
      .filter((result) => result.status === 'rejected').length
    if (failures > 0) {
      setLoadError(`Có ${failures} nguồn dữ liệu chưa tải được. Các phần còn lại vẫn có thể sử dụng.`)
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    void loadAdminPushData()
  }, [loadAdminPushData])

  useEffect(() => {
    setCurrentFcmToken(currentUserUid ? getStoredFcmToken(currentUserUid) : null)
    setPermission(initialPermission())
  }, [currentUserUid])

  const refreshOperationalData = useCallback(async () => {
    const [broadcastResult, automationResult, overviewResult] = await Promise.allSettled([
      getPushBroadcastLogs(),
      getPushAutomationLogs(),
      getPushAdminOverview(),
    ])
    if (broadcastResult.status === 'fulfilled') setBroadcasts(broadcastResult.value)
    if (automationResult.status === 'fulfilled') setAutomations(automationResult.value)
    if (overviewResult.status === 'fulfilled') setOverview(overviewResult.value)
  }, [])

  const handleDispatch = async (targetUserIds: string[]) => {
    setDispatching(true)
    setDispatchError('')
    setDispatchResult(null)
    try {
      const targetType = draft.audience === 'all'
        ? 'all'
        : draft.audience === 'individual'
          ? 'individual'
          : 'category'
      if (targetType !== 'all' && targetUserIds.length === 0) {
        throw new Error('Nhóm đã chọn không có người nhận. Hãy chọn nhóm khác trước khi gửi.')
      }
      const result = await dispatchAdminPushBroadcast({
        title: draft.title.trim(),
        message: draft.message.trim(),
        type: draft.type,
        category: draft.category,
        targetType,
        targetUserIds,
        actionUrl: draft.actionUrl.startsWith('/') ? draft.actionUrl : '/home',
        sentBy: currentUserUid || 'Admin Aura',
        respectCategoryPreferences: true,
      })
      setDispatchResult(result)
      await refreshOperationalData()
      return true
    } catch (error) {
      setDispatchError(errorMessage(error, 'Chưa thể gửi thông báo. Vui lòng kiểm tra kết nối và thử lại.'))
      return false
    } finally {
      setDispatching(false)
    }
  }

  const handleSaveSettings = async () => {
    setSavingSettings(true)
    setSettingsSaved(false)
    setSettingsError('')
    try {
      const nextSettings = {
        ...settings,
        updatedAt: new Date().toISOString(),
        updatedBy: currentUserUid || 'Admin Aura',
      }
      await saveSystemPushSettings(nextSettings)
      setSettings(nextSettings)
      setSettingsSaved(true)
      window.setTimeout(() => setSettingsSaved(false), 3500)
      await refreshOperationalData()
    } catch (error) {
      setSettingsError(errorMessage(error, 'Chưa thể lưu cấu hình Push.'))
    } finally {
      setSavingSettings(false)
    }
  }

  const handleEnableDevice = async () => {
    if (!currentUserUid) {
      setDeviceMessage({ tone: 'error', text: 'Không xác định được tài khoản quản trị hiện tại.' })
      return
    }
    if (permission === 'unsupported') {
      setDeviceMessage({ tone: 'error', text: 'Trình duyệt này không hỗ trợ Web Push.' })
      return
    }
    if (permission === 'denied') {
      setDeviceMessage({ tone: 'error', text: 'Trình duyệt đang chặn thông báo. Hãy cấp quyền trong cài đặt website rồi tải lại trang.' })
      return
    }
    setDeviceBusy(true)
    setDeviceMessage(null)
    try {
      const token = await requestFcmPermissionAndToken(currentUserUid)
      setPermission(initialPermission())
      setCurrentFcmToken(token)
      setDeviceMessage(token
        ? { tone: 'success', text: 'Thiết bị quản trị đã được đăng ký nhận Push.' }
        : { tone: 'error', text: 'Chưa nhận được token thiết bị. Hãy kiểm tra quyền thông báo và thử lại.' })
      await refreshOperationalData()
    } catch (error) {
      setPermission(initialPermission())
      setDeviceMessage({ tone: 'error', text: errorMessage(error, 'Không thể đăng ký thiết bị.') })
    } finally {
      setDeviceBusy(false)
    }
  }

  const handleSendDeviceTest = async () => {
    if (!currentUserUid || !currentFcmToken) return
    setDeviceBusy(true)
    setDeviceMessage(null)
    try {
      // Refresh the browser token and its server-side device registration before
      // every test. A local token can outlive a cleared or expired Firestore row.
      const registeredToken = await requestFcmPermissionAndToken(currentUserUid)
      if (!registeredToken) {
        setDeviceMessage({
          tone: 'error',
          text: 'Thiết bị chưa được đăng ký trên máy chủ. Hãy bật lại Push rồi thử lại.',
        })
        return
      }
      setCurrentFcmToken(registeredToken)
      const result = await dispatchAdminPushBroadcast({
        title: 'Aura Push đang hoạt động',
        message: 'Đây là bản kiểm tra dành riêng cho thiết bị quản trị hiện tại.',
        type: 'INFO',
        category: 'general',
        targetType: 'individual',
        targetUserIds: [currentUserUid],
        actionUrl: '/home',
        sentBy: currentUserUid,
        respectCategoryPreferences: false,
      })
      setDeviceMessage({
        tone: result.webPushSentCount > 0 ? 'success' : 'error',
        text: result.webPushSentCount > 0
          ? `FCM đã chấp nhận bản kiểm tra trên ${result.webPushSentCount} thiết bị.`
          : 'Đã tạo inbox nhưng FCM chưa chấp nhận thiết bị nào. Kiểm tra token và cấu hình Firebase.',
      })
      await refreshOperationalData()
    } catch (error) {
      setDeviceMessage({ tone: 'error', text: errorMessage(error, 'Không thể gửi bản kiểm tra.') })
    } finally {
      setDeviceBusy(false)
    }
  }

  const applyTemplate = (template: PushTemplate) => {
    setDraft({
      audience: audienceFromTemplate(template),
      userId: '',
      type: template.type,
      category: template.category ?? 'general',
      title: template.title,
      message: template.message,
      actionUrl: template.actionUrl || '/home',
    })
    setTemplateDrawerOpen(false)
    setDispatchResult(null)
    setDispatchError('')
    setActiveTab('compose')
  }

  const handleSaveTemplate = async (template: PushTemplate) => {
    setTemplateBusy(true)
    setTemplateError('')
    try {
      await savePushTemplate(template)
      setTemplates(await getPushTemplates())
      return true
    } catch (error) {
      setTemplateError(errorMessage(error, 'Chưa thể lưu mẫu thông báo.'))
      return false
    } finally {
      setTemplateBusy(false)
    }
  }

  const handleDeleteTemplate = async (templateId: string) => {
    setTemplateBusy(true)
    setTemplateError('')
    try {
      await deletePushTemplate(templateId)
      setTemplates(await getPushTemplates())
    } catch (error) {
      setTemplateError(errorMessage(error, 'Chưa thể xóa mẫu thông báo.'))
    } finally {
      setTemplateBusy(false)
    }
  }

  const handleToggleTemplate = async (templateId: string, active: boolean) => {
    setTemplateBusy(true)
    setTemplateError('')
    try {
      await togglePushTemplateActive(templateId, active)
      setTemplates(await getPushTemplates())
    } catch (error) {
      setTemplateError(errorMessage(error, 'Chưa thể cập nhật trạng thái mẫu.'))
    } finally {
      setTemplateBusy(false)
    }
  }

  const reuseBroadcast = (log: PushBroadcastLog) => {
    setDraft({
      ...DEFAULT_PUSH_DRAFT,
      type: log.type,
      category: log.category ?? 'general',
      title: log.title,
      message: log.message,
      actionUrl: log.actionUrl || '/home',
    })
    setDispatchResult(null)
    setDispatchError('')
    setActiveTab('compose')
  }

  return (
    <main className="page admin-push-page">
      <div className="admin-push-page__header">
        <PageHeader
          eyebrow="Vận hành & chăm sóc"
          title="Push Notifications"
          description="Gửi đúng người, đúng thời điểm và theo dõi kết quả rõ ràng."
        />
      </div>

      <nav className="push-admin-tabs" role="tablist" aria-label="Quản trị Push Notifications">
        {TABS.map((tab) => {
          const Icon = tab.icon
          const selected = activeTab === tab.id
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={`push-panel-${tab.id}`}
              className={selected ? 'is-active' : ''}
              onClick={() => setActiveTab(tab.id)}
            >
              <Icon size={18} />
              <span className="push-tab-label--full">{tab.label}</span>
              <span className="push-tab-label--short">{tab.shortLabel}</span>
            </button>
          )
        })}
      </nav>

      <section id={`push-panel-${activeTab}`} role="tabpanel" className="push-admin-content">
        {activeTab === 'overview' && (
          <PushOverviewPanel
            settings={settings}
            overview={overview}
            loading={loading}
            loadError={loadError}
            permission={permission}
            hasCurrentToken={Boolean(currentFcmToken)}
            deviceBusy={deviceBusy}
            deviceMessage={deviceMessage}
            onCompose={() => setActiveTab('compose')}
            onOpenAutomation={() => setActiveTab('automation')}
            onRefresh={() => void loadAdminPushData()}
            onEnableDevice={() => void handleEnableDevice()}
            onSendDeviceTest={() => void handleSendDeviceTest()}
          />
        )}
        {activeTab === 'compose' && (
          <PushComposerPanel
            users={users}
            templates={templates}
            draft={draft}
            dispatching={dispatching}
            result={dispatchResult}
            error={dispatchError}
            onDraftChange={(nextDraft) => {
              setDraft(nextDraft)
              setDispatchResult(null)
              setDispatchError('')
            }}
            onOpenTemplates={() => setTemplateDrawerOpen(true)}
            onDispatch={handleDispatch}
          />
        )}
        {activeTab === 'automation' && (
          <PushAutomationPanel
            settings={settings}
            latestLog={automations[0]}
            saving={savingSettings}
            saved={settingsSaved}
            error={settingsError}
            onChange={(nextSettings) => {
              setSettings(nextSettings)
              setSettingsSaved(false)
              setSettingsError('')
            }}
            onSave={() => void handleSaveSettings()}
          />
        )}
        {activeTab === 'history' && (
          <PushHistoryPanel
            broadcasts={broadcasts}
            automations={automations}
            loading={loading}
            onReuse={reuseBroadcast}
          />
        )}
      </section>

      <PushTemplateDrawer
        open={templateDrawerOpen}
        templates={templates}
        busy={templateBusy}
        error={templateError}
        onClose={() => setTemplateDrawerOpen(false)}
        onApply={applyTemplate}
        onSave={handleSaveTemplate}
        onDelete={handleDeleteTemplate}
        onToggle={handleToggleTemplate}
      />
    </main>
  )
}
