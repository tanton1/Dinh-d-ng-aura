import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Award,
  CheckCircle2,
  Clock3,
  Copy,
  Crown,
  Gift,
  History,
  LoaderCircle,
  LockKeyhole,
  MoreHorizontal,
  RefreshCw,
  Share2,
  ShieldCheck,
  Sparkles,
  Star,
  Trophy,
  UserRoundPlus,
  WalletCards,
  X,
} from 'lucide-react'
import type { ViewId } from '../../types'
import {
  applyForAmbassador,
  cancelMyPendingRedemption,
  createMyReferralCode,
  demoLoyaltyDashboard,
  demoRewards,
  getMyLoyaltyDashboard,
  getMyReferralWorkspace,
  listMyAvailableRewards,
  listMyLoyaltyHistory,
  redeemMyReward,
  subscribeToLoyaltySummary,
} from './loyaltyService'
import type {
  AuraClubTab,
  LoyaltyDashboard,
  LoyaltyHistoryEntry,
  LoyaltyReward,
  ReferralWorkspace,
} from './types'
import './loyalty.css'

const tabs: Array<{ id: AuraClubTab; label: string; icon: typeof Gift }> = [
  { id: 'rewards', label: 'Đổi quà', icon: Gift },
  { id: 'missions', label: 'Nhiệm vụ', icon: Trophy },
  { id: 'levels', label: 'Hạng', icon: Crown },
  { id: 'referral', label: 'Giới thiệu', icon: UserRoundPlus },
  { id: 'history', label: 'Lịch sử', icon: History },
]

const tierLabels = { member: 'Member', silver: 'Silver', gold: 'Gold', diamond: 'Diamond' } as const

function formatNumber(value: number) {
  return new Intl.NumberFormat('vi-VN').format(Math.max(0, Number(value) || 0))
}

function formatMoney(value: number) {
  return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND', maximumFractionDigits: 0 }).format(Number(value) || 0)
}

function friendlyError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || '')
  if (message && [
    'Hồ sơ học viên',
    'tạm dừng',
    'chưa đủ Điểm',
    'không áp dụng',
    'chưa có chi nhánh',
    'không còn có thể hủy',
    'đang tạm khóa',
    'đã hết',
  ].some((part) => message.includes(part))) return message.replace(/^FirebaseError:\s*/i, '')
  return 'Aura Club chưa tải được dữ liệu mới nhất. Hãy thử lại.'
}

function historyPoints(item: LoyaltyHistoryEntry) {
  return item.availableDelta + item.pendingDelta
}

function historySourceLabel(sourceType: string) {
  const labels: Record<string, string> = {
    payment: 'Thanh toán hợp đồng',
    contract_payment: 'Thanh toán hợp đồng',
    welcome: 'Chào mừng Aura Club',
    welcome_bonus: 'Chào mừng Aura Club',
    referral: 'Giới thiệu bạn bè',
    referral_reward: 'Giới thiệu bạn bè',
    redemption: 'Đổi quyền lợi',
    reward_redemption: 'Đổi quyền lợi',
    session: 'Buổi tập',
    attendance: 'Đi tập',
    nutrition: 'Nhật ký dinh dưỡng',
    adjustment: 'Điều chỉnh bởi Aura',
    refund: 'Hoàn tiền',
  }
  return labels[sourceType] || 'Hoạt động Aura Club'
}

type RewardFilter = 'all' | 'affordable' | 'automatic' | 'staff'

interface AuraClubPageProps {
  isDemo?: boolean
  ownerId: string
  initialTab?: AuraClubTab
  onNavigate: (view: ViewId) => void
}

