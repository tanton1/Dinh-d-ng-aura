import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import '../../src/styles-bootstrap.css'
import '../../src/features/eat-clean/EatCleanPage.css'
import { EatCleanTrackingMap } from '../../src/features/eat-clean/EatCleanTrackingMap'
import type { EatCleanOrderTracking } from '../../src/features/eat-clean/types'
import './mocks'

function App() {
  const [tracking, setTracking] = useState<EatCleanOrderTracking>((window as any).mapInitial?.tracking || {
    orderId: 'order-a', status: 'delivering', kitchenLocation: { latitude: 16.01, longitude: 108.01 },
    destination: { latitude: 16.02, longitude: 108.02 }, shipperLocation: { latitude: 16.03, longitude: 108.03 },
  })
  const [shown, setShown] = useState(true)
  useEffect(() => {
    Object.assign(window, { mapHarness: { replace: setTracking, patch: (value: Partial<EatCleanOrderTracking>) => setTracking(current => ({ ...current, ...value })), show: setShown } })
  }, [])
  return <main style={{ maxWidth: 900, margin: 'auto', padding: 12 }}><output aria-label="Fixture order">{tracking.orderId}</output>{shown && <EatCleanTrackingMap tracking={tracking} />}</main>
}
createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>)
