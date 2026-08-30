import type { Messaging } from 'firebase/messaging'
import { firebaseApp } from './firebase'

let firebaseMessagingPromise: Promise<Messaging | null> | null = null

export function getFirebaseMessaging(): Promise<Messaging | null> {
  if (!firebaseApp || typeof window === 'undefined' || !('serviceWorker' in navigator)) {
    return Promise.resolve(null)
  }

  if (!firebaseMessagingPromise) {
    firebaseMessagingPromise = import('firebase/messaging')
      .then(async ({ getMessaging, isSupported }) => {
        if (!(await isSupported())) return null
        return getMessaging(firebaseApp!)
      })
      .catch((error) => {
        if (import.meta.env.DEV) console.warn('Firebase Messaging failed to initialize', error)
        return null
      })
  }

  return firebaseMessagingPromise
}
