import { useEffect, useMemo, useState } from 'react'
import {
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
  RefreshCw,
  Share2,
  ShieldCheck,
  Sparkles,
  Star,
  Trophy,
  UserRoundPlus,
  WalletCards,
} from 'lucide-react'
import type { ViewId } from '../../types'
import {
  applyForAmbassador,
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
  if (message.includes('Hồ sơ học viên chưa được liên kết')) return message
  if (message.includes('tạm dừng')) return message
  return 'Aura Club chưa tải được dữ liệu mới nhất. Hãy thử lại.'
}

function historyPoints(item: LoyaltyHistoryEntry) {
  return item.availableDelta + item.pendingDelta
}

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
  const [selectedReward, setSelectedReward] = useState<LoyaltyReward | null>(null)
  const [actionPending, setActionPending] = useState('')
  const [notice, setNotice] = useState('')

  const load = async (quiet = false) => {
    if (isDemo) return
    quiet ? setRefreshing(true) : setLoading(true)
    setError('')
    try {
      const [dashboardResult, rewardResult, historyResult, referralResult] = await Promise.all([
        getMyLoyaltyDashboard(),
        listMyAvailableRewards(),
        listMyLoyaltyHistory(),
        getMyReferralWorkspace(),
      ])
      setDashboard(dashboardResult)
      setRewards(rewardResult.rewards)
      setHistory(historyResult.entries)
      setReferral(referralResult)
    } catch (loadError) {
      setError(friendlyError(loadError))
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  useEffect(() => { void load() }, [isDemo])

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
    window.history.replaceState(null, '', `#/aura-club?tab=${tab}`)
  }

  const account = dashboard?.account
  const features = dashboard?.features
  // Keep the learner shell compatible while callable Functions roll out. Older
  // dashboard responses do not include recognition yet, so the new card should
  // degrade to an empty state instead of crashing the Levels tab.
  const recognition = dashboard?.recognition || { totalKudos: 0, totalXp: 0, badges: [], recent: [] }
  const availableRewards = useMemo(() => rewards.filter((item) => item.active), [rewards])

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
      const nextHistory = await listMyLoyaltyHistory()
      setHistory(nextHistory.entries)
    } catch (redeemError) {
      setNotice(friendlyError(redeemError))
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

      <nav className="loyalty-tabs" aria-label="Aura Club">
        {tabs.map((item) => {
          const Icon = item.icon
          return <button key={item.id} type="button" className={activeTab === item.id ? 'is-active' : ''} onClick={() => selectTab(item.id)} aria-current={activeTab === item.id ? 'page' : undefined}><Icon />{item.label}</button>
        })}
      </nav>

      <main className="loyalty-content">
        {activeTab === 'rewards' ? (
          <section aria-labelledby="loyalty-rewards-title">
            <div className="loyalty-section-heading"><div><span>QUYỀN LỢI</span><h2 id="loyalty-rewards-title">Dùng điểm cho điều bạn cần</h2><p>Quyền lợi số được cấp ngay; quà và dịch vụ sẽ được Staff xác nhận.</p></div><WalletCards /></div>
            {!features?.redeem ? <div className="loyalty-feature-pause"><Clock3 /> Danh mục đang ở chế độ xem trước. Admin chưa mở đổi điểm.</div> : null}
            <div className="loyalty-reward-grid">
              {availableRewards.map((reward) => {
                const affordable = account.availablePoints >= reward.pointsCost && account.debtPoints === 0
                return (
                  <article key={reward.id} className={`loyalty-reward${reward.featured ? ' is-featured' : ''}`}>
                    <div className="loyalty-reward__icon">{reward.category === 'schedule' ? <RefreshCw /> : reward.category === 'training' ? <Award /> : <Gift />}</div>
                    <div className="loyalty-reward__copy"><span>{reward.fulfillmentType === 'automatic' ? 'CẤP TỰ ĐỘNG' : 'STAFF XÁC NHẬN'}</span><h3>{reward.name}</h3><p>{reward.description || `Có hiệu lực ${reward.validityDays} ngày sau khi nhận.`}</p></div>
                    <footer><strong>{formatNumber(reward.pointsCost)} điểm</strong><button type="button" disabled={!features?.redeem || !affordable || reward.stock === 0} onClick={() => setSelectedReward(reward)}>{reward.stock === 0 ? 'Hết lượt' : affordable ? 'Đổi ngay' : 'Chưa đủ điểm'}</button></footer>
                  </article>
                )
              })}
            </div>
          </section>
        ) : null}

        {activeTab === 'missions' ? (
          <section aria-labelledby="loyalty-missions-title">
            <div className="loyalty-section-heading"><div><span>NHIỆM VỤ</span><h2 id="loyalty-missions-title">Thói quen tạo nên thay đổi</h2><p>Chỉ dữ liệu đã được hệ thống hoặc PT xác nhận mới phát Điểm Aura.</p></div><Trophy /></div>
            <div className="loyalty-mission-list">
              {dashboard.missions.length ? dashboard.missions.map((mission) => {
                const progress = Number(mission.progress || 0)
                const target = Math.max(1, Number(mission.target || 1))
                const percent = Math.min(100, Math.round(progress / target * 100))
                return <article key={mission.id} className="loyalty-mission"><div className="loyalty-mission__icon"><Star /></div><div><span>{mission.status === 'completed' ? 'HOÀN THÀNH' : 'ĐANG THỰC HIỆN'}</span><h3>{mission.title || 'Nhiệm vụ Aura'}</h3><p>{mission.description}</p><div className="loyalty-mission__bar"><i style={{ width: `${percent}%` }} /></div><small>{progress}/{target}</small></div><strong>+{formatNumber(Number(mission.rewardPoints || 0))}</strong></article>
              }) : <div className="loyalty-empty"><Trophy /><h3>Nhiệm vụ mới sắp bắt đầu</h3><p>Aura sẽ dùng mục tiêu tập luyện thực tế của bạn, không áp dụng một con số cứng cho mọi học viên.</p></div>}
            </div>
          </section>
        ) : null}

        {activeTab === 'levels' ? (
          <section aria-labelledby="loyalty-levels-title">
            <div className="loyalty-section-heading"><div><span>HẠNG THÀNH VIÊN</span><h2 id="loyalty-levels-title">Gắn bó càng lâu, quyền lợi càng nhiều</h2><p>Hạng dựa trên thực thu ròng trọn đời và không giảm theo thời gian.</p></div><Crown /></div>
            <div className="loyalty-level-grid">
              {([
                ['member', 0, 'Tích điểm tiêu chuẩn'],
                ['silver', 10_000_000, '1,1× điểm và ưu tiên challenge'],
                ['gold', 25_000_000, '1,2× điểm, Birthday Reward và Guest Pass'],
                ['diamond', 50_000_000, '1,5× điểm, thêm quyền đổi lịch và hỗ trợ ưu tiên'],
              ] as const).map(([tier, threshold, benefit]) => <article key={tier} className={`loyalty-level loyalty-level--${tier}${account.tier === tier ? ' is-current' : ''}`}><Crown /><span>{account.tier === tier ? 'HẠNG HIỆN TẠI' : formatMoney(threshold)}</span><h3>{tierLabels[tier]}</h3><p>{benefit}</p></article>)}
            </div>
            <div className="loyalty-level-note"><ShieldCheck /><div><strong>Đổi quà không làm tụt hạng</strong><span>Điểm Aura và Tier Credit là hai đại lượng riêng. Chỉ hoàn tiền hoặc sửa giao dịch sai mới điều chỉnh Tier Credit.</span></div></div>
            <div className="loyalty-recognition-card">
              <div className="loyalty-recognition-card__heading"><div><span>PT GHI NHẬN</span><h3>Nỗ lực của bạn được nhìn thấy</h3><p>Lời khen sau buổi tập tạo XP và huy hiệu động lực, không ảnh hưởng số dư Điểm Aura.</p></div><Award /></div>
              <div className="loyalty-recognition-card__stats"><span><strong>{formatNumber(recognition.totalXp)}</strong><small>XP động lực</small></span><span><strong>{formatNumber(recognition.totalKudos)}</strong><small>lời khen</small></span><span><strong>{formatNumber(recognition.badges.length)}</strong><small>huy hiệu</small></span></div>
              {recognition.recent.length ? <div className="loyalty-recognition-card__list">{recognition.recent.slice(0, 3).map((item) => <article key={item.id}><span className="loyalty-recognition-card__badge"><Award size={15} /></span><div><strong>{item.message || 'PT đã ghi nhận nỗ lực của bạn.'}</strong><small>{item.createdAt ? new Intl.DateTimeFormat('vi-VN', { dateStyle: 'medium' }).format(new Date(item.createdAt)) : 'Vừa ghi nhận'} · +{formatNumber(item.xp)} XP</small></div></article>)}</div> : <div className="loyalty-recognition-card__empty"><Sparkles size={16} /> Hoàn thành buổi tập tiếp theo để nhận lời khen từ PT.</div>}
            </div>
          </section>
        ) : null}

        {activeTab === 'referral' ? (
          <section aria-labelledby="loyalty-referral-title">
            <div className="loyalty-section-heading"><div><span>GIỚI THIỆU BẠN</span><h2 id="loyalty-referral-title">Tập cùng nhau, nhận quyền lợi cùng nhau</h2><p>Bạn nhận 1.000 điểm và người mới nhận 200 điểm sau khi hợp đồng đạt 30% thực thu và qua 14 ngày.</p></div><Share2 /></div>
            <div className="loyalty-referral-card">
              <div><span>MÃ GIỚI THIỆU CỦA BẠN</span><strong>{referral?.code || 'Chưa tạo mã'}</strong><small>Không phát thưởng khi chỉ tạo lead. Mọi giao dịch đều được đối soát hoàn tiền.</small></div>
              {referral?.code ? <button type="button" onClick={() => void copyReferral()}><Copy /> Sao chép</button> : <button type="button" onClick={() => void handleCreateReferral()} disabled={!features?.referral || actionPending === 'referral'}>{actionPending === 'referral' ? <LoaderCircle className="loyalty-spin" /> : <Share2 />} Tạo mã</button>}
            </div>
            <div className="loyalty-referral-layout">
              <div className="loyalty-referrals"><h3>Người bạn đã giới thiệu</h3>{referral?.referrals.length ? referral.referrals.map((item) => <article key={item.id}><span>{item.referredName}</span><strong>{item.status === 'vested' ? item.rewardMode === 'ambassador' ? 'Đã ghi hoa hồng' : 'Đã nhận thưởng' : item.status === 'cooling_off' ? 'Đang chờ 14 ngày' : item.status === 'blocked' || item.status === 'ineligible_existing_customer' ? 'Không đủ điều kiện' : item.status === 'reversed' ? 'Đã đảo do hoàn tiền' : 'Đang theo dõi'}</strong><small>{formatMoney(item.netCollectedVnd)} thực thu{item.holdUntil && item.status === 'cooling_off' ? ` · xác nhận ${new Intl.DateTimeFormat('vi-VN').format(new Date(item.holdUntil))}` : ''}</small></article>) : <div className="loyalty-empty loyalty-empty--compact"><UserRoundPlus /><h3>Chưa có lượt giới thiệu</h3><p>Chia sẻ mã với người chưa từng có hợp đồng Aura.</p></div>}</div>
              <aside className="loyalty-ambassador"><Sparkles /><span>AURA AMBASSADOR</span><h3>Biến ảnh hưởng tích cực thành thu nhập</h3><p>Ambassador đã duyệt nhận hoa hồng 3%–7% trên thực thu, không cộng chồng điểm referral.</p>{referral?.ambassador ? <strong className={`loyalty-status loyalty-status--${referral.ambassador.status}`}>{referral.ambassador.status === 'approved' ? 'Đã được duyệt' : referral.ambassador.status === 'pending' ? 'Đang chờ duyệt' : 'Cần liên hệ Aura'}</strong> : <button type="button" onClick={() => void handleAmbassadorApplication()} disabled={!features?.ambassador || actionPending === 'ambassador'}>Đăng ký Ambassador <ArrowRight /></button>}</aside>
            </div>
          </section>
        ) : null}

        {activeTab === 'history' ? (
          <section aria-labelledby="loyalty-history-title">
            <div className="loyalty-section-heading"><div><span>LỊCH SỬ ĐIỂM</span><h2 id="loyalty-history-title">Mọi thay đổi đều có lý do</h2><p>Ledger bất biến giúp bạn và Aura kiểm tra chính xác nguồn cộng, giữ, đổi hoặc đảo điểm.</p></div><History /></div>
            <div className="loyalty-history-list">
              {history.length ? history.map((item) => {
                const points = historyPoints(item)
                return <article key={item.id}><span className={`loyalty-history__icon loyalty-history__icon--${item.kind}`}>{item.kind === 'redeem' || points < 0 ? <ArrowLeft /> : <ArrowRight />}</span><div><strong>{item.description}</strong><small>{item.createdAt ? new Intl.DateTimeFormat('vi-VN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(item.createdAt)) : 'Đang đồng bộ'} · {item.sourceType}</small></div><b className={points >= 0 ? 'is-positive' : 'is-negative'}>{points >= 0 ? '+' : ''}{formatNumber(points)}</b></article>
              }) : <div className="loyalty-empty"><History /><h3>Chưa có giao dịch điểm</h3><p>200 điểm chào mừng sẽ xuất hiện khi Aura hoàn tất đối soát hợp đồng hiệu lực.</p></div>}
            </div>
          </section>
        ) : null}
      </main>

      {selectedReward ? <div className="loyalty-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) setSelectedReward(null) }}><section className="loyalty-modal" role="dialog" aria-modal="true" aria-labelledby="loyalty-redeem-title"><div className="loyalty-modal__icon"><Gift /></div><span>XÁC NHẬN ĐỔI QUÀ</span><h2 id="loyalty-redeem-title">{selectedReward.name}</h2><p>Bạn sẽ dùng <strong>{formatNumber(selectedReward.pointsCost)} Điểm Aura</strong>. {selectedReward.fulfillmentType === 'automatic' ? 'Quyền lợi được cấp ngay.' : 'Điểm được giữ chỗ cho tới khi Staff hoàn tất.'}</p><div className="loyalty-modal__balance"><span>Số dư sau khi đổi</span><strong>{formatNumber(Math.max(0, account.availablePoints - selectedReward.pointsCost))}</strong></div><footer><button type="button" onClick={() => setSelectedReward(null)}>Để sau</button><button type="button" onClick={() => void handleRedeem()} disabled={actionPending === 'redeem'}>{actionPending === 'redeem' ? <LoaderCircle className="loyalty-spin" /> : <Gift />} Xác nhận đổi</button></footer></section></div> : null}
    </div>
  )
}
