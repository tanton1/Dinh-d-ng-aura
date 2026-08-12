import '../../styles-admin.css'
import { useMemo, useState } from 'react'
import {
  AlertCircle,
  CheckCircle2,
  Crown,
  LoaderCircle,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  UserCog,
  Users,
} from 'lucide-react'
import { PageHeader } from '../../components/ui'
import { hasPermission } from '../../config/permissions'
import type { UserRole } from '../../types'

export interface AdminRoleUser {
  uid: string
  displayName: string
  email: string
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

const roles: UserRole[] = ['student', 'coach', 'editor', 'admin', 'super_admin']

const roleMeta: Record<UserRole, { label: string; scope: string; tone: string }> = {
  student: { label: 'Học viên', scope: 'Truy cập nội dung học tập', tone: '#797988' },
  coach: { label: 'Huấn luyện viên', scope: 'Giáo án & học viên được gán', tone: '#4e9724' },
  editor: { label: 'Biên tập viên', scope: 'Khóa học, media & thư viện', tone: '#3c80bd' },
  admin: { label: 'Administrator', scope: 'Quản trị vận hành', tone: 'var(--aura-pink)' },
  super_admin: { label: 'Super Administrator', scope: 'Toàn quyền hệ thống', tone: 'var(--aura-pink-neon)' },
}

const statusMeta = {
  active: { label: 'Đang hoạt động', className: 'published' },
  invited: { label: 'Đã mời', className: 'draft' },
  disabled: { label: 'Đã khóa', className: 'attention' },
} as const

function initials(name: string, email: string) {
  const source = name.trim() || email.split('@')[0]
  return source.split(/\s+/).map((part) => part[0]).slice(-2).join('').toUpperCase()
}

export default function AdminRolesPage({ users, currentRole, currentUserUid, onRoleChange, loading = false }: AdminRolesPageProps) {
  const [query, setQuery] = useState('')
  const [roleFilter, setRoleFilter] = useState<'all' | UserRole>('all')
  const [savingUid, setSavingUid] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const canAssignRole = hasPermission(currentRole, 'role.assign')
  const canAssignSuperAdmin = hasPermission(currentRole, 'role.assign_super_admin')
  const canViewTeam = hasPermission(currentRole, 'team.view')

  const filteredUsers = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase('vi')
    return users.filter((user) => {
      const matchesQuery = !normalizedQuery
        || `${user.displayName} ${user.email}`.toLocaleLowerCase('vi').includes(normalizedQuery)
      const matchesRole = roleFilter === 'all' || user.role === roleFilter
      return matchesQuery && matchesRole
    })
  }, [query, roleFilter, users])

  const stats = useMemo(() => ({
    total: users.length,
    staff: users.filter((user) => user.role !== 'student').length,
    content: users.filter((user) => user.role === 'coach' || user.role === 'editor').length,
    admins: users.filter((user) => user.role === 'admin' || user.role === 'super_admin').length,
  }), [users])

  const changeRole = async (user: AdminRoleUser, nextRole: UserRole) => {
    if (!canAssignRole || user.role === nextRole) return
    if ((user.role === 'super_admin' || nextRole === 'super_admin') && !canAssignSuperAdmin) return
    if (user.uid === currentUserUid) return
    if (!window.confirm(`Đổi vai trò của ${user.displayName || user.email} thành ${roleMeta[nextRole].label}?`)) return

    setSavingUid(user.uid)
    setError(null)
    setSuccess(null)
    try {
      await onRoleChange(user.uid, nextRole)
      setSuccess(`Đã cập nhật ${user.displayName || user.email}. Người dùng cần đăng nhập lại để nhận quyền mới.`)
    } catch {
      setError(`Không thể cập nhật quyền cho ${user.displayName || user.email}. Vui lòng thử lại.`)
    } finally {
      setSavingUid(null)
    }
  }

  if (!canViewTeam) {
    return (
      <div className="page admin-students-page">
        <div className="empty-state card" style={{ padding: 32 }}>
          <ShieldCheck size={38} />
          <h3>Bạn chưa có quyền xem đội ngũ</h3>
          <p>Liên hệ quản trị viên để được cấp quyền phù hợp.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="page admin-students-page">
      <PageHeader
        eyebrow="BẢO MẬT & ĐỘI NGŨ"
        title="Vai trò & quyền truy cập"
        description="Phân quyền đúng người, đúng phạm vi và bảo vệ dữ liệu học viên Aura Fitness."
        action={(
          <div className="filter-button" style={{ cursor: 'default', minWidth: 184, justifyContent: 'center' }}>
            <ShieldCheck size={17} color="var(--aura-pink)" />
            Bạn là {(roleMeta[currentRole] || roleMeta.student).label}
          </div>
        )}
      />

      <div className="student-insights" aria-label="Tổng quan đội ngũ">
        <div><span className="insight-icon purple"><Users /></span><span><small>TỔNG TÀI KHOẢN</small><strong>{stats.total}</strong></span></div>
        <div><span className="insight-icon green"><UserCog /></span><span><small>NHÂN SỰ</small><strong>{stats.staff}</strong></span></div>
        <div><span className="insight-icon orange"><SlidersHorizontal /></span><span><small>COACH & EDITOR</small><strong>{stats.content}</strong></span></div>
        <div><span className="insight-icon" style={{ color: 'var(--aura-pink)', background: 'var(--aura-pink-soft)' }}><Crown /></span><span><small>QUẢN TRỊ VIÊN</small><strong>{stats.admins}</strong></span></div>
      </div>

      {!canAssignRole && (
        <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 15, padding: '12px 15px', color: '#6c6975', fontSize: 12 }}>
          <ShieldCheck size={18} color="var(--aura-pink)" />
          Bạn đang xem ở chế độ chỉ đọc. Chỉ Administrator được thay đổi vai trò.
        </div>
      )}

      {error && (
        <div className="builder-save-error" role="alert" style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
          <AlertCircle size={17} /> {error}
        </div>
      )}

      {success && (
        <div className="card" role="status" style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 15, padding: '12px 15px', color: '#3f7c20', fontSize: 12 }}>
          <CheckCircle2 size={18} color="#68ad32" /> {success}
        </div>
      )}

      <div className="admin-list-toolbar students-toolbar">
        <div className="course-search">
          <Search size={18} />
          <input
            aria-label="Tìm thành viên"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Tìm tên hoặc email..."
          />
        </div>
        <label className="filter-button" style={{ marginLeft: 0 }}>
          <SlidersHorizontal size={16} />
          <span>Vai trò</span>
          <select
            aria-label="Lọc theo vai trò"
            value={roleFilter}
            onChange={(event) => setRoleFilter(event.target.value as 'all' | UserRole)}
            style={{ border: 0, outline: 0, color: 'inherit', background: 'transparent', fontWeight: 700 }}
          >
            <option value="all">Tất cả</option>
            {roles.map((role) => <option key={role} value={role}>{roleMeta[role].label}</option>)}
          </select>
        </label>
      </div>

      <div className="students-table card" aria-busy={loading}>
        <div className="students-head">
          <span>THÀNH VIÊN</span><span>VAI TRÒ</span><span>PHẠM VI</span><span>HOẠT ĐỘNG</span><span>TRẠNG THÁI</span><span />
        </div>

        {loading && (
          <div className="empty-state" style={{ minHeight: 220 }}>
            <LoaderCircle size={30} className="spin" />
            <h3>Đang tải danh sách quyền</h3>
            <p>Dữ liệu đội ngũ đang được đồng bộ.</p>
          </div>
        )}

        {!loading && filteredUsers.map((user, index) => {
          const status = statusMeta[user.status ?? 'active']
          const userRoleData = roleMeta[user.role] || roleMeta.student
          const isSaving = savingUid === user.uid
          const roleLocked = !canAssignRole
            || Boolean(savingUid)
            || user.uid === currentUserUid
            || (user.role === 'super_admin' && !canAssignSuperAdmin)

          return (
            <article className="student-row" key={user.uid}>
              <span className="student-identity">
                {user.photoURL
                  ? <img src={user.photoURL} alt="" className="avatar avatar-photo" referrerPolicy="no-referrer" />
                  : <i className={['purple', 'green', 'orange', 'pink', 'blue'][index % 5]}>{initials(user.displayName, user.email)}</i>}
                <span><strong style={{ fontSize: 12 }}>{user.displayName || 'Thành viên Aura'}</strong><small style={{ fontSize: 10 }}>{user.email}</small></span>
              </span>

              <span>
                <select
                  aria-label={`Vai trò của ${user.displayName || user.email}`}
                  value={user.role || 'student'}
                  disabled={roleLocked || isSaving}
                  onChange={(event) => void changeRole(user, event.target.value as UserRole)}
                  style={{
                    width: '100%', minHeight: 36, padding: '0 9px', border: '1px solid var(--line)',
                    borderRadius: 8, color: userRoleData.tone, background: '#fff', fontSize: 11, fontWeight: 750,
                  }}
                >
                  {roles.map((role) => (
                    <option key={role} value={role} disabled={role === 'super_admin' && !canAssignSuperAdmin}>
                      {roleMeta[role].label}
                    </option>
                  ))}
                </select>
              </span>

              <span className="program-name" style={{ color: '#66636f', fontSize: 11, lineHeight: 1.45 }}>{userRoleData.scope}</span>
              <span className="student-streak" style={{ color: '#797988', fontSize: 10 }}>{user.lastActive ?? 'Chưa có dữ liệu'}</span>
              <span><i className={`status-badge ${status.className}`} style={{ fontSize: 9 }}>{status.label}</i></span>
              <span className="row-actions" aria-live="polite">
                {isSaving
                  ? <LoaderCircle size={18} className="spin" color="var(--aura-pink)" />
                  : <CheckCircle2 size={18} color="#7fcb36" />}
              </span>
            </article>
          )
        })}

        {!loading && filteredUsers.length === 0 && (
          <div className="empty-state">
            <Users size={30} />
            <h3>Không tìm thấy thành viên</h3>
            <p>Thử thay đổi từ khóa hoặc bộ lọc vai trò.</p>
          </div>
        )}
      </div>
    </div>
  )
}
