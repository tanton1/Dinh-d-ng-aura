import { httpsCallable } from 'firebase/functions'
import { firebaseAuth, firebaseFunctions, getFirebaseMessaging } from '../lib/firebase'
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

async function resolveVapidKey() {
  const buildKey = import.meta.env.VITE_FIREBASE_VAPID_KEY?.trim()
  if (isUsableVapidKey(buildKey)) return buildKey

  const publicConfig = await getPublicPushConfig()
  if (isUsableVapidKey(publicConfig.vapidPublicKey)) return publicConfig.vapidPublicKey.trim()

  throw new Error('Web Push chưa được cấu hình VAPID public key. Admin cần bổ sung key trong Cài đặt Push.')
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

  const vapidKey = await resolveVapidKey()
  const firebaseMessaging = await getFirebaseMessaging()
  if (!firebaseMessaging) return null

  const { getToken } = await import('firebase/messaging')
  const serviceWorkerRegistration = await navigator.serviceWorker.ready
  const currentToken = await getToken(firebaseMessaging, { vapidKey, serviceWorkerRegistration })
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
