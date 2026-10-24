import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import OperationsRequestCenter from '../../../src/components/admin/pt/OperationsRequestCenter'
import '../../../src/styles-bootstrap.css'

function Fixture() {
  const [kind, setKind] = useState<'pause' | 'session'>('pause')
  Object.assign(window, { switchOperationsKind: setKind })
  return <><nav><button onClick={() => setKind('pause')}>Chọn OFF</button><button onClick={() => setKind('session')}>Chọn đổi hủy</button></nav><OperationsRequestCenter kind={kind} /></>
}

createRoot(document.getElementById('root')!).render(<Fixture />)
