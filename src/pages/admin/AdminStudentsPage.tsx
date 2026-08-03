import {
  Activity,
  AlertCircle,
  CalendarCheck,
  Check,
  ChevronDown,
  ClipboardList,
  Copy,
  Download,
  Dumbbell,
  Mail,
  Search,
  SlidersHorizontal,
  Target,
  UserPlus,
  Users,
  X,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import PtClientSchedulePanel from '../../components/coaching/PtClientSchedulePanel'
import { PageHeader } from '../../components/ui'
import {
  loadPtClientProfiles,
  listPublishedPtPrograms,
  listPtClients,
  onboardPtClientByEmail,
  savePtClientProfile,
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
type ClientDrawerTab = 'profile' | 'schedule'

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
  const fallbackCandidates = useMemo(() => students.filter((student) => student.role === 'student'), [students])
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
  }

  const closeClient = () => {
    setSelectedClientId(null)
    setProfileDraft(null)
    setDrawerTab('profile')
    setSaveError(null)
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
        action={<div className="admin-header-actions"><button className="outline-button" onClick={() => downloadCSV(filtered)} disabled={!filtered.length}><Download size={17} /> Xuất danh sách</button><button className="primary-button" onClick={() => { setInviteError(null); setInviteOpen(true) }}><UserPlus size={18} /> Thêm khách hàng</button></div>}
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
        <section className="pt-client-drawer" role="dialog" aria-modal="true" aria-labelledby="pt-client-title" onClick={(event) => event.stopPropagation()}>
          <header><div><span className="eyebrow">HỒ SƠ PT COACHING</span><h2 id="pt-client-title">{selectedClient.displayName}</h2><p>{selectedClient.email}</p></div><button className="icon-button" aria-label="Đóng hồ sơ" onClick={closeClient}><X size={19} /></button></header>
          <div className="pt-client-drawer-tabs" role="tablist" aria-label="Nội dung khách hàng PT"><button type="button" role="tab" aria-selected={drawerTab === 'profile'} aria-controls="pt-client-profile-panel" className={drawerTab === 'profile' ? 'active' : ''} onClick={() => setDrawerTab('profile')}><ClipboardList size={16} /> Hồ sơ coaching</button><button type="button" role="tab" aria-selected={drawerTab === 'schedule'} aria-controls="pt-client-schedule-tab-panel" className={drawerTab === 'schedule' ? 'active' : ''} onClick={() => setDrawerTab('schedule')}><CalendarCheck size={16} /> Lịch coaching</button></div>
          {drawerTab === 'profile' ? <div className="pt-client-drawer__body" id="pt-client-profile-panel" role="tabpanel">
            <section><div className="pt-drawer-section-title"><Target size={18} /><span><strong>Mục tiêu & trạng thái</strong><small>Thông tin do PT quản lý, độc lập với khóa học</small></span></div><div className="pt-form-grid"><label className="span-2"><span>Mục tiêu khách hàng</span><textarea rows={3} value={profileDraft.goal} onChange={(event) => updateDraft('goal', event.target.value)} placeholder="Ví dụ: tăng 3 kg cơ, cải thiện squat trong 12 tuần" /></label><label><span>Trạng thái</span><select value={profileDraft.coachingStatus} onChange={(event) => updateDraft('coachingStatus', event.target.value as PtCoachingStatus)}>{Object.entries(coachingStatusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label><span>Ngày check-in kế tiếp</span><input type="date" value={profileDraft.nextCheckInDate} onChange={(event) => updateDraft('nextCheckInDate', event.target.value)} /></label></div></section>
            <section><div className="pt-drawer-section-title"><Dumbbell size={18} /><span><strong>Giáo án đang gán</strong><small>Chỉ chọn phiên bản đã xuất bản và đúng PT phụ trách</small></span></div><div className="pt-form-grid"><label className="span-2"><span>Giáo án đã xuất bản</span><select value={profileDraft.currentProgramId && profileDraft.currentVersionId ? `${profileDraft.currentProgramId}::${profileDraft.currentVersionId}` : ''} onChange={(event) => selectProgram(event.target.value)} disabled={programsLoading}><option value="">{programsLoading ? 'Đang tải giáo án...' : 'Chưa gán giáo án'}</option>{publishedPrograms.filter((program) => profileDraft.coachingStatus === 'onboarding' || !profileDraft.coachId || program.coachId === profileDraft.coachId).map((program) => <option key={`${program.id}:${program.currentVersionId}`} value={`${program.id}::${program.currentVersionId}`}>{program.title}</option>)}</select><small>{profileDraft.currentProgramId ? `Program ${profileDraft.currentProgramId} · Version ${profileDraft.currentVersionId}` : 'Hãy chọn giáo án trước khi chuyển trạng thái sang Đang coaching.'}</small></label></div></section>
            <section><div className="pt-drawer-section-title"><CalendarCheck size={18} /><span><strong>Check-in gần nhất</strong><small>Cập nhật khả năng sẵn sàng trước khi điều chỉnh giáo án</small></span></div><div className="pt-form-grid metrics"><label><span>Readiness (1–5)</span><input type="number" min={1} max={5} value={profileDraft.readiness ?? ''} onChange={(event) => updateDraft('readiness', event.target.value ? Number(event.target.value) : null)} /></label><label><span>Giấc ngủ (giờ)</span><input type="number" min={0} max={24} step={0.5} value={profileDraft.sleepHours ?? ''} onChange={(event) => updateDraft('sleepHours', event.target.value ? Number(event.target.value) : null)} /></label><label><span>Đau mỏi (1–5)</span><input type="number" min={1} max={5} value={profileDraft.soreness ?? ''} onChange={(event) => updateDraft('soreness', event.target.value ? Number(event.target.value) : null)} /></label><label><span>Cân nặng (kg)</span><input type="number" min={20} max={500} step={0.1} value={profileDraft.bodyWeightKg ?? ''} onChange={(event) => updateDraft('bodyWeightKg', event.target.value ? Number(event.target.value) : null)} /></label><label className="span-2"><span>Ghi chú coaching chia sẻ với khách hàng</span><textarea rows={4} value={profileDraft.coachNotes} onChange={(event) => updateDraft('coachNotes', event.target.value)} placeholder="Chỉ dẫn kỹ thuật, mục tiêu tuần và phản hồi có thể chia sẻ với khách hàng." /></label></div></section>
          </div> : <div className="pt-client-drawer__body schedule" id="pt-client-schedule-tab-panel" role="tabpanel"><PtClientSchedulePanel clientId={selectedClient.uid} clientName={selectedClient.displayName} coachingStatus={selectedClient.coaching.coachingStatus} relationshipReady={Boolean(selectedClient.coaching.coachId)} /></div>}
          {drawerTab === 'profile' && saveError && <div className="builder-save-error" role="alert"><AlertCircle size={16} /> {saveError}</div>}
          <footer>{drawerTab === 'profile' ? <><span><CalendarCheck size={16} /> Check-in gần nhất: {formatDate(profileDraft.lastCheckInAt)}</span><div><button className="outline-button" onClick={closeClient}>Đóng</button><button className="primary-button" onClick={() => void saveProfile()} disabled={savingProfile}>{savingProfile ? 'Đang lưu...' : 'Lưu hồ sơ coaching'}</button></div></> : <><span><CalendarCheck size={16} /> Lịch được đồng bộ riêng cho khách hàng này</span><div><button className="outline-button" onClick={closeClient}>Đóng</button></div></>}</footer>
        </section>
      </div>}

      {inviteOpen && <div className="modal-backdrop" role="presentation" onClick={() => setInviteOpen(false)}><section className="invite-modal" role="dialog" aria-modal="true" aria-labelledby="invite-title" onClick={(event) => event.stopPropagation()}><header><div><span className="eyebrow">THÊM KHÁCH HÀNG</span><h2 id="invite-title">Bắt đầu PT Coaching</h2><p>Nhập email tài khoản Aura đã đăng ký để tạo hồ sơ onboarding. Nếu chưa có tài khoản, hãy gửi liên kết mời bên dưới.</p></div><button className="icon-button" aria-label="Đóng" onClick={() => setInviteOpen(false)}><X size={18} /></button></header><label><span>Email khách hàng</span><input type="email" value={inviteEmail} onChange={(event) => { setInviteEmail(event.target.value); setInviteError(null) }} placeholder="khachhang@example.com" /></label>{inviteError && <div className="builder-save-error" role="alert"><AlertCircle size={16} /> {inviteError}</div>}<div className="invite-link"><span>{registrationUrl}</span><button className="outline-button" onClick={() => void copyInvite()}>{inviteCopied ? <Check size={16} /> : <Copy size={16} />}{inviteCopied ? 'Đã sao chép' : 'Sao chép lời mời'}</button></div><footer><button className="outline-button" onClick={openInviteEmail} disabled={!inviteEmail.trim()}><Mail size={16} /> Gửi email mời</button><button className="primary-button" onClick={() => void addExistingClient()} disabled={!inviteEmail.trim() || inviteSaving}><UserPlus size={16} /> {inviteSaving ? 'Đang thêm...' : 'Thêm tài khoản đã có'}</button></footer></section></div>}
    </div>
  )
}
