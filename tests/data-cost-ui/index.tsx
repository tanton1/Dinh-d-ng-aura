import { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import DeliveryPage from '../../src/features/delivery/DeliveryPage'
import { EatCleanDispatchTab } from '../../src/features/eat-clean/admin/components/EatCleanDispatchTab'
import { EatCleanTrackingPanel } from '../../src/features/eat-clean/EatCleanTrackingPanel'
import ProgressPage from '../../src/pages/student/ProgressPage'
const view = new URLSearchParams(location.search).get('view')
function Tracking() {
  const [id, setId] = useState('order-a')
  return <><button onClick={() => setId('order-b')}>Change order</button><EatCleanTrackingPanel order={{ id, status: 'delivering', deliveryAddress: {} } as any} /></>
}
function Progress() {
  const [owner, setOwner] = useState('student-a')
  return <><button onClick={() => setOwner('student-b')}>Change account</button><ProgressPage ownerId={owner} /></>
}
createRoot(document.getElementById('root')!).render(<StrictMode>{
  view === 'dispatch' ? <EatCleanDispatchTab /> : view === 'tracking' ? <Tracking /> : view === 'progress' ? <Progress /> : <DeliveryPage driverId="driver" displayName="Test driver" onSignOut={() => {}} />
}</StrictMode>)
