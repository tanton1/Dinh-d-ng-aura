import { useEffect, useState } from 'react'
import { readRecentAverageWeight, recentAverageWeight } from '../features/nutrition/dailyNutritionTargets'
import { subscribeToUserWeightLogs } from '../services/firebaseProgressService'

export function useNutritionWeight(ownerId: string, fallback: number, enabled = true) {
  const [state, setState] = useState({ ownerId, weight: readRecentAverageWeight(ownerId, fallback) })
  useEffect(() => {
    setState({ ownerId, weight: readRecentAverageWeight(ownerId, fallback) })
    if (!enabled || !ownerId || ['demo', 'anonymous'].includes(ownerId)) return
    return subscribeToUserWeightLogs(ownerId, (records) => setState({ ownerId, weight: recentAverageWeight(records, fallback) }))
  }, [ownerId, fallback, enabled])
  return state.ownerId === ownerId ? state.weight : fallback
}
