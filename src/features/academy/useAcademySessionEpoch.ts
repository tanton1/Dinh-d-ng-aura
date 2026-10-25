import { useEffect, useRef, useState } from 'react'
import { onAuthStateChanged } from 'firebase/auth'
import { firebaseAuth } from '../../lib/firebase'

/** Clear private in-memory views on an actual session change, not the initial auth callback. */
export function useAcademySessionEpoch() {
  const owner = useRef(firebaseAuth?.currentUser ?? null)
  const [epoch, setEpoch] = useState(0)
  useEffect(() => firebaseAuth ? onAuthStateChanged(firebaseAuth, (next) => {
    if (owner.current !== next) { owner.current = next; setEpoch((value) => value + 1) }
  }) : undefined, [])
  return epoch
}
