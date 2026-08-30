import { useState } from 'react'
import { CalendarClock, Check, Clock3, UserRound, X } from 'lucide-react'
import { doc, getDoc } from 'firebase/firestore'
import type { Session, SessionRequest, Student, StudentContract } from '../../../types'
import { useDatabase } from '../../../contexts/DatabaseContext'
import { approveSessionRequest, rejectSessionRequest } from '../../../services/sessionOperationsService'
import { db } from '../../../lib/firebaseFirestore'

interface Props {
  students: Student[]
  contracts: StudentContract[]
  sessions: Session[]
  canManage: boolean
}

function formatSlot(date: string, hour?: number | null) {
  const label = new Intl.DateTimeFormat('vi-VN', { weekday: 'short', day: '2-digit', month: '2-digit' }).format(new Date(`${date}T00:00:00+07:00`))
  return `${label} · ${Number.isInteger(hour) ? `${String(hour).padStart(2, '0')}:00` : '--:--'}`
}

export default function SessionRequestApprovals({ students, sessions, canManage }: Props) {
  const { sessionRequests } = useDatabase()
  const [processingId, setProcessingId] = useState<string | null>(null)
  const permissionMessage = 'Chỉ quản trị viên vận hành được duyệt hoặc từ chối yêu cầu.'
  const pendingRequests = sessionRequests.filter((request) => request.status === 'pending' && students.some((student) => student.id === request.studentId))
  const isTrainerRequest = (request: SessionRequest) => request.requestedBy === 'trainer' || (request.requestedBy !== 'student' && Boolean(request.trainerId))

  const handleApprove = async (request: SessionRequest) => {
    if (!canManage) return alert(permissionMessage)
    const requestedByTrainer = isTrainerRequest(request)
    if (!confirm(`Duyệt yêu cầu ${request.type === 'cancel' ? 'hủy' : 'đổi'} lịch do ${requestedByTrainer ? 'PT' : 'học viên'} gửi?`)) return
    setProcessingId(request.id)
    try {
      if (!request.sessionId) throw new Error('Yêu cầu chưa liên kết với buổi tập.')
      const loadedSession = sessions.find((session) => session.id === request.sessionId)
      let expectedSessionRevision = loadedSession ? Number(loadedSession.revision || 0) : null
      if (expectedSessionRevision === null) {
        if (!db) throw new Error('Không thể kết nối dữ liệu buổi tập.')
        const snapshot = await getDoc(doc(db, 'sessions', request.sessionId))
        if (!snapshot.exists()) throw new Error('Không tìm thấy buổi tập cần xử lý.')
        expectedSessionRevision = Number(snapshot.data().revision || 0)
      }
      const result = await approveSessionRequest({ requestId: request.id, expectedSessionRevision })
      alert(result.countsTowardContract
        ? `Đã duyệt. Đây là lượt ${result.policySequence ?? 2} trong tháng nên buổi cũ được tính vào gói tập.`
        : requestedByTrainer ? 'Đã duyệt đề nghị của PT; học viên không bị tính lượt miễn.' : 'Đã duyệt lượt miễn tính buổi của tháng.')
    } catch (caught) {
      alert('Chưa thể duyệt: ' + (caught instanceof Error ? caught.message : 'Lỗi không xác định'))
    } finally { setProcessingId(null) }
  }

  const handleReject = async (request: SessionRequest) => {
    if (!canManage) return alert(permissionMessage)
    const reason = prompt('Lý do từ chối:')
    if (reason === null) return
    if (!reason.trim()) return alert('Vui lòng nhập lý do từ chối.')
    setProcessingId(request.id)
    try { await rejectSessionRequest({ requestId: request.id, reason: reason.trim() }); alert('Đã từ chối yêu cầu.') }
    catch (caught) { alert('Chưa thể từ chối: ' + (caught instanceof Error ? caught.message : 'Lỗi không xác định')) }
    finally { setProcessingId(null) }
  }

  if (!pendingRequests.length) return <div className="schedule-request-empty"><CalendarClock size={28} /><strong>Không có yêu cầu đổi/hủy chờ duyệt</strong><span>Yêu cầu mới từ học viên hoặc PT sẽ xuất hiện tại đây.</span></div>

  return <div className="schedule-request-list">
    {pendingRequests.map((request) => {
      const student = students.find((item) => item.id === request.studentId)
      const trainerRequest = isTrainerRequest(request)
      const isBusy = processingId === request.id
      return <article className="schedule-request-card" key={request.id}>
        <header><span className={`schedule-request-kind is-${request.type}`}>{request.type === 'cancel' ? 'Hủy buổi' : 'Đổi lịch'}</span><span className="schedule-request-source"><UserRound size={13} /> {trainerRequest ? 'PT gửi' : 'Học viên gửi'}</span></header>
        <h3>{student?.name || 'Học viên chưa xác định'}</h3>
        <div className="schedule-request-slots"><span><Clock3 size={15} /><small>Buổi gốc</small><strong>{formatSlot(request.originalDate, request.originalHour)}</strong></span>{request.type === 'reschedule' && request.newDate && <span className="is-new"><CalendarClock size={15} /><small>Đề xuất mới</small><strong>{formatSlot(request.newDate, request.newHour)}</strong></span>}</div>
        <p>{request.reason}</p>
        {!trainerRequest && <aside>{request.expectedCountsTowardContract ? `Lượt dự kiến ${request.expectedPolicySequence ?? 2}: có tính buổi` : 'Lượt miễn tính buổi trong tháng'}</aside>}
        <footer><button type="button" className="is-approve" disabled={isBusy || !canManage} onClick={() => void handleApprove(request)}><Check size={16} /> Duyệt</button><button type="button" className="is-reject" disabled={isBusy || !canManage} onClick={() => void handleReject(request)}><X size={16} /> Từ chối</button></footer>
      </article>
    })}
  </div>
}
