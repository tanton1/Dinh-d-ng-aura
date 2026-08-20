import React, { useState, useEffect } from 'react';
import { StudentContract } from '../../../types';
import { AlertTriangle, X } from 'lucide-react';
import { motion } from 'motion/react';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  contract: StudentContract;
  onSave: (updatedContract: StudentContract, skipPayment?: boolean) => void;
}

export default function AddSessionsModal({ isOpen, onClose, contract }: Props) {
  const [extraSessions, setExtraSessions] = useState(0);
  const [extraDurationMonths, setExtraDurationMonths] = useState(0);
  const [extraPrice, setExtraPrice] = useState(0);
  const [paidAmount, setPaidAmount] = useState(0);

  const [newTotalSessions, setNewTotalSessions] = useState(contract.totalSessions);
  const [newEndDate, setNewEndDate] = useState(contract.endDate);
  const [newTotalPrice, setNewTotalPrice] = useState(contract.totalPrice);

  useEffect(() => {
    setNewTotalSessions(contract.totalSessions + extraSessions);
  }, [extraSessions, contract.totalSessions]);

  useEffect(() => {
    setNewTotalPrice(contract.totalPrice + extraPrice);
  }, [extraPrice, contract.totalPrice]);

  useEffect(() => {
    const end = new Date(contract.endDate);
    end.setMonth(end.getMonth() + extraDurationMonths);
    setNewEndDate(end.toISOString().split('T')[0]);
  }, [extraDurationMonths, contract.endDate]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // Fail closed until the backend can update the contract projection and
    // post the matching ledger entry in one idempotent transaction.
  };

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="bg-zinc-900 border border-zinc-800 rounded-3xl w-full max-w-md overflow-hidden shadow-2xl"
      >
        <div className="p-6 border-b border-zinc-800 flex justify-between items-center">
          <h3 className="text-xl font-bold text-white">Mua thêm buổi</h3>
          <button onClick={onClose} className="text-zinc-400 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div className="flex gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-100" role="status">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-400" />
            <div>
              <strong className="block text-amber-300">Tạm khóa để bảo vệ sổ tài chính</strong>
              <span>Chức năng mua thêm buổi sẽ mở lại khi hợp đồng và bút toán thu tiền được ghi trong cùng một giao dịch máy chủ.</span>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-zinc-400 mb-1">Số buổi mua thêm</label>
            <input
              type="number"
              min="0"
              value={extraSessions}
              onChange={(e) => setExtraSessions(Number(e.target.value))}
              className="w-full p-3 rounded-xl border border-zinc-800 bg-zinc-950 text-white focus:outline-none focus:border-pink-500"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-zinc-400 mb-1">Gia hạn thêm (tháng)</label>
            <input
              type="number"
              min="0"
              value={extraDurationMonths}
              onChange={(e) => setExtraDurationMonths(Number(e.target.value))}
              className="w-full p-3 rounded-xl border border-zinc-800 bg-zinc-950 text-white focus:outline-none focus:border-pink-500"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-zinc-400 mb-1">Giá báo thêm (VNĐ)</label>
            <input
              type="number"
              min="0"
              value={extraPrice}
              onChange={(e) => setExtraPrice(Number(e.target.value))}
              className="w-full p-3 rounded-xl border border-zinc-800 bg-zinc-950 text-white focus:outline-none focus:border-pink-500"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-zinc-400 mb-1">Khách thanh toán ngay (VNĐ)</label>
            <input
              type="number"
              min="0"
              max={extraPrice + (contract.totalPrice - contract.paidAmount - (contract.discount || 0))}
              value={paidAmount}
              onChange={(e) => setPaidAmount(Number(e.target.value))}
              className="w-full p-3 rounded-xl border border-zinc-800 bg-zinc-950 text-white focus:outline-none focus:border-emerald-500"
            />
          </div>

          <div className="bg-zinc-800/50 p-4 rounded-xl space-y-2 mt-4 text-sm">
            <div className="flex justify-between">
              <span className="text-zinc-400">Số buổi mới:</span>
              <span className="font-bold text-white">{newTotalSessions} buổi</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-400">Hạn sử dụng mới:</span>
              <span className="font-bold text-white">{new Date(newEndDate).toLocaleDateString('vi-VN')}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-400">Tổng tiền mới:</span>
              <span className="font-bold text-pink-400">{newTotalPrice.toLocaleString('vi-VN')}đ</span>
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t border-zinc-800 mt-6">
            <button
              type="button"
              onClick={onClose}
              className="px-6 py-2.5 rounded-xl font-medium text-white hover:bg-zinc-800 transition-colors"
            >
              Hủy
            </button>
            <button
              type="submit"
              disabled
              aria-disabled="true"
              title="Đang chờ quy trình giao dịch máy chủ an toàn"
              className="cursor-not-allowed px-6 py-2.5 rounded-xl font-medium text-zinc-400 bg-zinc-800 opacity-70"
            >
              Đang nâng cấp an toàn
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  );
}
