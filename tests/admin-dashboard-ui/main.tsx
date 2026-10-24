import { createRoot } from 'react-dom/client'
import AdminDashboard from '../../src/pages/admin/AdminDashboard'
import { changeAuth, changeAuthority, useAuth } from './auth'

Object.assign(window, { dashboardFixture: {
  uid: 'admin-a', calls: [], hold: [] as string[], pending: new Map(),
  changeAuth(uid: string, version = 1) { this.uid = uid; changeAuth(uid, version) },
  changeAuthority(changes: Parameters<typeof changeAuthority>[0]) { if (changes.userUid) this.uid = changes.userUid; changeAuthority(changes) },
  release(id: number, reject = false) { const item = this.pending.get(id); if (!item) throw new Error(`Missing request ${id}`); this.pending.delete(id); reject ? item.reject(new Error('Late response failed')) : item.resolve(item.value) },
} })
function Fixture() {
  const auth = useAuth()
  return <AdminDashboard adminName="Admin fixture" canViewPayroll={auth.accessContext.capabilities.includes('payroll.operations.manage')} onNavigate={() => {}} />
}
createRoot(document.getElementById('root')!).render(<Fixture />)
