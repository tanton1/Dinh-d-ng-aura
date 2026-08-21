import { useState } from 'react'
import type { ReactNode } from 'react'
import type { User } from 'firebase/auth'
import HRManagement from './HRManagement'
import StaffAttendancePanel from './StaffAttendancePanel'
import '../../../styles-operations-hub.css'

type TeamTab = 'team' | 'attendance' | 'access'
export default function AdminTeamHub({ user, accessPanel, initialTab = 'access' }: { user: User | null; accessPanel: ReactNode; initialTab?: TeamTab }) {
  const [tab, setTab] = useState<TeamTab>(initialTab)
  return <div className="operations-hub"><div className="admin-tabs admin-operations-tabs"><button className={tab === 'access' ? 'active' : ''} onClick={() => setTab('access')}>Tài khoản, vai trò & chi nhánh</button><button className={tab === 'attendance' ? 'active' : ''} onClick={() => setTab('attendance')}>Chấm công PT</button><button className={tab === 'team' ? 'active' : ''} onClick={() => setTab('team')}>Hồ sơ PT cũ</button></div>{tab === 'access' && accessPanel}{tab === 'attendance' && <StaffAttendancePanel />}{tab === 'team' && <HRManagement user={user} manageIdentity={false} />}</div>
}
