import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  Award,
  BadgeDollarSign,
  CheckCircle2,
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
  listLoyaltyRewardsAdmin,
  manageAmbassadorProfile,
  reviewLoyaltyAdjustment,
  saveLoyaltyReward,
} from './loyaltyService'
import type {
  LoyaltyAdminAccount,
  LoyaltyAdjustment,
  LoyaltyAdminAmbassador,
  LoyaltyAdminReward,
  LoyaltyTier,
} from './types'
import RewardEditor from './RewardEditor'
import RewardImage from './RewardImage'
import { isLoyaltyAccessError } from './loyaltyAccessError'

const memberTiers = [{ id: 'all', label: 'Tất cả' }, { id: 'member', label: 'Member' }, { id: 'silver', label: 'Silver' }, { id: 'gold', label: 'Gold' }, { id: 'diamond', label: 'Diamond' }] as const

export type OperationsTab = 'rewards' | 'ambassadors' | 'accounts' | 'adjustments'

interface AdminLoyaltyOperationsProps {
  requestedTab?: OperationsTab
  enabled?: boolean
  hideNavigation?: boolean
  onBusyChange?: (busy: boolean) => void
  cacheEpoch?: number
  isDemo?: boolean
  initialStudentId?: string
  canManageRewards?: boolean
  canManageAmbassadors?: boolean
  canAudit?: boolean
  canAdjust?: boolean
  canApproveAdjustments?: boolean
  largeAdjustmentThreshold?: number
  isScopeCurrent?: () => boolean
  onAccessDenied?: (error: unknown) => void
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

function formatNumber(value: number | null) {
  if (value === null) return "—"
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

export default function AdminLoyaltyOperations({
  requestedTab,
  enabled = true,
  hideNavigation = false,
  onBusyChange,
  cacheEpoch = 0,
  isDemo = false,
  initialStudentId,
  canManageRewards = false,
  canManageAmbassadors = false,
  canAdjust = false,
  canApproveAdjustments = false,
  largeAdjustmentThreshold = 500,
  isScopeCurrent = () => true,
  onAccessDenied,
}: AdminLoyaltyOperationsProps) {
  const availableTabs = useMemo(() => ([
    { id: 'accounts' as const, label: 'Thành viên', icon: Users },
    canManageRewards && { id: 'rewards' as const, label: 'Danh mục quà', icon: Award },
    canManageAmbassadors && { id: 'ambassadors' as const, label: 'Ambassador', icon: UserCheck },
    canApproveAdjustments && { id: 'adjustments' as const, label: 'Duyệt điểm', icon: ShieldCheck },
  ].filter(Boolean) as Array<{ id: OperationsTab; label: string; icon: typeof Award }>), [canApproveAdjustments, canManageAmbassadors, canManageRewards])
  const [localTab, setActiveTab] = useState<OperationsTab>('accounts')
  const activeTab = requestedTab ?? localTab
  const loadedTabs = useRef(new Map<OperationsTab, { key: string; at: number }>())
  const [rewards, setRewards] = useState<LoyaltyAdminReward[]>([])
  const [ambassadors, setAmbassadors] = useState<LoyaltyAdminAmbassador[]>([])
  const [accounts, setAccounts] = useState<LoyaltyAdminAccount[]>([])
  const [accountsTotal, setAccountsTotal] = useState<number | null>(null)
  const [directoryStale, setDirectoryStale] = useState(false)
  const [tierCounts, setTierCounts] = useState<Partial<Record<LoyaltyTier, number>>>({})
  const [publishedAccountScope, setPublishedAccountScope] = useState('')
  const [accountsHasMore, setAccountsHasMore] = useState(false)
  const [accountCursor, setAccountCursor] = useState<string | null>(null)
  const [accountsLoadingMore, setAccountsLoadingMore] = useState(false)
  const [adjustments, setAdjustments] = useState<LoyaltyAdjustment[]>([])
  const [editingReward, setEditingReward] = useState<LoyaltyAdminReward | null>(null)
  const [bannerFile, setBannerFile] = useState<File | null>(null)
  const [uploadProgress, setUploadProgress] = useState<number | null>(null)
  const [tierFilter, setTierFilter] = useState<LoyaltyTier | 'all'>('all')
  const [adjustingAccount, setAdjustingAccount] = useState<LoyaltyAdminAccount | null>(null)
  const [adjustmentPoints, setAdjustmentPoints] = useState('')
  const [adjustmentReason, setAdjustmentReason] = useState('')
  const [query, setQuery] = useState(initialStudentId || '')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [exactStudentId, setExactStudentId] = useState(initialStudentId || '')
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [accessDenied, setAccessDenied] = useState(false)
  const accessGeneration = useRef(0)
  const selectedAccountRef = useRef<HTMLElement>(null)
  const appliedStudentRef = useRef(initialStudentId || '')
  const loadGeneration = useRef(0)
  const rewardSavingRef = useRef(false)
  const mounted = useRef(false)
  const activeTabRef = useRef(activeTab)
  activeTabRef.current = activeTab
  const accountScope = JSON.stringify([exactStudentId, exactStudentId ? '' : tierFilter, exactStudentId ? '' : debouncedQuery])
  const currentAccountScope = useRef(accountScope)
  currentAccountScope.current = accountScope
  const currentAccess = () => {
    const generation = accessGeneration.current
    return () => mounted.current && isScopeCurrent() && generation === accessGeneration.current
  }
  const clearAccess = (cause: unknown) => {
    accessGeneration.current++; loadGeneration.current++; loadedTabs.current.clear()
    setRewards([]); setAmbassadors([]); setAccounts([]); setAccountsTotal(null); setTierCounts({})
    setAccountsHasMore(false); setAccountCursor(null); setAdjustments([])
    setEditingReward(null); setBannerFile(null); setUploadProgress(null); setAdjustingAccount(null)
    setAdjustmentPoints(''); setAdjustmentReason(''); setNotice(''); setBusy('')
    setLoading(false); setAccountsLoadingMore(false); setAccessDenied(true)
    setError(cause instanceof Error ? cause.message : 'Quyền truy cập Aura Club đã thay đổi.')
    onAccessDenied?.(cause)
  }
  const fail = (cause: unknown, fallback: string) => {
    if (isLoyaltyAccessError(cause)) clearAccess(cause)
    else setError(cause instanceof Error ? cause.message : fallback)
  }

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query.trim()), 350)
    return () => window.clearTimeout(timer)
  }, [query])

  useEffect(() => {
    loadedTabs.current.clear()
  }, [cacheEpoch, isDemo, canManageRewards, canManageAmbassadors, canApproveAdjustments])

  useEffect(() => {
    onBusyChange?.(Boolean(busy || editingReward || adjustingAccount))
    return () => onBusyChange?.(false)
  }, [busy, editingReward, adjustingAccount, onBusyChange])

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; loadGeneration.current += 1 }
  }, [])

  useEffect(() => {
    if (!availableTabs.some((item) => item.id === activeTab)) setActiveTab(availableTabs[0]?.id || 'accounts')
  }, [activeTab, availableTabs])

  useEffect(() => {
    if (!initialStudentId || appliedStudentRef.current === initialStudentId) return
    appliedStudentRef.current = initialStudentId
    setActiveTab('accounts')
    setQuery(initialStudentId)
    setExactStudentId(initialStudentId)
    setTierFilter('all')
  }, [initialStudentId])

  useEffect(() => {
    if (activeTab !== 'accounts' || loading || !initialStudentId) return
    const timer = window.setTimeout(() => {
      selectedAccountRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      selectedAccountRef.current?.focus({ preventScroll: true })
    }, 80)
    return () => window.clearTimeout(timer)
  }, [accounts, activeTab, initialStudentId, loading])

  const loadTab = async (tab: OperationsTab, appendAccounts = false) => {
    if (!enabled || !isScopeCurrent() || !availableTabs.some(item => item.id === tab) || !mounted.current || tab !== activeTabRef.current || (appendAccounts && (accountsLoadingMore || !accountCursor))) return
    const accessCurrent = currentAccess()
    const generation = ++loadGeneration.current
    loadedTabs.current.delete(tab)
    const isCurrent = () => accessCurrent() && generation === loadGeneration.current && tab === activeTabRef.current
      && (tab !== 'accounts' || accountScope === currentAccountScope.current)
    setAccessDenied(false)
    if (appendAccounts && tab === 'accounts') setAccountsLoadingMore(true)
    else { setLoading(true); setAccountsLoadingMore(false) }
    setError('')
    try {
      if (isDemo) {
        if (tab === 'rewards') setRewards([
          { ...emptyReward, id: 'assessment', name: 'InBody / Assessment', description: 'Đánh giá cơ thể và tư vấn nhanh.', pointsCost: 500, category: 'assessment', featured: true },
          { ...emptyReward, id: 'guest-pass', name: 'Guest Pass', description: 'Mời một người bạn trải nghiệm Aura.', pointsCost: 700, category: 'guest', stock: 20 },
        ])
        if (tab === 'ambassadors') setAmbassadors([{ id: 'demo', studentId: 'HV-001', studentName: 'Hải Anh', branchId: 'CS1', status: 'pending', note: 'Muốn chia sẻ hành trình tập luyện.', quarterId: '2026-Q3', qualifiedReferrals: 3, pendingCommissionVnd: 360_000, availableCommissionVnd: 150_000, paidCommissionVnd: 0, debtCommissionVnd: 0, revision: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }])
        if (tab === 'accounts') {
          const demoAccount = { studentId: 'HV-001', studentName: 'Hải Anh', branchId: 'CS1', status: 'active' as const, availablePoints: 2_480, pendingPoints: 180, reservedPoints: 0, debtPoints: 0, lifetimeEarnedPoints: 3_180, lifetimeRedeemedPoints: 700, tierQualifyingValue: 38_000_000, tier: 'gold' as const, tierProgress: { tier: 'gold' as const, nextTier: 'diamond' as const, currentValue: 38_000_000, targetValue: 50_000_000, remainingValue: 12_000_000, percent: 52 }, revision: 1, walletInitialized: true }
          setAccounts(appendAccounts ? (current) => [...current, demoAccount] : [demoAccount])
          setAccountsTotal(1)
          setPublishedAccountScope(accountScope)
          setTierCounts({ member: 0, silver: 0, gold: 1, diamond: 0 })
          setAccountsHasMore(false)
          setAccountCursor(null)
        }
        if (tab === 'adjustments') setAdjustments([{ id: 'demo-adjustment', studentId: 'HV-001', studentName: 'Hải Anh', branchId: 'CS1', points: 700, reason: 'Bù điểm chiến dịch khai trương', status: 'pending_approval', requestedBy: 'admin-other', createdAt: new Date().toISOString(), reviewedAt: '' }])
        loadedTabs.current.set(tab, { key: accountScope, at: Date.now() })
        return
      }
      if (tab === 'rewards') {
        const result = await listLoyaltyRewardsAdmin()
        if (isCurrent()) setRewards(result.rewards)
      }
      if (tab === 'ambassadors') {
        const result = await listLoyaltyAmbassadors()
        if (isCurrent()) setAmbassadors(result.ambassadors)
      }
      if (tab === 'accounts') {
        const directory = new Map((appendAccounts ? accounts : []).map(account => [account.studentId, account]))
        const cursor = appendAccounts ? accountCursor : null
        if (!appendAccounts) { setAccounts([]); setAccountsTotal(null); setTierCounts({}); setAccountsHasMore(false); setAccountCursor(null) }
        const page = await listLoyaltyAccounts({ directoryVersion: 2, pageSize: 30, includeTotal: !appendAccounts,
          ...(exactStudentId ? { studentId: exactStudentId } : { tier: tierFilter, query: debouncedQuery, ...(cursor ? { cursor } : {}) }) })
        if (!isCurrent()) return
        if (page.schemaVersion !== 2) throw new Error('Danh sách thành viên đang được cập nhật. Vui lòng thử lại sau.')
        if (page.hasMore && (!page.nextCursor || page.nextCursor === cursor)) throw new Error('Chưa tải đủ thành viên. Vui lòng tải lại danh sách.')
        for (const account of page.accounts) directory.set(account.studentId, account)
        setAccounts([...directory.values()])
        setPublishedAccountScope(accountScope)
        if (page.totalCount !== null) setAccountsTotal(page.totalCount)
        if (page.tierCounts) setTierCounts(page.tierCounts)
        setDirectoryStale(page.directoryStale === true)
        setAccountsHasMore(page.hasMore === true && !exactStudentId)
        setAccountCursor(page.nextCursor)
      }
      if (tab === 'adjustments') {
        const result = await listLoyaltyAdjustments('pending_approval')
        if (isCurrent()) setAdjustments(result.adjustments)
      }
      if (isCurrent()) loadedTabs.current.set(tab, { key: accountScope, at: Date.now() })
    } catch (cause) {
      if (isCurrent()) fail(cause, 'Không thể tải dữ liệu Aura Club.')
    } finally {
      if (isCurrent()) {
        setAccountsLoadingMore(false)
        setLoading(false)
      }
    }
  }

  const reviewAdjustment = async (adjustmentId: string, decision: 'approve' | 'reject') => {
    const current = currentAccess()
    if (!current()) return
    if (!window.confirm(decision === 'approve' ? 'Duyệt điều chỉnh điểm này?' : 'Từ chối điều chỉnh điểm này?')) return
    setBusy(`review-${adjustmentId}`)
    setError('')
    try {
      if (!isDemo) await reviewLoyaltyAdjustment(adjustmentId, decision)
      if (!current()) return
      loadedTabs.current.delete('accounts')
      setAdjustments((current) => current.filter((item) => item.id !== adjustmentId))
      setNotice(decision === 'approve' ? 'Đã duyệt, cập nhật điểm và thông báo cho học viên.' : 'Đã từ chối điều chỉnh. Số dư không thay đổi.')
    } catch (cause) {
      if (current()) fail(cause, 'Không thể xử lý yêu cầu điều chỉnh.')
    } finally {
      if (current()) setBusy('')
    }
  }

  useEffect(() => {
    if (enabled) {
      const cached = loadedTabs.current.get(activeTab)
      if (cached && (activeTab !== 'accounts' || cached.key === accountScope) && Date.now() - cached.at < 60_000) {
        setLoading(false)
        setAccountsLoadingMore(false)
        setError('')
      } else void loadTab(activeTab)
    }
    return () => { loadGeneration.current += 1 }
  }, [activeTab, isDemo, accountScope, enabled, cacheEpoch, canManageRewards, canManageAmbassadors, canApproveAdjustments])

  const saveReward = async () => {
    const current = currentAccess()
    if (!current()) return
    if (busy || rewardSavingRef.current) return
    if (!editingReward || !editingReward.name.trim() || editingReward.pointsCost <= 0) {
      setError('Tên quyền lợi và số điểm đổi phải hợp lệ.')
      return
    }
    if (editingReward.fulfillmentType === 'automatic' && editingReward.entitlementType !== 'extra_reschedule') {
      setError('Quyền lợi cấp tự động hiện chỉ hỗ trợ thêm một lần đổi lịch.')
      return
    }
    rewardSavingRef.current = true
    setBusy('reward')
    setError('')
    try {
      let draft = { ...editingReward }
      if (bannerFile) {
        draft.id ||= crypto.randomUUID()
        if (isDemo) {
          draft.bannerUrl = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader()
            reader.onload = () => resolve(String(reader.result))
            reader.onerror = () => reject(new Error('Không đọc được ảnh.'))
            reader.readAsDataURL(bannerFile)
          })
        } else {
          setUploadProgress(0)
          const { uploadRewardBanner } = await import('./rewardMediaService')
          Object.assign(draft, await uploadRewardBanner(bannerFile, draft.id, value => { if (current()) setUploadProgress(value) }))
        }
        if (!current()) return
        setEditingReward(draft)
        setBannerFile(null)
        setUploadProgress(null)
      }
      if (isDemo) {
        const next = { ...draft, id: draft.id || `demo-${Date.now()}`, revision: draft.revision + 1, persisted: true }
        setRewards((current) => current.some((item) => item.id === next.id) ? current.map((item) => item.id === next.id ? next : item) : [...current, next])
      } else {
        const result = await saveLoyaltyReward(draft)
        if (!current()) return
        const next = { ...draft, id: result.rewardId, revision: result.revision, persisted: true }
        setRewards((current) => current.some((item) => item.id === result.rewardId || (editingReward.id && item.id === editingReward.id))
          ? current.map((item) => item.id === result.rewardId || (editingReward.id && item.id === editingReward.id) ? next : item)
          : [...current, next])
      }
      setEditingReward(null)
      setNotice('Đã lưu quà tặng.')
    } catch (cause) {
      if (current()) fail(cause, 'Không thể lưu quyền lợi.')
    } finally {
      if (current()) setUploadProgress(null)
      rewardSavingRef.current = false
      if (current()) setBusy('')
    }
  }

  const updateAmbassador = async (studentId: string, status: 'approved' | 'rejected' | 'suspended') => {
    const current = currentAccess()
    if (!current()) return
    if (status !== 'approved' && !window.confirm(status === 'suspended' ? 'Tạm dừng Ambassador này?' : 'Từ chối đăng ký Ambassador này?')) return
    setBusy(`ambassador-${studentId}`)
    setError('')
    try {
      if (!isDemo) await manageAmbassadorProfile(studentId, status)
      if (!current()) return
      setAmbassadors((current) => current.map((item) => item.studentId === studentId ? { ...item, status } : item))
      setNotice(status === 'approved' ? 'Đã duyệt Aura Ambassador.' : status === 'suspended' ? 'Đã tạm dừng Ambassador.' : 'Đã từ chối đăng ký.')
    } catch (cause) {
      if (current()) fail(cause, 'Không thể cập nhật Ambassador.')
    } finally {
      if (current()) setBusy('')
    }
  }

  const payAmbassador = async (studentId: string) => {
    const current = currentAccess()
    if (!current()) return
    if (!window.confirm('Duyệt chi toàn bộ hoa hồng khả dụng cho Ambassador này?')) return
    setBusy(`payout-${studentId}`)
    setError('')
    try {
      const result = isDemo ? { amountVnd: ambassadors.find((item) => item.studentId === studentId)?.availableCommissionVnd || 0 } : await approveAmbassadorPayout(studentId)
      if (!current()) return
      setAmbassadors((current) => current.map((item) => item.studentId === studentId ? { ...item, availableCommissionVnd: 0, paidCommissionVnd: item.paidCommissionVnd + result.amountVnd } : item))
      setNotice(`Đã duyệt chi ${formatMoney(result.amountVnd)}. Chứng từ payout đã được lưu.`)
    } catch (cause) {
      if (current()) fail(cause, 'Không thể duyệt chi hoa hồng.')
    } finally {
      if (current()) setBusy('')
    }
  }

  const submitAdjustment = async () => {
    const current = currentAccess()
    if (!current()) return
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
      if (!current()) return
      loadGeneration.current += 1
      loadedTabs.current.delete('adjustments')
      setNotice(result.status === 'pending_approval' ? 'Điều chỉnh lớn đã chuyển sang chờ một Admin khác phê duyệt.' : 'Đã áp dụng điều chỉnh và lưu lịch sử.')
      setAdjustingAccount(null)
      setAdjustmentPoints('')
      setAdjustmentReason('')
      if (result.status === 'applied') await loadTab('accounts')
    } catch (cause) {
      if (current()) fail(cause, 'Không thể gửi điều chỉnh.')
    } finally {
      if (current()) setBusy('')
    }
  }

  const normalizedQuery = query.trim().toLocaleLowerCase('vi')
  const searchPending = !exactStudentId && query.trim() !== debouncedQuery
  const visibleAccounts = publishedAccountScope !== accountScope || searchPending ? [] : isDemo
    ? accounts.filter((item) => (!normalizedQuery || item.studentName.toLocaleLowerCase('vi').includes(normalizedQuery)) && (tierFilter === 'all' || item.tier === tierFilter))
    : accounts
  const editReward = (reward: LoyaltyAdminReward) => { setBannerFile(null); setUploadProgress(null); setError(''); setEditingReward({ ...reward }) }
  const closeReward = () => { if (!busy) { setEditingReward(null); setBannerFile(null); setError('') } }

  if (accessDenied) return <div className="loyalty-state loyalty-state--error" role="alert"><AlertTriangle /><strong>Quyền truy cập đã thay đổi</strong><span>{error}</span><button type="button" onClick={() => void loadTab(activeTab)}>Thử lại</button></div>

  return <section className="loyalty-admin-card loyalty-admin-operations">
    {activeTab !== 'accounts' && <header><div><h2>{availableTabs.find(item => item.id === activeTab)?.label || 'Thành viên'}</h2></div>{hideNavigation ? <button type="button" className="club-icon-button" aria-label="Tải lại tab đang mở" disabled={Boolean(busy)} onClick={() => void loadTab(activeTab)}><RefreshCw /></button> : <ShieldCheck />}</header>}
    {!hideNavigation ? <nav className="loyalty-admin-operations__tabs" aria-label="Nghiệp vụ Aura Club">
      {availableTabs.map((item) => <button type="button" className={activeTab === item.id ? 'is-active' : ''} disabled={Boolean(busy)} key={item.id} onClick={() => { setNotice(''); setError(''); setActiveTab(item.id) }}><item.icon /> {item.label}</button>)}
      <button type="button" className="is-refresh" aria-label="Tải lại tab đang mở" disabled={Boolean(busy)} onClick={() => void loadTab(activeTab)}><RefreshCw /></button>
    </nav> : null}

    {error ? <div className="loyalty-inline-alert" role="alert"><AlertTriangle size={17} /> {error}</div> : null}
    {notice ? <div className="loyalty-inline-notice" role="status"><CheckCircle2 size={17} /> {notice}</div> : null}
    {loading ? <div className="loyalty-admin-operations__loading" role="status"><LoaderCircle className="loyalty-spin" /> Đang tải dữ liệu…</div> : null}

    {!loading && activeTab === 'rewards' ? <div className="loyalty-admin-rewards">
      <div className="loyalty-admin-sectionbar"><div><strong>{rewards.length} quà tặng</strong></div><button type="button" onClick={() => editReward(emptyReward)}><Plus /> Thêm quà</button></div>
      <div className="loyalty-admin-rewards__grid">{rewards.map((reward) => <article key={reward.id} className={!reward.active ? 'is-inactive' : ''}>
        <RewardImage src={reward.bannerUrl} name={reward.name} rewardId={reward.id} />
        {(!reward.active || reward.featured) && <div>{!reward.active && <span>Tạm ẩn</span>}{reward.featured && <b>Nổi bật</b>}</div>}<h3>{reward.name}</h3>{reward.description && <p>{reward.description}</p>}<footer><strong>{formatNumber(reward.pointsCost)} điểm</strong><small>{reward.stock === null ? 'Không giới hạn' : `Còn ${formatNumber(reward.stock)}`}</small><button type="button" onClick={() => editReward(reward)}><Pencil /> Sửa</button></footer>
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

    {!loading && activeTab === 'accounts' ? <div className="loyalty-admin-accounts" id="loyalty-accounts">
      <div className="club-members-heading"><div><strong title="Số lượng theo danh sách đã đồng bộ">{formatNumber(accountsTotal)} thành viên</strong><span>Đang tập, bảo lưu hoặc trong hạn chờ tái ký</span></div>{hideNavigation && <button type="button" className="club-icon-button" aria-label="Tải lại tab đang mở" disabled={Boolean(busy) || accountsLoadingMore} onClick={() => void loadTab('accounts')}><RefreshCw /></button>}</div>
      <div className="club-tier-tabs" role="tablist" aria-label="Hạng thành viên">
        {memberTiers.map((tier, index) => <button key={tier.id} type="button" role="tab" aria-selected={tierFilter === tier.id} aria-controls="club-tier-members" tabIndex={tierFilter === tier.id ? 0 : -1} onClick={() => setTierFilter(tier.id)} onKeyDown={(event) => {
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
          event.preventDefault()
          const next = event.key === 'Home' ? 0 : event.key === 'End' ? memberTiers.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + memberTiers.length) % memberTiers.length
          setTierFilter(memberTiers[next].id)
          ;(event.currentTarget.parentElement?.children[next] as HTMLButtonElement)?.focus()
        }}><i className={`club-tier-dot is-${tier.id}`} />{tier.label}{' '}<b>{publishedAccountScope !== accountScope || searchPending ? '…' : !Object.keys(tierCounts).length ? '—' : formatNumber(tier.id === 'all' ? Object.values(tierCounts).reduce((total, count) => total + (count || 0), 0) : tierCounts[tier.id] || 0)}</b></button>)}
      </div>
      {directoryStale && <p role="status">Danh sách đang đồng bộ, hãy làm mới.</p>}
      <div className="club-member-search-row">
        <label className="loyalty-admin-search"><Search /><input aria-label="Tìm thành viên" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tên hoặc số điện thoại" /></label>
        {query.trim() && <button type="button" aria-label="Tìm chính xác mã" disabled={Boolean(busy) || accountsLoadingMore} onClick={() => { setTierFilter('all'); if (exactStudentId === query.trim()) void loadTab('accounts'); else setExactStudentId(query.trim()) }}>Tìm mã</button>}
        {exactStudentId && <button type="button" disabled={Boolean(busy)} onClick={() => { setQuery(''); setExactStudentId(''); setTierFilter('all') }}>Về danh sách</button>}
      </div>
      {(exactStudentId || accountsHasMore || normalizedQuery || tierFilter !== 'all') && <div className="loyalty-admin-sectionbar loyalty-admin-accounts__summary"><div><span role="status">{exactStudentId ? `Mã: ${exactStudentId}` : accountsHasMore ? `${accountsLoadingMore ? 'Đang tải' : 'Đã tải'} ${formatNumber(accounts.length)} / ${formatNumber(accountsTotal)} thành viên` : `${formatNumber(visibleAccounts.length)} / ${formatNumber(accountsTotal)} thành viên`}</span></div>{accountsHasMore && accountCursor && !accountsLoadingMore ? <button type="button" onClick={() => void loadTab('accounts', true)} disabled={Boolean(busy) || searchPending}>Tải tiếp</button> : null}</div>}
      <div className="loyalty-admin-list" id="club-tier-members" role="tabpanel" aria-label={`Thành viên ${memberTiers.find((tier) => tier.id === tierFilter)?.label}`}>{visibleAccounts.length ? visibleAccounts.map((item) => <article key={item.studentId} ref={item.studentId === initialStudentId ? selectedAccountRef : undefined} tabIndex={item.studentId === initialStudentId ? -1 : undefined} className={item.studentId === initialStudentId ? 'is-focused-account' : undefined}>
        <div className="loyalty-admin-list__identity"><strong>{item.studentName}</strong><small><b className={`club-tier-badge is-${item.tier}`}>{memberTiers.find((tier) => tier.id === item.tier)?.label}</b> {formatMoney(item.tierQualifyingValue)}</small></div>
        <div><span>Khả dụng</span><strong>{formatNumber(item.availablePoints)}</strong>{item.pendingPoints > 0 && <small>{formatNumber(item.pendingPoints)} đang chờ</small>}</div>
        <div><span>Đã đổi</span><strong>{formatNumber(item.lifetimeRedeemedPoints)}</strong>{item.debtPoints > 0 && <small className="is-debt">Nợ {formatNumber(item.debtPoints)}</small>}</div>
        <div><span>Trạng thái</span><strong>{item.membershipState === 'grace' ? 'Chờ tái ký' : item.membershipState === 'paused' ? 'Bảo lưu' : 'Đang tập'}</strong>{item.membershipState === 'grace' && item.manageUntil ? <small>Đến {new Intl.DateTimeFormat('vi-VN').format(new Date(item.manageUntil + 'T00:00:00+07:00'))}</small> : null}</div>
        <div className="loyalty-admin-actions">{canAdjust ? <button type="button" disabled={Boolean(busy) || accountsLoadingMore} onClick={() => setAdjustingAccount(item)}>Điều chỉnh</button> : null}</div>
      </article>) : <div className="loyalty-empty loyalty-empty--compact"><Users /><h3>{exactStudentId ? 'Không có học viên phù hợp trong phạm vi truy cập' : searchPending ? 'Đang tìm thành viên…' : 'Không tìm thấy thành viên'}</h3><p>{exactStudentId ? 'Kiểm tra lại mã học viên hoặc quay về danh sách.' : searchPending ? 'Đang cập nhật kết quả tìm kiếm.' : 'Thử tên khác hoặc đổi hạng thành viên.'}</p></div>}</div>
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


    {editingReward && <RewardEditor reward={editingReward} busy={busy === 'reward'} error={error} progress={uploadProgress} file={bannerFile} onFile={setBannerFile} onChange={setEditingReward} onSave={() => void saveReward()} onClose={closeReward} />}

    {adjustingAccount ? <div className="loyalty-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) setAdjustingAccount(null) }}><section className="loyalty-modal loyalty-admin-editor" role="dialog" aria-modal="true" aria-labelledby="loyalty-adjust-title"><span>Điều chỉnh điểm</span><h2 id="loyalty-adjust-title">{adjustingAccount.studentName}</h2><p>Số dương để cộng, số âm để trừ. Điều chỉnh từ {formatNumber(largeAdjustmentThreshold)} điểm sẽ cần một Admin khác phê duyệt.</p><div className="loyalty-admin-editor__grid"><label>Số điểm<input type="number" step="1" value={adjustmentPoints} onChange={(event) => setAdjustmentPoints(event.target.value)} placeholder="Ví dụ: 100 hoặc -100" /></label><label className="is-wide">Lý do<textarea rows={3} value={adjustmentReason} onChange={(event) => setAdjustmentReason(event.target.value)} placeholder="Nêu rõ bằng chứng và lý do điều chỉnh" /></label></div><footer><button type="button" onClick={() => setAdjustingAccount(null)}>Đóng</button><button type="button" disabled={busy.startsWith('adjust-')} onClick={() => void submitAdjustment()}>{busy.startsWith('adjust-') ? <LoaderCircle className="loyalty-spin" /> : <Save />} Gửi điều chỉnh</button></footer></section></div> : null}
  </section>
}
