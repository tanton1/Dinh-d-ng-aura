import '../../styles-admin.css'
import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import {
  AlertCircle, Building2, CheckCircle2, Columns3, Crown, LoaderCircle,
  Mail, Phone, Plus, Search, ShieldCheck, SlidersHorizontal, UserCog, Users, X,
} from 'lucide-react'
import { PageHeader } from '../../components/ui'
import { collection, onSnapshot } from 'firebase/firestore'
import { hasPermission } from '../../config/permissions'
import { useDatabase } from '../../contexts/DatabaseContext'
import { firestoreDb } from '../../lib/firebase'
import { assignStaffPositions, createAccountInvite } from '../../services/identityAccessService'
import type { StaffPosition } from '../../identity/access'
import type { Branch, UserRole } from '../../types'

export interface AdminRoleUser {
  uid: string
  displayName: string
  email: string
  phoneNumber?: string
  role: UserRole
  photoURL?: string | null
  status?: 'active' | 'invited' | 'disabled'
  lastActive?: string
}

interface AdminRolesPageProps {
  users: AdminRoleUser[]
  currentRole: UserRole
  currentUserUid?: string
  onRoleChange: (uid: string, nextRole: UserRole) => Promise<void> | void
  loading?: boolean
}

type DirectoryColumn = 'phone' | 'email' | 'scope' | 'activity' | 'status'
type RolesSection = 'accounts' | 'branches'
type InviteDraft = {
  displayName: string
  phoneNumber: string
  email: string
  accessRole: 'student' | 'staff'
  positions: StaffPosition[]
  branchIds: string[]
}
type RoleAssignmentSummary = {
  accessRole: 'student' | 'staff' | 'admin' | 'super_admin'
  positions: StaffPosition[]
  branchIds: string[]
  status: 'active' | 'suspended' | 'invited'
}

const directoryColumnMeta: Record<DirectoryColumn, string> = {
  phone: 'Số điện thoại', email: 'Email đăng nhập', scope: 'Chức danh & phạm vi',
  activity: 'Hoạt động gần nhất', status: 'Trạng thái',
}
const defaultDirectoryColumns: Record<DirectoryColumn, boolean> = { phone: true, email: true, scope: true, activity: false, status: true }
const directoryColumnsStorageKey = 'aura.admin.roles.directory-columns.v1'

function readDirectoryColumns(): Record<DirectoryColumn, boolean> {
  if (typeof window === 'undefined') return defaultDirectoryColumns
  try {
    const stored = JSON.parse(window.localStorage.getItem(directoryColumnsStorageKey) || '{}') as Partial<Record<DirectoryColumn, unknown>>
    return Object.fromEntries(Object.entries(defaultDirectoryColumns).map(([key, value]) => [key, typeof stored[key as DirectoryColumn] === 'boolean' ? stored[key as DirectoryColumn] : value])) as Record<DirectoryColumn, boolean>
  } catch { return defaultDirectoryColumns }
}

// PT, Sales and Branch Manager are staff positions in Identity v2. They need
// an assignment scope, so they must never be sent to the legacy role callable.
const roles: UserRole[] = [
  'student',
  'coach',
  'editor',
  'shipper',
  'admin',
  'super_admin',
  'user',
]
const roleMeta: Record<UserRole, { label: string; scope: string; tone: string }> = {
  student: { label: 'Học viên', scope: 'Học tập và trải nghiệm cá nhân', tone: '#797988' },
  coach: { label: 'Huấn luyện viên', scope: 'Giáo án & học viên được gán', tone: '#4e9724' },
  trainer: { label: 'HLV PT Gym', scope: 'Dạy 1-on-1 & chấm công', tone: '#10b981' },
  sales: { label: 'Kinh doanh / Sales', scope: 'Hợp đồng, báo giá & tư vấn', tone: '#f59e0b' },
  manager: { label: 'Quản lý Chi nhánh', scope: 'Vận hành cơ sở & nhân sự', tone: '#8b5cf6' },
  editor: { label: 'Biên tập viên', scope: 'Khóa học, media & thư viện', tone: '#3c80bd' },
  shipper: { label: 'Shipper Eat Clean', scope: 'Nhận chuyến, GPS & giao món', tone: '#ed7a36' },
  admin: { label: 'Administrator', scope: 'Quản trị vận hành', tone: 'var(--aura-pink)' },
  super_admin: { label: 'Super Administrator', scope: 'Toàn quyền hệ thống', tone: 'var(--aura-pink-neon)' },
  user: { label: 'Khách vãng lai', scope: 'Trải nghiệm cơ bản', tone: '#6b7280' },
}
const statusMeta = {
  active: { label: 'Đang hoạt động', className: 'published' },
  invited: { label: 'Đã mời', className: 'draft' },
  disabled: { label: 'Đã khóa', className: 'attention' },
} as const
const staffPositionRoles = new Set<UserRole>(['coach', 'trainer', 'sales', 'manager', 'editor', 'shipper'])
const positionOptions: Array<{ id: StaffPosition; label: string; description: string }> = [
  { id: 'coach_online', label: 'Coach online', description: 'Học viên coaching được gán và giáo án online' },
  { id: 'trainer_pt', label: 'HLV PT Gym', description: 'Lịch PT, buổi tập và ghi chú của học viên được giao' },
  { id: 'sales', label: 'Sales', description: 'Lead, báo giá và hợp đồng trong phạm vi chi nhánh' },
  { id: 'branch_manager', label: 'Quản lý chi nhánh', description: 'Vận hành cơ sở và đội ngũ trong phạm vi được cấp' },
  { id: 'academy_editor', label: 'Biên tập Academy', description: 'Soạn và gửi duyệt nội dung Academy' },
  { id: 'shipper', label: 'Shipper Eat Clean', description: 'Đơn giao được phân công và GPS giao hàng' },
]

