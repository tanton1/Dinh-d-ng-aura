import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Coins,
  Crown,
  Gift,
  LoaderCircle,
  RefreshCw,
  Save,
  ShieldCheck,
  Sparkles,
  Users,
  WalletCards,
} from 'lucide-react'
import {
  getLoyaltyAdminDashboard,
  listLoyaltyRedemptions,
  saveLoyaltyPolicy,
  transitionLoyaltyRedemption,
} from './loyaltyService'
import type { LoyaltyAdminDashboard, LoyaltyDashboard, LoyaltyPolicyConfig } from './types'
import AdminLoyaltyOperations from './AdminLoyaltyOperations'
import LoyaltyProgramBanners from './LoyaltyProgramBanners'
import './loyalty.css'
import './loyalty-admin.css'

type Redemption = Record<string, unknown> & { id: string; status: string }

const defaultFeatures: LoyaltyDashboard['features'] = { earn: false, redeem: false, referral: false, ambassador: false, nutrition: false }
const defaultPolicy: LoyaltyPolicyConfig = {
  vndPerPoint: 10_000,
  pointValueVnd: 100,
  paymentHoldDays: 14,
  referralHoldDays: 14,
  referralThresholdPercent: 30,
  referralRewardPoints: 1_000,
  referredWelcomePoints: 200,
  recurringBehaviorMonthlyCap: 250,
  nutritionMonthlyCap: 150,
  largeAdjustmentThreshold: 500,
  ambassadorPayoutMinimumVnd: 100_000,
}

function formatNumber(value: number) {
  return new Intl.NumberFormat('vi-VN').format(Number(value) || 0)
}

function formatMoney(value: number) {
  return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND', maximumFractionDigits: 0 }).format(Number(value) || 0)
}

function demoDashboard(): LoyaltyAdminDashboard {
  return {
    schemaVersion: 1,
    policyRevision: 2,
    launchDate: launchDateToday(),
    generatedAt: new Date().toISOString(),
    scope: 'all',
    metrics: {
      memberCount: 326,
      walletCount: 15,
      availablePoints: 84_200,
      pendingPoints: 12_460,
      reservedPoints: 3_200,
      debtPoints: 450,
      lifetimeRedeemedPoints: 21_400,
      pendingRedemptions: 12,
      fulfilledRedemptions: 86,
      qualifiedReferrals: 38,
      approvedAmbassadors: 7,
      outstandingNominalValueVnd: 9_986_000,
    },
    tiers: [
      { tier: 'member', count: 164 },
      { tier: 'silver', count: 92 },
      { tier: 'gold', count: 55 },
      { tier: 'diamond', count: 15 },
    ],
    features: { earn: true, redeem: true, referral: true, ambassador: true, nutrition: false },
    policy: defaultPolicy,
  }
}

interface AdminLoyaltyPageProps {
  isDemo?: boolean
  initialStudentId?: string
  canRunBackfill?: boolean
  canManagePolicy?: boolean
  canManageRewards?: boolean
  canManageAmbassadors?: boolean
  canReviewRedemptions?: boolean
  canAudit?: boolean
  canAdjust?: boolean
  canApproveAdjustments?: boolean
}


function launchDateToday() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
}

