import { useEffect } from 'react'
export function useNutritionWeight(owner: string, fallback: number, enabled = true) {
  useEffect(() => {
    if (!enabled) return
    const item = { kind: 'weight', owner, stopped: false }
    ;(window as any).nutritionFixture.listeners.push(item)
    return () => { item.stopped = true }
  }, [owner, enabled])
  return fallback
}
