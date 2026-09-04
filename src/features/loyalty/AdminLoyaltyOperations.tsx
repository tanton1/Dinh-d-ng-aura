import { useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  Award,
  BadgeDollarSign,
  CheckCircle2,
  FileWarning,
  LoaderCircle,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Search,
  ShieldCheck,
  UserCheck,
  Users,
} from 'lucide-react'
import {
  adjustLoyaltyBalance,
  approveAmbassadorPayout,
  listLoyaltyAccounts,
  listLoyaltyAdjustments,
  listLoyaltyAmbassadors,
  listLoyaltyReconciliationIssues,
  listLoyaltyRewardsAdmin,
  manageAmbassadorProfile,
  reconcileLoyaltyAccount,
  reviewLoyaltyAdjustment,
  saveLoyaltyReward,
} from './loyaltyService'
import type {
  LoyaltyAdminAccount,
  LoyaltyAdjustment,
  LoyaltyAdminAmbassador,
  LoyaltyAdminReward,
  LoyaltyReconciliationIssue,
} from './types'

type OperationsTab = 'rewards' | 'ambassadors' | 'accounts' | 'adjustments' | 'issues'

interface AdminLoyaltyOperationsProps {
  isDemo?: boolean
  canManageRewards?: boolean
  canManageAmbassadors?: boolean
  canAudit?: boolean
  canAdjust?: boolean
  canApproveAdjustments?: boolean
  largeAdjustmentThreshold?: number
}

const emptyReward: LoyaltyAdminReward = {
  id: '',
  name: '',
  description: '',
  pointsCost: 500,
  category: 'other',
  fulfillmentType: 'staff',
  entitlementType: null,
  branchIds: [],
  stock: null,
  validityDays: 60,
  active: true,
  featured: false,
  revision: 0,
  persisted: false,
}

function formatNumber(value: number) {
  return new Intl.NumberFormat('vi-VN').format(Number(value) || 0)
}

function formatMoney(value: number) {
  return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND', maximumFractionDigits: 0 }).format(Number(value) || 0)
}

function dateTime(value: string) {
  if (!value) return 'Chưa ghi nhận'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 'Chưa ghi nhận' : new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short' }).format(date)
}

function issueLabel(value: string) {
  const labels: Record<string, string> = {
    backfill_missing_student_id: 'Hợp đồng thiếu mã học viên',
    backfill_missing_student_profile: 'Không tìm thấy hồ sơ học viên',
    backfill_missing_account_uid: 'Học viên chưa liên kết tài khoản',
    backfill_missing_branch: 'Hợp đồng thiếu chi nhánh',
    backfill_contract_failed: 'Không thể đối soát hợp đồng',
    nutrition_missing_student_link: 'Dinh dưỡng chưa liên kết học viên',
    account_projection_mismatch: 'Số dư ví đã được sửa khớp ledger',
    unallocated_refund: 'Hoàn tiền chưa phân bổ hết',
  }
  return labels[value] || value.replaceAll('_', ' ')
}

