import { createRoot } from 'react-dom/client'
import { lazy, Suspense, useEffect, useState } from 'react'
import '../../../src/styles-bootstrap.css'
import ContractRenewals from '../../../src/components/admin/pt/ContractRenewals'
import { getCurrentRoute, student360RouteHash } from '../../../src/routing/appRouting'

const Student360Page = lazy(() => import('../../../src/features/student-360/Student360Page'))
function Harness() {
  const [route, setRoute] = useState(getCurrentRoute)
  const source = new URLSearchParams(location.search).get('source') === 'staff-renewals' ? 'staff-renewals' : 'admin-renewals'
  useEffect(() => {
    const update = () => setRoute(getCurrentRoute())
    window.addEventListener('hashchange', update)
    return () => window.removeEventListener('hashchange', update)
  }, [])
  return route.view === 'student-360' && route.studentId
    ? <Suspense fallback={<p>Đang mở hồ sơ…</p>}><Student360Page studentId={route.studentId} source={route.source || source} isDemo onBack={() => { location.hash = `#/${route.source || source}` }} onNavigate={() => {}} /></Suspense>
    : <div style={{ padding: 12 }}><ContractRenewals source={source} actorId="queue-test" onOpenStudent360={(id) => { location.hash = student360RouteHash(id, source) }} /></div>
}

const root = createRoot(document.getElementById('root')!)
root.render(<Harness />)
Object.assign(window, { unmountRenewalQueue: () => root.unmount() })
