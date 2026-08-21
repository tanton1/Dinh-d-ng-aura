import { useState } from 'react'
import type { ReactNode } from 'react'
import type { User } from 'firebase/auth'
import HRManagement from './HRManagement'
import StaffAttendancePanel from './StaffAttendancePanel'
import '../../../styles-operations-hub.css'

type TeamTab = 'team' | 'attendance' | 'access'
export default function AdminTeamHub({ user, accessPanel, initialTab = 'team' }: { user: User | null; accessPanel: ReactNode; initialTab?: TeamTab }) {
  const [tab, setTab] = useState<TeamTab>(initialTab)
  return <div className="operations-hub"><div className="admin-tabs admin-operations-tabs"><button className={tab === 'team' ? 'active' : ''} onClick={() => setTab('team')}>Nhân sự & Chi nhánh</button><button className={tab === 'attendance' ? 'active' : ''} onClick={() => setTab('attendance')}>Chấm công PT</button><button className={tab === 'access' ? 'active' : ''} onClick={() => setTab('access')}>Vai trò & Quyền</button></div>{tab === 'team' && <HRManagement user={user} />}{tab === 'attendance' && <StaffAttendancePanel />}{tab === 'access' && accessPanel}</div>
}
