import React, { useState, useEffect, useMemo } from 'react';
import { Student, StudentContract, PaymentRecord, Installment, UserProfile, Branch } from '../../../types';
import { User } from 'firebase/auth';
import { DollarSign, TrendingUp, AlertCircle, Plus, CheckCircle, Clock, Calendar as CalendarIcon, X, Trash2, Undo2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import DateRangeFilter from './DateRangeFilter';
import { LOGO_URL } from '../../../constants';
import { useDatabase } from '../../../contexts/DatabaseContext';

interface Props {
  user: User | null;
  profile: UserProfile | null;
}

export default function FinanceManagement({ user, profile }: Props) {
  const { 
    branches, 
    contracts, 
    students, 
    payments, 
    sessions, 
    updateContract, 
    addPayment, 
    deletePayment,
    deleteContract,
    trainers,
    deleteSession,
    isMigrating
  } = useDatabase();

  const [selectedBranchId, setSelectedBranchId] = useState<string>('all');
  const [dateRange, setDateRange] = useState<{ start: Date, end: Date } | null>(null);
  const [isPaying, setIsPaying] = useState(false);
  const [showPaymentHistory, setShowPaymentHistory] = useState(false);
  const [selectedContract, setSelectedContract] = useState<StudentContract | null>(null);
  const [payAmount, setPayAmount] = useState('');
  const [installmentCount, setInstallmentCount] = useState(1);
  const [installments, setInstallments] = useState<{date: string, amount: number}[]>([]);
  const [showCleanupConfirm, setShowCleanupConfirm] = useState(false);
  const [paymentToDelete, setPaymentToDelete] = useState<string | null>(null);
  const [debtFilter, setDebtFilter] = useState<string>('all');
  const [alertMessage, setAlertMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!selectedContract || !isPaying) {
      setInstallments([]);
      return;
    }
    const remainingDebt = (selectedContract.totalPrice - (selectedContract.discount || 0)) - selectedContract.paidAmount - (Number(payAmount) || 0);
    if (remainingDebt > 0) {
      const base = Math.floor(remainingDebt / installmentCount);
      const rem = remainingDebt % installmentCount;
      setInstallments(prev => Array.from({ length: installmentCount }).map((_, i) => ({
        date: prev[i]?.date || '',
        amount: i === 0 ? base + rem : base
      })));
    } else {
      setInstallments([]);
    }
  }, [payAmount, installmentCount, selectedContract, isPaying]);

  const handleInstallmentChange = (index: number, field: 'date' | 'amount', value: string | number) => {
    const newInsts = [...installments];
    newInsts[index] = { ...newInsts[index], [field]: value };
    setInstallments(newInsts);
  };

  const filteredContracts = useMemo(() => {
    let filtered = contracts;
    if (profile?.branchId && profile.role !== 'admin') {
      filtered = filtered.filter(c => c.branchId === profile.branchId);
    }
    if (selectedBranchId !== 'all') {
      filtered = filtered.filter(c => selectedBranchId === 'none' ? !c.branchId : c.branchId === selectedBranchId);
    }
    return filtered;
  }, [contracts, profile, selectedBranchId]);

  const filteredPayments = useMemo(() => {
    // Generate missing payments from contracts
    const allPayments = [...payments];
    contracts.forEach(c => {
      const totalPaidForContract = payments
        .filter(p => p.contractId === c.id)
        .reduce((sum, p) => sum + p.amount, 0);
      
      if (c.paidAmount > totalPaidForContract) {
        allPayments.push({
          id: `auto-${c.id}`,
          contractId: c.id,
          studentId: c.studentId,
          amount: c.paidAmount - totalPaidForContract,
          date: c.startDate ? new Date(c.startDate).toISOString() : new Date().toISOString(),
          method: 'transfer',
          note: 'Thanh toán (tự động tạo - phần chênh lệch)'
        });
      }
    });

    let filtered = allPayments;
    if (profile?.branchId && profile.role !== 'admin') {
      filtered = filtered.filter(p => {
        const contract = contracts.find(c => c.id === p.contractId);
        return contract?.branchId === profile.branchId;
      });
    }
    if (selectedBranchId !== 'all') {
      filtered = filtered.filter(p => {
        const contract = contracts.find(c => c.id === p.contractId);
        const branchId = contract?.branchId;
        return selectedBranchId === 'none' ? !branchId : branchId === selectedBranchId;
      });
    }
    if (dateRange) {
      filtered = filtered.filter(p => {
        const contract = contracts.find(c => c.id === p.contractId);
        const pDate = contract?.startDate ? new Date(contract.startDate) : new Date(p.date);
        return pDate >= dateRange.start && pDate <= dateRange.end;
      });
    }
    return filtered;
  }, [payments, contracts, dateRange, profile, selectedBranchId]);

  const totalRevenue = filteredPayments.reduce((sum, p) => sum + p.amount, 0);
  const totalDebt = filteredContracts.reduce((sum, c) => {
    const debt = (c.totalPrice - (c.discount || 0)) - c.paidAmount;
    return debt > 0 ? sum + debt : sum;
  }, 0);

  const contractsWithDebt = useMemo(() => {
    if (debtFilter === 'overpaid') {
      return filteredContracts.filter(c => c.paidAmount > (c.totalPrice - (c.discount || 0)));
    }

    const withDebt = filteredContracts.filter(c => (c.totalPrice - (c.discount || 0)) > c.paidAmount);
    
    if (debtFilter === 'all') return withDebt;

    const now = new Date();
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - now.getDay());
    startOfWeek.setHours(0, 0, 0, 0);
    
    const endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(startOfWeek.getDate() + 6);
    endOfWeek.setHours(23, 59, 59, 999);

    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

    return withDebt.filter(c => {
      const pendingInstallments = c.installments?.filter(i => i.status === 'pending') || [];
      const nextInstallment = pendingInstallments.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())[0];
      const dueDateStr = nextInstallment?.date || c.nextPaymentDate;
      
      if (!dueDateStr) return debtFilter === 'all';
      
      const dueDate = new Date(dueDateStr);

      if (debtFilter === 'overdue') {
        if (c.status === 'frozen') return false;
        return dueDate < now;
      }
      if (debtFilter === 'this-week') {
        if (c.status === 'frozen') return false;
        return dueDate >= startOfWeek && dueDate <= endOfWeek;
      }
      if (debtFilter === 'this-month') {
        if (c.status === 'frozen') return false;
        return dueDate >= startOfMonth && dueDate <= endOfMonth;
      }
      return true;
    });
  }, [filteredContracts, debtFilter]);

  const contractsOverpaid = filteredContracts.filter(c => c.paidAmount > (c.totalPrice - (c.discount || 0)));

  const confirmCleanup = async () => {
    setShowCleanupConfirm(false);
    
    const validStudentIds = new Set(students.map(s => s.id).filter(Boolean));
    const validContractIds = new Set(contracts.map(c => c.id).filter(Boolean));
    
    const orphanedContracts = contracts.filter(c => !c.studentId || !validStudentIds.has(c.studentId));
    const orphanedPayments = payments.filter(p => !p.studentId || !validStudentIds.has(p.studentId) || !p.contractId || !validContractIds.has(p.contractId));
    const orphanedSessions = sessions.filter(s => !s.studentId || !validStudentIds.has(s.studentId));
    
    if (user) {
      try {
        await Promise.all([
          ...orphanedContracts.map(c => deleteContract(c.id)),
          ...orphanedPayments.map(p => deletePayment(p.id)),
          ...orphanedSessions.map(s => deleteSession(s.id))
        ]);
        setAlertMessage('Đã dọn dẹp dữ liệu mồ côi thành công!');
      } catch (e) {
        console.error("Error cleaning up data:", e);
        setAlertMessage("Có lỗi khi dọn dẹp dữ liệu!");
      }
    }
  };

  const cleanUpOrphanedData = () => {
    setShowCleanupConfirm(true);
  };

  const executeDeletePayment = async () => {
    if (!user || !paymentToDelete) return;
    
    const payment = payments.find(p => p.id === paymentToDelete);
    if (!payment) {
      setPaymentToDelete(null);
      return;
    }

    const contract = contracts.find(c => c.id === payment.contractId);
    
    if (contract) {
      const newPaidAmount = Math.max(0, contract.paidAmount - payment.amount);
      let newInstallments = payment.previousInstallments || [...(contract.installments || [])];
      
      if (!payment.previousInstallments) {
        let amountToRevert = payment.amount;
        let exactMatchIndex = -1;
        for (let i = newInstallments.length - 1; i >= 0; i--) {
          if (newInstallments[i].status === 'paid' && newInstallments[i].amount === amountToRevert) {
            exactMatchIndex = i;
            break;
          }
        }
        
        if (exactMatchIndex >= 0) {
          newInstallments[exactMatchIndex] = { ...newInstallments[exactMatchIndex], status: 'pending' };
        } else {
          newInstallments.push({
            id: Date.now().toString(),
            amount: amountToRevert,
            date: new Date().toISOString().split('T')[0],
            status: 'pending'
          });
        }
      }

      const pendingInstallments = newInstallments.filter(i => i.status === 'pending');
      pendingInstallments.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

      let referralCommissionAmount = contract.referralCommission || null;
      if (contract.referralCode) {
        const referringPT = trainers.find(t => t.employeeCode === contract.referralCode);
        if (referringPT) {
          referralCommissionAmount = newPaidAmount * (referringPT.commissionRate / 100);
        }
      }

      const updatedContract = {
        ...contract,
        paidAmount: newPaidAmount,
        installments: newInstallments,
        referralCommission: referralCommissionAmount,
        nextPaymentDate: pendingInstallments.length > 0 ? pendingInstallments[0].date : null
      };

      try {
        await updateContract(updatedContract);
        await deletePayment(paymentToDelete);
        setAlertMessage('Đã hoàn tác phiếu thu và khôi phục công nợ thành công!');
      } catch (e) {
        console.error("Error deleting payment:", e);
        setAlertMessage("Có lỗi khi hoàn tác phiếu thu!");
      }
    } else {
      try {
        await deletePayment(paymentToDelete);
        setAlertMessage('Đã xóa phiếu thu thành công!');
      } catch (e) {
        console.error("Error deleting payment:", e);
        setAlertMessage("Có lỗi khi xóa phiếu thu!");
      }
    }
    
    setPaymentToDelete(null);
  };

  const handlePayment = async () => {
    if (!selectedContract || !payAmount || isSubmitting) return;
    setIsSubmitting(true);
    const amount = Number(payAmount);
    if (amount === 0) {
      setIsSubmitting(false);
      return;
    }
    
    const remainingDebt = (selectedContract.totalPrice - (selectedContract.discount || 0)) - selectedContract.paidAmount - amount;
    
    let finalInstallments: Installment[] = selectedContract.installments ? [...selectedContract.installments] : [];
    
    // Check if the payment exactly matches a pending installment
    const matchingInstallmentIndex = finalInstallments.findIndex(i => i.status === 'pending' && i.amount === amount);
    let matchedInstallmentId: string | undefined;
    
    if (matchingInstallmentIndex !== -1) {
      // Exact match found, just mark it as paid
      matchedInstallmentId = finalInstallments[matchingInstallmentIndex].id;
      finalInstallments[matchingInstallmentIndex] = {
        ...finalInstallments[matchingInstallmentIndex],
        status: 'paid'
      };
    } else {
      // No exact match, recreate the installment plan
      // Preserve existing paid installments
      const existingPaidInstallments = finalInstallments.filter(i => i.status === 'paid');
      
      // Create a new paid installment for the current payment
      const newPaidInstallment: Installment = {
        id: Date.now().toString() + '-paid',
        amount: amount,
        date: new Date().toISOString().split('T')[0],
        status: 'paid'
      };
      matchedInstallmentId = newPaidInstallment.id;

      finalInstallments = [...existingPaidInstallments, newPaidInstallment];
      
      if (remainingDebt > 0) {
        const sum = installments.reduce((a, b) => a + b.amount, 0);
        if (sum !== remainingDebt) {
          setAlertMessage('Tổng số tiền các kỳ phải bằng số tiền còn nợ!');
          setIsSubmitting(false);
          return;
        }
        if (installments.some(i => !i.date)) {
          setAlertMessage('Vui lòng chọn ngày hẹn trả cho tất cả các kỳ!');
          setIsSubmitting(false);
          return;
        }
        const newPendingInstallments = installments.map((inst, idx) => ({
          id: Date.now().toString() + '-' + idx,
          amount: inst.amount,
          date: inst.date,
          status: 'pending' as const
        }));
        finalInstallments = [...finalInstallments, ...newPendingInstallments];
      }
    }

    const newPayment: PaymentRecord = {
      id: Date.now().toString(),
      contractId: selectedContract.id,
      studentId: selectedContract.studentId,
      amount: amount,
      date: new Date().toISOString(),
      method: 'transfer',
      note: amount < 0 ? 'Hoàn tiền nợ/dư' : 'Thanh toán công nợ',
      previousInstallments: selectedContract.installments || [],
      installmentId: matchedInstallmentId
    };

    const newPaidAmount = selectedContract.paidAmount + amount;
    let referralCommissionAmount = selectedContract.referralCommission || null;
    if (selectedContract.referralCode) {
      const referringPT = trainers.find(t => t.employeeCode === selectedContract.referralCode);
      if (referringPT) {
        referralCommissionAmount = newPaidAmount * (referringPT.commissionRate / 100);
      }
    }

    const updatedContract = {
      ...selectedContract,
      paidAmount: newPaidAmount,
      installments: finalInstallments,
      referralCommission: referralCommissionAmount,
    };
    
    const pendingInstallments = finalInstallments.filter(i => i.status === 'pending');
    pendingInstallments.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    
    if (pendingInstallments.length > 0) {
      updatedContract.nextPaymentDate = pendingInstallments[0].date;
    } else {
      updatedContract.nextPaymentDate = null;
    }

    if (user) {
      try {
        await updateContract(updatedContract);
        await addPayment(newPayment);
      } catch (e) {
        console.error("Error saving payment:", e);
        setAlertMessage("Có lỗi khi lưu phiếu thu!");
      }
    }

    setIsPaying(false);
    setSelectedContract(null);
    setPayAmount('');
    setInstallmentCount(1);
    setInstallments([]);
    setIsSubmitting(false);
  };

  const getStudentName = (id: string) => {
    return students.find(s => s.id === id)?.name || 'Học viên ẩn (Đã xóa)';
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-300">
      <div className="flex justify-between items-start">
        <div className="mb-8 flex items-center gap-3">
          <img src={LOGO_URL} alt="Aura" className="h-10 w-10 object-contain" />
          <div>
            <h1 className="text-3xl md:text-4xl font-serif font-medium text-pink-500 drop-shadow-[0_0_10px_rgba(236,72,153,0.8)] tracking-tight border-b-4 border-pink-500/30 pb-2 inline-block shadow-[0_6px_0_rgba(236,72,153,0.2)] rounded-2xl">
              Tài chính
            </h1>
            <p className="text-zinc-400 mt-2">Quản lý doanh thu và công nợ</p>
          </div>
        </div>
        {profile?.role === 'admin' && (
          <button 
            onClick={cleanUpOrphanedData}
            className="bg-red-500/10 text-red-500 hover:bg-red-500 hover:text-white px-4 py-2 rounded-xl text-sm font-medium transition-colors border border-red-500/20"
          >
            Dọn dẹp dữ liệu mồ côi
          </button>
        )}
      </div>

      <div className="flex flex-wrap gap-2 items-center">
        <DateRangeFilter onFilter={(start, end) => setDateRange({ start, end })} />
        <select 
          value={selectedBranchId}
          onChange={(e) => setSelectedBranchId(e.target.value)}
          className="bg-zinc-900 text-zinc-300 text-sm font-medium px-4 py-2 rounded-xl border border-zinc-800 focus:outline-none focus:border-pink-500"
        >
          <option value="all">Tất cả chi nhánh</option>
          <option value="none">Chưa phân chi nhánh</option>
          {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
      </div>
      
      {/* Overview Cards */}
      <div className="grid grid-cols-2 gap-4">
        <button 
          onClick={() => setShowPaymentHistory(true)}
          className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 shadow-sm relative overflow-hidden text-left hover:border-emerald-500/50 transition-colors"
        >
          <div className="absolute -right-4 -top-4 w-16 h-16 bg-emerald-500/10 rounded-full blur-xl"></div>
          <div className="flex items-center gap-2 mb-2">
            <div className="p-2 bg-emerald-500/20 rounded-lg text-emerald-500">
              <TrendingUp className="w-4 h-4" />
            </div>
            <span className="text-zinc-400 text-sm font-medium">Đã thu</span>
          </div>
          <p className="text-xl font-bold text-white">
            {totalRevenue.toLocaleString('vi-VN')}đ
          </p>
        </button>

        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 shadow-sm relative overflow-hidden">
          <div className="absolute -right-4 -top-4 w-16 h-16 bg-red-500/10 rounded-full blur-xl"></div>
          <div className="flex items-center gap-2 mb-2">
            <div className="p-2 bg-red-500/20 rounded-lg text-red-500">
              <AlertCircle className="w-4 h-4" />
            </div>
            <span className="text-zinc-400 text-sm font-medium">Công nợ</span>
          </div>
          <p className="text-xl font-bold text-white">
            {totalDebt.toLocaleString('vi-VN')}đ
          </p>
        </div>
      </div>

      {/* Debt List */}
      <div>
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-4">
          <h3 className="text-lg font-bold text-white flex items-center gap-2">
            <DollarSign className="w-5 h-5 text-pink-500" />
            Danh sách cần thu
            <span className="text-sm font-normal text-zinc-400 bg-zinc-800 px-2 py-0.5 rounded-full ml-1">
              (Tổng: {Math.abs(contractsWithDebt.reduce((sum, c) => sum + ((c.totalPrice - (c.discount || 0)) - c.paidAmount), 0)).toLocaleString('vi-VN')}đ)
            </span>
          </h3>
          
          <div className="flex flex-wrap gap-2">
            {[
              { id: 'all', label: 'Tất cả' },
              { id: 'overdue', label: 'Quá hạn' },
              { id: 'this-week', label: 'Tuần này' },
              { id: 'this-month', label: 'Tháng này' },
              { id: 'overpaid', label: 'Thanh toán dư' },
            ].map(filter => (
              <button
                key={filter.id}
                onClick={() => setDebtFilter(filter.id as 'all' | 'unpaid' | 'overdue' | 'overpaid')}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  debtFilter === filter.id 
                    ? 'bg-pink-500 text-white shadow-[0_0_10px_rgba(236,72,153,0.4)]' 
                    : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
                }`}
              >
                {filter.label}
              </button>
            ))}
          </div>
        </div>
        
        <div className="space-y-3">
          {contractsWithDebt.length > 0 ? (
            contractsWithDebt.map(contract => {
              const debtAmount = (contract.totalPrice - (contract.discount || 0)) - contract.paidAmount;
              const pendingInstallments = contract.installments?.filter(i => i.status === 'pending') || [];
              const nextInstallment = pendingInstallments.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())[0];
              
              // Fallback to nextPaymentDate if no installments
              const isOverdue = contract.status !== 'frozen' && (nextInstallment 
                ? new Date(nextInstallment.date) < new Date()
                : (contract.nextPaymentDate && new Date(contract.nextPaymentDate) < new Date()));
              
              return (
                <div key={contract.id} className={`bg-zinc-900 border rounded-2xl p-4 flex justify-between items-center shadow-sm transition-colors ${isOverdue ? 'border-red-500/50 bg-red-500/5' : 'border-zinc-800'}`}>
                  <div>
                    <div className="flex items-center gap-2">
                      <h4 className="text-white font-medium">{getStudentName(contract.studentId)}</h4>
                      {isOverdue && debtAmount > 0 && (
                        <span className="text-[10px] font-bold uppercase tracking-wider bg-red-500 text-white px-2 py-0.5 rounded-full animate-pulse">
                          Quá hạn
                        </span>
                      )}
                      {debtAmount < 0 && (
                        <span className="text-[10px] font-bold uppercase tracking-wider bg-emerald-500 text-white px-2 py-0.5 rounded-full">
                          Thanh toán dư
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-zinc-500 mt-1">{contract.packageName}</p>
                    <div className="flex items-center gap-4 mt-2">
                      {debtAmount > 0 ? (
                        <p className="text-sm font-bold text-red-400">Nợ: {debtAmount.toLocaleString('vi-VN')}đ</p>
                      ) : (
                        <p className="text-sm font-bold text-emerald-400">Dư: {Math.abs(debtAmount).toLocaleString('vi-VN')}đ</p>
                      )}
                      {debtAmount > 0 && (nextInstallment || contract.nextPaymentDate) && (
                        <div className={`flex items-center gap-1 text-xs ${isOverdue ? 'text-red-400 font-medium' : 'text-zinc-500'}`}>
                          <Clock className="w-3 h-3" />
                          Kỳ tiếp: {new Date(nextInstallment?.date || contract.nextPaymentDate!).toLocaleDateString('vi-VN')}
                          {nextInstallment && ` (${nextInstallment.amount.toLocaleString('vi-VN')}đ)`}
                        </div>
                      )}
                    </div>
                  </div>
                  <button 
                    onClick={() => {
                      setSelectedContract(contract);
                      setPayAmount(debtAmount.toString());
                      setIsPaying(true);
                    }}
                    className="p-3 bg-pink-500/10 text-pink-500 hover:bg-pink-500 hover:text-white rounded-xl transition-colors"
                  >
                    <Plus className="w-5 h-5" />
                  </button>
                </div>
              );
            })
          ) : (
            <div className="text-center py-10 bg-zinc-900 border border-zinc-800 rounded-2xl">
              <CheckCircle className="w-10 h-10 text-emerald-500 mx-auto mb-3 opacity-50" />
              <p className="text-zinc-400">Tuyệt vời! Không có công nợ nào.</p>
            </div>
          )}
        </div>
      </div>

      {/* Overpaid Contracts List */}
      {contractsOverpaid.length > 0 && (
        <div className="mt-8">
          <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
            <AlertCircle className="w-5 h-5 text-amber-500" />
            Hợp đồng thanh toán dư
          </h3>
          <div className="space-y-3">
            {contractsOverpaid.map(contract => (
              <div key={contract.id} className="bg-amber-500/5 border border-amber-500/20 rounded-2xl p-4 flex justify-between items-center">
                <div>
                  <h4 className="text-white font-medium">{getStudentName(contract.studentId)}</h4>
                  <p className="text-xs text-zinc-500 mt-1">{contract.packageName}</p>
                </div>
                <p className="text-sm font-bold text-amber-400">Dư: {(contract.paidAmount - (contract.totalPrice - (contract.discount || 0))).toLocaleString('vi-VN')}đ</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Payment History Modal */}
      <AnimatePresence>
        {showPaymentHistory && (
          <div className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/80 backdrop-blur-sm"
              onClick={() => setShowPaymentHistory(false)}
            />
            <motion.div 
              initial={{ opacity: 0, y: '100%' }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: '100%' }}
              className="relative w-full max-w-lg bg-zinc-900 rounded-3xl p-6 shadow-2xl border border-zinc-800 max-h-[80vh] overflow-y-auto"
            >
              <div className="flex justify-between items-center mb-6">
                <h3 className="text-xl font-bold text-white">Lịch sử phiếu thu</h3>
                <button onClick={() => setShowPaymentHistory(false)} className="text-zinc-400 hover:text-white">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="space-y-3">
                {filteredPayments.length > 0 ? (
                  filteredPayments.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()).map(p => (
                    <div key={p.id} className="p-4 bg-zinc-950 rounded-xl border border-zinc-800 flex justify-between items-center">
                      <div>
                        <p className="text-white font-medium">{getStudentName(p.studentId)}</p>
                        <p className="text-xs text-zinc-500">{new Date(p.date).toLocaleDateString('vi-VN')}</p>
                      </div>
                      <div className="flex items-center gap-3">
                        <p className="text-emerald-400 font-bold">{p.amount.toLocaleString('vi-VN')}đ</p>
                        {!p.id.startsWith('auto-') && (
                          <button 
                            onClick={() => setPaymentToDelete(p.id)}
                            className="p-2 text-zinc-500 hover:text-amber-400 hover:bg-amber-400/10 rounded-lg transition-colors flex items-center gap-1"
                            title="Hoàn tác phiếu thu"
                          >
                            <Undo2 className="w-4 h-4" />
                            <span className="text-xs font-medium hidden sm:inline">Hoàn tác</span>
                          </button>
                        )}
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="text-center text-zinc-500 py-10">Chưa có lịch sử thu tiền.</p>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Payment Modal */}
      <AnimatePresence>
        {isPaying && selectedContract && (
          <div key="payment-modal" className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/80 backdrop-blur-sm"
              onClick={() => setIsPaying(false)}
            />
            <motion.div 
              initial={{ opacity: 0, y: '100%' }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: '100%' }}
              className="relative w-full max-w-md bg-zinc-900 rounded-3xl p-6 shadow-2xl border border-zinc-800"
            >
              <h3 className="text-xl font-bold text-white mb-2">Thanh toán công nợ</h3>
              <p className="text-zinc-400 text-sm mb-6">
                Học viên: <span className="text-white font-medium">{getStudentName(selectedContract.studentId)}</span>
              </p>

              <div className="space-y-4">
                <div className="bg-zinc-950 p-4 rounded-xl border border-zinc-800">
                  <div className="flex justify-between text-sm mb-2">
                    <span className="text-zinc-500">Tổng tiền gói:</span>
                    <span className="text-zinc-300">{(selectedContract.totalPrice - (selectedContract.discount || 0)).toLocaleString('vi-VN')}đ</span>
                  </div>
                  <div className="flex justify-between text-sm mb-2">
                    <span className="text-zinc-500">Đã thanh toán:</span>
                    <span className="text-zinc-300">{selectedContract.paidAmount.toLocaleString('vi-VN')}đ</span>
                  </div>
                  <div className="flex justify-between font-bold pt-2 border-t border-zinc-800">
                    <span className="text-zinc-400">Còn nợ:</span>
                    {((selectedContract.totalPrice - (selectedContract.discount || 0)) - selectedContract.paidAmount) >= 0 ? (
                      <span className="text-red-400">{((selectedContract.totalPrice - (selectedContract.discount || 0)) - selectedContract.paidAmount).toLocaleString('vi-VN')}đ</span>
                    ) : (
                      <span className="text-emerald-400">Dư {Math.abs((selectedContract.totalPrice - (selectedContract.discount || 0)) - selectedContract.paidAmount).toLocaleString('vi-VN')}đ</span>
                    )}
                  </div>
                </div>

                {selectedContract.installments && selectedContract.installments.filter(i => i.status === 'pending').length > 0 && (
                  <div className="mb-4">
                    <label className="block text-sm font-medium text-zinc-400 mb-2">Chọn nhanh kỳ thanh toán</label>
                    <div className="flex flex-wrap gap-2">
                      {selectedContract.installments.filter(i => i.status === 'pending').map((inst, idx) => (
                        <button
                          key={inst.id}
                          onClick={() => setPayAmount(inst.amount.toString())}
                          className="px-3 py-1.5 rounded-lg border border-zinc-700 bg-zinc-800 text-zinc-300 hover:bg-zinc-700 hover:text-white transition-colors text-sm flex items-center gap-2"
                        >
                          <span>Kỳ {selectedContract.installments!.findIndex(i => i.id === inst.id) + 1}</span>
                          <span className="font-bold text-pink-400">{inst.amount.toLocaleString('vi-VN')}đ</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <div>
                  <label className="block text-sm font-medium text-zinc-400 mb-1">Số tiền thanh toán đợt này (VNĐ) <span className="text-xs text-zinc-500">- Nhập số âm (-) để hoàn tiền</span></label>
                  <input 
                    type="number" 
                    value={payAmount}
                    onChange={e => setPayAmount(e.target.value)}
                    className="w-full p-3 rounded-xl border border-zinc-800 bg-zinc-950 text-white focus:outline-none focus:border-pink-500 text-lg font-bold" 
                  />
                </div>

                {Number(payAmount) > 0 && Number(payAmount) < ((selectedContract.totalPrice - (selectedContract.discount || 0)) - selectedContract.paidAmount) && 
                 (!selectedContract.installments || !selectedContract.installments.some(i => i.status === 'pending' && i.amount === Number(payAmount))) && (
                  <motion.div 
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    className="bg-red-500/5 border border-red-500/20 p-4 rounded-xl space-y-4"
                  >
                    <div className="flex justify-between items-center text-sm">
                      <span className="text-zinc-400">Số tiền còn nợ sau khi trả:</span>
                      <span className="text-red-400 font-bold">
                        {(((selectedContract.totalPrice - (selectedContract.discount || 0)) - selectedContract.paidAmount) - Number(payAmount)).toLocaleString('vi-VN')}đ
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
                        <div key={`inst-finance-${idx}`} className="flex gap-2 items-center">
                          <div className="flex-1">
                            <label className="block text-xs text-zinc-500 mb-1">Hẹn trả kỳ {idx + 1}</label>
                            <input 
                              type="date" 
                              value={inst.date}
                              onChange={e => handleInstallmentChange(idx, 'date', e.target.value)}
                              className="w-full p-2.5 rounded-xl border border-zinc-800 bg-zinc-950 text-white focus:outline-none focus:border-red-500 text-sm" 
                            />
                          </div>
                          <div className="flex-1">
                            <label className="block text-xs text-zinc-500 mb-1">Số tiền (VNĐ)</label>
                            <input 
                              type="number" 
                              value={inst.amount}
                              onChange={e => handleInstallmentChange(idx, 'amount', Number(e.target.value))}
                              className="w-full p-2.5 rounded-xl border border-zinc-800 bg-zinc-950 text-white focus:outline-none focus:border-red-500 text-sm" 
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  </motion.div>
                )}

                <div className="pt-4 flex gap-3">
                  <button 
                    onClick={() => setIsPaying(false)}
                    className="flex-1 py-3 rounded-xl font-medium text-zinc-400 bg-zinc-800 hover:bg-zinc-700 transition-colors"
                  >
                    Hủy
                  </button>
                  <button 
                    onClick={handlePayment}
                    disabled={!payAmount || Number(payAmount) === 0 || isSubmitting}
                    className={`flex-1 py-3 rounded-xl font-medium text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-lg ${
                      Number(payAmount) < 0 
                        ? 'bg-amber-500 hover:bg-amber-600 shadow-[0_0_15px_rgba(245,158,11,0.4)]' 
                        : 'bg-emerald-500 hover:bg-emerald-600 shadow-[0_0_15px_rgba(16,185,129,0.4)]'
                    }`}
                  >
                    {Number(payAmount) < 0 ? 'Xác nhận hoàn tiền' : 'Xác nhận thu'}
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Confirm Cleanup Modal */}
      <AnimatePresence>
        {showCleanupConfirm && (
          <div key="cleanup-confirm" className="fixed inset-0 z-[70] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/80 backdrop-blur-sm"
              onClick={() => setShowCleanupConfirm(false)}
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="relative w-full max-w-md bg-zinc-900 rounded-3xl p-6 shadow-2xl border border-red-500/30 text-center"
            >
              <div className="w-16 h-16 bg-red-500/20 text-red-500 rounded-full flex items-center justify-center mx-auto mb-4">
                <AlertCircle className="w-8 h-8" />
              </div>
              <h3 className="text-xl font-bold text-white mb-2">Xác nhận dọn dẹp</h3>
              <p className="text-zinc-400 mb-6">
                Bạn có chắc chắn muốn xóa toàn bộ hợp đồng, lịch sử thanh toán và buổi tập của những học viên đã bị xóa? Thao tác này sẽ làm thay đổi báo cáo doanh thu và công nợ.
              </p>
              <div className="flex gap-3">
                <button 
                  onClick={() => setShowCleanupConfirm(false)}
                  className="flex-1 py-3 rounded-xl font-medium text-zinc-400 bg-zinc-800 hover:bg-zinc-700 transition-colors"
                >
                  Hủy
                </button>
                <button 
                  onClick={confirmCleanup}
                  className="flex-1 py-3 rounded-xl font-medium text-white bg-red-500 hover:bg-red-600 transition-colors shadow-[0_0_15px_rgba(239,68,68,0.4)]"
                >
                  Đồng ý xóa
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Confirm Delete Payment Modal */}
      <AnimatePresence>
        {paymentToDelete && (
          <div key="delete-payment-confirm" className="fixed inset-0 z-[70] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/80 backdrop-blur-sm"
              onClick={() => setPaymentToDelete(null)}
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="relative w-full max-w-md bg-zinc-900 rounded-3xl p-6 shadow-2xl border border-zinc-800 text-center"
            >
              <div className="w-16 h-16 bg-red-500/20 text-red-500 rounded-full flex items-center justify-center mx-auto mb-4">
                <AlertCircle className="w-8 h-8" />
              </div>
              <h3 className="text-xl font-bold text-white mb-2">Hoàn tác phiếu thu?</h3>
              <p className="text-zinc-400 mb-6">
                Bạn có chắc chắn muốn hoàn tác phiếu thu này? Số tiền đã thu sẽ được hoàn lại vào công nợ của học viên và lịch trả góp sẽ được khôi phục.
              </p>
              <div className="flex gap-3">
                <button 
                  onClick={() => setPaymentToDelete(null)}
                  className="flex-1 py-3 rounded-xl font-medium text-zinc-400 bg-zinc-800 hover:bg-zinc-700 transition-colors"
                >
                  Hủy
                </button>
                <button 
                  onClick={executeDeletePayment}
                  className="flex-1 py-3 rounded-xl font-medium text-white bg-amber-500 hover:bg-amber-600 transition-colors shadow-[0_0_15px_rgba(245,158,11,0.4)]"
                >
                  Đồng ý hoàn tác
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Alert Modal */}
      <AnimatePresence>
        {alertMessage && (
          <div key="alert-modal" className="fixed inset-0 z-[80] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/80 backdrop-blur-sm"
              onClick={() => setAlertMessage(null)}
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="relative w-full max-w-sm bg-zinc-900 rounded-3xl p-6 shadow-2xl border border-zinc-800 text-center"
            >
              <div className="w-16 h-16 bg-pink-500/20 text-pink-500 rounded-full flex items-center justify-center mx-auto mb-4">
                <AlertCircle className="w-8 h-8" />
              </div>
              <p className="text-white font-medium mb-6">{alertMessage}</p>
              <button 
                onClick={() => setAlertMessage(null)}
                className="w-full py-3 rounded-xl font-medium text-white bg-pink-500 hover:bg-pink-600 transition-colors shadow-[0_0_15px_rgba(236,72,153,0.4)]"
              >
                Đóng
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
