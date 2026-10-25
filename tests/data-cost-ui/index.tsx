import { StrictMode, useState } from 'react'
import '../../src/styles-bootstrap.css'
import { DEFAULT_PROFILE } from '../../src/features/nutrition/profileDefaults'
import { firebaseAuth } from './mocks'
import { createRoot } from 'react-dom/client'
import DeliveryPage from '../../src/features/delivery/DeliveryPage'
import { EatCleanDispatchTab } from '../../src/features/eat-clean/admin/components/EatCleanDispatchTab'
import AdminEatCleanPage from '../../src/features/eat-clean/admin/AdminEatCleanPage'
import type { UserRole } from '../../src/types'
import { EatCleanTrackingPanel } from '../../src/features/eat-clean/EatCleanTrackingPanel'
import ProgressPage from '../../src/pages/student/ProgressPage'
import { useDriverLocationPublisher as useActualLocationPublisher } from '../../src/features/delivery/useDriverLocationPublisher'
const view = new URLSearchParams(location.search).get('view')
if (view === 'gps') {
  const watches = new Map<number, PositionCallback>()
  let sequence = 0
  Object.defineProperty(navigator, 'geolocation', { configurable: true, value: {
    watchPosition: (callback: PositionCallback) => { watches.set(++sequence, callback); return sequence },
    clearWatch: (id: number) => watches.delete(id),
  } })
  Object.assign(window, {
    gpsWatchCount: () => watches.size,
    gpsEmit: (meters = 0) => watches.forEach(callback => callback({ timestamp: Date.now(), coords: { latitude: 16 + meters / 111111, longitude: 108, accuracy: 5, heading: 0, speed: 0, altitude: null, altitudeAccuracy: null } } as GeolocationPosition)),
  })
}
function Location() {
  const [id, setId] = useState<string | null>('order-a')
  const [driverId, setDriverId] = useState('driver-a')
  const [ready, setReady] = useState(true)
  const publisher = useActualLocationPublisher(id, driverId, ready)
  return <><output aria-label="GPS state">{publisher.state}</output><button onClick={publisher.start}>Start GPS</button><button onClick={publisher.stop}>Stop GPS</button><button onClick={() => setId(null)}>Complete delivery</button><button onClick={() => setDriverId('driver-b')}>Change GPS account</button><button onClick={() => setReady(false)}>Disable GPS</button></>
}
function Tracking() {
  const [id, setId] = useState('order-a')
  const [account, setAccount] = useState('owner-a')
  const fallback = (window as any).costState.trackingFallback
  return <><button onClick={() => setId('order-b')}>Change order</button><button onClick={() => { (window as any).costState.trackingAccount = 'owner-b'; setAccount('owner-b') }}>Change tracking account</button><EatCleanTrackingPanel accountId={account} order={{ id, status: 'delivering', deliveryAddress: {},
    ...(fallback ? { shipper: { displayName: 'Fallback driver' }, tracking: { orderId: id, status: 'delivering', shipper: { displayName: 'Fallback driver' }, deliveryOtp: '5678' } } : {}) } as any} /></>
}
function Driver() {
  const [account, setAccount] = useState('driver')
  return <><button onClick={() => { (window as any).costState.driverAccount = 'driver-b'; (window as any).costState.jobCode = 'ORDER-B'; setAccount('driver-b') }}>Change driver account</button><DeliveryPage driverId={account} displayName="Test driver" onSignOut={() => {}} /></>
}
function Dispatch() {
  const [account, setAccount] = useState('admin-a')
  return <><button onClick={() => { (window as any).costState.dispatchAccount = 'admin-b'; (window as any).costState.dispatchJobs = []; setAccount('admin-b') }}>Change dispatch account</button><EatCleanDispatchTab key={account} accountId={account} /></>
}
function Progress() {
  const [owner, setOwner] = useState('student-a')
  return <><button onClick={() => { firebaseAuth.currentUser.uid = 'student-b'; setOwner('student-b') }}>Change account</button><ProgressPage ownerId={owner} nutritionProfile={{ ...DEFAULT_PROFILE, age: 30, heightCm: 165, weightKg: 60, biologicalSex: 'female', goal: 'maintain', activityLevel: 'moderate', trainingSessions: 3, mealsPerDay: 5 }} /></>
}
function DispatchParent() {
  const [account, setAccount] = useState('admin-a')
  const [role, setRole] = useState<UserRole>('admin')
  return <><button onClick={() => { (window as any).costState.dispatchAccount = 'admin-b'; setAccount('admin-b') }}>Change admin account</button>
    <button onClick={() => setRole('student')}>Revoke admin</button><button onClick={() => setRole('admin')}>Restore admin</button>
    <AdminEatCleanPage accountId={account} currentRole={role} initialTab={(window as any).costState.adminInitialTab || 'dispatch'} isDemo={Boolean((window as any).costState.adminDemo)} /></>
}
createRoot(document.getElementById('root')!).render(<StrictMode>{
  view === 'gps' ? <Location /> : view === 'dispatch-parent' ? <DispatchParent /> : view === 'dispatch' ? <Dispatch /> : view === 'tracking' ? <Tracking /> : view === 'progress' ? <Progress /> : <Driver />
}</StrictMode>)
