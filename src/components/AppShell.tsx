import { lazy, Suspense, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { prefetchRoute } from '../utils/routePreloader'
import {
  BarChart3,
  Bell,
  Bot,
  BookOpen,
  Check,
  CalendarClock,
  CalendarDays,
  ChevronDown,
  ClipboardList,
  Cloud,
  Dumbbell,
  GraduationCap,
  History,
  Home,
  LayoutDashboard,
  Soup,
  LogOut,
  Menu,
  RefreshCw,
  Search,
  ShieldCheck,
  ShoppingBasket,
  Sparkles,
  UserRound,
  Users,
  WalletCards,
  X,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { hasPermission, type Permission } from '../config/permissions'
import type { StaffPosition } from '../identity/access'
import type { AppMode, UserRole, ViewId } from '../types'
import type { AiCoachLearningContext } from '../services/nutritionService'
import NotificationCenter from './NotificationCenter'

// Keep the conversation out of the initial shell bundle. The coach is
// available from every learner page, but its chat UI and Firebase calls are
// loaded only after the member opens it.
const AiCoachBottomSheet = lazy(() => import('./progress/AiCoachBottomSheet').then((module) => ({ default: module.AiCoachBottomSheet })))

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
  isStaffWorkspace?: boolean
  staffPositions?: StaffPosition[]
  onSignOut: () => void
  onSearch?: (query: string) => void
  canNavigate?: (view: ViewId) => boolean
  authorizationError?: string | null
  aiCoachConversationScope?: string
  aiCoachLearningContext?: AiCoachLearningContext | null
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
    label: 'AURA ACADEMY & DINH DƯỠNG',
    items: [
      { id: 'courses' as const, label: 'Học chuyên sâu', icon: BookOpen },
      { id: 'nutrition' as const, label: 'Dinh dưỡng', icon: Soup },
      { id: 'eat-clean' as const, label: 'Đặt món Eat Clean', icon: ShoppingBasket },
      { id: 'progress' as const, label: 'Tiến độ & ôn tập', icon: BarChart3 },
    ],
  },
  {
    label: 'PT COACHING & GYM',
    items: [
      { id: 'schedule' as const, label: 'Lịch học viên', icon: CalendarDays },
      { id: 'student-availability' as const, label: 'Lịch rảnh', icon: CalendarClock },
      { id: 'pt-workout' as const, label: 'Tập luyện', icon: Dumbbell },
    ],
  },
  {
    label: 'TÀI KHOẢN',
    items: [{ id: 'profile' as const, label: 'Cá nhân', icon: UserRound }],
  },
]

const studentMobileNav: ShellNavItem[] = [
  { id: 'home', label: 'Hôm nay', icon: Home },
  { id: 'schedule', label: 'Lịch', icon: CalendarDays },
  { id: 'nutrition', label: 'Dinh dưỡng', icon: Soup },
  { id: 'pt-workout', label: 'Tập luyện', icon: Dumbbell },
  { id: 'progress', label: 'Tiến độ', icon: BarChart3 },
]

const staffNavSections: ShellNavSection[] = [
  {
    label: 'CÔNG VIỆC',
    items: [
      { id: 'staff-dashboard' as const, label: 'Tổng quan Staff', icon: LayoutDashboard },
      { id: 'staff-students' as const, label: 'Học viên phụ trách', icon: Users },
      { id: 'staff-schedule' as const, label: 'Lịch làm việc', icon: CalendarDays },
      { id: 'admin-pt-schedule' as const, label: 'Lịch chi nhánh', icon: CalendarDays },
      { id: 'staff-workouts' as const, label: 'Giáo án & mức tạ', icon: Dumbbell },
      { id: 'staff-nutrition-reviews' as const, label: 'Duyệt món', icon: Check },
      { id: 'staff-quotes' as const, label: 'Báo giá', icon: ClipboardList },
      { id: 'staff-renewals' as const, label: 'Tái ký', icon: RefreshCw },
      { id: 'staff-payroll' as const, label: 'Lương của tôi', icon: WalletCards },
    ],
  },
  {
    label: 'CÁ NHÂN AURA',
    items: [
      { id: 'home' as const, label: 'Hôm nay', icon: Home },
      { id: 'nutrition' as const, label: 'Dinh dưỡng', icon: Soup },
      { id: 'schedule' as const, label: 'Lịch học viên', icon: CalendarDays },
      { id: 'progress' as const, label: 'Tiến độ', icon: BarChart3 },
      { id: 'courses' as const, label: 'Học', icon: BookOpen },
      { id: 'eat-clean' as const, label: 'Đặt món Eat Clean', icon: ShoppingBasket },
    ],
  },
  {
    label: 'TÀI KHOẢN',
    items: [{ id: 'profile' as const, label: 'Cá nhân', icon: UserRound }],
  },
]

