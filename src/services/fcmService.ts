import { httpsCallable } from 'firebase/functions'
import { firebaseAuth } from '../lib/firebase'
import { firebaseFunctions } from '../lib/firebaseFunctions'
import { getFirebaseMessaging } from '../lib/firebaseMessaging'
import { getPublicPushConfig } from './notificationService'

const TOKEN_STORAGE_PREFIX = 'aura:fcm-token:'

function tokenStorageKey(userId: string) {
  return `${TOKEN_STORAGE_PREFIX}${userId}`
}

function isUsableVapidKey(value: unknown): value is string {
  return typeof value === 'string'
    && value.trim().length >= 40
    && !value.includes('...')
}

async function resolveVapidKey(): Promise<string | undefined> {
  const buildKey = import.meta.env.VITE_FIREBASE_VAPID_KEY?.trim()
  if (isUsableVapidKey(buildKey)) return buildKey

  const publicConfig = await getPublicPushConfig()
  if (isUsableVapidKey(publicConfig.vapidPublicKey)) return publicConfig.vapidPublicKey.trim()

  // Firebase Messaging supports its default VAPID key when no custom key is
  // supplied. A custom key remains available as an optional production
  // hardening setting, but it must never block a user from enabling Push.
  return undefined
}

function friendlyPushError(error: unknown) {
  const code = typeof error === 'object' && error && 'code' in error
    ? String((error as { code?: unknown }).code ?? '')
    : ''

  if (code.includes('permission-blocked')) {
    return new Error('Trình duyệt đang chặn thông báo. Hãy cho phép Aura trong cài đặt của trình duyệt rồi thử lại.')
  }
  if (code.includes('failed-service-worker-registration')) {
    return new Error('Aura chưa thể khởi động dịch vụ thông báo. Hãy tải lại trang rồi thử lại.')
  }
  if (code.includes('token-subscribe-failed')) {
    return new Error('Chưa thể kết nối thiết bị với dịch vụ thông báo. Hãy kiểm tra mạng rồi thử lại.')
  }
  if (code.includes('functions/') || code.includes('unauthenticated')) {
    return new Error('Phiên đăng nhập đã hết hạn hoặc máy chủ chưa phản hồi. Hãy đăng nhập lại rồi thử tiếp.')
  }

  return error instanceof Error
    ? error
    : new Error('Chưa thể bật thông báo trên thiết bị này. Hãy thử lại sau.')
}

function saveStoredToken(userId: string, token: string | null) {
  if (typeof window === 'undefined') return
  try {
    if (token) window.localStorage.setItem(tokenStorageKey(userId), token)
    else window.localStorage.removeItem(tokenStorageKey(userId))
  } catch {
    // Storage is optional; the server registration remains authoritative.
  }
}

export function getStoredFcmToken(userId: string) {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage.getItem(tokenStorageKey(userId))
  } catch {
    return null
  }
}

export async function requestFcmPermissionAndToken(userId: string) {
  if (!firebaseFunctions || !firebaseAuth?.currentUser) return null
  if (firebaseAuth.currentUser.uid !== userId) throw new Error('Phiên đăng nhập không hợp lệ.')
  if (typeof window === 'undefined' || !('Notification' in window) || !('serviceWorker' in navigator)) return null

  const permission = Notification.permission === 'granted'
    ? 'granted'
    : await Notification.requestPermission()
  if (permission !== 'granted') return null

  try {
    const vapidKey = await resolveVapidKey()
    const firebaseMessaging = await getFirebaseMessaging()
    if (!firebaseMessaging) return null

    const { getToken } = await import('firebase/messaging')
    const serviceWorkerRegistration = await navigator.serviceWorker.ready
    const tokenOptions = vapidKey
      ? { vapidKey, serviceWorkerRegistration }
      : { serviceWorkerRegistration }
    const currentToken = await getToken(firebaseMessaging, tokenOptions)
    if (!currentToken) return null

    const registerToken = httpsCallable<{
      token: string
      platform: string
    }, { registered: boolean; deviceId: string }>(firebaseFunctions, 'registerFcmToken', { timeout: 15_000 })
    const response = await registerToken({ token: currentToken, platform: 'web' })
    if (!response.data.registered) return null

    saveStoredToken(userId, currentToken)
    window.dispatchEvent(new CustomEvent('aura:fcm-ready'))
    return currentToken
  } catch (error) {
    throw friendlyPushError(error)
  }
}

export async function unregisterFcmToken(userId: string, token = getStoredFcmToken(userId)) {
  if (!token) return true
  if (!firebaseFunctions || !firebaseAuth?.currentUser || firebaseAuth.currentUser.uid !== userId) return false

  const unregisterToken = httpsCallable<{ token: string }, { unregistered: boolean }>(firebaseFunctions, 'unregisterFcmToken', { timeout: 5_000 })
  await unregisterToken({ token })
  saveStoredToken(userId, null)
  return true
}

export interface ForegroundPushPayload {
  title: string
  message: string
  actionUrl?: string
  notificationId?: string
  category?: string
}

/** Subscribe without requesting permission. Permission must be granted by a user action first. */
export async function subscribeToForegroundPush(onPush: (payload: ForegroundPushPayload) => void) {
  if (typeof window === 'undefined' || !('Notification' in window) || !firebaseAuth?.currentUser || Notification.permission !== 'granted') return () => {}
  const firebaseMessaging = await getFirebaseMessaging()
  if (!firebaseMessaging) return () => {}

  const { onMessage } = await import('firebase/messaging')
  return onMessage(firebaseMessaging, (payload) => {
    const data = payload.data ?? {}
    const title = payload.notification?.title || data.title || 'Aura Fitness'
    const message = payload.notification?.body || data.message || data.body || 'Bạn có thông báo mới từ Aura.'
    onPush({
      title,
      message,
      actionUrl: data.actionUrl || data.url || '/home',
      notificationId: data.notificationId,
      category: data.category,
    })
  })
}
