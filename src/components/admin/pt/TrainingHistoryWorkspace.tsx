import { lazy, Suspense, useEffect, useState } from 'react'
import { CalendarClock, CalendarRange, Dumbbell, History, UsersRound } from 'lucide-react'
import '../../../styles-training-history-workspace.css'

const OperationsRequestCenter = lazy(() => import('./OperationsRequestCenter'))
const TrainingHistoryDirectory = lazy(() => import('./TrainingHistoryDirectory'))

type WorkspaceView = 'student' | 'trainer' | 'changes' | 'pauses' | 'requests'

function historyDeepLink() {
  const query = window.location.hash.includes('?') ? window.location.hash.split('?').slice(1).join('?') : ''
  const params = new URLSearchParams(query)
  const safeId = (value: string | null) => value && /^[A-Za-z0-9_-]+$/.test(value) ? value : ''
  const date = params.get('date') || ''
  return {
    trainerId: safeId(params.get('trainerId')),
    studentId: safeId(params.get('studentId')),
    sessionId: safeId(params.get('sessionId')),
    date: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : '',
  }
}

export default function TrainingHistoryWorkspace({ initialView = 'changes' }: { initialView?: WorkspaceView } = {}) {
  const [deepLink, setDeepLink] = useState(historyDeepLink)
  const [view, setView] = useState<WorkspaceView>(() => deepLink.trainerId ? 'trainer' : deepLink.studentId ? 'student' : initialView)
  const isHistoryView = view === 'student' || view === 'trainer'
  const subject = view === 'trainer' ? 'trainer' : 'student'

  useEffect(() => {
    const syncDeepLink = () => {
      const next = historyDeepLink()
      setDeepLink((current) => JSON.stringify(current) === JSON.stringify(next) ? current : next)
      setView(next.trainerId ? 'trainer' : next.studentId ? 'student' : initialView)
    }
    window.addEventListener('hashchange', syncDeepLink)
    return () => window.removeEventListener('hashchange', syncDeepLink)
  }, [initialView])

  useEffect(() => {
    if (!deepLink.trainerId && !deepLink.studentId) setView(initialView)
  }, [deepLink.studentId, deepLink.trainerId, initialView])

  return <div className="training-history-workspace">
    <header className="training-history-workspace__hero">
      <div><span><History size={16} /> AURA OPERATIONS · NHẬT KÝ PT</span><h1>Lịch sử tập & dạy</h1></div>
    </header>

    <div className="training-history-workspace__switch" role="tablist" aria-label="Nhật ký và yêu cầu PT">
      <button id="history-tab-changes" type="button" role="tab" aria-controls="history-workspace-panel" aria-selected={view === 'changes'} className={view === 'changes' ? 'is-active' : ''} onClick={() => setView('changes')}><CalendarClock size={18} /> Đổi / Hủy</button>
      <button id="history-tab-pauses" type="button" role="tab" aria-controls="history-workspace-panel" aria-selected={view === 'pauses'} className={view === 'pauses' ? 'is-active' : ''} onClick={() => setView('pauses')}><CalendarRange size={18} /> OFF / Bảo lưu</button>
      <button id="history-tab-student" type="button" role="tab" aria-controls="history-workspace-panel" aria-selected={view === 'student'} className={view === 'student' ? 'is-active' : ''} onClick={() => setView('student')}><UsersRound size={18} /> Lịch sử học viên</button>
      <button id="history-tab-trainer" type="button" role="tab" aria-controls="history-workspace-panel" aria-selected={view === 'trainer'} className={view === 'trainer' ? 'is-active' : ''} onClick={() => setView('trainer')}><Dumbbell size={18} /> Lịch dạy PT</button>
      <button id="history-tab-requests" type="button" role="tab" aria-controls="history-workspace-panel" aria-selected={view === 'requests'} className={view === 'requests' ? 'is-active' : ''} onClick={() => setView('requests')}><CalendarClock size={18} /> Tất cả yêu cầu</button>
    </div>

    <section id="history-workspace-panel" role="tabpanel" aria-labelledby={`history-tab-${view}`}>
      <Suspense fallback={<p className="training-history-workspace__empty" role="status">Đang mở tab…</p>}>
        {isHistoryView
          ? <TrainingHistoryDirectory key={`${subject}:${subject === 'trainer' ? deepLink.trainerId : deepLink.studentId}:${deepLink.sessionId}:${deepLink.date}`} subject={subject} initialSubjectId={subject === 'trainer' ? deepLink.trainerId : deepLink.studentId} focusSessionId={deepLink.sessionId} focusDate={deepLink.date} />
          : <main className="training-history-workspace__requests"><OperationsRequestCenter key={view} kind={view === 'changes' ? 'session' : view === 'pauses' ? 'pause' : 'all'} /></main>}
      </Suspense>
    </section>
  </div>
}
