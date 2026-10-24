import { useEffect, useState } from 'react'
import { localNutritionDate } from './readLifecycle'

/** Refresh on resume as well as midnight; a background tab may throttle timers. */
export function useNutritionDate() {
  const [today, setToday] = useState(localNutritionDate)
  useEffect(() => {
    const refresh = () => setToday(localNutritionDate())
    const timer = window.setInterval(refresh, 30_000)
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [])
  return today
}
