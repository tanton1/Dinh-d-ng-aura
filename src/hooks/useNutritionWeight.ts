import { useEffect, useState } from 'react'
import { readRecentAverageWeight, recentAverageWeight } from '../features/nutrition/dailyNutritionTargets'
import { collection, onSnapshot, query, where } from 'firebase/firestore'
import { firestoreDb } from '../lib/firebaseFirestore'
import { createSharedNutritionSubscriptions, nutritionDateAfter } from '../features/nutrition/readLifecycle'
import { useNutritionDate } from '../features/nutrition/useNutritionDate'

const sharedWeights = createSharedNutritionSubscriptions<Record<string, unknown>[]>()

export function useNutritionWeight(ownerId: string, fallback: number, enabled = true) {
  const today = useNutritionDate()
  const [state, setState] = useState({ ownerId, weight: readRecentAverageWeight(ownerId, fallback) })
  useEffect(() => {
    setState({ ownerId, weight: readRecentAverageWeight(ownerId, fallback) })
    if (!enabled || !ownerId || ['demo', 'anonymous'].includes(ownerId)) return
    if (!firestoreDb) return
    const source = query(collection(firestoreDb, 'users', ownerId, 'weightLogs'), where('date', '>=', nutritionDateAfter(today, -30)), where('date', '<=', today))
    return sharedWeights(`${ownerId}:${today}`, (emit) => onSnapshot(source, (snapshot) => emit(snapshot.docs.map((record) => record.data())), () => {
      // Keep this owner's known weight while offline; never replace it with another profile.
    }), (items) => setState({ ownerId, weight: recentAverageWeight(items, fallback) }))
  }, [ownerId, fallback, enabled, today])
  return state.ownerId === ownerId ? state.weight : fallback
}
