import { rewardArtwork } from './rewardArtwork'

export interface RewardBanner {
  kind: 'gifts' | 'vouchers'
  title: string
  description: string
  action: string
  onClick: () => void
}

export default function RewardBanners({ items }: { items: RewardBanner[] }) {
  if (!items.length) return null
  return <section className="club-reward-banners" aria-label="Quà tặng và đổi quà">
    {items.map(item => <article className="club-reward-banner" key={item.kind}>
      <img {...rewardArtwork(item.kind === 'gifts' ? 'aura-shaker' : 'renewal-voucher-300k')} sizes="(max-width: 1100px) 50vw, 30vw" width="960" height="480" alt="" decoding="async" />
      <div><h2>{item.title}</h2>{item.description && <p>{item.description}</p>}<button type="button" onClick={item.onClick}>{item.action}</button></div>
    </article>)}
  </section>
}