function initials(name: string, email: string) {
  const source = name.trim() || email.split('@')[0] || '?'
  return source.split(/\s+/).map((part) => part[0]).slice(-2).join('').toUpperCase()
}
function defaultPositionForRole(role: UserRole): StaffPosition | null {
  switch (role) {
    case 'coach': return 'coach_online'; case 'trainer': return 'trainer_pt'; case 'sales': return 'sales'
    case 'manager': return 'branch_manager'; case 'editor': return 'academy_editor'; case 'shipper': return 'shipper'
    default: return null
  }
}
function emptyInviteDraft(): InviteDraft {
  return { displayName: '', phoneNumber: '', email: '', accessRole: 'student' as const, positions: [] as StaffPosition[], branchIds: [] as string[] }
}
function assignmentPositionLabel(position: StaffPosition) {
  return positionOptions.find((option) => option.id === position)?.label ?? position
}

export default function AdminRolesPage({ users, currentRole, currentUserUid, onRoleChange, loading = false }: AdminRolesPageProps) {
  const { branches, addBranch, updateBranch, deleteBranch } = useDatabase()
  const [section, setSection] = useState<RolesSection>('accounts')
  const [query, setQuery] = useState('')
  const [roleFilter, setRoleFilter] = useState<'all' | UserRole>('all')
  const [visibleColumns, setVisibleColumns] = useState<Record<DirectoryColumn, boolean>>(readDirectoryColumns)
  const [columnPickerOpen, setColumnPickerOpen] = useState(false)
  const [savingUid, setSavingUid] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [accessEditorUid, setAccessEditorUid] = useState<string | null>(null)
  const [accessRoleDraft, setAccessRoleDraft] = useState<'student' | 'staff'>('student')
  const [positionDraft, setPositionDraft] = useState<StaffPosition[]>([])
  const [branchDraft, setBranchDraft] = useState<string[]>([])
  const [accessSaving, setAccessSaving] = useState(false)
  const [inviteOpen, setInviteOpen] = useState(false)
  const [inviteDraft, setInviteDraft] = useState(emptyInviteDraft)
  const [inviteSaving, setInviteSaving] = useState(false)
  const [branchEditor, setBranchEditor] = useState<{ id?: string; name: string; address: string } | null>(null)
  const [branchSaving, setBranchSaving] = useState(false)
  const [assignments, setAssignments] = useState<Record<string, RoleAssignmentSummary>>({})

  useEffect(() => { window.localStorage.setItem(directoryColumnsStorageKey, JSON.stringify(visibleColumns)) }, [visibleColumns])

  const canAssignRole = hasPermission(currentRole, 'role.assign')
  const canAssignSuperAdmin = hasPermission(currentRole, 'role.assign_super_admin')
  const canViewTeam = hasPermission(currentRole, 'team.view')
  useEffect(() => {
    if (!canViewTeam || !firestoreDb) {
      setAssignments({})
      return
    }
    return onSnapshot(collection(firestoreDb, 'roleAssignments'), (snapshot) => {
      const next: Record<string, RoleAssignmentSummary> = {}
      snapshot.forEach((item) => {
        const data = item.data()
        const accessRole = data.accessRole
        if (!['student', 'staff', 'admin', 'super_admin'].includes(accessRole)) return
        next[item.id] = {
          accessRole,
          positions: Array.isArray(data.positions) ? data.positions.filter((position): position is StaffPosition => positionOptions.some((option) => option.id === position)) : [],
          branchIds: Array.isArray(data.branchIds) ? data.branchIds.filter((branchId): branchId is string => typeof branchId === 'string') : [],
          status: ['active', 'suspended', 'invited'].includes(data.status) ? data.status : 'active',
        }
      })
      setAssignments(next)
    }, () => setAssignments({}))
  }, [canViewTeam])
  const filteredUsers = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase('vi')
    return users.filter((user) => (!normalizedQuery || `${user.displayName} ${user.email} ${user.phoneNumber || ''}`.toLocaleLowerCase('vi').includes(normalizedQuery)) && (roleFilter === 'all' || user.role === roleFilter))
  }, [query, roleFilter, users])
  const stats = useMemo(() => ({
    total: users.length, staff: users.filter((user) => user.role !== 'student').length,
    content: users.filter((user) => user.role === 'coach' || user.role === 'editor').length,
    admins: users.filter((user) => user.role === 'admin' || user.role === 'super_admin').length,
  }), [users])
  const tableGridStyle = useMemo(() => {
    const widths = ['minmax(190px, 1.35fr)']
    if (visibleColumns.phone) widths.push('minmax(130px, .72fr)')
    if (visibleColumns.email) widths.push('minmax(185px, .95fr)')
    widths.push('minmax(150px, .8fr)')
    if (visibleColumns.scope) widths.push('minmax(190px, 1fr)')
    if (visibleColumns.activity) widths.push('minmax(135px, .68fr)')
    if (visibleColumns.status) widths.push('minmax(115px, .62fr)')
    widths.push('48px')
    return { gridTemplateColumns: widths.join(' ') } satisfies CSSProperties
  }, [visibleColumns])

  const updateColumn = (column: DirectoryColumn) => setVisibleColumns((current) => ({ ...current, [column]: !current[column] }))
  const changeRole = async (user: AdminRoleUser, nextRole: UserRole) => {
    if (!canAssignRole || user.role === nextRole || staffPositionRoles.has(user.role) || staffPositionRoles.has(nextRole) || user.uid === currentUserUid) return
    if ((user.role === 'admin' || user.role === 'super_admin' || nextRole === 'admin' || nextRole === 'super_admin') && !canAssignSuperAdmin) return
    if (!window.confirm(`Đổi vai trò của ${user.displayName || user.email || user.uid} thành ${roleMeta[nextRole].label}?`)) return
    setSavingUid(user.uid); setError(null); setSuccess(null)
    try { await onRoleChange(user.uid, nextRole); setSuccess(`Đã cập nhật ${user.displayName || user.email || user.uid}. Người dùng cần đăng nhập lại để nhận quyền mới.`) }
    catch { setError(`Không thể cập nhật quyền cho ${user.displayName || user.email || user.uid}. Vui lòng thử lại.`) }
    finally { setSavingUid(null) }
  }
  const openAccessEditor = (user: AdminRoleUser, assignment?: RoleAssignmentSummary) => {
    const defaultPosition = defaultPositionForRole(user.role)
    const accessRole = assignment?.accessRole === 'staff' ? 'staff' : defaultPosition ? 'staff' : 'student'
    setAccessEditorUid(user.uid); setAccessRoleDraft(accessRole); setPositionDraft(assignment?.positions ?? (defaultPosition ? [defaultPosition] : [])); setBranchDraft(assignment?.branchIds ?? []); setError(null); setSuccess(null)
  }
  const togglePosition = (position: StaffPosition, target: 'access' | 'invite') => {
    const update = (current: StaffPosition[]) => current.includes(position) ? current.filter((item) => item !== position) : [...current, position]
    if (target === 'access') setPositionDraft(update); else setInviteDraft((current) => ({ ...current, positions: update(current.positions) }))
  }
  const toggleBranch = (branchId: string, target: 'access' | 'invite') => {
    const update = (current: string[]) => current.includes(branchId) ? current.filter((item) => item !== branchId) : [...current, branchId]
    if (target === 'access') setBranchDraft(update); else setInviteDraft((current) => ({ ...current, branchIds: update(current.branchIds) }))
  }
  const saveScopedAccess = async (user: AdminRoleUser) => {
    if (!canAssignRole || user.uid === currentUserUid) return
    if (accessRoleDraft === 'staff' && !positionDraft.length) { setError('Nhân viên cần tối thiểu một chức danh trước khi cấp quyền.'); return }
    setAccessSaving(true); setError(null); setSuccess(null)
    try {
      await assignStaffPositions({ uid: user.uid, accessRole: accessRoleDraft, positions: accessRoleDraft === 'staff' ? positionDraft : [], branchIds: accessRoleDraft === 'staff' ? branchDraft : [] })
      setAccessEditorUid(null); setSuccess(`Đã cập nhật chức danh và phạm vi cho ${user.displayName || user.email || user.uid}. Người dùng cần đăng nhập lại để nhận token mới.`)
    } catch (caught) { setError(caught instanceof Error ? caught.message : `Không thể cập nhật quyền cho ${user.displayName || user.email || user.uid}.`) }
    finally { setAccessSaving(false) }
  }
  const submitInvite = async () => {
    if (!canAssignRole) return
    if (!inviteDraft.displayName.trim()) { setError('Nhập họ và tên trước khi tạo lời mời.'); return }
    if (!inviteDraft.phoneNumber.trim() && !inviteDraft.email.trim()) { setError('Cần số điện thoại hoặc email để gửi lời mời tài khoản.'); return }
    if (inviteDraft.accessRole === 'staff' && !inviteDraft.positions.length) { setError('Tài khoản nhân viên cần ít nhất một chức danh.'); return }
    setInviteSaving(true); setError(null); setSuccess(null)
    try {
      const invite = await createAccountInvite({ displayName: inviteDraft.displayName.trim(), phoneNumber: inviteDraft.phoneNumber.trim() || undefined, email: inviteDraft.email.trim() || undefined, accessRole: inviteDraft.accessRole, positions: inviteDraft.accessRole === 'staff' ? inviteDraft.positions : [], branchIds: inviteDraft.accessRole === 'staff' ? inviteDraft.branchIds : [] })
      setInviteOpen(false); setInviteDraft(emptyInviteDraft()); setSuccess(`Đã tạo lời mời cho ${invite.displayName}. Người nhận xác minh OTP hoặc email để tự kích hoạt tài khoản trong 72 giờ.`)
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Không thể tạo lời mời tài khoản.') }
    finally { setInviteSaving(false) }
  }
  const saveBranch = async () => {
    if (!canAssignRole || !branchEditor) return
    const name = branchEditor.name.trim(); const address = branchEditor.address.trim()
    if (!name || !address) { setError('Nhập tên và địa chỉ chi nhánh trước khi lưu.'); return }
    setBranchSaving(true); setError(null)
    try {
      if (branchEditor.id) { await updateBranch({ id: branchEditor.id, name, address, status: 'active' }); setSuccess(`Đã cập nhật chi nhánh ${name}.`) }
      else { await addBranch({ id: `branch_${crypto.randomUUID()}`, name, address, status: 'active' }); setSuccess(`Đã tạo chi nhánh ${name}.`) }
      setBranchEditor(null)
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Không thể lưu chi nhánh.') }
    finally { setBranchSaving(false) }
  }
  const archiveBranch = async (branch: Branch) => {
    if (!canAssignRole || !window.confirm(`Lưu trữ chi nhánh ${branch.name}? Những phân quyền đang dùng chi nhánh này sẽ cần được rà soát.`)) return
    setError(null)
    try { await deleteBranch(branch.id); setSuccess(`Đã lưu trữ chi nhánh ${branch.name}.`) }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Không thể lưu trữ chi nhánh.') }
  }

  if (!canViewTeam) return <div className="page admin-students-page"><div className="empty-state card" style={{ padding: 32 }}><ShieldCheck size={38} /><h3>Bạn chưa có quyền xem đội ngũ</h3><p>Liên hệ quản trị viên để được cấp quyền phù hợp.</p></div></div>

  return <div className="page admin-students-page identity-admin-page">
    <PageHeader eyebrow="DANH TÍNH & TỔ CHỨC" title="Tài khoản, vai trò & chi nhánh" description="Một nơi duy nhất để mời tài khoản, cấp chức danh có phạm vi và quản lý chi nhánh Aura." action={<div className="filter-button" style={{ cursor: 'default', minWidth: 184, justifyContent: 'center' }}><ShieldCheck size={17} color="var(--aura-pink)" />Bạn là {(roleMeta[currentRole] || roleMeta.student).label}</div>} />
    <div className="student-insights" aria-label="Tổng quan đội ngũ"><div><span className="insight-icon purple"><Users /></span><span><small>TỔNG TÀI KHOẢN</small><strong>{stats.total}</strong></span></div><div><span className="insight-icon green"><UserCog /></span><span><small>NHÂN SỰ</small><strong>{stats.staff}</strong></span></div><div><span className="insight-icon orange"><Building2 /></span><span><small>CHI NHÁNH HOẠT ĐỘNG</small><strong>{branches.filter((branch) => branch.status !== 'archived').length}</strong></span></div><div><span className="insight-icon" style={{ color: 'var(--aura-pink)', background: 'var(--aura-pink-soft)' }}><Crown /></span><span><small>QUẢN TRỊ VIÊN</small><strong>{stats.admins}</strong></span></div></div>
    {!canAssignRole && <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 15, padding: '12px 15px', color: '#6c6975', fontSize: 12 }}><ShieldCheck size={18} color="var(--aura-pink)" />Bạn đang xem ở chế độ chỉ đọc. Chỉ Administrator được quản lý tài khoản, chức danh và chi nhánh.</div>}
    <div className="identity-admin-tabs" role="tablist" aria-label="Quản trị danh tính"><button type="button" className={section === 'accounts' ? 'active' : ''} onClick={() => setSection('accounts')} role="tab" aria-selected={section === 'accounts'}><Users size={17} />Tài khoản & quyền</button><button type="button" className={section === 'branches' ? 'active' : ''} onClick={() => setSection('branches')} role="tab" aria-selected={section === 'branches'}><Building2 size={17} />Chi nhánh</button></div>
    {error && <div className="builder-save-error" role="alert" style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}><AlertCircle size={17} /> {error}</div>}
    {success && <div className="card" role="status" style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 15, padding: '12px 15px', color: '#3f7c20', fontSize: 12 }}><CheckCircle2 size={18} color="#68ad32" /> {success}</div>}
    {section === 'accounts' && <>
      <div className="identity-admin-note card"><span><ShieldCheck size={19} /><span><strong>PT, Sales và Quản lý chi nhánh là chức danh có phạm vi.</strong><small>Không cấp bằng danh sách role cũ. Chọn chức danh và chi nhánh ngay tại từng tài khoản hoặc lúc gửi lời mời.</small></span></span>{canAssignRole && <button type="button" className="pink-orange-button" onClick={() => { setInviteDraft(emptyInviteDraft()); setInviteOpen(true); setError(null) }}><Plus size={17} />Tạo tài khoản</button>}</div>
      <div className="admin-list-toolbar students-toolbar roles-directory-toolbar"><div className="course-search"><Search size={18} /><input aria-label="Tìm thành viên" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tìm tên, email hoặc số điện thoại..." /></div><label className="filter-button" style={{ marginLeft: 0 }}><SlidersHorizontal size={16} /><span>Vai trò</span><select aria-label="Lọc theo vai trò" value={roleFilter} onChange={(event) => setRoleFilter(event.target.value as 'all' | UserRole)} style={{ border: 0, outline: 0, color: 'inherit', background: 'transparent', fontWeight: 700 }}><option value="all">Tất cả</option>{roles.map((role) => <option key={role} value={role}>{roleMeta[role].label}</option>)}</select></label><div className="roles-column-picker"><button type="button" className="filter-button" onClick={() => setColumnPickerOpen((current) => !current)} aria-expanded={columnPickerOpen}><Columns3 size={16} />Cột hiển thị</button>{columnPickerOpen && <div className="roles-column-picker__menu">{(Object.keys(directoryColumnMeta) as DirectoryColumn[]).map((column) => <label key={column}><input type="checkbox" checked={visibleColumns[column]} onChange={() => updateColumn(column)} />{directoryColumnMeta[column]}</label>)}</div>}</div></div>
      <div className="students-table card roles-directory" aria-busy={loading}><div className="students-head" style={tableGridStyle}><span>THÀNH VIÊN</span>{visibleColumns.phone && <span>SỐ ĐIỆN THOẠI</span>}{visibleColumns.email && <span>EMAIL ĐĂNG NHẬP</span>}<span>VAI TRÒ</span>{visibleColumns.scope && <span>CHỨC DANH & PHẠM VI</span>}{visibleColumns.activity && <span>HOẠT ĐỘNG</span>}{visibleColumns.status && <span>TRẠNG THÁI</span>}<span /></div>
        {loading && <div className="empty-state" style={{ minHeight: 220 }}><LoaderCircle size={30} className="spin" /><h3>Đang tải danh sách quyền</h3><p>Dữ liệu đội ngũ đang được đồng bộ.</p></div>}
        {!loading && filteredUsers.map((user, index) => <RoleDirectoryRow key={user.uid} user={user} assignment={assignments[user.uid]} index={index} tableGridStyle={tableGridStyle} visibleColumns={visibleColumns} currentUserUid={currentUserUid} canAssignRole={canAssignRole} canAssignSuperAdmin={canAssignSuperAdmin} isSaving={savingUid === user.uid} accessEditorOpen={accessEditorUid === user.uid} accessRoleDraft={accessRoleDraft} positionDraft={positionDraft} branchDraft={branchDraft} accessSaving={accessSaving} branches={branches} onChangeRole={changeRole} onOpenAccessEditor={openAccessEditor} onCloseAccessEditor={() => setAccessEditorUid(null)} onSetAccessRole={(role) => { setAccessRoleDraft(role); if (role === 'student') { setPositionDraft([]); setBranchDraft([]) } }} onTogglePosition={(position) => togglePosition(position, 'access')} onToggleBranch={(branchId) => toggleBranch(branchId, 'access')} onSaveAccess={saveScopedAccess} />)}
        {!loading && filteredUsers.length === 0 && <div className="empty-state"><Users size={30} /><h3>Không tìm thấy thành viên</h3><p>Thử thay đổi từ khóa hoặc bộ lọc vai trò.</p></div>}
      </div>
    </>}
    {section === 'branches' && <section className="identity-branches card"><div className="identity-branches__header"><span><Building2 size={20} /><span><strong>Chi nhánh & phạm vi vận hành</strong><small>Chi nhánh được tạo ở đây sẽ xuất hiện ngay trong form cấp quyền nhân sự.</small></span></span>{canAssignRole && <button type="button" className="pink-orange-button" onClick={() => { setBranchEditor({ name: '', address: '' }); setError(null) }}><Plus size={17} />Tạo chi nhánh</button>}</div><div className="identity-branch-list">{branches.length ? branches.map((branch) => <article key={branch.id} className={branch.status === 'archived' ? 'archived' : ''}><span><Building2 size={18} /><span><strong>{branch.name}</strong><small>{branch.address}</small></span></span><span className="identity-branch-list__actions"><i className={`status-badge ${branch.status === 'archived' ? 'draft' : 'published'}`}>{branch.status === 'archived' ? 'Đã lưu trữ' : 'Đang hoạt động'}</i>{canAssignRole && <><button type="button" className="outline-button" onClick={() => setBranchEditor({ id: branch.id, name: branch.name, address: branch.address })}>Chỉnh sửa</button>{branch.status !== 'archived' && <button type="button" className="outline-button" onClick={() => void archiveBranch(branch)}>Lưu trữ</button>}</>}</span></article>) : <div className="empty-state"><Building2 size={30} /><h3>Chưa có chi nhánh</h3><p>Tạo chi nhánh đầu tiên để cấp phạm vi cho Sales hoặc Quản lý chi nhánh.</p></div>}</div></section>}
    {inviteOpen && <section className="identity-overlay" role="dialog" aria-modal="true" aria-labelledby="invite-title"><button className="identity-overlay__backdrop" type="button" aria-label="Đóng" onClick={() => setInviteOpen(false)} /><div className="identity-modal"><ModalHeader id="invite-title" title="Tạo lời mời tài khoản" detail="Không tạo mật khẩu mặc định. Người nhận tự xác minh OTP hoặc email để kích hoạt." icon={<UserCog size={21} />} onClose={() => setInviteOpen(false)} /><div className="identity-form-grid"><label><span>Họ và tên</span><input value={inviteDraft.displayName} onChange={(event) => setInviteDraft((current) => ({ ...current, displayName: event.target.value }))} placeholder="Ví dụ: Nguyễn Minh Anh" /></label><label><span>Số điện thoại nhận OTP</span><input type="tel" value={inviteDraft.phoneNumber} onChange={(event) => setInviteDraft((current) => ({ ...current, phoneNumber: event.target.value }))} placeholder="090…" /></label><label className="identity-form-grid__span"><span>Email đăng nhập / dự phòng</span><input type="email" value={inviteDraft.email} onChange={(event) => setInviteDraft((current) => ({ ...current, email: event.target.value }))} placeholder="ten@aurafitness.vn" /></label></div><AccessRoleChooser value={inviteDraft.accessRole} onChange={(role) => setInviteDraft((current) => ({ ...current, accessRole: role, positions: role === 'student' ? [] : current.positions, branchIds: role === 'student' ? [] : current.branchIds }))} />{inviteDraft.accessRole === 'staff' && <ScopedAssignmentFields positions={inviteDraft.positions} branchIds={inviteDraft.branchIds} branches={branches} onTogglePosition={(position) => togglePosition(position, 'invite')} onToggleBranch={(branchId) => toggleBranch(branchId, 'invite')} />}<div className="identity-modal__actions"><button type="button" className="outline-button" onClick={() => setInviteOpen(false)}>Hủy</button><button type="button" className="pink-orange-button" onClick={() => void submitInvite()} disabled={inviteSaving}>{inviteSaving ? 'Đang tạo lời mời...' : 'Tạo lời mời an toàn'}</button></div></div></section>}
    {branchEditor && <section className="identity-overlay" role="dialog" aria-modal="true" aria-labelledby="branch-title"><button className="identity-overlay__backdrop" type="button" aria-label="Đóng" onClick={() => setBranchEditor(null)} /><div className="identity-modal identity-modal--compact"><ModalHeader id="branch-title" title={branchEditor.id ? 'Chỉnh sửa chi nhánh' : 'Tạo chi nhánh'} detail="Chi nhánh này sẽ là phạm vi cấp quyền cho đội ngũ." icon={<Building2 size={21} />} onClose={() => setBranchEditor(null)} /><div className="identity-form-grid"><label className="identity-form-grid__span"><span>Tên chi nhánh</span><input value={branchEditor.name} onChange={(event) => setBranchEditor((current) => current ? { ...current, name: event.target.value } : current)} placeholder="Aura Fitness Quận 7" /></label><label className="identity-form-grid__span"><span>Địa chỉ</span><input value={branchEditor.address} onChange={(event) => setBranchEditor((current) => current ? { ...current, address: event.target.value } : current)} placeholder="Địa chỉ vận hành" /></label></div><div className="identity-modal__actions"><button type="button" className="outline-button" onClick={() => setBranchEditor(null)}>Hủy</button><button type="button" className="pink-orange-button" onClick={() => void saveBranch()} disabled={branchSaving}>{branchSaving ? 'Đang lưu...' : 'Lưu chi nhánh'}</button></div></div></section>}
  </div>
}

