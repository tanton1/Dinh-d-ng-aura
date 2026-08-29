import '../../styles-admin.css'
import './AdminRolesPage.css'
import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import {
  AlertCircle, Building2, CheckCircle2, Columns3, LoaderCircle,
  ArrowRight, BriefcaseBusiness, CalendarClock, Check, KeyRound, Mail, MapPin,
  Phone, Plus, Search, ShieldCheck, SlidersHorizontal, Sparkles, UserCog, Users,
  Trash2, WalletCards, X,
} from 'lucide-react'
import { collection, onSnapshot, query as firestoreQuery, where } from 'firebase/firestore'
import { hasPermission } from '../../config/permissions'
import { useDatabase } from '../../contexts/DatabaseContext'
import { firestoreDb } from '../../lib/firebase'
import { applyDefaultTrainerSchedulingPolicy, assignStaffPositions, deleteMemberAccount, deleteUnusedStaffAccount, provisionStaffAccount, provisionStudentAccount, saveStaffOperationsProfile, suspendAccountAccess } from '../../services/identityAccessService'
import { listPayrollPolicies, type PayrollPolicy, type PayrollProfile } from '../../services/payrollService'
import type { StaffPosition } from '../../identity/access'
import type { Branch, UserRole } from '../../types'
import AuraTeamPolicySettings from '../../components/admin/pt/AuraTeamPolicySettings'

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
type RolesSection = 'accounts' | 'branches' | 'staff' | 'policy'
type EmploymentType = 'full_time' | 'part_time' | 'collaborator'
type EmploymentLevel = 'probation' | 'official' | 'senior'
type InviteDraft = {
  displayName: string
  phoneNumber: string
  email: string
  accessRole: 'student' | 'staff'
  positions: StaffPosition[]
  branchIds: string[]
  employmentType: EmploymentType
  employmentLevel: EmploymentLevel
  payrollPolicyId: string
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
  priority?: number
  schedulingPriority?: number
  dailySessionTarget?: number
  dailySessionLimit?: number
  name?: string; email?: string; phone?: string; role?: string; status?: string
  employmentType?: EmploymentType
  employmentLevel?: EmploymentLevel
  payrollPolicyId?: string
}
type StaffEditorState = {
  uid: string
  displayName: string
  email: string
  phoneNumber: string
  slots: string[]
  slotCapacity: number
  isTrainer: boolean
  schedulingPriority: number
  dailySessionTarget: number
  dailySessionLimit: number
  employmentType: EmploymentType
  employmentLevel: EmploymentLevel
  payrollPolicyId: string
  compensation: Required<Pick<StaffOperationsRecord, 'baseSalary' | 'bonusMonthly' | 'commissionRate' | 'commissionPerSession'>>
}
type TeamConfirmation =
  | { kind: 'change_role'; user: AdminRoleUser; nextRole: UserRole }
  | { kind: 'suspend_staff'; member: AdminRoleUser }
  | { kind: 'delete_staff'; member: AdminRoleUser }
  | { kind: 'reset_pt_workload' }
  | { kind: 'archive_branch'; branch: Branch }

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
  return { displayName: '', phoneNumber: '', email: '', accessRole: 'student' as const, positions: [] as StaffPosition[], branchIds: [] as string[], employmentType: 'full_time', employmentLevel: 'official', payrollPolicyId: '' }
}

