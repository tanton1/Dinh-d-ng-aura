import { useEffect, useMemo, useState } from 'react'
import { Dumbbell, History, Search, UserRound, UsersRound } from 'lucide-react'
import { useDatabase } from '../../../contexts/DatabaseContext'
import TrainingHistoryPanel from './TrainingHistoryPanel'
import '../../../styles-training-history-workspace.css'

type Subject = 'student' | 'trainer'

function normalise(value: string | undefined) {
  return (value || '').trim().toLocaleLowerCase('vi-VN')
}

export default function TrainingHistoryWorkspace() {
  const { students, trainers, operationsSync } = useDatabase()
  const [subject, setSubject] = useState<Subject>('student')
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState('')

  const entries = useMemo(() => {
    const source = subject === 'student' ? students : trainers
    const needle = normalise(query)
    return source
      .filter((entry) => entry.status !== 'inactive')
      .filter((entry) => {
        if (!needle) return true
        return [entry.name, entry.phone, entry.email, (entry as { employeeCode?: string }).employeeCode]
          .some((value) => normalise(value).includes(needle))
      })
      .sort((left, right) => (left.name || '').localeCompare(right.name || '', 'vi'))
  }, [query, students, subject, trainers])

  useEffect(() => {
    setQuery('')
    setSelectedId('')
  }, [subject])

  useEffect(() => {
    if (!entries.length) {
      if (selectedId) setSelectedId('')
      return
    }
    if (!entries.some((entry) => entry.id === selectedId)) setSelectedId(entries[0].id)
  }, [entries, selectedId])

  const selected = entries.find((entry) => entry.id === selectedId) || null
  const subjectCopy = subject === 'student'
    ? { singular: 'học viên', plural: 'Học viên', listTitle: 'Chọn học viên', empty: 'Không tìm thấy học viên phù hợp.' }
    : { singular: 'PT', plural: 'PT', listTitle: 'Chọn PT', empty: 'Không tìm thấy PT phù hợp.' }

  return (
    <div className="training-history-workspace">
      <header className="training-history-workspace__hero">
        <div>
          <span><History size={16} /> AURA OPERATIONS · NHẬT KÝ PT</span>
          <h1>Lịch sử tập & lịch dạy</h1>
          <p>Theo dõi từng buổi, điểm danh và thay đổi lịch theo khoảng thời gian — không tải toàn bộ lịch sử vào trình duyệt.</p>
        </div>
        <div className="training-history-workspace__metric">
          <strong>{subject === 'student' ? students.length : trainers.filter((entry) => entry.status !== 'inactive').length}</strong>
          <span>{subject === 'student' ? 'học viên trong danh sách' : 'PT đang hoạt động'}</span>
        </div>
      </header>

      <div className="training-history-workspace__switch" role="tablist" aria-label="Loại lịch sử">
        <button type="button" role="tab" aria-selected={subject === 'student'} className={subject === 'student' ? 'is-active' : ''} onClick={() => setSubject('student')}>
          <UsersRound size={18} /> Lịch sử tập học viên
        </button>
        <button type="button" role="tab" aria-selected={subject === 'trainer'} className={subject === 'trainer' ? 'is-active' : ''} onClick={() => setSubject('trainer')}>
          <Dumbbell size={18} /> Lịch dạy PT
        </button>
      </div>

      <div className="training-history-workspace__layout">
        <aside className="training-history-workspace__directory" aria-label={subjectCopy.listTitle}>
          <div className="training-history-workspace__directory-head">
            <div><span>{subjectCopy.plural}</span><strong>{subjectCopy.listTitle}</strong></div>
            <em>{entries.length}</em>
          </div>
          <label className="training-history-workspace__search">
            <Search size={18} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={subject === 'student' ? 'Tên, SĐT hoặc email' : 'Tên, SĐT, email hoặc mã PT'} />
          </label>
          <div className="training-history-workspace__directory-list">
            {operationsSync.status === 'loading' && !entries.length ? <p className="training-history-workspace__empty">Đang đồng bộ danh sách…</p> : null}
            {operationsSync.status === 'error' ? <p className="training-history-workspace__empty">Chưa thể tải danh sách. Hãy kiểm tra quyền quản trị hoặc thử lại.</p> : null}
            {!operationsSync.error && !operationsSync.status.includes('loading') && !entries.length ? <p className="training-history-workspace__empty">{subjectCopy.empty}</p> : null}
            {entries.map((entry) => {
              const isSelected = entry.id === selectedId
              return <button key={entry.id} type="button" className={isSelected ? 'is-selected' : ''} onClick={() => setSelectedId(entry.id)}>
                <span className="training-history-workspace__avatar">{subject === 'student' ? <UserRound size={18} /> : <Dumbbell size={18} />}</span>
                <span className="training-history-workspace__person"><strong>{entry.name || `Chưa cập nhật ${subjectCopy.singular}`}</strong><small>{entry.phone || entry.email || (entry as { employeeCode?: string }).employeeCode || `Mã ${entry.id.slice(-8)}`}</small></span>
              </button>
            })}
          </div>
        </aside>

        <main className="training-history-workspace__content">
          {selected ? <TrainingHistoryPanel subject={subject} subjectId={selected.id} subjectName={selected.name || `Aura ${subjectCopy.singular}`} /> : <div className="training-history-workspace__placeholder"><History size={28} /><h2>Chọn một {subjectCopy.singular}</h2><p>Danh sách bên trái giúp mở nhật ký đúng người, sau đó chọn thời gian và trạng thái cần xem.</p></div>}
        </main>
      </div>
    </div>
  )
}
