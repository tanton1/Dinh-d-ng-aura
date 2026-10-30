import { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import Student360Page from '../../src/features/student-360/Student360Page'
import { state } from './mocks'
function Harness() {
  const [studentId, setStudentId] = useState('A')
  const [mounted, setMounted] = useState(true)
  state.go = setStudentId
  state.unmount = () => setMounted(false)
  return mounted ? <Student360Page studentId={studentId} source="admin-pt-students" isDemo={new URLSearchParams(location.search).has('demo')} onBack={() => {}} onNavigate={(...args) => state.navigation.push(args)} /> : <p>Unmounted</p>
}
createRoot(document.getElementById('root')!).render(new URLSearchParams(location.search).has('strict') ? <StrictMode><Harness /></StrictMode> : <Harness />)
