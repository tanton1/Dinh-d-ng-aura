import { collection, doc, onSnapshot, orderBy, query, setDoc, updateDoc, deleteDoc, serverTimestamp, getDocs, getDocsFromServer, writeBatch, where, getDoc, getDocFromServer, limit } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { firebaseFunctions } from '../lib/firebaseFunctions'
import { firestoreDb } from '../lib/firebaseFirestore'
import { getPushBroadcastLogsPage } from './pushHistoryService'
export { getPushBroadcastLogsPage, type PushBroadcastCursor, type PushBroadcastPage } from './pushHistoryService'
import { safeLocalStorageSet } from '../lib/safeStorage'
import type {
  AppNotification,
  SystemPushSettings,
  PushAdminOverview,
  PushAutomationLog,
  PushBroadcastLog,
  PushDispatchResult,
  PushTemplate,
  FitnessGoalTarget,
  NotificationCategory,
} from '../types'

function normalizeClock(value: unknown, fallback: string) {
  return typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value) ? value : fallback
}

function normalizePositiveInt(value: unknown, fallback: number, minimum: number, maximum: number) {
  const numberValue = typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : fallback
  return Math.min(maximum, Math.max(minimum, numberValue))
}

// Default system push settings
export const DEFAULT_PUSH_SETTINGS: SystemPushSettings = {
  enabled: true,
  automationEnabled: true,
  vapidPublicKey: import.meta.env.VITE_FIREBASE_VAPID_KEY?.trim() || '',
  fcmSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID?.trim() || '',
  fcmProjectId: import.meta.env.VITE_FIREBASE_PROJECT_ID?.trim() || '',
  autoMealReminders: true,
  mealReminderTimes: {
    breakfast: '07:30',
    lunch: '12:00',
    dinner: '18:30',
  },
  workoutReminderTime: '17:00',
  weeklyProgressReviewDay: 'monday',
  timezone: 'Asia/Ho_Chi_Minh',
  quietHoursStart: '21:30',
  quietHoursEnd: '07:00',
  maxDailyPerUser: 3,
  soundEnabled: true,
  badgeEnabled: true,
  updatedAt: new Date().toISOString(),
  updatedBy: 'Admin Aura',
}

export function normalizeSystemPushSettings(value?: Partial<SystemPushSettings> | null): SystemPushSettings {
  const source = value ?? {}
  return {
    ...DEFAULT_PUSH_SETTINGS,
    ...source,
    enabled: source.enabled !== false,
    automationEnabled: source.automationEnabled !== false,
    vapidPublicKey: typeof source.vapidPublicKey === 'string' ? source.vapidPublicKey.trim() : DEFAULT_PUSH_SETTINGS.vapidPublicKey,
    fcmSenderId: typeof source.fcmSenderId === 'string' ? source.fcmSenderId.trim() : DEFAULT_PUSH_SETTINGS.fcmSenderId,
    fcmProjectId: typeof source.fcmProjectId === 'string' ? source.fcmProjectId.trim() : DEFAULT_PUSH_SETTINGS.fcmProjectId,
    autoMealReminders: source.autoMealReminders !== false,
    mealReminderTimes: {
      breakfast: normalizeClock(source.mealReminderTimes?.breakfast, DEFAULT_PUSH_SETTINGS.mealReminderTimes.breakfast),
      lunch: normalizeClock(source.mealReminderTimes?.lunch, DEFAULT_PUSH_SETTINGS.mealReminderTimes.lunch),
      dinner: normalizeClock(source.mealReminderTimes?.dinner, DEFAULT_PUSH_SETTINGS.mealReminderTimes.dinner),
    },
    workoutReminderTime: normalizeClock(source.workoutReminderTime, DEFAULT_PUSH_SETTINGS.workoutReminderTime),
    weeklyProgressReviewDay: ['monday', 'friday', 'sunday'].includes(source.weeklyProgressReviewDay ?? '')
      ? source.weeklyProgressReviewDay!
      : DEFAULT_PUSH_SETTINGS.weeklyProgressReviewDay,
    timezone: typeof source.timezone === 'string' && source.timezone.trim() ? source.timezone.trim() : DEFAULT_PUSH_SETTINGS.timezone,
    quietHoursStart: normalizeClock(source.quietHoursStart, DEFAULT_PUSH_SETTINGS.quietHoursStart),
    quietHoursEnd: normalizeClock(source.quietHoursEnd, DEFAULT_PUSH_SETTINGS.quietHoursEnd),
    maxDailyPerUser: normalizePositiveInt(source.maxDailyPerUser, DEFAULT_PUSH_SETTINGS.maxDailyPerUser, 1, 8),
    soundEnabled: source.soundEnabled !== false,
    badgeEnabled: source.badgeEnabled !== false,
  }
}

