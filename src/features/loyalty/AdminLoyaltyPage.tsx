import { useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  CheckCircle2,
  Clock3,
  Coins,
  Crown,
  Gift,
  LoaderCircle,
  RefreshCw,
  Save,
  ScanSearch,
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
  runLoyaltyBackfill,
} from './loyaltyService'
import type { LoyaltyAdminDashboard, LoyaltyBackfillSummary, LoyaltyDashboard, LoyaltyPolicyConfig } from './types'
import AdminLoyaltyOperations from './AdminLoyaltyOperations'
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
  canRunBackfill?: boolean
  canManagePolicy?: boolean
  canManageRewards?: boolean
  canManageAmbassadors?: boolean
  canReviewRedemptions?: boolean
  canAudit?: boolean
  canAdjust?: boolean
  canApproveAdjustments?: boolean
}

const emptyBackfill: LoyaltyBackfillSummary = { scannedContracts: 0, eligibleTierCreditVnd: 0, activeLaunchStudents: 0, missingStudentId: 0, missingStudentProfile: 0, missingAccountUid: 0, missingBranchId: 0, reconciledContracts: 0, launchBonusesStaged: 0, failures: 0 }

function launchDateToday() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
}

export default function AdminLoyaltyPage({
  isDemo = false,
  canRunBackfill = false,
  canManagePolicy = false,
  canManageRewards = false,
  canManageAmbassadors = false,
  canReviewRedemptions = false,
  canAudit = false,
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
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [launchDate, setLaunchDate] = useState(launchDateToday)
  const [backfill, setBackfill] = useState<{ mode: 'dry_run' | 'apply'; summary: LoyaltyBackfillSummary } | null>(null)

  const load = async () => {
    if (isDemo) return
    setLoading(true)
    setError('')
    try {
      const [overview, queue] = await Promise.all([
        getLoyaltyAdminDashboard(),
        canReviewRedemptions ? listLoyaltyRedemptions('') : Promise.resolve({ redemptions: [] }),
      ])
      setDashboard(overview)
      setFeatures(overview.features)
      setPolicyConfig(overview.policy || defaultPolicy)
      if (overview.launchDate) setLaunchDate(overview.launchDate)
      setRedemptions(queue.redemptions)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Không thể tải trung tâm Aura Club.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [isDemo])

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
      setNotice('Đã phát hành phiên bản chính sách mới. Giao dịch cũ giữ nguyên policy ban đầu.')
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

  const reconcileLaunch = async (mode: 'dry_run' | 'apply') => {
    if (mode === 'apply' && !window.confirm(`Áp dụng đối soát với ngày ra mắt ${launchDate}? Thao tác chỉ tạo ledger bù, không sửa dữ liệu tài chính gốc.`)) return
    setBusy(`backfill-${mode}`)
    setError('')
    setNotice('')
    let cursor = ''
    const total = { ...emptyBackfill }
    const activeStudentIds = new Set<string>()
    try {
      for (let page = 0; page < 500; page += 1) {
        const result = isDemo
          ? { hasMore: false, nextCursor: null, activeLaunchStudentIds: Array.from({ length: 214 }, (_, index) => `demo-${index}`), summary: { ...emptyBackfill, scannedContracts: 326, eligibleTierCreditVnd: 1_280_000_000, activeLaunchStudents: 214, reconciledContracts: mode === 'apply' ? 326 : 0, launchBonusesStaged: mode === 'apply' ? 214 : 0 } }
          : await runLoyaltyBackfill({ mode, cursor: cursor || undefined, batchSize: 25, launchDate })
        for (const key of Object.keys(total) as Array<keyof LoyaltyBackfillSummary>) total[key] += result.summary[key]
        result.activeLaunchStudentIds.forEach((studentId) => activeStudentIds.add(studentId))
        cursor = result.nextCursor || ''
        if (!result.hasMore || !cursor) break
      }
      total.activeLaunchStudents = activeStudentIds.size
      setBackfill({ mode, summary: total })
      setNotice(mode === 'apply'
        ? `Đã đối soát ${formatNumber(total.reconciledContracts)} hợp đồng và tạo ${formatNumber(total.launchBonusesStaged)} khoản chào mừng đang chờ.`
        : `Đã quét thử ${formatNumber(total.scannedContracts)} hợp đồng. Chưa ghi thay đổi nào.`)
      if (mode === 'apply') await load()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không thể hoàn tất đối soát Aura Club.')
    } finally {
      setBusy('')
    }
  }

  if (loading) return <div className="loyalty-state" role="status"><LoaderCircle className="loyalty-spin" /><strong>Đang tải Aura Club</strong><span>Đang tổng hợp ví điểm, đổi thưởng và referral.</span></div>
  if (!dashboard) return <div className="loyalty-state loyalty-state--error" role="alert"><AlertTriangle /><strong>Chưa thể tải Aura Club</strong><span>{error}</span><button type="button" onClick={() => void load()}>Thử lại</button></div>

  const metrics = dashboard.metrics
  return (
    <div className="loyalty-admin">
      <header className="loyalty-admin__header">
        <div><span><Sparkles /> AURA CLUB</span><h1>Khách hàng trung thành</h1><p>Điều hành điểm, quyền lợi, referral và nghĩa vụ chi phí từ một nguồn dữ liệu.</p></div>
        <button type="button" onClick={() => void load()}><RefreshCw /> Tải lại</button>
      </header>

      {error ? <div className="loyalty-inline-alert" role="alert"><AlertTriangle size={17} /> {error}</div> : null}
      {notice ? <div className="loyalty-inline-notice" role="status"><CheckCircle2 size={17} /> {notice}</div> : null}

      <section className="loyalty-admin__metrics" aria-label="Chỉ số Aura Club">
        <article><span><Users /> Thành viên</span><strong>{formatNumber(metrics.memberCount)}</strong><small><ArrowUpRight /> Toàn hệ thống</small></article>
        <article><span><Coins /> Điểm khả dụng</span><strong>{formatNumber(metrics.availablePoints)}</strong><small>{formatNumber(metrics.pendingPoints)} đang chờ</small></article>
        <article><span><Gift /> Đã đổi</span><strong>{formatNumber(metrics.lifetimeRedeemedPoints)}</strong><small>{metrics.pendingRedemptions} yêu cầu cần xử lý</small></article>
        <article className="is-liability"><span><WalletCards /> Nghĩa vụ danh nghĩa</span><strong>{formatMoney(metrics.outstandingNominalValueVnd)}</strong><small><ArrowDownRight /> Theo mốc {formatMoney(policyConfig.pointValueVnd)}/điểm</small></article>
      </section>

      {canRunBackfill ? <section className="loyalty-admin-card loyalty-admin-reconcile">
        <header><div><span>KIỂM SOÁT RA MẮT</span><h2>Đối soát dữ liệu trước khi phát điểm</h2></div><ScanSearch /></header>
        <p>Quét thử trước, sau đó mới áp dụng. Lịch sử thực thu chỉ tạo Tier Credit; không đổi XP hay thanh toán cũ thành điểm. Học viên có hợp đồng hiệu lực nhận 200 điểm đúng một lần.</p>
        <div className="loyalty-admin-reconcile__controls"><label>Ngày ra mắt {dashboard.launchDate ? '· đã khóa' : ''}<input type="date" value={launchDate} disabled={Boolean(dashboard.launchDate)} onChange={(event) => setLaunchDate(event.target.value)} /></label><button type="button" disabled={busy.startsWith('backfill')} onClick={() => void reconcileLaunch('dry_run')}>{busy === 'backfill-dry_run' ? <LoaderCircle className="loyalty-spin" /> : <ScanSearch />} Quét thử</button><button type="button" className="is-primary" disabled={busy.startsWith('backfill')} onClick={() => void reconcileLaunch('apply')}>{busy === 'backfill-apply' ? <LoaderCircle className="loyalty-spin" /> : <ShieldCheck />} Áp dụng an toàn</button></div>
        {backfill ? <div className="loyalty-admin-reconcile__result"><span><b>{formatNumber(backfill.summary.scannedContracts)}</b> hợp đồng đã quét</span><span><b>{formatMoney(backfill.summary.eligibleTierCreditVnd)}</b> Tier Credit</span><span><b>{formatNumber(backfill.summary.activeLaunchStudents)}</b> học viên hiệu lực</span><span className={backfill.summary.failures || backfill.summary.missingStudentId || backfill.summary.missingStudentProfile ? 'is-warning' : ''}><b>{formatNumber(backfill.summary.failures + backfill.summary.missingStudentId + backfill.summary.missingStudentProfile)}</b> lỗi cần xử lý</span></div> : null}
      </section> : null}

      <div className="loyalty-admin__grid">
        <section className="loyalty-admin-card">
          <header><div><span>CƠ CẤU HẠNG</span><h2>Thành viên theo hạng</h2></div><Crown /></header>
          <div className="loyalty-tier-chart">
            {dashboard.tiers.map((item) => <div key={item.tier}><span>{item.tier}</span><i><b style={{ width: `${Math.max(4, item.count / maxTier * 100)}%` }} /></i><strong>{formatNumber(item.count)}</strong></div>)}
          </div>
          <footer><span><Users /> {formatNumber(metrics.qualifiedReferrals)} referral đủ điều kiện</span><span><Sparkles /> {formatNumber(metrics.approvedAmbassadors)} Ambassador</span></footer>
        </section>

        <section className="loyalty-admin-card loyalty-admin-policy">
          <header><div><span>CONTROL CENTER</span><h2>Trạng thái phát hành</h2></div><ShieldCheck /></header>
          <p>{canManagePolicy ? 'Mỗi công tắc tạo một phiên bản policy mới. Có thể dừng riêng từng nguồn mà không mất ledger.' : 'Bạn đang xem trạng thái chương trình trong phạm vi được cấp. Chỉ Admin hệ thống được phát hành chính sách.'}</p>
          <div className="loyalty-policy-toggles">
            {([
              ['earn', 'Tích Điểm Aura', 'Thanh toán và attendance hợp lệ'],
              ['redeem', 'Đổi quyền lợi', 'Giữ điểm và kiểm tra tồn kho'],
              ['referral', 'Referral học viên', `Mốc ${policyConfig.referralThresholdPercent}% và chờ ${policyConfig.referralHoldDays} ngày`],
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
          {canManagePolicy ? <button type="button" className="loyalty-admin-policy__save" onClick={() => void saveFeatures()} disabled={busy === 'policy'}>{busy === 'policy' ? <LoaderCircle className="loyalty-spin" /> : <Save />} Phát hành chính sách</button> : null}
        </section>
      </div>

      <AdminLoyaltyOperations isDemo={isDemo} canManageRewards={canManageRewards} canManageAmbassadors={canManageAmbassadors} canAudit={canAudit} canAdjust={canAdjust} canApproveAdjustments={canApproveAdjustments} largeAdjustmentThreshold={policyConfig.largeAdjustmentThreshold} />

      {canReviewRedemptions ? <section className="loyalty-admin-card loyalty-admin-queue">
        <header><div><span>ĐỔI THƯỞNG</span><h2>Yêu cầu cần xử lý</h2></div><Clock3 /></header>
        {pendingQueue.length ? <div className="loyalty-admin-table">
          <div className="loyalty-admin-table__head"><span>Học viên</span><span>Quyền lợi</span><span>Điểm</span><span>Trạng thái</span><span>Thao tác</span></div>
          {pendingQueue.map((item) => {
            const reward = item.rewardSnapshot as { name?: string } | undefined
            return <article key={item.id}><span><strong>{String(item.studentName || item.studentId || 'Học viên Aura')}</strong><small>{item.id.slice(0, 10)}</small></span><span>{reward?.name || 'Quyền lợi Aura'}</span><span><strong>{formatNumber(Number(item.pointsCost || 0))}</strong></span><span><b className={`loyalty-status-pill loyalty-status-pill--${item.status}`}>{item.status === 'pending' ? 'Chờ duyệt' : 'Đã duyệt'}</b></span><span className="loyalty-admin-actions">{item.status === 'pending' ? <><button type="button" disabled={busy === item.id} onClick={() => void transition(item.id, 'approved')}>Duyệt</button><button type="button" className="is-secondary" disabled={busy === item.id} onClick={() => void transition(item.id, 'rejected')}>Từ chối</button></> : <><button type="button" disabled={busy === item.id} onClick={() => void transition(item.id, 'fulfilled')}>Hoàn tất</button><button type="button" className="is-secondary" disabled={busy === item.id} onClick={() => void transition(item.id, 'cancelled')}>Hủy & hoàn điểm</button></>}</span></article>
          })}
        </div> : <div className="loyalty-empty loyalty-empty--compact"><CheckCircle2 /><h3>Không có yêu cầu tồn</h3><p>Các yêu cầu mới sẽ xuất hiện ở đây theo đúng phạm vi chi nhánh.</p></div>}
      </section> : null}

      {metrics.debtPoints > 0 ? <aside className="loyalty-admin-risk"><AlertTriangle /><div><strong>{formatNumber(metrics.debtPoints)} điểm nghĩa vụ đang âm</strong><span>Các tài khoản này bị khóa đổi thưởng cho đến khi điểm kiếm mới bù đủ hoặc Admin đối soát.</span></div></aside> : null}
    </div>
  )
}
