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
      <img src={`/images/aura-club/rewards-${item.kind}-480.webp`} srcSet={`/images/aura-club/rewards-${item.kind}-480.webp 480w, /images/aura-club/rewards-${item.kind}-960.webp 960w`} sizes="(max-width: 700px) 45vw, (max-width: 1100px) 30vw, 320px" width="960" height="640" alt="" decoding="async" />
      <div><h2>{item.title}</h2><p>{item.description}</p><button type="button" onClick={item.onClick}>{item.action}</button></div>
    </article>)}
  </section>
}
