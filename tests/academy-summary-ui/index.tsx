import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { useCourses } from '../../src/hooks/useCourses'
import { useAcademyAnalyticsSummary } from '../../src/hooks/useAcademyAnalyticsSummary'
import AdminCoursesPage from '../../src/pages/admin/AdminCoursesPage'
import { firebaseAuth, state } from './mocks'
import '../../src/styles-bootstrap.css'

function Harness() {
  const [enabled, setEnabled] = useState(!new URLSearchParams(location.search).has('disabled'))
  const [access, setAccess] = useState(1)
  const [role, setRole] = useState('admin')
  const [mode, setMode] = useState<'firebase' | 'demo'>('firebase')
  const [, render] = useState(0)
  const accessRevision = JSON.stringify([firebaseAuth.currentUser?.uid, access, role])
  const courses = useCourses(enabled && role === 'admin', true, accessRevision)
  const reads = useAcademyAnalyticsSummary({ enabled: enabled && role === 'admin', backendMode: mode, accessRevision, courses: courses.courses })
  state.renders++
  useEffect(() => { state.identities++ }, [courses.courses])
  state.refresh = reads.refresh
  state.invalidate = reads.invalidate
  state.snapshot = { analytics: reads.analytics, loading: reads.loading, asOf: reads.asOf, message: reads.message,
    titles: courses.courses.map(course => course.title), catalogError: courses.error }
  return <>
    <nav aria-label="Fixture controls">
      <button onClick={() => setEnabled(value => !value)}>Toggle route</button>
      <button onClick={() => render(value => value + 1)}>Unrelated render</button>
      <button onClick={() => { state.oldInvalidate = reads.invalidate; setAccess(value => value + 1) }}>Change authority</button>
      <button onClick={() => { state.oldInvalidate = reads.invalidate; state.switchOwner('admin-b'); render(value => value + 1) }}>Change account</button>
      <button onClick={() => { state.oldInvalidate = reads.invalidate; state.switchOwner(firebaseAuth.currentUser?.uid ?? 'admin-a'); render(value => value + 1) }}>Replace session</button>
      <button onClick={() => { state.switchOwner(null); render(value => value + 1) }}>Logout</button>
      <button onClick={() => setRole(value => value === 'admin' ? 'student' : 'admin')}>Toggle role</button>
      <button onClick={() => setMode(value => value === 'firebase' ? 'demo' : 'firebase')}>Toggle backend</button>
    </nav>
    <p role="status">{reads.message}</p>
    <button disabled={reads.loading || courses.loading} onClick={reads.refresh}>Làm mới số liệu</button>
    <AdminCoursesPage courseItems={courses.courses} analytics={reads.analytics} analyticsComplete={reads.complete} loading={courses.loading} error={courses.error}
      canCreate={false} canEdit={false} onCreate={() => {}} onEdit={() => {}} onRetry={courses.retry} />
  </>
}
createRoot(document.getElementById('root')!).render(<StrictMode><Harness /></StrictMode>)
