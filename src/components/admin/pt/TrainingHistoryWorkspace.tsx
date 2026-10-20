import { useEffect, useMemo, useRef, useState } from 'react'
import { CalendarClock, CalendarRange, Dumbbell, History, Search, UserRound, UsersRound } from 'lucide-react'
import { useDatabase } from '../../../contexts/DatabaseContext'
import { listStudent360Directory } from '../../../features/student-360/student360Service'
import type { Student360DirectoryItem } from '../../../features/student-360/types'
import OperationsRequestCenter from './OperationsRequestCenter'
import TrainingHistoryPanel from './TrainingHistoryPanel'
import '../../../styles-training-history-workspace.css'

type WorkspaceView = 'student' | 'trainer' | 'changes' | 'pauses' | 'requests'

function normalise(value: string | undefined) {
  return (value || '').trim().toLocaleLowerCase('vi-VN')
}

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

export default function TrainingHistoryWorkspace({ initialView = 'student' }: { initialView?: WorkspaceView } = {}) {
  const { trainers, operationsSync } = useDatabase()
  const [deepLink] = useState(historyDeepLink)
  const [view, setView] = useState<WorkspaceView>(() => deepLink.trainerId ? 'trainer' : deepLink.studentId ? 'student' : initialView)
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState(() => deepLink.trainerId || deepLink.studentId)
  const [directoryRows, setDirectoryRows] = useState<Student360DirectoryItem[]>([])
  const [directoryLoading, setDirectoryLoading] = useState(false)
  const [directoryError, setDirectoryError] = useState('')
  const directoryRequestRef = useRef(0)
  const subject = view === 'trainer' ? 'trainer' : 'student'
  const isHistoryView = view === 'student' || view === 'trainer'

  useEffect(() => {
    if (!isHistoryView || subject !== 'student') {
      setDirectoryRows([])
      setDirectoryLoading(false)
      setDirectoryError('')
      return
    }
    const requestId = ++directoryRequestRef.current
    const timer = window.setTimeout(() => {
      setDirectoryLoading(true)
      setDirectoryError('')
      void listStudent360Directory({ query: query.trim() || undefined, pageSize: 50 })
        .then((result) => {
          if (requestId !== directoryRequestRef.current) return
          setDirectoryRows(result.rows)
        })
        .catch((cause) => {
          if (requestId !== directoryRequestRef.current) return
          setDirectoryRows([])
          setDirectoryError(cause instanceof Error ? cause.message : 'Không thể tải danh sách học viên có buổi tập.')
        })
        .finally(() => {
          if (requestId === directoryRequestRef.current) setDirectoryLoading(false)
        })
    }, query.trim() ? 240 : 0)
    return () => window.clearTimeout(timer)
  }, [isHistoryView, query, subject])

  const entries = useMemo(() => {
    if (!isHistoryView) return []
    const source = subject === 'student'
      ? directoryRows.map((row) => ({ id: row.studentId, name: row.name, phone: row.phone, email: '', status: row.status }))
      : trainers
    const needle = normalise(query)
    return source
      .filter((entry) => entry.status !== 'inactive')
      .filter((entry) => {
        if (!needle) return true
        return [entry.name, entry.phone, entry.email, (entry as { employeeCode?: string }).employeeCode]
          .some((value) => normalise(value).includes(needle))
      })
      .sort((left, right) => (left.name || '').localeCompare(right.name || '', 'vi'))
  }, [directoryRows, isHistoryView, query, subject, trainers])

  useEffect(() => {
    setQuery('')
    setSelectedId(view === 'trainer' ? deepLink.trainerId : deepLink.studentId)
  }, [deepLink.studentId, deepLink.trainerId, view])

  useEffect(() => {
    if (!isHistoryView) return
    if (!entries.length) {
      if (operationsSync.status !== 'loading' && selectedId) setSelectedId('')
      return
    }
    if (!entries.some((entry) => entry.id === selectedId)) {
      const deepLinkedId = subject === 'trainer' ? deepLink.trainerId : deepLink.studentId
      const preferred = entries.some((entry) => entry.id === deepLinkedId)
        ? deepLinkedId
        : entries[0].id
      setSelectedId(preferred)
    }
  }, [deepLink.studentId, deepLink.trainerId, entries, isHistoryView, operationsSync.status, selectedId, subject])

  const selected = entries.find((entry) => entry.id === selectedId) || null
  const subjectCopy = subject === 'student'
    ? { singular: 'học viên', plural: 'Học viên', listTitle: 'Chọn học viên', empty: 'Không tìm thấy học viên phù hợp.' }
    : { singular: 'PT', plural: 'PT', listTitle: 'Chọn PT', empty: 'Không tìm thấy PT phù hợp.' }

  return <div className="training-history-workspace">
    <header className="training-history-workspace__hero">
      <div><span><History size={16} /> AURA OPERATIONS · NHẬT KÝ PT</span><h1>Lịch sử tập & dạy</h1></div>
      {isHistoryView && <div className="training-history-workspace__metric"><strong>{subject === 'student' ? directoryRows.length : trainers.filter((entry) => entry.status !== 'inactive').length}</strong><span>{subject === 'student' ? 'học viên có buổi tập' : 'PT đang hoạt động'}</span></div>}
    </header>

    <div className="training-history-workspace__switch" role="tablist" aria-label="Nhật ký và yêu cầu PT">
      <button type="button" role="tab" aria-selected={view === 'student'} className={view === 'student' ? 'is-active' : ''} onClick={() => setView('student')}><UsersRound size={18} /> Lịch sử học viên</button>
      <button type="button" role="tab" aria-selected={view === 'trainer'} className={view === 'trainer' ? 'is-active' : ''} onClick={() => setView('trainer')}><Dumbbell size={18} /> Lịch dạy PT</button>
      <button type="button" role="tab" aria-selected={view === 'changes'} className={view === 'changes' ? 'is-active' : ''} onClick={() => setView('changes')}><CalendarClock size={18} /> Đổi / Hủy</button>
      <button type="button" role="tab" aria-selected={view === 'pauses'} className={view === 'pauses' ? 'is-active' : ''} onClick={() => setView('pauses')}><CalendarRange size={18} /> OFF / Bảo lưu</button>
      <button type="button" role="tab" aria-selected={view === 'requests'} className={view === 'requests' ? 'is-active' : ''} onClick={() => setView('requests')}><CalendarClock size={18} /> Tất cả yêu cầu</button>
    </div>

    {isHistoryView ? <div className="training-history-workspace__layout">
      <aside className="training-history-workspace__directory" aria-label={subjectCopy.listTitle}>
        <div className="training-history-workspace__directory-head"><div><span>{subjectCopy.plural}</span><strong>{subjectCopy.listTitle}</strong></div><em>{entries.length}</em></div>
        <label className="training-history-workspace__search"><Search size={18} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={subject === 'student' ? 'Tên, SĐT hoặc email' : 'Tên, SĐT, email hoặc mã PT'} /></label>
        <div className="training-history-workspace__directory-list">
          {subject === 'student' && directoryLoading && !entries.length ? <p className="training-history-workspace__empty">Đang tải học viên có buổi tập…</p> : null}
          {subject === 'student' && directoryError ? <p className="training-history-workspace__empty">{directoryError}</p> : null}
          {subject === 'trainer' && operationsSync.status === 'loading' && !entries.length ? <p className="training-history-workspace__empty">Đang đồng bộ danh sách…</p> : null}
          {subject === 'trainer' && operationsSync.status === 'error' ? <p className="training-history-workspace__empty">Chưa thể tải danh sách. Hãy kiểm tra quyền quản trị hoặc thử lại.</p> : null}
          {!directoryError && subject === 'trainer' && !operationsSync.error && !operationsSync.status.includes('loading') && !entries.length ? <p className="training-history-workspace__empty">{subjectCopy.empty}</p> : null}
          {subject === 'student' && !directoryError && !directoryLoading && !entries.length ? <p className="training-history-workspace__empty">{subjectCopy.empty}</p> : null}
          {entries.map((entry) => <button key={entry.id} type="button" className={entry.id === selectedId ? 'is-selected' : ''} onClick={() => setSelectedId(entry.id)}><span className="training-history-workspace__avatar">{subject === 'student' ? <UserRound size={18} /> : <Dumbbell size={18} />}</span><span className="training-history-workspace__person"><strong>{entry.name || `Chưa cập nhật ${subjectCopy.singular}`}</strong><small>{entry.phone || entry.email || (entry as { employeeCode?: string }).employeeCode || `Mã ${entry.id.slice(-8)}`}</small></span></button>)}
        </div>
      </aside>
      <main className="training-history-workspace__content">{selected ? <TrainingHistoryPanel subject={subject} subjectId={selected.id} subjectName={selected.name || `Aura ${subjectCopy.singular}`} focusSessionId={(subject === 'trainer' ? selected.id === deepLink.trainerId : selected.id === deepLink.studentId) ? deepLink.sessionId : ''} focusDate={(subject === 'trainer' ? selected.id === deepLink.trainerId : selected.id === deepLink.studentId) ? deepLink.date : ''} /> : <div className="training-history-workspace__placeholder"><History size={28} /><h2>Chọn một {subjectCopy.singular}</h2><p>Danh sách bên trái giúp mở nhật ký đúng người, sau đó chọn thời gian và trạng thái cần xem.</p></div>}</main>
    </div> : <main className="training-history-workspace__requests"><OperationsRequestCenter kind="all" initialFilter={view === 'changes' ? 'session' : view === 'pauses' ? 'pause' : undefined} /></main>}
  </div>
}