/** Public FCM configuration only; safe for any authenticated member to read. */
export async function getPublicPushConfig() {
  const fallback = {
    vapidPublicKey: DEFAULT_PUSH_SETTINGS.vapidPublicKey,
    fcmSenderId: DEFAULT_PUSH_SETTINGS.fcmSenderId,
    fcmProjectId: DEFAULT_PUSH_SETTINGS.fcmProjectId,
  }
  if (!firestoreDb) return fallback
  try {
    const snapshot = await getDoc(doc(firestoreDb, 'system', 'push_public_config'))
    if (snapshot.exists()) {
      const value = snapshot.data()
      return {
        vapidPublicKey: typeof value.vapidPublicKey === 'string' ? value.vapidPublicKey.trim() : fallback.vapidPublicKey,
        fcmSenderId: typeof value.fcmSenderId === 'string' ? value.fcmSenderId.trim() : fallback.fcmSenderId,
        fcmProjectId: typeof value.fcmProjectId === 'string' ? value.fcmProjectId.trim() : fallback.fcmProjectId,
      }
    }
  } catch {
    // Students are not allowed to read the private system settings document;
    // the public config and build-time env remain the supported fallbacks.
  }
  return fallback
}

// Default Push Templates Tailored to Fitness Goals & Student Preference Categories
export const DEFAULT_PUSH_TEMPLATES: PushTemplate[] = [
  {
    id: 'tmpl_lose_fat_lunch',
    title: '🥗 Bữa trưa kiểm soát Calo (Giảm Mỡ)',
    message: 'Đã đến giờ ăn trưa rồi! Bạn có thể chụp ảnh bữa ăn để ước tính năng lượng, kiểm tra khẩu phần và trao đổi với HLV khi cần nhé.',
    type: 'REMINDER',
    category: 'nutrition',
    targetGoal: 'lose-fat',
    scheduledTime: '12:00',
    triggerLabel: 'Bữa trưa Calo Deficit',
    actionUrl: '/nutrition',
    active: true,
    createdAt: new Date().toISOString()
  },
  {
    id: 'tmpl_lose_fat_neat',
    title: '🏃 Nhắc nhở vận động NEAT ngày (Giảm Mỡ)',
    message: 'Hôm nay bạn đã đi được bao nhiêu bước chân? Hãy dành 15 phút đi dạo nhẹ nhàng để đốt thêm 100-150 kcal nhé!',
    type: 'MOTIVATION',
    category: 'workout',
    targetGoal: 'lose-fat',
    scheduledTime: '16:30',
    triggerLabel: 'Đốt Mỡ NEAT',
    actionUrl: '/progress',
    active: true,
    createdAt: new Date().toISOString()
  },
  {
    id: 'tmpl_gain_muscle_protein',
    title: '🥩 Nhắc nạp Đạm bữa phụ (Tăng Cơ)',
    message: 'Đã 3 tiếng kể từ bữa trước! Đừng quên nạp 25-30g Protein (Trứng, Whey, Ức gà) để nuôi dưỡng và phục hồi cơ bắp nhé.',
    type: 'REMINDER',
    category: 'nutrition',
    targetGoal: 'gain-muscle',
    scheduledTime: '15:30',
    triggerLabel: 'Bữa Phụ Đạm',
    actionUrl: '/nutrition',
    active: true,
    createdAt: new Date().toISOString()
  },
  {
    id: 'tmpl_gain_muscle_overload',
    title: '🏋️ Sẵn sàng Tăng Tải Cuốn Cuộn (Progressive Overload)',
    message: 'Hôm nay có lịch tập Kháng Lực! Kiểm tra giáo án trên ứng dụng và chuẩn bị tinh thần nâng thêm 1-2kg tạ hoặc tăng 1 rep nhé.',
    type: 'WORKOUT',
    category: 'workout',
    targetGoal: 'gain-muscle',
    scheduledTime: '17:00',
    triggerLabel: 'Trước Buổi Tập',
    actionUrl: '/workout',
    active: true,
    createdAt: new Date().toISOString()
  },
  {
    id: 'tmpl_maintain_balance',
    title: '🥑 Cân bằng Dinh Dưỡng Macro (Duy Trì Vóc Dáng)',
    message: 'Cập nhật nhật ký dinh dưỡng cân bằng Protein - Carb - Fat hôm nay để giữ vóc dáng luôn săn chắc và tràn đầy năng lượng!',
    type: 'REMINDER',
    category: 'nutrition',
    targetGoal: 'maintain',
    scheduledTime: '18:30',
    triggerLabel: 'Cân Bằng Dinh Dưỡng',
    actionUrl: '/nutrition',
    active: true,
    createdAt: new Date().toISOString()
  },
  {
    id: 'tmpl_health_stretch',
    title: '🧘 Giãn cơ & Giảm Stress (Sức Khỏe)',
    message: 'Dành 10 phút thả lỏng cột sống và giãn cơ vào buổi tối giúp giảm nồng độ Cortisol và nâng cao chất lượng giấc ngủ.',
    type: 'REMINDER',
    category: 'workout',
    targetGoal: 'health',
    scheduledTime: '20:30',
    triggerLabel: 'Thư Giãn Giãn Cơ',
    actionUrl: '/workout',
    active: true,
    createdAt: new Date().toISOString()
  },
  {
    id: 'tmpl_learning_streak',
    title: '🎓 Cập nhật bài học mới & duy trì Streak',
    message: 'Bạn chỉ còn 1 bài học ngắn nữa để duy trì chuỗi Streak hôm nay! Hãy dành 5 phút hoàn thành bài học nhé.',
    type: 'ANNOUNCEMENT',
    category: 'learning',
    targetGoal: 'all',
    scheduledTime: '20:00',
    triggerLabel: 'Giữ Streak Học Tập',
    actionUrl: '/academy',
    active: true,
    createdAt: new Date().toISOString()
  },
  {
    id: 'tmpl_coach_feedback',
    title: '💬 Nhận xét mới từ HLV & Trợ lý Aura AI',
    message: 'HLV đã vừa gửi nhận xét về thực đơn bữa ăn và tư thế tập luyện hôm nay của bạn. Hãy vào xem ngay nhé!',
    type: 'INFO',
    category: 'coach',
    targetGoal: 'all',
    scheduledTime: '19:00',
    triggerLabel: 'Phản Hồi HLV',
    actionUrl: '/coach',
    active: true,
    createdAt: new Date().toISOString()
  },
  {
    id: 'tmpl_all_progress_check',
    title: '📏 Cập nhật số đo & Cân nặng tuần mới',
    message: 'Đã đến ngày kiểm tra tiến độ! Cập nhật cân nặng buổi sáng để HLV và AI đánh giá chỉ số vóc dáng nhé.',
    type: 'REMINDER',
    category: 'general',
    targetGoal: 'all',
    scheduledTime: '08:00',
    triggerLabel: 'Check-in Tuần',
    actionUrl: '/progress',
    active: true,
    createdAt: new Date().toISOString()
  }
]

