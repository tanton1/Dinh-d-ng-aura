import { createRoot } from 'react-dom/client'
import { StrictMode } from 'react'
import { useWorkspaceAccountId } from '../../src/hooks/useWorkspaceSync'
import HomePage from '../../src/pages/student/HomePage'
import SchedulePage from '../../src/pages/student/SchedulePage'
import TrainerPortalV2 from '../../src/pages/operations/TrainerPortalV2'
import StudentAvailabilityPage from '../../src/pages/student/StudentAvailabilityPage'
function Fixture() {
  const uid = useWorkspaceAccountId()
  const screen = new URLSearchParams(location.search).get('screen')
  if (screen === 'home') return <HomePage isDemo={false} ownerId={uid} courseItems={[]} progressItems={[]} onOpenCourse={() => {}} onNavigate={() => {}} />
  if (screen === 'trainer') return <TrainerPortalV2 section="schedule" />
  if (screen === 'availability') return <StudentAvailabilityPage onNavigate={() => {}} />
  return <SchedulePage ownerId={uid} onNavigate={() => {}} />
}
createRoot(document.getElementById('root')!).render(<StrictMode><Fixture /></StrictMode>)
