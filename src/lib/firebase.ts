import { getApp, getApps, initializeApp, type FirebaseApp } from 'firebase/app'
import { initializeAppCheck, ReCaptchaEnterpriseProvider, type AppCheck } from 'firebase/app-check'
import { connectAuthEmulator, getAuth, type Auth } from 'firebase/auth'
import {
  connectFirestoreEmulator,
  getFirestore,
  initializeFirestore,
  memoryLocalCache,
  persistentLocalCache,
  persistentMultipleTabManager,
  type Firestore,
} from 'firebase/firestore'
import { connectStorageEmulator, getStorage, type FirebaseStorage } from 'firebase/storage'
import { connectFunctionsEmulator, getFunctions, type Functions } from 'firebase/functions'
import type { Messaging } from 'firebase/messaging'

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
}

const firestoreDatabaseId = import.meta.env.VITE_FIREBASE_DATABASE_ID || '(default)'
const appCheckSiteKey = import.meta.env.VITE_FIREBASE_APP_CHECK_SITE_KEY?.trim() || ''
const persistentOfflineCacheEnabled = import.meta.env.VITE_ENABLE_OFFLINE_CACHE === 'true'

const forceDemoMode = import.meta.env.VITE_FORCE_DEMO === 'true'
  && (import.meta.env.DEV || import.meta.env.MODE === 'e2e')

export const isFirebaseConfigured = !forceDemoMode && Object.values(firebaseConfig).every(
  (value) => typeof value === 'string' && value.trim().length > 0,
)

export const useFirebaseEmulators =
  import.meta.env.DEV && import.meta.env.VITE_USE_FIREBASE_EMULATORS === 'true'

export let firebaseApp: FirebaseApp | null = null
export let firebaseAppCheck: AppCheck | null = null
export let firebaseAuth: Auth | null = null
export let firestoreDb: Firestore | null = null
export let firebaseStorage: FirebaseStorage | null = null
export let firebaseFunctions: Functions | null = null
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
        if (import.meta.env.DEV) {
          console.warn('Firebase Messaging failed to initialize', error)
        }
        return null
      })
  }

  return firebaseMessagingPromise
}

if (isFirebaseConfigured) {
  firebaseApp = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig)

  if (appCheckSiteKey && !useFirebaseEmulators) {
    firebaseAppCheck = initializeAppCheck(firebaseApp, {
      provider: new ReCaptchaEnterpriseProvider(appCheckSiteKey),
      isTokenAutoRefreshEnabled: true,
    })
  }

  firebaseAuth = getAuth(firebaseApp)

  try {
    firestoreDb = initializeFirestore(
      firebaseApp,
      { 
        localCache: persistentOfflineCacheEnabled
          ? persistentLocalCache({ tabManager: persistentMultipleTabManager() })
          : memoryLocalCache(),
      },
      firestoreDatabaseId,
    )
  } catch {
    firestoreDb = getFirestore(firebaseApp, firestoreDatabaseId)
  }

  firebaseStorage = getStorage(firebaseApp)
  firebaseFunctions = getFunctions(firebaseApp, 'asia-southeast1')
  
  if (useFirebaseEmulators) {
    connectAuthEmulator(firebaseAuth, 'http://127.0.0.1:9099', { disableWarnings: true })
    connectFirestoreEmulator(firestoreDb, '127.0.0.1', 8080)
    connectStorageEmulator(firebaseStorage, '127.0.0.1', 9199)
    connectFunctionsEmulator(firebaseFunctions, '127.0.0.1', 5001)
  }
}