// Keys for local storage caching
const PUSH_SETTINGS_KEY = 'aura:system:push_settings:v1'
const PUSH_LOGS_KEY = 'aura:system:push_logs:v1'
const PUSH_TEMPLATES_KEY = 'aura:system:push_templates:v1'

export function subscribeToUserNotifications(
  userId: string,
  onData: (notifications: AppNotification[]) => void,
  onError?: (error: Error) => void
) {
  if (!firestoreDb) return () => {}

  const q = query(
    collection(firestoreDb, 'users', userId, 'notifications'),
    orderBy('createdAt', 'desc'),
    limit(50),
  )

  return onSnapshot(
    q,
    (snapshot) => {
      const items = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as AppNotification))
      onData(items)
    },
    (error) => {
      if (onError) onError(error)
    }
  )
}

export async function markNotificationAsRead(userId: string, notificationId: string) {
  if (!firestoreDb) return
  const ref = doc(firestoreDb, 'users', userId, 'notifications', notificationId)
  await updateDoc(ref, { read: true, updatedAt: serverTimestamp() })
}

export async function markAllNotificationsAsRead(userId: string) {
  if (!firestoreDb) return
  const q = query(
    collection(firestoreDb, 'users', userId, 'notifications'),
    where('read', '==', false)
  )
  const snap = await getDocs(q)
  if (snap.empty) return

  const batch = writeBatch(firestoreDb)
  snap.docs.forEach(d => {
    batch.update(d.ref, { read: true, updatedAt: serverTimestamp() })
  })
  await batch.commit()
}

