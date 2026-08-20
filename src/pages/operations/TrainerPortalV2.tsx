import { useCallback, useEffect, useMemo, useState } from 'react'
import { confirmMySession, listMyAssignedStudents, listMyTrainerSchedule, type TrainerSessionSummary, type TrainerStudentSummary } from '../../services/ptOperationsV2Service'
import './OperationsPortalV2.css'

function dateString(date: Date) { return date.toISOString().slice(0, 10) }

export default function TrainerPortalV2({ initialTab = 'students' }: { initialTab?: 'students' | 'schedule' }) {
  const [tab, setTab] = useState(initialTab)
  const [students, setStudents] = useState<TrainerStudentSummary[]>([])
  const [sessions, setSessions] = useState<TrainerSessionSummary[]>([])
  const [from, setFrom] = useState(dateString(new Date()))
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const to = useMemo(() => { const date = new Date(`${from}T00:00:00`); date.setDate(date.getDate() + 14); return dateString(date) }, [from])

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const [studentResult, scheduleResult] = await Promise.all([listMyAssignedStudents(), listMyTrainerSchedule(from, to)])
      setStudents(studentResult.students); setSessions(scheduleResult.sessions)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Không thể tải dữ liệu được phân công.') }
    finally { setLoading(false) }
  }, [from, to])
  useEffect(() => { void load() }, [load])

  const confirm = async (session: TrainerSessionSummary) => {
    try { await confirmMySession(session.id, Number(session.revision || 0)); await load() }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Không thể xác nhận buổi tập.') }
  }

  return <main className="opv2-page">
    <section className="opv2-hero"><p className="opv2-kicker">Aura PT · Phạm vi cá nhân</p><h1>Cổng làm việc HLV</h1><p>Chỉ hiển thị học viên và lịch được backend xác nhận là thuộc phạm vi của bạn.</p></section>
    <div className="opv2-tabs"><button className={`opv2-tab ${tab === 'students' ? 'is-active' : ''}`} onClick={() => setTab('students')}>Học viên của tôi</button><button className={`opv2-tab ${tab === 'schedule' ? 'is-active' : ''}`} onClick={() => setTab('schedule')}>Lịch 14 ngày</button></div>
    <section className="opv2-summary"><div className="opv2-stat"><strong>{students.length}</strong><span>học viên được giao</span></div><div className="opv2-stat"><strong>{sessions.length}</strong><span>buổi trong 14 ngày</span></div></section>
    {loading && <div className="opv2-state">Đang đồng bộ phạm vi làm việc…</div>}
    {error && <div className="opv2-state is-error">{error}<button className="opv2-action" onClick={() => void load()}>Thử lại</button></div>}
    {!loading && !error && tab === 'students' && <><h2 className="opv2-section-title">Học viên được phân công</h2><div className="opv2-list">{students.map((student) => <article className="opv2-card" key={student.id}><div className="opv2-card-head"><div><h3>{student.name}</h3><p>{student.phone || 'Chưa có số điện thoại'}</p></div><span className="opv2-badge">{student.status}</span></div><p>Hợp đồng: {student.contract ? `${student.contract.usedSessions}/${student.contract.totalSessions} buổi` : 'Chưa có'}</p></article>)}{students.length === 0 && <div className="opv2-state">Chưa có học viên được phân công.</div>}</div></>}
    {!loading && !error && tab === 'schedule' && <><div className="opv2-toolbar"><h2 className="opv2-section-title">Lịch sắp tới</h2><input className="opv2-date" type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></div><div className="opv2-list">{sessions.map((session) => <article className="opv2-card" key={session.id}><div className="opv2-card-head"><div><h3>{session.date} · {String(session.hour ?? '--').padStart(2, '0')}:00</h3><p>Mã học viên: {session.studentId}</p></div><span className="opv2-badge">{session.status}</span></div><button className="opv2-action" disabled={!['scheduled', 'rescheduled'].includes(session.status)} onClick={() => void confirm(session)}>Xác nhận đã tập</button></article>)}{sessions.length === 0 && <div className="opv2-state">Không có buổi tập trong khoảng này.</div>}</div></>}
  </main>
}