function RoleDirectoryRow({ user, assignment, index, tableGridStyle, visibleColumns, currentUserUid, canAssignRole, canAssignSuperAdmin, isSaving, accessEditorOpen, accessRoleDraft, positionDraft, branchDraft, accessSaving, branches, onChangeRole, onOpenAccessEditor, onCloseAccessEditor, onSetAccessRole, onTogglePosition, onToggleBranch, onSaveAccess }: {
  user: AdminRoleUser; assignment?: RoleAssignmentSummary; index: number; tableGridStyle: CSSProperties; visibleColumns: Record<DirectoryColumn, boolean>; currentUserUid?: string; canAssignRole: boolean; canAssignSuperAdmin: boolean; isSaving: boolean; accessEditorOpen: boolean; accessRoleDraft: 'student' | 'staff'; positionDraft: StaffPosition[]; branchDraft: string[]; accessSaving: boolean; branches: Branch[]; onChangeRole: (user: AdminRoleUser, nextRole: UserRole) => Promise<void>; onOpenAccessEditor: (user: AdminRoleUser, assignment?: RoleAssignmentSummary) => void; onCloseAccessEditor: () => void; onSetAccessRole: (role: 'student' | 'staff') => void; onTogglePosition: (position: StaffPosition) => void; onToggleBranch: (branchId: string) => void; onSaveAccess: (user: AdminRoleUser) => Promise<void>
}) {
  const status = statusMeta[assignment?.status === 'suspended' ? 'disabled' : user.status ?? 'active']; const userRoleData = roleMeta[user.role] || roleMeta.student
  const managedAsStaffPosition = staffPositionRoles.has(user.role)
  const roleLocked = !canAssignRole || isSaving || user.uid === currentUserUid || managedAsStaffPosition || ((user.role === 'admin' || user.role === 'super_admin') && !canAssignSuperAdmin)
  const canEditScopedAccess = canAssignRole && user.uid !== currentUserUid && user.role !== 'admin' && user.role !== 'super_admin'
  const assignedBranches = assignment?.branchIds.map((branchId) => branches.find((branch) => branch.id === branchId)?.name || 'Chi nhánh đã lưu trữ') ?? []
  const assignedPositions = assignment?.positions.map(assignmentPositionLabel) ?? []
  const scope = assignedPositions.length ? `${assignedPositions.join(' · ')}${assignedBranches.length ? ` — ${assignedBranches.join(', ')}` : ' — Toàn hệ thống'}` : userRoleData.scope
  return <div><article className="student-row" style={tableGridStyle}><span className="student-identity">{user.photoURL ? <img src={user.photoURL} alt="" className="avatar avatar-photo" referrerPolicy="no-referrer" /> : <i className={['purple', 'green', 'orange', 'pink', 'blue'][index % 5]}>{initials(user.displayName, user.email)}</i>}<span><strong>{user.displayName || 'Chưa cập nhật tên'}</strong><small>{user.uid.slice(0, 10)}…</small></span></span>{visibleColumns.phone && <span className="identity-contact-cell">{user.phoneNumber ? <><Phone size={14} />{user.phoneNumber}</> : <em>Chưa cập nhật</em>}</span>}{visibleColumns.email && <span className="identity-contact-cell">{user.email ? <><Mail size={14} />{user.email}</> : <em>Chưa cập nhật</em>}</span>}<span><select aria-label={`Vai trò của ${user.displayName || user.email || user.uid}`} value={user.role || 'student'} disabled={roleLocked} onChange={(event) => void onChangeRole(user, event.target.value as UserRole)} style={{ width: '100%', minHeight: 36, padding: '0 9px', border: '1px solid var(--line)', borderRadius: 8, color: userRoleData.tone, background: '#fff', fontSize: 11, fontWeight: 750 }}>{managedAsStaffPosition && <option value={user.role}>{roleMeta[user.role].label} · chức danh</option>}{roles.map((role) => <option key={role} value={role} disabled={(role === 'admin' || role === 'super_admin') && !canAssignSuperAdmin}>{roleMeta[role].label}</option>)}</select></span>{visibleColumns.scope && <span className="program-name identity-scope-cell">{scope}</span>}{visibleColumns.activity && <span className="student-streak">{user.lastActive ?? 'Chưa có dữ liệu'}</span>}{visibleColumns.status && <span><i className={`status-badge ${status.className}`}>{status.label}</i></span>}<span className="row-actions" aria-live="polite">{isSaving ? <LoaderCircle size={18} className="spin" color="var(--aura-pink)" /> : <>{canEditScopedAccess && <button type="button" className="icon-button" aria-label={`Cấp chức danh và phạm vi cho ${user.displayName || user.email || user.uid}`} title="Chức danh & phạm vi" onClick={() => onOpenAccessEditor(user, assignment)}><UserCog size={17} /></button>}<CheckCircle2 size={18} color="#7fcb36" /></>}</span></article>{accessEditorOpen && <section className="identity-access-editor" aria-label={`Chức danh và phạm vi của ${user.displayName || user.email || user.uid}`}><div className="identity-access-editor__heading"><span><ShieldCheck size={18} /><span><strong>Chức danh & phạm vi vận hành</strong><small>Quyền được tính ở backend; trình duyệt không thể tự cấp quyền.</small></span></span><button type="button" className="icon-button" aria-label="Đóng" onClick={onCloseAccessEditor}><X size={17} /></button></div><AccessRoleChooser value={accessRoleDraft} onChange={onSetAccessRole} />{accessRoleDraft === 'staff' && <ScopedAssignmentFields positions={positionDraft} branchIds={branchDraft} branches={branches} onTogglePosition={onTogglePosition} onToggleBranch={onToggleBranch} />}<div className="identity-access-editor__actions"><button type="button" className="outline-button" onClick={onCloseAccessEditor}>Hủy</button><button type="button" className="pink-orange-button" onClick={() => void onSaveAccess(user)} disabled={accessSaving || (accessRoleDraft === 'staff' && !positionDraft.length)}>{accessSaving ? 'Đang cấp quyền...' : 'Lưu quyền & yêu cầu đăng nhập lại'}</button></div></section>}</div>
}

