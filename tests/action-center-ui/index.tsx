import { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import OperationalActionCenter from '../../src/components/operations/OperationalActionCenter'
import './mocks'
function App() {
  const [shown, setShown] = useState(true)
  return <><button onClick={() => setShown(!shown)}>{shown ? 'Hide panel' : 'Show panel'}</button><button onClick={() => { (window as any).fixtureUid = 'account-b'; window.dispatchEvent(new Event('fixture-account')) }}>Account B</button><div style={{ height: 1100 }}>Dashboard top</div>{shown && <OperationalActionCenter />}</>
}
createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>)
