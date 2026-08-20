import React, { useState } from 'react';
import { LeaveRequest, Student, StudentContract } from '../../../types';
import { useDatabase } from '../../../contexts/DatabaseContext';
import { Check, X, Calendar as CalendarIcon, Clock } from 'lucide-react';

interface Props {
  leaveRequests: LeaveRequest[];
  students: Student[];
  contracts: StudentContract[];
  canManage: boolean;
}

export default function LeaveApprovals({ leaveRequests, students, contracts, canManage }: Props) {
  const { updateLeaveRequest } = useDatabase();
  const [processingId, setProcessingId] = useState<string | null>(null);
  const approvalUnavailableMessage = 'Chưa thể duyệt đơn nghỉ an toàn vì gia hạn hợp đồng, hủy các buổi trùng và cập nhật đơn cần một giao dịch máy chủ duy nhất. Vui lòng liên hệ quản trị hệ thống.';
  const permissionMessage = 'Bạn chỉ có quyền xem đơn nghỉ. Chỉ quản trị viên vận hành mới có thể xử lý yêu cầu này.';

  const pendingRequests = leaveRequests.filter(r => r.status === 'pending' && students.some(s => s.id === r.studentId));

  if (pendingRequests.length === 0) return null;

  const handleReject = async (request: LeaveRequest) => {
    if (!canManage) {
      alert(permissionMessage);
      return;
    }
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
                  type="button"
                  disabled
                  title={approvalUnavailableMessage}
                  className="flex-1 bg-emerald-500/10 text-emerald-500 py-2 rounded-xl text-sm font-medium flex items-center justify-center gap-1 opacity-50 cursor-not-allowed"
                >
                  <Check className="w-4 h-4" /> Chưa thể duyệt
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
              <p className="mt-2 text-xs text-amber-400">{approvalUnavailableMessage}</p>
              {!canManage && <p className="mt-1 text-xs text-zinc-500">{permissionMessage}</p>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
