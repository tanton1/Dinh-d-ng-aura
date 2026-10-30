import { onAuthStateChanged } from 'firebase/auth'
import { firebaseAuth } from '../../lib/firebase'

export const subscribeClubSession = (notify: () => void) => firebaseAuth
  ? onAuthStateChanged(firebaseAuth, notify)
  : () => {}
export const getClubSession = () => firebaseAuth?.currentUser ?? null
