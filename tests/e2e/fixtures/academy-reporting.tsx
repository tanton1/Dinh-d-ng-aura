import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import FinanceManagement from '../../../src/components/admin/pt/FinanceManagement'
import AdminAcademyStudentsPage from '../../../src/pages/admin/AdminAcademyStudentsPage'
import type { UserProfile } from '../../../src/types'
import type { User } from 'firebase/auth'
import '../../../src/styles.css'

function Fixture() {
  const [owner, setOwner] = useState('admin-a')
  ;(window as Window & { reportingOwner?: string }).reportingOwner = owner
  const profile = { uid: owner, role: 'admin', authzVersion: 1 } as UserProfile
  const academy = new URLSearchParams(window.location.search).has('academy')
  return <main><button onClick={() => setOwner('admin-b')}>Đổi tài khoản</button>{academy
    ? <AdminAcademyStudentsPage users={[]} courses={[]} onManage={async () => {}} />
    : <FinanceManagement user={{ uid: owner } as User} profile={profile} />}</main>
}
createRoot(document.getElementById('root')!).render(<Fixture />)