export default function AuraClubPage({ isDemo = false, ownerId, initialTab = 'rewards', onNavigate }: AuraClubPageProps) {
  const [activeTab, setActiveTab] = useState<AuraClubTab>(initialTab)
  const [dashboard, setDashboard] = useState<LoyaltyDashboard | null>(isDemo ? demoLoyaltyDashboard() : null)
  const [rewards, setRewards] = useState<LoyaltyReward[]>(isDemo ? demoRewards : [])
  const [history, setHistory] = useState<LoyaltyHistoryEntry[]>([])
  const [referral, setReferral] = useState<ReferralWorkspace | null>(null)
  const [loading, setLoading] = useState(!isDemo)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const [rewardsLoading, setRewardsLoading] = useState(!isDemo)
  const [rewardsError, setRewardsError] = useState('')
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyError, setHistoryError] = useState('')
  const [historyLoaded, setHistoryLoaded] = useState(false)
  const [historyNextOffset, setHistoryNextOffset] = useState<number | null>(null)
  const [referralLoading, setReferralLoading] = useState(false)
  const [referralError, setReferralError] = useState('')
  const [referralLoaded, setReferralLoaded] = useState(false)
  const [rewardFilter, setRewardFilter] = useState<RewardFilter>('all')
  const [mobileMoreOpen, setMobileMoreOpen] = useState(false)
  const [selectedReward, setSelectedReward] = useState<LoyaltyReward | null>(null)
  const [cancelRedemptionId, setCancelRedemptionId] = useState<string | null>(null)
  const [actionPending, setActionPending] = useState('')
  const [notice, setNotice] = useState('')
  const modalRef = useRef<HTMLElement>(null)
  const restoreFocusRef = useRef<HTMLElement | null>(null)

  const load = useCallback(async (quiet = false) => {
    if (isDemo) return
    quiet ? setRefreshing(true) : setLoading(true)
    setError('')
    setRewardsLoading(true)
    setRewardsError('')
    const [dashboardResult, rewardResult] = await Promise.allSettled([
      getMyLoyaltyDashboard(),
      listMyAvailableRewards(),
    ])
    if (dashboardResult.status === 'fulfilled') setDashboard(dashboardResult.value)
    else setError(friendlyError(dashboardResult.reason))
    if (rewardResult.status === 'fulfilled') setRewards(rewardResult.value.rewards)
    else setRewardsError(friendlyError(rewardResult.reason))
    setLoading(false)
    setRewardsLoading(false)
    setRefreshing(false)
  }, [isDemo])

  const loadHistory = useCallback(async (append = false) => {
    if (historyLoading) return
    setHistoryLoading(true)
    setHistoryError('')
    try {
      if (isDemo) {
        setHistory([])
        setHistoryNextOffset(null)
      } else {
        const result = await listMyLoyaltyHistory(append ? historyNextOffset || 0 : 0, 30)
        setHistory((current) => append ? [...current, ...result.entries.filter((entry) => !current.some((item) => item.id === entry.id))] : result.entries)
        setHistoryNextOffset(result.nextOffset)
      }
      setHistoryLoaded(true)
    } catch (loadError) {
      setHistoryError(friendlyError(loadError))
    } finally {
      setHistoryLoaded(true)
      setHistoryLoading(false)
    }
  }, [historyLoading, historyNextOffset, isDemo])

  const loadReferral = useCallback(async () => {
    if (referralLoading) return
    setReferralLoading(true)
    setReferralError('')
    try {
      setReferral(isDemo ? { code: null, referrals: [], ambassador: null } : await getMyReferralWorkspace())
      setReferralLoaded(true)
    } catch (loadError) {
      setReferralError(friendlyError(loadError))
    } finally {
      setReferralLoaded(true)
      setReferralLoading(false)
    }
  }, [isDemo, referralLoading])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    if (activeTab === 'history' && !historyLoaded && !historyLoading) void loadHistory(false)
    if (activeTab === 'referral' && !referralLoaded && !referralLoading) void loadReferral()
  }, [activeTab, historyLoaded, historyLoading, loadHistory, loadReferral, referralLoaded, referralLoading])

  useEffect(() => {
    if (isDemo || !ownerId) return
    return subscribeToLoyaltySummary(ownerId, (account) => {
      if (!account) return
      setDashboard((current) => current ? { ...current, account: { ...current.account, ...account } } : current)
    })
  }, [isDemo, ownerId])

  useEffect(() => {
    setActiveTab(initialTab)
  }, [initialTab])

  const selectTab = (tab: AuraClubTab) => {
    setActiveTab(tab)
    setMobileMoreOpen(false)
    window.history.replaceState(null, '', `#/aura-club?tab=${tab}`)
  }

  const account = dashboard?.account
  const features = dashboard?.features
  // Keep the learner shell compatible while callable Functions roll out. Older
  // dashboard responses do not include recognition yet, so the new card should
  // degrade to an empty state instead of crashing the Levels tab.
  const recognition = dashboard?.recognition || { totalKudos: 0, totalXp: 0, badges: [], recent: [] }
  const redemptions = dashboard?.redemptions || []
  const availableRewards = useMemo(() => rewards.filter((item) => {
    if (!item.active) return false
    if (rewardFilter === 'affordable') return Boolean(account && account.debtPoints === 0 && account.availablePoints >= item.pointsCost && item.stock !== 0)
    if (rewardFilter === 'automatic') return item.fulfillmentType === 'automatic'
    if (rewardFilter === 'staff') return item.fulfillmentType === 'staff'
    return true
  }), [account, rewardFilter, rewards])

  useEffect(() => {
    const modalOpen = Boolean(selectedReward || cancelRedemptionId)
    if (!modalOpen) return
    restoreFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const timer = window.setTimeout(() => modalRef.current?.querySelector<HTMLElement>('button')?.focus(), 0)
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || actionPending) return
      setSelectedReward(null)
      setCancelRedemptionId(null)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('keydown', onKeyDown)
      restoreFocusRef.current?.focus()
    }
  }, [actionPending, cancelRedemptionId, selectedReward])

  const handleRedeem = async () => {
    if (!selectedReward) return
    if (isDemo) {
      setNotice(`Đã tạo bản xem trước đổi “${selectedReward.name}”. Dữ liệu demo không trừ điểm thật.`)
      setSelectedReward(null)
      return
    }
    setActionPending('redeem')
    setNotice('')
    try {
      const result = await redeemMyReward({ rewardId: selectedReward.id, idempotencyKey: `redeem:${selectedReward.id}:${crypto.randomUUID()}` })
      setDashboard((current) => current ? { ...current, account: result.account } : current)
      setNotice(result.status === 'fulfilled' ? 'Quyền lợi đã được cấp vào tài khoản.' : 'Yêu cầu đã được gửi. Điểm được giữ chỗ trong lúc Staff xử lý.')
      setSelectedReward(null)
      setDashboard(await getMyLoyaltyDashboard())
      if (historyLoaded) await loadHistory(false)
    } catch (redeemError) {
      setNotice(friendlyError(redeemError))
    } finally {
      setActionPending('')
    }
  }

  const handleCancelRedemption = async (redemptionId: string) => {
    if (isDemo) {
      setDashboard((current) => current ? { ...current, redemptions: current.redemptions.map((item) => item.id === redemptionId ? { ...item, status: 'cancelled' } : item) } : current)
      setNotice('Đã hủy yêu cầu demo và hoàn điểm giữ chỗ.')
      setCancelRedemptionId(null)
      return
    }
    setActionPending(`cancel-${redemptionId}`)
    setNotice('')
    try {
      const result = await cancelMyPendingRedemption({ redemptionId, idempotencyKey: `cancel-redemption:${redemptionId}:${crypto.randomUUID()}` })
      const nextDashboard = await getMyLoyaltyDashboard()
      setDashboard({ ...nextDashboard, account: result.account })
      if (historyLoaded) await loadHistory(false)
      setNotice('Đã hủy yêu cầu và hoàn lại toàn bộ điểm đang giữ.')
      setCancelRedemptionId(null)
    } catch (cancelError) {
      setNotice(friendlyError(cancelError))
    } finally {
      setActionPending('')
    }
  }

  const handleCreateReferral = async () => {
    if (isDemo) {
      setReferral({ code: 'AURAHAIANH', referrals: [], ambassador: null })
      return
    }
    setActionPending('referral')
    try {
      const value = await createMyReferralCode()
      setReferral((current) => ({ code: value.code, referrals: current?.referrals || [], ambassador: current?.ambassador || null }))
      setNotice('Mã giới thiệu đã sẵn sàng để chia sẻ.')
    } catch (createError) {
      setNotice(friendlyError(createError))
    } finally {
      setActionPending('')
    }
  }

  const copyReferral = async () => {
    if (!referral?.code) return
    const url = `${window.location.origin}/?ref=${referral.code}`
    await navigator.clipboard.writeText(`${referral.code} — ${url}`)
    setNotice('Đã sao chép mã và liên kết giới thiệu.')
  }

  const handleAmbassadorApplication = async () => {
    setActionPending('ambassador')
    try {
      if (!isDemo) await applyForAmbassador('Đăng ký từ Aura Club')
      setReferral((current) => ({ code: current?.code || null, referrals: current?.referrals || [], ambassador: { status: 'pending', quarterId: '', qualifiedReferrals: 0, pendingCommissionVnd: 0, availableCommissionVnd: 0, paidCommissionVnd: 0, id: 'pending' } }))
      setNotice('Đã gửi đăng ký Aura Ambassador cho Admin xét duyệt.')
    } catch (applyError) {
      setNotice(friendlyError(applyError))
    } finally {
      setActionPending('')
    }
  }

  if (loading) return <div className="loyalty-state" role="status"><LoaderCircle className="loyalty-spin" /><strong>Đang mở Aura Club</strong><span>Đang đối chiếu ví điểm và quyền lợi của bạn.</span></div>

  if (!dashboard || !account) return (
    <div className="loyalty-state loyalty-state--error" role="alert">
      <LockKeyhole />
      <strong>Chưa thể mở Aura Club</strong>
      <span>{error || 'Hồ sơ Aura Club chưa sẵn sàng.'}</span>
      <button type="button" onClick={() => void load()}>Thử lại</button>
    </div>
  )

  return (
    <div className="loyalty-page">
      <header className={`loyalty-hero loyalty-hero--${account.tier}`}>
        <button type="button" className="loyalty-back" onClick={() => onNavigate('home')} aria-label="Về trang Hôm nay"><ArrowLeft /></button>
        <div className="loyalty-hero__eyebrow"><Sparkles size={15} /> AURA CLUB</div>
        <div className="loyalty-hero__main">
          <div>
            <span className="loyalty-tier"><Crown size={18} /> Aura {tierLabels[account.tier]}</span>
            <h1>{formatNumber(account.availablePoints)} <small>Điểm Aura</small></h1>
            <p>Điểm dùng tại toàn hệ thống Aura và không hết hạn.</p>
          </div>
          <div className="loyalty-hero__wallet" aria-label="Số dư Điểm Aura">
            <span><Clock3 size={16} /> Đang chờ <strong>{formatNumber(account.pendingPoints)}</strong></span>
            <span><ShieldCheck size={16} /> Đang giữ <strong>{formatNumber(account.reservedPoints)}</strong></span>
          </div>
        </div>
        {account.debtPoints > 0 ? <div className="loyalty-debt" role="alert">Có {formatNumber(account.debtPoints)} điểm cần bù từ giao dịch đã hoàn. Đổi thưởng tạm khóa.</div> : null}
        <div className="loyalty-tier-progress">
          <span><i style={{ width: `${account.tierProgress.percent}%` }} /></span>
          <small>{account.tierProgress.nextTier ? `Còn ${formatMoney(account.tierProgress.remainingValue)} thực thu ròng để lên ${tierLabels[account.tierProgress.nextTier]}` : 'Bạn đang ở hạng cao nhất của Aura Club'}</small>
        </div>
        <button type="button" className="loyalty-refresh" onClick={() => void load(true)} disabled={refreshing} aria-label="Tải lại Aura Club"><RefreshCw className={refreshing ? 'loyalty-spin' : ''} /></button>
      </header>

      {error ? <div className="loyalty-inline-alert" role="alert">{error}</div> : null}
      {notice ? <div className="loyalty-inline-notice" role="status"><CheckCircle2 size={17} /> {notice}</div> : null}

      <nav className="loyalty-tabs loyalty-tabs--desktop" aria-label="Aura Club">
        {tabs.map((item) => {
          const Icon = item.icon
          return <button key={item.id} type="button" className={activeTab === item.id ? 'is-active' : ''} onClick={() => selectTab(item.id)} aria-current={activeTab === item.id ? 'page' : undefined}><Icon />{item.label}</button>
        })}
      </nav>
      <nav className="loyalty-tabs loyalty-tabs--mobile" aria-label="Aura Club trên điện thoại">
        {tabs.filter((item) => ['rewards', 'missions', 'history'].includes(item.id)).map((item) => {
          const Icon = item.icon
          return <button key={item.id} type="button" className={activeTab === item.id ? 'is-active' : ''} onClick={() => selectTab(item.id)} aria-current={activeTab === item.id ? 'page' : undefined}><Icon />{item.label}</button>
        })}
        <button type="button" className={mobileMoreOpen || activeTab === 'levels' || activeTab === 'referral' ? 'is-active' : ''} aria-expanded={mobileMoreOpen} onClick={() => setMobileMoreOpen((value) => !value)}><MoreHorizontal />Thêm</button>
      </nav>
      {mobileMoreOpen ? <div className="loyalty-mobile-more" role="menu">
        <button type="button" role="menuitem" onClick={() => selectTab('levels')}><Crown /> <span><strong>Hạng thành viên</strong><small>Xem cấp hạng và ghi nhận từ PT</small></span></button>
        <button type="button" role="menuitem" onClick={() => selectTab('referral')}><UserRoundPlus /> <span><strong>Giới thiệu bạn</strong><small>Mã giới thiệu và Aura Ambassador</small></span></button>
      </div> : null}

      <main className="loyalty-content">
        {activeTab === 'rewards' ? (
          <section aria-labelledby="loyalty-rewards-title">
            <div className="loyalty-section-heading"><div><span>Quyền lợi</span><h2 id="loyalty-rewards-title">Dùng điểm cho điều bạn cần</h2><p>Quyền lợi số được cấp ngay; quà và dịch vụ sẽ được Staff xác nhận.</p></div><WalletCards /></div>
            {!features?.redeem ? <div className="loyalty-feature-pause"><Clock3 /> Danh mục đang ở chế độ xem trước. Admin chưa mở đổi điểm.</div> : null}
            {redemptions.length ? <div className="loyalty-my-redemptions">
              <div className="loyalty-my-redemptions__heading"><div><strong>Quyền lợi của bạn</strong><span>Theo dõi yêu cầu gần đây ngay tại đây.</span></div><Clock3 /></div>
              <div className="loyalty-my-redemptions__list">{redemptions.slice(0, 4).map((item) => <article key={item.id}>
                <div><strong>{item.rewardName}</strong><small>{item.pointsCost.toLocaleString('vi-VN')} điểm · {item.createdAt ? new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short' }).format(new Date(item.createdAt)) : 'Đang đồng bộ'}</small></div>
                <span className={`loyalty-status loyalty-status--${item.status}`}>{item.status === 'pending' ? 'Chờ Staff' : item.status === 'approved' ? 'Đã duyệt' : item.status === 'fulfilled' ? 'Đã nhận' : item.status === 'cancelled' ? 'Đã hủy' : 'Đã từ chối'}</span>
                {item.status === 'pending' ? <button type="button" disabled={actionPending === `cancel-${item.id}`} onClick={() => setCancelRedemptionId(item.id)}>{actionPending === `cancel-${item.id}` ? <LoaderCircle className="loyalty-spin" /> : null} Hủy yêu cầu</button> : null}
              </article>)}</div>
            </div> : null}
            <div className="loyalty-reward-filters" aria-label="Lọc quyền lợi">
              {([
                ['all', 'Tất cả'],
                ['affordable', 'Đủ điểm'],
                ['automatic', 'Cấp ngay'],
                ['staff', 'Staff xác nhận'],
              ] as const).map(([id, label]) => <button type="button" key={id} className={rewardFilter === id ? 'is-active' : ''} onClick={() => setRewardFilter(id)}>{label}</button>)}
            </div>
            {rewardsError ? <div className="loyalty-tab-state is-error" role="alert"><AlertTriangle /><span>{rewardsError}</span><button type="button" onClick={() => void load(true)}>Thử lại</button></div> : null}
            {rewardsLoading ? <div className="loyalty-tab-state" role="status"><LoaderCircle className="loyalty-spin" /> Đang tải quyền lợi…</div> : null}
            {!rewardsLoading && !rewardsError ? <div className="loyalty-reward-grid">
              {availableRewards.map((reward) => {
                const affordable = account.availablePoints >= reward.pointsCost && account.debtPoints === 0
                return (
                  <article key={reward.id} className={`loyalty-reward${reward.featured ? ' is-featured' : ''}`}>
                    <div className="loyalty-reward__icon">{reward.category === 'schedule' ? <RefreshCw /> : reward.category === 'training' ? <Award /> : <Gift />}</div>
                    <div className="loyalty-reward__copy"><span>{reward.fulfillmentType === 'automatic' ? 'Cấp tự động' : 'Staff xác nhận'}</span><h3>{reward.name}</h3><p>{reward.description || `Có hiệu lực ${reward.validityDays} ngày sau khi nhận.`}</p></div>
                    <footer><strong>{formatNumber(reward.pointsCost)} điểm</strong><button type="button" disabled={!features?.redeem || !affordable || reward.stock === 0} onClick={() => setSelectedReward(reward)}>{reward.stock === 0 ? 'Hết lượt' : affordable ? 'Đổi ngay' : 'Chưa đủ điểm'}</button></footer>
                  </article>
                )
              })}
              {!availableRewards.length ? <div className="loyalty-empty"><Gift /><h3>Chưa có quyền lợi phù hợp</h3><p>Thử một bộ lọc khác để xem toàn bộ danh mục.</p></div> : null}
            </div> : null}
          </section>
        ) : null}

        {activeTab === 'missions' ? (
          <section aria-labelledby="loyalty-missions-title">
            <div className="loyalty-section-heading"><div><span>Nhiệm vụ</span><h2 id="loyalty-missions-title">Thói quen tạo nên thay đổi</h2><p>Chỉ dữ liệu đã được hệ thống hoặc PT xác nhận mới phát Điểm Aura.</p></div><Trophy /></div>
            <div className="loyalty-mission-list">
              {dashboard.missions.length ? dashboard.missions.map((mission) => {
                const progress = Number(mission.progress || 0)
                const target = Math.max(1, Number(mission.target || 1))
                const percent = Math.min(100, Math.round(progress / target * 100))
                return <article key={mission.id} className="loyalty-mission"><div className="loyalty-mission__icon"><Star /></div><div><span>{mission.status === 'completed' ? 'Hoàn thành' : 'Đang thực hiện'}</span><h3>{mission.title || 'Nhiệm vụ Aura'}</h3><p>{mission.description}</p><div className="loyalty-mission__bar"><i style={{ width: `${percent}%` }} /></div><small>{progress}/{target}</small></div><strong>+{formatNumber(Number(mission.rewardPoints || 0))}</strong></article>
              }) : <div className="loyalty-empty"><Trophy /><h3>Nhiệm vụ mới sắp bắt đầu</h3><p>Aura sẽ dùng mục tiêu tập luyện thực tế của bạn, không áp dụng một con số cứng cho mọi học viên.</p></div>}
            </div>
          </section>
        ) : null}

        {activeTab === 'levels' ? (
          <section aria-labelledby="loyalty-levels-title">
            <div className="loyalty-section-heading"><div><span>Hạng thành viên</span><h2 id="loyalty-levels-title">Gắn bó càng lâu, quyền lợi càng nhiều</h2><p>Hạng dựa trên thực thu ròng trọn đời và không giảm theo thời gian.</p></div><Crown /></div>
            <div className="loyalty-level-grid">
              {([
                ['member', 0, 'Tích điểm tiêu chuẩn'],
                ['silver', 10_000_000, '1,1× điểm và ưu tiên challenge'],
                ['gold', 25_000_000, '1,2× điểm, Birthday Reward và Guest Pass'],
                ['diamond', 50_000_000, '1,5× điểm, thêm quyền đổi lịch và hỗ trợ ưu tiên'],
              ] as const).map(([tier, threshold, benefit]) => <article key={tier} className={`loyalty-level loyalty-level--${tier}${account.tier === tier ? ' is-current' : ''}`}><Crown /><span>{account.tier === tier ? 'Hạng hiện tại' : formatMoney(threshold)}</span><h3>{tierLabels[tier]}</h3><p>{benefit}</p></article>)}
            </div>
            <div className="loyalty-level-note"><ShieldCheck /><div><strong>Đổi quà không làm tụt hạng</strong><span>Điểm Aura và Tier Credit là hai đại lượng riêng. Chỉ hoàn tiền hoặc sửa giao dịch sai mới điều chỉnh Tier Credit.</span></div></div>
            <div className="loyalty-recognition-card">
              <div className="loyalty-recognition-card__heading"><div><span>PT ghi nhận</span><h3>Nỗ lực của bạn được nhìn thấy</h3><p>Lời khen sau buổi tập tạo XP và huy hiệu động lực, không ảnh hưởng số dư Điểm Aura.</p></div><Award /></div>
              <div className="loyalty-recognition-card__stats"><span><strong>{formatNumber(recognition.totalXp)}</strong><small>XP động lực</small></span><span><strong>{formatNumber(recognition.totalKudos)}</strong><small>lời khen</small></span><span><strong>{formatNumber(recognition.badges.length)}</strong><small>huy hiệu</small></span></div>
              {recognition.recent.length ? <div className="loyalty-recognition-card__list">{recognition.recent.slice(0, 3).map((item) => <article key={item.id}><span className="loyalty-recognition-card__badge"><Award size={15} /></span><div><strong>{item.message || 'PT đã ghi nhận nỗ lực của bạn.'}</strong><small>{item.createdAt ? new Intl.DateTimeFormat('vi-VN', { dateStyle: 'medium' }).format(new Date(item.createdAt)) : 'Vừa ghi nhận'} · +{formatNumber(item.xp)} XP</small></div></article>)}</div> : <div className="loyalty-recognition-card__empty"><Sparkles size={16} /> Hoàn thành buổi tập tiếp theo để nhận lời khen từ PT.</div>}
            </div>
          </section>
        ) : null}

        {activeTab === 'referral' ? (
          <section aria-labelledby="loyalty-referral-title">
            <div className="loyalty-section-heading"><div><span>Giới thiệu bạn</span><h2 id="loyalty-referral-title">Tập cùng nhau, nhận quyền lợi cùng nhau</h2><p>Bạn nhận 1.000 điểm và người mới nhận 200 điểm sau khi hợp đồng đạt 30% thực thu và qua 14 ngày.</p></div><Share2 /></div>
            {referralLoading ? <div className="loyalty-tab-state" role="status"><LoaderCircle className="loyalty-spin" /> Đang tải thông tin giới thiệu…</div> : null}
            {referralError ? <div className="loyalty-tab-state is-error" role="alert"><AlertTriangle /><span>{referralError}</span><button type="button" onClick={() => { setReferralLoaded(false); void loadReferral() }}>Thử lại</button></div> : null}
            {!referralLoading && !referralError && referral ? <>
              <div className="loyalty-referral-card">
                <div><span>Mã giới thiệu của bạn</span><strong>{referral.code || 'Chưa tạo mã'}</strong><small>Không phát thưởng khi chỉ tạo lead. Mọi giao dịch đều được đối soát hoàn tiền.</small></div>
                {referral.code ? <button type="button" onClick={() => void copyReferral()}><Copy /> Sao chép</button> : <button type="button" onClick={() => void handleCreateReferral()} disabled={!features?.referral || actionPending === 'referral'}>{actionPending === 'referral' ? <LoaderCircle className="loyalty-spin" /> : <Share2 />} Tạo mã</button>}
              </div>
              <div className="loyalty-referral-layout">
                <div className="loyalty-referrals"><h3>Người bạn đã giới thiệu</h3>{referral.referrals.length ? referral.referrals.map((item) => <article key={item.id}><span>{item.referredName}</span><strong>{item.status === 'vested' ? item.rewardMode === 'ambassador' ? 'Đã ghi hoa hồng' : 'Đã nhận thưởng' : item.status === 'cooling_off' ? 'Đang chờ 14 ngày' : item.status === 'blocked' || item.status === 'ineligible_existing_customer' ? 'Không đủ điều kiện' : item.status === 'reversed' ? 'Đã đảo do hoàn tiền' : 'Đang theo dõi'}</strong><small>{formatMoney(item.netCollectedVnd)} thực thu{item.holdUntil && item.status === 'cooling_off' ? ` · xác nhận ${new Intl.DateTimeFormat('vi-VN').format(new Date(item.holdUntil))}` : ''}</small></article>) : <div className="loyalty-empty loyalty-empty--compact"><UserRoundPlus /><h3>Chưa có lượt giới thiệu</h3><p>Chia sẻ mã với người chưa từng có hợp đồng Aura.</p></div>}</div>
                <aside className="loyalty-ambassador"><Sparkles /><span>Aura Ambassador</span><h3>Biến ảnh hưởng tích cực thành thu nhập</h3><p>Ambassador đã duyệt nhận hoa hồng 3%–7% trên thực thu, không cộng chồng điểm referral.</p>{referral.ambassador ? <strong className={`loyalty-status loyalty-status--${referral.ambassador.status}`}>{referral.ambassador.status === 'approved' ? 'Đã được duyệt' : referral.ambassador.status === 'pending' ? 'Đang chờ duyệt' : 'Cần liên hệ Aura'}</strong> : <button type="button" onClick={() => void handleAmbassadorApplication()} disabled={!features?.ambassador || actionPending === 'ambassador'}>Đăng ký Ambassador <ArrowRight /></button>}</aside>
              </div>
            </> : null}
          </section>
        ) : null}

        {activeTab === 'history' ? (
          <section aria-labelledby="loyalty-history-title">
            <div className="loyalty-section-heading"><div><span>Lịch sử điểm</span><h2 id="loyalty-history-title">Mọi thay đổi đều có lý do</h2><p>Mỗi lần cộng, giữ, đổi hoặc hoàn điểm đều được ghi rõ để bạn dễ kiểm tra.</p></div><History /></div>
            {historyLoading && !history.length ? <div className="loyalty-tab-state" role="status"><LoaderCircle className="loyalty-spin" /> Đang tải lịch sử điểm…</div> : null}
            {historyError ? <div className="loyalty-tab-state is-error" role="alert"><AlertTriangle /><span>{historyError}</span><button type="button" onClick={() => { setHistoryLoaded(false); void loadHistory(false) }}>Thử lại</button></div> : null}
            {!historyError && (!historyLoading || history.length) ? <div className="loyalty-history-list">
              {history.length ? history.map((item) => {
                const points = historyPoints(item)
                return <article key={item.id}><span className={`loyalty-history__icon loyalty-history__icon--${item.kind}`}>{item.kind === 'redeem' || points < 0 ? <ArrowLeft /> : <ArrowRight />}</span><div><strong>{item.description}</strong><small>{item.createdAt ? new Intl.DateTimeFormat('vi-VN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(item.createdAt)) : 'Đang đồng bộ'} · {historySourceLabel(item.sourceType)}</small></div><b className={points >= 0 ? 'is-positive' : 'is-negative'}>{points >= 0 ? '+' : ''}{formatNumber(points)}</b></article>
              }) : <div className="loyalty-empty"><History /><h3>Chưa có giao dịch điểm</h3><p>200 điểm chào mừng sẽ xuất hiện khi Aura hoàn tất đối soát hợp đồng hiệu lực.</p></div>}
            </div> : null}
            {historyNextOffset !== null ? <button type="button" className="loyalty-load-more" disabled={historyLoading} onClick={() => void loadHistory(true)}>{historyLoading ? <LoaderCircle className="loyalty-spin" /> : <History />} Tải thêm</button> : null}
          </section>
        ) : null}
      </main>

      {selectedReward ? <div className="loyalty-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target && !actionPending) setSelectedReward(null) }}><section ref={modalRef} className="loyalty-modal" role="dialog" aria-modal="true" aria-labelledby="loyalty-redeem-title"><button type="button" className="loyalty-modal__close" aria-label="Đóng" onClick={() => setSelectedReward(null)}><X /></button><div className="loyalty-modal__icon"><Gift /></div><span>Xác nhận đổi quà</span><h2 id="loyalty-redeem-title">{selectedReward.name}</h2><p>Bạn sẽ dùng <strong>{formatNumber(selectedReward.pointsCost)} Điểm Aura</strong>. {selectedReward.fulfillmentType === 'automatic' ? 'Quyền lợi được cấp ngay.' : 'Điểm được giữ chỗ cho tới khi Staff hoàn tất.'}</p><div className="loyalty-modal__balance"><span>Số dư sau khi đổi</span><strong>{formatNumber(Math.max(0, account.availablePoints - selectedReward.pointsCost))}</strong></div><footer><button type="button" onClick={() => setSelectedReward(null)}>Để sau</button><button type="button" onClick={() => void handleRedeem()} disabled={actionPending === 'redeem'}>{actionPending === 'redeem' ? <LoaderCircle className="loyalty-spin" /> : <Gift />} Xác nhận đổi</button></footer></section></div> : null}
      {cancelRedemptionId ? <div className="loyalty-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target && !actionPending) setCancelRedemptionId(null) }}><section ref={modalRef} className="loyalty-modal loyalty-cancel-modal" role="alertdialog" aria-modal="true" aria-labelledby="loyalty-cancel-title"><button type="button" className="loyalty-modal__close" aria-label="Đóng" onClick={() => setCancelRedemptionId(null)}><X /></button><div className="loyalty-modal__icon"><AlertTriangle /></div><span>Kiểm tra yêu cầu</span><h2 id="loyalty-cancel-title">Hủy đổi quyền lợi?</h2><p>Điểm đang giữ sẽ được hoàn lại ví Aura ngay sau khi yêu cầu được hủy thành công.</p><footer><button type="button" onClick={() => setCancelRedemptionId(null)}>Giữ yêu cầu</button><button type="button" disabled={actionPending === `cancel-${cancelRedemptionId}`} onClick={() => void handleCancelRedemption(cancelRedemptionId)}>{actionPending === `cancel-${cancelRedemptionId}` ? <LoaderCircle className="loyalty-spin" /> : null} Xác nhận hủy</button></footer></section></div> : null}
    </div>
  )
}
