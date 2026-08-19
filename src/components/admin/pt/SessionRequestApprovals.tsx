import React, { useState } from 'react';
import { Student, StudentContract, Session, SessionRequest } from '../../../types';
import { useDatabase } from '../../../contexts/DatabaseContext';
import { Check, X, Calendar as CalendarIcon, Clock, CalendarClock } from 'lucide-react';

interface Props {
  students: Student[];
  contracts: StudentContract[];
  sessions: Session[];
}

export default function SessionRequestApprovals({ students, contracts, sessions }: Props) {
  const { sessionRequests, updateSessionRequest, deleteSession, addSession, updateSession, updateContract } = useDatabase();
  const [processingId, setProcessingId] = useState<string | null>(null);

  const pendingRequests = sessionRequests?.filter(r => r.status === 'pending' && students.some(s => s.id === r.studentId)) || [];

  if (pendingRequests.length === 0) return null;

  const handleApprove = async (request: SessionRequest) => {
    if (!confirm('Xác nhận duyệt yêu cầu đổi/huỷ lịch này? Hệ thống sẽ cập nhật hoặc xoá buổi tập tương ứng.')) return;
    
    // Check auto extend contract
    let daysToExtend = 0;
    if (request.type === 'cancel') {
      const daysStr = prompt('Tính năng Tự Động Gia Hạn Hợp Đồng:\n\nHọc viên huỷ 1 buổi tập, bạn có muốn cộng thêm vài ngày vào hạn hợp đồng để bù không?\n\nNhập số ngày muốn cộng thêm (ví dụ 2 hoặc 3).\nNhập 0 nếu KHÔNG muốn cộng.', '2');
      if (daysStr !== null) {
        daysToExtend = parseInt(daysStr, 10) || 0;
      }
    }

    setProcessingId(request.id);

    try {
      if (request.type === 'cancel') {
        if (request.sessionId) {
          const session = sessions.find(s => s.id === request.sessionId);
          if (session) {
            await updateSession({
              ...session,
              status: 'canceled_by_student'
            });
          }
        }
        
        // Auto extend contract
        if (daysToExtend > 0 && request.contractId) {
          const contract = contracts.find(c => c.id === request.contractId);
          if (contract) {
            const oldEndDate = contract.endDate;
            const newEndDateDate = new Date(oldEndDate);
            newEndDateDate.setDate(newEndDateDate.getDate() + daysToExtend);
            
            const extensionRecord = {
              id: Date.now().toString(),
              oldEndDate: oldEndDate,
              newEndDate: newEndDateDate.toISOString(),
              reason: `Bù thời gian nghỉ 1 buổi tập ngày ${new Date(request.originalDate).toLocaleDateString('vi-VN')} (Báo nghỉ duyệt bởi admin)`,
              createdAt: new Date().toISOString()
            };
      
            await updateContract({
              ...contract,
              endDate: extensionRecord.newEndDate,
              extensions: [...(contract.extensions || []), extensionRecord]
            });
          }
        }
      } else if (request.type === 'reschedule') {
        if (request.sessionId) {
          const session = sessions.find(s => s.id === request.sessionId);
          if (session && request.newDate && request.newHour !== undefined) {
             await updateSession({
              ...session,
              date: request.newDate + 'T00:00:00.000Z',
              hour: request.newHour,
              status: 'scheduled'
            });
          }
        }
      }

      await updateSessionRequest({
        ...request,
        status: 'approved'
      });
      alert('Đã duyệt thành công!');
    } catch (e) {
      console.error(e);
      alert('Có lỗi xảy ra khi duyệt: ' + (e as Error).message);
    } finally {
      setProcessingId(null);
    }
  };

  const handleReject = async (request: SessionRequest) => {
    const reason = prompt('Lý do từ chối:');
    if (reason === null) return;
    
    setProcessingId(request.id);
    try {
      await updateSessionRequest({
        ...request,
        status: 'rejected',
        adminNote: reason
      });
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
          
          return (
            <div key={request.id} className="bg-zinc-900 border border-pink-500/30 rounded-2xl p-4 shadow-sm relative overflow-hidden">
              <div className="absolute top-0 right-0 w-16 h-16 bg-pink-500/10 rounded-bl-full -z-10" />
              
              <div className="flex justify-between items-start mb-3">
                <div>
                  <h3 className="text-white font-medium">{student?.name || 'Học viên không xác định'}</h3>
                  <span className={`inline-block mt-1 text-[10px] uppercase tracking-wider font-bold px-2 py-0.5 rounded-full ${
                    request.type === 'cancel' ? 'bg-red-500/20 text-red-400' : 'bg-blue-500/20 text-blue-400'
                  }`}>
                    {request.type === 'cancel' ? 'Huỷ (Báo nghỉ)' : 'Dời lịch tập'}
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
              </div>

              <div className="flex gap-2">
                <button
                  onClick={() => handleApprove(request)}
                  disabled={processingId === request.id}
                  className="flex-1 bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500 hover:text-white transition-colors py-2 rounded-xl text-sm font-medium flex items-center justify-center gap-1"
                >
                  <Check className="w-4 h-4" /> Duyệt
                </button>
                <button
                  onClick={() => handleReject(request)}
                  disabled={processingId === request.id}
                  className="flex-1 bg-red-500/10 text-red-500 hover:bg-red-500 hover:text-white transition-colors py-2 rounded-xl text-sm font-medium flex items-center justify-center gap-1"
                >
                  <X className="w-4 h-4" /> Từ chối
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
