import { connectStorageEmulator, getStorage, type FirebaseStorage } from 'firebase/storage'
import { firebaseApp, isFirebaseConfigured, useFirebaseEmulators } from './firebase'

export let firebaseStorage: FirebaseStorage | null = null

if (isFirebaseConfigured && firebaseApp) {
  firebaseStorage = getStorage(firebaseApp)
  if (useFirebaseEmulators) connectStorageEmulator(firebaseStorage, '127.0.0.1', 9199)
}
