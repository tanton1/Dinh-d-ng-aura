import { useEffect, useState } from 'react'

/** Rendering deadlines are local alarms, with no network work attached. */
export function useLocalTimeBoundaries(boundaries: number[]) {
  const [now, setNow] = useState(Date.now)
  const key = boundaries.filter(Number.isFinite).sort((left, right) => left - right).join(',')
  useEffect(() => {
    const current = Date.now()
    const next = key.split(',').map(Number).find((value) => value > current)
    const timer = next === undefined ? undefined : window.setTimeout(() => setNow(Date.now()), Math.min(next - current + 25, 2_147_483_647))
    const resume = () => { if (!document.hidden) setNow(Date.now()) }
    document.addEventListener('visibilitychange', resume)
    return () => { window.clearTimeout(timer); document.removeEventListener('visibilitychange', resume) }
  }, [key, now])
  return Math.max(now, Date.now())
}
