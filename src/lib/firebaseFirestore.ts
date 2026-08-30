import {
  connectFirestoreEmulator,
  getFirestore,
  initializeFirestore,
  memoryLocalCache,
  persistentLocalCache,
  persistentMultipleTabManager,
  type Firestore,
} from 'firebase/firestore'
import { firebaseApp, isFirebaseConfigured, useFirebaseEmulators } from './firebase'

const firestoreDatabaseId = import.meta.env.VITE_FIREBASE_DATABASE_ID || '(default)'
const persistentOfflineCacheEnabled = import.meta.env.VITE_ENABLE_OFFLINE_CACHE === 'true'

export let firestoreDb: Firestore | null = null

if (isFirebaseConfigured && firebaseApp) {
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

  if (useFirebaseEmulators) connectFirestoreEmulator(firestoreDb, '127.0.0.1', 8080)
}

export { firestoreDb as db }