export default function AdminLoyaltyPage({
  isDemo = false,
  initialStudentId,
  canManagePolicy = false,
  canManageRewards = false,
  canManageAmbassadors = false,
  canReviewRedemptions = false,
  canAdjust = false,
  canApproveAdjustments = false,
}: AdminLoyaltyPageProps) {
  const [dashboard, setDashboard] = useState<LoyaltyAdminDashboard | null>(isDemo ? demoDashboard() : null)
  const [redemptions, setRedemptions] = useState<Redemption[]>(isDemo ? [
    { id: 'demo-1', status: 'pending', pointsCost: 700, studentId: 'HV-001', rewardSnapshot: { name: 'Guest Pass' }, createdAt: new Date().toISOString() },
    { id: 'demo-2', status: 'approved', pointsCost: 1_200, studentId: 'HV-002', rewardSnapshot: { name: 'Aura Shaker' }, createdAt: new Date().toISOString() },
  ] : [])
  const [features, setFeatures] = useState<LoyaltyDashboard['features']>(isDemo ? demoDashboard().features : defaultFeatures)
  const [policyConfig, setPolicyConfig] = useState<LoyaltyPolicyConfig>(isDemo ? demoDashboard().policy : defaultPolicy)
  const [loading, setLoading] = useState(!isDemo)
  const [queueLoading, setQueueLoading] = useState(false)
  const [queueError, setQueueError] = useState('')
  const [operationsOpen, setOperationsOpen] = useState(Boolean(initialStudentId))
  const overviewRequest = useRef(0)
  const queueRequest = useRef(0)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const loadQueue = async () => {
    const request = ++queueRequest.current
    if (isDemo || !canReviewRedemptions) return
    setQueueLoading(true)
    setQueueError('')
    try {
      const queue = await listLoyaltyRedemptions('open')
      if (request === queueRequest.current) setRedemptions(queue.redemptions)
    } catch (loadError) {
      if (request === queueRequest.current) setQueueError(loadError instanceof Error ? loadError.message : 'Không thể tải yêu cầu đổi thưởng.')
    } finally {
      if (request === queueRequest.current) setQueueLoading(false)
    }
  }

  const load = async () => {
    if (isDemo) return
    const request = ++overviewRequest.current
    setLoading(true)
    setError('')
    void loadQueue()
    try {
      const overview = await getLoyaltyAdminDashboard()
      if (request !== overviewRequest.current) return
      setDashboard(overview)
      setFeatures(overview.features)
      setPolicyConfig(overview.policy || defaultPolicy)
    } catch (loadError) {
      if (request === overviewRequest.current) setError(loadError instanceof Error ? loadError.message : 'Không thể tải trung tâm Aura Club.')
    } finally {
      if (request === overviewRequest.current) setLoading(false)
    }
  }

  useEffect(() => {
    if (!isDemo) { setDashboard(null); setRedemptions([]) }
    void load()
    return () => { overviewRequest.current++; queueRequest.current++ }
  }, [isDemo, canReviewRedemptions])
  useEffect(() => { if (initialStudentId) setOperationsOpen(true) }, [initialStudentId])

  const maxTier = useMemo(() => Math.max(1, ...(dashboard?.tiers.map((item) => item.count) || [1])), [dashboard])
  const pendingQueue = redemptions.filter((item) => ['pending', 'approved'].includes(item.status))

  const saveFeatures = async () => {
    if (!dashboard) return
    setBusy('policy')
    setNotice('')
    setError('')
    try {
      if (!isDemo) {
        const result = await saveLoyaltyPolicy(dashboard.policyRevision, features, policyConfig)
        setDashboard((current) => current ? { ...current, policyRevision: result.revision, features, policy: policyConfig } : current)
      } else {
        setDashboard((current) => current ? { ...current, policyRevision: current.policyRevision + 1, features, policy: policyConfig } : current)
      }
      setNotice('Đã lưu cài đặt. Các giao dịch trước đây giữ nguyên điều kiện đã áp dụng.')
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Không thể lưu chính sách Aura Club.')
    } finally {
      setBusy('')
    }
  }

  const transition = async (id: string, status: 'approved' | 'fulfilled' | 'rejected' | 'cancelled') => {
    if (status === 'cancelled' && !window.confirm('Hủy quyền lợi đã duyệt và hoàn toàn bộ điểm đang giữ cho học viên?')) return
    setBusy(id)
    setError('')
    try {
      if (!isDemo) await transitionLoyaltyRedemption(id, status)
      setRedemptions((current) => current.map((item) => item.id === id ? { ...item, status } : item))
      setNotice(status === 'fulfilled' ? 'Đã hoàn tất giao quyền lợi.' : status === 'approved' ? 'Đã duyệt yêu cầu.' : status === 'cancelled' ? 'Đã hủy quyền lợi và hoàn lại điểm giữ chỗ.' : 'Đã từ chối và hoàn lại điểm giữ chỗ.')
    } catch (transitionError) {
      setError(transitionError instanceof Error ? transitionError.message : 'Không thể đổi trạng thái yêu cầu.')
    } finally {
      setBusy('')
    }
  }

  if (loading && !dashboard) return <div className="loyalty-state" role="status"><LoaderCircle className="loyalty-spin" /><strong>Đang tải Aura Club</strong><span>Đang tải tổng quan thành viên và điểm thưởng.</span></div>
  if (!dashboard) return <div className="loyalty-state loyalty-state--error" role="alert"><AlertTriangle /><strong>Chưa thể tải Aura Club</strong><span>{error}</span><button type="button" onClick={() => void load()}>Thử lại</button></div>

  const metrics = dashboard.metrics
  return (
    <div className="loyalty-admin loyalty-admin--renewed">
      <header className="loyalty-admin__header">
        <div><span><Sparkles /> Aura Club</span><h1>Aura Club</h1><p>Chăm sóc thành viên. Ghi nhận từng tiến bộ.</p></div>
        <button type="button" onClick={() => void load()} aria-label="Tải lại dữ liệu Aura Club"><RefreshCw /> <span>Tải lại</span></button>
      </header>

      {error ? <div className="loyalty-inline-alert" role="alert"><AlertTriangle size={17} /> {error}</div> : null}
      {notice ? <div className="loyalty-inline-notice" role="status"><CheckCircle2 size={17} /> {notice}</div> : null}

      <section className="club-overview" aria-label="Chỉ số Aura Club">
        <div><Users /><span>Thành viên active</span><strong>{formatNumber(metrics.memberCount)}</strong><small>Hợp đồng đang hiệu lực</small></div>
        <div><Coins /><span>Điểm khả dụng</span><strong>{formatNumber(metrics.availablePoints)}</strong><small>{formatNumber(metrics.pendingPoints)} điểm đang chờ</small></div>
        <div><Gift /><span>Đang chờ xử lý</span><strong>{formatNumber(metrics.pendingRedemptions)}</strong><small>Yêu cầu đổi quyền lợi</small></div>
        <div><WalletCards /><span>Giá trị điểm hiện tại</span><strong>{formatMoney(metrics.outstandingNominalValueVnd)}</strong><small>Của các ví đang quản lý</small></div>
      </section>

      <LoyaltyProgramBanners features={dashboard.features} policy={dashboard.policy || defaultPolicy} />
      <p className="club-membership-note"><CheckCircle2 /> Chỉ bắt đầu quản lý học viên đang active. Sau một tháng hết hạn, ví tự rời danh sách; lịch sử điểm vẫn được giữ khi học viên quay lại.</p>

      {metrics.debtPoints > 0 ? <aside className="loyalty-admin-risk"><AlertTriangle /><div><strong>{formatNumber(metrics.debtPoints)} điểm nghĩa vụ đang âm</strong><span>Tài khoản liên quan tạm khóa đổi thưởng đến khi số điểm âm được bù đủ.</span></div></aside> : null}

      {canReviewRedemptions ? <section className="loyalty-admin-card loyalty-admin-queue" id="loyalty-redemption-queue">
        <header><div><span>Đổi thưởng</span><h2>Yêu cầu cần xử lý <b>{pendingQueue.length}</b></h2></div><Clock3 /></header>
        {queueError ? <div role="alert">{queueError} <button type="button" onClick={() => void loadQueue()}>Thử lại yêu cầu đổi thưởng</button></div> : null}
        {queueLoading ? <p role="status">Đang tải yêu cầu đổi thưởng…</p> : null}
        {pendingQueue.length ? <div className="loyalty-admin-table">
          <div className="loyalty-admin-table__head"><span>Học viên</span><span>Quyền lợi</span><span>Điểm</span><span>Trạng thái</span><span>Thao tác</span></div>
          {pendingQueue.map((item) => {
            const reward = item.rewardSnapshot as { name?: string } | undefined
            return <article key={item.id}><span className="loyalty-admin-table__student"><strong>{String(item.studentName || item.studentId || 'Học viên Aura')}</strong><small>{item.id.slice(0, 10)}</small></span><span data-label="Quyền lợi">{reward?.name || 'Quyền lợi Aura'}</span><span data-label="Điểm"><strong>{formatNumber(Number(item.pointsCost || 0))}</strong></span><span data-label="Trạng thái"><b className={`loyalty-status-pill loyalty-status-pill--${item.status}`}>{item.status === 'pending' ? 'Chờ duyệt' : 'Đã duyệt'}</b></span><span className="loyalty-admin-actions">{item.status === 'pending' ? <><button type="button" disabled={busy === item.id} onClick={() => void transition(item.id, 'approved')}>Duyệt</button><button type="button" className="is-secondary" disabled={busy === item.id} onClick={() => void transition(item.id, 'rejected')}>Từ chối</button></> : <><button type="button" disabled={busy === item.id} onClick={() => void transition(item.id, 'fulfilled')}>Hoàn tất</button><button type="button" className="is-secondary" disabled={busy === item.id} onClick={() => void transition(item.id, 'cancelled')}>Hủy & hoàn điểm</button></>}</span></article>
          })}
        </div> : !queueLoading && !queueError ? <div className="loyalty-empty loyalty-empty--compact"><CheckCircle2 /><h3>Đã xử lý hết yêu cầu</h3><p>Yêu cầu mới sẽ xuất hiện tại đây theo phạm vi chi nhánh.</p></div> : null}
      </section> : null}

      <details id="club-members" className="loyalty-admin-card club-disclosure" open={operationsOpen} onToggle={event => setOperationsOpen(event.currentTarget.open)}>
        <summary>Quản lý thành viên và quyền lợi</summary>
        {operationsOpen ? <AdminLoyaltyOperations initialStudentId={initialStudentId} isDemo={isDemo} canManageRewards={canManageRewards} canManageAmbassadors={canManageAmbassadors} canAdjust={canAdjust} canApproveAdjustments={canApproveAdjustments} largeAdjustmentThreshold={policyConfig.largeAdjustmentThreshold} /> : null}
      </details>

      <div className="loyalty-admin__grid">
        <section className="loyalty-admin-card">
          <header><div><span>Cơ cấu hạng</span><h2>Thành viên theo hạng</h2></div><Crown /></header>
          <div className="loyalty-tier-chart">
            {dashboard.tiers.map((item) => <div key={item.tier}><span>{item.tier}</span><i><b style={{ width: `${Math.max(4, item.count / maxTier * 100)}%` }} /></i><strong>{formatNumber(item.count)}</strong></div>)}
          </div>
          <footer><span><Users /> {formatNumber(metrics.qualifiedReferrals)} lượt giới thiệu đủ điều kiện</span><span><Sparkles /> {formatNumber(metrics.approvedAmbassadors)} Ambassador</span></footer>
        </section>

        <details id="club-policy" className="loyalty-admin-card loyalty-admin-policy club-disclosure">
          <summary>Cài đặt chương trình</summary>
          <header><div><span>Chính sách</span><h2>Trạng thái chương trình</h2></div><ShieldCheck /></header>
          <p>{canManagePolicy ? 'Bật hoặc tạm dừng từng chương trình. Thay đổi có hiệu lực sau khi lưu.' : 'Bạn đang xem trạng thái chương trình trong phạm vi được cấp. Chỉ Admin hệ thống được thay đổi cài đặt.'}</p>
          <div className="loyalty-policy-toggles">
            {([
              ['earn', 'Tích Điểm Aura', 'Thanh toán và buổi tập hợp lệ'],
              ['redeem', 'Đổi quyền lợi', 'Giữ điểm và kiểm tra tồn kho'],
              ['referral', 'Giới thiệu bạn bè', `Mốc ${policyConfig.referralThresholdPercent}% và chờ ${policyConfig.referralHoldDays} ngày`],
              ['ambassador', 'Aura Ambassador', 'Hoa hồng thực thu 3/5/7%'],
              ['nutrition', 'Điểm dinh dưỡng', 'Chỉ dữ liệu đã xác minh'],
            ] as const).map(([key, label, description]) => <label key={key}><span><strong>{label}</strong><small>{description}</small></span><input type="checkbox" disabled={!canManagePolicy} checked={features[key]} onChange={(event) => setFeatures((current) => ({ ...current, [key]: event.target.checked }))} /></label>)}
          </div>
          {canManagePolicy ? <details className="loyalty-policy-rules">
            <summary>Quy tắc điểm và kiểm soát chi phí</summary>
            <div className="loyalty-policy-rules__grid">
              {([
                ['vndPerPoint', 'Số đồng / 1 điểm', 1_000],
                ['pointValueVnd', 'Giá trị danh nghĩa / điểm', 1],
                ['paymentHoldDays', 'Ngày giữ điểm thanh toán', 0],
                ['referralHoldDays', 'Ngày chờ referral', 0],
                ['referralThresholdPercent', '% thực thu referral', 1],
                ['referralRewardPoints', 'Điểm người giới thiệu', 0],
                ['referredWelcomePoints', 'Điểm người được giới thiệu', 0],
                ['recurringBehaviorMonthlyCap', 'Trần điểm hành vi / tháng', 0],
                ['nutritionMonthlyCap', 'Trần dinh dưỡng / tháng', 0],
                ['largeAdjustmentThreshold', 'Ngưỡng cần hai Admin duyệt', 1],
                ['ambassadorPayoutMinimumVnd', 'Mức chi Ambassador tối thiểu', 0],
              ] as const).map(([key, label, min]) => <label key={key}><span>{label}</span><input type="number" min={min} step="1" value={policyConfig[key]} onChange={(event) => setPolicyConfig((current) => ({ ...current, [key]: Number(event.target.value) }))} /></label>)}
            </div>
          </details> : null}
          {canManagePolicy ? <button type="button" className="loyalty-admin-policy__save" onClick={() => void saveFeatures()} disabled={busy === 'policy'}>{busy === 'policy' ? <LoaderCircle className="loyalty-spin" /> : <Save />} Lưu cài đặt</button> : null}
        </details>
      </div>

    </div>
  )
}
