import { ArrowUpRight, Dumbbell, Leaf, UsersRound } from 'lucide-react'
import type { LoyaltyDashboard, LoyaltyPolicyConfig } from './types'

// Lightweight vector banners: crisp at every viewport, no remote image request
// and no text baked into images. Published settings, not unsaved toggles, own
// the status badges and reward amounts.
export default function LoyaltyProgramBanners({ features, policy }: {
  features: LoyaltyDashboard['features']; policy: LoyaltyPolicyConfig
}) {
  const openSettings = () => {
    const section = document.getElementById('club-policy') as HTMLDetailsElement | null
    if (!section) return
    section.open = true
    section.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' })
    section.querySelector('summary')?.focus({ preventScroll: true })
  }
  return <section className="club-programs" aria-label="Chương trình Aura Club">
    <article className="club-program club-program--movement">
      <div className="club-program__art club-program__art--movement" aria-hidden="true"><i /><i /><Dumbbell /></div>
      <div className="club-program__content"><span className="club-program__category">Tập luyện</span><h2>Mỗi buổi tập,<br />một bước tiến.</h2><p>Tích điểm từ buổi tập hợp lệ và các cột mốc chuyên cần.</p><footer><span className={`club-program__status ${features.earn ? 'is-on' : ''}`}>{features.earn ? 'Đang triển khai' : 'Tạm dừng'}</span><button type="button" onClick={openSettings} aria-label="Cài đặt chương trình tập luyện"><ArrowUpRight /></button></footer></div>
    </article>
    <article className="club-program club-program--nutrition">
      <div className="club-program__art club-program__art--nutrition" aria-hidden="true"><i /><i /><Leaf /></div>
      <div className="club-program__content"><span className="club-program__category">Dinh dưỡng</span><h2>Ăn tốt hơn.<br />Tích điểm mỗi ngày.</h2><p>Tối đa {policy.nutritionMonthlyCap.toLocaleString('vi-VN')} điểm/tháng từ nhật ký đã xác minh.</p><footer><span className={`club-program__status ${features.earn && features.nutrition ? 'is-on' : ''}`}>{features.earn && features.nutrition ? 'Đang triển khai' : 'Tạm dừng'}</span><button type="button" onClick={openSettings} aria-label="Cài đặt chương trình dinh dưỡng"><ArrowUpRight /></button></footer></div>
    </article>
    <article className="club-program club-program--friends">
      <div className="club-program__art club-program__art--friends" aria-hidden="true"><i /><i /><UsersRound /></div>
      <div className="club-program__content"><span className="club-program__category">Cộng đồng</span><h2>Cùng bạn bè,<br />cùng khỏe đẹp.</h2><p>Giới thiệu bạn đến Aura và nhận quyền lợi khi đủ điều kiện.</p><footer><span className={`club-program__status ${features.earn && features.referral ? 'is-on' : ''}`}>{features.earn && features.referral ? 'Đang triển khai' : 'Chưa triển khai'}</span><button type="button" onClick={openSettings} aria-label="Cài đặt chương trình giới thiệu"><ArrowUpRight /></button></footer></div>
    </article>
  </section>
}
