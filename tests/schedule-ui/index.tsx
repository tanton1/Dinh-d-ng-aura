import { createRoot } from 'react-dom/client'
import BranchScheduleWorkspace from '../../src/components/schedule/BranchScheduleWorkspace'
const accessContext = { uid: 'test-admin', accessRole: 'admin' as const, positions: [], branchIds: ['b'], capabilities: ['pt.schedule.branch.publish'], authzVersion: 1, status: 'active' as const }
const root = createRoot(document.getElementById('root')!)
;(window as any).__setScheduleAccess = (updates: Partial<typeof accessContext>) => root.render(<BranchScheduleWorkspace accessContext={{ ...accessContext, ...updates }} />)
root.render(<BranchScheduleWorkspace accessContext={accessContext} />)
