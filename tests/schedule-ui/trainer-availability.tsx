import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import TrainerAvailabilityPage from '../../src/pages/operations/TrainerAvailabilityPage'
import AdminRolesPage from '../../src/pages/admin/AdminRolesPage'
import '../../src/styles-bootstrap.css'

function App() {
  const [admin, setAdmin] = useState(true)
  return <div style={{ padding: '44px 12px 0' }}><nav aria-label="Vai trò kiểm thử" style={{ position: 'fixed', top: 0, left: 0, right: 0, zIndex: 10000, background: 'white', padding: 8 }}><button onClick={() => setAdmin(true)}>Mở đội ngũ Aura</button><button onClick={() => setAdmin(false)}>Mở lịch PT</button></nav>{admin
    ? <AdminRolesPage users={[]} currentRole="admin" currentUserUid="admin" onRoleChange={() => {}} />
    : <TrainerAvailabilityPage />}</div>
}
createRoot(document.getElementById('root')!).render(<App />)
