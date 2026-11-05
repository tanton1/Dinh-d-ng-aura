import { useEffect, useRef, useState } from 'react'

const defaultFormat = (value: number) => Math.round(value).toLocaleString('vi-VN')

function prefersReducedMotion() {
  return typeof window === 'undefined' || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
}

// Eases a figure from its previous value (zero on first paint) to the new one,
// after React Bits' CountUp but without its motion dependency. Reduced motion
// shows the final value at once.
export default function CountUp({ value, format = defaultFormat, duration = 700 }: {
  value: number
  format?: (value: number) => string
  duration?: number
}) {
  const target = Number.isFinite(value) ? value : 0
  const [shown, setShown] = useState(() => prefersReducedMotion() ? target : 0)
  const shownRef = useRef(shown)

  useEffect(() => {
    if (prefersReducedMotion() || shownRef.current === target) {
      shownRef.current = target
      setShown(target)
      return
    }
    const origin = shownRef.current
    const startedAt = performance.now()
    let frame = 0
    const tick = (now: number) => {
      const progress = Math.min(1, (now - startedAt) / duration)
      const next = origin + (target - origin) * (1 - (1 - progress) ** 3)
      shownRef.current = progress === 1 ? target : next
      setShown(shownRef.current)
      if (progress < 1) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [duration, target])

  return <span className="aura-count-up">{format(shown)}</span>
}