export async function createNotification(userId: string, notification: Omit<AppNotification, 'id' | 'createdAt' | 'userId' | 'read'>) {
  if (!firestoreDb) return
  const dedupeId = notification.dedupeKey
    ? `auto_${notification.dedupeKey.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 120)}`
    : null
  const ref = dedupeId
    ? doc(firestoreDb, 'users', userId, 'notifications', dedupeId)
    : doc(collection(firestoreDb, 'users', userId, 'notifications'))
  const payload = {
    id: ref.id,
    userId,
    ...notification,
    read: false,
    createdAt: serverTimestamp(),
  }
  if (dedupeId) await setDoc(ref, payload, { merge: true })
  else await setDoc(ref, payload)

  // Try displaying native browser push notification if active in browser
  sendBrowserNativePushNotification(notification.title, notification.message, notification.actionUrl)
}

/**
 * Triggers a browser native Web Push Notification banner directly on the active device
 */
export function sendBrowserNativePushNotification(title: string, message: string, actionUrl?: string) {
  try {
    if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
      const notif = new Notification(title, {
        body: message,
        icon: '/icons/aura-icon-192.png',
        badge: '/icons/aura-icon-192.png',
        data: { url: actionUrl || '/' }
      })

      notif.onclick = (e) => {
        e.preventDefault()
        const nextHash = actionUrl?.startsWith('/#/')
          ? actionUrl.slice(1)
          : actionUrl?.startsWith('#/')
            ? actionUrl
            : `#${actionUrl?.startsWith('/') ? actionUrl : `/${actionUrl || 'home'}`}`
        window.location.hash = nextHash
        window.focus()
        notif.close()
      }
    }
  } catch (err) {
    console.warn('Browser Native Push Notification failed or restricted:', err)
  }
}

/**
 * Load System Push Settings from Firestore with LocalStorage fallback
 */
