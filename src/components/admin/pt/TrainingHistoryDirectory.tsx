import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Dumbbell, History, Search, UserRound } from 'lucide-react'
import { useDatabase } from '../../../contexts/DatabaseContext'
import { listStudent360Directory } from '../../../features/student-360/student360Service'
import type { Student360DirectoryItem } from '../../../features/student-360/types'

const TrainingHistoryPanel = lazy(() => import('./TrainingHistoryPanel'))
type Person = { id: string; name: string; phone?: string; email?: string; employeeCode?: string }
type DirectoryPage = Awaited<ReturnType<typeof listStudent360Directory>>

export default function TrainingHistoryDirectory({ subject, initialSubjectId = '', focusSessionId = '', focusDate = '' }: {
  subject: 'student' | 'trainer'; initialSubjectId?: string; focusSessionId?: string; focusDate?: string
}) {
  const { trainers, operationsSync, acquireTrainingHistoryTrainerDirectory } = useDatabase()
  const [query, setQuery] = useState('')
  const [rows, setRows] = useState<Student360DirectoryItem[]>([])
  const [page, setPage] = useState<DirectoryPage | null>(null)
  const [loading, setLoading] = useState(subject === 'student')
  const [error, setError] = useState('')
  const [selected, setSelected] = useState<Person | null>(() => initialSubjectId ? { id: initialSubjectId, name: '' } : null)
  const [reload, setReload] = useState(0)
  const requestRef = useRef(0)
  const loadingRef = useRef(false)
  const failedCursorRef = useRef<string | null>(null)

  useEffect(() => {
    if (subject === 'trainer') return acquireTrainingHistoryTrainerDirectory()
  }, [acquireTrainingHistoryTrainerDirectory, subject])

  const loadDirectory = useCallback(async (cursor: string | null, requestId: number) => {
    loadingRef.current = true
    setLoading(true)
    setError('')
    try {
      const result = await listStudent360Directory({ query: query.trim() || undefined, pageSize: 50, ...(cursor ? { cursor } : {}) })
      if (requestId !== requestRef.current) return
      setPage(result)
      setRows((previous) => cursor ? [...new Map([...previous, ...result.rows].map((row) => [row.studentId, row])).values()] : result.rows)
    } catch (cause) {
      if (requestId !== requestRef.current) return
      failedCursorRef.current = cursor
      setError(cause instanceof Error ? cause.message : 'Không thể tải danh sách học viên.')
    } finally {
      if (requestId === requestRef.current) {
        loadingRef.current = false
        setLoading(false)
      }
    }
  }, [query])

  useEffect(() => {
    if (subject !== 'student') return
    const requestId = ++requestRef.current
    setRows([])
    setPage(null)
    setError('')
    setLoading(true)
    loadingRef.current = true
    const timer = window.setTimeout(() => { void loadDirectory(null, requestId) }, query.trim() ? 240 : 0)
    return () => {
      window.clearTimeout(timer)
      ++requestRef.current
    }
  }, [loadDirectory, query, reload, subject])

  const entries = useMemo<Person[]>(() => {
    if (subject === 'student') return rows.map((row) => ({ id: row.studentId, name: row.name, phone: row.phone, email: row.email }))
    const needle = query.trim().toLocaleLowerCase('vi-VN')
    return trainers.filter((entry) => entry.status !== 'inactive')
      .filter((entry) => !needle || [entry.name, entry.phone, entry.email, entry.employeeCode].some((value) => (value || '').toLocaleLowerCase('vi-VN').includes(needle)))
      .sort((left, right) => (left.name || '').localeCompare(right.name || '', 'vi'))
  }, [query, rows, subject, trainers])
  useEffect(() => {
    setSelected((current) => {
      const entry = entries.find((candidate) => candidate.id === current?.id)
      return entry && (entry.name !== current?.name || entry.phone !== current?.phone || entry.email !== current?.email || entry.employeeCode !== current?.employeeCode) ? entry : current
    })
  }, [entries])
  const selectedEntry = entries.find((entry) => entry.id === selected?.id) || selected
  const singular = subject === 'student' ? 'học viên' : 'PT'
  const directoryLoading = subject === 'student' ? loading : operationsSync.status === 'loading'
  const directoryError = subject === 'student' ? error : operationsSync.status === 'error' ? 'Chưa thể tải danh sách PT. Hãy thử mở lại tab.' : ''

  const loadMore = () => {
    if (loadingRef.current || !page?.hasMore || !page.nextCursor) return
    void loadDirectory(page.nextCursor, ++requestRef.current)
  }

  return <div className="training-history-workspace__layout">
    <aside className="training-history-workspace__directory" aria-label={`Chọn ${singular}`}>
      <div className="training-history-workspace__directory-head"><div><span>{subject === 'student' ? 'Học viên' : 'PT'}</span><strong>Chọn {singular}</strong></div><em title="Số người đã tải">{entries.length}{subject === 'student' && page?.hasMore ? '+' : ''}</em></div>
      <label className="training-history-workspace__search"><Search size={18} /><input aria-label={`Tìm ${singular}`} value={query} onChange={(event) => setQuery(event.target.value)} placeholder={subject === 'student' ? 'Tên, SĐT hoặc email' : 'Tên, SĐT, email hoặc mã PT'} /></label>
      <div className="training-history-workspace__directory-list" aria-busy={directoryLoading}>
        {entries.map((entry) => <button key={entry.id} type="button" aria-pressed={entry.id === selectedEntry?.id} className={entry.id === selectedEntry?.id ? 'is-selected' : ''} onClick={() => setSelected(entry)}><span className="training-history-workspace__avatar">{subject === 'student' ? <UserRound size={18} /> : <Dumbbell size={18} />}</span><span className="training-history-workspace__person"><strong>{entry.name || `Chưa cập nhật ${singular}`}</strong><small>{entry.phone || entry.email || entry.employeeCode || `Mã ${entry.id.slice(-8)}`}</small></span></button>)}
        {!directoryLoading && !directoryError && !entries.length ? <p className="training-history-workspace__empty">{subject === 'student' && page?.hasMore ? 'Chưa tìm thấy học viên trong phần đã tải. Hãy tải thêm hoặc đổi từ khóa.' : `Không tìm thấy ${singular} phù hợp.`}</p> : null}
      </div>
      {directoryLoading ? <p className="training-history-workspace__empty" role="status">Đang tải danh sách {singular}…</p> : null}
      {directoryError ? <div className="training-history-workspace__directory-feedback"><p role="alert">{directoryError}</p>{subject === 'student' && <button type="button" onClick={() => {
        if (loadingRef.current) return
        if (failedCursorRef.current) void loadDirectory(failedCursorRef.current, ++requestRef.current)
        else setReload((value) => value + 1)
      }}>Thử lại</button>}</div> : null}
      {subject === 'student' && page?.hasMore && page.nextCursor && !error ? <div className="training-history-workspace__directory-feedback"><button type="button" onClick={loadMore} disabled={loading}>Tải thêm học viên</button></div> : null}
      {subject === 'student' && page?.truncated ? <p className="training-history-workspace__empty">Hãy tìm theo tên, SĐT hoặc email để thu hẹp danh sách.</p> : null}
    </aside>
    <main className="training-history-workspace__content">
      {selectedEntry ? <Suspense fallback={<p className="training-history-workspace__empty" role="status">Đang mở lịch sử…</p>}><TrainingHistoryPanel key={`${subject}:${selectedEntry.id}`} subject={subject} subjectId={selectedEntry.id} subjectName={selectedEntry.name || (subject === 'student' ? 'Học viên' : 'PT')} focusSessionId={selectedEntry.id === initialSubjectId ? focusSessionId : ''} focusDate={selectedEntry.id === initialSubjectId ? focusDate : ''} /></Suspense>
        : <div className="training-history-workspace__placeholder"><History size={28} /><h2>Chọn một {singular}</h2><p>Chọn người cần xem, sau đó lọc theo thời gian và trạng thái buổi tập.</p></div>}
    </main>
  </div>
}
