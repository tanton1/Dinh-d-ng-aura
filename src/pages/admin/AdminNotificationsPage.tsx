import '../../styles-admin.css'
import './push/AdminNotificationsPage.css'
import { useEffect, useRef, useState } from 'react'
import { Activity, FlaskConical, History, Send, SlidersHorizontal } from 'lucide-react'
import { PageHeader } from '../../components/ui'
import type {
  AdminUserRecord,
  PushBroadcastLog,
  PushDispatchResult,
  PushTemplate,
  SystemPushSettings,
  ViewId,
} from '../../types'
import {
  deletePushTemplate,
  dispatchAdminPushBroadcast,
  savePushTemplate,
  saveSystemPushSettings,
  togglePushTemplateActive,
} from '../../services/notificationService'
import { getStoredFcmToken, requestFcmPermissionAndToken } from '../../services/fcmService'
import { PushAutomationPanel } from './push/PushAutomationPanel'
import { PushComposerPanel } from './push/PushComposerPanel'
import { PushHistoryPanel, type HistoryFilter } from './push/PushHistoryPanel'
import { PushOverviewPanel } from './push/PushOverviewPanel'
import { PushTemplateDrawer } from './push/PushTemplateDrawer'
import {
  DEFAULT_PUSH_DRAFT,
  type PushComposerDraft,
} from './push/pushTypes'
import { UiRolloutPanel } from './push/UiRolloutPanel'
import { useAdminPushReads, type AdminSettingsTab } from './push/useAdminPushReads'
import { subscribeToAdminUsers } from '../../services/firebaseService'
import { clearPushIntent, readPushIntent, savePushIntent, type PendingPushIntent } from '../../services/pushDispatchIntent'

interface AdminNotificationsPageProps {
  onNavigate?: (view: ViewId) => void
  users?: AdminUserRecord[]
  currentUserUid?: string
  authzVersion?: string | number
  canManageUiRollout?: boolean
  backendMode?: 'demo' | 'firebase'
}

