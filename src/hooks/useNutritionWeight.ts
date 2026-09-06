import { useEffect, useState } from 'react'
import { readRecentAverageWeight, recentAverageWeight } from '../features/nutrition/dailyNutritionTargets'
import { collection, onSnapshot, query, where } from 'firebase/firestore'
import { firestoreDb } from '../lib/firebaseFirestore'

export function useNutritionWeight(ownerId: string, fallback: number, enabled = true) {
  const [state, setState] = useState({ ownerId, weight: readRecentAverageWeight(ownerId, fallback) })
  useEffect(() => {
    setState({ ownerId, weight: readRecentAverageWeight(ownerId, fallback) })
    if (!enabled || !ownerId || ['demo', 'anonymous'].includes(ownerId)) return
    if (!firestoreDb) return
    const day = new Date()
    const from = new Date(day.getFullYear(), day.getMonth(), day.getDate() - 30)
    const key = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
    const source = query(collection(firestoreDb, 'users', ownerId, 'weightLogs'), where('date', '>=', key(from)), where('date', '<=', key(day)))
    return onSnapshot(source, (snapshot) => setState({ ownerId, weight: recentAverageWeight(snapshot.docs.map((record) => record.data()), fallback) }), () => {
      // Keep this owner's known weight while offline; never replace it with another profile.
    })
  }, [ownerId, fallback, enabled])
  return state.ownerId === ownerId ? state.weight : fallback
}
