import React, { useState } from 'react';
import { motion } from 'motion/react';
import { X, Calendar } from 'lucide-react';
import { useDatabase } from '../../contexts/DatabaseContext';

interface Props {
  onClose: () => void;
  studentId: string;
  contractId: string;
}

export default function LeaveRequestModal({ onClose, studentId, contractId }: Props) {
  const { addLeaveRequest } = useDatabase();
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [reason, setReason] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!startDate || !endDate || !reason) return;

    setIsSubmitting(true);
    try {
      await addLeaveRequest({
        id: Date.now().toString() + Math.random().toString(36).substring(7),
        studentId,
        contractId,
        startDate,
        endDate,
        reason,
        status: 'pending',
        createdAt: new Date().toISOString()
      });
      alert('Đã gửi yêu cầu xin nghỉ thành công! Admin sẽ duyệt và báo lại.');
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
            <Calendar className="w-5 h-5 text-pink-500" />
            Xin nghỉ / Bảo lưu
          </h3>
          <button onClick={onClose} className="text-zinc-400 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>
        
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1">Từ ngày</label>
              <input
                type="date"
                required
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-pink-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1">Đến khi nào đi tập lại?</label>
              <input
                type="date"
                required
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-pink-500"
              />
            </div>
          </div>
          
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1">Lý do xin nghỉ</label>
            <textarea
              required
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Ốm đau, công tác, du lịch..."
              className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-pink-500 min-h-[100px]"
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
