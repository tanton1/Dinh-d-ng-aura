import { useEffect, useRef, useState, type ReactNode } from 'react'
import { mealPhotoUrl } from '../../services/firebaseNutritionLogService'

export function useMealImage(image?: string, storagePath?: string, enabled = true) {
  const [resolved, setResolved] = useState({ path: '', url: '' })
  useEffect(() => {
    if (!enabled || !storagePath) return
    let active = true
    void mealPhotoUrl(storagePath).then((url) => {
      if (active) setResolved({ path: storagePath, url })
    }).catch(() => { if (active) setResolved({ path: storagePath, url: '' }) })
    return () => { active = false }
  }, [enabled, storagePath])
  return (resolved.path === storagePath ? resolved.url : '') || image || ''
}

/** Metadata and totals never wait for Storage. Only visible meal rows request URLs. */
export default function MealImage({ image, storagePath, alt = '', fallback }: {
  image?: string; storagePath?: string; alt?: string; fallback?: ReactNode
}) {
  const anchor = useRef<HTMLSpanElement>(null)
  const [visible, setVisible] = useState(false)
  const url = useMealImage(image, storagePath, visible)
  useEffect(() => {
    const element = anchor.current
    if (!element) return
    if (typeof IntersectionObserver === 'undefined') { setVisible(true); return }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) { setVisible(true); observer.disconnect() }
    }, { rootMargin: '160px' })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  return <span ref={anchor} style={{ display: 'block', width: '100%', height: '100%' }}>
    {url ? <img src={url} alt={alt} loading="lazy" decoding="async" /> : fallback}
  </span>
}
