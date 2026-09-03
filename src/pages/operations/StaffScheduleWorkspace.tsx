import { CalendarClock, CalendarDays, History, ShieldCheck } from 'lucide-react'
import type { ViewId } from '../../types'
import TrainerAvailabilityPage from './TrainerAvailabilityPage'
import TrainerPortalV2 from './TrainerPortalV2'
import './StaffScheduleWorkspace.css'

export type StaffScheduleTab = 'teaching' | 'availability' | 'requests'

interface Props {
  initialTab?: StaffScheduleTab
  canManageAvailability: boolean
  isDemo?: boolean
  onNavigate: (view: ViewId) => void
}

export default function StaffScheduleWorkspace({ initialTab = 'teaching', canManageAvailability, isDemo = false, onNavigate }: Props) {
  const tabs = [
    { id: 'teaching' as const, view: 'staff-schedule' as const, label: 'Lịch dạy', detail: 'Ma trận tuần', icon: CalendarDays },
    ...(canManageAvailability ? [{ id: 'availability' as const, view: 'staff-availability' as const, label: 'Lịch rảnh', detail: 'Ca có thể nhận', icon: CalendarClock }] : []),
    { id: 'requests' as const, view: 'staff-requests' as const, label: 'Yêu cầu', detail: 'Đổi và hủy', icon: History },
  ]

  return <main className="staff-schedule-workspace" data-testid="staff-schedule-workspace">
    <header className="staff-schedule-workspace__heading">
      <div><small>AURA STAFF · LỊCH LÀM VIỆC</small><h1>Lịch & yêu cầu</h1><p>Ca dạy, thời gian rảnh và thay đổi lịch được quản lý trong cùng một workspace.</p></div>
      <span><ShieldCheck size={24} /></span>
    </header>
    <nav className="staff-schedule-workspace__tabs" aria-label="Các phần lịch làm việc">
      {tabs.map(({ id, view, label, detail, icon: Icon }) => <button type="button" key={id} className={initialTab === id ? 'is-active' : ''} aria-current={initialTab === id ? 'page' : undefined} onClick={() => onNavigate(view)}><Icon size={19} /><span><strong>{label}</strong><small>{detail}</small></span></button>)}
    </nav>
    <section className="staff-schedule-workspace__content">
      {initialTab === 'teaching' && <TrainerPortalV2 section="schedule" embedded isDemo={isDemo} onNavigate={onNavigate} />}
      {initialTab === 'availability' && canManageAvailability && <TrainerAvailabilityPage embedded isDemo={isDemo} />}
      {initialTab === 'requests' && <TrainerPortalV2 section="requests" embedded isDemo={isDemo} onNavigate={onNavigate} />}
    </section>
  </main>
}
