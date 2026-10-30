import { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { User } from 'firebase/auth'
import type { UserProfile } from '../../src/types'
import FinanceManagement from '../../src/components/admin/pt/FinanceManagement'
import AdminFinanceHub from '../../src/components/admin/pt/AdminFinanceHub'
import Student360ContractWorkspace from '../../src/features/student-360/Student360ContractWorkspace'
import CashbookPanel from '../../src/components/admin/pt/CashbookPanel'
import ContractSettlementPanel from '../../src/features/student-360/ContractSettlementPanel'
import { state } from './mocks'
import * as financeIntentStore from '../../src/services/financeOperationIntent'
import '../../src/styles-bootstrap.css'
import '../../src/styles-operations-hub.css'
import '../../src/features/student-360/Student360Page.css'
Object.assign(window, { financeIntentStore })

function Harness() {
  const [owner, setOwner] = useState('admin-a')
  const [authzVersion, setAuthzVersion] = useState(1)
  const [notice, setNotice] = useState('')
  const workspaceMode = new URLSearchParams(window.location.search).get('workspace')
  return <><button onClick={() => { state.owner = 'admin-b'; setOwner('admin-b') }}>Change account</button>
    <button onClick={() => setAuthzVersion(value => { state.authzVersion = value + 1; return value + 1 })}>Change authority</button>
    {workspaceMode === 'settlement' ? <div className="student360-page"><ContractSettlementPanel contractId="contract-a" branchId="a" onChanged={async () => { state.refreshes++ }} /></div> : workspaceMode === 'hub' ? <AdminFinanceHub user={{ uid: owner } as User} profile={{ uid: owner, role: 'admin', authzVersion } as UserProfile} /> : workspaceMode === 'store' ? <p>Intent storage fixture</p> : workspaceMode === 'cashbook' ? <CashbookPanel branches={[{ id: 'a', name: 'Branch A' }]} /> : workspaceMode === 'student' ? <div className="student360-page"><p role="status">{notice}</p><Student360ContractWorkspace studentId="student-a" overview={{ permissions: { canViewRenewal: false } } as any} source="admin" isDemo={false} onNavigate={() => {}} onChanged={async () => {}} onNotice={setNotice} /></div> : <FinanceManagement user={{ uid: owner } as User} profile={{ uid: owner, role: 'admin', authzVersion } as UserProfile} />}</>
}
createRoot(document.getElementById('root')!).render(<StrictMode><Harness /></StrictMode>)
