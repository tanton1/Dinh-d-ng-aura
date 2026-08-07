import { getToken } from 'firebase/messaging'
import { firebaseMessaging, firestoreDb } from '../lib/firebase'
import { doc, updateDoc, arrayUnion } from 'firebase/firestore'

export async function requestFcmPermissionAndToken(userId: string) {
  if (!firebaseMessaging || !firestoreDb) return null
  
  try {
    const permission = await Notification.requestPermission()
    if (permission === 'granted') {
      // Get token (in a real app, you would provide vapidKey)
      const vapidKey = import.meta.env.VITE_FIREBASE_VAPID_KEY
      const currentToken = await getToken(firebaseMessaging, vapidKey ? { vapidKey } : undefined)
      if (currentToken) {
        // Save to firestore
        const userRef = doc(firestoreDb, 'users', userId)
        await updateDoc(userRef, {
          fcmTokens: arrayUnion(currentToken)
        })
        return currentToken
      }
    }
    return null
  } catch (error) {
    console.error('Error requesting FCM permission:', error)
    return null
  }
}
