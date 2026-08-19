import React, { useState } from 'react';
import { motion } from 'motion/react';
import { X, AlertTriangle } from 'lucide-react';
import { StudentContract } from '../../../types';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  contract: StudentContract | null;
  onConfirm: (cancelDebt: boolean, note: string) => void;
}

export default function CancelContractModal({ isOpen, onClose, contract, onConfirm }: Props) {
  const [cancelDebt, setCancelDebt] = useState(false);
  const [note, setNote] = useState('');

  if (!isOpen || !contract) return null;

  const pendingInstallments = contract.installments?.filter(i => i.status === 'pending') || [];
  const remainingDebt = pendingInstallments.reduce((sum, i) => sum + i.amount, 0);

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-zinc-900 rounded-2xl p-6 w-full max-w-md border border-red-500/30"
      >
        <div className="flex justify-between items-center mb-6">
          <div className="flex items-center gap-2 text-red-500">
            <AlertTriangle className="w-6 h-6" />
            <h3 className="text-xl font-bold">Hủy Học Viên & Hợp Đồng</h3>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-zinc-800 rounded-full text-zinc-400">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-4">
          <p className="text-zinc-300">
            Bạn đang thao tác hủy hợp đồng <strong>{contract.packageName}</strong>. Hành động này sẽ khóa hợp đồng của học viên.
          </p>

          {remainingDebt > 0 && (
            <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 space-y-3">
              <p className="text-red-400 font-medium">Học viên hiện còn nợ: {remainingDebt.toLocaleString('vi-VN')}đ</p>
              
              <label className="flex items-center gap-3 cursor-pointer">
                <input 
                  type="checkbox"
                  checked={cancelDebt}
                  onChange={(e) => setCancelDebt(e.target.checked)}
                  className="w-5 h-5 rounded border-zinc-700 bg-zinc-900 text-red-500 focus:ring-red-500"
                />
                <span className="text-zinc-300 text-sm">Hủy bỏ các kỳ thu nợ còn lại (Xóa nợ)</span>
              </label>
            </div>
          )}

          <div>
            <label className="block text-sm text-zinc-400 mb-2">Lý do nghỉ (Ghi chú)</label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Ví dụ: Chuyển chỗ ở, Không có thời gian..."
              className="w-full bg-zinc-950 border border-zinc-800 text-white px-4 py-3 rounded-xl focus:outline-none focus:border-red-500 min-h-[100px]"
            />
          </div>
        </div>

        <div className="mt-8 flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 bg-zinc-800 hover:bg-zinc-700 text-white px-4 py-3 rounded-xl font-bold transition-colors"
          >
            Đóng
          </button>
          <button
            onClick={() => onConfirm(cancelDebt, note)}
            className="flex-1 bg-red-500 hover:bg-red-600 text-white px-4 py-3 rounded-xl font-bold transition-colors"
          >
            Xác nhận Hủy
          </button>
        </div>
      </motion.div>
    </div>
  );
}
