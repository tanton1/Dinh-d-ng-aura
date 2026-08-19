import React, { useState, useEffect } from 'react';
import { StudentContract, PaymentRecord } from '../../../types';
import { X } from 'lucide-react';
import { motion } from 'motion/react';
import { useDatabase } from '../../../contexts/DatabaseContext';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  contract: StudentContract;
  onSave: (updatedContract: StudentContract, skipPayment?: boolean) => void;
}

export default function AddSessionsModal({ isOpen, onClose, contract, onSave }: Props) {
  const { addPayment, trainers } = useDatabase();
  const [extraSessions, setExtraSessions] = useState(0);
  const [extraDurationMonths, setExtraDurationMonths] = useState(0);
  const [extraPrice, setExtraPrice] = useState(0);
  const [paidAmount, setPaidAmount] = useState(0);
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'transfer' | 'card'>('transfer');

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
    if (extraSessions < 0 || extraPrice < 0 || extraDurationMonths < 0) {
      alert('Vui lòng nhập giá trị hợp lệ');
      return;
    }

    const newPaidAmount = contract.paidAmount + paidAmount;
    
    let referralCommissionAmount = contract.referralCommission || null;
    if (contract.referralCode) {
      const referringPT = trainers.find(t => t.employeeCode === contract.referralCode);
      if (referringPT) {
        referralCommissionAmount = newPaidAmount * (referringPT.commissionRate / 100);
      }
    }

    const updatedContract = {
      ...contract,
      status: contract.status === 'expired' ? 'active' : contract.status,
      totalSessions: newTotalSessions,
      endDate: newEndDate,
      totalPrice: newTotalPrice,
      paidAmount: newPaidAmount,
      referralCommission: referralCommissionAmount,
    };

    try {
      // Pass skipPayment=true because we handle the payment here to be specific about "Thanh toán mua thêm buổi"
      await onSave(updatedContract, true);

      if (paidAmount > 0) {
        const paymentRecord: PaymentRecord = {
          id: Date.now().toString() + '-add-sessions',
          contractId: contract.id,
          studentId: contract.studentId,
          amount: paidAmount,
          date: new Date().toISOString(),
          method: paymentMethod as 'cash' | 'transfer',
          note: `Thanh toán mua thêm ${extraSessions} buổi`,
        };
        await addPayment(paymentRecord);
      }

      alert('Thêm buổi thành công!');
      onClose();
    } catch (err) {
      console.error(err);
      alert('Có lỗi xảy ra');
    }
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
              className="px-6 py-2.5 rounded-xl font-medium text-white bg-pink-500 hover:bg-pink-600 transition-colors shadow-lg shadow-pink-500/20"
            >
              Cập nhật hợp đồng
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  );
}
