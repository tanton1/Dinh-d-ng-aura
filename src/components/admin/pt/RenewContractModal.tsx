import React, { useState, useEffect } from 'react';
import { Student, StudentContract, TrainingPackage, Trainer, PaymentRecord } from '../../../types';
import { X, Calendar, DollarSign, RefreshCw, CheckCircle } from 'lucide-react';
import { useDatabase } from '../../../contexts/DatabaseContext';
import TrainerPrioritySelector from './TrainerPrioritySelector';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  student: Student;
  latestContract: StudentContract;
}

export default function RenewContractModal({ isOpen, onClose, student, latestContract }: Props) {
  const { packages, trainers, addContract, updateContract, addPayment } = useDatabase();
  
  const [selectedPackageId, setSelectedPackageId] = useState('');
  const [customPackageName, setCustomPackageName] = useState('Gói tuỳ chỉnh');
  const [customTotalSessions, setCustomTotalSessions] = useState(0);
  const [customDurationMonths, setCustomDurationMonths] = useState(1);
  const [customPrice, setCustomPrice] = useState(0);
  const [startDate, setStartDate] = useState('');
  const [carryOver, setCarryOver] = useState(true);
  const [discount, setDiscount] = useState<number | ''>('');
  const [paidAmount, setPaidAmount] = useState<number | ''>('');
  const [installmentCount, setInstallmentCount] = useState(1);
  const [installments, setInstallments] = useState<{date: string, amount: number}[]>([]);
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'transfer' | 'card'>('transfer');
  const [trainerIds, setTrainerIds] = useState<string[]>(latestContract.trainerIds || (latestContract.trainerId ? [latestContract.trainerId] : []));
  const [nutritionPTIds, setNutritionPTIds] = useState<string[]>(latestContract.nutritionPTIds || []);
  const [note, setNote] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const remainingSessions = Math.max(0, latestContract.totalSessions - latestContract.usedSessions);

  useEffect(() => {
    if (isOpen) {
      // Calculate default start date
      const today = new Date();
      const oldEndDate = new Date(latestContract.endDate);
      const isExhausted = (latestContract.totalSessions - (latestContract.usedSessions || 0)) <= 0;
      
      if (oldEndDate > today && !isExhausted) {
        // If old contract is still valid and has sessions remaining, start new one after it ends
        const nextDay = new Date(oldEndDate);
        nextDay.setDate(nextDay.getDate() + 1);
        setStartDate(nextDay.toISOString().split('T')[0]);
      } else {
        // If already expired or exhausted all sessions, start today
        setStartDate(today.toISOString().split('T')[0]);
      }
      
      setSelectedPackageId('');
      setDiscount('');
      setPaidAmount('');
      setInstallmentCount(1);
      setInstallments([]);
      setPaymentMethod('transfer');
      setTrainerIds(latestContract.trainerIds || (latestContract.trainerId ? [latestContract.trainerId] : []));
      setNutritionPTIds(latestContract.nutritionPTIds || []);
      setNote('');
      setCarryOver(remainingSessions > 0);
    }
  }, [isOpen, latestContract, remainingSessions]);

  const selectedPackage = selectedPackageId === 'custom' ? {
    id: `custom-${Date.now()}`,
    name: customPackageName,
    price: customPrice,
    totalSessions: customTotalSessions,
    durationMonths: customDurationMonths
  } : packages.find(p => p.id === selectedPackageId);

  const finalPrice = selectedPackage ? Math.max(0, selectedPackage.price - (Number(discount) || 0)) : 0;
  const newTotalSessions = selectedPackage ? selectedPackage.totalSessions + (carryOver ? remainingSessions : 0) : 0;

  useEffect(() => {
    if (!selectedPackage) {
      setInstallments([]);
      return;
    }

    const discountAmount = Number(discount) || 0;
    const debt = (selectedPackage.price - discountAmount) - (Number(paidAmount) || 0);
    if (debt > 0) {
      setInstallments(prev => {
        const currentSum = prev.reduce((sum, inst) => sum + inst.amount, 0);
        if (prev.length === installmentCount && currentSum === debt) {
          return prev;
        }

        const base = Math.floor(debt / installmentCount);
        const rem = debt % installmentCount;
        return Array.from({ length: installmentCount }).map((_, i) => ({
          date: prev[i]?.date || '',
          amount: i === 0 ? base + rem : base
        }));
      });
    } else {
      setInstallments([]);
    }
  }, [installmentCount, paidAmount, discount, selectedPackageId, packages, selectedPackage?.price, customPrice]);

  if (!isOpen) return null;

  const handleInstallmentChange = (index: number, field: 'date' | 'amount', value: string | number) => {
    const newInsts = [...installments];
    newInsts[index] = { ...newInsts[index], [field]: value };
    setInstallments(newInsts);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPackage || !startDate) return;

    const initialPaid = Number(paidAmount) || 0;
    const discountAmount = Number(discount) || 0;
    const debt = (selectedPackage.price - discountAmount) - initialPaid;

    if (debt > 0) {
      const sum = installments.reduce((a, b) => a + Number(b.amount), 0);
      if (sum !== debt) {
        alert('Tổng số tiền các kỳ phải bằng số tiền còn nợ!');
        return;
      }
      if (installments.some(i => !i.date)) {
        alert('Vui lòng chọn ngày cho tất cả các kỳ!');
        return;
      }
    }

    setIsSubmitting(true);
    try {
      // 1. Calculate End Date
      const end = new Date(startDate);
      end.setMonth(end.getMonth() + selectedPackage.durationMonths);

      // 2. Create New Contract
      const newContractId = Date.now().toString() + '-renew';
      
      const pendingInstallments = installments.filter(i => i.amount > 0); // They are all pending from the UI
      
      let referralCommissionAmount = null;
      if (latestContract.referralCode) {
        const referringPT = trainers.find(t => t.employeeCode === latestContract.referralCode);
        if (referringPT) {
          referralCommissionAmount = initialPaid * (referringPT.commissionRate / 100);
        }
      }
      
      const newContract: StudentContract = {
        id: newContractId,
        studentId: student.id,
        branchId: latestContract.branchId,
        packageId: selectedPackage.id,
        packageName: selectedPackage.name,
        startDate: startDate,
        endDate: end.toISOString().split('T')[0],
        totalSessions: newTotalSessions,
        usedSessions: 0,
        totalPrice: finalPrice,
        paidAmount: initialPaid,
        status: 'active',
        trainerId: trainerIds[0] || undefined,
        trainerIds: trainerIds,
        nutritionPTIds: nutritionPTIds,
        referralCode: latestContract.referralCode,
        referralCommission: referralCommissionAmount,
        installments: [
          ...(initialPaid > 0 ? [{
            id: Date.now().toString() + '-inst-init',
            amount: initialPaid,
            date: new Date().toISOString(),
            status: 'paid' as const
          }] : []),
          ...pendingInstallments.map((inst, idx) => ({
            id: Date.now().toString() + `-inst-${idx}`,
            amount: inst.amount,
            date: inst.date,
            status: 'pending' as const
          }))
        ],
        nextPaymentDate: pendingInstallments.length > 0 ? pendingInstallments[0].date : null
      };

      // 3. Update Old Contract (Mark as expired if carrying over to prevent double counting)
      if (carryOver && remainingSessions > 0) {
        await updateContract({
          ...latestContract,
          status: 'expired'
        });
      }

      // 4. Save New Contract
      await addContract(newContract);

      // 5. Create Payment Record if paid
      if (initialPaid > 0) {
        const initInst = newContract.installments?.find(i => i.status === 'paid');
        const paymentRecord: PaymentRecord = {
          id: Date.now().toString() + '-pay',
          contractId: newContractId,
          studentId: student.id,
          amount: initialPaid,
          date: new Date().toISOString(),
          method: paymentMethod as 'cash' | 'transfer',
          note: `Thanh toán gia hạn gói ${selectedPackage.name}`,
          installmentId: initInst ? initInst.id : undefined
        };
        await addPayment(paymentRecord);
      }

      alert('Gia hạn hợp đồng thành công!');
      onClose();
    } catch (error) {
      console.error("Error renewing contract:", error);
      alert('Có lỗi xảy ra khi gia hạn hợp đồng.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-2xl overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">
        <div className="p-6 border-b border-zinc-800 flex justify-between items-center bg-zinc-900/50 sticky top-0 z-10">
          <div>
            <h2 className="text-xl font-bold text-white flex items-center gap-2">
              <RefreshCw className="w-5 h-5 text-pink-500" />
              Gia hạn hợp đồng
            </h2>
            <p className="text-zinc-400 text-sm mt-1">Học viên: <span className="text-white font-medium">{student.name}</span></p>
          </div>
          <button onClick={onClose} className="text-zinc-400 hover:text-white p-2 rounded-lg hover:bg-zinc-800 transition-colors">
            <X className="w-6 h-6" />
          </button>
        </div>

        <div className="p-6 overflow-y-auto custom-scrollbar">
          <form id="renew-form" onSubmit={handleSubmit} className="space-y-6">
            
            {/* Old Contract Info */}
            <div className="bg-zinc-800/50 p-4 rounded-xl border border-zinc-700/50">
              <h3 className="text-sm font-medium text-zinc-300 mb-3 uppercase tracking-wider">Thông tin hợp đồng cũ</h3>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-zinc-500 block">Gói tập:</span>
                  <span className="text-white font-medium">{latestContract.packageName}</span>
                </div>
                <div>
                  <span className="text-zinc-500 block">Ngày hết hạn:</span>
                  <span className="text-white font-medium">{new Date(latestContract.endDate).toLocaleDateString('vi-VN')}</span>
                </div>
                <div>
                  <span className="text-zinc-500 block">Số buổi còn lại:</span>
                  <span className={`font-bold ${remainingSessions > 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                    {remainingSessions} buổi
                  </span>
                </div>
              </div>
            </div>

            {/* New Contract Selection */}
            <div className="space-y-4">
              <h3 className="text-sm font-medium text-zinc-300 uppercase tracking-wider border-b border-zinc-800 pb-2">Thiết lập hợp đồng mới</h3>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="block text-sm text-zinc-400">Gói tập mới *</label>
                  <select
                    required
                    value={selectedPackageId}
                    onChange={(e) => setSelectedPackageId(e.target.value)}
                    className="w-full bg-zinc-950 border border-zinc-800 text-white px-4 py-2.5 rounded-xl focus:outline-none focus:border-pink-500"
                  >
                    <option value="">-- Chọn gói tập --</option>
                    <option value="custom">Gói tuỳ chỉnh (Nhập tay)</option>
                    {packages.map(p => (
                      <option key={p.id} value={p.id}>{p.name} ({p.totalSessions} buổi - {p.price.toLocaleString('vi-VN')}đ)</option>
                    ))}
                  </select>
                </div>

                {selectedPackageId === 'custom' && (
                  <div className="col-span-1 md:col-span-2 bg-zinc-950/50 p-4 rounded-xl border border-zinc-800 space-y-3">
                    <div>
                      <label className="block text-sm font-medium text-zinc-400 mb-1">Tên gói tập</label>
                      <input 
                        type="text" 
                        value={customPackageName}
                        onChange={e => setCustomPackageName(e.target.value)}
                        className="w-full p-3 rounded-xl border border-zinc-800 bg-zinc-950 text-white focus:outline-none focus:border-pink-500" 
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-sm font-medium text-zinc-400 mb-1">Số buổi</label>
                        <input 
                          type="number" 
                          min="1"
                          value={customTotalSessions}
                          onChange={e => setCustomTotalSessions(Number(e.target.value))}
                          className="w-full p-3 rounded-xl border border-zinc-800 bg-zinc-950 text-white focus:outline-none focus:border-pink-500" 
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-zinc-400 mb-1">Thời hạn (Tháng)</label>
                        <input 
                          type="number" 
                          min="1"
                          value={customDurationMonths}
                          onChange={e => setCustomDurationMonths(Number(e.target.value))}
                          className="w-full p-3 rounded-xl border border-zinc-800 bg-zinc-950 text-white focus:outline-none focus:border-pink-500" 
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-zinc-400 mb-1">Giá gói (VNĐ)</label>
                      <input 
                        type="number" 
                        min="0"
                        value={customPrice}
                        onChange={e => setCustomPrice(Number(e.target.value))}
                        className="w-full p-3 rounded-xl border border-zinc-800 bg-zinc-950 text-white focus:outline-none focus:border-pink-500" 
                      />
                    </div>
                  </div>
                )}

                <div className="space-y-2">
                  <label className="block text-sm text-zinc-400">Huấn luyện viên phụ trách</label>
                  <TrainerPrioritySelector
                    trainers={trainers}
                    selectedTrainerIds={trainerIds}
                    onChange={setTrainerIds}
                  />
                </div>

                <div className="space-y-2">
                  <label className="block text-sm text-zinc-400">PT Dinh dưỡng</label>
                  <div className="grid grid-cols-2 gap-2 max-h-32 overflow-y-auto p-2 border border-zinc-800 rounded-xl bg-zinc-950">
                    {trainers.filter(t => t.status === 'active').map(t => (
                      <label key={`nutri-renew-${t.id}`} className="flex items-center gap-2 text-white cursor-pointer hover:bg-zinc-900 p-2 rounded-lg">
                        <input
                          type="checkbox"
                          checked={nutritionPTIds.includes(t.id)}
                          onChange={() => {
                            if (nutritionPTIds.includes(t.id)) {
                              setNutritionPTIds(nutritionPTIds.filter(id => id !== t.id));
                            } else {
                              setNutritionPTIds([...nutritionPTIds, t.id]);
                            }
                          }}
                          className="rounded border-zinc-700 bg-zinc-900 text-pink-500 focus:ring-pink-500"
                        />
                        <span className="text-sm">{t.name}</span>
                      </label>
                    ))}
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="block text-sm text-zinc-400">Ngày bắt đầu *</label>
                  <input
                    type="date"
                    required
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="w-full bg-zinc-950 border border-zinc-800 text-white px-4 py-2.5 rounded-xl focus:outline-none focus:border-pink-500"
                  />
                </div>

                {remainingSessions > 0 && (
                  <div className="space-y-2 flex flex-col justify-end pb-2">
                    <label className="flex items-center gap-3 cursor-pointer group">
                      <div className="relative flex items-center justify-center">
                        <input
                          type="checkbox"
                          checked={carryOver}
                          onChange={(e) => setCarryOver(e.target.checked)}
                          className="peer sr-only"
                        />
                        <div className="w-5 h-5 border-2 border-zinc-600 rounded bg-zinc-900 peer-checked:bg-pink-500 peer-checked:border-pink-500 transition-all"></div>
                        <CheckCircle className="w-3.5 h-3.5 text-white absolute opacity-0 peer-checked:opacity-100 transition-opacity" />
                      </div>
                      <span className="text-sm text-zinc-300 group-hover:text-white transition-colors">
                        Cộng dồn <span className="font-bold text-emerald-500">{remainingSessions} buổi</span> cũ
                      </span>
                    </label>
                  </div>
                )}
              </div>
            </div>

            {/* Financials */}
            {selectedPackage && (
              <div className="space-y-4 bg-pink-500/5 p-4 rounded-xl border border-pink-500/20">
                <h3 className="text-sm font-medium text-pink-500 uppercase tracking-wider">Thanh toán</h3>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="block text-sm text-zinc-400">Giảm giá (VNĐ)</label>
                    <input
                      type="number"
                      value={discount}
                      onChange={(e) => setDiscount(Number(e.target.value) || '')}
                      className="w-full bg-zinc-950 border border-zinc-800 text-white px-4 py-2.5 rounded-xl focus:outline-none focus:border-pink-500"
                      placeholder="0"
                    />
                  </div>
                  
                  <div className="space-y-2">
                    <label className="block text-sm text-zinc-400">Thành tiền</label>
                    <div className="w-full bg-zinc-900 border border-zinc-800 text-emerald-500 font-bold px-4 py-2.5 rounded-xl">
                      {finalPrice.toLocaleString('vi-VN')} đ
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="block text-sm text-zinc-400">Khách thanh toán trước</label>
                    <input
                      type="number"
                      value={paidAmount}
                      onChange={(e) => setPaidAmount(Number(e.target.value) || '')}
                      className="w-full bg-zinc-950 border border-zinc-800 text-white px-4 py-2.5 rounded-xl focus:outline-none focus:border-pink-500"
                      placeholder="0"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="block text-sm text-zinc-400">Phương thức</label>
                    <select
                      value={paymentMethod}
                      onChange={(e) => setPaymentMethod(e.target.value as any)}
                      className="w-full bg-zinc-950 border border-zinc-800 text-white px-4 py-2.5 rounded-xl focus:outline-none focus:border-pink-500"
                    >
                      <option value="transfer">Chuyển khoản</option>
                      <option value="cash">Tiền mặt</option>
                      <option value="card">Quẹt thẻ</option>
                    </select>
                  </div>
                </div>

                {Number(paidAmount) < finalPrice && (
                  <div className="bg-red-500/5 border border-red-500/20 p-4 rounded-xl space-y-4 mt-4">
                    <div className="flex justify-between items-center text-sm">
                      <span className="text-zinc-400">Số tiền còn nợ:</span>
                      <span className="text-red-400 font-bold">
                        {(finalPrice - Number(paidAmount)).toLocaleString('vi-VN')}đ
                      </span>
                    </div>
                    
                    <div>
                      <label className="block text-sm font-medium text-zinc-400 mb-1">Số kỳ thanh toán</label>
                      <select 
                        value={installmentCount}
                        onChange={e => setInstallmentCount(Number(e.target.value))}
                        className="w-full p-3 rounded-xl border border-zinc-800 bg-zinc-950 text-white focus:outline-none focus:border-red-500"
                      >
                        {[1, 2, 3, 4, 5, 6].map(n => (
                          <option key={n} value={n}>{n} kỳ</option>
                        ))}
                      </select>
                    </div>

                    <div className="space-y-3">
                      {installments.map((inst, idx) => (
                        <div key={`inst-renew-${idx}`} className="flex gap-2 items-center">
                          <div className="flex-1">
                            <label className="block text-xs text-zinc-500 mb-1">Hẹn trả kỳ {idx + 1}</label>
                            <input 
                              type="date" 
                              required
                              value={inst.date}
                              onChange={e => handleInstallmentChange(idx, 'date', e.target.value)}
                              className="w-full p-2.5 rounded-xl border border-zinc-800 bg-zinc-950 text-white focus:outline-none focus:border-red-500 text-sm" 
                            />
                          </div>
                          <div className="flex-1">
                            <label className="block text-xs text-zinc-500 mb-1">Số tiền (VNĐ)</label>
                            <input 
                              type="number" 
                              required
                              value={inst.amount}
                              onChange={e => handleInstallmentChange(idx, 'amount', Number(e.target.value))}
                              className="w-full p-2.5 rounded-xl border border-zinc-800 bg-zinc-950 text-white focus:outline-none focus:border-red-500 text-sm" 
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="space-y-2">
              <label className="block text-sm text-zinc-400">Ghi chú</label>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                className="w-full bg-zinc-950 border border-zinc-800 text-white px-4 py-3 rounded-xl focus:outline-none focus:border-pink-500 min-h-[80px] resize-none"
                placeholder="Ghi chú thêm về lần gia hạn này..."
              />
            </div>

          </form>
        </div>

        <div className="p-6 border-t border-zinc-800 bg-zinc-900/50 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="px-6 py-2.5 rounded-xl font-medium text-zinc-300 hover:text-white hover:bg-zinc-800 transition-colors"
            disabled={isSubmitting}
          >
            Hủy
          </button>
          <button
            type="submit"
            form="renew-form"
            disabled={!selectedPackage || isSubmitting}
            className="px-6 py-2.5 rounded-xl font-bold text-white bg-gradient-to-r from-pink-500 to-rose-500 hover:from-pink-600 hover:to-rose-600 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-pink-500/25 transition-all flex items-center gap-2"
          >
            {isSubmitting ? (
              <>
                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Đang xử lý...
              </>
            ) : (
              <>
                <RefreshCw className="w-5 h-5" />
                Xác nhận Gia hạn
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