function employmentTypeLabel(value: EmploymentType | undefined) {
  if (value === 'collaborator') return 'Cộng tác viên'
  if (value === 'part_time') return 'Bán thời gian'
  return 'Toàn thời gian'
}
function employmentLevelLabel(value: EmploymentLevel | undefined) {
  if (value === 'probation') return 'Thử việc'
  if (value === 'senior') return 'Senior'
  return 'Chính thức'
}
function staffPayrollProfile(employmentType: EmploymentType, employmentLevel: EmploymentLevel): PayrollProfile {
  if (employmentType === 'collaborator') return 'collaborator'
  if (employmentType === 'part_time') return 'part_time'
  return employmentLevel
}
function teamConfirmationCopy(action: TeamConfirmation) {
  if (action.kind === 'change_role') return {
    title: 'Xác nhận đổi vai trò',
    subject: action.user.displayName || action.user.email || action.user.uid,
    detail: `Vai trò đăng nhập sẽ chuyển từ ${roleMeta[action.user.role].label} sang ${roleMeta[action.nextRole].label}.`,
    note: 'Người dùng phải đăng nhập lại để nhận token quyền mới. Chức danh PT, Sales và phạm vi chi nhánh vẫn được quản lý tại hồ sơ nhân viên.',
    confirmLabel: 'Đổi vai trò',
    danger: false,
  }
  if (action.kind === 'suspend_staff') return {
    title: 'Khóa tài khoản nhân viên',
    subject: action.member.displayName || action.member.email || action.member.uid,
    detail: 'Tài khoản sẽ không thể đăng nhập hoặc nhận công việc mới.',
    note: 'Dữ liệu lịch sử, ca dạy, ngày công và bảng lương vẫn được giữ nguyên để đối soát.',
    confirmLabel: 'Khóa tài khoản',
    danger: true,
  }
  if (action.kind === 'delete_staff') return {
    title: 'Xóa tài khoản mới tạo',
    subject: action.member.displayName || action.member.email || action.member.uid,
    detail: 'Chỉ tài khoản chưa phát sinh dữ liệu vận hành mới có thể xóa.',
    note: 'Backend sẽ từ chối nếu nhân viên đã có ca dạy, học viên phụ trách, ngày công, lương hoặc lịch sử nghiệp vụ.',
    confirmLabel: 'Xóa tài khoản',
    danger: true,
  }
  if (action.kind === 'reset_pt_workload') return {
    title: 'Áp dụng chuẩn ca PT',
    subject: 'Toàn bộ PT đang hoạt động',
    detail: 'Mục tiêu cân tải sẽ được đặt thành 8 ca/ngày cho PT chính thức.',
    note: 'Đây không phải trần. Hệ thống vẫn xếp thêm khi cần đủ lịch học viên; CTV nhận ca sau theo lịch đã đăng ký.',
    confirmLabel: 'Áp dụng mục tiêu 8',
    danger: false,
  }
  return {
    title: 'Lưu trữ chi nhánh',
    subject: action.branch.name,
    detail: 'Chi nhánh sẽ ẩn khỏi danh sách vận hành mặc định.',
    note: 'Tài khoản đang được cấp phạm vi tại chi nhánh này cần được rà soát và chuyển phạm vi trước khi tiếp tục làm việc.',
    confirmLabel: 'Lưu trữ chi nhánh',
    danger: true,
  }
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
  const [payrollPolicies, setPayrollPolicies] = useState<PayrollPolicy[]>([])
  const [directorySnapshot, setDirectorySnapshot] = useState<Record<string, AdminRoleUser>>({})
  const [legacyContracts, setLegacyContracts] = useState<Array<Record<string, unknown>>>([])
  const [staffEditor, setStaffEditor] = useState<StaffEditorState | null>(null)
  const [staffSaving, setStaffSaving] = useState(false)
  const [memberDeleteTarget, setMemberDeleteTarget] = useState<AdminRoleUser | null>(null)
  const [memberDeleteConfirmation, setMemberDeleteConfirmation] = useState('')
  const [teamConfirmation, setTeamConfirmation] = useState<TeamConfirmation | null>(null)
  const [teamActionSaving, setTeamActionSaving] = useState(false)

  const workingDays = scheduleConfig.workingDays?.length ? scheduleConfig.workingDays : fallbackStaffDays
  const workingHours = scheduleConfig.workingHours?.length ? scheduleConfig.workingHours : fallbackStaffHours
  const hasEditorPage = inviteOpen || Boolean(branchEditor) || Boolean(staffEditor) || Boolean(accessEditorUid) || Boolean(memberDeleteTarget) || Boolean(teamConfirmation)

  useEffect(() => { window.localStorage.setItem(directoryColumnsStorageKey, JSON.stringify(visibleColumns)) }, [visibleColumns])
  useEffect(() => { if (hasEditorPage) window.scrollTo({ top: 0, behavior: 'smooth' }) }, [hasEditorPage])

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
    const activeContractsQuery = firestoreQuery(
      collection(firestoreDb, 'contracts'),
      where('status', 'in', ['active', 'future', 'frozen']),
    )
    const stopContracts = onSnapshot(activeContractsQuery, (snapshot) => setLegacyContracts(snapshot.docs.map((item) => item.data() as Record<string, unknown>)), () => setLegacyContracts([]))
    return () => { stopStaff(); stopTrainers(); stopContracts() }
  }, [section, canViewTeam])
  useEffect(() => {
    if (!canViewTeam) return
    let active = true
    void listPayrollPolicies()
      .then((items) => { if (active) setPayrollPolicies(items.filter((item) => item.status === 'active')) })
      .catch(() => { if (active) setPayrollPolicies([]) })
    return () => { active = false }
  }, [canViewTeam])
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
      ...Object.entries(staffOperations)
        .filter(([, record]) => record.status !== 'inactive' && record.status !== 'archived')
        .map(([uid]) => uid),
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
    const assignment = assignments[member.uid]
    const dailySessionTarget = Number.isInteger(record.dailySessionTarget) ? Math.max(1, Math.min(12, Number(record.dailySessionTarget))) : 8
    setStaffEditor({
      uid: member.uid,
      displayName: member.displayName || record.name || '',
      email: member.email || record.email || '',
      phoneNumber: member.phoneNumber || record.phone || '',
      slots: Array.isArray(record.availableSlots) ? [...new Set(record.availableSlots.map(normalizeStaffSlot))] : [],
      slotCapacity: Number.isInteger(record.slotCapacity) ? Number(record.slotCapacity) : 2,
      isTrainer: Boolean(assignment?.positions.includes('trainer_pt') || member.role === 'trainer' || record.role === 'trainer'),
      schedulingPriority: Number.isInteger(record.schedulingPriority ?? record.priority) ? Math.max(1, Math.min(999, Number(record.schedulingPriority ?? record.priority))) : 100,
      dailySessionTarget,
      dailySessionLimit: Number.isInteger(record.dailySessionLimit) ? Math.max(dailySessionTarget, Math.min(16, Number(record.dailySessionLimit))) : 10,
      employmentType: record.employmentType === 'collaborator' || record.employmentType === 'part_time' ? record.employmentType : 'full_time',
      employmentLevel: record.employmentLevel === 'probation' || record.employmentLevel === 'senior' ? record.employmentLevel : 'official',
      payrollPolicyId: typeof record.payrollPolicyId === 'string' ? record.payrollPolicyId : '',
      compensation: { baseSalary: Number(record.baseSalary || 0), bonusMonthly: Number(record.bonusMonthly || 0), commissionRate: Number(record.commissionRate || 0), commissionPerSession: Number(record.commissionPerSession || 0) },
    })
  }
  const toggleStaffSlot = (slot: string) => setStaffEditor((current) => current ? { ...current, slots: current.slots.includes(slot) ? current.slots.filter((item) => item !== slot) : [...current.slots, slot] } : current)
  const saveStaffProfile = async () => {
    if (!staffEditor) return
    setStaffSaving(true); setError(null)
    try { await saveStaffOperationsProfile({ uid: staffEditor.uid, displayName: staffEditor.displayName, email: staffEditor.email, phoneNumber: staffEditor.phoneNumber, employmentType: staffEditor.employmentType, employmentLevel: staffEditor.employmentLevel, payrollPolicyId: staffEditor.payrollPolicyId, availabilitySlots: staffEditor.slots, slotCapacity: staffEditor.slotCapacity, schedulingPriority: staffEditor.schedulingPriority, dailySessionTarget: staffEditor.dailySessionTarget, dailySessionLimit: staffEditor.dailySessionLimit, compensation: staffEditor.compensation }); setStaffEditor(null); setSuccess('Đã lưu hồ sơ, lịch rảnh và chính sách phân ca của nhân viên.') }
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
    widths.push('116px')
    return { gridTemplateColumns: widths.join(' ') } satisfies CSSProperties
  }, [visibleColumns])

  const updateColumn = (column: DirectoryColumn) => setVisibleColumns((current) => ({ ...current, [column]: !current[column] }))
  const changeRole = async (user: AdminRoleUser, nextRole: UserRole) => {
    if (!canAssignRole || user.role === nextRole || staffPositionRoles.has(user.role) || staffPositionRoles.has(nextRole) || user.uid === currentUserUid) return
    if ((user.role === 'admin' || user.role === 'super_admin' || nextRole === 'admin' || nextRole === 'super_admin') && !canAssignSuperAdmin) return
    setTeamConfirmation({ kind: 'change_role', user, nextRole }); setError(null); setSuccess(null)
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
      const accessContext = await assignStaffPositions({ uid: user.uid, accessRole: accessRoleDraft, positions: accessRoleDraft === 'staff' ? positionDraft : [], branchIds: accessRoleDraft === 'staff' ? branchDraft : [] })
      setAssignments((current) => ({ ...current, [user.uid]: {
        accessRole: accessRoleDraft,
        positions: accessContext.positions,
        branchIds: accessContext.branchIds,
        status: accessContext.status,
      } }))
      setAccessEditorUid(null); setSuccess(`Đã cập nhật chức danh và phạm vi cho ${user.displayName || user.email || user.uid}. Người dùng cần đăng nhập lại để nhận token mới.`)
    } catch (caught) { setError(caught instanceof Error ? caught.message : `Không thể cập nhật quyền cho ${user.displayName || user.email || user.uid}.`) }
    finally { setAccessSaving(false) }
  }
  const submitInvite = async () => {
    if (!canAssignRole) return
    if (!inviteDraft.displayName.trim()) { setError('Nhập họ và tên trước khi tạo tài khoản.'); return }
    if (!inviteDraft.phoneNumber.trim()) { setError('Cần số điện thoại để tạo tài khoản.'); return }
    if (inviteDraft.accessRole === 'staff' && !inviteDraft.positions.length) { setError('Tài khoản nhân viên cần ít nhất một chức danh.'); return }
    setInviteSaving(true); setError(null); setSuccess(null)
    try {
      const common = { displayName: inviteDraft.displayName.trim(), phoneNumber: inviteDraft.phoneNumber.trim(), email: inviteDraft.email.trim() }
      const result = inviteDraft.accessRole === 'staff'
        ? await provisionStaffAccount({ ...common, positions: inviteDraft.positions, branchIds: inviteDraft.branchIds, employmentType: inviteDraft.employmentType, employmentLevel: inviteDraft.employmentLevel, payrollPolicyId: inviteDraft.payrollPolicyId })
        : await provisionStudentAccount(common)
      setInviteOpen(false); setInviteDraft(emptyInviteDraft()); setSuccess(`Đã tạo tài khoản cho ${result.displayName}. Email đăng nhập: ${result.email}. Mật khẩu ban đầu là số điện thoại; người dùng có thể đổi trong Hồ sơ cá nhân nếu muốn.`)
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Không thể tạo tài khoản.') }
    finally { setInviteSaving(false) }
  }
  const suspendStaff = async (member: AdminRoleUser) => {
    if (!canAssignRole || member.uid === currentUserUid) return
    setTeamConfirmation({ kind: 'suspend_staff', member }); setError(null); setSuccess(null)
  }
  const deleteStaff = async (member: AdminRoleUser) => {
    if (!canAssignRole || member.uid === currentUserUid) return
    setTeamConfirmation({ kind: 'delete_staff', member }); setError(null); setSuccess(null)
  }
  const openMemberDelete = (member: AdminRoleUser) => {
    if (!canAssignRole || member.uid === currentUserUid || member.role === 'admin' || member.role === 'super_admin') return
    setMemberDeleteTarget(member); setMemberDeleteConfirmation(''); setError(null); setSuccess(null)
  }
  const confirmMemberDelete = async () => {
    if (!memberDeleteTarget || memberDeleteConfirmation.trim().toLocaleUpperCase('vi') !== 'XÓA') return
    const target = memberDeleteTarget
    setSavingUid(target.uid); setError(null); setSuccess(null)
    try {
      const result = await deleteMemberAccount(target.uid)
      setMemberDeleteTarget(null); setMemberDeleteConfirmation('')
      setSuccess(result.preservedOperationalHistory
        ? `Đã xóa tài khoản đăng nhập của ${target.displayName || target.email || target.uid}. Hồ sơ PT, hợp đồng, lịch tập và tài chính vẫn được giữ để đối soát.`
        : `Đã xóa tài khoản thành viên ${target.displayName || target.email || target.uid}.`)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Không thể xóa tài khoản thành viên.')
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
    if (!canAssignRole) return
    setTeamConfirmation({ kind: 'archive_branch', branch }); setError(null); setSuccess(null)
  }

  const confirmTeamAction = async () => {
    if (!teamConfirmation || teamActionSaving) return
    setTeamActionSaving(true); setError(null); setSuccess(null)
    try {
      if (teamConfirmation.kind === 'change_role') {
        const { user, nextRole } = teamConfirmation
        setSavingUid(user.uid)
        await onRoleChange(user.uid, nextRole)
        setSuccess(`Đã cập nhật ${user.displayName || user.email || user.uid}. Người dùng cần đăng nhập lại để nhận quyền mới.`)
      } else if (teamConfirmation.kind === 'suspend_staff') {
        const { member } = teamConfirmation
        setSavingUid(member.uid)
        await suspendAccountAccess(member.uid)
        setSuccess(`Đã khóa và lưu trữ ${member.displayName || member.email || member.uid}. Không xóa lịch sử vận hành.`)
      } else if (teamConfirmation.kind === 'delete_staff') {
        const { member } = teamConfirmation
        setSavingUid(member.uid)
        await deleteUnusedStaffAccount(member.uid)
        setSuccess(`Đã xóa tài khoản mới tạo ${member.displayName || member.email || member.uid}.`)
      } else if (teamConfirmation.kind === 'reset_pt_workload') {
        const result = await applyDefaultTrainerSchedulingPolicy()
        setSuccess(`Đã áp dụng mục tiêu 8 ca và giới hạn 10 ca/ngày cho ${result.updated} PT đang hoạt động.`)
      } else {
        await deleteBranch(teamConfirmation.branch.id)
        setSuccess(`Đã lưu trữ chi nhánh ${teamConfirmation.branch.name}.`)
      }
      setTeamConfirmation(null)
    } catch (caught) {
      const fallback = teamConfirmation.kind === 'change_role'
        ? 'Không thể cập nhật vai trò.'
        : teamConfirmation.kind === 'suspend_staff'
          ? 'Không thể khóa tài khoản nhân viên.'
          : teamConfirmation.kind === 'delete_staff'
            ? 'Không thể xóa tài khoản nhân viên.'
            : teamConfirmation.kind === 'reset_pt_workload'
              ? 'Không thể áp dụng chuẩn ca cho đội ngũ PT.'
            : 'Không thể lưu trữ chi nhánh.'
      setError(caught instanceof Error ? caught.message : fallback)
    } finally {
      setSavingUid(null); setTeamActionSaving(false)
    }
  }

  if (!canViewTeam) return <div className="page admin-students-page identity-admin-page"><div className="identity-forbidden"><ShieldCheck size={38} /><h3>Bạn chưa có quyền xem đội ngũ</h3><p>Liên hệ quản trị viên để được cấp quyền phù hợp.</p></div></div>

  return <div className={`page admin-students-page identity-admin-page ${hasEditorPage ? 'identity-admin-page--subpage' : ''}`}>
    <header className="identity-hero">
      <span className="identity-hero__glow" aria-hidden="true" />
      <div className="identity-hero__copy">
        <small><Sparkles size={14} /> AURA OPERATIONS</small>
        <h1>Đội ngũ Aura</h1>
      </div>
      <div className="identity-hero__actions">
        <span><ShieldCheck size={17} />{(roleMeta[currentRole] || roleMeta.student).label}</span>
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
      <button type="button" className={section === 'policy' ? 'active' : ''} onClick={() => setSection('policy')}>
        <span><KeyRound /></span><small>CHÍNH SÁCH</small><strong>{scheduleConfig.complimentaryChangeCancelPerMonth ?? 1}</strong><em>Lượt đổi/hủy miễn mỗi tháng</em><ArrowRight size={17} />
      </button>
    </div>

    <nav className="identity-admin-tabs identity-admin-tabs--four" role="tablist" aria-label="Đội ngũ Aura">
      <button type="button" className={section === 'accounts' ? 'active' : ''} onClick={() => setSection('accounts')} role="tab" aria-selected={section === 'accounts'}><Users size={17} />Thành viên</button>
      <button type="button" className={section === 'staff' ? 'active' : ''} onClick={() => setSection('staff')} role="tab" aria-selected={section === 'staff'}><UserCog size={17} />Nhân viên</button>
      <button type="button" className={section === 'branches' ? 'active' : ''} onClick={() => setSection('branches')} role="tab" aria-selected={section === 'branches'}><Building2 size={17} />Chi nhánh</button>
      <button type="button" className={section === 'policy' ? 'active' : ''} onClick={() => setSection('policy')} role="tab" aria-selected={section === 'policy'}><ShieldCheck size={17} />Chính sách</button>
    </nav>

    {!canAssignRole && <div className="identity-readonly"><ShieldCheck size={18} />Bạn đang xem ở chế độ chỉ đọc. Chỉ quản trị viên được thay đổi tài khoản, chức danh và chi nhánh.</div>}
    {error && <div className="identity-message identity-message--error" role="alert"><AlertCircle size={17} />{error}</div>}
    {success && <div className="identity-message identity-message--success" role="status"><CheckCircle2 size={18} />{success}</div>}

    {section === 'accounts' && <section className="identity-section identity-members-section">
      <div className="identity-section__heading">
        <span><Users size={20} /><span><strong>Thành viên Aura</strong><em className="identity-section__count">{filteredUsers.length}</em></span></span>
        {canAssignRole && <button type="button" className="pink-orange-button" onClick={() => { setInviteDraft(emptyInviteDraft()); setInviteOpen(true); setError(null) }}><Plus size={17} />Thêm thành viên</button>}
      </div>
      <div className="identity-toolbar roles-directory-toolbar">
        <div className="identity-search course-search"><Search size={18} /><input aria-label="Tìm thành viên" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tìm tên, email hoặc số điện thoại" /></div>
        <label className="identity-filter"><SlidersHorizontal size={16} /><span>Loại</span><select aria-label="Lọc loại thành viên" value={roleFilter} onChange={(event) => setRoleFilter(event.target.value as 'all' | UserRole)}><option value="all">Tất cả</option><option value="student">Học viên</option><option value="user">Khách vãng lai</option></select></label>
        <div className="roles-column-picker"><button type="button" className="identity-filter" onClick={() => setColumnPickerOpen((current) => !current)} aria-expanded={columnPickerOpen}><Columns3 size={16} />Cột hiển thị</button>{columnPickerOpen && <div className="roles-column-picker__menu">{(Object.keys(directoryColumnMeta) as DirectoryColumn[]).map((column) => <label key={column}><input type="checkbox" checked={visibleColumns[column]} onChange={() => updateColumn(column)} />{directoryColumnMeta[column]}</label>)}</div>}</div>
      </div>
      <div className="students-table roles-directory identity-members-list" aria-busy={loading}>
        <div className="students-head" style={tableGridStyle}><span>THÀNH VIÊN</span>{visibleColumns.phone && <span>SỐ ĐIỆN THOẠI</span>}{visibleColumns.email && <span>EMAIL ĐĂNG NHẬP</span>}<span>LOẠI TÀI KHOẢN</span>{visibleColumns.scope && <span>QUYỀN & PHẠM VI</span>}{visibleColumns.activity && <span>HOẠT ĐỘNG</span>}{visibleColumns.status && <span>TRẠNG THÁI</span>}<span /></div>
        {loading && <div className="empty-state"><LoaderCircle size={30} className="spin" /><h3>Đang tải thành viên</h3><p>Dữ liệu tài khoản đang được đồng bộ.</p></div>}
        {!loading && filteredUsers.map((user, index) => <RoleDirectoryRow key={user.uid} user={user} assignment={assignments[user.uid]} index={index} tableGridStyle={tableGridStyle} visibleColumns={visibleColumns} currentUserUid={currentUserUid} canAssignRole={canAssignRole} canAssignSuperAdmin={canAssignSuperAdmin} isSaving={savingUid === user.uid} branches={branches} onChangeRole={changeRole} onOpenAccessEditor={openAccessEditor} onDeleteMember={openMemberDelete} />)}
        {!loading && filteredUsers.length === 0 && <div className="empty-state"><Users size={30} /><h3>Không tìm thấy thành viên</h3><p>Thử đổi từ khóa hoặc bộ lọc tài khoản.</p></div>}
      </div>
    </section>}

    {section === 'staff' && <section className="identity-section identity-staff">
      <div className="identity-section__heading">
        <span><BriefcaseBusiness size={20} /><span><strong>Nhân viên Aura</strong><em className="identity-section__count">{filteredStaffRows.length}</em></span></span>
        {canAssignRole && <div className="identity-section__actions"><button type="button" className="outline-button" onClick={() => { setTeamConfirmation({ kind: 'reset_pt_workload' }); setError(null); setSuccess(null) }}><SlidersHorizontal size={16} />Mục tiêu PT 8 ca</button><button type="button" className="pink-orange-button" onClick={() => { setInviteDraft({ ...emptyInviteDraft(), accessRole: 'staff' }); setInviteOpen(true); setError(null) }}><Plus size={17} />Thêm nhân viên</button></div>}
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
          <div className="identity-staff-card__facts"><span><WalletCards size={14} />{employmentTypeLabel(record.employmentType)}{record.employmentType === 'full_time' ? ` · ${employmentLevelLabel(record.employmentLevel)}` : ''}</span><span><ShieldCheck size={14} />{payrollPolicies.find((policy) => policy.id === record.payrollPolicyId)?.name || 'Chưa gán chính sách'}</span><span><CalendarClock size={14} />{Array.isArray(record.availableSlots) && record.availableSlots.length ? `${record.availableSlots.length} khung rảnh` : 'Chưa có lịch rảnh'}</span>{(assignment?.positions.includes('trainer_pt') || member.role === 'trainer' || record.role === 'trainer') && <span><SlidersHorizontal size={14} />Hạng {Number(record.schedulingPriority ?? record.priority ?? 100)} · mục tiêu {Number(record.dailySessionTarget ?? 8)} ca/ngày</span>}</div>
          {canAssignRole && <div className="identity-staff-card__actions">{canEditAccess && <button type="button" className="identity-staff-card__primary" onClick={() => openAccessEditor(member, assignment)}><KeyRound size={15} />Quyền</button>}<button type="button" className="outline-button" onClick={() => openStaffEditor(member)}><CalendarClock size={15} />Hồ sơ</button>{!isSuspended && member.uid !== currentUserUid && <><button type="button" className="outline-button identity-staff-card__archive identity-staff-card__icon-action" aria-label={`Khóa ${member.displayName || member.email || 'nhân viên'}`} title="Khóa tài khoản" onClick={() => void suspendStaff(member)} disabled={savingUid === member.uid}><ShieldCheck size={16} /></button><button type="button" className="outline-button identity-staff-card__delete identity-staff-card__icon-action" aria-label={`Xóa ${member.displayName || member.email || 'nhân viên'}`} title="Xóa tài khoản" onClick={() => void deleteStaff(member)} disabled={savingUid === member.uid}><Trash2 size={16} /></button></>}</div>}
        </article>
      })}{!filteredStaffRows.length && <div className="empty-state"><Users size={30} /><h3>Không tìm thấy nhân viên</h3></div>}</div>
    </section>}

    {section === 'branches' && <section className="identity-section identity-branches">
      <div className="identity-section__heading"><span><Building2 size={20} /><span><strong>Chi nhánh Aura</strong><small>Tạo cơ sở và dùng làm phạm vi dữ liệu cho Sales, PT hoặc Quản lý chi nhánh.</small></span></span>{canAssignRole && <button type="button" className="pink-orange-button" onClick={() => { setBranchEditor({ name: '', address: '' }); setError(null) }}><Plus size={17} />Thêm chi nhánh</button>}</div>
      <div className="identity-branch-list">{branches.length ? branches.map((branch) => <article key={branch.id} className={branch.status === 'archived' ? 'archived' : ''}><span><i><Building2 size={18} /></i><span><strong>{branch.name}</strong><small>{branch.address}</small></span></span><span className="identity-branch-list__actions"><i className={`status-badge ${branch.status === 'archived' ? 'draft' : 'published'}`}>{branch.status === 'archived' ? 'Đã lưu trữ' : 'Đang hoạt động'}</i>{canAssignRole && <><button type="button" className="outline-button" onClick={() => setBranchEditor({ id: branch.id, name: branch.name, address: branch.address })}>Chỉnh sửa</button>{branch.status !== 'archived' && <button type="button" className="outline-button" onClick={() => void archiveBranch(branch)}>Lưu trữ</button>}</>}</span></article>) : <div className="empty-state"><Building2 size={30} /><h3>Chưa có chi nhánh</h3><p>Tạo chi nhánh đầu tiên để cấp phạm vi cho đội ngũ.</p></div>}</div>
    </section>}
    {section === 'policy' && <AuraTeamPolicySettings canEdit={canAssignRole} />}
    {teamConfirmation && (() => { const copy = teamConfirmationCopy(teamConfirmation); return <section className="identity-overlay" role="region" aria-labelledby="team-confirmation-title">
      <div className="identity-modal identity-modal--compact identity-modal--confirmation">
        <ModalHeader id="team-confirmation-title" title={copy.title} detail={copy.subject} icon={<AlertCircle size={21} />} onClose={() => setTeamConfirmation(null)} />
        <div className={`identity-confirmation-card ${copy.danger ? 'is-danger' : ''}`}><ShieldCheck size={24} /><span><strong>{copy.detail}</strong><small>{copy.note}</small></span></div>
        <div className="identity-modal__actions"><button type="button" className="outline-button" onClick={() => setTeamConfirmation(null)} disabled={teamActionSaving}>Quay lại</button><button type="button" className={copy.danger ? 'identity-danger-button' : 'pink-orange-button'} onClick={() => void confirmTeamAction()} disabled={teamActionSaving}>{teamActionSaving ? 'Đang xử lý...' : copy.confirmLabel}</button></div>
      </div>
    </section> })()}
    {memberDeleteTarget && <section className="identity-overlay" role="region" aria-labelledby="member-delete-title">
      <div className="identity-modal identity-modal--compact identity-modal--delete">
        <ModalHeader id="member-delete-title" title="Xóa tài khoản thành viên" detail={memberDeleteTarget.displayName || memberDeleteTarget.email || memberDeleteTarget.uid} icon={<Trash2 size={21} />} onClose={() => setMemberDeleteTarget(null)} />
        <div className="identity-delete-warning"><AlertCircle size={21} /><span><strong>Tài khoản đăng nhập sẽ bị xóa vĩnh viễn.</strong><small>Hồ sơ PT, hợp đồng, buổi tập, thanh toán và lịch sử học vẫn được giữ để đối soát. Tài khoản nhân viên hoặc quản trị không thể xóa tại đây.</small></span></div>
        <label className="identity-delete-confirm"><span>Nhập <strong>XÓA</strong> để xác nhận</span><input autoFocus value={memberDeleteConfirmation} onChange={(event) => setMemberDeleteConfirmation(event.target.value)} aria-label="Nhập XÓA để xác nhận" placeholder="XÓA" autoComplete="off" /></label>
        <div className="identity-modal__actions"><button type="button" className="outline-button" onClick={() => setMemberDeleteTarget(null)}>Giữ tài khoản</button><button type="button" className="identity-danger-button" onClick={() => void confirmMemberDelete()} disabled={savingUid === memberDeleteTarget.uid || memberDeleteConfirmation.trim().toLocaleUpperCase('vi') !== 'XÓA'}>{savingUid === memberDeleteTarget.uid ? 'Đang xóa...' : 'Xóa tài khoản'}</button></div>
      </div>
    </section>}
    {accessEditorUser && <section className="identity-overlay" role="region" aria-labelledby="access-title"><div className="identity-modal identity-modal--access"><ModalHeader id="access-title" title={`Quyền của ${accessEditorUser.displayName || accessEditorUser.email || 'tài khoản'}`} detail="Chọn chức danh và chi nhánh." icon={<KeyRound size={21} />} onClose={() => setAccessEditorUid(null)} /><AccessRoleChooser value={accessRoleDraft} onChange={(role) => { setAccessRoleDraft(role); if (role === 'student') { setPositionDraft([]); setBranchDraft([]) } }} />{accessRoleDraft === 'staff' && <ScopedAssignmentFields positions={positionDraft} branchIds={branchDraft} branches={branches} onTogglePosition={(position) => togglePosition(position, 'access')} onToggleBranch={(branchId) => toggleBranch(branchId, 'access')} onApplyPreset={setPositionDraft} />}<div className="identity-modal__actions"><button type="button" className="outline-button" onClick={() => setAccessEditorUid(null)}>Hủy</button><button type="button" className="pink-orange-button" onClick={() => void saveScopedAccess(accessEditorUser)} disabled={accessSaving || (accessRoleDraft === 'staff' && !positionDraft.length)}>{accessSaving ? 'Đang lưu...' : 'Lưu quyền'}</button></div></div></section>}
    {inviteOpen && <section className="identity-overlay" role="region" aria-labelledby="invite-title"><div className={`identity-modal ${inviteDraft.accessRole === 'staff' ? 'identity-modal--staff-create' : ''}`}>
      <ModalHeader id="invite-title" title={inviteDraft.accessRole === 'staff' ? 'Thêm nhân viên' : 'Thêm thành viên'} detail="Mật khẩu ban đầu là số điện thoại." icon={<UserCog size={21} />} onClose={() => setInviteOpen(false)} />
      <section className="identity-form-section identity-form-section--account">
        <h3>Thông tin đăng nhập</h3>
        <div className="identity-form-grid"><label className="identity-form-grid__span"><span>Họ và tên</span><input value={inviteDraft.displayName} onChange={(event) => setInviteDraft((current) => ({ ...current, displayName: event.target.value }))} placeholder="Nguyễn Minh Anh" /></label><label><span>Số điện thoại</span><input type="tel" value={inviteDraft.phoneNumber} onChange={(event) => setInviteDraft((current) => ({ ...current, phoneNumber: event.target.value }))} placeholder="090…" /></label><label><span>Email đăng nhập (không bắt buộc)</span><input type="email" value={inviteDraft.email} onChange={(event) => setInviteDraft((current) => ({ ...current, email: event.target.value }))} placeholder="Bỏ trống: SĐT@aurafitness.vn" /></label></div>
      </section>
      {inviteDraft.accessRole === 'staff' && <>
        <section className="identity-form-section">
          <h3>Loại hợp tác</h3>
          <div className="identity-employment-type" role="radiogroup" aria-label="Loại hợp tác"><button type="button" className={inviteDraft.employmentType === 'full_time' ? 'active' : ''} onClick={() => setInviteDraft((current) => ({ ...current, employmentType: 'full_time', payrollPolicyId: '' }))}>Toàn thời gian</button><button type="button" className={inviteDraft.employmentType === 'part_time' ? 'active' : ''} onClick={() => setInviteDraft((current) => ({ ...current, employmentType: 'part_time', payrollPolicyId: '' }))}>Bán thời gian</button><button type="button" className={inviteDraft.employmentType === 'collaborator' ? 'active' : ''} onClick={() => setInviteDraft((current) => ({ ...current, employmentType: 'collaborator', payrollPolicyId: '' }))}>Cộng tác viên</button></div>
          {inviteDraft.employmentType === 'full_time' && <><h3>Cấp bậc</h3><div className="identity-employment-type" role="radiogroup" aria-label="Cấp bậc"><button type="button" className={inviteDraft.employmentLevel === 'probation' ? 'active' : ''} onClick={() => setInviteDraft((current) => ({ ...current, employmentLevel: 'probation', payrollPolicyId: '' }))}>Thử việc</button><button type="button" className={inviteDraft.employmentLevel === 'official' ? 'active' : ''} onClick={() => setInviteDraft((current) => ({ ...current, employmentLevel: 'official', payrollPolicyId: '' }))}>Chính thức</button><button type="button" className={inviteDraft.employmentLevel === 'senior' ? 'active' : ''} onClick={() => setInviteDraft((current) => ({ ...current, employmentLevel: 'senior', payrollPolicyId: '' }))}>Senior</button></div></>}
          <label className="identity-policy-select"><span>Chính sách lương</span><select value={inviteDraft.payrollPolicyId} onChange={(event) => setInviteDraft((current) => ({ ...current, payrollPolicyId: event.target.value }))}><option value="">Gán sau</option>{payrollPolicies.filter((policy) => policy.eligibleProfiles.includes(staffPayrollProfile(inviteDraft.employmentType, inviteDraft.employmentLevel))).map((policy) => <option key={policy.id} value={policy.id}>{policy.name}</option>)}</select></label>
        </section>
        <section className="identity-form-section identity-form-section--access"><h3>Chức danh & phạm vi</h3><ScopedAssignmentFields positions={inviteDraft.positions} branchIds={inviteDraft.branchIds} branches={branches} onTogglePosition={(position) => togglePosition(position, 'invite')} onToggleBranch={(branchId) => toggleBranch(branchId, 'invite')} onApplyPreset={(positions) => setInviteDraft((current) => ({ ...current, positions }))} /></section>
      </>}
      <div className="identity-modal__actions"><button type="button" className="outline-button" onClick={() => setInviteOpen(false)}>Hủy</button><button type="button" className="pink-orange-button" onClick={() => void submitInvite()} disabled={inviteSaving}>{inviteSaving ? 'Đang tạo...' : 'Tạo tài khoản'}</button></div>
    </div></section>}
    {branchEditor && <section className="identity-overlay" role="region" aria-labelledby="branch-title"><div className="identity-modal identity-modal--compact"><ModalHeader id="branch-title" title={branchEditor.id ? 'Chỉnh sửa chi nhánh' : 'Tạo chi nhánh'} detail="Chi nhánh này sẽ là phạm vi cấp quyền cho đội ngũ." icon={<Building2 size={21} />} onClose={() => setBranchEditor(null)} /><div className="identity-form-grid"><label className="identity-form-grid__span"><span>Tên chi nhánh</span><input value={branchEditor.name} onChange={(event) => setBranchEditor((current) => current ? { ...current, name: event.target.value } : current)} placeholder="Aura Fitness Quận 7" /></label><label className="identity-form-grid__span"><span>Địa chỉ</span><input value={branchEditor.address} onChange={(event) => setBranchEditor((current) => current ? { ...current, address: event.target.value } : current)} placeholder="Địa chỉ vận hành" /></label></div><div className="identity-modal__actions"><button type="button" className="outline-button" onClick={() => setBranchEditor(null)}>Hủy</button><button type="button" className="pink-orange-button" onClick={() => void saveBranch()} disabled={branchSaving}>{branchSaving ? 'Đang lưu...' : 'Lưu chi nhánh'}</button></div></div></section>}
    {staffEditor && <section className="identity-overlay" role="region" aria-labelledby="staff-operations-title">
      <div className="identity-modal identity-modal--staff">
        <ModalHeader id="staff-operations-title" title="Hồ sơ nhân viên" detail="Thông tin, thu nhập và lịch nhận ca." icon={<WalletCards size={21} />} onClose={() => setStaffEditor(null)} />
        <section className="identity-form-section"><h3>Thông tin nhân viên</h3><div className="identity-form-grid"><label className="identity-form-grid__span"><span>Họ và tên</span><input value={staffEditor.displayName} onChange={(event) => setStaffEditor((current) => current ? { ...current, displayName: event.target.value } : current)} placeholder="Họ và tên nhân viên" /></label><label><span>Email đăng nhập (không bắt buộc)</span><input type="email" value={staffEditor.email} onChange={(event) => setStaffEditor((current) => current ? { ...current, email: event.target.value } : current)} placeholder="Có thể bổ sung sau" /></label><label><span>Số điện thoại (không bắt buộc)</span><input type="tel" value={staffEditor.phoneNumber} onChange={(event) => setStaffEditor((current) => current ? { ...current, phoneNumber: event.target.value } : current)} placeholder="Có thể bổ sung sau" /></label></div></section>
        <section className="identity-form-section">
          <h3>Loại hợp tác & thu nhập</h3>
          <div className="identity-employment-type" role="radiogroup" aria-label="Loại hợp tác nhân viên">
            {(['full_time', 'part_time', 'collaborator'] as EmploymentType[]).map((type) => <button key={type} type="button" className={staffEditor.employmentType === type ? 'active' : ''} onClick={() => setStaffEditor((current) => current ? { ...current, employmentType: type, payrollPolicyId: '', compensation: type === 'collaborator' ? { ...current.compensation, baseSalary: 0, commissionPerSession: 0 } : current.compensation } : current)}>{employmentTypeLabel(type)}</button>)}
          </div>
          {staffEditor.employmentType === 'full_time' && <><h3>Cấp bậc</h3><div className="identity-employment-type" role="radiogroup" aria-label="Cấp bậc nhân viên">{(['probation', 'official', 'senior'] as EmploymentLevel[]).map((level) => <button key={level} type="button" className={staffEditor.employmentLevel === level ? 'active' : ''} onClick={() => setStaffEditor((current) => current ? { ...current, employmentLevel: level, payrollPolicyId: '' } : current)}>{employmentLevelLabel(level)}</button>)}</div></>}
          <label className="identity-policy-select"><span>Chính sách tiền ca</span><select value={staffEditor.payrollPolicyId} onChange={(event) => setStaffEditor((current) => current ? { ...current, payrollPolicyId: event.target.value } : current)}><option value="">Chọn khi lập kỳ</option>{payrollPolicies.filter((policy) => policy.eligibleProfiles.includes(staffPayrollProfile(staffEditor.employmentType, staffEditor.employmentLevel))).map((policy) => <option key={policy.id} value={policy.id}>{policy.name} · {Number(policy.ratePerSession).toLocaleString('vi-VN')}đ/ca</option>)}</select></label>
          <div className="identity-form-grid identity-form-grid--compensation"><label><span>Lương cơ bản / tháng</span><input type="number" min="0" value={staffEditor.compensation.baseSalary} disabled={staffEditor.employmentType === 'collaborator'} onChange={(event) => setStaffEditor((current) => current ? { ...current, compensation: { ...current.compensation, baseSalary: Number(event.target.value) } } : current)} /></label><label><span>Thưởng tháng</span><input type="number" min="0" value={staffEditor.compensation.bonusMonthly} onChange={(event) => setStaffEditor((current) => current ? { ...current, compensation: { ...current.compensation, bonusMonthly: Number(event.target.value) } } : current)} /></label><label><span>Hoa hồng giới thiệu (%)</span><input type="number" min="0" max="10" value={staffEditor.compensation.commissionRate} onChange={(event) => setStaffEditor((current) => current ? { ...current, compensation: { ...current.compensation, commissionRate: Number(event.target.value) } } : current)} /></label><label><span>Sức chứa mỗi ca PT</span><input type="number" min="1" max="4" value={staffEditor.slotCapacity} onChange={(event) => setStaffEditor((current) => current ? { ...current, slotCapacity: Math.max(1, Math.min(4, Number(event.target.value) || 1)) } : current)} /></label></div>
        </section>
        {staffEditor.isTrainer && <section className="identity-form-section identity-scheduling-policy">
          <header><span><strong>Ưu tiên phân ca PT</strong><small>PT chính thức được lấp đến mục tiêu trước; CTV nhận ca theo lịch đăng ký và thứ hạng.</small></span><button type="button" onClick={() => setStaffEditor((current) => current ? { ...current, dailySessionTarget: 8, dailySessionLimit: 10 } : current)}>Mục tiêu 8 ca</button></header>
          <div className="identity-form-grid identity-form-grid--scheduling"><label><span>Thứ tự ưu tiên</span><input type="number" min="1" max="999" value={staffEditor.schedulingPriority} onChange={(event) => setStaffEditor((current) => current ? { ...current, schedulingPriority: Math.max(1, Math.min(999, Number(event.target.value) || 1)) } : current)} /><small>Số nhỏ được ưu tiên khi cùng loại nhân sự và cùng tải ca.</small></label><label><span>Mục tiêu ca / ngày</span><input type="number" min="1" max="12" value={staffEditor.dailySessionTarget} onChange={(event) => setStaffEditor((current) => { if (!current) return current; const target = Math.max(1, Math.min(12, Number(event.target.value) || 1)); return { ...current, dailySessionTarget: target, dailySessionLimit: Math.max(target, current.dailySessionLimit) } })} /><small>Ca đôi cùng giờ chỉ tính một ca; mục tiêu không phải giới hạn.</small></label></div>
        </section>}
        <section className="identity-staff-availability">
          <header><span><strong>Ma trận thời gian rảnh</strong></span><em>{staffEditor.slots.length} khung đã chọn</em></header>
          <div className="identity-staff-availability__quick"><button type="button" onClick={() => setStaffEditor((current) => current ? { ...current, slots: workingDays.flatMap((day) => workingHours.map((hour) => `${day}-${hour}`)) } : current)}>Chọn tất cả</button><button type="button" onClick={() => setStaffEditor((current) => current ? { ...current, slots: [] } : current)}>Xóa chọn</button></div>
          <div className="identity-staff-availability__scroll" role="region" aria-label="Ma trận thời gian rảnh nhân viên" tabIndex={0}><table><thead><tr><th>Giờ</th>{workingDays.map((day) => <th key={day}>{day}</th>)}</tr></thead><tbody>{workingHours.map((hour) => <tr key={hour}><th>{String(hour).padStart(2, '0')}:00</th>{workingDays.map((day) => { const slot = `${day}-${hour}`; const selected = staffEditor.slots.includes(slot); return <td key={slot}><button type="button" className={selected ? 'active' : ''} aria-pressed={selected} aria-label={`${day} ${hour} giờ, ${selected ? 'đã chọn' : 'chưa chọn'}`} onClick={() => toggleStaffSlot(slot)}>{selected && <Check size={15} />}</button></td> })}</tr>)}</tbody></table></div>
        </section>
        <div className="identity-modal__actions"><button type="button" className="outline-button" onClick={() => setStaffEditor(null)}>Hủy</button><button type="button" className="pink-orange-button" onClick={() => void saveStaffProfile()} disabled={staffSaving}>{staffSaving ? 'Đang lưu...' : 'Lưu hồ sơ'}</button></div>
      </div>
    </section>}
  </div>
}

