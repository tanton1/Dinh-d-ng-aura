import { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import AdminNotificationsPage from '../../src/pages/admin/AdminNotificationsPage'
import { state, usersFor } from './mocks'
import '../../src/styles-bootstrap.css'

function Harness() {
  const [owner, setOwner] = useState('admin-a')
  const [authzVersion, setAuthzVersion] = useState(1)
  const [mounted, setMounted] = useState(true)
  const supplied = new URLSearchParams(location.search).has('supplied')
  return <>
    <div aria-label="Fixture controls">
      <button onClick={() => { state.owner = 'admin-b'; setOwner('admin-b') }}>Change account</button>
      <button onClick={() => { state.authzVersion++; setAuthzVersion(state.authzVersion) }}>Change authority</button>
      <button onClick={() => setMounted(false)}>Leave page</button>
    </div>
    {mounted && <AdminNotificationsPage currentUserUid={owner} authzVersion={authzVersion}
      backendMode={supplied ? 'demo' : 'firebase'} canManageUiRollout={false} {...(supplied ? { users: usersFor(owner) } : {})} />}
  </>
}

createRoot(document.getElementById('root')!).render(<StrictMode><Harness /></StrictMode>)