const staffMobileNav: ShellNavItem[] = [
  { id: 'staff-dashboard', label: 'Tổng quan', icon: LayoutDashboard },
  { id: 'staff-students', label: 'Học viên', icon: Users },
  { id: 'staff-schedule', label: 'Lịch', icon: CalendarDays },
  { id: 'admin-pt-schedule', label: 'Lịch CN', icon: CalendarDays },
  { id: 'staff-quotes', label: 'Báo giá', icon: ClipboardList },
  { id: 'staff-workouts', label: 'Giáo án', icon: Dumbbell },
  { id: 'staff-nutrition-reviews', label: 'Duyệt món', icon: Check },
  { id: 'staff-payroll', label: 'Lương', icon: WalletCards },
  { id: 'staff-renewals', label: 'Tái ký', icon: RefreshCw },
  { id: 'courses', label: 'Academy', icon: BookOpen },
]

const staffPositionRoutes: Record<StaffPosition, ViewId[]> = {
  trainer_pt: ['staff-dashboard', 'staff-students', 'staff-schedule', 'staff-workouts', 'staff-nutrition-reviews', 'staff-renewals', 'staff-payroll'],
  coach_online: ['staff-dashboard', 'staff-students', 'staff-nutrition-reviews', 'staff-payroll'],
  sales: ['staff-dashboard', 'staff-quotes', 'staff-renewals', 'staff-payroll'],
  branch_manager: ['staff-dashboard', 'admin-pt-schedule', 'staff-workouts', 'staff-renewals', 'staff-payroll'],
  academy_editor: ['staff-dashboard', 'courses', 'staff-payroll'],
  shipper: ['delivery'],
}

function legacyStaffPosition(role: UserRole): StaffPosition | null {
  if (role === 'trainer') return 'trainer_pt'
  if (role === 'coach') return 'coach_online'
  if (role === 'sales') return 'sales'
  if (role === 'manager') return 'branch_manager'
  if (role === 'editor') return 'academy_editor'
  if (role === 'shipper') return 'shipper'
  return null
}

function staffRouteSet(positions: StaffPosition[], role: UserRole) {
  const effectivePositions = positions.length ? positions : [legacyStaffPosition(role)].filter((item): item is StaffPosition => Boolean(item))
  const routes = new Set<ViewId>(['staff-dashboard', 'profile'])
  effectivePositions.forEach((position) => staffPositionRoutes[position].forEach((view) => routes.add(view)))
  return routes
}