function RoleDirectoryRow({ user, assignment, index, tableGridStyle, visibleColumns, currentUserUid, canAssignRole, canAssignSuperAdmin, isSaving, branches, onChangeRole, onOpenAccessEditor, onDeleteMember }: {
  user: AdminRoleUser; assignment?: RoleAssignmentSummary; index: number; tableGridStyle: CSSProperties; visibleColumns: Record<DirectoryColumn, boolean>; currentUserUid?: string; canAssignRole: boolean; canAssignSuperAdmin: boolean; isSaving: boolean; branches: Branch[]; onChangeRole: (user: AdminRoleUser, nextRole: UserRole) => Promise<void>; onOpenAccessEditor: (user: AdminRoleUser, assignment?: RoleAssignmentSummary) => void; onDeleteMember: (user: AdminRoleUser) => void
}) {
  const status = statusMeta[assignment?.status === 'suspended' ? 'disabled' : user.status ?? 'active']; const userRoleData = roleMeta[user.role] || roleMeta.student
  const managedAsStaffPosition = staffPositionRoles.has(user.role)
  const roleLocked = !canAssignRole || isSaving || user.uid === currentUserUid || managedAsStaffPosition || ((user.role === 'admin' || user.role === 'super_admin') && !canAssignSuperAdmin)
  const canEditScopedAccess = canAssignRole && user.uid !== currentUserUid && user.role !== 'admin' && user.role !== 'super_admin'
  const assignedBranches = assignment?.branchIds.map((branchId) => branches.find((branch) => branch.id === branchId)?.name || 'Chi nhánh đã lưu trữ') ?? []
  const assignedPositions = assignment?.positions.map(assignmentPositionLabel) ?? []
  const scope = assignedPositions.length ? `${assignedPositions.join(' · ')}${assignedBranches.length ? ` — ${assignedBranches.join(', ')}` : ' — Toàn hệ thống'}` : userRoleData.scope
  return <article className="student-row identity-member-card" style={tableGridStyle}>
    <span className="student-identity">{user.photoURL ? <img src={user.photoURL} alt="" className="avatar avatar-photo" referrerPolicy="no-referrer" /> : <i className={['purple', 'green', 'orange', 'pink', 'blue'][index % 5]}>{initials(user.displayName, user.email)}</i>}<span><strong>{user.displayName || 'Chưa cập nhật tên'}</strong><small className="identity-member-card__mobile-contact">{user.phoneNumber || user.email || 'Chưa cập nhật liên hệ'}</small></span></span>
    {visibleColumns.phone && <span className="identity-contact-cell" data-label="Số điện thoại">{user.phoneNumber ? <><Phone size={14} />{user.phoneNumber}</> : <em>Chưa cập nhật</em>}</span>}
    {visibleColumns.email && <span className="identity-contact-cell" data-label="Email đăng nhập">{user.email ? <><Mail size={14} />{user.email}</> : <em>Chưa cập nhật</em>}</span>}
    <span className="identity-member-role" data-label="Loại tài khoản"><select aria-label={`Vai trò của ${user.displayName || user.email || user.uid}`} value={user.role || 'student'} disabled={roleLocked} onChange={(event) => void onChangeRole(user, event.target.value as UserRole)} style={{ color: userRoleData.tone }}>{managedAsStaffPosition && <option value={user.role}>{roleMeta[user.role].label} · chức danh</option>}{roles.map((role) => <option key={role} value={role} disabled={(role === 'admin' || role === 'super_admin') && !canAssignSuperAdmin}>{roleMeta[role].label}</option>)}</select></span>
    {visibleColumns.scope && <span className="program-name identity-scope-cell" data-label="Quyền & phạm vi">{scope}</span>}
    {visibleColumns.activity && <span className="student-streak" data-label="Hoạt động">{user.lastActive ?? 'Chưa có dữ liệu'}</span>}
    {visibleColumns.status && <span className="identity-member-status" data-label="Trạng thái"><i className={`status-badge ${status.className}`}>{status.label}</i></span>}
    <span className="row-actions identity-member-actions" aria-live="polite">{isSaving ? <LoaderCircle size={18} className="spin" color="var(--aura-pink)" /> : <>{canEditScopedAccess && <button type="button" className="identity-member-access" aria-label={`Cập nhật quyền cho ${user.displayName || user.email || user.uid}`} onClick={() => onOpenAccessEditor(user, assignment)}><UserCog size={17} /><span>Quyền</span></button>}{canEditScopedAccess && <button type="button" className="identity-member-delete" aria-label={`Xóa tài khoản ${user.displayName || user.email || user.uid}`} onClick={() => onDeleteMember(user)}><Trash2 size={16} /></button>}{!canEditScopedAccess && <CheckCircle2 size={18} color="#7fcb36" />}</>}</span>
  </article>
}

