import { useEffect, useRef, useState } from 'react'
import type { IngredientArtworkSource } from '../features/nutrition/ingredientArtwork'
import './IngredientArtwork.css'

export default function IngredientArtwork({ artwork, name, eager = false }: {
  artwork: IngredientArtworkSource; name: string; eager?: boolean
}) {
  const frame = useRef<HTMLSpanElement>(null)
  const [visible, setVisible] = useState(eager)
  const [failed, setFailed] = useState(false)
  useEffect(() => { setFailed(false) }, [artwork.src])
  useEffect(() => {
    if (visible) return
    if (!('IntersectionObserver' in window)) { setVisible(true); return }
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) {
        setVisible(true)
        observer.disconnect()
      }
    }, { rootMargin: '180px' })
    if (frame.current) observer.observe(frame.current)
    return () => observer.disconnect()
  }, [visible])
  const tile = artwork.tile ?? 0
  const row = Math.floor(tile / artwork.grid)
  const column = tile % artwork.grid
  return (
    <span ref={frame} className="ingredient-artwork" role="img" aria-label={failed ? `Chưa tải được ảnh ${name}` : `Ảnh minh hoạ ${name}`}>
      <span className="ingredient-artwork__crop">
        {visible && !failed && <img src={artwork.src} alt="" decoding="async" referrerPolicy="no-referrer"
          style={{ width: `${artwork.grid * 100}%`, height: `${artwork.grid * 100}%`, left: `${-column * 100}%`, top: `${-row * 100}%` }}
          onError={() => setFailed(true)} />}
        {failed && <span className="ingredient-artwork__error">Chưa tải được ảnh</span>}
      </span>
    </span>
  )
}
