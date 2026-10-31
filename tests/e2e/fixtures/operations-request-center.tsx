import React, { lazy, Suspense, useState } from 'react'
import { createRoot } from 'react-dom/client'
import OperationsRequestCenter from '../../../src/components/admin/pt/OperationsRequestCenter'
import '../../../src/styles-bootstrap.css'

const StudentOffModal = lazy(() => import('../../../src/components/admin/pt/StudentOffModal'))

function Fixture() {
  const [kind, setKind] = useState<'pause' | 'session'>('pause')
  const [creatingOff, setCreatingOff] = useState(false)
  Object.assign(window, { switchOperationsKind: setKind })
  return <><nav><button onClick={() => setKind('pause')}>Chọn OFF</button><button onClick={() => setKind('session')}>Chọn đổi hủy</button><button onClick={() => setCreatingOff(true)}>Tạo OFF thử</button></nav><OperationsRequestCenter kind={kind} />{creatingOff && <Suspense><StudentOffModal contractId="contract" onClose={() => setCreatingOff(false)} onSaved={() => setCreatingOff(false)} /></Suspense>}</>
}

createRoot(document.getElementById('root')!).render(<Fixture />)
