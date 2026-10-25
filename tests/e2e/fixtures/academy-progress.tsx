import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { useLearningProgress } from '../../../src/hooks/useLearningProgress'

function Fixture() {
  const [owner, setOwner] = useState('student-a')
  const [enabled, setEnabled] = useState(true)
  const state = useLearningProgress(owner, enabled)
  const visible = { owner, enabled, loading: state.loading, error: state.error,
    progress: state.progress.map((item) => item.userId), enrollments: state.enrollments.map((item) => item.userId) }
  const win = window as Window & { __progressRenders?: typeof visible[] }
  ;(win.__progressRenders ??= []).push(visible)
  return <>
    <button onClick={() => setOwner('student-b')}>Đổi tài khoản</button>
    <button onClick={() => setEnabled(false)}>Ẩn dữ liệu học</button>
    <button onClick={state.retry}>Thử lại dữ liệu học</button>
    <output aria-label="Dữ liệu học">{JSON.stringify(visible)}</output>
  </>
}
createRoot(document.getElementById('root')!).render(<Fixture />)