export async function getSystemPushSettings(options: { requireServer?: boolean } = {}): Promise<SystemPushSettings> {
  let fallback = DEFAULT_PUSH_SETTINGS
  try {
    const cached = typeof window !== 'undefined' ? window.localStorage.getItem(PUSH_SETTINGS_KEY) : null
    if (cached) fallback = normalizeSystemPushSettings(JSON.parse(cached))
  } catch {
    fallback = DEFAULT_PUSH_SETTINGS
  }

  if (!firestoreDb) {
    if (options.requireServer) throw new Error('Chưa thể xác nhận cấu hình Push từ máy chủ.')
    return fallback
  }

  try {
    const docRef = doc(firestoreDb, 'system', 'push_settings')
    const snap = options.requireServer ? await getDocFromServer(docRef) : await getDoc(docRef)
    if (snap.exists()) {
      const data = normalizeSystemPushSettings(snap.data() as Partial<SystemPushSettings>)
      safeLocalStorageSet(PUSH_SETTINGS_KEY, JSON.stringify(data))
      return data
    }
    if (options.requireServer) return normalizeSystemPushSettings(DEFAULT_PUSH_SETTINGS)
  } catch (e) {
    if (options.requireServer) throw e
    console.warn('Could not read push settings from Firestore, using cached/default:', e)
  }

  return fallback
}

/**
 * Save System Push Settings to Firestore & LocalStorage
 */
export async function saveSystemPushSettings(settings: SystemPushSettings): Promise<void> {
  const normalized = normalizeSystemPushSettings(settings)
  if (!firestoreDb) {
    safeLocalStorageSet(PUSH_SETTINGS_KEY, JSON.stringify(normalized))
    return
  }

  const docRef = doc(firestoreDb, 'system', 'push_settings')
  const publicConfigRef = doc(firestoreDb, 'system', 'push_public_config')
  const updatedAt = new Date().toISOString()
  const batch = writeBatch(firestoreDb)
  batch.set(docRef, {
    ...normalized,
    updatedAt,
  }, { merge: true })
  batch.set(publicConfigRef, {
    vapidPublicKey: normalized.vapidPublicKey,
    fcmSenderId: normalized.fcmSenderId,
    fcmProjectId: normalized.fcmProjectId,
    updatedAt,
  }, { merge: true })
  await batch.commit()
  safeLocalStorageSet(PUSH_SETTINGS_KEY, JSON.stringify(normalized))
}

/**
 * Dispatch an Admin Broadcast Notification to target users, respecting user notification category preferences
 */
export interface AdminPushBroadcastParams {
  requestId?: string
  title: string
  message: string
  type: AppNotification['type']
  category?: NotificationCategory
  targetType: 'all' | 'category' | 'individual'
  targetUserIds: string[]
  actionUrl?: string
  sentBy?: string
  sendBrowserPush?: boolean
  respectCategoryPreferences?: boolean
}

export async function dispatchAdminPushBroadcast(params: AdminPushBroadcastParams): Promise<PushDispatchResult> {
  const { 
    title, 
    message, 
    type, 
    category,
    targetType, 
    targetUserIds, 
    actionUrl, 
    sentBy = 'Admin Aura',
  } = params

  const demoMode = import.meta.env.VITE_FORCE_DEMO === 'true' || import.meta.env.MODE === 'e2e'
  if (firebaseFunctions && !demoMode) {
    const callable = httpsCallable<typeof params, PushDispatchResult>(firebaseFunctions, 'dispatchPushBroadcast', { timeout: 125_000 })
    const response = await callable(params)
    return {
      sentCount: response.data.sentCount,
      webPushSentCount: response.data.webPushSentCount,
      webPushFailureCount: response.data.webPushFailureCount,
      filteredOutCount: response.data.filteredOutCount,
      logId: response.data.logId,
      webPushUnknownCount: response.data.webPushUnknownCount,
      status: response.data.status,
      complete: response.data.complete,
      replayed: response.data.replayed,
      legacyDeduplicated: response.data.legacyDeduplicated,
      retryAfterMs: response.data.retryAfterMs,
    }
  }

  if (!demoMode) {
    throw Object.assign(new Error('Dịch vụ gửi thông báo chưa sẵn sàng. Chưa gửi thông báo nào; bản nháp vẫn được giữ. Hãy thử lại khi dịch vụ được khôi phục.'), { code: 'functions/failed-precondition' })
  }

  // Explicit demo only: simulate locally, without inbox, device or log writes
  // to Firestore even if a Firebase instance happens to be configured.
  const eligibleUserIds = [...new Set(targetUserIds)]
  const logId = 'demo_log_' + Date.now()
  const newLog: PushBroadcastLog = {
    id: logId, title, message, type, category, targetType,
    targetValue: targetType === 'individual' ? targetUserIds[0] : targetType,
    actionUrl, sentCount: eligibleUserIds.length, webPushSentCount: 0,
    webPushFailureCount: 0, filteredOutCount: 0, createdAt: new Date().toISOString(), sentBy,
  }
  try {
    const existingLogs: PushBroadcastLog[] = JSON.parse(localStorage.getItem(PUSH_LOGS_KEY) || '[]')
    safeLocalStorageSet(PUSH_LOGS_KEY, JSON.stringify([newLog, ...existingLogs].slice(0, 50)))
  } catch {
    // Local storage availability does not turn a demo into a production send.
  }
  return { sentCount: eligibleUserIds.length, webPushSentCount: 0, webPushFailureCount: 0, filteredOutCount: 0, logId }
}

