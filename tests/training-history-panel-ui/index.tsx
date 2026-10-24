import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import TrainingHistoryPanel from '../../src/components/admin/pt/TrainingHistoryPanel'

function App() {
  const [subject, setSubject] = useState<'student' | 'trainer'>('student')
  const [subjectId, setSubjectId] = useState('student-a')
  return <main style={{ maxWidth: 1000, margin: '0 auto', padding: 12 }}>
    <nav>{['student-a', 'student-b', 'trainer-1'].map((id) => <button key={id} onClick={() => { setSubjectId(id); setSubject(id.startsWith('trainer') ? 'trainer' : 'student') }}>{id}</button>)}</nav>
    <TrainingHistoryPanel subject={subject} subjectId={subjectId} subjectName={subjectId} />
  </main>
}
createRoot(document.getElementById('root')!).render(<App />)
