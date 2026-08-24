import '../../styles-admin.css'
import './AdminRolesPage.css'
import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import {
  AlertCircle, Building2, CheckCircle2, Columns3, LoaderCircle,
  ArrowRight, BriefcaseBusiness, CalendarClock, Check, KeyRound, Mail, MapPin,
  Phone, Plus, Search, ShieldCheck, SlidersHorizontal, Sparkles, UserCog, Users,
  WalletCards, X,
} from 'lucide-react'
import { collection, onSnapshot } from 'firebase/firestore'
import { hasPermission } from '../../config/permissions'
import { useDatabase } from '../../contexts/DatabaseContext'
import { firestoreDb } from '../../lib/firebase'
import { assignStaffPositions, deleteUnusedStaffAccount, provisionStaffAccount, provisionStudentAccount, saveStaffOperationsProfile, suspendAccountAccess } from '../../services/identityAccessService'
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
  slotCapacity?: number
  name?: string; email?: string; phone?: string; role?: string
}
type StaffEditorState = {
  uid: string
  displayName: string
  email: string
  phoneNumber: string
  slots: string[]
  slotCapacity: number
  compensation: Required<Pick<StaffOperationsRecord, 'baseSalary' | 'bonusMonthly' | 'commissionRate' | 'commissionPerSession'>>
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
const staffAccessPresets: Array<{ label: string; positions: StaffPosition[] }> = [
  { label: 'Coach online', positions: ['coach_online'] },
  { label: 'PT Gym', positions: ['trainer_pt'] },
  { label: 'PT + Coach', positions: ['trainer_pt', 'coach_online'] },
  { label: 'Sales', positions: ['sales'] },
  { label: 'Quản lý CN', positions: ['branch_manager'] },
  { label: 'Academy', positions: ['academy_editor'] },
]
const fallbackStaffDays = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7']
const fallbackStaffHours = [6, 7, 8, 9, 10, 11, 14, 15, 16, 17, 18, 19, 20]

function normalizeStaffSlot(value: string) {
  const [day, rawHour = ''] = value.split('-', 2)
  const hour = Number(rawHour.split(':')[0])
  return day && Number.isInteger(hour) ? `${day}-${hour}` : value
}

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
  const { branches, scheduleConfig, addBranch, updateBranch, deleteBranch } = useDatabase()
  const [section, setSection] = useState<RolesSection>('accounts')
  const [query, setQuery] = useState('')
  const [roleFilter, setRoleFilter] = useState<'all' | UserRole>('all')
  const [staffQuery, setStaffQuery] = useState('')
  const [staffPositionFilter, setStaffPositionFilter] = useState<'all' | StaffPosition>('all')
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
  const [staffEditor, setStaffEditor] = useState<StaffEditorState | null>(null)
  const [staffSaving, setStaffSaving] = useState(false)

  const workingDays = scheduleConfig.workingDays?.length ? scheduleConfig.workingDays : fallbackStaffDays
  const workingHours = scheduleConfig.workingHours?.length ? scheduleConfig.workingHours : fallbackStaffHours

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
  const memberUsers = useMemo(() => directoryUsers.filter((user) => {
    const assignment = assignments[user.uid]
    return assignment?.accessRole !== 'staff'
      && !staffPositionRoles.has(user.role)
      && user.role !== 'admin'
      && user.role !== 'super_admin'
  }), [assignments, directoryUsers])
  const filteredUsers = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase('vi')
    return memberUsers
      .filter((user) => (!normalizedQuery || `${user.displayName} ${user.email} ${user.phoneNumber || ''}`.toLocaleLowerCase('vi').includes(normalizedQuery)) && (roleFilter === 'all' || user.role === roleFilter))
      .sort((left, right) => (left.displayName || left.email).localeCompare(right.displayName || right.email, 'vi'))
  }, [memberUsers, query, roleFilter])
  const staffRows = useMemo(() => {
    const byUid = new Map(directoryUsers.map((user) => [user.uid, user]))
    const ids = new Set([
      ...Object.keys(staffOperations),
      ...directoryUsers
        .filter((user) => assignments[user.uid]?.accessRole === 'staff' || staffPositionRoles.has(user.role) || user.role === 'admin' || user.role === 'super_admin')
        .map((user) => user.uid),
    ])
    return [...ids]
      .map((uid) => byUid.get(uid) || profileDirectoryUser(uid, staffOperations[uid] || {}))
      .sort((left, right) => (left.displayName || left.email).localeCompare(right.displayName || right.email, 'vi'))
  }, [assignments, directoryUsers, staffOperations])
  const filteredStaffRows = useMemo(() => {
    const normalizedQuery = staffQuery.trim().toLocaleLowerCase('vi')
    return staffRows.filter((member) => {
      const assignment = assignments[member.uid]
      const matchesSearch = !normalizedQuery || `${member.displayName} ${member.email} ${member.phoneNumber || ''}`.toLocaleLowerCase('vi').includes(normalizedQuery)
      const matchesPosition = staffPositionFilter === 'all' || assignment?.positions.includes(staffPositionFilter)
      return matchesSearch && matchesPosition
    })
  }, [assignments, staffPositionFilter, staffQuery, staffRows])
  const stats = useMemo(() => ({
    members: memberUsers.length,
    staff: staffRows.length,
    branches: branches.filter((branch) => branch.status !== 'archived').length,
    scopedAssignments: Object.values(assignments).filter((assignment) => assignment.accessRole === 'staff' && assignment.positions.length > 0).length,
  }), [assignments, branches, memberUsers.length, staffRows.length])
  const accessEditorUser = useMemo(
    () => accessEditorUid ? directoryUsers.find((user) => user.uid === accessEditorUid) ?? staffRows.find((user) => user.uid === accessEditorUid) ?? null : null,
    [accessEditorUid, directoryUsers, staffRows],
  )
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
      slots: Array.isArray(record.availableSlots) ? [...new Set(record.availableSlots.map(normalizeStaffSlot))] : [],
      slotCapacity: Number.isInteger(record.slotCapacity) ? Number(record.slotCapacity) : 2,
      compensation: { baseSalary: Number(record.baseSalary || 0), bonusMonthly: Number(record.bonusMonthly || 0), commissionRate: Number(record.commissionRate || 0), commissionPerSession: Number(record.commissionPerSession || 0) },
    })
  }
  const toggleStaffSlot = (slot: string) => setStaffEditor((current) => current ? { ...current, slots: current.slots.includes(slot) ? current.slots.filter((item) => item !== slot) : [...current.slots, slot] } : current)
  const saveStaffProfile = async () => {
    if (!staffEditor) return
    setStaffSaving(true); setError(null)
    try { await saveStaffOperationsProfile({ uid: staffEditor.uid, displayName: staffEditor.displayName, email: staffEditor.email, phoneNumber: staffEditor.phoneNumber, availabilitySlots: staffEditor.slots, slotCapacity: staffEditor.slotCapacity, compensation: staffEditor.compensation }); setStaffEditor(null); setSuccess('Đã lưu thông tin, sức chứa ca, ma trận thời gian và chính sách lương, thưởng, hoa hồng của nhân viên.') }
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
      setInviteOpen(false); setInviteDraft(emptyInviteDraft()); setSuccess(`Đã tạo tài khoản cho ${result.displayName}. Mật khẩu ban đầu là số điện thoại; người dùng có thể đổi trong Hồ sơ cá nhân nếu muốn.`)
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
  const deleteStaff = async (member: AdminRoleUser) => {
    if (!canAssignRole || member.uid === currentUserUid) return
    if (!window.confirm(`Xóa hẳn tài khoản mới tạo của ${member.displayName || member.email || member.uid}? Thao tác chỉ thành công khi tài khoản chưa phát sinh dữ liệu vận hành.`)) return
    setSavingUid(member.uid); setError(null); setSuccess(null)
    try {
      await deleteUnusedStaffAccount(member.uid)
      setSuccess(`Đã xóa tài khoản mới tạo ${member.displayName || member.email || member.uid}.`)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Không thể xóa tài khoản nhân viên.')
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

  if (!canViewTeam) return <div className="page admin-students-page identity-admin-page"><div className="identity-forbidden"><ShieldCheck size={38} /><h3>Bạn chưa có quyền xem đội ngũ</h3><p>Liên hệ quản trị viên để được cấp quyền phù hợp.</p></div></div>

  return <div className="page admin-students-page identity-admin-page">
    <header className="identity-hero">
      <span className="identity-hero__glow" aria-hidden="true" />
      <div className="identity-hero__copy">
        <small><Sparkles size={14} /> AURA OPERATIONS</small>
        <h1>Đội ngũ Aura</h1>
        <p>Quản lý thành viên, nhân viên, chi nhánh và quyền truy cập trong một không gian thống nhất.</p>
      </div>
      <div className="identity-hero__actions">
        <span><ShieldCheck size={17} />{(roleMeta[currentRole] || roleMeta.student).label}</span>
        {canAssignRole && <button type="button" onClick={() => { setInviteDraft(section === 'staff' ? { ...emptyInviteDraft(), accessRole: 'staff' } : emptyInviteDraft()); setInviteOpen(true); setError(null) }}><Plus size={17} />Thêm tài khoản</button>}
      </div>
    </header>

    <div className="identity-carousel" aria-label="Tổng quan Đội ngũ Aura">
      <button type="button" className={section === 'accounts' ? 'active' : ''} onClick={() => setSection('accounts')}>
        <span><Users /></span><small>THÀNH VIÊN</small><strong>{stats.members}</strong><em>Tài khoản học viên</em><ArrowRight size={17} />
      </button>
      <button type="button" className={section === 'staff' ? 'active' : ''} onClick={() => setSection('staff')}>
        <span><BriefcaseBusiness /></span><small>NHÂN VIÊN</small><strong>{stats.staff}</strong><em>Đội ngũ đang quản lý</em><ArrowRight size={17} />
      </button>
      <button type="button" className={section === 'branches' ? 'active' : ''} onClick={() => setSection('branches')}>
        <span><Building2 /></span><small>CHI NHÁNH</small><strong>{stats.branches}</strong><em>Cơ sở đang hoạt động</em><ArrowRight size={17} />
      </button>
      <button type="button" className={section === 'staff' ? 'active' : ''} onClick={() => setSection('staff')}>
        <span><KeyRound /></span><small>ĐÃ CẤP QUYỀN</small><strong>{stats.scopedAssignments}</strong><em>Hồ sơ có chức danh</em><ArrowRight size={17} />
      </button>
    </div>

    <nav className="identity-admin-tabs identity-admin-tabs--three" role="tablist" aria-label="Đội ngũ Aura">
      <button type="button" className={section === 'accounts' ? 'active' : ''} onClick={() => setSection('accounts')} role="tab" aria-selected={section === 'accounts'}><Users size={17} />Thành viên</button>
      <button type="button" className={section === 'staff' ? 'active' : ''} onClick={() => setSection('staff')} role="tab" aria-selected={section === 'staff'}><UserCog size={17} />Nhân viên</button>
      <button type="button" className={section === 'branches' ? 'active' : ''} onClick={() => setSection('branches')} role="tab" aria-selected={section === 'branches'}><Building2 size={17} />Chi nhánh</button>
    </nav>

    {!canAssignRole && <div className="identity-readonly"><ShieldCheck size={18} />Bạn đang xem ở chế độ chỉ đọc. Chỉ quản trị viên được thay đổi tài khoản, chức danh và chi nhánh.</div>}
    {error && <div className="identity-message identity-message--error" role="alert"><AlertCircle size={17} />{error}</div>}
    {success && <div className="identity-message identity-message--success" role="status"><CheckCircle2 size={18} />{success}</div>}

    {section === 'accounts' && <section className="identity-section identity-members-section">
      <div className="identity-section__heading">
        <span><Users size={20} /><span><strong>Thành viên Aura</strong><small>Danh bạ học viên, thông tin đăng nhập và trạng thái tài khoản.</small></span></span>
        {canAssignRole && <button type="button" className="pink-orange-button" onClick={() => { setInviteDraft(emptyInviteDraft()); setInviteOpen(true); setError(null) }}><Plus size={17} />Thêm thành viên</button>}
      </div>
      <div className="identity-admin-note"><ShieldCheck size={19} /><span><strong>Chuyển học viên thành nhân viên ngay tại nút “Cập nhật quyền”.</strong><small>PT, Sales và Quản lý chi nhánh được cấp dưới dạng chức danh có phạm vi. Mật khẩu khởi tạo vẫn là số điện thoại.</small></span></div>
      <div className="identity-toolbar roles-directory-toolbar">
        <div className="identity-search course-search"><Search size={18} /><input aria-label="Tìm thành viên" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tìm tên, email hoặc số điện thoại" /></div>
        <label className="identity-filter"><SlidersHorizontal size={16} /><span>Loại</span><select aria-label="Lọc loại thành viên" value={roleFilter} onChange={(event) => setRoleFilter(event.target.value as 'all' | UserRole)}><option value="all">Tất cả</option><option value="student">Học viên</option><option value="user">Khách vãng lai</option></select></label>
        <div className="roles-column-picker"><button type="button" className="identity-filter" onClick={() => setColumnPickerOpen((current) => !current)} aria-expanded={columnPickerOpen}><Columns3 size={16} />Cột hiển thị</button>{columnPickerOpen && <div className="roles-column-picker__menu">{(Object.keys(directoryColumnMeta) as DirectoryColumn[]).map((column) => <label key={column}><input type="checkbox" checked={visibleColumns[column]} onChange={() => updateColumn(column)} />{directoryColumnMeta[column]}</label>)}</div>}</div>
      </div>
      <div className="students-table roles-directory identity-members-list" aria-busy={loading}>
        <div className="students-head" style={tableGridStyle}><span>THÀNH VIÊN</span>{visibleColumns.phone && <span>SỐ ĐIỆN THOẠI</span>}{visibleColumns.email && <span>EMAIL ĐĂNG NHẬP</span>}<span>LOẠI TÀI KHOẢN</span>{visibleColumns.scope && <span>QUYỀN & PHẠM VI</span>}{visibleColumns.activity && <span>HOẠT ĐỘNG</span>}{visibleColumns.status && <span>TRẠNG THÁI</span>}<span /></div>
        {loading && <div className="empty-state"><LoaderCircle size={30} className="spin" /><h3>Đang tải thành viên</h3><p>Dữ liệu tài khoản đang được đồng bộ.</p></div>}
        {!loading && filteredUsers.map((user, index) => <RoleDirectoryRow key={user.uid} user={user} assignment={assignments[user.uid]} index={index} tableGridStyle={tableGridStyle} visibleColumns={visibleColumns} currentUserUid={currentUserUid} canAssignRole={canAssignRole} canAssignSuperAdmin={canAssignSuperAdmin} isSaving={savingUid === user.uid} branches={branches} onChangeRole={changeRole} onOpenAccessEditor={openAccessEditor} />)}
        {!loading && filteredUsers.length === 0 && <div className="empty-state"><Users size={30} /><h3>Không tìm thấy thành viên</h3><p>Thử đổi từ khóa hoặc bộ lọc tài khoản.</p></div>}
      </div>
    </section>}

    {section === 'staff' && <section className="identity-section identity-staff">
      <div className="identity-section__heading">
        <span><BriefcaseBusiness size={20} /><span><strong>Nhân viên Aura</strong><small>Chức danh, chi nhánh, học viên phụ trách, thời gian rảnh và cơ chế thu nhập.</small></span></span>
        {canAssignRole && <button type="button" className="pink-orange-button" onClick={() => { setInviteDraft({ ...emptyInviteDraft(), accessRole: 'staff' }); setInviteOpen(true); setError(null) }}><Plus size={17} />Thêm nhân viên</button>}
      </div>
      <div className="identity-toolbar identity-staff-toolbar">
        <div className="identity-search"><Search size={18} /><input aria-label="Tìm nhân viên" value={staffQuery} onChange={(event) => setStaffQuery(event.target.value)} placeholder="Tìm tên, email hoặc số điện thoại" /></div>
        <label className="identity-filter"><SlidersHorizontal size={16} /><span>Chức danh</span><select aria-label="Lọc chức danh" value={staffPositionFilter} onChange={(event) => setStaffPositionFilter(event.target.value as 'all' | StaffPosition)}><option value="all">Tất cả</option>{positionOptions.map((position) => <option key={position.id} value={position.id}>{position.label}</option>)}</select></label>
      </div>
      <div className="identity-staff-grid">{filteredStaffRows.map((member) => {
        const assignment = assignments[member.uid]
        const positions = assignment?.positions.map(assignmentPositionLabel).join(' · ') || roleMeta[member.role].label
        const assignedBranches = assignment?.branchIds.map((branchId) => branches.find((branch) => branch.id === branchId)?.name || 'Chi nhánh lưu trữ') ?? []
        const record = staffOperations[member.uid] || {}
        const isSuspended = assignment?.status === 'suspended' || member.status === 'disabled'
        const canEditAccess = canAssignRole && member.uid !== currentUserUid && member.role !== 'admin' && member.role !== 'super_admin'
        return <article key={member.uid} className={isSuspended ? 'is-suspended' : ''}>
          <div className="identity-staff-card__head"><span className="identity-staff-card__person"><i>{initials(member.displayName, member.email)}</i><span><strong>{member.displayName || 'Chưa cập nhật tên'}</strong><small>{member.email || member.phoneNumber || 'Chưa cập nhật liên hệ'}</small></span></span><i className={`status-badge ${isSuspended ? 'attention' : 'published'}`}>{isSuspended ? 'Đã khóa' : 'Hoạt động'}</i></div>
          <div className="identity-staff-card__scope"><strong>{positions}</strong><span><MapPin size={13} />{assignedBranches.length ? assignedBranches.join(' · ') : 'Toàn hệ thống'}</span></div>
          <div className="identity-staff-card__metrics"><span><small>PT chính</small><strong>{countManagedClients(member.uid, 'main')}</strong></span><span><small>Phối hợp</small><strong>{countManagedClients(member.uid, 'secondary')}</strong></span><span><small>Dinh dưỡng</small><strong>{countManagedClients(member.uid, 'nutrition')}</strong></span></div>
          <div className="identity-staff-card__facts"><p><WalletCards size={15} />Lương {Number(record.baseSalary || 0).toLocaleString('vi-VN')}đ · Thưởng {Number(record.bonusMonthly || 0).toLocaleString('vi-VN')}đ</p><p><CalendarClock size={15} />{Array.isArray(record.availableSlots) && record.availableSlots.length ? `${record.availableSlots.length} khung giờ rảnh` : 'Chưa thiết lập lịch rảnh'}</p></div>
          {canAssignRole && <div className="identity-staff-card__actions">{canEditAccess && <button type="button" className="identity-staff-card__primary" onClick={() => openAccessEditor(member, assignment)}><KeyRound size={15} />Quyền & phạm vi</button>}<button type="button" className="outline-button" onClick={() => openStaffEditor(member)}><CalendarClock size={15} />Hồ sơ & lịch rảnh</button>{!isSuspended && member.uid !== currentUserUid && <><button type="button" className="outline-button identity-staff-card__archive" onClick={() => void suspendStaff(member)} disabled={savingUid === member.uid}>Khóa</button><button type="button" className="outline-button identity-staff-card__delete" onClick={() => void deleteStaff(member)} disabled={savingUid === member.uid}>Xóa</button></>}</div>}
        </article>
      })}{!filteredStaffRows.length && <div className="empty-state"><Users size={30} /><h3>Không tìm thấy nhân viên</h3><p>Thử đổi từ khóa, chức danh hoặc tạo tài khoản nhân viên mới.</p></div>}</div>
    </section>}

    {section === 'branches' && <section className="identity-section identity-branches">
      <div className="identity-section__heading"><span><Building2 size={20} /><span><strong>Chi nhánh Aura</strong><small>Tạo cơ sở và dùng làm phạm vi dữ liệu cho Sales, PT hoặc Quản lý chi nhánh.</small></span></span>{canAssignRole && <button type="button" className="pink-orange-button" onClick={() => { setBranchEditor({ name: '', address: '' }); setError(null) }}><Plus size={17} />Thêm chi nhánh</button>}</div>
      <div className="identity-branch-list">{branches.length ? branches.map((branch) => <article key={branch.id} className={branch.status === 'archived' ? 'archived' : ''}><span><i><Building2 size={18} /></i><span><strong>{branch.name}</strong><small>{branch.address}</small></span></span><span className="identity-branch-list__actions"><i className={`status-badge ${branch.status === 'archived' ? 'draft' : 'published'}`}>{branch.status === 'archived' ? 'Đã lưu trữ' : 'Đang hoạt động'}</i>{canAssignRole && <><button type="button" className="outline-button" onClick={() => setBranchEditor({ id: branch.id, name: branch.name, address: branch.address })}>Chỉnh sửa</button>{branch.status !== 'archived' && <button type="button" className="outline-button" onClick={() => void archiveBranch(branch)}>Lưu trữ</button>}</>}</span></article>) : <div className="empty-state"><Building2 size={30} /><h3>Chưa có chi nhánh</h3><p>Tạo chi nhánh đầu tiên để cấp phạm vi cho đội ngũ.</p></div>}</div>
    </section>}
    {accessEditorUser && <section className="identity-overlay" role="dialog" aria-modal="true" aria-labelledby="access-title"><button className="identity-overlay__backdrop" type="button" aria-label="Đóng" onClick={() => setAccessEditorUid(null)} /><div className="identity-modal identity-modal--access"><ModalHeader id="access-title" title={`Quyền của ${accessEditorUser.displayName || accessEditorUser.email || 'tài khoản'}`} detail="Chọn một hoặc nhiều chức danh và phạm vi chi nhánh. Backend sẽ tính capability và cập nhật token đăng nhập." icon={<KeyRound size={21} />} onClose={() => setAccessEditorUid(null)} /><AccessRoleChooser value={accessRoleDraft} onChange={(role) => { setAccessRoleDraft(role); if (role === 'student') { setPositionDraft([]); setBranchDraft([]) } }} />{accessRoleDraft === 'staff' && <ScopedAssignmentFields positions={positionDraft} branchIds={branchDraft} branches={branches} onTogglePosition={(position) => togglePosition(position, 'access')} onToggleBranch={(branchId) => toggleBranch(branchId, 'access')} onApplyPreset={setPositionDraft} />}<div className="identity-modal__actions"><button type="button" className="outline-button" onClick={() => setAccessEditorUid(null)}>Hủy</button><button type="button" className="pink-orange-button" onClick={() => void saveScopedAccess(accessEditorUser)} disabled={accessSaving || (accessRoleDraft === 'staff' && !positionDraft.length)}>{accessSaving ? 'Đang cập nhật...' : 'Lưu quyền & đăng nhập lại'}</button></div></div></section>}
    {inviteOpen && <section className="identity-overlay" role="dialog" aria-modal="true" aria-labelledby="invite-title"><button className="identity-overlay__backdrop" type="button" aria-label="Đóng" onClick={() => setInviteOpen(false)} /><div className="identity-modal"><ModalHeader id="invite-title" title={inviteDraft.accessRole === 'staff' ? 'Thêm nhân viên' : 'Thêm thành viên'} detail="Tài khoản được tạo trực tiếp. Mật khẩu ban đầu là số điện thoại và có thể đổi trong Hồ sơ cá nhân." icon={<UserCog size={21} />} onClose={() => setInviteOpen(false)} /><div className="identity-form-grid"><label><span>Họ và tên</span><input value={inviteDraft.displayName} onChange={(event) => setInviteDraft((current) => ({ ...current, displayName: event.target.value }))} placeholder="Ví dụ: Nguyễn Minh Anh" /></label><label><span>Số điện thoại / mật khẩu ban đầu</span><input type="tel" value={inviteDraft.phoneNumber} onChange={(event) => setInviteDraft((current) => ({ ...current, phoneNumber: event.target.value }))} placeholder="090…" /></label><label className="identity-form-grid__span"><span>Email đăng nhập</span><input type="email" value={inviteDraft.email} onChange={(event) => setInviteDraft((current) => ({ ...current, email: event.target.value }))} placeholder="ten@aurafitness.vn" /></label></div><AccessRoleChooser value={inviteDraft.accessRole} onChange={(role) => setInviteDraft((current) => ({ ...current, accessRole: role, positions: role === 'student' ? [] : current.positions, branchIds: role === 'student' ? [] : current.branchIds }))} />{inviteDraft.accessRole === 'staff' && <ScopedAssignmentFields positions={inviteDraft.positions} branchIds={inviteDraft.branchIds} branches={branches} onTogglePosition={(position) => togglePosition(position, 'invite')} onToggleBranch={(branchId) => toggleBranch(branchId, 'invite')} onApplyPreset={(positions) => setInviteDraft((current) => ({ ...current, positions }))} />}<div className="identity-modal__actions"><button type="button" className="outline-button" onClick={() => setInviteOpen(false)}>Hủy</button><button type="button" className="pink-orange-button" onClick={() => void submitInvite()} disabled={inviteSaving}>{inviteSaving ? 'Đang tạo tài khoản...' : 'Tạo tài khoản'}</button></div></div></section>}
    {branchEditor && <section className="identity-overlay" role="dialog" aria-modal="true" aria-labelledby="branch-title"><button className="identity-overlay__backdrop" type="button" aria-label="Đóng" onClick={() => setBranchEditor(null)} /><div className="identity-modal identity-modal--compact"><ModalHeader id="branch-title" title={branchEditor.id ? 'Chỉnh sửa chi nhánh' : 'Tạo chi nhánh'} detail="Chi nhánh này sẽ là phạm vi cấp quyền cho đội ngũ." icon={<Building2 size={21} />} onClose={() => setBranchEditor(null)} /><div className="identity-form-grid"><label className="identity-form-grid__span"><span>Tên chi nhánh</span><input value={branchEditor.name} onChange={(event) => setBranchEditor((current) => current ? { ...current, name: event.target.value } : current)} placeholder="Aura Fitness Quận 7" /></label><label className="identity-form-grid__span"><span>Địa chỉ</span><input value={branchEditor.address} onChange={(event) => setBranchEditor((current) => current ? { ...current, address: event.target.value } : current)} placeholder="Địa chỉ vận hành" /></label></div><div className="identity-modal__actions"><button type="button" className="outline-button" onClick={() => setBranchEditor(null)}>Hủy</button><button type="button" className="pink-orange-button" onClick={() => void saveBranch()} disabled={branchSaving}>{branchSaving ? 'Đang lưu...' : 'Lưu chi nhánh'}</button></div></div></section>}
    {staffEditor && <section className="identity-overlay" role="dialog" aria-modal="true" aria-labelledby="staff-operations-title">
      <button className="identity-overlay__backdrop" type="button" aria-label="Đóng" onClick={() => setStaffEditor(null)} />
      <div className="identity-modal identity-modal--staff">
        <ModalHeader id="staff-operations-title" title="Hồ sơ & lịch rảnh" detail="Thông tin nhân viên, chính sách thu nhập và ma trận nhận ca dùng chung với lịch học viên." icon={<WalletCards size={21} />} onClose={() => setStaffEditor(null)} />
        <section className="identity-form-section"><h3>Thông tin nhân viên</h3><div className="identity-form-grid"><label className="identity-form-grid__span"><span>Họ và tên</span><input value={staffEditor.displayName} onChange={(event) => setStaffEditor((current) => current ? { ...current, displayName: event.target.value } : current)} placeholder="Họ và tên nhân viên" /></label><label><span>Email đăng nhập</span><input type="email" value={staffEditor.email} onChange={(event) => setStaffEditor((current) => current ? { ...current, email: event.target.value } : current)} placeholder="ten@aurafitness.vn" /></label><label><span>Số điện thoại</span><input type="tel" value={staffEditor.phoneNumber} onChange={(event) => setStaffEditor((current) => current ? { ...current, phoneNumber: event.target.value } : current)} placeholder="090…" /></label></div></section>
        <section className="identity-form-section"><h3>Lương, thưởng & sức chứa</h3><div className="identity-form-grid identity-form-grid--compensation"><label><span>Lương cơ bản / tháng</span><input type="number" min="0" value={staffEditor.compensation.baseSalary} onChange={(event) => setStaffEditor((current) => current ? { ...current, compensation: { ...current.compensation, baseSalary: Number(event.target.value) } } : current)} /></label><label><span>Thưởng tháng</span><input type="number" min="0" value={staffEditor.compensation.bonusMonthly} onChange={(event) => setStaffEditor((current) => current ? { ...current, compensation: { ...current.compensation, bonusMonthly: Number(event.target.value) } } : current)} /></label><label><span>Hoa hồng / buổi</span><input type="number" min="0" value={staffEditor.compensation.commissionPerSession} onChange={(event) => setStaffEditor((current) => current ? { ...current, compensation: { ...current.compensation, commissionPerSession: Number(event.target.value) } } : current)} /></label><label><span>Hoa hồng doanh thu (%)</span><input type="number" min="0" max="100" value={staffEditor.compensation.commissionRate} onChange={(event) => setStaffEditor((current) => current ? { ...current, compensation: { ...current.compensation, commissionRate: Number(event.target.value) } } : current)} /></label><label><span>Sức chứa mỗi ca PT</span><input type="number" min="1" max="4" value={staffEditor.slotCapacity} onChange={(event) => setStaffEditor((current) => current ? { ...current, slotCapacity: Math.max(1, Math.min(4, Number(event.target.value) || 1)) } : current)} /><small>Mặc định 2, tối đa 4 học viên.</small></label></div></section>
        <section className="identity-staff-availability">
          <header><span><strong>Ma trận thời gian rảnh</strong><small>Chọn các giờ nhân viên có thể nhận lịch. Dữ liệu dùng cùng định dạng với ma trận lịch rảnh học viên.</small></span><em>{staffEditor.slots.length} khung đã chọn</em></header>
          <div className="identity-staff-availability__quick"><button type="button" onClick={() => setStaffEditor((current) => current ? { ...current, slots: workingDays.flatMap((day) => workingHours.map((hour) => `${day}-${hour}`)) } : current)}>Chọn tất cả</button><button type="button" onClick={() => setStaffEditor((current) => current ? { ...current, slots: [] } : current)}>Xóa chọn</button></div>
          <div className="identity-staff-availability__scroll" role="region" aria-label="Ma trận thời gian rảnh nhân viên" tabIndex={0}><table><thead><tr><th>Giờ</th>{workingDays.map((day) => <th key={day}>{day}</th>)}</tr></thead><tbody>{workingHours.map((hour) => <tr key={hour}><th>{String(hour).padStart(2, '0')}:00</th>{workingDays.map((day) => { const slot = `${day}-${hour}`; const selected = staffEditor.slots.includes(slot); return <td key={slot}><button type="button" className={selected ? 'active' : ''} aria-pressed={selected} aria-label={`${day} ${hour} giờ, ${selected ? 'đã chọn' : 'chưa chọn'}`} onClick={() => toggleStaffSlot(slot)}>{selected && <Check size={15} />}</button></td> })}</tr>)}</tbody></table></div>
        </section>
        <div className="identity-modal__actions"><button type="button" className="outline-button" onClick={() => setStaffEditor(null)}>Hủy</button><button type="button" className="pink-orange-button" onClick={() => void saveStaffProfile()} disabled={staffSaving}>{staffSaving ? 'Đang lưu...' : 'Lưu hồ sơ nhân viên'}</button></div>
      </div>
    </section>}
  </div>
}

function RoleDirectoryRow({ user, assignment, index, tableGridStyle, visibleColumns, currentUserUid, canAssignRole, canAssignSuperAdmin, isSaving, branches, onChangeRole, onOpenAccessEditor }: {
  user: AdminRoleUser; assignment?: RoleAssignmentSummary; index: number; tableGridStyle: CSSProperties; visibleColumns: Record<DirectoryColumn, boolean>; currentUserUid?: string; canAssignRole: boolean; canAssignSuperAdmin: boolean; isSaving: boolean; branches: Branch[]; onChangeRole: (user: AdminRoleUser, nextRole: UserRole) => Promise<void>; onOpenAccessEditor: (user: AdminRoleUser, assignment?: RoleAssignmentSummary) => void
}) {
  const status = statusMeta[assignment?.status === 'suspended' ? 'disabled' : user.status ?? 'active']; const userRoleData = roleMeta[user.role] || roleMeta.student
  const managedAsStaffPosition = staffPositionRoles.has(user.role)
  const roleLocked = !canAssignRole || isSaving || user.uid === currentUserUid || managedAsStaffPosition || ((user.role === 'admin' || user.role === 'super_admin') && !canAssignSuperAdmin)
  const canEditScopedAccess = canAssignRole && user.uid !== currentUserUid && user.role !== 'admin' && user.role !== 'super_admin'
  const assignedBranches = assignment?.branchIds.map((branchId) => branches.find((branch) => branch.id === branchId)?.name || 'Chi nhánh đã lưu trữ') ?? []
  const assignedPositions = assignment?.positions.map(assignmentPositionLabel) ?? []
  const scope = assignedPositions.length ? `${assignedPositions.join(' · ')}${assignedBranches.length ? ` — ${assignedBranches.join(', ')}` : ' — Toàn hệ thống'}` : userRoleData.scope
  return <article className="student-row identity-member-card" style={tableGridStyle}>
    <span className="student-identity">{user.photoURL ? <img src={user.photoURL} alt="" className="avatar avatar-photo" referrerPolicy="no-referrer" /> : <i className={['purple', 'green', 'orange', 'pink', 'blue'][index % 5]}>{initials(user.displayName, user.email)}</i>}<span><strong>{user.displayName || 'Chưa cập nhật tên'}</strong><small>{user.uid.slice(0, 10)}…</small></span></span>
    {visibleColumns.phone && <span className="identity-contact-cell" data-label="Số điện thoại">{user.phoneNumber ? <><Phone size={14} />{user.phoneNumber}</> : <em>Chưa cập nhật</em>}</span>}
    {visibleColumns.email && <span className="identity-contact-cell" data-label="Email đăng nhập">{user.email ? <><Mail size={14} />{user.email}</> : <em>Chưa cập nhật</em>}</span>}
    <span className="identity-member-role" data-label="Loại tài khoản"><select aria-label={`Vai trò của ${user.displayName || user.email || user.uid}`} value={user.role || 'student'} disabled={roleLocked} onChange={(event) => void onChangeRole(user, event.target.value as UserRole)} style={{ color: userRoleData.tone }}>{managedAsStaffPosition && <option value={user.role}>{roleMeta[user.role].label} · chức danh</option>}{roles.map((role) => <option key={role} value={role} disabled={(role === 'admin' || role === 'super_admin') && !canAssignSuperAdmin}>{roleMeta[role].label}</option>)}</select></span>
    {visibleColumns.scope && <span className="program-name identity-scope-cell" data-label="Quyền & phạm vi">{scope}</span>}
    {visibleColumns.activity && <span className="student-streak" data-label="Hoạt động">{user.lastActive ?? 'Chưa có dữ liệu'}</span>}
    {visibleColumns.status && <span className="identity-member-status" data-label="Trạng thái"><i className={`status-badge ${status.className}`}>{status.label}</i></span>}
    <span className="row-actions" aria-live="polite">{isSaving ? <LoaderCircle size={18} className="spin" color="var(--aura-pink)" /> : canEditScopedAccess ? <button type="button" className="identity-member-access" aria-label={`Cập nhật quyền cho ${user.displayName || user.email || user.uid}`} onClick={() => onOpenAccessEditor(user, assignment)}><UserCog size={17} /><span>Cập nhật quyền</span></button> : <CheckCircle2 size={18} color="#7fcb36" />}</span>
  </article>
}

function AccessRoleChooser({ value, onChange }: { value: 'student' | 'staff'; onChange: (value: 'student' | 'staff') => void }) {
  return <div className="identity-access-editor__role" role="radiogroup" aria-label="Loại tài khoản"><button type="button" className={value === 'student' ? 'active' : ''} onClick={() => onChange('student')}>Học viên</button><button type="button" className={value === 'staff' ? 'active' : ''} onClick={() => onChange('staff')}>Nhân viên</button></div>
}
function ScopedAssignmentFields({ positions, branchIds, branches, onTogglePosition, onToggleBranch, onApplyPreset }: { positions: StaffPosition[]; branchIds: string[]; branches: Branch[]; onTogglePosition: (position: StaffPosition) => void; onToggleBranch: (branchId: string) => void; onApplyPreset: (positions: StaffPosition[]) => void }) {
  return <>
    <section className="identity-access-presets"><strong>Chọn nhanh</strong><div>{staffAccessPresets.map((preset) => { const active = preset.positions.length === positions.length && preset.positions.every((position) => positions.includes(position)); return <button type="button" key={preset.label} className={active ? 'active' : ''} onClick={() => onApplyPreset(preset.positions)}>{preset.label}</button> })}</div></section>
    <div className="identity-access-editor__options" aria-label="Chức danh">{positionOptions.map((position) => <label key={position.id} className={positions.includes(position.id) ? 'active' : ''}><input type="checkbox" checked={positions.includes(position.id)} onChange={() => onTogglePosition(position.id)} /><span><strong>{position.label}</strong><small>{position.description}</small></span></label>)}</div>
    <div className="identity-access-summary"><KeyRound size={17} /><span><strong>{positions.length ? `${positions.length} chức danh đang chọn` : 'Chưa chọn chức danh'}</strong><small>Mỗi chức danh mở đúng nhóm chức năng; quyền dữ liệu vẫn bị giới hạn theo tài khoản và chi nhánh ở backend.</small></span></div>
    <div className="identity-access-editor__branches"><strong>Phạm vi chi nhánh</strong><small>Để trống khi chức danh không bị giới hạn theo chi nhánh. Với Sales hoặc Quản lý nên chọn ít nhất một chi nhánh.</small>{branches.length ? <div>{branches.filter((branch) => branch.status !== 'archived').map((branch) => <label key={branch.id} className={branchIds.includes(branch.id) ? 'active' : ''}><input type="checkbox" checked={branchIds.includes(branch.id)} onChange={() => onToggleBranch(branch.id)} />{branch.name}</label>)}</div> : <em>Chưa có chi nhánh. Tạo chi nhánh trước hoặc bổ sung phạm vi sau.</em>}</div>
  </>
}
function ModalHeader({ id, title, detail, icon, onClose }: { id: string; title: string; detail: string; icon: ReactNode; onClose: () => void }) {
  return <div className="identity-modal__header"><span>{icon}<span><strong id={id}>{title}</strong><small>{detail}</small></span></span><button type="button" className="icon-button" aria-label="Đóng" onClick={onClose}><X size={18} /></button></div>
}