/** Compatibility reader for callers that need only the newest bounded page. */
export async function getPushBroadcastLogs(): Promise<PushBroadcastLog[]> {
  return (await getPushBroadcastLogsPage()).items
}

/** Read the latest server-side scheduler runs for the admin health panel. */
export async function getPushAutomationLogs(): Promise<PushAutomationLog[]> {
  if (!firestoreDb) {
    if (import.meta.env.VITE_FORCE_DEMO === 'true' || import.meta.env.MODE === 'e2e') return []
    throw new Error('Dịch vụ lịch sử tự động hóa chưa sẵn sàng.')
  }
  const logsQuery = query(collection(firestoreDb, 'system', 'push_automation_logs', 'logs'), orderBy('createdAt', 'desc'), limit(10))
  const snapshot = await getDocsFromServer(logsQuery)
  return snapshot.docs.map((item) => ({ ...item.data(), id: item.id }) as PushAutomationLog)
}

/** Read privacy-safe delivery and audience aggregates from the privileged backend. */
export async function getPushAdminOverview(options: { forceRefresh?: boolean } = {}): Promise<PushAdminOverview> {
  const emptyOverview: PushAdminOverview = {
    activeUsers: 0,
    pushEnabledUsers: 0,
    activeDevices: 0,
    webPushAccepted24h: 0,
    webPushFailures24h: 0,
    latestAutomationAt: null,
    latestBroadcastAt: null,
  }
  if (!firebaseFunctions) {
    if (import.meta.env.VITE_FORCE_DEMO === 'true' || import.meta.env.MODE === 'e2e') return emptyOverview
    throw new Error('Dịch vụ tổng hợp Push chưa sẵn sàng.')
  }

  const callable = httpsCallable<{ forceRefresh?: boolean }, PushAdminOverview & { complete?: boolean; reason?: string }>(
    firebaseFunctions,
    'getPushAdminOverview',
  )
  const response = await callable(options.forceRefresh ? { forceRefresh: true } : {})
  const value = response.data
  if (value?.complete === false) {
    throw new Error(value.reason === 'scan-limit'
      ? 'Chưa thể tổng hợp đầy đủ dữ liệu Push vì vượt giới hạn xử lý. Các chỉ số chưa được xác nhận.'
      : 'Phản hồi tổng hợp Push chưa đầy đủ. Hãy thử tải lại.')
  }
  const fields = ['activeUsers', 'pushEnabledUsers', 'activeDevices', 'webPushAccepted24h', 'webPushFailures24h'] as const
  if (!value || fields.some(field => !Number.isFinite(value[field]) || value[field] < 0)) {
    throw new Error('Phản hồi tổng hợp Push chưa đầy đủ. Hãy thử tải lại.')
  }
  return {
    ...Object.fromEntries(fields.map(field => [field, value[field]])),
    latestAutomationAt: typeof value.latestAutomationAt === 'string' ? value.latestAutomationAt : null,
    latestBroadcastAt: typeof value.latestBroadcastAt === 'string' ? value.latestBroadcastAt : null,
    ...(typeof value.asOf === 'string' && Number.isFinite(Date.parse(value.asOf)) ? { asOf: value.asOf } : {}),
    ...(typeof value.windowStart === 'string' && Number.isFinite(Date.parse(value.windowStart)) ? { windowStart: value.windowStart } : {}),
  } as PushAdminOverview
}

