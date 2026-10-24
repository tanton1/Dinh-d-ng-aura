import { StrictMode, useEffect, useState } from 'react'
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

window.location.hash = '#/admin-training-history'
createRoot(document.getElementById('root')!).render(<StrictMode><DatabaseProvider><App /></DatabaseProvider></StrictMode>)
