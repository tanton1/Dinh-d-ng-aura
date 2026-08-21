import '../../styles-admin.css'
import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import {
  AlertCircle, Building2, CheckCircle2, Columns3, Crown, LoaderCircle,
  CalendarClock, Mail, Phone, Plus, Search, ShieldCheck, SlidersHorizontal, UserCog, Users, WalletCards, X,
} from 'lucide-react'
import { PageHeader } from '../../components/ui'
import { collection, onSnapshot } from 'firebase/firestore'
import { hasPermission } from '../../config/permissions'
import { useDatabase } from '../../contexts/DatabaseContext'
import { firestoreDb } from '../../lib/firebase'
import { assignStaffPositions, provisionStaffAccount, provisionStudentAccount, saveStaffOperationsProfile, suspendAccountAccess } from '../../services/identityAccessService'
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
type RolesSection = 'accounts' | 'branches' | 'staff'
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
type StaffOperationsRecord = {
  availableSlots?: string[]; baseSalary?: number; bonusMonthly?: number; commissionRate?: number; commissionPerSession?: number
  name?: string; email?: string; phone?: string; role?: string
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
function asKnownRole(value: unknown): UserRole {
  return typeof value === 'string' && value in roleMeta ? value as UserRole : 'student'
}
function profileDirectoryUser(uid: string, data: Record<string, unknown>): AdminRoleUser {
  return {
    uid,
    displayName: typeof data.displayName === 'string' ? data.displayName : typeof data.name === 'string' ? data.name : '',
    email: typeof data.email === 'string' ? data.email : '',
    phoneNumber: typeof data.phoneNumber === 'string' ? data.phoneNumber : typeof data.phone === 'string' ? data.phone : undefined,
    photoURL: typeof data.photoURL === 'string' ? data.photoURL : typeof data.photoUrl === 'string' ? data.photoUrl : null,
    role: asKnownRole(data.role),
    status: data.disabled === true ? 'disabled' : data.status === 'invited' ? 'invited' : 'active',
    lastActive: typeof data.lastActive === 'string' ? data.lastActive : undefined,
  }
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
  const [staffOperations, setStaffOperations] = useState<Record<string, StaffOperationsRecord>>({})
  const [directorySnapshot, setDirectorySnapshot] = useState<Record<string, AdminRoleUser>>({})
  const [legacyContracts, setLegacyContracts] = useState<Array<Record<string, unknown>>>([])
  const [staffEditor, setStaffEditor] = useState<{ uid: string; displayName: string; email: string; phoneNumber: string; slots: string[]; compensation: Required<Pick<StaffOperationsRecord, 'baseSalary' | 'bonusMonthly' | 'commissionRate' | 'commissionPerSession'>> } | null>(null)
  const [staffSaving, setStaffSaving] = useState(false)

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
  useEffect(() => {
    if (!canViewTeam || !firestoreDb) {
      setDirectorySnapshot({})
      return
    }
    return onSnapshot(collection(firestoreDb, 'users'), (snapshot) => {
      const next: Record<string, AdminRoleUser> = {}
      snapshot.forEach((item) => { next[item.id] = profileDirectoryUser(item.id, item.data() as Record<string, unknown>) })
      setDirectorySnapshot(next)
    }, () => setDirectorySnapshot({}))
  }, [canViewTeam])
  useEffect(() => {
    if (section !== 'staff' || !canViewTeam || !firestoreDb) return
    const stopStaff = onSnapshot(collection(firestoreDb, 'staff'), (snapshot) => {
      const next: Record<string, StaffOperationsRecord> = {}
      snapshot.forEach((item) => { next[item.id] = item.data() as StaffOperationsRecord })
      setStaffOperations(next)
    }, () => setStaffOperations({}))
    const stopTrainers = onSnapshot(collection(firestoreDb, 'trainers'), (snapshot) => {
      setStaffOperations((current) => {
        const next = { ...current }
        snapshot.forEach((item) => { next[item.id] = { ...next[item.id], ...(item.data() as StaffOperationsRecord) } })
        return next
      })
    })
    const stopContracts = onSnapshot(collection(firestoreDb, 'contracts'), (snapshot) => setLegacyContracts(snapshot.docs.map((item) => item.data() as Record<string, unknown>)), () => setLegacyContracts([]))
    return () => { stopStaff(); stopTrainers(); stopContracts() }
  }, [section, canViewTeam])
  const directoryUsers = useMemo(() => {
    const next = new Map(users.map((user) => [user.uid, user]))
    Object.values(directorySnapshot).forEach((user) => {
      const current = next.get(user.uid)
      next.set(user.uid, {
        ...current,
        ...user,
        displayName: user.displayName || current?.displayName || '',
        email: user.email || current?.email || '',
        phoneNumber: user.phoneNumber || current?.phoneNumber,
      })
    })
    return [...next.values()]
  }, [directorySnapshot, users])
  const filteredUsers = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase('vi')
    return directoryUsers.filter((user) => (!normalizedQuery || `${user.displayName} ${user.email} ${user.phoneNumber || ''}`.toLocaleLowerCase('vi').includes(normalizedQuery)) && (roleFilter === 'all' || user.role === roleFilter))
  }, [directoryUsers, query, roleFilter])
  const stats = useMemo(() => ({
    total: directoryUsers.length, staff: directoryUsers.filter((user) => assignments[user.uid]?.accessRole === 'staff' || staffPositionRoles.has(user.role) || Boolean(staffOperations[user.uid])).length,
    content: directoryUsers.filter((user) => user.role === 'coach' || user.role === 'editor').length,
    admins: directoryUsers.filter((user) => user.role === 'admin' || user.role === 'super_admin').length,
  }), [assignments, directoryUsers, staffOperations])
  const staffRows = useMemo(() => {
    const byUid = new Map(directoryUsers.map((user) => [user.uid, user]))
    const ids = new Set([...Object.keys(staffOperations), ...directoryUsers.filter((user) => assignments[user.uid]?.accessRole === 'staff' || staffPositionRoles.has(user.role)).map((user) => user.uid)])
    return [...ids].map((uid) => byUid.get(uid) || profileDirectoryUser(uid, staffOperations[uid] || {}))
  }, [assignments, directoryUsers, staffOperations])
  const countManagedClients = (uid: string, kind: 'main' | 'secondary' | 'nutrition') => legacyContracts.filter((contract) => {
    const trainerIds = Array.isArray(contract.trainerIds) ? contract.trainerIds : []
    if (kind === 'main') return contract.trainerId === uid || trainerIds[0] === uid
    if (kind === 'secondary') return trainerIds.slice(1).includes(uid) || contract.secondaryTrainerId === uid
    return contract.nutritionTrainerId === uid || (Array.isArray(contract.nutritionTrainerIds) && contract.nutritionTrainerIds.includes(uid))
  }).length
  const openStaffEditor = (member: AdminRoleUser) => {
    const record = staffOperations[member.uid] || {}
    setStaffEditor({
      uid: member.uid,
      displayName: member.displayName || record.name || '',
      email: member.email || record.email || '',
      phoneNumber: member.phoneNumber || record.phone || '',
      slots: Array.isArray(record.availableSlots) ? record.availableSlots : [],
      compensation: { baseSalary: Number(record.baseSalary || 0), bonusMonthly: Number(record.bonusMonthly || 0), commissionRate: Number(record.commissionRate || 0), commissionPerSession: Number(record.commissionPerSession || 0) },
    })
  }
  const toggleStaffSlot = (slot: string) => setStaffEditor((current) => current ? { ...current, slots: current.slots.includes(slot) ? current.slots.filter((item) => item !== slot) : [...current.slots, slot] } : current)
  const saveStaffProfile = async () => {
    if (!staffEditor) return
    setStaffSaving(true); setError(null)
    try { await saveStaffOperationsProfile({ uid: staffEditor.uid, displayName: staffEditor.displayName, email: staffEditor.email, phoneNumber: staffEditor.phoneNumber, availabilitySlots: staffEditor.slots, compensation: staffEditor.compensation }); setStaffEditor(null); setSuccess('Đã lưu thông tin, ma trận thời gian và chính sách lương, thưởng, hoa hồng của nhân viên.') }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Không thể lưu hồ sơ vận hành nhân viên.') }
    finally { setStaffSaving(false) }
  }
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
    if (!inviteDraft.displayName.trim()) { setError('Nhập họ và tên trước khi tạo tài khoản.'); return }
    if (!inviteDraft.phoneNumber.trim() || !inviteDraft.email.trim()) { setError('Cần số điện thoại thật và email đăng nhập để tạo tài khoản.'); return }
    if (inviteDraft.accessRole === 'staff' && !inviteDraft.positions.length) { setError('Tài khoản nhân viên cần ít nhất một chức danh.'); return }
    setInviteSaving(true); setError(null); setSuccess(null)
    try {
      const common = { displayName: inviteDraft.displayName.trim(), phoneNumber: inviteDraft.phoneNumber.trim(), email: inviteDraft.email.trim() }
      const result = inviteDraft.accessRole === 'staff'
        ? await provisionStaffAccount({ ...common, positions: inviteDraft.positions, branchIds: inviteDraft.branchIds })
        : await provisionStudentAccount(common)
      setInviteOpen(false); setInviteDraft(emptyInviteDraft()); setSuccess(`Đã tạo tài khoản cho ${result.displayName}. Mật khẩu ban đầu là số điện thoại; người dùng sẽ đổi trong Hồ sơ cá nhân sau khi đăng nhập.`)
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Không thể tạo tài khoản.') }
    finally { setInviteSaving(false) }
  }
  const suspendStaff = async (member: AdminRoleUser) => {
    if (!canAssignRole || member.uid === currentUserUid) return
    if (!window.confirm(`Khóa và lưu trữ tài khoản ${member.displayName || member.email || member.uid}? Dữ liệu lịch sử, lương và chấm công vẫn được giữ để đối soát.`)) return
    setSavingUid(member.uid); setError(null); setSuccess(null)
    try {
      await suspendAccountAccess(member.uid)
      setSuccess(`Đã khóa và lưu trữ ${member.displayName || member.email || member.uid}. Không xóa lịch sử vận hành.`)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Không thể khóa tài khoản nhân viên.')
    } finally { setSavingUid(null) }
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
    <div className="identity-admin-tabs identity-admin-tabs--three" role="tablist" aria-label="Quản trị danh tính"><button type="button" className={section === 'accounts' ? 'active' : ''} onClick={() => setSection('accounts')} role="tab" aria-selected={section === 'accounts'}><Users size={17} />Tài khoản & quyền</button><button type="button" className={section === 'staff' ? 'active' : ''} onClick={() => setSection('staff')} role="tab" aria-selected={section === 'staff'}><CalendarClock size={17} />Tài khoản nhân viên</button><button type="button" className={section === 'branches' ? 'active' : ''} onClick={() => setSection('branches')} role="tab" aria-selected={section === 'branches'}><Building2 size={17} />Chi nhánh</button></div>
    {error && <div className="builder-save-error" role="alert" style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}><AlertCircle size={17} /> {error}</div>}
    {success && <div className="card" role="status" style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 15, padding: '12px 15px', color: '#3f7c20', fontSize: 12 }}><CheckCircle2 size={18} color="#68ad32" /> {success}</div>}
    {section === 'accounts' && <>
      <div className="identity-admin-note card"><span><ShieldCheck size={19} /><span><strong>PT, Sales và Quản lý chi nhánh là chức danh có phạm vi.</strong><small>Không cấp bằng danh sách role cũ. Tạo tài khoản một lần; mật khẩu khởi tạo là số điện thoại và bắt buộc đổi trong Hồ sơ cá nhân.</small></span></span>{canAssignRole && <button type="button" className="pink-orange-button" onClick={() => { setInviteDraft(emptyInviteDraft()); setInviteOpen(true); setError(null) }}><Plus size={17} />Tạo tài khoản</button>}</div>
      <div className="admin-list-toolbar students-toolbar roles-directory-toolbar"><div className="course-search"><Search size={18} /><input aria-label="Tìm thành viên" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tìm tên, email hoặc số điện thoại..." /></div><label className="filter-button" style={{ marginLeft: 0 }}><SlidersHorizontal size={16} /><span>Vai trò</span><select aria-label="Lọc theo vai trò" value={roleFilter} onChange={(event) => setRoleFilter(event.target.value as 'all' | UserRole)} style={{ border: 0, outline: 0, color: 'inherit', background: 'transparent', fontWeight: 700 }}><option value="all">Tất cả</option>{roles.map((role) => <option key={role} value={role}>{roleMeta[role].label}</option>)}</select></label><div className="roles-column-picker"><button type="button" className="filter-button" onClick={() => setColumnPickerOpen((current) => !current)} aria-expanded={columnPickerOpen}><Columns3 size={16} />Cột hiển thị</button>{columnPickerOpen && <div className="roles-column-picker__menu">{(Object.keys(directoryColumnMeta) as DirectoryColumn[]).map((column) => <label key={column}><input type="checkbox" checked={visibleColumns[column]} onChange={() => updateColumn(column)} />{directoryColumnMeta[column]}</label>)}</div>}</div></div>
      <div className="students-table card roles-directory" aria-busy={loading}><div className="students-head" style={tableGridStyle}><span>THÀNH VIÊN</span>{visibleColumns.phone && <span>SỐ ĐIỆN THOẠI</span>}{visibleColumns.email && <span>EMAIL ĐĂNG NHẬP</span>}<span>VAI TRÒ</span>{visibleColumns.scope && <span>CHỨC DANH & PHẠM VI</span>}{visibleColumns.activity && <span>HOẠT ĐỘNG</span>}{visibleColumns.status && <span>TRẠNG THÁI</span>}<span /></div>
        {loading && <div className="empty-state" style={{ minHeight: 220 }}><LoaderCircle size={30} className="spin" /><h3>Đang tải danh sách quyền</h3><p>Dữ liệu đội ngũ đang được đồng bộ.</p></div>}
        {!loading && filteredUsers.map((user, index) => <RoleDirectoryRow key={user.uid} user={user} assignment={assignments[user.uid]} index={index} tableGridStyle={tableGridStyle} visibleColumns={visibleColumns} currentUserUid={currentUserUid} canAssignRole={canAssignRole} canAssignSuperAdmin={canAssignSuperAdmin} isSaving={savingUid === user.uid} accessEditorOpen={accessEditorUid === user.uid} accessRoleDraft={accessRoleDraft} positionDraft={positionDraft} branchDraft={branchDraft} accessSaving={accessSaving} branches={branches} onChangeRole={changeRole} onOpenAccessEditor={openAccessEditor} onCloseAccessEditor={() => setAccessEditorUid(null)} onSetAccessRole={(role) => { setAccessRoleDraft(role); if (role === 'student') { setPositionDraft([]); setBranchDraft([]) } }} onTogglePosition={(position) => togglePosition(position, 'access')} onToggleBranch={(branchId) => toggleBranch(branchId, 'access')} onSaveAccess={saveScopedAccess} />)}
        {!loading && filteredUsers.length === 0 && <div className="empty-state"><Users size={30} /><h3>Không tìm thấy thành viên</h3><p>Thử thay đổi từ khóa hoặc bộ lọc vai trò.</p></div>}
      </div>
    </>}
    {section === 'branches' && <section className="identity-branches card"><div className="identity-branches__header"><span><Building2 size={20} /><span><strong>Chi nhánh & phạm vi vận hành</strong><small>Chi nhánh được tạo ở đây sẽ xuất hiện ngay trong form cấp quyền nhân sự.</small></span></span>{canAssignRole && <button type="button" className="pink-orange-button" onClick={() => { setBranchEditor({ name: '', address: '' }); setError(null) }}><Plus size={17} />Tạo chi nhánh</button>}</div><div className="identity-branch-list">{branches.length ? branches.map((branch) => <article key={branch.id} className={branch.status === 'archived' ? 'archived' : ''}><span><Building2 size={18} /><span><strong>{branch.name}</strong><small>{branch.address}</small></span></span><span className="identity-branch-list__actions"><i className={`status-badge ${branch.status === 'archived' ? 'draft' : 'published'}`}>{branch.status === 'archived' ? 'Đã lưu trữ' : 'Đang hoạt động'}</i>{canAssignRole && <><button type="button" className="outline-button" onClick={() => setBranchEditor({ id: branch.id, name: branch.name, address: branch.address })}>Chỉnh sửa</button>{branch.status !== 'archived' && <button type="button" className="outline-button" onClick={() => void archiveBranch(branch)}>Lưu trữ</button>}</>}</span></article>) : <div className="empty-state"><Building2 size={30} /><h3>Chưa có chi nhánh</h3><p>Tạo chi nhánh đầu tiên để cấp phạm vi cho Sales hoặc Quản lý chi nhánh.</p></div>}</div></section>}
    {section === 'staff' && <section className="identity-staff card"><div className="identity-branches__header"><span><CalendarClock size={20} /><span><strong>Tài khoản nhân viên & vận hành</strong><small>Hiển thị cả hồ sơ nhân viên, trainer và tài khoản có chức danh; thiết lập ma trận thời gian, lương, thưởng và hoa hồng ở một nơi.</small></span></span>{canAssignRole && <button type="button" className="pink-orange-button" onClick={() => { setInviteDraft({ ...emptyInviteDraft(), accessRole: 'staff' }); setInviteOpen(true); setError(null) }}><Plus size={17} />Tạo tài khoản nhân viên</button>}</div><div className="identity-staff-grid">{staffRows.map((member) => { const assignment = assignments[member.uid]; const positions = assignment?.positions.map(assignmentPositionLabel).join(' · ') || roleMeta[member.role].label; const record = staffOperations[member.uid] || {}; const isSuspended = assignment?.status === 'suspended' || member.status === 'disabled'; return <article key={member.uid}><div className="identity-staff-card__head"><span><strong>{member.displayName || 'Chưa cập nhật tên'}</strong><small>{member.email || member.phoneNumber || 'Chưa cập nhật liên hệ'}</small></span><i className={`status-badge ${isSuspended ? 'attention' : 'published'}`}>{isSuspended ? 'Đã khóa' : positions}</i></div><div className="identity-staff-card__metrics"><span><small>Quản lý chính</small><strong>{countManagedClients(member.uid, 'main')}</strong></span><span><small>Phối hợp</small><strong>{countManagedClients(member.uid, 'secondary')}</strong></span><span><small>Dinh dưỡng</small><strong>{countManagedClients(member.uid, 'nutrition')}</strong></span></div><p><WalletCards size={15} /> Lương {Number(record.baseSalary || 0).toLocaleString('vi-VN')}đ · Thưởng {Number(record.bonusMonthly || 0).toLocaleString('vi-VN')}đ · HH {Number(record.commissionPerSession || 0).toLocaleString('vi-VN')}đ/buổi</p><p><CalendarClock size={15} /> {Array.isArray(record.availableSlots) && record.availableSlots.length ? `${record.availableSlots.length} khung thời gian rảnh đã thiết lập` : 'Chưa thiết lập thời gian rảnh'}</p>{canAssignRole && <div className="identity-staff-card__actions"><button type="button" className="outline-button" onClick={() => openStaffEditor(member)}>Chỉnh sửa</button>{!isSuspended && member.uid !== currentUserUid && <button type="button" className="outline-button identity-staff-card__archive" onClick={() => void suspendStaff(member)} disabled={savingUid === member.uid}>Khóa & lưu trữ</button>}</div>}</article> })}{!staffRows.length && <div className="empty-state"><Users size={30} /><h3>Chưa có tài khoản nhân viên</h3><p>Tạo tài khoản nhân viên trực tiếp ở đây và cấp chức danh, phạm vi phù hợp.</p></div>}</div></section>}
    {inviteOpen && <section className="identity-overlay" role="dialog" aria-modal="true" aria-labelledby="invite-title"><button className="identity-overlay__backdrop" type="button" aria-label="Đóng" onClick={() => setInviteOpen(false)} /><div className="identity-modal"><ModalHeader id="invite-title" title={inviteDraft.accessRole === 'staff' ? 'Tạo tài khoản nhân viên' : 'Tạo tài khoản học viên'} detail="Tài khoản được tạo trực tiếp. Mật khẩu ban đầu là số điện thoại, người dùng đổi trong Hồ sơ cá nhân sau khi đăng nhập." icon={<UserCog size={21} />} onClose={() => setInviteOpen(false)} /><div className="identity-form-grid"><label><span>Họ và tên</span><input value={inviteDraft.displayName} onChange={(event) => setInviteDraft((current) => ({ ...current, displayName: event.target.value }))} placeholder="Ví dụ: Nguyễn Minh Anh" /></label><label><span>Số điện thoại / mật khẩu ban đầu</span><input type="tel" value={inviteDraft.phoneNumber} onChange={(event) => setInviteDraft((current) => ({ ...current, phoneNumber: event.target.value }))} placeholder="090…" /></label><label className="identity-form-grid__span"><span>Email đăng nhập</span><input type="email" value={inviteDraft.email} onChange={(event) => setInviteDraft((current) => ({ ...current, email: event.target.value }))} placeholder="ten@aurafitness.vn" /></label></div><AccessRoleChooser value={inviteDraft.accessRole} onChange={(role) => setInviteDraft((current) => ({ ...current, accessRole: role, positions: role === 'student' ? [] : current.positions, branchIds: role === 'student' ? [] : current.branchIds }))} />{inviteDraft.accessRole === 'staff' && <ScopedAssignmentFields positions={inviteDraft.positions} branchIds={inviteDraft.branchIds} branches={branches} onTogglePosition={(position) => togglePosition(position, 'invite')} onToggleBranch={(branchId) => toggleBranch(branchId, 'invite')} />}<div className="identity-modal__actions"><button type="button" className="outline-button" onClick={() => setInviteOpen(false)}>Hủy</button><button type="button" className="pink-orange-button" onClick={() => void submitInvite()} disabled={inviteSaving}>{inviteSaving ? 'Đang tạo tài khoản...' : 'Tạo tài khoản'}</button></div></div></section>}
    {branchEditor && <section className="identity-overlay" role="dialog" aria-modal="true" aria-labelledby="branch-title"><button className="identity-overlay__backdrop" type="button" aria-label="Đóng" onClick={() => setBranchEditor(null)} /><div className="identity-modal identity-modal--compact"><ModalHeader id="branch-title" title={branchEditor.id ? 'Chỉnh sửa chi nhánh' : 'Tạo chi nhánh'} detail="Chi nhánh này sẽ là phạm vi cấp quyền cho đội ngũ." icon={<Building2 size={21} />} onClose={() => setBranchEditor(null)} /><div className="identity-form-grid"><label className="identity-form-grid__span"><span>Tên chi nhánh</span><input value={branchEditor.name} onChange={(event) => setBranchEditor((current) => current ? { ...current, name: event.target.value } : current)} placeholder="Aura Fitness Quận 7" /></label><label className="identity-form-grid__span"><span>Địa chỉ</span><input value={branchEditor.address} onChange={(event) => setBranchEditor((current) => current ? { ...current, address: event.target.value } : current)} placeholder="Địa chỉ vận hành" /></label></div><div className="identity-modal__actions"><button type="button" className="outline-button" onClick={() => setBranchEditor(null)}>Hủy</button><button type="button" className="pink-orange-button" onClick={() => void saveBranch()} disabled={branchSaving}>{branchSaving ? 'Đang lưu...' : 'Lưu chi nhánh'}</button></div></div></section>}
    {staffEditor && <section className="identity-overlay" role="dialog" aria-modal="true" aria-labelledby="staff-operations-title"><button className="identity-overlay__backdrop" type="button" aria-label="Đóng" onClick={() => setStaffEditor(null)} /><div className="identity-modal"><ModalHeader id="staff-operations-title" title="Thiết lập vận hành nhân viên" detail="Chỉnh thông tin đăng nhập, ma trận thời gian và cấu hình lương tại một nơi. Payroll chính thức vẫn cần kỳ lương đã duyệt." icon={<WalletCards size={21} />} onClose={() => setStaffEditor(null)} /><div className="identity-form-grid"><label className="identity-form-grid__span"><span>Họ và tên</span><input value={staffEditor.displayName} onChange={(event) => setStaffEditor((current) => current ? { ...current, displayName: event.target.value } : current)} placeholder="Họ và tên nhân viên" /></label><label><span>Email đăng nhập</span><input type="email" value={staffEditor.email} onChange={(event) => setStaffEditor((current) => current ? { ...current, email: event.target.value } : current)} placeholder="ten@aurafitness.vn" /></label><label><span>Số điện thoại</span><input type="tel" value={staffEditor.phoneNumber} onChange={(event) => setStaffEditor((current) => current ? { ...current, phoneNumber: event.target.value } : current)} placeholder="090…" /></label></div><div className="identity-form-grid"><label><span>Lương cơ bản / tháng</span><input type="number" min="0" value={staffEditor.compensation.baseSalary} onChange={(event) => setStaffEditor((current) => current ? { ...current, compensation: { ...current.compensation, baseSalary: Number(event.target.value) } } : current)} /></label><label><span>Thưởng tháng</span><input type="number" min="0" value={staffEditor.compensation.bonusMonthly} onChange={(event) => setStaffEditor((current) => current ? { ...current, compensation: { ...current.compensation, bonusMonthly: Number(event.target.value) } } : current)} /></label><label><span>Hoa hồng / buổi</span><input type="number" min="0" value={staffEditor.compensation.commissionPerSession} onChange={(event) => setStaffEditor((current) => current ? { ...current, compensation: { ...current.compensation, commissionPerSession: Number(event.target.value) } } : current)} /></label><label><span>Hoa hồng doanh thu (%)</span><input type="number" min="0" max="100" value={staffEditor.compensation.commissionRate} onChange={(event) => setStaffEditor((current) => current ? { ...current, compensation: { ...current.compensation, commissionRate: Number(event.target.value) } } : current)} /></label></div><div className="identity-staff-slots"><strong>Ma trận thời gian rảnh</strong><small>Chọn các khung có thể nhận lịch. Lịch thực tế vẫn được kiểm tra trên server.</small><div>{['T2','T3','T4','T5','T6','T7','CN'].flatMap((day) => ['06:00','09:00','12:00','15:00','18:00','20:00'].map((hour) => `${day}-${hour}`)).map((slot) => <button type="button" key={slot} className={staffEditor.slots.includes(slot) ? 'active' : ''} onClick={() => toggleStaffSlot(slot)}>{slot}</button>)}</div></div><div className="identity-modal__actions"><button type="button" className="outline-button" onClick={() => setStaffEditor(null)}>Hủy</button><button type="button" className="pink-orange-button" onClick={() => void saveStaffProfile()} disabled={staffSaving}>{staffSaving ? 'Đang lưu...' : 'Lưu hồ sơ vận hành'}</button></div></div></section>}
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
