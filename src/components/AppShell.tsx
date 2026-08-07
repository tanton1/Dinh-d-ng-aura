import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import {
  BarChart3,
  Bell,
  BookOpen,
  Check,
  CalendarDays,
  ChevronDown,
  ClipboardList,
  Cloud,
  Dumbbell,
  GraduationCap,
  HelpCircle,
  Home,
  LayoutDashboard,
  Soup,
  LogOut,
  Menu,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  UserRound,
  Users,
  X,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { hasPermission, type Permission } from '../config/permissions'
import type { AppMode, UserRole, ViewId } from '../types'
import NotificationCenter from './NotificationCenter'

interface AppShellProps {
  children: ReactNode
  mode: AppMode
  view: ViewId
  onNavigate: (view: ViewId) => void
  onModeChange: (mode: AppMode) => void
  mobileMenu: boolean
  setMobileMenu: (value: boolean) => void
  userName: string
  userRole: string
  role: UserRole
  setPreviewRole?: (role: UserRole) => void
  userPhoto?: string | null
  backendMode: 'demo' | 'firebase'
  canAccessAdmin: boolean
  onSignOut: () => void
  onSearch?: (query: string) => void
}

type ShellNavItem = { id: ViewId; label: string; icon: LucideIcon }
type ShellAdminNavItem = ShellNavItem & { permission: Permission }
type ShellNavSection = { label: string; items: ShellNavItem[] }

const studentNavSections: ShellNavSection[] = [
  {
    label: 'TỔNG QUAN',
    items: [{ id: 'home' as const, label: 'Hôm nay', icon: Home }],
  },
  {
    label: 'AURA ACADEMY',
    items: [
      { id: 'courses' as const, label: 'Học chuyên sâu', icon: BookOpen },
      { id: 'nutrition' as const, label: 'Dinh dưỡng', icon: Soup },
      { id: 'progress' as const, label: 'Tiến độ & ôn tập', icon: BarChart3 },
    ],
  },
  {
    label: 'PT COACHING',
    items: [{ id: 'schedule' as const, label: 'Lịch PT của tôi', icon: CalendarDays }],
  },
  {
    label: 'TÀI KHOẢN',
    items: [{ id: 'profile' as const, label: 'Cá nhân', icon: UserRound }],
  },
]

const studentMobileNav: ShellNavItem[] = [
  { id: 'home', label: 'Hôm nay', icon: Home },
  { id: 'courses', label: 'Học', icon: BookOpen },
  { id: 'nutrition', label: 'Dinh dưỡng', icon: Soup },
  { id: 'progress', label: 'Tiến độ', icon: BarChart3 },
  { id: 'profile', label: 'Cá nhân', icon: UserRound },
]

const adminNavSections: Array<{ label: string; items: ShellAdminNavItem[] }> = [
  {
    label: 'HỆ THỐNG',
    items: [
      { id: 'admin-dashboard' as const, label: 'Tổng quan', icon: LayoutDashboard, permission: 'dashboard.view' as Permission },
    ],
  },
  {
    label: 'AURA ACADEMY',
    items: [
      { id: 'admin-courses' as const, label: 'Khóa học Academy', icon: GraduationCap, permission: 'course.view' as Permission },
      { id: 'admin-academy-students' as const, label: 'Học viên Academy', icon: Users, permission: 'enrollment.manage' as Permission },
    ],
  },
  {
    label: 'PT COACHING',
    items: [
      { id: 'admin-students' as const, label: 'Khách hàng PT', icon: Users, permission: 'student.view_assigned' as Permission },
      { id: 'admin-programs' as const, label: 'Giáo án gym', icon: ClipboardList, permission: 'program.view' as Permission },
      { id: 'admin-nutrition-reviews' as const, label: 'Duyệt ăn', icon: Check, permission: 'student.view_assigned' as Permission },
    ],
  },
  {
    label: 'QUẢN TRỊ',
    items: [
      { id: 'admin-roles' as const, label: 'Vai trò & quyền', icon: ShieldCheck, permission: 'team.view' as Permission },
    ],
  },
]

const adminMobileNav: ShellAdminNavItem[] = [
  { id: 'admin-dashboard', label: 'Tổng quan', icon: LayoutDashboard, permission: 'dashboard.view' },
  { id: 'admin-courses', label: 'Academy', icon: GraduationCap, permission: 'course.view' },
  { id: 'admin-students', label: 'Khách PT', icon: Users, permission: 'student.view_assigned' },
  { id: 'admin-programs', label: 'Giáo án', icon: ClipboardList, permission: 'program.view' },
  { id: 'admin-nutrition-reviews', label: 'Duyệt ăn', icon: Check, permission: 'student.view_assigned' },
]

const viewTitles: Record<ViewId, string> = {
  home: 'Hôm nay',
  courses: 'Học',
  'course-detail': 'Không gian học',
  nutrition: 'Dinh dưỡng',
  progress: 'Tiến độ & ôn tập',
  schedule: 'Lịch PT',
  profile: 'Cá nhân',
  workout: 'Buổi tập',
  'admin-dashboard': 'Tổng quan vận hành',
  'admin-courses': 'Khóa học Academy',
  'admin-course-editor': 'Course Studio',
  'admin-academy-students': 'Học viên Academy',
  'admin-programs': 'Kho giáo án PT',
  'admin-students': 'Khách hàng PT',
  'admin-roles': 'Đội ngũ & quyền',
  'admin-nutrition-reviews': 'Duyệt ăn',
  'progress-photo-studio': 'Thêm ảnh tiến độ',
}

function isNavigationActive(view: ViewId, itemId: ViewId, mobile = false) {
  if (view === itemId) return true
  if (view === 'course-detail' && itemId === 'courses') return true
  if (view === 'admin-course-editor' && itemId === 'admin-courses') return true
  return false
}

export default function AppShell({ children, mode, view, onNavigate, onModeChange, mobileMenu, setMobileMenu, userName, userRole, role, setPreviewRole, userPhoto, backendMode, canAccessAdmin, onSignOut, onSearch }: AppShellProps) {
  const navSections: ShellNavSection[] = mode === 'student'
    ? studentNavSections
    : adminNavSections
      .map((section) => ({
        ...section,
        items: section.items.filter((item) => hasPermission(role, item.permission)),
      }))
      .filter((section) => section.items.length > 0)
  const mobileAdminItems = adminMobileNav.filter((item) => hasPermission(role, item.permission))
  const isImmersive = view === 'workout'
  const [searchQuery, setSearchQuery] = useState('')
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false)
  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const [online, setOnline] = useState(navigator.onLine)
  const [shellMessage, setShellMessage] = useState<string | null>(null)
  const mobileSearchInputRef = useRef<HTMLInputElement>(null)
  const currentMonth = new Intl.DateTimeFormat('vi-VN', { month: 'numeric' }).format(new Date())

  useEffect(() => {
    const handleOnline = () => setOnline(true)
    const handleOffline = () => setOnline(false)
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  useEffect(() => {
    if (!shellMessage) return
    const timeoutId = window.setTimeout(() => setShellMessage(null), 4200)
    return () => window.clearTimeout(timeoutId)
  }, [shellMessage])

  useEffect(() => {
    if (!mobileSearchOpen) return
    mobileSearchInputRef.current?.focus()
  }, [mobileSearchOpen])

  useEffect(() => {
    setMobileSearchOpen(false)
  }, [mode, view])

  useEffect(() => {
    const overlayOpen = mobileMenu || mobileSearchOpen
    document.body.classList.toggle('shell-overlay-open', overlayOpen)
    return () => document.body.classList.remove('shell-overlay-open')
  }, [mobileMenu, mobileSearchOpen])

  const submitSearch = (event: FormEvent) => {
    event.preventDefault()
    const normalizedQuery = searchQuery.trim()
    if (!normalizedQuery) return
    onSearch?.(normalizedQuery)
    setMobileSearchOpen(false)
  }

  if (isImmersive) return <>{children}</>

  return (
    <div className={`app-shell ${mode}`} data-view={view}>
      <a className="skip-link" href="#main-content">Bỏ qua điều hướng</a>
      <aside id="app-sidebar" className={`sidebar ${mobileMenu ? 'open' : ''}`}>
        <button className="brand" type="button" aria-label="Về trang Hôm nay" onClick={() => { onNavigate(mode === 'student' ? 'home' : 'admin-dashboard'); setMobileMenu(false) }}>
          <div className="brand-mark">A<span /></div>
          <div><strong>AURA</strong><small>FITNESS</small></div>
        </button>
        <button className="sidebar-close" aria-label="Đóng menu" onClick={() => setMobileMenu(false)}><X size={22} /></button>

        <nav className="sidebar-nav" aria-label="Điều hướng chính">
          {navSections.map((section, sectionIdx) => (
            <div className="sidebar-nav__section" key={section.label || `section-${sectionIdx}`}>
              {section.label ? <p>{section.label}</p> : null}
              {section.items.map((item) => {
                const Icon = item.icon
                const active = isNavigationActive(view, item.id)
                return (
                  <button key={item.id} className={active ? 'active' : ''} aria-current={active ? 'page' : undefined} title={item.label} onClick={() => { onNavigate(item.id); setMobileMenu(false) }}>
                    <Icon size={20} /><span>{item.label}</span>{active && <i />}
                  </button>
                )
              })}
            </div>
          ))}
        </nav>

        {mode === 'student' && backendMode === 'demo' && (
          <div className="sidebar-challenge">
            <div className="challenge-icon"><Sparkles size={19} /></div>
            <strong>Mục tiêu mẫu tháng {currentMonth}</strong>
            <span>Còn 3 buổi để nhận huy hiệu</span>
            <div><i style={{ width: '70%' }} /></div>
            <small>BẢN XEM TRƯỚC · 7/10</small>
          </div>
        )}

        <div className="sidebar-bottom">
          <button onClick={() => setShellMessage('Trung tâm trợ giúp đang được hoàn thiện. Bạn vẫn có thể quản lý tài khoản trong trang Cá nhân.')}><HelpCircle size={19} /><span>Trợ giúp</span></button>
          <button onClick={() => onNavigate('profile')}><Settings size={19} /><span>Cài đặt</span></button>
          {(mode === 'admin' || canAccessAdmin) && <button className="mode-switch" onClick={() => onModeChange(mode === 'student' ? 'admin' : 'student')}>
              {mode === 'student' ? <LayoutDashboard size={18} /> : <UserRound size={18} />}
              <span>{mode === 'student' ? 'Mở trang quản trị' : 'Xem trang học viên'}</span>
            </button>}
          {backendMode === 'firebase' && <button className="sidebar-signout" onClick={onSignOut}><LogOut size={18} /><span>Đăng xuất</span></button>}
        </div>
      </aside>

      {mobileMenu && <button className="sidebar-scrim" aria-label="Đóng menu" onClick={() => setMobileMenu(false)} />}

      <div className="app-main">
        <header className="topbar">
          <button className="mobile-menu-button" aria-label="Mở menu" aria-controls="app-sidebar" aria-expanded={mobileMenu} onClick={() => setMobileMenu(true)}><Menu size={23} /></button>
          <div className="mobile-page-context">
            <small>{mode === 'student' ? 'AURA FITNESS' : 'AURA OPERATIONS'}</small>
            <strong>{viewTitles[view]}</strong>
          </div>
          <form className="topbar-search" onSubmit={submitSearch}>
            <button type="submit" aria-label="Tìm"><Search size={19} /></button>
            <input aria-label="Tìm kiếm" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder={mode === 'student' ? 'Tìm trong Aura Academy...' : 'Tìm nội dung hoặc khách hàng...'} />
            <kbd>Enter</kbd>
          </form>
          <div className="topbar-actions">
            <button className="mobile-search-button" aria-label="Mở tìm kiếm" aria-expanded={mobileSearchOpen} onClick={() => setMobileSearchOpen(true)}><Search size={20} /></button>
            <span className={`backend-indicator ${backendMode}`} title={backendMode === 'firebase' ? 'Dữ liệu đã được đồng bộ' : 'Đang dùng dữ liệu xem trước'}><Cloud size={14} />{backendMode === 'firebase' ? 'Đã đồng bộ' : 'Xem trước'}</span>
            <NotificationCenter />
            <div style={{ position: 'relative' }}>
              <button className="user-menu" aria-label={`Tài khoản ${userName}`} aria-expanded={userMenuOpen} onClick={() => setUserMenuOpen(!userMenuOpen)}>
                {userPhoto ? <img className="avatar avatar-photo" src={userPhoto} alt="" referrerPolicy="no-referrer" /> : <span className="avatar">{userName.split(' ').map((part) => part[0]).slice(-2).join('').toUpperCase()}</span>}
                <span className="user-copy"><strong>{userName}</strong><small>{userRole}</small></span>
                <ChevronDown size={16} />
              </button>
              {userMenuOpen && (
                <>
                  <div className="user-dropdown-layer" onClick={() => setUserMenuOpen(false)} />
                  <div className="user-dropdown-menu">
                    {mode === 'student' && (
                      <>
                        <button onClick={() => { setUserMenuOpen(false); onNavigate('profile') }}>
                          <span>Hồ sơ cá nhân</span>
                          <UserRound size={15} />
                        </button>
                        <hr />
                      </>
                    )}
                    
                    <strong className="dropdown-label">Xem trước giao diện</strong>
                    <button className={role === 'student' ? 'active' : ''} onClick={() => { setPreviewRole?.('student'); setUserMenuOpen(false); }}>
                      <span>Học viên</span>
                      {role === 'student' && <Check size={14} />}
                    </button>
                    <button className={role === 'coach' ? 'active' : ''} onClick={() => { setPreviewRole?.('coach'); setUserMenuOpen(false); }}>
                      <span>Huấn luyện viên</span>
                      {role === 'coach' && <Check size={14} />}
                    </button>
                    <button className={role === 'admin' ? 'active' : ''} onClick={() => { setPreviewRole?.('admin'); setUserMenuOpen(false); }}>
                      <span>Admin</span>
                      {role === 'admin' && <Check size={14} />}
                    </button>
                    
                    {backendMode === 'firebase' && (
                      <>
                        <hr />
                        <button className="danger" onClick={() => { setUserMenuOpen(false); onSignOut(); }}>
                          <span>Đăng xuất</span>
                          <LogOut size={15} />
                        </button>
                      </>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        </header>

        {mobileSearchOpen && (
          <div className="mobile-search-layer" role="presentation" onKeyDown={(event) => event.key === 'Escape' && setMobileSearchOpen(false)}>
            <button className="mobile-search-backdrop" aria-label="Đóng tìm kiếm" onClick={() => setMobileSearchOpen(false)} />
            <section className="mobile-search-sheet" role="dialog" aria-modal="true" aria-labelledby="mobile-search-title">
              <header>
                <div>
                  <small>AURA SEARCH</small>
                  <h2 id="mobile-search-title">Tìm nhanh</h2>
                </div>
                <button className="icon-button" aria-label="Đóng tìm kiếm" onClick={() => setMobileSearchOpen(false)}><X size={20} /></button>
              </header>
              <form onSubmit={submitSearch}>
                <Search size={20} />
                <input ref={mobileSearchInputRef} aria-label="Từ khóa tìm kiếm" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder={mode === 'student' ? 'Khóa học, chủ đề dinh dưỡng...' : 'Khóa học hoặc khách hàng...'} />
                <button type="submit">Tìm</button>
              </form>
              <p>{mode === 'student' ? 'Aura sẽ đưa bạn tới kết quả phù hợp trong khu vực Học.' : 'Kết quả được mở trong workspace quản trị phù hợp với quyền của bạn.'}</p>
            </section>
          </div>
        )}

        {!online && <div className="offline-banner" role="status"><Cloud size={15} /> Bạn đang ngoại tuyến. Aura sẽ dùng nội dung đã lưu và đồng bộ lại khi có mạng.</div>}
        {shellMessage && <div className="shell-toast" role="status">{shellMessage}<button aria-label="Đóng thông báo" onClick={() => setShellMessage(null)}><X size={15} /></button></div>}
        <main id="main-content" className="page-content" tabIndex={-1}>{children}</main>

        {mode === 'student' ? (
          <nav className="mobile-bottom-nav" aria-label="Điều hướng học viên">
            {studentMobileNav.map((item) => {
              const Icon = item.icon
              const active = isNavigationActive(view, item.id, true)
              return (
                <button key={item.id} className={active ? 'active' : ''} aria-current={active ? 'page' : undefined} onClick={() => onNavigate(item.id)}>
                  <Icon size={21} /><span>{item.label}</span>
                </button>
              )
            })}
          </nav>
        ) : (
          <nav className="mobile-bottom-nav admin-mobile-nav" aria-label="Điều hướng quản trị">
            {mobileAdminItems.map((item) => {
              const Icon = item.icon
              const active = isNavigationActive(view, item.id, true)
              return (
                <button key={item.id} className={active ? 'active' : ''} aria-current={active ? 'page' : undefined} onClick={() => onNavigate(item.id)}>
                  <Icon size={21} /><span>{item.label}</span>
                </button>
              )
            })}
            <button aria-expanded={mobileMenu} aria-controls="app-sidebar" onClick={() => setMobileMenu(true)}>
              <Menu size={21} /><span>Thêm</span>
            </button>
          </nav>
        )}
      </div>
    </div>
  )
}
