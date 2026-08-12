import { collection, doc, onSnapshot, orderBy, query, setDoc, updateDoc, deleteDoc, serverTimestamp, getDocs, writeBatch, where, getDoc } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { firebaseFunctions, firestoreDb } from '../lib/firebase'
import { safeLocalStorageSet } from '../lib/safeStorage'
import type { AppNotification, SystemPushSettings, PushBroadcastLog, PushTemplate, FitnessGoalTarget, NotificationCategory } from '../types'

// Default system push settings
export const DEFAULT_PUSH_SETTINGS: SystemPushSettings = {
  enabled: true,
  vapidPublicKey: 'BEl62iUYgUivxIkv69yViEuiBIa-569a91y39e...',
  fcmSenderId: '463780789992',
  fcmProjectId: 'ai-studio-aurafitnesse',
  autoMealReminders: true,
  mealReminderTimes: {
    breakfast: '07:30',
    lunch: '12:00',
    dinner: '18:30',
  },
  workoutReminderTime: '17:00',
  weeklyProgressReviewDay: 'monday',
  soundEnabled: true,
  badgeEnabled: true,
  updatedAt: new Date().toISOString(),
  updatedBy: 'Admin Aura',
}

// Default Push Templates Tailored to Fitness Goals & Student Preference Categories
export const DEFAULT_PUSH_TEMPLATES: PushTemplate[] = [
  {
    id: 'tmpl_lose_fat_lunch',
    title: '🥗 Bữa trưa kiểm soát Calo (Giảm Mỡ)',
    message: 'Đã đến giờ ăn trưa rồi! Bạn hãy chụp ảnh bữa ăn gửi cho HLV để tính toán lượng Calo chính xác, đảm bảo thâm hụt Calo tối ưu nhé.',
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
    orderBy('createdAt', 'desc')
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
  const ref = doc(collection(firestoreDb, 'users', userId, 'notifications'))
  await setDoc(ref, {
    id: ref.id,
    userId,
    ...notification,
    read: false,
    createdAt: serverTimestamp(),
  })

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
        if (actionUrl) {
          window.location.hash = actionUrl
        }
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
export async function getSystemPushSettings(): Promise<SystemPushSettings> {
  const cached = localStorage.getItem(PUSH_SETTINGS_KEY)
  let fallback: SystemPushSettings = cached ? JSON.parse(cached) : DEFAULT_PUSH_SETTINGS

  if (!firestoreDb) return fallback

  try {
    const docRef = doc(firestoreDb, 'system', 'push_settings')
    const snap = await getDoc(docRef)
    if (snap.exists()) {
      const data = snap.data() as SystemPushSettings
      safeLocalStorageSet(PUSH_SETTINGS_KEY, JSON.stringify(data))
      return data
    }
  } catch (e) {
    console.warn('Could not read push settings from Firestore, using cached/default:', e)
  }

  return fallback
}

/**
 * Save System Push Settings to Firestore & LocalStorage
 */
export async function saveSystemPushSettings(settings: SystemPushSettings): Promise<void> {
  safeLocalStorageSet(PUSH_SETTINGS_KEY, JSON.stringify(settings))

  if (!firestoreDb) return

  try {
    const docRef = doc(firestoreDb, 'system', 'push_settings')
    await setDoc(docRef, {
      ...settings,
      updatedAt: new Date().toISOString()
    }, { merge: true })
  } catch (e) {
    console.error('Error persisting system push settings to Firestore:', e)
  }
}

/**
 * Dispatch an Admin Broadcast Notification to target users, respecting user notification category preferences
 */
export async function dispatchAdminPushBroadcast(params: {
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
}): Promise<{ sentCount: number; filteredOutCount: number; logId: string }> {
  const { 
    title, 
    message, 
    type, 
    category,
    targetType, 
    targetUserIds, 
    actionUrl, 
    sentBy = 'Admin Aura', 
    sendBrowserPush = true,
    respectCategoryPreferences = true 
  } = params

  if (firebaseFunctions) {
    const callable = httpsCallable<typeof params, {
      sentCount: number
      webPushSentCount: number
      filteredOutCount: number
      logId: string
    }>(firebaseFunctions, 'dispatchPushBroadcast')
    const response = await callable(params)
    return {
      sentCount: response.data.sentCount,
      filteredOutCount: response.data.filteredOutCount,
      logId: response.data.logId,
    }
  }

  let sentCount = 0
  let filteredOutCount = 0
  const logId = `log_${Date.now()}`

  let userProfilesMap: Record<string, any> = {}
  let finalTargetUserIds = [...targetUserIds]

  // If targetType is 'all' or targetUserIds is empty, query all users from Firestore
  if (firestoreDb && (targetType === 'all' || finalTargetUserIds.length === 0)) {
    try {
      const usersSnap = await getDocs(collection(firestoreDb, 'users'))
      if (!usersSnap.empty) {
        usersSnap.docs.forEach(d => {
          userProfilesMap[d.id] = d.data()
        })
        const dbUids = Object.keys(userProfilesMap)
        if (dbUids.length > 0) {
          finalTargetUserIds = Array.from(new Set([...finalTargetUserIds, ...dbUids]))
        }
      }
    } catch (e) {
      console.warn('Could not fetch all users from Firestore for broadcast:', e)
    }
  }

  // Filter users based on their Profile "Danh mục thông báo muốn nhận" preferences
  const eligibleUserIds: string[] = []

  for (const uId of finalTargetUserIds) {
    const userData = userProfilesMap[uId]
    const settings = userData?.notificationSettings

    if (respectCategoryPreferences && settings) {
      // 1. Check master toggle
      if (settings.enabled === false) {
        filteredOutCount++
        continue
      }

      // 2. Check category specific toggle
      const isWorkout = category === 'workout' || type === 'WORKOUT'
      const isNutrition = category === 'nutrition' || (type === 'REMINDER' && category !== 'learning' && category !== 'coach' && category !== 'workout')
      const isLearning = category === 'learning' || ((type === 'ANNOUNCEMENT' || type === 'MOTIVATION') && category !== 'workout' && category !== 'nutrition' && category !== 'coach')
      const isCoach = category === 'coach' || ((type === 'PROMOTION' || type === 'INFO') && category !== 'workout' && category !== 'nutrition' && category !== 'learning')

      if (isWorkout && settings.workoutReminders === false) {
        filteredOutCount++
        continue
      }
      if (isNutrition && settings.mealReminders === false) {
        filteredOutCount++
        continue
      }
      if (isLearning && settings.learningUpdates === false) {
        filteredOutCount++
        continue
      }
      if (isCoach && settings.coachMessages === false) {
        filteredOutCount++
        continue
      }
    }

    eligibleUserIds.push(uId)
  }

  // Write notification for eligible users in Firestore
  if (firestoreDb && eligibleUserIds.length > 0) {
    // Process in batches of 400 (Firestore batch limit is 500)
    for (let i = 0; i < eligibleUserIds.length; i += 400) {
      const chunk = eligibleUserIds.slice(i, i + 400)
      const batch = writeBatch(firestoreDb)

      for (const uId of chunk) {
        const ref = doc(collection(firestoreDb, 'users', uId, 'notifications'))
        batch.set(ref, {
          id: ref.id,
          userId: uId,
          title,
          message,
          type,
          read: false,
          actionUrl: actionUrl || '/home',
          createdAt: serverTimestamp()
        })
        sentCount++
      }

      try {
        await batch.commit()
      } catch (err) {
        console.error('Error committing notification batch chunk to Firestore:', err)
      }
    }
  } else {
    // Fallback count for demo / local
    sentCount = eligibleUserIds.length > 0 ? eligibleUserIds.length : (finalTargetUserIds.length - filteredOutCount)
    if (sentCount < 0) sentCount = 0
  }

  // Also trigger local browser push notification if requested
  if (sendBrowserPush) {
    sendBrowserNativePushNotification(title, message, actionUrl)
  }

  // Create Broadcast Log entry
  const newLog: PushBroadcastLog = {
    id: logId,
    title,
    message,
    type,
    targetType,
    targetValue: targetType === 'individual' ? targetUserIds[0] : targetType,
    actionUrl,
    sentCount,
    webPushSentCount: sentCount,
    createdAt: new Date().toISOString(),
    sentBy
  }

  // Save log locally & in Firestore
  try {
    const existingLogsRaw = localStorage.getItem(PUSH_LOGS_KEY)
    const existingLogs: PushBroadcastLog[] = existingLogsRaw ? JSON.parse(existingLogsRaw) : []
    const updatedLogs = [newLog, ...existingLogs].slice(0, 50)
    safeLocalStorageSet(PUSH_LOGS_KEY, JSON.stringify(updatedLogs))

    if (firestoreDb) {
      const logRef = doc(firestoreDb, 'system', 'push_broadcast_logs', 'logs', logId)
      await setDoc(logRef, newLog)
    }
  } catch (err) {
    console.warn('Error saving broadcast log:', err)
  }

  return { sentCount, filteredOutCount, logId }
}

/**
 * Fetch Admin Broadcast Logs
 */
export async function getPushBroadcastLogs(): Promise<PushBroadcastLog[]> {
  const cached = localStorage.getItem(PUSH_LOGS_KEY)
  const fallback: PushBroadcastLog[] = cached ? JSON.parse(cached) : [
    {
      id: 'log_sample_1',
      title: 'Nhắc nhở nộp nhật ký bữa ăn trưa 🥗',
      message: 'Đã đến giờ ăn trưa rồi! Bạn hãy chụp ảnh bữa ăn gửi cho HLV nhé.',
      type: 'REMINDER',
      targetType: 'all',
      actionUrl: '/nutrition',
      sentCount: 24,
      webPushSentCount: 20,
      createdAt: new Date(Date.now() - 3600000 * 2).toISOString(),
      sentBy: 'Admin Aura'
    },
    {
      id: 'log_sample_2',
      title: 'Khóa học mới: Dinh Dưỡng Giảm Mỡ Chuẩn Y Khoa 🎓',
      message: 'Khóa học mới đã chính thức xuất bản trên Aura Academy. Vào học ngay!',
      type: 'ANNOUNCEMENT',
      targetType: 'all',
      actionUrl: '/courses',
      sentCount: 35,
      webPushSentCount: 31,
      createdAt: new Date(Date.now() - 86400000).toISOString(),
      sentBy: 'Admin Aura'
    }
  ]

  if (!firestoreDb) return fallback

  try {
    const q = query(collection(firestoreDb, 'system', 'push_broadcast_logs', 'logs'), orderBy('createdAt', 'desc'))
    const snap = await getDocs(q)
    if (!snap.empty) {
      const items = snap.docs.map(d => d.data() as PushBroadcastLog)
      safeLocalStorageSet(PUSH_LOGS_KEY, JSON.stringify(items))
      return items
    }
  } catch (e) {
    console.warn('Error fetching push broadcast logs from Firestore:', e)
  }

  return fallback
}

/**
 * Load Push Templates with Firestore & LocalStorage sync
 */
export async function getPushTemplates(): Promise<PushTemplate[]> {
  const cached = localStorage.getItem(PUSH_TEMPLATES_KEY)
  let fallback: PushTemplate[] = cached ? JSON.parse(cached) : DEFAULT_PUSH_TEMPLATES

  const db = firestoreDb
  if (!db) return fallback

  try {
    const colRef = collection(db, 'system', 'push_templates', 'templates')
    const snap = await getDocs(colRef)
    if (!snap.empty) {
      const items = snap.docs.map(d => d.data() as PushTemplate)
      safeLocalStorageSet(PUSH_TEMPLATES_KEY, JSON.stringify(items))
      return items
    } else {
      // Seed default templates to Firestore if empty
      const batch = writeBatch(db)
      DEFAULT_PUSH_TEMPLATES.forEach(tmpl => {
        const docRef = doc(db, 'system', 'push_templates', 'templates', tmpl.id)
        batch.set(docRef, tmpl)
      })
      await batch.commit().catch(e => console.warn('Seeding push templates failed:', e))
      safeLocalStorageSet(PUSH_TEMPLATES_KEY, JSON.stringify(DEFAULT_PUSH_TEMPLATES))
      return DEFAULT_PUSH_TEMPLATES
    }
  } catch (e) {
    console.warn('Error fetching push templates from Firestore:', e)
  }

  return fallback
}

/**
 * Save / Create / Edit a Push Template
 */
export async function savePushTemplate(template: PushTemplate): Promise<void> {
  const existing = await getPushTemplates()
  const idx = existing.findIndex(t => t.id === template.id)
  
  let updated: PushTemplate[]
  const updatedItem: PushTemplate = {
    ...template,
    updatedAt: new Date().toISOString()
  }

  if (idx >= 0) {
    updated = [...existing]
    updated[idx] = updatedItem
  } else {
    updated = [updatedItem, ...existing]
  }

  safeLocalStorageSet(PUSH_TEMPLATES_KEY, JSON.stringify(updated))

  if (firestoreDb) {
    try {
      const docRef = doc(firestoreDb, 'system', 'push_templates', 'templates', template.id)
      await setDoc(docRef, updatedItem, { merge: true })
    } catch (e) {
      console.error('Error saving push template to Firestore:', e)
    }
  }
}

/**
 * Delete a Push Template
 */
export async function deletePushTemplate(templateId: string): Promise<void> {
  const existing = await getPushTemplates()
  const updated = existing.filter(t => t.id !== templateId)

  safeLocalStorageSet(PUSH_TEMPLATES_KEY, JSON.stringify(updated))

  if (firestoreDb) {
    try {
      const docRef = doc(firestoreDb, 'system', 'push_templates', 'templates', templateId)
      await deleteDoc(docRef)
    } catch (e) {
      console.error('Error deleting push template from Firestore:', e)
    }
  }
}

/**
 * Toggle Active status of a Push Template
 */
export async function togglePushTemplateActive(templateId: string, active: boolean): Promise<void> {
  const existing = await getPushTemplates()
  const target = existing.find(t => t.id === templateId)
  if (target) {
    await savePushTemplate({ ...target, active })
  }
}

