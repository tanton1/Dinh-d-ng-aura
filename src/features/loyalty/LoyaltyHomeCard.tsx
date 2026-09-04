import { useEffect, useState } from 'react'
import { ArrowRight, Crown, Gift, Sparkles } from 'lucide-react'
import type { ViewId } from '../../types'
import { demoLoyaltyDashboard, getMyLoyaltyDashboard, subscribeToLoyaltySummary } from './loyaltyService'
import type { LoyaltyDashboard } from './types'
import './loyalty.css'

const tierLabels = { member: 'Member', silver: 'Silver', gold: 'Gold', diamond: 'Diamond' } as const

interface LoyaltyHomeCardProps {
  isDemo: boolean
  ownerId: string
  onNavigate: (view: ViewId) => void
}

export default function LoyaltyHomeCard({ isDemo, ownerId, onNavigate }: LoyaltyHomeCardProps) {
  const [dashboard, setDashboard] = useState<LoyaltyDashboard | null>(isDemo ? demoLoyaltyDashboard() : null)
  const [unavailable, setUnavailable] = useState(false)

  useEffect(() => {
    if (isDemo) return
    let active = true
    void getMyLoyaltyDashboard().then((value) => {
      if (active) setDashboard(value)
    }).catch(() => {
      if (active) setUnavailable(true)
    })
    const unsubscribe = subscribeToLoyaltySummary(ownerId, (account) => {
      if (!account || !active) return
      setDashboard((current) => current ? { ...current, account: { ...current.account, ...account } } : current)
    })
    return () => { active = false; unsubscribe() }
  }, [isDemo, ownerId])

  if (unavailable && !dashboard) return null
  const account = dashboard?.account
  const nearestMission = dashboard?.missions.find((item) => item.status !== 'completed')
  return (
    <button type="button" className="loyalty-home-card" onClick={() => onNavigate('aura-club')} aria-label="Mở Aura Club">
      <span className="loyalty-home-card__icon">{account ? <Crown /> : <Sparkles />}</span>
      <span className="loyalty-home-card__main">
        <small>AURA CLUB</small>
        <strong>{account ? `${new Intl.NumberFormat('vi-VN').format(account.availablePoints)} Điểm Aura` : 'Đang khởi tạo quyền lợi'}</strong>
        <em>{account ? `Hạng ${tierLabels[account.tier]} · ${nearestMission ? `Gần hoàn thành: ${nearestMission.title}` : 'Xem quyền lợi của bạn'}` : 'Điểm và hạng được xác minh từ dữ liệu Aura'}</em>
      </span>
      <span className="loyalty-home-card__action"><Gift /><ArrowRight /></span>
    </button>
  )
}
