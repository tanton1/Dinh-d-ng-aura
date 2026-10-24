import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import StaffDashboardPage from '../../src/pages/operations/StaffDashboardPage'
import { useAuth } from './mocks'
import '../../src/styles.css'

function App() {
  const { accessContext } = useAuth()
  return <StaffDashboardPage capabilities={accessContext.capabilities} positions={accessContext.positions} branchCount={accessContext.branchIds.length} isDemo={(window as any).dashboardOptions?.demo} onNavigate={(view) => { (window as any).dashboardNavigation = view }} />
}
createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>)
