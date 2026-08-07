import { collection, doc, onSnapshot, orderBy, query, setDoc, updateDoc, serverTimestamp, getDocs, writeBatch, where, getDoc } from 'firebase/firestore'
import { firestoreDb } from '../lib/firebase'
import type { AppNotification, SystemPushSettings, PushBroadcastLog } from '../types'

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

// Key for local storage caching
const PUSH_SETTINGS_KEY = 'aura:system:push_settings:v1'
const PUSH_LOGS_KEY = 'aura:system:push_logs:v1'

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
        icon: '/icons/icon-192x192.png',
        badge: '/icons/icon-192x192.png',
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
      localStorage.setItem(PUSH_SETTINGS_KEY, JSON.stringify(data))
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
  localStorage.setItem(PUSH_SETTINGS_KEY, JSON.stringify(settings))

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
 * Dispatch an Admin Broadcast Notification to target users
 */
export async function dispatchAdminPushBroadcast(params: {
  title: string
  message: string
  type: AppNotification['type']
  targetType: 'all' | 'category' | 'individual'
  targetUserIds: string[]
  actionUrl?: string
  sentBy?: string
  sendBrowserPush?: boolean
}): Promise<{ sentCount: number; logId: string }> {
  const { title, message, type, targetType, targetUserIds, actionUrl, sentBy = 'Admin Aura', sendBrowserPush = true } = params

  let sentCount = 0
  const logId = `log_${Date.now()}`

  let finalTargetUserIds = [...targetUserIds]

  // If targetType is 'all' or targetUserIds is empty, query all users from Firestore
  if (firestoreDb && (targetType === 'all' || finalTargetUserIds.length === 0)) {
    try {
      const usersSnap = await getDocs(collection(firestoreDb, 'users'))
      if (!usersSnap.empty) {
        const dbUids = usersSnap.docs.map(d => d.id)
        if (dbUids.length > 0) {
          finalTargetUserIds = Array.from(new Set([...finalTargetUserIds, ...dbUids]))
        }
      }
    } catch (e) {
      console.warn('Could not fetch all users from Firestore for broadcast:', e)
    }
  }

  // Write notification for each target user in Firestore
  if (firestoreDb && finalTargetUserIds.length > 0) {
    // Process in batches of 400 (Firestore batch limit is 500)
    for (let i = 0; i < finalTargetUserIds.length; i += 400) {
      const chunk = finalTargetUserIds.slice(i, i + 400)
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
    // Demo fallback count
    sentCount = finalTargetUserIds.length > 0 ? finalTargetUserIds.length : 1
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
    localStorage.setItem(PUSH_LOGS_KEY, JSON.stringify(updatedLogs))

    if (firestoreDb) {
      const logRef = doc(firestoreDb, 'system', 'push_broadcast_logs', 'logs', logId)
      await setDoc(logRef, newLog)
    }
  } catch (err) {
    console.warn('Error saving broadcast log:', err)
  }

  return { sentCount, logId }
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
      localStorage.setItem(PUSH_LOGS_KEY, JSON.stringify(items))
      return items
    }
  } catch (e) {
    console.warn('Error fetching push broadcast logs from Firestore:', e)
  }

  return fallback
}
