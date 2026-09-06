import { createRoot } from 'react-dom/client'
import BranchScheduleWorkspace from '../../src/components/schedule/BranchScheduleWorkspace'
const accessContext = { uid: 'test-admin', accessRole: 'admin' as const, positions: [], branchIds: ['b'], capabilities: ['pt.schedule.branch.publish'], authzVersion: 1, status: 'active' as const }
createRoot(document.getElementById('root')!).render(<BranchScheduleWorkspace accessContext={accessContext} />)
