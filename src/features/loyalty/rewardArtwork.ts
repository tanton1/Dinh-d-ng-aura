const illustratedRewards = new Set([
  'assessment', 'voucher-50k', 'extra-reschedule', 'guest-pass', 'voucher-100k',
  'nutrition-consultation', 'aura-shaker', 'bonus-pt-session', 'aura-shirt',
  'freeze-seven-days', 'renewal-voucher-300k',
])

/** Catalog IDs stay stable when staff change reward names or denominations. */
export function rewardArtwork(id?: string) {
  if (!id || !illustratedRewards.has(id)) return undefined
  const base = `/images/aura-club/rewards-20261028/${id}`
  return { src: `${base}-480.webp`, srcSet: `${base}-480.webp 480w, ${base}-960.webp 960w` }
}