function AccessRoleChooser({ value, onChange }: { value: 'student' | 'staff'; onChange: (value: 'student' | 'staff') => void }) {
  return <div className="identity-access-editor__role" role="radiogroup" aria-label="Loại tài khoản"><button type="button" className={value === 'student' ? 'active' : ''} onClick={() => onChange('student')}>Học viên</button><button type="button" className={value === 'staff' ? 'active' : ''} onClick={() => onChange('staff')}>Nhân viên</button></div>
}
function ScopedAssignmentFields({ positions, branchIds, branches, onTogglePosition, onToggleBranch }: { positions: StaffPosition[]; branchIds: string[]; branches: Branch[]; onTogglePosition: (position: StaffPosition) => void; onToggleBranch: (branchId: string) => void }) {
  return <><div className="identity-access-editor__options" aria-label="Chức danh">{positionOptions.map((position) => <label key={position.id}><input type="checkbox" checked={positions.includes(position.id)} onChange={() => onTogglePosition(position.id)} /><span><strong>{position.label}</strong><small>{position.description}</small></span></label>)}</div><div className="identity-access-editor__branches"><strong>Phạm vi chi nhánh</strong><small>Để trống khi chức danh không bị giới hạn theo chi nhánh. Với Sales/Quản lý nên chọn ít nhất một chi nhánh.</small>{branches.length ? <div>{branches.filter((branch) => branch.status !== 'archived').map((branch) => <label key={branch.id}><input type="checkbox" checked={branchIds.includes(branch.id)} onChange={() => onToggleBranch(branch.id)} /> {branch.name}</label>)}</div> : <em>Chưa có chi nhánh. Tạo chi nhánh trong tab Chi nhánh trước hoặc bổ sung phạm vi sau.</em>}</div></>
}
function ModalHeader({ id, title, detail, icon, onClose }: { id: string; title: string; detail: string; icon: ReactNode; onClose: () => void }) {
  return <div className="identity-modal__header"><span>{icon}<span><strong id={id}>{title}</strong><small>{detail}</small></span></span><button type="button" className="icon-button" aria-label="Đóng" onClick={onClose}><X size={18} /></button></div>
}
