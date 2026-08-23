import { useState } from 'react'
import { CalendarRange, Check, Clock3, Package, X } from 'lucide-react'
import type { LeaveRequest, Student, StudentContract } from '../../../types'
import { approveContractPauseRequest, rejectContractPauseRequest } from '../../../services/sessionOperationsService'

interface Props {
  leaveRequests: LeaveRequest[]
  students: Student[]
  contracts: StudentContract[]
  canManage: boolean
}

function requestDurationDays(request: LeaveRequest) {
  return Math.max(1, Math.ceil((new Date(request.endDate).getTime() - new Date(request.startDate).getTime()) / 86_400_000) + 1)
}

function requestKind(request: LeaveRequest): 'off' | 'preservation' {
  return request.type === 'preservation' || (!request.type && requestDurationDays(request) > 14) ? 'preservation' : 'off'
}

export default function LeaveApprovals({ leaveRequests, students, contracts, canManage }: Props) {
  const [processingId, setProcessingId] = useState<string | null>(null)
  const permissionMessage = 'Chỉ quản trị viên vận hành được xử lý OFF hoặc bảo lưu.'
  const pendingRequests = leaveRequests.filter((request) => request.status === 'pending' && students.some((student) => student.id === request.studentId))

  const handleApprove = async (request: LeaveRequest) => {
    if (!canManage) return alert(permissionMessage)
    const label = requestKind(request) === 'preservation' ? 'bảo lưu' : 'OFF'
    if (!confirm(`Duyệt ${label} từ ${request.startDate} đến ${request.endDate}? Các ca trùng sẽ được hủy miễn tính buổi và ngày hợp đồng được cộng tương ứng.`)) return
    setProcessingId(request.id)
    try {
      const result = await approveContractPauseRequest(request.id)
      alert(`Đã duyệt ${label} ${result.durationDays} ngày, cộng hạn hợp đồng đến ${new Date(result.newEndDate).toLocaleDateString('vi-VN')} và xử lý ${result.cancelledSessionCount} ca trùng.`)
    } catch (caught) { alert('Chưa thể duyệt: ' + (caught instanceof Error ? caught.message : 'Lỗi không xác định')) }
    finally { setProcessingId(null) }
  }

  const handleReject = async (request: LeaveRequest) => {
    if (!canManage) return alert(permissionMessage)
    const reason = prompt('Lý do từ chối:')
    if (reason === null) return
    setProcessingId(request.id)
    try { await rejectContractPauseRequest(request.id, reason.trim() || 'Không đáp ứng chính sách vận hành'); alert('Đã từ chối yêu cầu.') }
    catch (caught) { alert('Chưa thể từ chối: ' + (caught instanceof Error ? caught.message : 'Lỗi không xác định')) }
    finally { setProcessingId(null) }
  }

  if (!pendingRequests.length) return <div className="schedule-request-empty"><CalendarRange size={28} /><strong>Không có OFF/Bảo lưu chờ duyệt</strong><span>Yêu cầu mới của học viên sẽ xuất hiện tại đây.</span></div>

  return <div className="schedule-request-list">
    {pendingRequests.map((request) => {
      const student = students.find((item) => item.id === request.studentId)
      const contract = contracts.find((item) => item.id === request.contractId)
      const kind = requestKind(request)
      const duration = requestDurationDays(request)
      const isBusy = processingId === request.id
      return <article className="schedule-request-card" key={request.id}>
        <header><span className={`schedule-request-kind is-${kind}`}>{kind === 'preservation' ? 'Bảo lưu' : 'OFF'}</span><span className="schedule-request-source"><Clock3 size={13} /> {duration} ngày</span></header>
        <h3>{student?.name || 'Học viên chưa xác định'}</h3>
        <p className="schedule-request-package"><Package size={14} /> {contract?.packageName || 'Hợp đồng chưa xác định'}</p>
        <div className="schedule-request-slots"><span><CalendarRange size={15} /><small>Từ ngày</small><strong>{new Date(`${request.startDate}T00:00:00+07:00`).toLocaleDateString('vi-VN')}</strong></span><span className="is-new"><CalendarRange size={15} /><small>Đến ngày</small><strong>{new Date(`${request.endDate}T00:00:00+07:00`).toLocaleDateString('vi-VN')}</strong></span></div>
        <p>{request.reason}</p>
        <aside>Được duyệt sẽ cộng +{duration} ngày vào hạn hợp đồng và không trừ các ca trùng.</aside>
        <footer><button type="button" className="is-approve" disabled={isBusy || !canManage} onClick={() => void handleApprove(request)}><Check size={16} /> Duyệt</button><button type="button" className="is-reject" disabled={isBusy || !canManage} onClick={() => void handleReject(request)}><X size={16} /> Từ chối</button></footer>
      </article>
    })}
  </div>
}
