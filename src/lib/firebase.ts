import { getApp, getApps, initializeApp, type FirebaseApp } from 'firebase/app'
import type { AppCheck } from 'firebase/app-check'
import { connectAuthEmulator, getAuth, type Auth } from 'firebase/auth'

export const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
}

const appCheckSiteKey = import.meta.env.VITE_FIREBASE_APP_CHECK_SITE_KEY?.trim() || ''

const forceDemoMode = import.meta.env.VITE_FORCE_DEMO === 'true'
  && (import.meta.env.DEV || import.meta.env.MODE === 'e2e')

export const isFirebaseConfigured = !forceDemoMode && Object.values(firebaseConfig).every(
  (value) => typeof value === 'string' && value.trim().length > 0,
)
export const useFirebaseEmulators =
  import.meta.env.DEV && import.meta.env.VITE_USE_FIREBASE_EMULATORS === 'true'

export let firebaseApp: FirebaseApp | null = null
export let firebaseAppCheck: AppCheck | null = null
export type FirebaseAppCheckStatus = 'disabled' | 'deferred' | 'initializing' | 'enabled' | 'missing_site_key' | 'initialization_error' | 'emulator'
export let firebaseAppCheckStatus: FirebaseAppCheckStatus = 'disabled'
export let firebaseAuth: Auth | null = null
let firebaseAppCheckPromise: Promise<AppCheck | null> | null = null

export function initializeFirebaseAppCheck(): Promise<AppCheck | null> {
  if (!firebaseApp || !appCheckSiteKey || useFirebaseEmulators) return Promise.resolve(null)
  if (firebaseAppCheck) return Promise.resolve(firebaseAppCheck)
  if (!firebaseAppCheckPromise) {
    firebaseAppCheckStatus = 'initializing'
    firebaseAppCheckPromise = import('firebase/app-check')
      .then(({ initializeAppCheck, ReCaptchaEnterpriseProvider }) => {
        firebaseAppCheck = initializeAppCheck(firebaseApp!, {
          provider: new ReCaptchaEnterpriseProvider(appCheckSiteKey),
          isTokenAutoRefreshEnabled: true,
        })
        firebaseAppCheckStatus = 'enabled'
        return firebaseAppCheck
      })
      .catch((error) => {
        firebaseAppCheckStatus = 'initialization_error'
        if (import.meta.env.DEV) console.warn('Firebase App Check failed to initialize', error)
        return null
      })
  }
  return firebaseAppCheckPromise
}

if (isFirebaseConfigured) {
  firebaseApp = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig)

  if (appCheckSiteKey && !useFirebaseEmulators) {
    // App Check loads reCAPTCHA Enterprise. Keep it out of the first-paint
    // path and initialize it only immediately before a protected AI request.
    firebaseAppCheckStatus = 'deferred'
  } else if (useFirebaseEmulators) {
    firebaseAppCheckStatus = 'emulator'
  } else {
    firebaseAppCheckStatus = 'missing_site_key'
  }

  firebaseAuth = getAuth(firebaseApp)
  
  if (useFirebaseEmulators) {
    connectAuthEmulator(firebaseAuth, 'http://127.0.0.1:9099', { disableWarnings: true })
  }
}

export { firebaseAuth as auth, firebaseApp as app }
