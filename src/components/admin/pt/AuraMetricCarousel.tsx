import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import '../../../styles-aura-metric-carousel.css'

export interface AuraMetricSlide {
  id: string
  eyebrow: string
  value: string
  detail: string
  icon: ReactNode
  tone: 'pink' | 'orange' | 'sunset' | 'ink'
  actionLabel?: string
  onSelect?: () => void
}

interface Props {
  slides: AuraMetricSlide[]
  label: string
  loading?: boolean
}

export default function AuraMetricCarousel({ slides, label, loading = false }: Props) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const frameRef = useRef<number | null>(null)
  const [activeIndex, setActiveIndex] = useState(0)

  const updateActiveSlide = useCallback(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    const center = viewport.scrollLeft + viewport.clientWidth / 2
    const cards = Array.from(viewport.children) as HTMLElement[]
    let nearestIndex = 0
    let nearestDistance = Number.POSITIVE_INFINITY
    cards.forEach((card, index) => {
      const cardCenter = card.offsetLeft + card.offsetWidth / 2
      const distance = Math.abs(cardCenter - center)
      if (distance < nearestDistance) {
        nearestDistance = distance
        nearestIndex = index
      }
    })
    setActiveIndex(nearestIndex)
  }, [])

  const handleScroll = useCallback(() => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)
    frameRef.current = requestAnimationFrame(updateActiveSlide)
  }, [updateActiveSlide])

  const goToSlide = (index: number) => {
    const viewport = viewportRef.current
    const card = viewport?.children.item(index) as HTMLElement | null
    card?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' })
    setActiveIndex(index)
  }

  useEffect(() => () => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)
  }, [])

  useEffect(() => {
    if (activeIndex >= slides.length) setActiveIndex(Math.max(0, slides.length - 1))
  }, [activeIndex, slides.length])

  return <section className="aura-metric-carousel" aria-label={label} aria-roledescription="carousel">
    <div ref={viewportRef} className="aura-metric-carousel__viewport" onScroll={handleScroll}>
      {slides.map((slide, index) => {
        const content = <>
          <div className="aura-metric-carousel__topline">
            <span className="aura-metric-carousel__icon">{slide.icon}</span>
            <span className="aura-metric-carousel__number">0{index + 1}</span>
          </div>
          <span className="aura-metric-carousel__eyebrow">{slide.eyebrow}</span>
          <strong className={loading ? 'is-loading' : ''}>{loading ? 'Đang tải…' : slide.value}</strong>
          <small>{slide.detail}</small>
          {slide.actionLabel && <span className="aura-metric-carousel__action">{slide.actionLabel} <b aria-hidden="true">→</b></span>}
        </>
        const className = `aura-metric-carousel__slide aura-metric-carousel__slide--${slide.tone}`
        return slide.onSelect
          ? <button key={slide.id} type="button" className={className} onClick={slide.onSelect} aria-roledescription="slide" aria-label={`${slide.eyebrow}: ${slide.value}`}>{content}</button>
          : <article key={slide.id} className={className} aria-roledescription="slide" aria-label={`${slide.eyebrow}: ${slide.value}`}>{content}</article>
      })}
    </div>
    {slides.length > 1 && <div className="aura-metric-carousel__dots" aria-label="Chọn thẻ tổng quan">
      {slides.map((slide, index) => <button key={slide.id} type="button" className={activeIndex === index ? 'is-active' : ''} aria-label={`Xem thẻ ${index + 1}: ${slide.eyebrow}`} aria-current={activeIndex === index ? 'true' : undefined} onClick={() => goToSlide(index)} />)}
    </div>}
  </section>
}
