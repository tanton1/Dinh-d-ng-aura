import { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { User } from 'firebase/auth'
import type { UserProfile } from '../../src/types'
import FinanceManagement from '../../src/components/admin/pt/FinanceManagement'
import { state } from './mocks'
import '../../src/styles-bootstrap.css'

function Harness() {
  const [owner, setOwner] = useState('admin-a')
  const [authzVersion, setAuthzVersion] = useState(1)
  return <><button onClick={() => { state.owner = 'admin-b'; setOwner('admin-b') }}>Change account</button>
    <button onClick={() => setAuthzVersion(value => value + 1)}>Change authority</button>
    <FinanceManagement user={{ uid: owner } as User} profile={{ uid: owner, role: 'admin', authzVersion } as UserProfile} /></>
}
createRoot(document.getElementById('root')!).render(<StrictMode><Harness /></StrictMode>)
