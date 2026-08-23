import React, { useState } from 'react';
import { Student, StudentContract, Session, SessionRequest } from '../../../types';
import { useDatabase } from '../../../contexts/DatabaseContext';
import { Check, X, CalendarClock } from 'lucide-react';
import { doc, getDoc } from 'firebase/firestore';
import { approveSessionRequest, rejectSessionRequest } from '../../../services/sessionOperationsService';
import { db } from '../../../lib/firebase';

interface Props {
  students: Student[];
  contracts: StudentContract[];
  sessions: Session[];
  canManage: boolean;
}

export default function SessionRequestApprovals({ students, sessions, canManage }: Props) {
  const { sessionRequests } = useDatabase();
  const [processingId, setProcessingId] = useState<string | null>(null);
  const permissionMessage = 'Bạn chỉ có quyền xem yêu cầu lịch. Chỉ quản trị viên vận hành mới có thể duyệt hoặc từ chối.';

  const pendingRequests = sessionRequests?.filter(r => r.status === 'pending' && students.some(s => s.id === r.studentId)) || [];
  const isTrainerRequest = (request: SessionRequest) => request.requestedBy === 'trainer' || (request.requestedBy !== 'student' && Boolean(request.trainerId));

  if (pendingRequests.length === 0) return null;

  const handleApprove = async (request: SessionRequest) => {
    if (!canManage) {
      alert(permissionMessage);
      return;
    }
    const requestedByTrainer = isTrainerRequest(request);
    if (!confirm(`Xác nhận duyệt yêu cầu đổi/huỷ lịch do ${requestedByTrainer ? 'HLV' : 'học viên'} tạo? Hệ thống sẽ cập nhật buổi tập qua quy trình có lưu lịch sử.`)) return;
    
    setProcessingId(request.id);

    try {
      if (!request.sessionId) throw new Error('Yêu cầu chưa liên kết với buổi tập cần xử lý.');
      const loadedSession = sessions.find(s => s.id === request.sessionId);
      let expectedSessionRevision = loadedSession ? Number(loadedSession.revision || 0) : null;
      if (expectedSessionRevision === null) {
        if (!db) throw new Error('Không thể kết nối dữ liệu buổi tập.');
        const sessionSnapshot = await getDoc(doc(db, 'sessions', request.sessionId));
        if (!sessionSnapshot.exists()) throw new Error('Không tìm thấy buổi tập cần xử lý.');
        expectedSessionRevision = Number(sessionSnapshot.data().revision || 0);
      }

      const result = await approveSessionRequest({
        requestId: request.id,
        expectedSessionRevision,
      });
      alert(result.countsTowardContract
        ? `Đã duyệt. Đây là lượt ${result.policySequence ?? 2} trong tháng nên buổi đã xếp được tính vào gói tập.`
        : requestedByTrainer
          ? 'Đã duyệt thay đổi do PT đề nghị; học viên không bị tính buổi.'
          : 'Đã duyệt lượt miễn tính buổi trong tháng.');
    } catch (e) {
      console.error(e);
      alert('Có lỗi xảy ra khi duyệt: ' + (e as Error).message);
    } finally {
      setProcessingId(null);
    }
  };

  const handleReject = async (request: SessionRequest) => {
    if (!canManage) {
      alert(permissionMessage);
      return;
    }
    const reason = prompt('Lý do từ chối:');
    if (reason === null) return;
    if (!reason.trim()) {
      alert('Vui lòng nhập lý do từ chối.');
      return;
    }
    
    setProcessingId(request.id);
    try {
      await rejectSessionRequest({ requestId: request.id, reason });
      alert('Đã từ chối yêu cầu.');
    } catch (e) {
      console.error(e);
      alert('Có lỗi xảy ra: ' + (e as Error).message);
    } finally {
      setProcessingId(null);
    }
  };

  return (
    <div className="mb-8">
      <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
        <CalendarClock className="w-5 h-5 text-pink-500" />
        Yêu cầu Đổi/Huỷ Lịch ({pendingRequests.length})
      </h2>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {pendingRequests.map(request => {
          const student = students.find(s => s.id === request.studentId);
          const requestedByTrainer = isTrainerRequest(request);
          
          return (
            <div key={request.id} className="bg-zinc-900 border border-pink-500/30 rounded-2xl p-4 shadow-sm relative overflow-hidden">
              <div className="absolute top-0 right-0 w-16 h-16 bg-pink-500/10 rounded-bl-full -z-10" />
              
              <div className="flex justify-between items-start mb-3">
                <div>
                  <h3 className="text-white font-medium">{student?.name || 'Học viên không xác định'}</h3>
                  <span className={`inline-block mt-1 text-[10px] uppercase tracking-wider font-bold px-2 py-0.5 rounded-full ${
                    request.type === 'cancel' ? 'bg-red-500/20 text-red-400' : 'bg-blue-500/20 text-blue-400'
                  }`}>
                    {request.type === 'cancel'
                      ? requestedByTrainer ? 'HLV xin huỷ' : 'Học viên báo nghỉ'
                      : requestedByTrainer ? 'HLV xin dời lịch' : 'Học viên xin dời lịch'}
                  </span>
                </div>
              </div>

              <div className="bg-zinc-950 rounded-xl p-3 mb-4 border border-zinc-800">
                <div className="flex justify-between items-center mb-2">
                  <span className="text-xs text-zinc-500">Buổi gốc</span>
                  <span className="text-sm text-zinc-300 font-medium">
                    {new Date(request.originalDate).toLocaleDateString('vi-VN')} {request.originalHour !== undefined ? `- ${request.originalHour}:00` : ''}
                  </span>
                </div>
                {request.type === 'reschedule' && request.newDate && (
                  <div className="flex justify-between items-center mb-2 pt-2 border-t border-dashed border-zinc-800">
                    <span className="text-xs text-zinc-500">Giờ mới</span>
                    <span className="text-sm font-bold text-pink-400">
                      {new Date(request.newDate).toLocaleDateString('vi-VN')} {request.newHour !== undefined ? `- ${request.newHour}:00` : ''}
                    </span>
                  </div>
                )}
                <div className="mt-2 pt-2 border-t border-zinc-800">
                  <span className="text-xs text-zinc-500 block mb-1">Lý do:</span>
                  <p className="text-sm text-zinc-300">{request.reason}</p>
                </div>
                {!requestedByTrainer && <div className="mt-2 pt-2 border-t border-zinc-800 text-xs text-zinc-400">
                  Chính sách dự kiến: {request.expectedCountsTowardContract
                    ? `lượt ${request.expectedPolicySequence ?? 2}, có tính buổi`
                    : 'lượt miễn tính buổi của tháng'}
                </div>}
              </div>

              <div className="flex gap-2">
                <button
                  onClick={() => handleApprove(request)}
                  disabled={processingId === request.id || !canManage}
                  title={!canManage ? permissionMessage : undefined}
                  className="flex-1 bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500 hover:text-white transition-colors py-2 rounded-xl text-sm font-medium flex items-center justify-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Check className="w-4 h-4" /> Duyệt
                </button>
                <button
                  onClick={() => handleReject(request)}
                  disabled={processingId === request.id || !canManage}
                  title={!canManage ? permissionMessage : undefined}
                  className="flex-1 bg-red-500/10 text-red-500 hover:bg-red-500 hover:text-white transition-colors py-2 rounded-xl text-sm font-medium flex items-center justify-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <X className="w-4 h-4" /> Từ chối
                </button>
              </div>
              {!canManage && <p className="mt-2 text-xs text-zinc-500">{permissionMessage}</p>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