export default function AdminLoyaltyOperations({
  isDemo = false,
  canManageRewards = false,
  canManageAmbassadors = false,
  canAudit = false,
  canAdjust = false,
  canApproveAdjustments = false,
  largeAdjustmentThreshold = 500,
}: AdminLoyaltyOperationsProps) {
  const availableTabs = useMemo(() => ([
    canManageRewards && { id: 'rewards' as const, label: 'Danh mục quà', icon: Award },
    canManageAmbassadors && { id: 'ambassadors' as const, label: 'Ambassador', icon: UserCheck },
    { id: 'accounts' as const, label: 'Ví học viên', icon: Users },
    canApproveAdjustments && { id: 'adjustments' as const, label: 'Duyệt điểm', icon: ShieldCheck },
    canAudit && { id: 'issues' as const, label: 'Cần đối soát', icon: FileWarning },
  ].filter(Boolean) as Array<{ id: OperationsTab; label: string; icon: typeof Award }>), [canApproveAdjustments, canAudit, canManageAmbassadors, canManageRewards])
  const [activeTab, setActiveTab] = useState<OperationsTab>(canManageRewards ? 'rewards' : 'accounts')
  const [rewards, setRewards] = useState<LoyaltyAdminReward[]>([])
  const [ambassadors, setAmbassadors] = useState<LoyaltyAdminAmbassador[]>([])
  const [accounts, setAccounts] = useState<LoyaltyAdminAccount[]>([])
  const [issues, setIssues] = useState<LoyaltyReconciliationIssue[]>([])
  const [adjustments, setAdjustments] = useState<LoyaltyAdjustment[]>([])
  const [editingReward, setEditingReward] = useState<LoyaltyAdminReward | null>(null)
  const [adjustingAccount, setAdjustingAccount] = useState<LoyaltyAdminAccount | null>(null)
  const [adjustmentPoints, setAdjustmentPoints] = useState('')
  const [adjustmentReason, setAdjustmentReason] = useState('')
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  useEffect(() => {
    if (!availableTabs.some((item) => item.id === activeTab)) setActiveTab(availableTabs[0]?.id || 'accounts')
  }, [activeTab, availableTabs])

  const loadTab = async (tab: OperationsTab) => {
    setLoading(true)
    setError('')
    try {
      if (isDemo) {
        if (tab === 'rewards') setRewards([
          { ...emptyReward, id: 'assessment', name: 'InBody / Assessment', description: 'Đánh giá cơ thể và tư vấn nhanh.', pointsCost: 500, category: 'assessment', featured: true },
          { ...emptyReward, id: 'guest-pass', name: 'Guest Pass', description: 'Mời một người bạn trải nghiệm Aura.', pointsCost: 700, category: 'guest', stock: 20 },
        ])
        if (tab === 'ambassadors') setAmbassadors([{ id: 'demo', studentId: 'HV-001', studentName: 'Hải Anh', branchId: 'CS1', status: 'pending', note: 'Muốn chia sẻ hành trình tập luyện.', quarterId: '2026-Q3', qualifiedReferrals: 3, pendingCommissionVnd: 360_000, availableCommissionVnd: 150_000, paidCommissionVnd: 0, debtCommissionVnd: 0, revision: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }])
        if (tab === 'accounts') setAccounts([{ studentId: 'HV-001', studentName: 'Hải Anh', branchId: 'CS1', status: 'active', availablePoints: 2_480, pendingPoints: 180, reservedPoints: 0, debtPoints: 0, lifetimeEarnedPoints: 3_180, lifetimeRedeemedPoints: 700, tierQualifyingValue: 38_000_000, tier: 'gold', tierProgress: { tier: 'gold', nextTier: 'diamond', currentValue: 38_000_000, targetValue: 50_000_000, remainingValue: 12_000_000, percent: 52 }, revision: 1 }])
        if (tab === 'issues') setIssues([])
        if (tab === 'adjustments') setAdjustments([{ id: 'demo-adjustment', studentId: 'HV-001', studentName: 'Hải Anh', branchId: 'CS1', points: 700, reason: 'Bù điểm chiến dịch khai trương', status: 'pending_approval', requestedBy: 'admin-other', createdAt: new Date().toISOString(), reviewedAt: '' }])
        return
      }
      if (tab === 'rewards') setRewards((await listLoyaltyRewardsAdmin()).rewards)
      if (tab === 'ambassadors') setAmbassadors((await listLoyaltyAmbassadors()).ambassadors)
      if (tab === 'accounts') setAccounts((await listLoyaltyAccounts(100)).accounts)
      if (tab === 'issues') setIssues((await listLoyaltyReconciliationIssues('open')).issues)
      if (tab === 'adjustments') setAdjustments((await listLoyaltyAdjustments('pending_approval')).adjustments)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không thể tải dữ liệu Aura Club.')
    } finally {
      setLoading(false)
    }
  }

  const reviewAdjustment = async (adjustmentId: string, decision: 'approve' | 'reject') => {
    if (!window.confirm(decision === 'approve' ? 'Duyệt điều chỉnh điểm này?' : 'Từ chối điều chỉnh điểm này?')) return
    setBusy(`review-${adjustmentId}`)
    setError('')
    try {
      if (!isDemo) await reviewLoyaltyAdjustment(adjustmentId, decision)
      setAdjustments((current) => current.filter((item) => item.id !== adjustmentId))
      setNotice(decision === 'approve' ? 'Đã duyệt, ghi ledger và thông báo cho học viên.' : 'Đã từ chối điều chỉnh. Số dư không thay đổi.')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không thể xử lý yêu cầu điều chỉnh.')
    } finally {
      setBusy('')
    }
  }

  useEffect(() => { void loadTab(activeTab) }, [activeTab, isDemo])

  const saveReward = async () => {
    if (!editingReward || !editingReward.name.trim() || editingReward.pointsCost <= 0) {
      setError('Tên quyền lợi và số điểm đổi phải hợp lệ.')
      return
    }
    if (editingReward.fulfillmentType === 'automatic' && editingReward.entitlementType !== 'extra_reschedule') {
      setError('Quyền lợi cấp tự động hiện chỉ hỗ trợ thêm một lần đổi lịch.')
      return
    }
    setBusy('reward')
    setError('')
    try {
      if (isDemo) {
        const next = { ...editingReward, id: editingReward.id || `demo-${Date.now()}`, revision: editingReward.revision + 1, persisted: true }
        setRewards((current) => current.some((item) => item.id === next.id) ? current.map((item) => item.id === next.id ? next : item) : [...current, next])
      } else {
        const result = await saveLoyaltyReward(editingReward)
        const next = { ...editingReward, id: result.rewardId, revision: result.revision, persisted: true }
        setRewards((current) => current.some((item) => item.id === result.rewardId || (editingReward.id && item.id === editingReward.id))
          ? current.map((item) => item.id === result.rewardId || (editingReward.id && item.id === editingReward.id) ? next : item)
          : [...current, next])
      }
      setEditingReward(null)
      setNotice('Đã lưu quyền lợi. Các giao dịch đổi trước đây vẫn giữ nguyên snapshot cũ.')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không thể lưu quyền lợi.')
    } finally {
      setBusy('')
    }
  }

  const updateAmbassador = async (studentId: string, status: 'approved' | 'rejected' | 'suspended') => {
    if (status !== 'approved' && !window.confirm(status === 'suspended' ? 'Tạm dừng Ambassador này?' : 'Từ chối đăng ký Ambassador này?')) return
    setBusy(`ambassador-${studentId}`)
    setError('')
    try {
      if (!isDemo) await manageAmbassadorProfile(studentId, status)
      setAmbassadors((current) => current.map((item) => item.studentId === studentId ? { ...item, status } : item))
      setNotice(status === 'approved' ? 'Đã duyệt Aura Ambassador.' : status === 'suspended' ? 'Đã tạm dừng Ambassador.' : 'Đã từ chối đăng ký.')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không thể cập nhật Ambassador.')
    } finally {
      setBusy('')
    }
  }

  const payAmbassador = async (studentId: string) => {
    if (!window.confirm('Duyệt chi toàn bộ hoa hồng khả dụng cho Ambassador này?')) return
    setBusy(`payout-${studentId}`)
    setError('')
    try {
      const result = isDemo ? { amountVnd: ambassadors.find((item) => item.studentId === studentId)?.availableCommissionVnd || 0 } : await approveAmbassadorPayout(studentId)
      setAmbassadors((current) => current.map((item) => item.studentId === studentId ? { ...item, availableCommissionVnd: 0, paidCommissionVnd: item.paidCommissionVnd + result.amountVnd } : item))
      setNotice(`Đã duyệt chi ${formatMoney(result.amountVnd)}. Chứng từ payout đã được lưu.`)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không thể duyệt chi hoa hồng.')
    } finally {
      setBusy('')
    }
  }

  const reconcileAccount = async (studentId: string) => {
    setBusy(`reconcile-${studentId}`)
    setError('')
    try {
      const result = isDemo ? { mismatch: false, account: accounts.find((item) => item.studentId === studentId)! } : await reconcileLoyaltyAccount(studentId)
      setAccounts((current) => current.map((item) => item.studentId === studentId ? { ...item, ...result.account } : item))
      setNotice(result.mismatch ? 'Đã sửa số dư ví khớp với ledger bất biến.' : 'Ví đang khớp hoàn toàn với ledger.')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không thể đối soát ví.')
    } finally {
      setBusy('')
    }
  }

  const submitAdjustment = async () => {
    if (!adjustingAccount) return
    const points = Number(adjustmentPoints)
    if (!Number.isSafeInteger(points) || points === 0 || !adjustmentReason.trim()) {
      setError('Nhập số điểm nguyên khác 0 và lý do điều chỉnh.')
      return
    }
    setBusy(`adjust-${adjustingAccount.studentId}`)
    setError('')
    try {
      const result = isDemo ? { status: 'applied' as const } : await adjustLoyaltyBalance({ studentId: adjustingAccount.studentId, points, reason: adjustmentReason.trim(), idempotencyKey: `admin-adjust:${crypto.randomUUID()}` })
      setNotice(result.status === 'pending_approval' ? 'Điều chỉnh lớn đã chuyển sang chờ một Admin khác phê duyệt.' : 'Đã áp dụng điều chỉnh và ghi audit log.')
      setAdjustingAccount(null)
      setAdjustmentPoints('')
      setAdjustmentReason('')
      if (result.status === 'applied') await loadTab('accounts')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không thể gửi điều chỉnh.')
    } finally {
      setBusy('')
    }
  }

  const normalizedQuery = query.trim().toLocaleLowerCase('vi')
  const visibleAccounts = accounts.filter((item) => !normalizedQuery || `${item.studentName} ${item.studentId} ${item.branchId}`.toLocaleLowerCase('vi').includes(normalizedQuery))

  return <section className="loyalty-admin-card loyalty-admin-operations">
    <header><div><span>VẬN HÀNH</span><h2>Quản trị Aura Club</h2></div><ShieldCheck /></header>
    <nav className="loyalty-admin-operations__tabs" aria-label="Nghiệp vụ Aura Club">
      {availableTabs.map((item) => <button type="button" className={activeTab === item.id ? 'is-active' : ''} key={item.id} onClick={() => { setNotice(''); setError(''); setActiveTab(item.id) }}><item.icon /> {item.label}</button>)}
      <button type="button" className="is-refresh" aria-label="Tải lại tab đang mở" onClick={() => void loadTab(activeTab)}><RefreshCw /></button>
    </nav>

    {error ? <div className="loyalty-inline-alert" role="alert"><AlertTriangle size={17} /> {error}</div> : null}
    {notice ? <div className="loyalty-inline-notice" role="status"><CheckCircle2 size={17} /> {notice}</div> : null}
    {loading ? <div className="loyalty-admin-operations__loading" role="status"><LoaderCircle className="loyalty-spin" /> Đang tải dữ liệu…</div> : null}

    {!loading && activeTab === 'rewards' ? <div className="loyalty-admin-rewards">
      <div className="loyalty-admin-sectionbar"><div><strong>{rewards.length} quyền lợi</strong><span>Thay đổi chỉ áp dụng cho yêu cầu đổi mới.</span></div><button type="button" onClick={() => setEditingReward({ ...emptyReward })}><Plus /> Thêm quyền lợi</button></div>
      <div className="loyalty-admin-rewards__grid">{rewards.map((reward) => <article key={reward.id} className={!reward.active ? 'is-inactive' : ''}>
        <div><span>{reward.category}</span>{reward.featured ? <b>NỔI BẬT</b> : null}</div><h3>{reward.name}</h3><p>{reward.description || 'Chưa có mô tả.'}</p><footer><strong>{formatNumber(reward.pointsCost)} điểm</strong><small>{reward.stock === null ? 'Không giới hạn' : `Còn ${formatNumber(reward.stock)}`}</small><button type="button" onClick={() => setEditingReward({ ...reward })}><Pencil /> Sửa</button></footer>
      </article>)}</div>
    </div> : null}

    {!loading && activeTab === 'ambassadors' ? <div className="loyalty-admin-list">
      {ambassadors.length ? ambassadors.map((item) => <article key={item.id}>
        <div className="loyalty-admin-list__identity"><strong>{item.studentName}</strong><span>{item.studentId} · {item.branchId || 'Chưa có chi nhánh'}</span><small>{item.note || 'Không có ghi chú đăng ký.'}</small></div>
        <div><span>Giới thiệu</span><strong>{formatNumber(item.qualifiedReferrals)}</strong><small>{item.quarterId}</small></div>
        <div><span>Khả dụng</span><strong>{formatMoney(item.availableCommissionVnd)}</strong><small>{formatMoney(item.pendingCommissionVnd)} đang chờ</small></div>
        <div><b className={`loyalty-status-pill loyalty-status-pill--${item.status}`}>{item.status === 'pending' ? 'Chờ duyệt' : item.status === 'approved' ? 'Đang hoạt động' : item.status === 'suspended' ? 'Tạm dừng' : 'Đã từ chối'}</b>{item.debtCommissionVnd > 0 ? <small className="is-debt">Nợ bù {formatMoney(item.debtCommissionVnd)}</small> : null}</div>
        <div className="loyalty-admin-actions">{item.status === 'pending' ? <><button type="button" disabled={busy.includes(item.studentId)} onClick={() => void updateAmbassador(item.studentId, 'approved')}>Duyệt</button><button type="button" className="is-secondary" disabled={busy.includes(item.studentId)} onClick={() => void updateAmbassador(item.studentId, 'rejected')}>Từ chối</button></> : null}{item.status === 'approved' ? <><button type="button" disabled={busy.includes(item.studentId) || item.availableCommissionVnd <= 0 || item.debtCommissionVnd > 0} onClick={() => void payAmbassador(item.studentId)}><BadgeDollarSign /> Duyệt chi</button><button type="button" className="is-secondary" disabled={busy.includes(item.studentId)} onClick={() => void updateAmbassador(item.studentId, 'suspended')}>Tạm dừng</button></> : null}{item.status === 'suspended' ? <button type="button" disabled={busy.includes(item.studentId)} onClick={() => void updateAmbassador(item.studentId, 'approved')}>Mở lại</button> : null}</div>
      </article>) : <div className="loyalty-empty loyalty-empty--compact"><UserCheck /><h3>Chưa có đăng ký Ambassador</h3><p>Đăng ký mới của học viên sẽ xuất hiện tại đây.</p></div>}
    </div> : null}

    {!loading && activeTab === 'accounts' ? <div className="loyalty-admin-accounts">
      <label className="loyalty-admin-search"><Search /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tìm tên, mã học viên hoặc chi nhánh" /></label>
      <div className="loyalty-admin-list">{visibleAccounts.length ? visibleAccounts.map((item) => <article key={item.studentId}>
        <div className="loyalty-admin-list__identity"><strong>{item.studentName}</strong><span>{item.studentId} · {item.branchId || 'Chưa có chi nhánh'}</span><small>{item.tier.toUpperCase()} · Tier Credit {formatMoney(item.tierQualifyingValue)}</small></div>
        <div><span>Khả dụng</span><strong>{formatNumber(item.availablePoints)}</strong><small>{formatNumber(item.pendingPoints)} đang chờ</small></div>
        <div><span>Đã đổi</span><strong>{formatNumber(item.lifetimeRedeemedPoints)}</strong><small>{item.debtPoints ? `Nợ ${formatNumber(item.debtPoints)}` : 'Không có điểm âm'}</small></div>
        <div><span>Phiên bản ví</span><strong>#{item.revision}</strong></div>
        <div className="loyalty-admin-actions">{canAudit ? <button type="button" className="is-secondary" disabled={busy.includes(item.studentId)} onClick={() => void reconcileAccount(item.studentId)}><ShieldCheck /> Đối soát</button> : null}{canAdjust ? <button type="button" disabled={busy.includes(item.studentId)} onClick={() => setAdjustingAccount(item)}>Điều chỉnh</button> : null}</div>
      </article>) : <div className="loyalty-empty loyalty-empty--compact"><Users /><h3>Không tìm thấy ví học viên</h3><p>Thử đổi từ khóa hoặc chạy đối soát ra mắt trước.</p></div>}</div>
    </div> : null}

    {!loading && activeTab === 'adjustments' ? <div className="loyalty-admin-list loyalty-admin-adjustments">
      {adjustments.length ? adjustments.map((item) => <article key={item.id}>
        <ShieldCheck />
        <div className="loyalty-admin-list__identity"><strong>{item.studentName}</strong><span>{item.studentId} · {item.branchId || 'Chưa có chi nhánh'}</span><small>{item.reason}</small></div>
        <div><span>Điều chỉnh</span><strong className={item.points > 0 ? 'is-positive' : 'is-debt'}>{item.points > 0 ? '+' : ''}{formatNumber(item.points)}</strong><small>{dateTime(item.createdAt)}</small></div>
        <div><span>Người tạo</span><strong>{item.requestedBy.slice(0, 12) || 'Admin'}</strong><small>Bắt buộc người khác duyệt</small></div>
        <div className="loyalty-admin-actions"><button type="button" disabled={busy === `review-${item.id}`} onClick={() => void reviewAdjustment(item.id, 'approve')}>Duyệt</button><button type="button" className="is-secondary" disabled={busy === `review-${item.id}`} onClick={() => void reviewAdjustment(item.id, 'reject')}>Từ chối</button></div>
      </article>) : <div className="loyalty-empty loyalty-empty--compact"><CheckCircle2 /><h3>Không có điều chỉnh chờ duyệt</h3><p>Mọi thay đổi lớn đều đã được kiểm soát hai người.</p></div>}
    </div> : null}

    {!loading && activeTab === 'issues' ? <div className="loyalty-admin-list loyalty-admin-issues">
      {issues.length ? issues.map((item) => <article key={item.id}><FileWarning /><div className="loyalty-admin-list__identity"><strong>{issueLabel(item.type)}</strong><span>{item.studentName || item.studentId || item.contractId || 'Dữ liệu hệ thống'}</span><small>{item.errorCode || 'Cần kiểm tra liên kết dữ liệu nguồn.'}</small></div><div><span>Chi nhánh</span><strong>{item.branchId || '—'}</strong></div><div><span>Cập nhật</span><strong>{dateTime(item.updatedAt)}</strong></div><b className={`loyalty-status-pill loyalty-status-pill--${item.status}`}>{item.status === 'open' ? 'Cần xử lý' : item.status}</b></article>) : <div className="loyalty-empty loyalty-empty--compact"><CheckCircle2 /><h3>Không có lỗi đối soát mở</h3><p>Dữ liệu Aura Club trong phạm vi của bạn đang sạch.</p></div>}
    </div> : null}

    {editingReward ? <div className="loyalty-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) setEditingReward(null) }}><section className="loyalty-modal loyalty-admin-editor" role="dialog" aria-modal="true" aria-labelledby="loyalty-reward-editor-title"><span>DANH MỤC QUYỀN LỢI</span><h2 id="loyalty-reward-editor-title">{editingReward.id ? 'Chỉnh quyền lợi' : 'Thêm quyền lợi'}</h2><div className="loyalty-admin-editor__grid"><label>Tên quyền lợi<input value={editingReward.name} onChange={(event) => setEditingReward((current) => current ? { ...current, name: event.target.value } : current)} /></label><label>Điểm đổi<input type="number" min="1" value={editingReward.pointsCost} onChange={(event) => setEditingReward((current) => current ? { ...current, pointsCost: Number(event.target.value) } : current)} /></label><label>Danh mục<input value={editingReward.category} onChange={(event) => setEditingReward((current) => current ? { ...current, category: event.target.value } : current)} /></label><label>Thời hạn (ngày)<input type="number" min="1" value={editingReward.validityDays} onChange={(event) => setEditingReward((current) => current ? { ...current, validityDays: Number(event.target.value) } : current)} /></label><label>Cách giao<select value={editingReward.fulfillmentType} onChange={(event) => setEditingReward((current) => current ? { ...current, fulfillmentType: event.target.value as 'automatic' | 'staff', entitlementType: event.target.value === 'automatic' ? 'extra_reschedule' : null } : current)}><option value="staff">Staff xác nhận</option><option value="automatic">Cấp tự động</option></select></label><label>Tồn kho<input type="number" min="0" placeholder="Để trống = không giới hạn" value={editingReward.stock ?? ''} onChange={(event) => setEditingReward((current) => current ? { ...current, stock: event.target.value === '' ? null : Number(event.target.value) } : current)} /></label>{editingReward.fulfillmentType === 'automatic' ? <label>Quyền được cấp<select value={editingReward.entitlementType || ''} onChange={(event) => setEditingReward((current) => current ? { ...current, entitlementType: event.target.value || null } : current)}><option value="extra_reschedule">Thêm một lần đổi lịch</option></select></label> : null}<label className="is-wide">Chi nhánh áp dụng<input value={editingReward.branchIds.join(', ')} onChange={(event) => setEditingReward((current) => current ? { ...current, branchIds: event.target.value.split(',').map((item) => item.trim()).filter(Boolean).slice(0, 30) } : current)} placeholder="Để trống = toàn hệ thống; hoặc CS1, CS2" /></label><label className="is-wide">Mô tả<textarea rows={3} value={editingReward.description} onChange={(event) => setEditingReward((current) => current ? { ...current, description: event.target.value } : current)} /></label><label className="is-check"><input type="checkbox" checked={editingReward.active} onChange={(event) => setEditingReward((current) => current ? { ...current, active: event.target.checked } : current)} /> Đang hoạt động</label><label className="is-check"><input type="checkbox" checked={editingReward.featured} onChange={(event) => setEditingReward((current) => current ? { ...current, featured: event.target.checked } : current)} /> Hiển thị nổi bật</label></div><footer><button type="button" onClick={() => setEditingReward(null)}>Đóng</button><button type="button" disabled={busy === 'reward'} onClick={() => void saveReward()}>{busy === 'reward' ? <LoaderCircle className="loyalty-spin" /> : <Save />} Lưu quyền lợi</button></footer></section></div> : null}

    {adjustingAccount ? <div className="loyalty-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) setAdjustingAccount(null) }}><section className="loyalty-modal loyalty-admin-editor" role="dialog" aria-modal="true" aria-labelledby="loyalty-adjust-title"><span>ĐIỀU CHỈNH CÓ KIỂM SOÁT</span><h2 id="loyalty-adjust-title">{adjustingAccount.studentName}</h2><p>Số dương để cộng, số âm để trừ. Điều chỉnh từ {formatNumber(largeAdjustmentThreshold)} điểm sẽ cần một Admin khác phê duyệt.</p><div className="loyalty-admin-editor__grid"><label>Số điểm<input type="number" step="1" value={adjustmentPoints} onChange={(event) => setAdjustmentPoints(event.target.value)} placeholder="Ví dụ: 100 hoặc -100" /></label><label className="is-wide">Lý do<textarea rows={3} value={adjustmentReason} onChange={(event) => setAdjustmentReason(event.target.value)} placeholder="Nêu rõ bằng chứng và lý do điều chỉnh" /></label></div><footer><button type="button" onClick={() => setAdjustingAccount(null)}>Đóng</button><button type="button" disabled={busy.startsWith('adjust-')} onClick={() => void submitAdjustment()}>{busy.startsWith('adjust-') ? <LoaderCircle className="loyalty-spin" /> : <Save />} Gửi điều chỉnh</button></footer></section></div> : null}
  </section>
}
