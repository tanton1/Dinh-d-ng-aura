import { useState } from 'react'
import { Gift } from 'lucide-react'
import { rewardArtwork } from './rewardArtwork'
import './reward-media.css'

export default function RewardImage({ src, name, rewardId }: { src?: string; name: string; rewardId?: string }) {
  const [failed, setFailed] = useState<string[]>([])
  const artwork = rewardArtwork(rewardId)
  const custom = src && !failed.includes(src) ? src : undefined
  const image = custom || (artwork && !failed.includes(artwork.src) ? artwork.src : undefined)
  return <div className="club-gift-image">
    {image ? <img src={image} srcSet={custom ? undefined : artwork?.srcSet} sizes="(max-width: 767px) 50vw, (max-width: 1100px) 33vw, 25vw" width="960" height="480" alt={name} loading="lazy" decoding="async" onError={() => setFailed(previous => [...previous, image])} /> : <Gift size={32} aria-hidden="true" />}
  </div>
}