const adminNavSections: Array<{ label: string; items: ShellAdminNavItem[] }> = [
  {
    label: 'HỆ THỐNG',
    items: [
      { id: 'admin-dashboard' as const, label: 'Trung tâm điều hành', icon: LayoutDashboard, permission: 'dashboard.view' as Permission },
    ],
  },
  {
    label: 'KHÁCH HÀNG & LỊCH PT',
    items: [
      { id: 'admin-pt-students' as const, label: 'Học viên PT Gym', icon: Users, permission: 'student.view_assigned' as Permission },
      { id: 'admin-pt-schedule' as const, label: 'Lịch PT & Yêu cầu', icon: CalendarDays, permission: 'dashboard.view' as Permission },
      { id: 'admin-training-history' as const, label: 'Lịch sử tập & lịch dạy', icon: History, permission: 'analytics.view_all' as Permission },
      { id: 'admin-pt-workouts' as const, label: 'Giáo án & mức tạ', icon: Dumbbell, permission: 'program.view' as Permission },
      { id: 'admin-trainer-quality' as const, label: 'Chất lượng PT', icon: Sparkles, permission: 'analytics.view_all' as Permission },
      { id: 'admin-renewals' as const, label: 'Tái ký & gia hạn', icon: RefreshCw, permission: 'dashboard.view' as Permission },
    ],
  },
  {
    label: 'VẬN HÀNH NỘI BỘ',
    items: [
      { id: 'admin-finance' as const, label: 'Tài chính', icon: LayoutDashboard, permission: 'analytics.view_all' as Permission },
      { id: 'admin-payroll' as const, label: 'Bảng lương', icon: WalletCards, permission: 'analytics.view_assigned' as Permission },
      { id: 'admin-hr' as const, label: 'Đội ngũ Aura', icon: Users, permission: 'team.view' as Permission },
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
    label: 'ONLINE COACHING & EAT CLEAN',
    items: [
      { id: 'admin-students' as const, label: 'Khách hàng Online', icon: Users, permission: 'student.view_assigned' as Permission },
      { id: 'admin-programs' as const, label: 'Giáo án gym online', icon: ClipboardList, permission: 'program.view' as Permission },
      { id: 'admin-eat-clean' as const, label: 'Vận hành Eat Clean', icon: ShoppingBasket, permission: 'eat_clean.manage' as Permission },
      { id: 'admin-nutrition-reviews' as const, label: 'Duyệt ăn', icon: Check, permission: 'student.view_assigned' as Permission },
    ],
  },
  {
    label: 'QUẢN TRỊ',
    items: [
      { id: 'admin-notifications' as const, label: 'Push Notifications & Cài đặt', icon: Bell, permission: 'team.view' as Permission },
    ],
  },
]

const adminMobileNav: ShellAdminNavItem[] = [
  { id: 'admin-dashboard', label: 'Tổng quan', icon: LayoutDashboard, permission: 'dashboard.view' },
  { id: 'admin-pt-students', label: 'Học viên PT', icon: Users, permission: 'student.view_assigned' },
  { id: 'admin-pt-schedule', label: 'Lịch & YC', icon: CalendarDays, permission: 'dashboard.view' },
  { id: 'admin-renewals', label: 'Tái ký', icon: RefreshCw, permission: 'dashboard.view' },
  { id: 'admin-finance', label: 'Tài chính', icon: BarChart3, permission: 'analytics.view_all' },
  { id: 'admin-courses', label: 'Academy', icon: GraduationCap, permission: 'course.view' },
]

const viewTitles: Partial<Record<ViewId, string>> = {
  home: 'Hôm nay',
  courses: 'Học',
  'course-detail': 'Không gian học',
  nutrition: 'Dinh dưỡng',
  'eat-clean': 'Đặt món Eat Clean',
  'trainer-portal': 'Cổng làm việc HLV',
  'staff-dashboard': 'Tổng quan Staff',
  'sales-portal': 'Cổng báo giá & Bán hàng',
  'staff-students': 'Học viên phụ trách',
  'staff-schedule': 'Lịch dạy của tôi',
  'staff-workouts': 'Giáo án & mức tạ',
  'staff-availability': 'Lịch rảnh của tôi',
  'staff-requests': 'Yêu cầu đổi và hủy lịch',
  'staff-nutrition-reviews': 'Duyệt món học viên',
  'staff-quotes': 'Báo giá',
  'staff-renewals': 'Tái ký và gia hạn',
  'staff-payroll': 'Lương của tôi',
  progress: 'Tiến độ & ôn tập',
  schedule: 'Lịch học viên',
  'student-availability': 'Lịch rảnh',
  'pt-workout': 'Tập luyện',
  profile: 'Cá nhân',
  workout: 'Buổi tập',
  delivery: 'Aura Delivery',
  'admin-dashboard': 'Trung tâm điều hành',
  'admin-today-sessions': 'Ca tập hôm nay',
  'admin-pt-students': 'Quản lý Học viên PT Gym',
  'admin-pt-schedule': 'Lịch PT & Hộp yêu cầu',
  'admin-training-history': 'Lịch sử tập & lịch dạy',
  'admin-pt-workouts': 'Giáo án & mức tạ',
  'admin-trainer-quality': 'Chất lượng PT',
  'admin-renewals': 'Tái ký & chăm sóc hợp đồng',
  'admin-report': 'Tổng quan vận hành Gym',
  'admin-finance': 'Tài chính',
  'admin-payroll': 'Bảng lương',
  'admin-hr': 'Đội ngũ Aura',
  'admin-packages': 'Gói tập & Dịch vụ Gym',
  'admin-quotes': 'Báo giá & Chốt hợp đồng',
  'admin-schedule-settings': 'Cấu hình lịch & Ca làm việc',
  'admin-courses': 'Khóa học Academy',
  'admin-course-editor': 'Course Studio',
  'admin-academy-students': 'Học viên Academy',
  'admin-programs': 'Kho giáo án PT Online',
  'admin-students': 'Khách hàng PT Online',
  'admin-roles': 'Đội ngũ Aura',
  'admin-nutrition-reviews': 'Duyệt ăn',
  'admin-eat-clean': 'Vận hành Eat Clean',
  'admin-notifications': 'Cài đặt Push Notifications',
  'progress-photo-studio': 'Thêm ảnh tiến độ',
}

function isNavigationActive(view: ViewId, itemId: ViewId, mobile = false) {
  if (view === itemId) return true
  if (['staff-schedule', 'staff-availability', 'staff-requests'].includes(view) && itemId === 'staff-schedule') return true
  if (view === 'admin-today-sessions' && itemId === 'admin-dashboard') return true
  if (view === 'course-detail' && itemId === 'courses') return true
  if (view === 'admin-course-editor' && itemId === 'admin-courses') return true
  if (mobile && view === 'student-availability' && itemId === 'schedule') return true
  if (mobile && view === 'eat-clean' && itemId === 'nutrition') return true
  return false
}

export default function AppShell({ children, mode, view, onNavigate, onModeChange, mobileMenu, setMobileMenu, userName, userRole, role, setPreviewRole, userPhoto, backendMode, isStaffWorkspace = false, staffPositions = [], onSignOut, onSearch, canNavigate = () => true, authorizationError, aiCoachConversationScope = 'progress-demo', aiCoachLearningContext = null }: AppShellProps) {
  const allowedStaffRoutes = staffRouteSet(staffPositions, role)
  const navSections: ShellNavSection[] = isStaffWorkspace
    ? staffNavSections
      .map((section) => ({ ...section, items: section.items.filter((item) => allowedStaffRoutes.has(item.id) && canNavigate(item.id)) }))
      .filter((section) => section.items.length > 0)
    : mode === 'student'
      ? studentNavSections
        .map((section) => ({ ...section, items: section.items.filter((item) => canNavigate(item.id)) }))
        .filter((section) => section.items.length > 0)
    : adminNavSections
      .map((section) => ({
        ...section,
        items: section.items.filter((item) => hasPermission(role, item.permission)),
      }))
      .filter((section) => section.items.length > 0)
  const mobileAdminItems = adminMobileNav.filter((item) => hasPermission(role, item.permission) && canNavigate(item.id))
  const mobileStaffItems = staffMobileNav.filter((item) => allowedStaffRoutes.has(item.id) && canNavigate(item.id)).slice(0, 6)
  const isImmersive = view === 'workout' || view === 'delivery' || view === 'course-detail' || view === 'student-360'
  const [searchQuery, setSearchQuery] = useState('')
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false)
  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const [online, setOnline] = useState(navigator.onLine)
  const [mobileDockHidden, setMobileDockHidden] = useState(false)
  const [aiCoachOpen, setAiCoachOpen] = useState(false)
  const mobileSearchInputRef = useRef<HTMLInputElement>(null)
  const lastScrollYRef = useRef(0)
  const currentMonth = new Intl.DateTimeFormat('vi-VN', { month: 'numeric' }).format(new Date())
  const showAiCoach = mode === 'student' && !isStaffWorkspace
  // Progress already has a contextual AI Coach action in its header. Keep a
  // single launcher there while preserving an open global conversation when
  // the member navigates into the page.
  const showAiCoachLauncher = showAiCoach && view !== 'progress'

  useEffect(() => {
    if (!showAiCoach) setAiCoachOpen(false)
  }, [showAiCoach])

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
    setMobileDockHidden(false)
    lastScrollYRef.current = Math.max(0, window.scrollY)
  }, [view])

  useEffect(() => {
    let frame = 0
    const handleScroll = () => {
      if (frame) return
      frame = window.requestAnimationFrame(() => {
        frame = 0
        const current = Math.max(0, window.scrollY)
        const delta = current - lastScrollYRef.current
        if (current < 56) setMobileDockHidden(false)
        else if (delta > 7) setMobileDockHidden(true)
        else if (delta < -5) setMobileDockHidden(false)
        lastScrollYRef.current = current
      })
    }
    window.addEventListener('scroll', handleScroll, { passive: true })
    return () => {
      window.removeEventListener('scroll', handleScroll)
      if (frame) window.cancelAnimationFrame(frame)
    }
  }, [])

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

  const aiCoachSurface = showAiCoach ? (
    <>
      {showAiCoachLauncher && (
        <button
          type="button"
          className={`ai-coach-global-launcher${aiCoachOpen ? ' is-open' : ''}`}
          data-testid="ai-coach-launcher"
          aria-label="Mở Aura Health Coach"
          aria-expanded={aiCoachOpen}
          onClick={() => setAiCoachOpen(true)}
        >
          <span className="ai-coach-global-launcher__orb" aria-hidden="true"><Bot size={20} /></span>
          <span className="ai-coach-global-launcher__copy">
            <strong>Aura Coach</strong>
            <small>Hỏi nhanh về dinh dưỡng</small>
          </span>
          <span className="ai-coach-global-launcher__status" aria-hidden="true" />
        </button>
      )}
      {aiCoachOpen && (
        <Suspense fallback={null}>
          <AiCoachBottomSheet
            onClose={() => setAiCoachOpen(false)}
            conversationScope={aiCoachConversationScope}
            learningContext={aiCoachLearningContext}
          />
        </Suspense>
      )}
    </>
  ) : null

  if (isImmersive) return <>{children}{aiCoachSurface}</>

  return (
    <div className={`app-shell ${mode}`} data-view={view}>
      <a className="skip-link" href="#main-content">Bỏ qua điều hướng</a>
      <aside id="app-sidebar" className={`sidebar ${mobileMenu ? 'open' : ''}`}>
        <button className="brand" type="button" aria-label="Về trang chính" onClick={() => { onNavigate(isStaffWorkspace ? 'staff-dashboard' : mode === 'student' ? 'home' : 'admin-dashboard'); setMobileMenu(false) }}>
          <div className="brand-mark">A<span /></div>
          <div><strong>AURA</strong><small>FITNESS</small></div>
        </button>
        <button className="sidebar-close" aria-label="Đóng menu" onClick={() => setMobileMenu(false)}><X size={22} /></button>

        <nav className="sidebar-nav" aria-label="Điều hướng chính">
          {navSections.map((section, sectionIdx) => (
            <div className="sidebar-nav__section" key={section.label || `section-${sectionIdx}`}>
              {section.label ? <p>{section.label}</p> : null}
              {section.items.filter((item) => canNavigate(item.id)).map((item) => {
                const Icon = item.icon
                const active = isNavigationActive(view, item.id)
                return (
                  <button 
                    key={item.id} 
                    className={active ? 'active' : ''} 
                    aria-current={active ? 'page' : undefined} 
                    title={item.label} 
                    onMouseEnter={() => prefetchRoute(item.id)}
                    onTouchStart={() => prefetchRoute(item.id)}
                    onClick={() => { onNavigate(item.id); setMobileMenu(false) }}
                  >
                    <Icon size={20} /><span>{item.label}</span>{active && <i />}
                  </button>
                )
              })}
            </div>
          ))}
        </nav>

        {mode === 'student' && !isStaffWorkspace && backendMode === 'demo' && (
          <div className="sidebar-challenge">
            <div className="challenge-icon"><Sparkles size={19} /></div>
            <strong>Mục tiêu mẫu tháng {currentMonth}</strong>
            <span>Còn 3 buổi để nhận huy hiệu</span>
            <div><i style={{ width: '70%' }} /></div>
            <small>BẢN XEM TRƯỚC · 7/10</small>
          </div>
        )}

        <div className="sidebar-bottom">
          {(role === 'admin' || role === 'super_admin') && <button className="mode-switch" onClick={() => onModeChange(mode === 'student' ? 'admin' : 'student')}>
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
            <small>{isStaffWorkspace ? 'AURA STAFF' : mode === 'student' ? 'AURA FITNESS' : 'AURA OPERATIONS'}</small>
            <strong>{viewTitles[view] ?? 'Aura Fitness'}</strong>
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
                    {backendMode === 'demo' && (
                      <>
                    
                    <strong className="dropdown-label">Xem trước giao diện</strong>
                    <button className={role === 'student' ? 'active' : ''} onClick={() => { setPreviewRole?.('student'); setUserMenuOpen(false); }}>
                      <span>Học viên</span>
                      {role === 'student' && <Check size={14} />}
                    </button>
                    <button className={role === 'trainer' ? 'active' : ''} onClick={() => { setPreviewRole?.('trainer'); setUserMenuOpen(false); }}>
                      <span>PT Gym</span>
                      {role === 'trainer' && <Check size={14} />}
                    </button>
                    <button className={role === 'coach' ? 'active' : ''} onClick={() => { setPreviewRole?.('coach'); setUserMenuOpen(false); }}>
                      <span>HLV Online</span>
                      {role === 'coach' && <Check size={14} />}
                    </button>
                    <button className={role === 'sales' ? 'active' : ''} onClick={() => { setPreviewRole?.('sales'); setUserMenuOpen(false); }}>
                      <span>Sales</span>
                      {role === 'sales' && <Check size={14} />}
                    </button>
                    <button className={role === 'manager' ? 'active' : ''} onClick={() => { setPreviewRole?.('manager'); setUserMenuOpen(false); }}>
                      <span>Quản lý chi nhánh</span>
                      {role === 'manager' && <Check size={14} />}
                    </button>
                    <button className={role === 'editor' ? 'active' : ''} onClick={() => { setPreviewRole?.('editor'); setUserMenuOpen(false); }}>
                      <span>Biên tập Academy</span>
                      {role === 'editor' && <Check size={14} />}
                    </button>
                    <button className={role === 'admin' ? 'active' : ''} onClick={() => { setPreviewRole?.('admin'); setUserMenuOpen(false); }}>
                      <span>Admin</span>
                      {role === 'admin' && <Check size={14} />}
                    </button>
                      </>
                    )}
                    
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
        {authorizationError && <div className="offline-banner" role="alert"><ShieldCheck size={15} /> {authorizationError}</div>}
        <main id="main-content" className="page-content" tabIndex={-1}>{children}</main>

        {mode === 'student' || isStaffWorkspace ? (
          <nav className={`mobile-bottom-nav student-mobile-nav${isStaffWorkspace ? ' staff-mobile-nav' : ''}${mobileDockHidden ? ' is-scroll-hidden' : ''}`} aria-label={isStaffWorkspace ? 'Điều hướng Staff' : 'Điều hướng học viên'}>
            {(isStaffWorkspace ? mobileStaffItems : studentMobileNav.filter((item) => canNavigate(item.id))).map((item) => {
              const Icon = item.icon
              const active = isNavigationActive(view, item.id, true)
              return (
                <button 
                  key={item.id} 
                  className={active ? 'active' : ''} 
                  aria-current={active ? 'page' : undefined} 
                  onTouchStart={() => prefetchRoute(item.id)}
                  onMouseEnter={() => prefetchRoute(item.id)}
                  onClick={() => onNavigate(item.id)}
                >
                  <Icon size={21} /><span>{item.label}</span>
                </button>
              )
            })}
          </nav>
        ) : (
          <nav className={`mobile-bottom-nav admin-mobile-nav${mobileDockHidden ? ' is-scroll-hidden' : ''}`} aria-label="Điều hướng quản trị">
            {mobileAdminItems.map((item) => {
              const Icon = item.icon
              const active = isNavigationActive(view, item.id, true)
              return (
                <button 
                  key={item.id} 
                  className={active ? 'active' : ''} 
                  aria-current={active ? 'page' : undefined} 
                  onTouchStart={() => prefetchRoute(item.id)}
                  onMouseEnter={() => prefetchRoute(item.id)}
                  onClick={() => onNavigate(item.id)}
                >
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
      {aiCoachSurface}
    </div>
  )
}
