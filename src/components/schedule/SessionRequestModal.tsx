import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, CalendarClock } from 'lucide-react';
import { useDatabase } from '../../contexts/DatabaseContext';
import { Session, SessionRequest } from '../../types';

interface Props {
  onClose: () => void;
  session: Session;
  contractId: string;
}

export default function SessionRequestModal({ onClose, session, contractId }: Props) {
  const { addSessionRequest, sessionRequests } = useDatabase();
  const [type, setType] = useState<'cancel' | 'reschedule'>('cancel');
  const [newDate, setNewDate] = useState('');
  const [newHour, setNewHour] = useState('');
  const [reason, setReason] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reason) return;
    if (type === 'reschedule' && (!newDate || !newHour)) return;

    // Validate 24 hours in advance
    let sessionDateTime = new Date(session.date);
    if (session.hour !== undefined) {
      sessionDateTime.setHours(session.hour, 0, 0, 0);
    }
    const diffHours = (sessionDateTime.getTime() - new Date().getTime()) / 1000 / 3600;
    if (diffHours < 24) {
      alert('Chỉ có thể xin huỷ/dời lịch trước ít nhất 24 giờ so với giờ tập!');
      return;
    }

    // Validate max 1 per month
    const currentMonth = new Date().getMonth();
    const currentYear = new Date().getFullYear();
    const studentRequestsThisMonth = sessionRequests?.filter((r: SessionRequest) => 
      r.studentId === session.studentId && 
      (r.status === 'pending' || r.status === 'approved') &&
      new Date(r.createdAt).getMonth() === currentMonth &&
      new Date(r.createdAt).getFullYear() === currentYear
    ) || [];

    if (studentRequestsThisMonth.length >= 1) {
      alert('Bạn chỉ được phép xin đổi/huỷ lịch tối đa 1 lần trong tháng. Vui lòng liên hệ trực tiếp PT nếu có việc gấp.');
      return;
    }

    setIsSubmitting(true);
    try {
      await addSessionRequest({
        id: Date.now().toString() + Math.random().toString(36).substring(7),
        studentId: session.studentId,
        contractId,
        sessionId: session.id,
        originalDate: session.date,
        originalHour: session.hour,
        type,
        newDate: type === 'reschedule' ? newDate : undefined,
        newHour: type === 'reschedule' ? Number(newHour) : undefined,
        reason,
        status: 'pending',
        createdAt: new Date().toISOString()
      });
      alert('Đã gửi yêu cầu thành công! Bạn chỉ được duyệt tối đa 1 lần/tháng.');
      onClose();
    } catch (error) {
      console.error(error);
      alert('Có lỗi xảy ra.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/80 z-[60] flex items-end justify-center p-4">
      <motion.div 
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        className="bg-zinc-900 w-full max-w-md rounded-3xl p-6 border border-zinc-800 relative"
      >
        <div className="flex justify-between items-center mb-6">
          <h3 className="text-lg font-medium text-white flex items-center gap-2">
            <CalendarClock className="w-5 h-5 text-pink-500" />
            Đổi / Huỷ Lịch Tập
          </h3>
          <button onClick={onClose} className="text-zinc-400 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>
        
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1">Loại yêu cầu</label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setType('cancel')}
                className={`flex-1 py-2 rounded-xl text-sm font-medium transition-colors border ${
                  type === 'cancel'
                    ? 'bg-pink-500 text-white border-pink-500'
                    : 'bg-zinc-950 text-zinc-400 border-zinc-800'
                }`}
              >
                Huỷ (Báo Nghỉ)
              </button>
              <button
                type="button"
                onClick={() => setType('reschedule')}
                className={`flex-1 py-2 rounded-xl text-sm font-medium transition-colors border ${
                  type === 'reschedule'
                    ? 'bg-pink-500 text-white border-pink-500'
                    : 'bg-zinc-950 text-zinc-400 border-zinc-800'
                }`}
              >
                Dời Sang Ngày Khác
              </button>
            </div>
          </div>

          <div className="p-3 bg-zinc-950 border border-zinc-800 rounded-xl mb-4 text-sm text-zinc-300">
            <strong>Giờ tập hiện tại:</strong> {new Date(session.date).toLocaleDateString('vi-VN')} {session.hour !== undefined ? `- ${session.hour}:00` : ''}
          </div>

          {type === 'reschedule' && (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-1">Ngày tập bù</label>
                <input
                  type="date"
                  required
                  value={newDate}
                  onChange={(e) => setNewDate(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-pink-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-1">Giờ (6-20)</label>
                <input
                  type="number"
                  required
                  min="6"
                  max="20"
                  value={newHour}
                  onChange={(e) => setNewHour(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-pink-500"
                />
              </div>
            </div>
          )}
          
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1">Lý do</label>
            <textarea
              required
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Vui lòng ghi rõ lý do..."
              className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-pink-500 min-h-[80px]"
            />
          </div>
          
          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full bg-pink-600 hover:bg-pink-500 text-white font-bold py-3 rounded-xl transition-colors disabled:opacity-50"
          >
            {isSubmitting ? 'Đang gửi...' : 'Gửi yêu cầu'}
          </button>
        </form>
      </motion.div>
    </div>
  );
}
