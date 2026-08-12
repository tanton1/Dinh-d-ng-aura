import { httpsCallable } from 'firebase/functions'
import { firebaseAuth, firebaseFunctions, getFirebaseMessaging } from '../lib/firebase'

export async function requestFcmPermissionAndToken(userId: string) {
  if (!firebaseFunctions || !firebaseAuth?.currentUser) return null
  if (firebaseAuth.currentUser.uid !== userId) throw new Error('Phiên đăng nhập không hợp lệ.')
  if (!('Notification' in window) || !('serviceWorker' in navigator)) return null

  try {
    const permission = await Notification.requestPermission()
    if (permission !== 'granted') return null

    const vapidKey = import.meta.env.VITE_FIREBASE_VAPID_KEY?.trim()
    if (!vapidKey) throw new Error('VAPID public key chưa được cấu hình.')
    const firebaseMessaging = await getFirebaseMessaging()
    if (!firebaseMessaging) return null

    const { getToken } = await import('firebase/messaging')
    const serviceWorkerRegistration = await navigator.serviceWorker.ready
    const currentToken = await getToken(firebaseMessaging, { vapidKey, serviceWorkerRegistration })
    if (!currentToken) return null

    const registerToken = httpsCallable<{
      token: string
      platform: string
    }, { registered: boolean; deviceId: string }>(firebaseFunctions, 'registerFcmToken')
    const response = await registerToken({ token: currentToken, platform: 'web' })
    return response.data.registered ? currentToken : null
  } catch (error) {
    console.error('FCM token registration failed', {
      code: typeof error === 'object' && error && 'code' in error
        ? String((error as { code?: unknown }).code ?? 'unknown')
        : 'unknown',
    })
    return null
  }
}
