import { StrictMode, Suspense, lazy, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { DatabaseProvider, useDatabase } from '../../src/contexts/DatabaseContext'
import StaffScheduleWorkspace, { type StaffScheduleTab } from '../../src/pages/operations/StaffScheduleWorkspace'

function Consumer() {
  const { acquireTrainingHistoryTrainerDirectory, trainers } = useDatabase()
  useEffect(() => {
    const release = acquireTrainingHistoryTrainerDirectory()
    return () => { release(); release() }
  }, [acquireTrainingHistoryTrainerDirectory])
  return <output>{trainers.map((trainer) => trainer.name).join(',')}</output>
}

const FinanceManagement = lazy(() => import('../../src/components/admin/pt/FinanceManagement'))
const financeProfile = { uid: 'admin', role: 'admin', authzVersion: 1 } as const

function FinanceApp() {
  const [details, setDetails] = useState(false)
  const [renders, setRenders] = useState(0)
  return <>
    <button onClick={() => setDetails(false)}>Overview</button>
    <button onClick={() => setDetails(false)}>Cashbook</button>
    <button onClick={() => setDetails(true)}>Ledger</button>
    <button onClick={() => setRenders(value => value + 1)}>Rerender finance {renders}</button>
    {details && <Suspense fallback={<p>Loading finance</p>}><FinanceManagement user={null} profile={financeProfile as any} /></Suspense>}
  </>
}

function App() {
  const [view, setView] = useState('requests')
  const [second, setSecond] = useState(false)
  const [renders, setRenders] = useState(0)
  const [tab, setTab] = useState<StaffScheduleTab>('availability')
  return <>
    <nav>{['requests', 'pauses', 'trainer', 'student', 'staff'].map((name) => <button key={name} onClick={() => setView(name)}>{name}</button>)}</nav>
    <button onClick={() => setSecond((current) => !current)}>Second consumer</button>
    <button onClick={() => setRenders((count) => count + 1)}>Rerender {renders}</button>
    {view === 'trainer' && <Consumer />}
    {second && <Consumer />}
    {view === 'staff' && <StaffScheduleWorkspace initialTab={tab} canManageAvailability onNavigate={(route) => setTab(route === 'staff-schedule' ? 'teaching' : route === 'staff-requests' ? 'requests' : 'availability')} />}
  </>
}

const finance = new URLSearchParams(window.location.search).has('finance')
window.location.hash = finance ? '#/admin-finance' : '#/admin-training-history'
createRoot(document.getElementById('root')!).render(<StrictMode><DatabaseProvider>{finance ? <FinanceApp /> : <App />}</DatabaseProvider></StrictMode>)