function AccessRoleChooser({ value, onChange }: { value: 'student' | 'staff'; onChange: (value: 'student' | 'staff') => void }) {
  return <div className="identity-access-editor__role" role="radiogroup" aria-label="Loại tài khoản"><button type="button" className={value === 'student' ? 'active' : ''} onClick={() => onChange('student')}>Học viên</button><button type="button" className={value === 'staff' ? 'active' : ''} onClick={() => onChange('staff')}>Nhân viên</button></div>
}
function ScopedAssignmentFields({ positions, branchIds, branches, onTogglePosition, onToggleBranch, onApplyPreset }: { positions: StaffPosition[]; branchIds: string[]; branches: Branch[]; onTogglePosition: (position: StaffPosition) => void; onToggleBranch: (branchId: string) => void; onApplyPreset: (positions: StaffPosition[]) => void }) {
  return <>
    <section className="identity-access-presets"><strong>Chọn nhanh</strong><div>{staffAccessPresets.map((preset) => { const active = preset.positions.length === positions.length && preset.positions.every((position) => positions.includes(position)); return <button type="button" key={preset.label} className={active ? 'active' : ''} onClick={() => onApplyPreset(preset.positions)}>{preset.label}</button> })}</div></section>
    <div className="identity-access-editor__options" aria-label="Chức danh">{positionOptions.map((position) => <label key={position.id} className={positions.includes(position.id) ? 'active' : ''}><input type="checkbox" checked={positions.includes(position.id)} onChange={() => onTogglePosition(position.id)} /><span><strong>{position.label}</strong><small>{position.description}</small></span></label>)}</div>
    <div className="identity-access-summary"><KeyRound size={17} /><span><strong>{positions.length ? `${positions.length} chức danh đang chọn` : 'Chưa chọn chức danh'}</strong></span></div>
    <div className="identity-access-editor__branches"><strong>Phạm vi chi nhánh</strong>{branches.length ? <div>{branches.filter((branch) => branch.status !== 'archived').map((branch) => <label key={branch.id} className={branchIds.includes(branch.id) ? 'active' : ''}><input type="checkbox" checked={branchIds.includes(branch.id)} onChange={() => onToggleBranch(branch.id)} />{branch.name}</label>)}</div> : <em>Chưa có chi nhánh</em>}</div>
  </>
}
function ModalHeader({ id, title, detail, icon, onClose }: { id: string; title: string; detail: string; icon: ReactNode; onClose: () => void }) {
  return <div className="identity-modal__header"><span>{icon}<span><strong id={id}>{title}</strong><small>{detail}</small></span></span><button type="button" className="icon-button" aria-label="Đóng" onClick={onClose}><X size={18} /></button></div>
}