const TABS: Array<{
  id: AdminSettingsTab
  label: string
  shortLabel: string
  icon: typeof Activity
}> = [
  { id: 'overview', label: 'Tổng quan', shortLabel: 'Tổng quan', icon: Activity },
  { id: 'compose', label: 'Gửi thông báo', shortLabel: 'Gửi', icon: Send },
  { id: 'automation', label: 'Tự động hóa', shortLabel: 'Tự động', icon: SlidersHorizontal },
  { id: 'history', label: 'Lịch sử', shortLabel: 'Lịch sử', icon: History },
  { id: 'ui-rollout', label: 'Giao diện 4.0', shortLabel: 'UI 4.0', icon: FlaskConical },
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

export default function AdminNotificationsPage(props: AdminNotificationsPageProps) {
  const scope = JSON.stringify([props.currentUserUid ?? '', props.authzVersion ?? '', props.backendMode ?? 'firebase'])
  return <AdminNotificationsSession key={scope} {...props} />
}

function AdminNotificationsSession({
  users: suppliedUsers = [],
  currentUserUid,
  canManageUiRollout = false,
  backendMode = 'firebase',
}: AdminNotificationsPageProps) {
  const [activeTab, setActiveTab] = useState<AdminSettingsTab>('overview')
  const reads = useAdminPushReads(activeTab, backendMode)
  const { settings, setSettings, overview, templates, broadcasts, automations, loading, loadError } = reads
  const [users, setUsers] = useState<AdminUserRecord[]>(backendMode === 'demo' ? suppliedUsers : [])
  const [usersLoading, setUsersLoading] = useState(false)
  const [usersError, setUsersError] = useState('')
  const [usersRetry, setUsersRetry] = useState(0)
  const [historyFilter, setHistoryFilter] = useState<HistoryFilter>('all')
  const [pendingIntent, setPendingIntent] = useState<PendingPushIntent | null>(() => {
    try { return currentUserUid ? readPushIntent(window.sessionStorage, currentUserUid) : null } catch { return null }
  })
  const [draft, setDraft] = useState<PushComposerDraft>(() => pendingIntent?.draft ?? { ...DEFAULT_PUSH_DRAFT })
  const dispatchBusy = useRef(false)
  const needsUsers = activeTab === 'compose' || activeTab === 'ui-rollout'
  useEffect(() => {
    if (!needsUsers || backendMode !== 'firebase' || !currentUserUid) return
    let active = true
    setUsersLoading(true)
    setUsersError('')
    const stop = subscribeToAdminUsers(items => {
      if (!active) return
      setUsers(items); setUsersLoading(false)
    }, error => {
      if (!active) return
      setUsers([]); setUsersLoading(false); setUsersError(errorMessage(error, 'Chưa tải được người nhận.'))
    })
    return () => { active = false; stop() }
  }, [backendMode, currentUserUid, needsUsers, usersRetry])

  const [dispatching, setDispatching] = useState(false)
  const [dispatchResult, setDispatchResult] = useState<PushDispatchResult | null>(null)
  const [dispatchError, setDispatchError] = useState('')

  const [savingSettings, setSavingSettings] = useState(false)
  const [settingsSaved, setSettingsSaved] = useState(false)
  const [settingsError, setSettingsError] = useState('')
  const [settingsDraft, setSettingsDraft] = useState<SystemPushSettings | null>(null)

  const [templateDrawerOpen, setTemplateDrawerOpen] = useState(false)
  const [templateBusy, setTemplateBusy] = useState(false)
  const [templateError, setTemplateError] = useState('')

  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>(initialPermission)
  const [currentFcmToken, setCurrentFcmToken] = useState<string | null>(() => currentUserUid ? getStoredFcmToken(currentUserUid) : null)
  const [deviceBusy, setDeviceBusy] = useState(false)
  const [deviceMessage, setDeviceMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null)

  const handleDispatch = async (targetUserIds: string[]) => {
    if (dispatchBusy.current) return false
    dispatchBusy.current = true
    const current = reads.currentRequest()
    setDispatching(true)
    setDispatchError('')
    setDispatchResult(null)
    try {
      const targetType = draft.audience === 'all'
        ? 'all'
        : draft.audience === 'individual'
          ? 'individual'
          : 'category'
      if (!pendingIntent && targetType !== 'all' && targetUserIds.length === 0) {
        throw new Error('Nhóm đã chọn không có người nhận. Hãy chọn nhóm khác trước khi gửi.')
      }
      let intent = pendingIntent
      if (!intent) {
        if (!currentUserUid) throw new Error('Cần đăng nhập lại trước khi gửi thông báo.')
        const requestId = crypto.randomUUID()
        intent = { version: 1, actorId: currentUserUid, requestId, draft: { ...draft }, payload: {
          requestId,
          title: draft.title.trim(),
          message: draft.message.trim(),
          type: draft.type,
          category: draft.category,
          targetType,
          targetUserIds,
          actionUrl: draft.actionUrl.startsWith('/') ? draft.actionUrl : '/home',
          sentBy: currentUserUid,
          respectCategoryPreferences: true,
        } }
        savePushIntent(window.sessionStorage, intent)
        setPendingIntent(intent)
      }
      const result = await dispatchAdminPushBroadcast(intent.payload)
      if (!current()) return false
      setDispatchResult(result)
      if (result.complete !== false) {
        clearPushIntent(window.sessionStorage, intent.actorId)
        setPendingIntent(null)
      }
      reads.afterDelivery()
      return result.complete !== false
    } catch (error) {
      if (current()) {
        const details = (error as { details?: { noDeliveryStarted?: boolean } })?.details
        if (details?.noDeliveryStarted && currentUserUid) {
          clearPushIntent(window.sessionStorage, currentUserUid)
          setPendingIntent(null)
        }
        setDispatchError(errorMessage(error, 'Chưa xác định đầy đủ kết quả. Tiếp tục cùng lượt gửi để đối soát; không tạo lượt mới.'))
      }
      return false
    } finally {
      dispatchBusy.current = false
      if (current()) setDispatching(false)
    }
  }

  const handleSaveSettings = async () => {
    if (!reads.settingsReady) return
    const current = reads.currentRequest()
    setSavingSettings(true)
    setSettingsSaved(false)
    setSettingsError('')
    try {
      const nextSettings = {
        ...(settingsDraft ?? settings),
        updatedAt: new Date().toISOString(),
        updatedBy: currentUserUid || 'Admin Aura',
      }
      await saveSystemPushSettings(nextSettings)
      if (!current()) return
      setSettings(nextSettings)
      setSettingsDraft(null)
      setSettingsSaved(true)
      window.setTimeout(() => { if (current()) setSettingsSaved(false) }, 3500)
    } catch (error) {
      if (current()) setSettingsError(errorMessage(error, 'Chưa thể lưu cấu hình Push.'))
    } finally {
      if (current()) setSavingSettings(false)
    }
  }

  const handleEnableDevice = async () => {
    const current = reads.currentRequest()
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
      if (!current()) return
      setPermission(initialPermission())
      setCurrentFcmToken(token)
      setDeviceMessage(token
        ? { tone: 'success', text: 'Thiết bị quản trị đã được đăng ký nhận Push.' }
        : { tone: 'error', text: 'Chưa nhận được token thiết bị. Hãy kiểm tra quyền thông báo và thử lại.' })
      reads.afterDevice()
    } catch (error) {
      if (!current()) return
      setPermission(initialPermission())
      setDeviceMessage({ tone: 'error', text: errorMessage(error, 'Không thể đăng ký thiết bị.') })
    } finally {
      if (current()) setDeviceBusy(false)
    }
  }

  const handleSendDeviceTest = async () => {
    const current = reads.currentRequest()
    if (!currentUserUid || !currentFcmToken) return
    setDeviceBusy(true)
    setDeviceMessage(null)
    try {
      // Refresh the browser token and its server-side device registration before
      // every test. A local token can outlive a cleared or expired Firestore row.
      const registeredToken = await requestFcmPermissionAndToken(currentUserUid)
      if (!current()) return
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
      if (!current()) return
      setDeviceMessage({
        tone: result.webPushSentCount > 0 && !result.webPushUnknownCount ? 'success' : 'error',
        text: result.webPushUnknownCount
          ? 'FCM chưa xác nhận kết quả bản kiểm tra. Hệ thống giữ kết quả cần đối soát và không tự gửi lại.'
          : result.legacyDeduplicated
          ? 'Đã đối soát bản kiểm tra trước đó; không gửi thêm thông báo giống nhau trong 24 giờ.'
          : result.complete === false ? 'Bản kiểm tra đang được xử lý. Bấm lại để tiếp tục cùng lượt.'
          : result.webPushSentCount > 0
          ? `FCM đã chấp nhận bản kiểm tra trên ${result.webPushSentCount} thiết bị.`
          : 'Đã tạo inbox nhưng FCM chưa chấp nhận thiết bị nào. Kiểm tra token và cấu hình Firebase.',
      })
      reads.afterDelivery()
    } catch (error) {
      if (current()) setDeviceMessage({ tone: 'error', text: errorMessage(error, 'Không thể gửi bản kiểm tra.') })
    } finally {
      if (current()) setDeviceBusy(false)
    }
  }

  const applyTemplate = (template: PushTemplate) => {
    if (pendingIntent) { setActiveTab('compose'); setTemplateDrawerOpen(false); return }
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
    const current = reads.currentRequest()
    setTemplateBusy(true)
    setTemplateError('')
    try {
      await savePushTemplate(template)
      if (!current()) return false
      await reads.refreshTemplates()
      return true
    } catch (error) {
      if (current()) setTemplateError(errorMessage(error, 'Chưa thể lưu mẫu thông báo.'))
      return false
    } finally {
      if (current()) setTemplateBusy(false)
    }
  }

  const handleDeleteTemplate = async (templateId: string) => {
    const current = reads.currentRequest()
    setTemplateBusy(true)
    setTemplateError('')
    try {
      await deletePushTemplate(templateId)
      if (!current()) return
      await reads.refreshTemplates()
    } catch (error) {
      if (current()) setTemplateError(errorMessage(error, 'Chưa thể xóa mẫu thông báo.'))
    } finally {
      if (current()) setTemplateBusy(false)
    }
  }

  const handleToggleTemplate = async (templateId: string, active: boolean) => {
    const current = reads.currentRequest()
    setTemplateBusy(true)
    setTemplateError('')
    try {
      await togglePushTemplateActive(templateId, active)
      if (!current()) return
      await reads.refreshTemplates()
    } catch (error) {
      if (current()) setTemplateError(errorMessage(error, 'Chưa thể cập nhật trạng thái mẫu.'))
    } finally {
      if (current()) setTemplateBusy(false)
    }
  }

  const reuseBroadcast = (log: PushBroadcastLog) => {
    if (pendingIntent) { setActiveTab('compose'); return }
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
        {activeTab !== 'overview' && activeTab !== 'history' && (loadError || (needsUsers && usersError)) && <button type="button" className="push-button push-button--ghost" disabled={loading || (needsUsers && usersLoading)} onClick={() => {
          void reads.retryFailed()
          if (needsUsers && usersError) setUsersRetry(value => value + 1)
        }}>Thử lại dữ liệu</button>}
        {activeTab === 'overview' && (
          <PushOverviewPanel
            settings={settings}
            settingsReady={reads.settingsReady}
            overview={overview}
            loading={loading}
            loadError={loadError}
            permission={permission}
            hasCurrentToken={Boolean(currentFcmToken)}
            deviceBusy={deviceBusy}
            deviceMessage={deviceMessage}
            onCompose={() => setActiveTab('compose')}
            onOpenAutomation={() => setActiveTab('automation')}
            onRefresh={() => void reads.refresh()}
            onEnableDevice={() => void handleEnableDevice()}
            onSendDeviceTest={() => void handleSendDeviceTest()}
          />
        )}
        {activeTab === 'compose' && (<>
          {pendingIntent && <div className="push-alert push-alert--warning" role="status">
            <span>Đang giữ một lượt gửi chưa hoàn tất. Nội dung và người nhận được giữ nguyên khi tiếp tục.</span>
            <button type="button" className="push-button" disabled={dispatching} onClick={() => void handleDispatch([])}>Tiếp tục lượt gửi</button>
          </div>}
          <PushComposerPanel
            users={users}
            templates={templates}
            draft={draft}
            dispatching={dispatching}
            result={dispatchResult}
            error={dispatchError || usersError || loadError}
            audienceLoading={usersLoading}
            onDraftChange={(nextDraft) => {
              if (pendingIntent) return
              setDraft(nextDraft)
              setDispatchResult(null)
              setDispatchError('')
            }}
            onOpenTemplates={() => setTemplateDrawerOpen(true)}
            onDispatch={handleDispatch}
          /></>
        )}
        {activeTab === 'automation' && (
          <><div role="status">{!reads.settingsReady ? 'Chưa xác nhận cấu hình từ máy chủ. Hãy tải lại trước khi chỉnh sửa.' : ''}</div><fieldset disabled={!reads.settingsReady || loading || savingSettings} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}><PushAutomationPanel
            settings={settingsDraft ?? settings}
            latestLog={automations[0]}
            saving={savingSettings}
            saved={settingsSaved}
            error={settingsError || loadError}
            onChange={(nextSettings) => {
              setSettingsDraft(nextSettings)
              setSettingsSaved(false)
              setSettingsError('')
            }}
            onSave={() => void handleSaveSettings()}
          /></fieldset></>
        )}
        {activeTab === 'history' && (
          <PushHistoryPanel
            broadcasts={broadcasts}
            automations={automations}
            loading={loading}
            error={loadError}
            filter={historyFilter}
            onFilterChange={setHistoryFilter}
            hasMore={reads.hasMore}
            changed={reads.historyChanged}
            onLoadMore={() => void reads.loadMore()}
            onRefresh={() => void reads.refresh()}
            onReuse={reuseBroadcast}
          />
        )}
        {activeTab === 'ui-rollout' && (
          <><div role="status">{usersError || (usersLoading ? 'Đang tải tài khoản…' : '')}</div><UiRolloutPanel users={users} currentUserUid={currentUserUid} canManage={canManageUiRollout} demo={backendMode === 'demo'} /></>
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
