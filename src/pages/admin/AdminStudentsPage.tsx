import {
  Activity,
  AlertCircle,
  Bell,
  CalendarCheck,
  Check,
  CheckCircle2,
  ChevronDown,
  ClipboardList,
  Copy,
  Download,
  Dumbbell,
  HeartPulse,
  Key,
  Mail,
  Phone,
  Search,
  Send,
  ShieldCheck,
  SlidersHorizontal,
  Smartphone,
  Sparkles,
  Target,
  UserPlus,
  Users,
  X,
  Zap,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import '../../styles-admin.css'
import PtClientSchedulePanel from '../../components/coaching/PtClientSchedulePanel'
import { PageHeader } from '../../components/ui'
import { createNotification } from '../../services/notificationService'
import {
  createStudentAccount,
  loadPtClientProfiles,
  listPublishedPtPrograms,
  listPtClients,
  onboardPtClientByEmail,
  savePtClientProfile,
  type CreatedStudentAccountResult,
  type PtClientDirectoryRecord,
  type PtClientProfile,
  type PtCoachingStatus,
  type PublishedPtProgramOption,
} from '../../services/ptCoachingClientService'
import type { AdminStudentDirectoryItem } from '../../types'
import '../../styles-coaching.css'

interface AdminStudentsPageProps {
  students: AdminStudentDirectoryItem[]
  loading?: boolean
  error?: string | null
  onRetry?: () => void
  initialQuery?: string
}

type SortKey = 'name' | 'checkIn' | 'readiness'
type ClientDrawerTab = 'profile' | 'schedule' | 'push'

type DisplayClient = AdminStudentDirectoryItem & {
  normalizedName: string
  initials: string
  coaching: PtClientProfile
}

const coachingStatusLabels: Record<PtCoachingStatus, string> = {
  active: 'Đang coaching',
  onboarding: 'Đang thiết lập',
  paused: 'Tạm dừng',
  completed: 'Đã hoàn thành',
}

function emptyProfile(clientId: string): PtClientProfile {
  return {
    clientId,
    coachId: '',
    goal: '',
    coachingStatus: 'onboarding',
    currentProgramName: '',
    currentProgramId: '',
    currentVersionId: '',
    activeAssignmentCycleId: '',
    lastAssignmentCycleId: '',
    readiness: null,
    sleepHours: null,
    soreness: null,
    bodyWeightKg: null,
    nextCheckInDate: '',
    coachNotes: '',
  }
}

function timestampToDate(value: unknown): Date | null {
  if (!value) return null
  if (value instanceof Date) return value
  if (typeof value === 'number' || typeof value === 'string') {
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? null : date
  }
  if (typeof value === 'object' && value !== null && 'toDate' in value && typeof value.toDate === 'function') {
    const date = value.toDate()
    return date instanceof Date ? date : null
  }
  return null
}

function initials(name: string, email: string) {
  const source = (name?.trim() || email?.trim() || 'KH').split('@')[0]
  return source.split(/\s+/).map((part) => part[0]).filter(Boolean).slice(0, 2).join('').toUpperCase().padEnd(2, 'A')
}

function formatDate(value: unknown) {
  const date = timestampToDate(value)
  if (!date) return 'Chưa check-in'
  return new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(date)
}

function daysSince(value: unknown) {
  const date = timestampToDate(value)
  if (!date) return Number.POSITIVE_INFINITY
  return Math.max(0, Math.floor((Date.now() - date.getTime()) / 86_400_000))
}

function downloadCSV(clients: DisplayClient[]) {
  if (!clients.length) return
  const headers = ['Khách hàng', 'Email', 'Mục tiêu', 'Trạng thái coaching', 'Giáo án', 'Readiness', 'Ngủ', 'Đau mỏi', 'Check-in gần nhất']
  const rows = clients.map((client) => [
    client.displayName,
    client.email,
    client.coaching.goal,
    coachingStatusLabels[client.coaching.coachingStatus],
    client.coaching.currentProgramName,
    client.coaching.readiness?.toString() ?? '',
    client.coaching.sleepHours?.toString() ?? '',
    client.coaching.soreness?.toString() ?? '',
    formatDate(client.coaching.lastCheckInAt),
  ])
  const escape = (value: string) => `"${String(value).replace(/"/g, '""')}"`
  const csv = [headers, ...rows].map((row) => row.map(escape).join(',')).join('\n')
  const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' })
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = `aura-pt-clients-${new Date().toISOString().slice(0, 10)}.csv`
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(link.href), 1_200)
}

