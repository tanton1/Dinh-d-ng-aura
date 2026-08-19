import React, { useState, useEffect } from 'react';
import { StudentContract, TrainingPackage, Trainer, Branch, Installment } from '../../../types';
import { X } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import TrainerPrioritySelector from './TrainerPrioritySelector';

interface Props {
  contract: StudentContract;
  packages: TrainingPackage[];
  trainers: Trainer[];
  branches: Branch[];
  onClose: () => void;
  onSave: (contract: StudentContract) => void;
}

export default function EditContractModal({ contract, packages, trainers, branches, onClose, onSave }: Props) {
  const [formData, setFormData] = useState<StudentContract>({ ...contract });
  const [installments, setInstallments] = useState<Installment[]>(contract.installments || []);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const debt = (formData.totalPrice - (formData.discount || 0)) - formData.paidAmount;
  const pendingInstallments = installments.filter(i => i.status === 'pending');
  const totalInstallments = pendingInstallments.reduce((sum, inst) => sum + inst.amount, 0);

  const handleSave = () => {
    if (isSubmitting) return;
    setIsSubmitting(true);
    if (totalInstallments !== debt && debt > 0) {
      alert(`Tổng số tiền trả góp (${totalInstallments.toLocaleString('vi-VN')}đ) phải bằng số tiền còn nợ (${debt.toLocaleString('vi-VN')}đ)!`);
      setIsSubmitting(false);
      return;
    }
    
    const nextPending = installments.find(i => i.status === 'pending');
    
    let referralCommissionAmount = formData.referralCommission || null;
    if (formData.referralCode) {
      const referringPT = trainers.find(t => t.employeeCode === formData.referralCode);
      if (referringPT) {
        referralCommissionAmount = formData.paidAmount * (referringPT.commissionRate / 100);
      }
    }
    
    onSave({ 
      ...formData, 
      installments,
      referralCommission: referralCommissionAmount,
      nextPaymentDate: nextPending ? nextPending.date : null
    });
    // Let the parent modal closing handle everything else
  };

  const handleInstallmentChange = (id: string, field: keyof Installment, value: string | number | boolean) => {
    setInstallments(prev => prev.map(inst => inst.id === id ? { ...inst, [field]: value } : inst));
  };

  const addInstallment = () => {
    setInstallments(prev => [...prev, { id: Date.now().toString(), amount: 0, date: new Date().toISOString().split('T')[0], status: 'pending' }]);
  };

  const removeInstallment = (id: string) => {
    setInstallments(prev => prev.filter(inst => inst.id !== id));
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
      <motion.div 
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="bg-zinc-900 rounded-3xl p-6 shadow-2xl border border-zinc-800 w-full max-w-md max-h-[90vh] overflow-y-auto"
      >
        <div className="flex justify-between items-center mb-6">
          <h3 className="text-xl font-bold text-white">Chỉnh sửa hợp đồng</h3>
          <button onClick={onClose} className="text-zinc-400 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-4">
          {/* ... existing fields ... */}
          <div>
            <label className="block text-sm font-medium text-zinc-400 mb-1">Chi nhánh</label>
            <select 
              value={formData.branchId || ''}
              onChange={e => setFormData({ ...formData, branchId: e.target.value })}
              className="w-full p-3 rounded-xl border border-zinc-800 bg-zinc-950 text-white focus:outline-none focus:border-pink-500"
            >
              <option value="">-- Chưa xác định --</option>
              {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-zinc-400 mb-1">Gói tập</label>
            <select 
              value={formData.packageId}
              onChange={e => {
                const pkg = packages.find(p => p.id === e.target.value);
                setFormData({ ...formData, packageId: e.target.value, packageName: pkg?.name || '', totalSessions: pkg?.totalSessions || 0, totalPrice: pkg?.price || 0 });
              }}
              className="w-full p-3 rounded-xl border border-zinc-800 bg-zinc-950 text-white focus:outline-none focus:border-pink-500"
            >
              {packages.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-zinc-400 mb-2">Huấn luyện viên</label>
            <TrainerPrioritySelector
              trainers={trainers}
              selectedTrainerIds={formData.trainerIds || (formData.trainerId ? [formData.trainerId] : [])}
              onChange={(nextTrainerIds) => {
                setFormData({
                  ...formData,
                  trainerIds: nextTrainerIds,
                  trainerId: nextTrainerIds[0] || undefined
                });
              }}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-zinc-400 mb-2">PT Dinh dưỡng</label>
            <div className="grid grid-cols-2 gap-2 max-h-32 overflow-y-auto p-2 border border-zinc-800 rounded-xl bg-zinc-950">
              {trainers.filter(t => t.status === 'active').map(t => {
                const currentNutritionPTs = formData.nutritionPTIds || [];
                return (
                  <label key={`nutri-edit-${t.id}`} className="flex items-center gap-2 text-white cursor-pointer hover:bg-zinc-900 p-2 rounded-lg">
                    <input
                      type="checkbox"
                      checked={currentNutritionPTs.includes(t.id)}
                      onChange={() => {
                        let newIds = [...currentNutritionPTs];
                        if (newIds.includes(t.id)) {
                          newIds = newIds.filter(id => id !== t.id);
                        } else {
                          newIds.push(t.id);
                        }
                        setFormData({ ...formData, nutritionPTIds: newIds });
                      }}
                      className="rounded border-zinc-700 bg-zinc-900 text-pink-500 focus:ring-pink-500"
                    />
                    <span className="text-sm">{t.name}</span>
                  </label>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-zinc-400 mb-1">Ngày bắt đầu</label>
              <input 
                type="date" 
                value={formData.startDate}
                onChange={e => setFormData({ ...formData, startDate: e.target.value })}
                className="w-full p-3 rounded-xl border border-zinc-800 bg-zinc-950 text-white focus:outline-none focus:border-pink-500" 
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-zinc-400 mb-1">Ngày kết thúc</label>
              <input 
                type="date" 
                value={formData.endDate}
                onChange={e => setFormData({ ...formData, endDate: e.target.value })}
                className="w-full p-3 rounded-xl border border-zinc-800 bg-zinc-950 text-white focus:outline-none focus:border-pink-500" 
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-zinc-400 mb-1">Mã giới thiệu (Nếu có)</label>
            <input 
              type="text" 
              value={formData.referralCode || ''}
              onChange={e => setFormData({ ...formData, referralCode: e.target.value })}
              className="w-full p-3 rounded-xl border border-zinc-800 bg-zinc-950 text-white focus:outline-none focus:border-pink-500 uppercase" 
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-zinc-400 mb-1">Tổng tiền (VNĐ)</label>
            <input 
              type="number" 
              value={formData.totalPrice}
              onChange={e => setFormData({ ...formData, totalPrice: Number(e.target.value) })}
              className="w-full p-3 rounded-xl border border-zinc-800 bg-zinc-950 text-white focus:outline-none focus:border-pink-500" 
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-zinc-400 mb-1">Giảm giá (VNĐ)</label>
            <input 
              type="number" 
              value={formData.discount || 0}
              onChange={e => setFormData({ ...formData, discount: Number(e.target.value) })}
              className="w-full p-3 rounded-xl border border-zinc-800 bg-zinc-950 text-white focus:outline-none focus:border-pink-500" 
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-zinc-400 mb-1">Đã thanh toán (VNĐ)</label>
            <input 
              type="number" 
              value={formData.paidAmount}
              onChange={e => setFormData({ ...formData, paidAmount: Number(e.target.value) })}
              className="w-full p-3 rounded-xl border border-zinc-800 bg-zinc-950 text-white focus:outline-none focus:border-pink-500" 
            />
          </div>

          {/* Installment Editing Section */}
          <div className="pt-4 border-t border-zinc-800">
            <div className="flex justify-between items-center mb-2">
              <label className="block text-sm font-medium text-zinc-400">Kế hoạch trả góp</label>
              <button onClick={addInstallment} className="text-xs text-pink-500 hover:text-pink-400 font-medium">+ Thêm kỳ</button>
            </div>
            <div className="space-y-2">
              {installments.map(inst => (
                <div key={inst.id} className="flex gap-2 items-center">
                  <input type="date" value={inst.date} disabled={inst.status === 'paid'} onChange={e => handleInstallmentChange(inst.id, 'date', e.target.value)} className={`flex-1 p-2 rounded-lg border border-zinc-800 bg-zinc-950 text-white text-sm ${inst.status === 'paid' ? 'opacity-50 cursor-not-allowed' : ''}`} />
                  <input type="number" value={inst.amount} disabled={inst.status === 'paid'} onChange={e => handleInstallmentChange(inst.id, 'amount', Number(e.target.value))} className={`flex-1 p-2 rounded-lg border border-zinc-800 bg-zinc-950 text-white text-sm ${inst.status === 'paid' ? 'opacity-50 cursor-not-allowed' : ''}`} />
                  {inst.status === 'pending' && (
                    <button onClick={() => removeInstallment(inst.id)} className="text-zinc-500 hover:text-red-500"><X className="w-4 h-4" /></button>
                  )}
                  {inst.status === 'paid' && (
                    <span className="text-emerald-500 text-xs font-medium w-4 flex justify-center">✓</span>
                  )}
                </div>
              ))}
            </div>
            <div className="text-xs text-zinc-500 mt-2">Còn nợ: {debt.toLocaleString('vi-VN')}đ | Đã chia: {totalInstallments.toLocaleString('vi-VN')}đ</div>
          </div>

          <button 
            onClick={handleSave}
            disabled={isSubmitting}
            className="w-full py-3 rounded-xl font-medium text-white bg-pink-500 hover:bg-pink-600 transition-colors shadow-[0_0_15px_rgba(255,0,127,0.4)] mt-4 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSubmitting ? 'Đang lưu...' : 'Lưu thay đổi'}
          </button>
        </div>
      </motion.div>
    </div>
  );
}
