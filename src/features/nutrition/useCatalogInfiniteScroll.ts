import { useEffect, useRef } from 'react'

/** One page at a time, triggered by downward browsing rather than a render loop. */
export function useCatalogInfiniteScroll({ scope, active, enabled, cursor, loading, loadMore }: {
  scope: string; active: boolean; enabled: boolean; cursor: string | null; loading: boolean; loadMore: () => Promise<void>
}) {
  const end = useRef<HTMLDivElement>(null)
  const current = useRef({ enabled, cursor, loading, loadMore })
  current.current = { enabled, cursor, loading, loadMore }
  useEffect(() => {
    if (!active) return
    let armed = false
    let inFlight = false
    let lastAttempt: string | null = null
    let wasAway = false
    let touchY = 0
    let frame = 0
    const hasObserver = typeof IntersectionObserver === 'function'
    const check = () => {
      frame = 0
      const state = current.current
      const target = end.current
      if (!armed || inFlight || !state.enabled || state.loading || !state.cursor || state.cursor === lastAttempt || document.visibilityState !== 'visible' || !target) return
      const bounds = target.getBoundingClientRect()
      if (!bounds.height || bounds.top > window.innerHeight + 180 || bounds.bottom < 0) return
      armed = false
      inFlight = true
      lastAttempt = state.cursor
      void state.loadMore().finally(() => { inFlight = false })
    }
    const arm = () => {
      if (!current.current.enabled || current.current.loading || inFlight) return
      armed = true
      if (!frame) frame = requestAnimationFrame(check)
    }
    const scroll = () => {
      if (!hasObserver && end.current) {
        const bounds = end.current.getBoundingClientRect()
        const near = bounds.top <= window.innerHeight + 180 && bounds.bottom >= 0
        if (!near) wasAway = true
        else if (wasAway) { wasAway = false; arm() }
      }
      if (armed && !frame) frame = requestAnimationFrame(check)
    }
    const inCatalog = (target: EventTarget | null) => target instanceof Node && end.current?.parentElement?.contains(target)
    const wheel = (event: WheelEvent) => { if (event.deltaY > 0 && inCatalog(event.target)) arm() }
    const touchStart = (event: TouchEvent) => { touchY = event.touches[0]?.clientY ?? 0 }
    const touchMove = (event: TouchEvent) => {
      const nextY = event.touches[0]?.clientY ?? touchY
      if (touchY - nextY > 8 && inCatalog(event.target)) arm()
      touchY = nextY
    }
    const key = (event: KeyboardEvent) => {
      if (!(event.target instanceof Element) || event.target.closest('input, textarea, select, button, a, [contenteditable="true"]')) return
      if (['ArrowDown', 'PageDown', 'End', ' '].includes(event.key) && (event.target === document.body || inCatalog(event.target))) arm()
    }
    const observer = hasObserver ? new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting) wasAway = true
        else {
          if (wasAway) { wasAway = false; arm() }
          check()
        }
      }
    }, { rootMargin: '180px 0px' }) : null
    if (end.current) observer?.observe(end.current)
    window.addEventListener('scroll', scroll, { passive: true })
    window.addEventListener('wheel', wheel, { passive: true })
    window.addEventListener('touchstart', touchStart, { passive: true })
    window.addEventListener('touchmove', touchMove, { passive: true })
    window.addEventListener('keydown', key)
    return () => {
      observer?.disconnect()
      cancelAnimationFrame(frame)
      window.removeEventListener('scroll', scroll)
      window.removeEventListener('wheel', wheel)
      window.removeEventListener('touchstart', touchStart)
      window.removeEventListener('touchmove', touchMove)
      window.removeEventListener('keydown', key)
    }
  }, [scope, active])
  return end
}
