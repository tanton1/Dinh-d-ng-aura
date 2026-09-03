import React, { useState } from 'react';
import { motion } from 'motion/react';
import { X, CalendarClock } from 'lucide-react';
import { StudentContract } from '../../../types';
import { formatDate } from '../../../utils/dateUtils';

interface Props {
  contract: StudentContract;
  onClose: () => void;
  onSave: (updatedContract: StudentContract) => void;
}

export default function ExtendContractModal({ contract, onClose, onSave }: Props) {
  const [newEndDate, setNewEndDate] = useState(contract.endDate.split('T')[0]);
  const [reason, setReason] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newEndDate) return;

    if (new Date(newEndDate) <= new Date(contract.endDate)) {
      alert('Ngày hết hạn mới phải nằm sau ngày hiện tại!');
      return;
    }

    if (!reason.trim()) {
      alert('Vui lòng nhập lý do gia hạn!');
      return;
    }

    setIsSubmitting(true);
    
    try {
      const extensionRecord = {
        id: Date.now().toString(),
        oldEndDate: contract.endDate,
        newEndDate: newEndDate + 'T23:59:59.000Z',
        reason,
        createdAt: new Date().toISOString()
      };

      const updatedContract = {
        ...contract,
        endDate: extensionRecord.newEndDate,
        extensions: [...(contract.extensions || []), extensionRecord]
      };

      onSave(updatedContract);
      alert('Gia hạn ngày tập thành công!');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/80 z-[60] flex items-center justify-center p-4">
      <motion.div 
        role="dialog"
        aria-modal="true"
        aria-label="Gia hạn lịch tập"
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="bg-zinc-900 w-full max-w-md rounded-3xl p-6 border border-zinc-800 relative shadow-2xl"
      >
        <div className="flex justify-between items-center mb-6">
          <h3 className="text-xl font-bold text-white flex items-center gap-2">
            <CalendarClock className="w-6 h-6 text-pink-500" />
            Gia hạn lịch tập
          </h3>
          <button onClick={onClose} className="text-zinc-400 hover:text-white p-2 hover:bg-zinc-800 rounded-full transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="mb-6 p-4 bg-zinc-950 rounded-xl border border-zinc-800 text-sm">
          <p className="text-zinc-400 mb-1">Ngày hết hạn hiện tại:</p>
          <p className="text-lg font-bold text-white">{formatDate(contract.endDate)}</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-zinc-300 mb-1.5 ml-1">
              Ngày hết hạn mới
            </label>
            <input
              type="date"
              required
              min={new Date(contract.endDate).toISOString().split('T')[0]}
              value={newEndDate}
              onChange={(e) => setNewEndDate(e.target.value)}
              className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-pink-500 focus:ring-1 focus:ring-pink-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-zinc-300 mb-1.5 ml-1">
              Lý do gia hạn
            </label>
            <textarea
              required
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="VD: Được PT tặng thêm thời gian, lịch chưa xếp đủ..."
              className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-pink-500 focus:ring-1 focus:ring-pink-500 h-24 resize-none"
            />
          </div>

          <div className="pt-2">
            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full py-3.5 rounded-xl font-bold text-white bg-pink-600 hover:bg-pink-500 transition-colors shadow-lg shadow-pink-500/20 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSubmitting ? 'Đang lưu...' : 'Xác nhận gia hạn'}
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  );
}