export default function AdminStudentsPage({
  students,
  loading = false,
  error = null,
  onRetry,
  initialQuery = '',
}: AdminStudentsPageProps) {
  const fallbackCandidates = useMemo(() => students.filter((student) => !['shipper', 'admin', 'super_admin'].includes(student.role)), [students])
  const [directoryClients, setDirectoryClients] = useState<PtClientDirectoryRecord[] | null>(null)
  const [profiles, setProfiles] = useState<Record<string, PtClientProfile>>({})
  const [profilesLoading, setProfilesLoading] = useState(false)
  const [profileError, setProfileError] = useState<string | null>(null)
  const [query, setQuery] = useState(initialQuery)
  const [statusFilter, setStatusFilter] = useState<'all' | PtCoachingStatus>('all')
  const [programFilter, setProgramFilter] = useState('all')
  const [sortBy, setSortBy] = useState<SortKey>('checkIn')
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null)
  const [drawerTab, setDrawerTab] = useState<ClientDrawerTab>('profile')
  const [profileDraft, setProfileDraft] = useState<PtClientProfile | null>(null)
  const [savingProfile, setSavingProfile] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [inviteOpen, setInviteOpen] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteCopied, setInviteCopied] = useState(false)
  const [inviteSaving, setInviteSaving] = useState(false)
  const [inviteError, setInviteError] = useState<string | null>(null)
  const [publishedPrograms, setPublishedPrograms] = useState<PublishedPtProgramOption[]>([])
  const [programsLoading, setProgramsLoading] = useState(false)

  // Direct Push Notification state
  const [directPushTitle, setDirectPushTitle] = useState('')
  const [directPushMessage, setDirectPushMessage] = useState('')
  const [directPushType, setDirectPushType] = useState<'REMINDER' | 'ANNOUNCEMENT' | 'WORKOUT' | 'MOTIVATION' | 'INFO'>('REMINDER')
  const [directPushSending, setDirectPushSending] = useState(false)
  const [directPushSuccess, setDirectPushSuccess] = useState<string | null>(null)
  const [directPushError, setDirectPushError] = useState<string | null>(null)

  // Add/Create Student Account state
  const [addMode, setAddMode] = useState<'create' | 'link'>('create')
  const [createName, setCreateName] = useState('')
  const [createPhone, setCreatePhone] = useState('')
  const [createEmail, setCreateEmail] = useState('')
  const [createGoal, setCreateGoal] = useState('')
  const [createSaving, setCreateSaving] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [createdAccountResult, setCreatedAccountResult] = useState<CreatedStudentAccountResult | null>(null)
  const [copiedAccountInfo, setCopiedAccountInfo] = useState(false)

  const handlePhoneChange = (val: string) => {
    setCreatePhone(val)
  }

  const handleCreateStudent = async () => {
    if (!createName.trim() || !createPhone.trim()) {
      setCreateError('Vui lòng nhập họ tên và số điện thoại của học viên.')
      return
    }
    setCreateSaving(true)
    setCreateError(null)
    try {
      const result = await createStudentAccount({
        displayName: createName.trim(),
        phoneNumber: createPhone.trim(),
        email: createEmail.trim(),
        goal: createGoal.trim(),
      })
      setCreatedAccountResult(result)
      const records = await listPtClients()
      if (records) {
        setDirectoryClients(records)
      }
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Không thể tạo tài khoản học viên.')
    } finally {
      setCreateSaving(false)
    }
  }

  const copyCreatedAccountInfo = async () => {
    if (!createdAccountResult) return
    const appUrl = window.location.origin
    const passwordPhone = createdAccountResult.phoneNumber.replace(/^\+84/, '0').replace(/\D/g, '')
    const text = `Xin chào ${createdAccountResult.displayName}!\nAura Fitness đã tạo tài khoản cho bạn.\n\n🌐 Mở ứng dụng: ${appUrl}\n📧 Email đăng nhập: ${createdAccountResult.email}\n🔐 Mật khẩu ban đầu: ${passwordPhone}\n\nSau khi đăng nhập, bạn có thể vào Hồ sơ cá nhân > Bảo mật nếu muốn đổi mật khẩu.`
    await navigator.clipboard.writeText(text)
    setCopiedAccountInfo(true)
    window.setTimeout(() => setCopiedAccountInfo(false), 2200)
  }

  const resetAddModal = () => {
    setInviteOpen(false)
    setAddMode('create')
    setCreateName('')
    setCreatePhone('')
    setCreateEmail('')
    setCreateGoal('')
    setCreateError(null)
    setCreatedAccountResult(null)
    setCopiedAccountInfo(false)
    setInviteEmail('')
    setInviteError(null)
  }

  const handleSendDirectPush = async () => {
    if (!selectedClient || !directPushTitle.trim() || !directPushMessage.trim()) return
    setDirectPushSending(true)
    setDirectPushSuccess(null)
    setDirectPushError(null)
    try {
      await createNotification(selectedClient.uid, {
        title: directPushTitle.trim(),
        message: directPushMessage.trim(),
        type: directPushType,
        actionUrl: '/home'
      })
      setDirectPushSuccess(`Đã gửi thông báo đẩy trực tiếp đến thiết bị học viên ${selectedClient.displayName}!`)
      setDirectPushTitle('')
      setDirectPushMessage('')
    } catch (err) {
      setDirectPushError(err instanceof Error ? err.message : 'Không thể gửi thông báo đẩy.')
    } finally {
      setDirectPushSending(false)
    }
  }

  const ptCandidates = useMemo<AdminStudentDirectoryItem[]>(() => {
    if (!directoryClients) return fallbackCandidates
    const relatedIds = new Set(directoryClients.map((client) => client.clientId))
    const relatedClients = directoryClients.map((client) => ({
      uid: client.clientId,
      displayName: client.displayName,
      email: client.email,
      role: 'student',
      membership: client.membership,
      status: client.accountStatus === 'disabled' ? 'inactive' : 'active',
      programs: [],
      totalEnrollments: 0,
      activeEnrollments: 0,
      completedEnrollments: 0,
      averageProgress: 0,
      streak: 0,
      lastActivityAt: client.coaching.lastCheckInAt,
    } satisfies AdminStudentDirectoryItem))
    // Admins receive the account directory through props, so unassigned
    // students remain visible and can be onboarded into PT Coaching. Coaches
    // only receive identities returned by the scoped callable/rules.
    return [...relatedClients, ...fallbackCandidates.filter((student) => !relatedIds.has(student.uid))]
  }, [directoryClients, fallbackCandidates])

  useEffect(() => {
    let active = true
    setProfilesLoading(true)
    setProfileError(null)
    listPtClients()
      .then(async (records) => {
        if (!active) return
        setDirectoryClients(records)
        const clientIds = records
          ? [...new Set([...records.map((client) => client.clientId), ...fallbackCandidates.map((student) => student.uid)])]
          : fallbackCandidates.map((student) => student.uid)
        if (!clientIds.length) {
          setProfiles({})
          return
        }
        const detailed = await loadPtClientProfiles(clientIds)
        if (!active) return
        const directoryProfiles = Object.fromEntries((records ?? []).map((client) => [client.clientId, client.coaching]))
        setProfiles({ ...directoryProfiles, ...detailed })
      })
      .catch((caught: unknown) => {
        if (!active) return
        setDirectoryClients(null)
        setProfileError(caught instanceof Error ? caught.message : 'Không thể tải hồ sơ PT Coaching.')
      })
      .finally(() => { if (active) setProfilesLoading(false) })
    return () => { active = false }
  }, [fallbackCandidates])

  useEffect(() => {
    let active = true
    setProgramsLoading(true)
    void listPublishedPtPrograms()
      .then((items) => { if (active) setPublishedPrograms(items) })
      .catch((caught: unknown) => {
        if (active) setProfileError(caught instanceof Error ? caught.message : 'Không thể tải danh sách giáo án đã xuất bản.')
      })
      .finally(() => { if (active) setProgramsLoading(false) })
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (!selectedClientId && !inviteOpen) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || savingProfile || inviteSaving) return
      if (inviteOpen) setInviteOpen(false)
      else closeClient()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  })

  const displayClients = useMemo<DisplayClient[]>(() => ptCandidates.map((student) => ({
    ...student,
    normalizedName: `${student.displayName} ${student.email}`.toLocaleLowerCase('vi'),
    initials: initials(student.displayName, student.email),
    coaching: profiles[student.uid] ?? emptyProfile(student.uid),
  })), [profiles, ptCandidates])

  const availablePrograms = useMemo(() => [
    'all',
    ...new Set(displayClients.map((client) => client.coaching.currentProgramName).filter(Boolean)),
  ], [displayClients])

  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('vi')
    return displayClients
      .filter((client) => {
        const matchText = !normalized || client.normalizedName.includes(normalized) || client.coaching.goal.toLocaleLowerCase('vi').includes(normalized)
        const matchStatus = statusFilter === 'all' || client.coaching.coachingStatus === statusFilter
        const matchProgram = programFilter === 'all' || client.coaching.currentProgramName === programFilter
        return matchText && matchStatus && matchProgram
      })
      .sort((left, right) => {
        if (sortBy === 'name') return left.normalizedName.localeCompare(right.normalizedName, 'vi')
        if (sortBy === 'readiness') return (left.coaching.readiness ?? -1) - (right.coaching.readiness ?? -1)
        return daysSince(right.coaching.lastCheckInAt) - daysSince(left.coaching.lastCheckInAt)
      })
  }, [displayClients, programFilter, query, sortBy, statusFilter])

  const stats = useMemo(() => ({
    total: displayClients.length,
    active: displayClients.filter((client) => client.coaching.coachingStatus === 'active').length,
    onboarding: displayClients.filter((client) => client.coaching.coachingStatus === 'onboarding').length,
    needsAttention: displayClients.filter((client) => daysSince(client.coaching.lastCheckInAt) >= 7 || (client.coaching.readiness ?? 5) <= 2).length,
  }), [displayClients])

  const selectedClient = displayClients.find((client) => client.uid === selectedClientId)
  const registrationUrl = `${window.location.origin}${window.location.pathname}`
  const inviteMessage = `Bạn được PT mời tham gia Aura Fitness Coaching. Tạo tài khoản tại: ${registrationUrl}`

  const openClient = (client: DisplayClient) => {
    setSelectedClientId(client.uid)
    setProfileDraft({ ...client.coaching })
    setDrawerTab('profile')
    setSaveError(null)
    setDirectPushTitle('')
    setDirectPushMessage('')
    setDirectPushSuccess(null)
    setDirectPushError(null)
  }

  const closeClient = () => {
    setSelectedClientId(null)
    setProfileDraft(null)
    setDrawerTab('profile')
    setSaveError(null)
    setDirectPushSuccess(null)
    setDirectPushError(null)
  }

  const saveProfile = async () => {
    if (!profileDraft) return
    setSavingProfile(true)
    setSaveError(null)
    try {
      const saved = await savePtClientProfile(profileDraft)
      setProfiles((current) => ({ ...current, [saved.clientId]: saved }))
      setProfileDraft(saved)
    } catch (caught) {
      setSaveError(caught instanceof Error ? caught.message : 'Không thể lưu hồ sơ coaching.')
    } finally {
      setSavingProfile(false)
    }
  }

  const copyInvite = async () => {
    await navigator.clipboard.writeText(inviteMessage)
    setInviteCopied(true)
    window.setTimeout(() => setInviteCopied(false), 1_800)
  }

  const openInviteEmail = () => {
    const subject = encodeURIComponent('Lời mời tham gia Aura Fitness Coaching')
    const body = encodeURIComponent(inviteMessage)
    window.location.href = `mailto:${encodeURIComponent(inviteEmail.trim())}?subject=${subject}&body=${body}`
  }

  const addExistingClient = async () => {
    if (!inviteEmail.trim()) return
    setInviteSaving(true)
    setInviteError(null)
    try {
      const client = await onboardPtClientByEmail(inviteEmail)
      setDirectoryClients((current) => [client, ...(current ?? []).filter((item) => item.clientId !== client.clientId)])
      setProfiles((current) => ({ ...current, [client.clientId]: client.coaching }))
      setInviteEmail('')
      setInviteOpen(false)
    } catch (caught) {
      setInviteError(caught instanceof Error ? caught.message : 'Không thể thêm khách hàng vào PT Coaching.')
    } finally {
      setInviteSaving(false)
    }
  }

  const selectProgram = (value: string) => {
    const selected = publishedPrograms.find((program) => `${program.id}::${program.currentVersionId}` === value)
    setProfileDraft((current) => current ? {
      ...current,
      coachId: selected?.coachId ?? current.coachId,
      currentProgramId: selected?.id ?? '',
      currentVersionId: selected?.currentVersionId ?? '',
      currentProgramName: selected?.title ?? '',
    } : current)
  }

  const updateDraft = <Key extends keyof PtClientProfile>(key: Key, value: PtClientProfile[Key]) => {
    setProfileDraft((current) => current ? { ...current, [key]: value } : current)
  }

  return (
    <div className="page admin-students-page pt-clients-page">
      <PageHeader
        eyebrow="PT COACHING · CRM"
        title="Khách hàng PT"
        description="Quản lý mục tiêu, check-in, trạng thái và giáo án gym của từng khách hàng. Dữ liệu này tách biệt với Aura Academy."
        action={<div className="admin-header-actions"><button className="outline-button" onClick={() => downloadCSV(filtered)} disabled={!filtered.length}><Download size={17} /> Xuất danh sách</button><button className="pink-orange-button" onClick={() => { setInviteError(null); setInviteOpen(true) }}><UserPlus size={18} /> Thêm học viên mới</button></div>}
      />

      <section className="pt-client-insights">
        <article><span className="purple"><Users size={21} /></span><div><small>TỔNG KHÁCH HÀNG</small><strong>{stats.total}</strong><em>Hồ sơ dành riêng cho PT</em></div></article>
        <article><span className="green"><Activity size={21} /></span><div><small>ĐANG COACHING</small><strong>{stats.active}</strong><em>Đang có giáo án hoạt động</em></div></article>
        <article><span className="blue"><ClipboardList size={21} /></span><div><small>ĐANG THIẾT LẬP</small><strong>{stats.onboarding}</strong><em>Cần hoàn thiện mục tiêu</em></div></article>
        <article><span className="orange"><AlertCircle size={21} /></span><div><small>CẦN CHECK-IN</small><strong>{stats.needsAttention}</strong><em>Quá 7 ngày hoặc readiness thấp</em></div></article>
      </section>

      <div className="admin-list-toolbar students-toolbar pt-client-toolbar">
        <div className="course-search"><Search size={18} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tìm khách hàng hoặc mục tiêu..." /></div>
        <label className="filter-button"><Activity size={16} /> Trạng thái <ChevronDown size={15} /><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as 'all' | PtCoachingStatus)}><option value="all">Tất cả</option>{Object.entries(coachingStatusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label className="filter-button"><Dumbbell size={16} /> Giáo án <ChevronDown size={15} /><select value={programFilter} onChange={(event) => setProgramFilter(event.target.value)}>{availablePrograms.map((program) => <option key={program} value={program}>{program === 'all' ? 'Tất cả' : program}</option>)}</select></label>
        <label className="filter-button"><SlidersHorizontal size={15} /> Sắp xếp <select value={sortBy} onChange={(event) => setSortBy(event.target.value as SortKey)}><option value="checkIn">Cần check-in trước</option><option value="readiness">Readiness thấp trước</option><option value="name">Tên khách hàng</option></select></label>
      </div>

      {(profileError || error) && <div className="builder-save-error" role="alert"><AlertCircle size={17} /> {profileError || error} {onRetry && <button className="text-button" onClick={onRetry}>Thử lại</button>}</div>}

      <section className="card pt-client-list" aria-busy={loading || profilesLoading}>
        <div className="pt-client-list__head"><span>KHÁCH HÀNG</span><span>MỤC TIÊU</span><span>GIÁO ÁN</span><span>CHECK-IN</span><span>TRẠNG THÁI</span><span /></div>
        {loading || profilesLoading ? <div className="empty-state"><Activity className="spin" size={30} /><h3>Đang tải hồ sơ coaching</h3><p>Aura đang đồng bộ dữ liệu khách hàng PT.</p></div>
          : !filtered.length ? <div className="empty-state"><Users size={30} /><h3>Chưa có khách hàng phù hợp</h3><p>Mời khách hàng mới hoặc thay đổi bộ lọc.</p></div>
            : filtered.map((client, index) => {
              const readiness = client.coaching.readiness
              const stale = daysSince(client.coaching.lastCheckInAt) >= 7
              return <article className="pt-client-row" key={client.uid} role="button" tabIndex={0} aria-label={`Mở hồ sơ ${client.displayName}`} onClick={() => openClient(client)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openClient(client) } }}>
                <span className="student-identity"><i className={['purple', 'green', 'orange', 'pink', 'blue'][index % 5]}>{client.initials}</i><span><strong>{client.displayName}</strong><small>{client.email}</small></span></span>
                <span><strong>{client.coaching.goal || 'Chưa thiết lập mục tiêu'}</strong><small>{client.coaching.nextCheckInDate ? `Hẹn tiếp: ${client.coaching.nextCheckInDate}` : 'Chưa đặt lịch check-in'}</small></span>
                <span className="pt-program-cell"><Dumbbell size={17} /><span><strong>{client.coaching.currentProgramName || 'Chưa gán giáo án'}</strong><small>{client.coaching.currentVersionId ? `Version ${client.coaching.currentVersionId}` : 'Chọn trong hồ sơ khách hàng'}</small></span></span>
                <span className={stale ? 'pt-checkin stale' : 'pt-checkin'}><strong>{formatDate(client.coaching.lastCheckInAt)}</strong><small>{readiness ? `Readiness ${readiness}/5 · Ngủ ${client.coaching.sleepHours ?? '—'}h` : 'Chưa có chỉ số'}</small></span>
                <span><i className={`pt-coaching-status ${client.coaching.coachingStatus}`}>{coachingStatusLabels[client.coaching.coachingStatus]}</i></span>
                <span><button className="icon-button" aria-label={`Mở hồ sơ ${client.displayName}`} onClick={(event) => { event.stopPropagation(); openClient(client) }}><ChevronDown size={17} /></button></span>
              </article>
            })}
      </section>

      {selectedClient && profileDraft && <div className="modal-backdrop pt-client-drawer-backdrop" role="presentation" onClick={closeClient}>
        <section className="pt-client-drawer gradient-pink-orange" role="dialog" aria-modal="true" aria-labelledby="pt-client-title" onClick={(event) => event.stopPropagation()}>
          <header className="student-gradient-header">
            <div className="student-gradient-header__main">
              <div className="student-avatar-badge">
                <span>{selectedClient.initials}</span>
              </div>
              <div className="student-identity-info">
                <span className="eyebrow-pill">HỒ SƠ HỌC VIÊN PT COACHING</span>
                <h2 id="pt-client-title">{selectedClient.displayName}</h2>
                <p>{selectedClient.email}</p>

                <div className="student-quick-pills">
                  <span className={`status-pill ${selectedClient.coaching.coachingStatus}`}>
                    {coachingStatusLabels[selectedClient.coaching.coachingStatus]}
                  </span>
                  {selectedClient.coaching.currentProgramName && (
                    <span className="program-pill">
                      <Dumbbell size={12} /> {selectedClient.coaching.currentProgramName}
                    </span>
                  )}
                  {selectedClient.coaching.readiness !== null && selectedClient.coaching.readiness !== undefined && (
                    <span className="readiness-pill">
                      <Zap size={12} /> Readiness {selectedClient.coaching.readiness}/5
                    </span>
                  )}
                </div>
              </div>
            </div>
            <button className="icon-button close-btn" aria-label="Đóng hồ sơ" onClick={closeClient}>
              <X size={19} />
            </button>
          </header>

          <div className="pt-client-drawer-tabs pink-orange-tabs" role="tablist" aria-label="Nội dung học viên PT">
            <button type="button" role="tab" aria-selected={drawerTab === 'profile'} className={drawerTab === 'profile' ? 'active' : ''} onClick={() => setDrawerTab('profile')}>
              <ClipboardList size={16} /> Hồ sơ & Chỉ số
            </button>
            <button type="button" role="tab" aria-selected={drawerTab === 'schedule'} className={drawerTab === 'schedule' ? 'active' : ''} onClick={() => setDrawerTab('schedule')}>
              <CalendarCheck size={16} /> Lịch coaching
            </button>
            <button type="button" role="tab" aria-selected={drawerTab === 'push'} className={drawerTab === 'push' ? 'active' : ''} onClick={() => setDrawerTab('push')}>
              <Bell size={16} /> Gửi Push Notification
            </button>
          </div>

          {drawerTab === 'profile' && (
            <div className="pt-client-drawer__body" id="pt-client-profile-panel" role="tabpanel">
              <section className="drawer-card">
                <div className="pt-drawer-section-title pink-orange">
                  <Target size={18} />
                  <span>
                    <strong>Mục tiêu & Trạng thái</strong>
                    <small>Thông tin do PT quản lý, độc lập với khóa học Academy</small>
                  </span>
                </div>
                <div className="pt-form-grid">
                  <label className="span-2">
                    <span>Mục tiêu khách hàng</span>
                    <textarea rows={3} value={profileDraft.goal} onChange={(event) => updateDraft('goal', event.target.value)} placeholder="Ví dụ: tăng 3 kg cơ, cải thiện squat trong 12 tuần" />
                  </label>
                  <label>
                    <span>Trạng thái coaching</span>
                    <select value={profileDraft.coachingStatus} onChange={(event) => updateDraft('coachingStatus', event.target.value as PtCoachingStatus)}>
                      {Object.entries(coachingStatusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                    </select>
                  </label>
                  <label>
                    <span>Ngày check-in kế tiếp</span>
                    <input type="date" value={profileDraft.nextCheckInDate} onChange={(event) => updateDraft('nextCheckInDate', event.target.value)} />
                  </label>
                </div>
              </section>

              <section className="drawer-card">
                <div className="pt-drawer-section-title pink-orange">
                  <Dumbbell size={18} />
                  <span>
                    <strong>Giáo án đang gán</strong>
                    <small>Chỉ chọn phiên bản đã xuất bản và đúng PT phụ trách</small>
                  </span>
                </div>
                <div className="pt-form-grid">
                  <label className="span-2">
                    <span>Giáo án đã xuất bản</span>
                    <select value={profileDraft.currentProgramId && profileDraft.currentVersionId ? `${profileDraft.currentProgramId}::${profileDraft.currentVersionId}` : ''} onChange={(event) => selectProgram(event.target.value)} disabled={programsLoading}>
                      <option value="">{programsLoading ? 'Đang tải giáo án...' : 'Chưa gán giáo án'}</option>
                      {publishedPrograms.filter((program) => profileDraft.coachingStatus === 'onboarding' || !profileDraft.coachId || program.coachId === profileDraft.coachId).map((program) => <option key={`${program.id}:${program.currentVersionId}`} value={`${program.id}::${program.currentVersionId}`}>{program.title}</option>)}
                    </select>
                    <small>{profileDraft.currentProgramId ? `Program ${profileDraft.currentProgramId} · Version ${profileDraft.currentVersionId}` : 'Hãy chọn giáo án trước khi chuyển trạng thái sang Đang coaching.'}</small>
                  </label>
                </div>
              </section>

              <section className="drawer-card">
                <div className="pt-drawer-section-title pink-orange">
                  <HeartPulse size={18} />
                  <span>
                    <strong>Chỉ số sức khỏe & Check-in gần nhất</strong>
                    <small>Cập nhật khả năng sẵn sàng trước khi điều chỉnh giáo án</small>
                  </span>
                </div>
                <div className="pt-form-grid metrics">
                  <label>
                    <span>Readiness (1–5)</span>
                    <input type="number" min={1} max={5} value={profileDraft.readiness ?? ''} onChange={(event) => updateDraft('readiness', event.target.value ? Number(event.target.value) : null)} />
                  </label>
                  <label>
                    <span>Giấc ngủ (giờ)</span>
                    <input type="number" min={0} max={24} step={0.5} value={profileDraft.sleepHours ?? ''} onChange={(event) => updateDraft('sleepHours', event.target.value ? Number(event.target.value) : null)} />
                  </label>
                  <label>
                    <span>Đau mỏi (1–5)</span>
                    <input type="number" min={1} max={5} value={profileDraft.soreness ?? ''} onChange={(event) => updateDraft('soreness', event.target.value ? Number(event.target.value) : null)} />
                  </label>
                  <label>
                    <span>Cân nặng (kg)</span>
                    <input type="number" min={20} max={500} step={0.1} value={profileDraft.bodyWeightKg ?? ''} onChange={(event) => updateDraft('bodyWeightKg', event.target.value ? Number(event.target.value) : null)} />
                  </label>
                  <label className="span-2">
                    <span>Ghi chú coaching chia sẻ với khách hàng</span>
                    <textarea rows={4} value={profileDraft.coachNotes} onChange={(event) => updateDraft('coachNotes', event.target.value)} placeholder="Chỉ dẫn kỹ thuật, mục tiêu tuần và phản hồi có thể chia sẻ với khách hàng." />
                  </label>
                </div>
              </section>
            </div>
          )}

          {drawerTab === 'schedule' && (
            <div className="pt-client-drawer__body schedule" id="pt-client-schedule-tab-panel" role="tabpanel">
              <PtClientSchedulePanel clientId={selectedClient.uid} clientName={selectedClient.displayName} coachingStatus={selectedClient.coaching.coachingStatus} relationshipReady={Boolean(selectedClient.coaching.coachId)} />
            </div>
          )}

          {drawerTab === 'push' && (
            <div className="pt-client-drawer__body direct-push" id="pt-client-push-tab-panel" role="tabpanel">
              <section className="drawer-card push-card">
                <div className="pt-drawer-section-title pink-orange">
                  <Bell size={18} />
                  <span>
                    <strong>Gửi thông báo đẩy trực tiếp (Push Notification)</strong>
                    <small>Gửi thông báo riêng đến thiết bị của học viên {selectedClient.displayName}</small>
                  </span>
                </div>

                {directPushSuccess && (
                  <div className="direct-push-banner success" role="status">
                    <CheckCircle2 size={16} /> {directPushSuccess}
                  </div>
                )}

                {directPushError && (
                  <div className="direct-push-banner error" role="alert">
                    <AlertCircle size={16} /> {directPushError}
                  </div>
                )}

                <div className="pt-form-grid">
                  <label className="span-2">
                    <span>Loại thông báo</span>
                    <select value={directPushType} onChange={(e) => setDirectPushType(e.target.value as any)}>
                      <option value="REMINDER">⏰ Nhắc nhở tập luyện / Check-in</option>
                      <option value="WORKOUT">💪 Bài tập & Giáo án mới</option>
                      <option value="MOTIVATION">🔥 Phản hồi & Động lực từ HLV</option>
                      <option value="ANNOUNCEMENT">📢 Thông báo quan trọng</option>
                      <option value="INFO">ℹ️ Thông tin chung</option>
                    </select>
                  </label>

                  <label className="span-2">
                    <span>Tiêu đề thông báo</span>
                    <input type="text" value={directPushTitle} onChange={(e) => setDirectPushTitle(e.target.value)} placeholder="Ví dụ: Lịch check-in hôm nay, Đã có giáo án tuần mới..." />
                  </label>

                  <label className="span-2">
                    <span>Nội dung thông báo</span>
                    <textarea rows={4} value={directPushMessage} onChange={(e) => setDirectPushMessage(e.target.value)} placeholder="Nhập tin nhắn chi tiết sẽ hiển thị trên thông báo đẩy thiết bị của học viên..." />
                  </label>
                </div>

                <div className="push-action-wrapper">
                  <button className="pink-orange-button" disabled={!directPushTitle.trim() || !directPushMessage.trim() || directPushSending} onClick={() => void handleSendDirectPush()}>
                    {directPushSending ? <Activity className="spin" size={17} /> : <Send size={17} />}
                    {directPushSending ? 'Đang gửi Push...' : 'Gửi Push Notification ngay'}
                  </button>
                </div>
              </section>
            </div>
          )}

          {drawerTab === 'profile' && saveError && <div className="builder-save-error" role="alert"><AlertCircle size={16} /> {saveError}</div>}

          <footer>
            {drawerTab === 'profile' ? (
              <>
                <span><CalendarCheck size={16} /> Check-in gần nhất: {formatDate(profileDraft.lastCheckInAt)}</span>
                <div>
                  <button className="outline-button" onClick={closeClient}>Đóng</button>
                  <button className="pink-orange-button" onClick={() => void saveProfile()} disabled={savingProfile}>
                    {savingProfile ? 'Đang lưu...' : 'Lưu hồ sơ coaching'}
                  </button>
                </div>
              </>
            ) : (
              <>
                <span><CalendarCheck size={16} /> Chi tiết học viên được cập nhật thời gian thực</span>
                <div>
                  <button className="outline-button" onClick={closeClient}>Đóng</button>
                </div>
              </>
            )}
          </footer>
        </section>
      </div>}

      {inviteOpen && (
        <div className="modal-backdrop" role="presentation" onClick={resetAddModal}>
          <section className="create-student-modal" role="dialog" aria-modal="true" aria-labelledby="add-student-title" onClick={(event) => event.stopPropagation()}>
            <header>
              <div>
                <span className="eyebrow">QUẢN LÝ HỌC VIÊN PT</span>
                <h2 id="add-student-title">Tạo tài khoản học viên</h2>
                <p>Tạo tài khoản Aura trực tiếp, đồng bộ hồ sơ coaching và thông tin đăng nhập trong một lần.</p>
              </div>
              <button className="icon-button close-btn" aria-label="Đóng" onClick={resetAddModal} style={{ color: '#ffffff', background: 'rgba(255,255,255,0.2)', border: 'none', borderRadius: '50%', width: '32px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
                <X size={18} />
              </button>
            </header>

            <div className="modal-segmented-control" role="tablist">
              <button
                type="button"
                className={addMode === 'create' ? 'active' : ''}
                onClick={() => { setAddMode('create'); setCreateError(null); }}
              >
                <Sparkles size={15} /> Tạo tài khoản mới
              </button>
              <button
                type="button"
                className={addMode === 'link' ? 'active' : ''}
                onClick={() => { setAddMode('link'); setInviteError(null); }}
              >
                <Mail size={15} /> Liên kết bằng email
              </button>
            </div>

            {addMode === 'create' ? (
              <div className="modal-body-form">
                {createdAccountResult ? (
                  <div className="success-account-card">
                    <div className="success-account-card__head">
                      <CheckCircle2 size={20} />
                    <span>Đã tạo tài khoản học viên</span>
                    </div>

                    <div className="success-account-details">
                      <div className="success-account-details-item">
                        <small>Họ và tên</small>
                        <strong>{createdAccountResult.displayName}</strong>
                      </div>
                      <div className="success-account-details-item">
                        <small>Số điện thoại</small>
                        <strong>{createdAccountResult.phoneNumber}</strong>
                      </div>
                      <div className="success-account-details-item" style={{ gridColumn: 'span 2' }}>
                        <small>Email đăng nhập</small>
                        <code className="pink-code">{createdAccountResult.email}</code>
                      </div>
                      <div className="success-account-details-item" style={{ gridColumn: 'span 2' }}>
                        <small>Mật khẩu ban đầu</small>
                        <code className="pink-code">{createdAccountResult.phoneNumber.replace(/^\+84/, '0').replace(/\D/g, '')}</code>
                      </div>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '4px' }}>
                      <button
                        type="button"
                        className="pink-orange-button"
                        onClick={() => void copyCreatedAccountInfo()}
                      >
                        {copiedAccountInfo ? <Check size={16} /> : <Copy size={16} />}
                        {copiedAccountInfo ? 'Đã sao chép tin nhắn gửi học viên!' : 'Sao chép thông tin gửi học viên'}
                      </button>

                      <div style={{ display: 'flex', gap: '8px' }}>
                        <button
                          type="button"
                          className="outline-button"
                          style={{ flex: 1 }}
                          onClick={() => {
                            setCreatedAccountResult(null)
                            setCreateName('')
                            setCreatePhone('')
                            setCreateEmail('')
                            setCreateGoal('')
                          }}
                        >
                          Tạo tài khoản khác
                        </button>
                        <button
                          type="button"
                          className="outline-button"
                          style={{ flex: 1 }}
                          onClick={resetAddModal}
                        >
                          Hoàn tất
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <>
                    {createError && (
                      <div className="builder-save-error" role="alert">
                        <AlertCircle size={16} /> {createError}
                      </div>
                    )}

                    <label>
                      <span>
                        Họ và tên học viên
                      </span>
                      <input
                        type="text"
                        value={createName}
                        onChange={(e) => setCreateName(e.target.value)}
                        placeholder="Ví dụ: Nguyễn Văn A"
                      />
                    </label>

                    <label>
                      <span>
                        Số điện thoại <small style={{ color: '#f43f5e', fontWeight: 700 }}>* (Bắt buộc)</small>
                      </span>
                      <input
                        type="tel"
                        value={createPhone}
                        onChange={(e) => handlePhoneChange(e.target.value)}
                        placeholder="Ví dụ: 0912345678"
                      />
                      <small style={{ color: '#e11d48', fontWeight: 600, marginTop: '2px', background: '#fff1f2', padding: '6px 10px', borderRadius: '8px', border: '1px solid #fecdd3' }}>
                        Số này được liên kết với tài khoản và cũng là mật khẩu ban đầu. Học viên có thể đổi sau khi đăng nhập nếu muốn.
                      </small>
                    </label>

                    <label>
                      <span>Email đăng nhập <small style={{ color: '#71717a', fontWeight: 600 }}>(Không bắt buộc)</small></span>
                      <input
                        type="email"
                        value={createEmail}
                        onChange={(e) => {
                          setCreateEmail(e.target.value)
                        }}
                        placeholder="Bỏ trống: SĐT@aurafitness.vn"
                      />
                    </label>

                    <label>
                      <span>Mục tiêu coaching ban đầu (tùy chọn)</span>
                      <textarea
                        rows={2}
                        value={createGoal}
                        onChange={(e) => setCreateGoal(e.target.value)}
                        placeholder="Ví dụ: Tăng 3kg cơ, tập 3 buổi/tuần, cải thiện Squat..."
                      />
                    </label>

                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '8px' }}>
                      <button type="button" className="outline-button" onClick={resetAddModal}>
                        Hủy
                      </button>
                      <button
                        type="button"
                        className="pink-orange-button"
                        onClick={() => void handleCreateStudent()}
                        disabled={!createName.trim() || !createPhone.trim() || createSaving}
                      >
                        {createSaving ? <Activity className="spin" size={16} /> : <UserPlus size={16} />}
                        {createSaving ? 'Đang tạo...' : 'Tạo tài khoản'}
                      </button>
                    </div>
                  </>
                )}
              </div>
            ) : (
              <div className="modal-body-form">
                <p style={{ fontSize: '12px', color: '#64748b', margin: 0 }}>
                  Nhập email tài khoản Aura đã đăng ký để thêm học viên vào danh sách PT Coaching.
                </p>

                <label>
                  <span>Email khách hàng đã có tài khoản</span>
                  <input
                    type="email"
                    value={inviteEmail}
                    onChange={(event) => {
                      setInviteEmail(event.target.value)
                      setInviteError(null)
                    }}
                    placeholder="khachhang@example.com"
                  />
                </label>

                {inviteError && (
                  <div className="builder-save-error" role="alert">
                    <AlertCircle size={16} /> {inviteError}
                  </div>
                )}

                <div className="invite-link" style={{ marginTop: '6px' }}>
                  <span style={{ fontSize: '11px', overflow: 'hidden', textOverflow: 'ellipsis' }}>{registrationUrl}</span>
                  <button className="outline-button" onClick={() => void copyInvite()}>
                    {inviteCopied ? <Check size={15} /> : <Copy size={15} />}
                    {inviteCopied ? 'Đã sao chép' : 'Sao chép liên kết mời'}
                  </button>
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '12px' }}>
                  <button className="outline-button" onClick={openInviteEmail} disabled={!inviteEmail.trim()}>
                    <Mail size={16} /> Gửi email mời
                  </button>
                  <button
                    className="pink-orange-button"
                    onClick={() => void addExistingClient()}
                    disabled={!inviteEmail.trim() || inviteSaving}
                  >
                    {inviteSaving ? <Activity className="spin" size={16} /> : <UserPlus size={16} />}
                    {inviteSaving ? 'Đang thêm...' : 'Thêm tài khoản đã có'}
                  </button>
                </div>
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  )
}
