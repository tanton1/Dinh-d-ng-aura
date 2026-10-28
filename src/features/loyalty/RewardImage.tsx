import { useState } from 'react'
import { Gift } from 'lucide-react'
import './reward-media.css'

export default function RewardImage({ src, name }: { src?: string; name: string }) {
  const [failed, setFailed] = useState('')
  return <div className="club-gift-image">
    {src && failed !== src ? <img src={src} alt={name} loading="lazy" decoding="async" onError={() => setFailed(src)} /> : <Gift size={32} aria-hidden="true" />}
  </div>
}
