import React, { useState } from 'react';
import { LeaveRequest, Student, StudentContract, Session } from '../../../types';
import { useDatabase } from '../../../contexts/DatabaseContext';
import { Check, X, Calendar as CalendarIcon, Clock } from 'lucide-react';

interface Props {
  leaveRequests: LeaveRequest[];
  students: Student[];
  contracts: StudentContract[];
}

export default function LeaveApprovals({ leaveRequests, students, contracts }: Props) {
  const { updateLeaveRequest, updateContract, deleteSession, sessions } = useDatabase();
  const [processingId, setProcessingId] = useState<string | null>(null);

  const pendingRequests = leaveRequests.filter(r => r.status === 'pending' && students.some(s => s.id === r.studentId));

  if (pendingRequests.length === 0) return null;

  const handleApprove = async (request: LeaveRequest) => {
    if (!confirm('Bạn có chắc chắn muốn duyệt đơn xin nghỉ này? Hệ thống sẽ tự gia hạn hợp đồng và xoá lịch tập trùng.')) return;
    setProcessingId(request.id);

    try {
      const contract = contracts.find(c => c.id === request.contractId);
      if (contract) {
        // Calculate days to extend
        const start = new Date(request.startDate);
        const end = new Date(request.endDate);
        const daysDiff = Math.ceil((end.getTime() - start.getTime()) / (1000 * 3600 * 24)) + 1;

        if (daysDiff > 0) {
          const currentEndDate = new Date(contract.endDate);
          currentEndDate.setDate(currentEndDate.getDate() + daysDiff);

          await updateContract({
            ...contract,
            endDate: currentEndDate.toISOString()
          });

          // Find overlapping scheduled sessions and cancel/delete them
          const overlappingSessions = sessions.filter(
            s => s.studentId === request.studentId &&
            s.status === 'scheduled' &&
            new Date(s.date) >= start &&
            new Date(s.date) <= end
          );

          for (const session of overlappingSessions) {
            await deleteSession(session.id);
          }
        }
      }

      await updateLeaveRequest({
        ...request,
        status: 'approved',
        approvedAt: new Date().toISOString()
      });
      alert('Đã duyệt xin nghỉ thành công');
    } catch (e) {
      console.error(e);
      alert('Có lỗi xảy ra khi duyệt: ' + (e as Error).message);
    } finally {
      setProcessingId(null);
    }
  };

  const handleReject = async (request: LeaveRequest) => {
    const reason = prompt('Lý do từ chối:');
    if (reason === null) return;
    
    setProcessingId(request.id);
    try {
      await updateLeaveRequest({
        ...request,
        status: 'rejected',
        adminNote: reason
      });
      alert('Đã từ chối đơn xin nghỉ.');
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
        <Clock className="w-5 h-5 text-orange-500" />
        Đơn xin nghỉ chờ duyệt ({pendingRequests.length})
      </h2>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {pendingRequests.map(request => {
          const student = students.find(s => s.id === request.studentId);
          const contract = contracts.find(c => c.id === request.contractId);
          
          return (
            <div key={request.id} className="bg-zinc-900 border border-orange-500/30 rounded-2xl p-4 shadow-sm relative overflow-hidden">
              <div className="absolute top-0 right-0 w-16 h-16 bg-orange-500/10 rounded-bl-full -z-10" />
              
              <div className="flex justify-between items-start mb-3">
                <div>
                  <h3 className="text-white font-medium">{student?.name || 'Học viên không xác định'}</h3>
                  <p className="text-xs text-zinc-400 mt-1 flex items-center gap-1">
                    <CalendarIcon className="w-3 h-3" />
                    Gói: {contract?.packageName || 'Không xác định'}
                  </p>
                </div>
              </div>

              <div className="bg-zinc-950 rounded-xl p-3 mb-4 border border-zinc-800">
                <div className="flex justify-between items-center mb-2">
                  <span className="text-xs text-zinc-500">Từ</span>
                  <span className="text-sm text-zinc-300 font-medium">{new Date(request.startDate).toLocaleDateString('vi-VN')}</span>
                </div>
                <div className="flex justify-between items-center mb-2">
                  <span className="text-xs text-zinc-500">Đến</span>
                  <span className="text-sm text-zinc-300 font-medium">{new Date(request.endDate).toLocaleDateString('vi-VN')}</span>
                </div>
                <div className="flex justify-between items-center mb-0">
                  <span className="text-xs text-zinc-500">Số ngày bù:</span>
                  <span className="text-sm font-bold text-orange-400">
                    +{Math.max(1, Math.ceil((new Date(request.endDate).getTime() - new Date(request.startDate).getTime()) / (1000 * 3600 * 24)) + 1)} ngày
                  </span>
                </div>
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