/** Demo catalog stays local. Production never substitutes another account's cache. */
function demoPushTemplates(): PushTemplate[] {
  if (import.meta.env.VITE_FORCE_DEMO !== 'true' && import.meta.env.MODE !== 'e2e') {
    throw new Error('Dịch vụ mẫu thông báo chưa sẵn sàng.')
  }
  try {
    const cached = typeof localStorage === 'undefined' ? null : localStorage.getItem(PUSH_TEMPLATES_KEY)
    const items = cached ? JSON.parse(cached) : null
    return Array.isArray(items) ? items : DEFAULT_PUSH_TEMPLATES
  } catch { return DEFAULT_PUSH_TEMPLATES }
}

function pushTemplateId(value: string) {
  if (typeof value !== 'string' || !value.trim() || value.includes('/')) throw new Error('Mã mẫu thông báo không hợp lệ.')
  return value.trim()
}

/** An empty production collection is an authoritative empty catalog, never a seed command. */
export async function getPushTemplates(): Promise<PushTemplate[]> {
  if (!firestoreDb) return demoPushTemplates()
  const snapshot = await getDocsFromServer(collection(firestoreDb, 'system', 'push_templates', 'templates'))
  return snapshot.docs.map(item => ({ ...item.data(), id: item.id }) as PushTemplate)
}

export async function savePushTemplate(template: PushTemplate): Promise<void> {
  const id = pushTemplateId(template.id)
  const updated: PushTemplate = { ...template, id, updatedAt: new Date().toISOString() }
  if (firestoreDb) {
    await setDoc(doc(firestoreDb, 'system', 'push_templates', 'templates', id), updated, { merge: true })
    return
  }
  const existing = demoPushTemplates()
  const next = existing.some(item => item.id === id) ? existing.map(item => item.id === id ? updated : item) : [updated, ...existing]
  safeLocalStorageSet(PUSH_TEMPLATES_KEY, JSON.stringify(next))
}

export async function deletePushTemplate(templateId: string): Promise<void> {
  const id = pushTemplateId(templateId)
  if (firestoreDb) {
    await deleteDoc(doc(firestoreDb, 'system', 'push_templates', 'templates', id))
    return
  }
  safeLocalStorageSet(PUSH_TEMPLATES_KEY, JSON.stringify(demoPushTemplates().filter(item => item.id !== id)))
}

export async function togglePushTemplateActive(templateId: string, active: boolean): Promise<void> {
  const id = pushTemplateId(templateId)
  if (typeof active !== 'boolean') throw new Error('Trạng thái mẫu thông báo không hợp lệ.')
  if (firestoreDb) {
    // updateDoc rejects a missing record; never create a partial default template.
    await updateDoc(doc(firestoreDb, 'system', 'push_templates', 'templates', id), { active, updatedAt: new Date().toISOString() })
    return
  }
  const existing = demoPushTemplates()
  if (!existing.some(item => item.id === id)) throw new Error('Mẫu thông báo không còn tồn tại.')
  safeLocalStorageSet(PUSH_TEMPLATES_KEY, JSON.stringify(existing.map(item => item.id === id ? { ...item, active, updatedAt: new Date().toISOString() } : item)))
}
