import React, { useState, useEffect, useCallback } from 'react';
import { Student, StudentContract, TrainingPackage, Installment, Trainer, Branch, Session, DailyCheckin } from '../../../types';
import { ArrowLeft, CheckCircle, Plus, Activity, History, FileText, CreditCard, Calendar as CalendarIcon, AlertCircle, TrendingUp, Package, ClipboardCheck, Droplets, Moon, Smile, Zap, RefreshCw, Edit, User as UserIcon, CalendarClock, Dumbbell, Trash2, Utensils, Bot, ImagePlus, UploadCloud, X, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import ContractInvoice from './ContractInvoice';
import EditContractModal from './EditContractModal';
import ExtendContractModal from './ExtendContractModal';
import AddSessionsModal from './AddSessionsModal';
import RenewContractModal from './RenewContractModal';
import CancelContractModal from './CancelContractModal';
import StudentProgressAdmin from './StudentProgressAdmin';
import MealAnalysis from './MealAnalysis';
import ConfirmationModal from '../../schedule/ConfirmationModal';
import WorkoutLoggerModal from '../../schedule/WorkoutLoggerModal';
import { useDatabase } from '../../../contexts/DatabaseContext';
import { formatDate, isSameDayOrAfter } from '../../../utils/dateUtils';
import { getActiveContract } from '../../../utils/scheduler';

interface Props {
  student: Student;
  profile?: unknown;
  contracts: StudentContract[];
  packages: TrainingPackage[];
  trainers: Trainer[];
  branches: Branch[];
  sessions: Session[];
  onBack: () => void;
  onSaveContract: (contract: StudentContract) => void;
  onUpdateContract: (contract: StudentContract, skipPayment?: boolean) => void;
}

import TrainerPrioritySelector from './TrainerPrioritySelector';

export default function StudentDetail({ student, profile, contracts, packages, trainers, branches, sessions, onBack, onSaveContract, onUpdateContract }: Props) {
  const isTrainer = (profile as any)?.role === 'trainer';
  const { dailyCheckins: allDailyCheckins, payments, addPayment, deletePayment, sessionRequests, leaveRequests, workoutLogs, deleteWorkoutLog, addSession } = useDatabase();
  const [isAddingPackage, setIsAddingPackage] = useState(false);
  const [selectedPackageId, setSelectedPackageId] = useState('');
  const [selectedTrainerIds, setSelectedTrainerIds] = useState<string[]>([]);
  const [nutritionPTIds, setNutritionPTIds] = useState<string[]>([]);
  const [selectedBranchId, setSelectedBranchId] = useState('');
  const [startDate, setStartDate] = useState(new Date().toISOString().split('T')[0]);
  const [endDate, setEndDate] = useState('');
  const [customPackageName, setCustomPackageName] = useState('Gói tuỳ chỉnh');
  const [customTotalSessions, setCustomTotalSessions] = useState(0);
  const [customDurationMonths, setCustomDurationMonths] = useState(1);
  const [customPrice, setCustomPrice] = useState(0);
  const [paidAmount, setPaidAmount] = useState('');
  const [discount, setDiscount] = useState('');
  const [installmentCount, setInstallmentCount] = useState(1);
  const [installments, setInstallments] = useState<{date: string, amount: number}[]>([]);
  const [viewingContract, setViewingContract] = useState<StudentContract | null>(null);
  const [editingContract, setEditingContract] = useState<StudentContract | null>(null);
  const [extendingContract, setExtendingContract] = useState<StudentContract | null>(null);
  const [renewingContract, setRenewingContract] = useState<StudentContract | null>(null);
  const [cancelingContract, setCancelingContract] = useState<StudentContract | null>(null);
  const [addingSessionsContract, setAddingSessionsContract] = useState<StudentContract | null>(null);
  const [isManagingDebt, setIsManagingDebt] = useState(false);
  const [payingInstallmentId, setPayingInstallmentId] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<{title: string, message: string, onConfirm: () => void} | null>(null);
  const [notification, setNotification] = useState<{message: string, type: 'success' | 'error'} | null>(null);
  const [referralCode, setReferralCode] = useState('');
  const [activeTab, setActiveTab] = useState<'info' | 'progress' | 'history' | 'checkin' | 'requests' | 'workout_logs' | 'nutrition'>(isTrainer ? 'progress' : 'info');
  const [dailyCheckins, setDailyCheckins] = useState<DailyCheckin[]>([]);
  const [loadingCheckins, setLoadingCheckins] = useState(false);
  const [sessionFilter, setSessionFilter] = useState<'upcoming' | 'history' | 'this_week'>('upcoming');

  useEffect(() => {
    if (notification) {
      const timer = setTimeout(() => setNotification(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [notification]);

  const activeContract = getActiveContract(student.id, contracts);
  const historyContracts = contracts.filter(c => c.studentId === student.id && c.id !== activeContract?.id);
  const studentSessions = sessions.filter(s => s.studentId === student.id);

  const getWeekRange = (weekOffset: number = 0) => {
    const now = new Date();
    const currentDay = now.getDay();
    const diff = currentDay === 0 ? -6 : 1 - currentDay; // Monday is 1, Sunday is 0
    const monday = new Date(now);
    monday.setDate(now.getDate() + diff + weekOffset * 7);
    monday.setHours(0, 0, 0, 0);

    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    sunday.setHours(23, 59, 59, 999);

    return { start: monday, end: sunday };
  };

  const mySessionRequests = React.useMemo(() => sessionRequests?.filter(r => r.studentId === student.id) || [], [sessionRequests, student.id]);
  const myLeaveRequests = React.useMemo(() => leaveRequests?.filter(r => r.studentId === student.id) || [], [leaveRequests, student.id]);
  const studentWorkoutLogs = React.useMemo(() => workoutLogs?.filter(log => log.studentId === student.id).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()) || [], [workoutLogs, student.id]);
  const [showWorkoutLogger, setShowWorkoutLogger] = useState(false);

  const groupedWorkoutLogs = React.useMemo(() => {
    const groups: Record<string, typeof studentWorkoutLogs> = {};
    studentWorkoutLogs.forEach(log => {
      const d = log.date || new Date().toISOString().split('T')[0];
      if(!groups[d]) groups[d] = [];
      groups[d].push(log);
    });
    return Object.entries(groups).sort((a,b) => new Date(b[0]).getTime() - new Date(a[0]).getTime());
  }, [studentWorkoutLogs]);

  const [editingWorkoutLog, setEditingWorkoutLog] = useState<any>(null);

  const allRequests = React.useMemo(() => {
    const combined = [
      ...mySessionRequests.map(r => ({ ...r, reqType: 'session' as const })),
      ...myLeaveRequests.map(r => ({ ...r, reqType: 'leave' as const }))
    ];
    return combined.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [mySessionRequests, myLeaveRequests]);

  const filteredSessions = React.useMemo(() => {
    const now = new Date();
    
    if (sessionFilter === 'this_week') {
      const range = getWeekRange(0);
      return studentSessions.filter(s => {
        if (!s.date) return false;
        const [year, month, day] = s.date.split('T')[0].split('-').map(Number);
        const d = new Date(year, month - 1, day);
        return d >= range.start && d <= range.end;
      });
    } else if (sessionFilter === 'upcoming') {
      return studentSessions.filter(s => isSameDayOrAfter(s.date, now) && s.status === 'scheduled');
    } else {
      return studentSessions.filter(s => s.status !== 'scheduled');
    }
  }, [studentSessions, sessionFilter]);

  useEffect(() => {
    if (activeTab === 'checkin') {
      setLoadingCheckins(true);
      const checkins = allDailyCheckins
        .filter(c => c.studentId === student.id)
        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      setDailyCheckins(checkins);
      setLoadingCheckins(false);
    }
  }, [activeTab, student.id, allDailyCheckins]);

  useEffect(() => {
    if (selectedPackageId === 'custom') {
      if (startDate) {
        const start = new Date(startDate);
        const end = new Date(start.getTime() + customDurationMonths * 30 * 24 * 60 * 60 * 1000);
        setEndDate(end.toISOString().split('T')[0]);
      }
      return;
    }

    const pkg = packages.find(p => p.id === selectedPackageId);
    if (!pkg) {
      setEndDate('');
      return;
    }
    
    if (startDate) {
      const start = new Date(startDate);
      const end = new Date(start.getTime() + pkg.durationMonths * 30 * 24 * 60 * 60 * 1000);
      setEndDate(end.toISOString().split('T')[0]);
    }
  }, [selectedPackageId, packages, startDate, customDurationMonths]);

  useEffect(() => {
    if (selectedPackageId === 'custom') {
      const discountAmount = Number(discount) || 0;
      const debt = Math.max(0, customPrice - discountAmount - (Number(paidAmount) || 0));
      if (debt <= 0) {
        setInstallments([]);
      } else {
        setInstallments(prev => {
          const base = Math.floor(debt / installmentCount);
          const rem = debt % installmentCount;
          return Array.from({ length: installmentCount }).map((_, i) => ({
            date: prev[i]?.date || '',
            amount: i === 0 ? base + rem : base
          }));
        });
      }
      return;
    }

    const pkg = packages.find(p => p.id === selectedPackageId);
    if (!pkg) {
      setInstallments([]);
      return;
    }

    const discountAmount = Number(discount) || 0;
    const debt = (pkg.price - discountAmount) - (Number(paidAmount) || 0);
    
    if (debt > 0) {
      setInstallments(prev => {
        // Only recalculate if the number of installments changed or the total debt changed
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
  }, [installmentCount, paidAmount, discount, selectedPackageId, packages]);

  const handleInstallmentChange = (index: number, field: 'date' | 'amount', value: string | number) => {
    const newInsts = [...installments];
    newInsts[index] = { ...newInsts[index], [field]: value };
    setInstallments(newInsts);
  };

  const handleCheckIn = async () => {
    if (!activeContract) return;
    if (activeContract.status === 'frozen') {
      alert('Hợp đồng đang bảo lưu, không thể điểm danh!');
      return;
    }
    if (activeContract.usedSessions >= activeContract.totalSessions) {
      alert('Gói tập đã hết buổi!');
      return;
    }
    
    // Create a manual session record
    const now = new Date();
    const dateStr = now.toISOString().split('T')[0];
    const hour = now.getHours();
    
    // Fallback to first trainer if exists, else 'none'
    const sessionTrainerId = activeContract.trainerIds?.[0] || activeContract.trainerId || 'none';
    const newSessionId = `manual-${Date.now()}`;
    const classId = `${newSessionId}-${dateStr}`;

    const newSession = {
      id: newSessionId,
      trainerId: sessionTrainerId,
      studentId: student.id,
      date: dateStr,
      hour: hour,
      status: 'completed',
      branchId: activeContract.branchId,
      verifiedByStudent: true, // Manual check-in counts as verified
    } as any; // Cast as any because Session might require other fields, but we have what we need.

    try {
      if (addSession) {
         await addSession(newSession);
      }
      
      const updated = {
        ...activeContract,
        usedSessions: activeContract.usedSessions + 1,
        status: (activeContract.usedSessions + 1) >= activeContract.totalSessions ? 'expired' : 'active',
        attendedClasses: [...(activeContract.attendedClasses || []), classId]
      } as StudentContract;
      
      onUpdateContract(updated);
    } catch (err) {
      console.error(err);
      alert('Lỗi khi điểm danh, vui lòng thử lại.');
    }
  };

  const handleRegisterPackage = () => {
    let pkgPrice = 0;
    let pkgTotalSessions = 0;
    let pkgName = '';

    if (selectedPackageId === 'custom') {
      pkgPrice = customPrice;
      pkgTotalSessions = customTotalSessions;
      pkgName = customPackageName;
    } else {
      const pkg = packages.find(p => p.id === selectedPackageId);
      if (!pkg) {
        alert('Vui lòng chọn gói tập!');
        return;
      }
      pkgPrice = pkg.price;
      pkgTotalSessions = pkg.totalSessions;
      pkgName = pkg.name;
    }

    const amountPaid = Number(paidAmount) || 0;
    const discountAmount = Number(discount) || 0;
    const debt = (pkgPrice - discountAmount) - amountPaid;
    let finalInstallments: Installment[] = [];

    // Calculate referral commission if code is valid
    let referralCommissionAmount = 0;
    if (referralCode) {
      const referringPT = trainers.find(t => t.employeeCode === referralCode);
      if (referringPT) {
        // Commission calculated dynamically based on amountPaid, not pkgPrice
        referralCommissionAmount = amountPaid * (referringPT.commissionRate / 100);
      }
    }

    if (amountPaid > 0) {
      finalInstallments.push({
        id: Date.now().toString() + '-init',
        amount: amountPaid,
        date: new Date().toISOString(),
        status: 'paid'
      });
    }

    if (debt > 0) {
      const sum = installments.reduce((a, b) => a + b.amount, 0);
      if (sum !== debt) {
        alert('Tổng số tiền các kỳ trả góp phải bằng số tiền còn nợ!');
        return;
      }
      if (installments.some(i => !i.date)) {
        alert('Vui lòng chọn ngày hẹn trả cho tất cả các kỳ!');
        return;
      }
      finalInstallments = [
        ...finalInstallments,
        ...installments.map((inst, idx) => ({
          id: Date.now().toString() + '-' + idx,
          amount: inst.amount,
          date: inst.date,
          status: 'pending' as const
        }))
      ];
    }

    const newContract: StudentContract = {
      id: Date.now().toString(),
      studentId: student.id,
      trainerId: selectedTrainerIds[0] || undefined,
      trainerIds: selectedTrainerIds,
      nutritionPTIds: nutritionPTIds,
      branchId: selectedBranchId,
      packageId: selectedPackageId === 'custom' ? `custom-${Date.now()}` : selectedPackageId,
      packageName: pkgName,
      startDate: startDate,
      endDate: endDate,
      totalSessions: pkgTotalSessions,
      usedSessions: 0,
      totalPrice: pkgPrice,
      paidAmount: amountPaid,
      discount: discountAmount,
      status: 'active',
      installments: finalInstallments,
      referralCode: referralCode || null,
      referralCommission: referralCommissionAmount || null,
    };
    
    const pendingInstallments = finalInstallments.filter(i => i.status === 'pending');
    if (pendingInstallments.length > 0) {
      newContract.nextPaymentDate = pendingInstallments[0].date;
    }

    onSaveContract(newContract);
    setIsAddingPackage(false);
    setSelectedPackageId('');
    setSelectedTrainerIds([]);
    setSelectedBranchId('');
    setReferralCode('');
    setStartDate(new Date().toISOString().split('T')[0]);
    setEndDate('');
    setPaidAmount('');
    setDiscount('');
    setInstallmentCount(1);
    setInstallments([]);
  };

  const handlePayInstallment = (contractId: string, installmentId: string) => {
    const contract = contracts.find(c => c.id === contractId);
    if (!contract || !contract.installments) return;

    const installmentToPay = contract.installments.find(i => i.id === installmentId);
    if (!installmentToPay) return;

    setConfirmAction({
      title: 'Xác nhận thu tiền',
      message: `Xác nhận thu tiền kỳ này: ${installmentToPay.amount.toLocaleString('vi-VN')}đ?`,
      onConfirm: () => {
        const updatedInstallments = contract.installments!.map(inst => 
          inst.id === installmentId ? { ...inst, status: 'paid' as const } : inst
        );

        const newPaidAmount = contract.paidAmount + installmentToPay.amount;
        
        let referralCommissionAmount = contract.referralCommission || null;
        if (contract.referralCode) {
          const referringPT = trainers.find(t => t.employeeCode === contract.referralCode);
          if (referringPT) {
            referralCommissionAmount = newPaidAmount * (referringPT.commissionRate / 100);
          }
        }
        
        // Find next pending installment date
        const nextPending = updatedInstallments.find(i => i.status === 'pending');

        const updatedContract = {
          ...contract,
          installments: updatedInstallments,
          paidAmount: newPaidAmount,
          referralCommission: referralCommissionAmount,
          nextPaymentDate: nextPending ? nextPending.date : null
        };

        onUpdateContract(updatedContract, true);
        
        // Create a payment record
        addPayment({
          id: Date.now().toString(),
          studentId: student.id,
          contractId: contract.id,
          amount: installmentToPay.amount,
          date: new Date().toISOString(),
          method: 'transfer', // Default method
          note: `Thanh toán trả góp hợp đồng ${contract.id}`,
          previousInstallments: contract.installments,
          installmentId: installmentId
        });

        setConfirmAction(null);
        setNotification({message: 'Đã thu tiền thành công!', type: 'success'});
      }
    });
  };

  const handleUndoInstallment = (contractId: string, installmentId: string) => {
    const contract = contracts.find(c => c.id === contractId);
    if (!contract || !contract.installments) return;

    const installmentToUndo = contract.installments.find(i => i.id === installmentId);
    if (!installmentToUndo) return;

    setConfirmAction({
      title: 'Xác nhận hoàn tác',
      message: `Xác nhận hoàn tác thu tiền kỳ này: ${installmentToUndo.amount.toLocaleString('vi-VN')}đ? Số tiền đã thu sẽ bị trừ đi và phiếu thu tương ứng sẽ bị xóa.`,
      onConfirm: () => {
        const updatedInstallments = contract.installments!.map(inst => 
          inst.id === installmentId ? { ...inst, status: 'pending' as const } : inst
        );

        const newPaidAmount = Math.max(0, contract.paidAmount - installmentToUndo.amount);
        
        let referralCommissionAmount = contract.referralCommission || null;
        if (contract.referralCode) {
          const referringPT = trainers.find(t => t.employeeCode === contract.referralCode);
          if (referringPT) {
            referralCommissionAmount = newPaidAmount * (referringPT.commissionRate / 100);
          }
        }
        
        // Find next pending installment date
        const nextPending = updatedInstallments.find(i => i.status === 'pending');

        const updatedContract = {
          ...contract,
          installments: updatedInstallments,
          paidAmount: newPaidAmount,
          referralCommission: referralCommissionAmount,
          nextPaymentDate: nextPending ? nextPending.date : null
        };

        onUpdateContract(updatedContract, true);
        
        // Find and delete the associated payment record
        const paymentToDelete = payments.find(p => p.contractId === contract.id && p.installmentId === installmentId);
        if (paymentToDelete) {
          deletePayment(paymentToDelete.id);
        }

        setConfirmAction(null);
        setNotification({message: 'Đã hoàn tác thu tiền thành công!', type: 'success'});
      }
    });
  };

  const handleCancelContractConfirm = (cancelDebt: boolean, note: string) => {
    if (!cancelingContract) return;

    let updatedInstallments = cancelingContract.installments;
    
    if (cancelDebt && updatedInstallments) {
      updatedInstallments = updatedInstallments.map(inst => 
        inst.status === 'pending' ? { ...inst, status: 'cancelled' as const } : inst
      );
    }

    const updatedContract = {
      ...cancelingContract,
      status: 'cancelled' as const,
      installments: updatedInstallments,
      note: note ? (cancelingContract.note ? `${cancelingContract.note}\nLý do hủy: ${note}` : note) : cancelingContract.note,
      nextPaymentDate: null
    };

    onUpdateContract(updatedContract);
    setCancelingContract(null);
    setNotification({ message: 'Đã hủy hợp đồng thành công', type: 'success' });
  };

  const getCalculatedUsedSessions = (contract: StudentContract | undefined) => {
    if (!contract) return 0;
    const contractSessions = studentSessions.filter(s => {
      if (s.status !== 'completed') return false; 
      
      const sDate = new Date(s.date).getTime();
      const startDate = new Date(contract.startDate).getTime();
      const endDate = new Date(contract.endDate).getTime() + (86400000 * 60); // buffer
      
      return sDate >= startDate && sDate <= endDate;
    });

    const uniqueClassIds = new Set(contractSessions.map(s => `${s.id.split('-').slice(0,2).join('-')}-${s.date}`));
    const currentAttendedClasses = contract.attendedClasses || [];
    currentAttendedClasses.forEach(id => uniqueClassIds.add(id));
    
    return uniqueClassIds.size;
  };

  const actualUsed = getCalculatedUsedSessions(activeContract);

  const handleSyncSessions = () => {
    if (!activeContract) return;
    
    if (actualUsed !== activeContract.usedSessions) {
      if (confirm(`Phát hiện sai lệch!\nSố buổi đang lưu: ${activeContract.usedSessions}\nSố buổi thực tế (đã tập): ${actualUsed}\n\nBạn có muốn cập nhật lại số buổi đã tập thành ${actualUsed}?`)) {
        onUpdateContract({
          ...activeContract,
          usedSessions: actualUsed,
          attendedClasses: Array.from(new Set([
             ...(activeContract.attendedClasses || []),
             ...studentSessions
               .filter(s => s.status === 'completed' && new Date(s.date).getTime() >= new Date(activeContract.startDate).getTime() && new Date(s.date).getTime() <= new Date(activeContract.endDate).getTime() + (86400000 * 60))
               .map(s => `${s.id.split('-').slice(0,2).join('-')}-${s.date}`)
          ])),
          status: actualUsed >= activeContract.totalSessions ? 'expired' : activeContract.status
        });
      }
    } else {
      alert('Số buổi đã tập đang khớp hoàn toàn với lịch sử thực tế của gói tập hiện tại.');
    }
  };

  return (
    <div className="space-y-4 animate-in fade-in slide-in-from-right-4 duration-300">
      <button onClick={onBack} className="flex items-center gap-2 text-zinc-400 hover:text-white mb-2 transition-colors">
        <ArrowLeft className="w-5 h-5" /> Quay lại danh sách
      </button>
      
      {confirmAction && (
        <ConfirmationModal
          isOpen={!!confirmAction}
          title={confirmAction.title}
          message={confirmAction.message}
          onConfirm={confirmAction.onConfirm}
          onCancel={() => setConfirmAction(null)}
        />
      )}
      
      {notification && (
        <div className={`fixed bottom-4 right-4 p-4 rounded-xl shadow-lg z-[100] ${notification.type === 'success' ? 'bg-emerald-500 text-white' : 'bg-red-500 text-white'}`}>
          {notification.message}
        </div>
      )}

      {/* Student Info */}
      <div className="bg-zinc-900 p-5 rounded-2xl border border-zinc-800 shadow-sm">
        <h2 className="text-2xl font-bold text-white mb-1">{student.name}</h2>
        <p className="text-zinc-400 text-sm mb-2">
          {student.phone || 'Chưa có SĐT'} • {student.email || 'Chưa có Email'}
        </p>
        {(student.availableSlots && student.availableSlots.length > 0) && (
          <div className="text-sm bg-indigo-500/10 text-indigo-400 px-3 py-2 rounded-xl border border-indigo-500/20 mb-3 inline-block">
            <span className="font-bold flex items-center gap-1"><CalendarIcon className="w-4 h-4"/> Lịch rảnh:</span> {student.availableSlots.join(', ')}
          </div>
        )}
        {student.nutritionNote && (
          <div className="text-sm bg-pink-500/10 text-pink-400 p-3 rounded-xl border border-pink-500/20">
            <span className="font-bold">PT dinh dưỡng:</span> {student.nutritionNote}
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex p-1 bg-zinc-900 rounded-xl border border-zinc-800 flex-wrap sm:flex-nowrap">
        <button
          onClick={() => setActiveTab('info')}
          className={`flex-1 flex items-center justify-center gap-2 py-2.5 px-2 rounded-lg text-sm font-medium transition-all ${
            activeTab === 'info' 
              ? 'bg-zinc-800 text-white shadow-sm' 
              : 'text-zinc-500 hover:text-zinc-300'
          }`}
        >
          <Package className="w-4 h-4" />
          <span className="hidden sm:inline">Thông tin & Gói tập</span>
          <span className="sm:hidden">Thông tin</span>
        </button>
        <button
          onClick={() => setActiveTab('progress')}
          className={`flex-1 flex items-center justify-center gap-2 py-2.5 px-2 rounded-lg text-sm font-medium transition-all ${
            activeTab === 'progress' 
              ? 'bg-zinc-800 text-white shadow-sm' 
              : 'text-zinc-500 hover:text-zinc-300'
          }`}
        >
          <TrendingUp className="w-4 h-4" />
          <span className="hidden sm:inline">Tiến độ cơ thể</span>
          <span className="sm:hidden">Tiến độ</span>
        </button>
        <button
          onClick={() => setActiveTab('history')}
          className={`flex-1 flex items-center justify-center gap-2 py-2.5 px-2 rounded-lg text-sm font-medium transition-all ${
            activeTab === 'history' 
              ? 'bg-zinc-800 text-white shadow-sm' 
              : 'text-zinc-500 hover:text-zinc-300'
          }`}
        >
          <History className="w-4 h-4" />
          <span className="hidden sm:inline">Lịch tập</span>
          <span className="sm:hidden">Lịch tập</span>
        </button>
        <button
          onClick={() => setActiveTab('checkin')}
          className={`flex-1 flex items-center justify-center gap-2 py-2.5 px-2 rounded-lg text-sm font-medium transition-all ${
            activeTab === 'checkin' 
              ? 'bg-zinc-800 text-white shadow-sm' 
              : 'text-zinc-500 hover:text-zinc-300'
          }`}
        >
          <ClipboardCheck className="w-4 h-4" />
          Check-in
        </button>
        <button
          onClick={() => setActiveTab('requests')}
          className={`flex-1 flex items-center justify-center gap-2 py-2.5 px-2 rounded-lg text-sm font-medium transition-all ${
            activeTab === 'requests' 
              ? 'bg-zinc-800 text-white shadow-sm' 
              : 'text-zinc-500 hover:text-zinc-300'
          }`}
        >
          <CalendarClock className="w-4 h-4" />
          Yêu cầu
        </button>
        <button
          onClick={() => setActiveTab('workout_logs')}
          className={`flex-1 flex items-center justify-center gap-2 py-2.5 px-2 rounded-lg text-sm font-medium transition-all ${
            activeTab === 'workout_logs' 
              ? 'bg-zinc-800 text-white shadow-sm' 
              : 'text-zinc-500 hover:text-zinc-300'
          }`}
        >
          <Dumbbell className="w-4 h-4" />
          <span className="hidden sm:inline">Nhật ký tạ</span>
          <span className="sm:hidden">Tạ</span>
        </button>
        <button
          onClick={() => setActiveTab('nutrition')}
          className={`flex-1 flex items-center justify-center gap-2 py-2.5 px-2 rounded-lg text-sm font-medium transition-all ${
            activeTab === 'nutrition' 
              ? 'bg-zinc-800 text-white shadow-sm' 
              : 'text-zinc-500 hover:text-zinc-300'
          }`}
        >
          <Utensils className="w-4 h-4" />
          <span className="hidden sm:inline">Dinh dưỡng (AI)</span>
          <span className="sm:hidden">Bữa ăn</span>
        </button>
      </div>

      {activeTab === 'progress' ? (
        <StudentProgressAdmin studentId={student.id} isTrainer={isTrainer} />
      ) : activeTab === 'checkin' ? (
        <div className="bg-zinc-900 p-5 rounded-2xl border border-zinc-800 shadow-sm">
          <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
            <ClipboardCheck className="w-5 h-5 text-pink-500" />
            Lịch sử Check-in cuối ngày
          </h3>
          
          {loadingCheckins ? (
            <div className="flex justify-center py-8">
              <div className="w-6 h-6 border-2 border-pink-500 border-t-transparent rounded-full animate-spin"></div>
            </div>
          ) : dailyCheckins.length > 0 ? (
            <div className="space-y-4">
              {dailyCheckins.map(checkin => (
                <div key={checkin.id} className="p-4 bg-zinc-950 rounded-xl border border-zinc-800/50 space-y-3">
                  <div className="flex justify-between items-center">
                    <span className="text-zinc-300 font-bold">{formatDate(checkin.date)}</span>
                    <span className={`text-xs font-bold px-2 py-1 rounded-md ${
                      checkin.compliance >= 80 ? 'bg-emerald-500/10 text-emerald-500' :
                      checkin.compliance >= 50 ? 'bg-amber-500/10 text-amber-500' : 'bg-red-500/10 text-red-500'
                    }`}>
                      Tuân thủ: {checkin.compliance}%
                    </span>
                  </div>
                  
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div className="flex items-center gap-2 text-xs text-zinc-400">
                      <Smile className="w-3.5 h-3.5 text-orange-500" />
                      No/Đói: {checkin.hunger}/5
                    </div>
                    <div className="flex items-center gap-2 text-xs text-zinc-400">
                      <Zap className="w-3.5 h-3.5 text-blue-500" />
                      Năng lượng: {checkin.energy}/5
                    </div>
                    <div className="flex items-center gap-2 text-xs text-zinc-400">
                      <Droplets className="w-3.5 h-3.5 text-cyan-500" />
                      Nước: {checkin.waterIntake}L
                    </div>
                    <div className="flex items-center gap-2 text-xs text-zinc-400">
                      <Moon className="w-3.5 h-3.5 text-indigo-500" />
                      Ngủ: {checkin.sleepQuality}h
                    </div>
                  </div>
                  
                  {checkin.note && (
                    <div className="text-xs text-zinc-500 bg-zinc-900/50 p-2 rounded-lg italic">
                      "{checkin.note}"
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-zinc-500 text-center py-4">Chưa có dữ liệu check-in.</p>
          )}
        </div>
      ) : activeTab === 'workout_logs' ? (
        <div className="bg-zinc-900 p-5 rounded-2xl border border-zinc-800 shadow-sm relative overflow-hidden">
          <div className="flex justify-between items-center mb-6">
            <h3 className="text-lg font-bold text-white flex items-center gap-2">
              <Dumbbell className="w-5 h-5 text-pink-500" />
              Nhật ký tạ
            </h3>
            <button
              onClick={() => {
                setEditingWorkoutLog(null);
                setShowWorkoutLogger(true);
              }}
              className="px-3 py-1.5 bg-pink-500/10 text-pink-400 border border-pink-500/20 hover:bg-pink-500/20 rounded-lg text-xs font-bold transition-colors flex items-center gap-2"
            >
              <Plus className="w-4 h-4" />
              Ghi tạ
            </button>
          </div>

          <div className="space-y-6">
            {groupedWorkoutLogs.length > 0 ? groupedWorkoutLogs.map(([date, logs]) => (
              <div key={date} className="space-y-3">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-pink-500"></div>
                  <h4 className="font-bold text-white tracking-wide">
                    {new Date(date).toLocaleDateString('vi-VN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
                  </h4>
                </div>
                
                <div className="space-y-3">
                  {logs.map((log, logIdx) => (
                    <div key={`log-${log.id || ''}-${logIdx}`} className="bg-zinc-950 p-4 rounded-xl border border-zinc-800/50">
                      <div className="flex justify-between items-start mb-3">
                        <div>
                          <h4 className="font-bold text-white text-base">{log.exerciseName}</h4>
                          <p className="text-xs text-zinc-500">Tạo lúc {new Date(log.createdAt).toLocaleTimeString('vi-VN', {hour: '2-digit', minute:'2-digit'})}</p>
                        </div>
                        {log.feeling && (
                          <span className="bg-zinc-900 text-zinc-300 text-[10px] uppercase font-bold px-2 py-1 rounded-md border border-zinc-800">
                            {log.feeling}
                          </span>
                        )}
                      </div>
                      
                      <div className="grid grid-cols-2 md:grid-cols-3 gap-2 mb-3">
                        {log.sets.map((set, idx) => (
                          <div key={`set-${log.id || ''}-${idx}`} className="bg-zinc-900 p-2 rounded-lg border border-zinc-800 flex justify-between items-center text-sm">
                            <span className="text-zinc-500 text-[10px] font-bold w-5">#{idx + 1}</span>
                            <span className="font-medium text-white text-sm">{set.weight} <span className="text-[10px] text-zinc-500">kg</span></span>
                            <span className="font-medium text-pink-400 text-sm">{set.reps} <span className="text-[10px] text-pink-500/50">rep</span></span>
                          </div>
                        ))}
                      </div>

                      {log.note && (
                        <div className="text-sm text-zinc-400 bg-zinc-900/50 p-3 rounded-lg flex items-start gap-2">
                          <FileText className="w-4 h-4 text-zinc-500 shrink-0 mt-0.5" />
                          <p className="text-xs">{log.note}</p>
                        </div>
                      )}
                      
                      <div className="mt-3 flex justify-end gap-2">
                        <button 
                          onClick={() => {
                            setEditingWorkoutLog(log);
                            setShowWorkoutLogger(true);
                          }}
                          className="text-zinc-500 hover:text-white p-1.5 hover:bg-zinc-800 rounded-lg transition-colors"
                        >
                          <Edit className="w-4 h-4" />
                        </button>
                        <button 
                          onClick={() => {
                             if(confirm('Xoá lịch sử bài này?')) {
                                deleteWorkoutLog(log.id);
                             }
                          }}
                          className="text-red-400/70 hover:text-red-400 p-1.5 hover:bg-red-500/10 rounded-lg transition-colors"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )) : (
              <p className="text-center text-zinc-500 py-8">Chưa có nhật ký tập luyện.</p>
            )}
          </div>
        </div>
      ) : activeTab === 'nutrition' ? (
        <MealAnalysis student={student} />
      ) : activeTab === 'requests' ? (
        <div className="bg-zinc-900 p-5 rounded-2xl border border-zinc-800 shadow-sm">
          <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
            <CalendarClock className="w-5 h-5 text-pink-500" />
            Lịch sử yêu cầu
          </h3>
          
          <div className="space-y-3">
            {allRequests.length > 0 ? allRequests.map((req: any, idx) => (
              <div key={`req-${req.reqType}-${req.id || ''}-${idx}`} className="bg-zinc-950 p-3 rounded-xl border border-zinc-800/50">
                <div className="flex justify-between items-start mb-2">
                  <div>
                    <p className="text-zinc-300 text-sm font-medium">
                      {req.reqType === 'leave' ? 'Xin nghỉ phép / Bảo lưu' : (req.type === 'cancel' ? 'Báo nghỉ 1 buổi' : 'Dời lịch tập')}
                    </p>
                    <p className="text-xs text-zinc-500">
                      {new Date(req.createdAt).toLocaleDateString('vi-VN')} {new Date(req.createdAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                  <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-md ${
                    req.status === 'approved' ? 'bg-emerald-500/10 text-emerald-500' :
                    req.status === 'rejected' ? 'bg-red-500/10 text-red-500' :
                    'bg-yellow-500/10 text-yellow-500'
                  }`}>
                    {req.status === 'approved' ? 'Đã duyệt' : req.status === 'rejected' ? 'Từ chối' : 'Chờ duyệt'}
                  </span>
                </div>
                <div className="text-xs text-zinc-400 bg-zinc-900/50 p-2 rounded-lg mt-2">
                  {req.reqType === 'session' ? (
                    <div>
                      Buổi: {new Date(req.originalDate).toLocaleDateString('vi-VN')} {req.originalHour !== undefined ? `- ${req.originalHour}:00` : ''}
                      {req.type === 'reschedule' && req.newDate && (
                        <span className="text-pink-400"> → {new Date(req.newDate).toLocaleDateString('vi-VN')} {req.newHour !== undefined ? `- ${req.newHour}:00` : ''}</span>
                      )}
                    </div>
                  ) : (
                    <div>
                      Từ: {new Date(req.startDate).toLocaleDateString('vi-VN')} - Đến: {new Date(req.endDate).toLocaleDateString('vi-VN')}
                    </div>
                  )}
                  <div className="mt-1">Lý do: {req.reason}</div>
                  {req.adminNote && (
                    <div className="mt-1 text-red-400 border-t border-red-500/20 pt-1">
                      Ghi chú Admin: {req.adminNote}
                    </div>
                  )}
                </div>
              </div>
            )) : (
              <p className="text-zinc-500 text-center py-4">Chưa có yêu cầu nào.</p>
            )}
          </div>
        </div>
      ) : activeTab === 'history' ? (
        <div className="bg-zinc-900 p-5 rounded-2xl border border-zinc-800 shadow-sm">
          <div className="flex flex-col gap-4 mb-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                <History className="w-5 h-5 text-pink-500" />
                Lịch tập luyện
              </h3>
            </div>

            {/* Filter Selector */}
            <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
              {[
                { id: 'this_week', label: 'Tuần này' },
                { id: 'upcoming', label: 'Sắp tới' },
                { id: 'history', label: 'Lịch sử' }
              ].map(f => (
                <button
                  key={f.id}
                  onClick={() => setSessionFilter(f.id as any)}
                  className={`px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider whitespace-nowrap transition-all border ${
                    sessionFilter === f.id 
                      ? 'bg-pink-500 text-white border-pink-500 shadow-[0_0_10px_rgba(255,0,127,0.3)]' 
                      : 'bg-zinc-800 text-zinc-500 border-zinc-700 hover:text-zinc-300'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>
          
          <div className="space-y-3">
            {sessionFilter === 'history' && (
              <div className="bg-blue-500/10 border border-blue-500/20 p-3 rounded-xl mb-4">
                <p className="text-xs text-blue-400">
                  <span className="font-bold">Lưu ý:</span> Lịch sử bao gồm cả các buổi <b>Đã hoàn thành</b>, <b>Đã báo nghỉ</b> và <b>Đã hủy</b>. Chỉ những buổi <b>Đã hoàn thành</b> mới bị trừ vào số buổi của gói tập.
                  <br/>
                  (Thực tế đã hoàn thành: <span className="font-bold text-white">{studentSessions.filter(s => s.status === 'completed').length}</span> buổi trong lịch sử)
                </p>
              </div>
            )}
            {filteredSessions.length > 0 ? [...filteredSessions].sort((a, b) => {
              const dateDiff = new Date(a.date).getTime() - new Date(b.date).getTime();
              if (dateDiff === 0) {
                return sessionFilter === 'upcoming' 
                  ? (a.hour || 0) - (b.hour || 0)
                  : (b.hour || 0) - (a.hour || 0);
              }
              return sessionFilter === 'upcoming' ? dateDiff : -dateDiff;
            }).map(s => {
              const trainer = trainers.find(t => t.id === s.trainerId);
              return (
                <div key={s.id} className="flex justify-between items-center p-3 bg-zinc-950 rounded-xl border border-zinc-800/50">
                  <div>
                    <p className="text-zinc-300 font-medium">
                      {formatDate(s.date)}
                      {s.hour !== undefined ? ` - ${s.hour}:00` : ''}
                    </p>
                    <p className="text-xs text-zinc-500">PT: {trainer?.name || 'Không xác định'}</p>
                  </div>
                  <span className={`text-xs font-medium px-2 py-1 rounded-md ${
                    s.status === 'completed' ? 'bg-emerald-500/10 text-emerald-500' :
                    s.status === 'cancelled' ? 'bg-red-500/10 text-red-500' : 
                    s.status === 'canceled_by_student' ? 'bg-orange-500/10 text-orange-500' : 'bg-zinc-800 text-zinc-400'
                  }`}>
                    {s.status === 'completed' ? 'Đã hoàn thành' : s.status === 'cancelled' ? 'Đã hủy' : s.status === 'canceled_by_student' ? 'Đã báo nghỉ' : 'Đã lên lịch'}
                  </span>
                </div>
              );
            }) : (
              <p className="text-zinc-500 text-center py-4">Chưa có lịch tập luyện.</p>
            )}
          </div>
        </div>
      ) : (
        <>
          {/* Active Package */}
          <div className="bg-zinc-900 p-5 rounded-2xl border border-zinc-800 shadow-sm relative overflow-hidden">
        {/* Background glow */}
        <div className="absolute -top-10 -right-10 w-32 h-32 bg-pink-500/10 rounded-full blur-2xl pointer-events-none"></div>
        
        <div className="flex justify-between items-start mb-4 relative z-10">
          <h3 className="text-lg font-bold text-white flex items-center gap-2">
            <Activity className="w-5 h-5 text-pink-500" />
            Gói tập hiện tại
          </h3>
          <div className="flex flex-wrap gap-2">
            {!isTrainer && activeContract && (
              <button 
                onClick={() => setRenewingContract(activeContract)}
                className="text-xs font-medium text-emerald-500 hover:text-emerald-400 flex items-center gap-1 bg-emerald-500/10 px-2 py-1 rounded-lg"
              >
                <RefreshCw className="w-3 h-3" /> Gia hạn
              </button>
            )}
            {!isTrainer && activeContract && (
              <button 
                onClick={() => setAddingSessionsContract(activeContract)}
                className="text-xs font-medium text-purple-500 hover:text-purple-400 flex items-center gap-1 bg-purple-500/10 px-2 py-1 rounded-lg"
              >
                <Plus className="w-3 h-3" /> Mua thêm buổi
              </button>
            )}
            {activeContract && (
              <button 
                onClick={() => setViewingContract(activeContract)}
                className="text-xs font-medium text-pink-500 hover:text-pink-400 flex items-center gap-1 bg-pink-500/10 px-2 py-1 rounded-lg"
              >
                <FileText className="w-3 h-3" /> Xem HĐ
              </button>
            )}
            {!isTrainer && activeContract && (
              <button 
                onClick={() => setEditingContract(activeContract)}
                className="text-xs font-medium text-amber-500 hover:text-amber-400 flex items-center gap-1 bg-amber-500/10 px-2 py-1 rounded-lg"
              >
                Chỉnh sửa
              </button>
            )}
            {!isTrainer && activeContract && (
              <button 
                onClick={() => {
                  const isFrozen = activeContract.status === 'frozen';
                  setConfirmAction({
                    title: isFrozen ? 'Xác nhận hủy bảo lưu' : 'Xác nhận bảo lưu',
                    message: isFrozen ? 'Học viên sẽ quay lại tập luyện?' : 'Học viên sẽ được bảo lưu gói tập?',
                    onConfirm: () => {
                      if (isFrozen) {
                        const frozenDuration = new Date().getTime() - new Date(activeContract.frozenAt || activeContract.startDate).getTime();
                        const { frozenAt, ...contractWithoutFrozenAt } = activeContract;
                        const newEndDate = new Date(new Date(activeContract.endDate).getTime() + frozenDuration).toISOString().split('T')[0];
                        onUpdateContract({
                          ...contractWithoutFrozenAt,
                          status: 'active',
                          endDate: newEndDate
                        });
                      } else {
                        onUpdateContract({
                          ...activeContract,
                          status: 'frozen',
                          frozenAt: new Date().toISOString()
                        });
                      }
                      setConfirmAction(null);
                      setNotification({message: isFrozen ? 'Đã hủy bảo lưu!' : 'Đã bảo lưu thành công!', type: 'success'});
                    }
                  });
                }}
                className={`text-xs font-medium flex items-center gap-1 px-2 py-1 rounded-lg ${
                  activeContract.status === 'frozen' 
                    ? 'text-emerald-500 bg-emerald-500/10 hover:text-emerald-400' 
                    : 'text-blue-500 bg-blue-500/10 hover:text-blue-400'
                }`}
              >
                {activeContract.status === 'frozen' ? 'Hủy bảo lưu' : 'Bảo lưu'}
              </button>
            )}
            {!isTrainer && activeContract && (
              <button 
                onClick={() => setCancelingContract(activeContract)}
                className="text-xs font-medium text-red-500 hover:text-red-400 flex items-center gap-1 bg-red-500/10 px-2 py-1 rounded-lg"
              >
                Hủy HĐ
              </button>
            )}
          </div>
        </div>
        
        {activeContract ? (
          <div className="space-y-4 relative z-10">
            {/* contract details */}
            <div className="flex justify-between items-center">
              <span className="text-zinc-200 font-medium text-lg">{activeContract.packageName}</span>
              <div className="flex items-center gap-2">
                <span className="text-pink-500 font-bold text-xl">{actualUsed} / {activeContract.totalSessions}</span>
                {actualUsed !== activeContract.usedSessions && (
                  <button 
                    onClick={handleSyncSessions} 
                    className="p-1.5 bg-pink-500/10 text-pink-500 hover:bg-pink-500 hover:text-white rounded-lg transition-colors border border-pink-500/50" 
                    title="Đồng bộ lại số buổi theo lịch sử thực tế"
                  >
                    <RefreshCw className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
            
            <div className="flex flex-col gap-1 mt-1">
              {activeContract.trainerIds && activeContract.trainerIds.map((id, index) => {
                const t = trainers.find(trainer => trainer.id === id);
                if (!t) return null;
                return (
                  <div key={id} className="flex items-center gap-2 text-xs">
                    <UserIcon className="w-3.5 h-3.5 text-zinc-500" />
                    <span className="text-zinc-300">
                      {t.name} <span className="text-zinc-500">({index === 0 ? 'Chính' : `Phụ ${index}`})</span>
                    </span>
                  </div>
                );
              })}
              {activeContract.nutritionPTIds && activeContract.nutritionPTIds.map((id) => {
                const t = trainers.find(trainer => trainer.id === id);
                if (!t) return null;
                return (
                  <div key={`nutri-${id}`} className="flex items-center gap-2 text-xs">
                    <UserIcon className="w-3.5 h-3.5 text-pink-500" />
                    <span className="text-zinc-300">
                      {t.name} <span className="text-pink-500/70">(Dinh dưỡng)</span>
                    </span>
                  </div>
                );
              })}
            </div>

            <div className="w-full bg-zinc-800 rounded-full h-3 overflow-hidden">
              <div 
                className="bg-gradient-to-r from-pink-600 to-pink-400 h-3 rounded-full transition-all duration-500 ease-out" 
                style={{ width: `${(actualUsed / activeContract.totalSessions) * 100}%` }}
              ></div>
            </div>
            
            <div className="flex justify-between text-sm text-zinc-400 bg-zinc-950/50 p-3 rounded-xl">
              <div className="flex flex-col">
                <span className="text-xs text-zinc-500">Hạn sử dụng</span>
                <div className="flex items-center gap-2">
                  <span className="font-medium text-zinc-300">{formatDate(activeContract.endDate)}</span>
                  {!isTrainer && (
                    <button 
                      onClick={() => setExtendingContract(activeContract)}
                      className="text-pink-500 hover:text-pink-400 p-1 bg-pink-500/10 rounded-md transition-colors"
                      title="Gia hạn ngày tập"
                    >
                      <CalendarClock className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
              <div className="flex flex-col items-end">
                <span className="text-xs text-zinc-500">Công nợ</span>
                <span className={`font-medium ${(activeContract.totalPrice - (activeContract.discount || 0)) > activeContract.paidAmount ? 'text-red-400' : 'text-emerald-400'}`}>
                  {((activeContract.totalPrice - (activeContract.discount || 0)) - activeContract.paidAmount).toLocaleString('vi-VN')}đ
                </span>
              </div>
            </div>

            {!isTrainer && activeContract.installments && activeContract.installments.length > 0 && (
              <div className="mt-4 pt-4 border-t border-zinc-800/50">
                <div className="flex justify-between items-center mb-3">
                  <h4 className="text-sm font-bold text-zinc-300 flex items-center gap-2">
                    <CreditCard className="w-4 h-4 text-amber-500" />
                    Lịch thanh toán trả góp
                  </h4>
                  <button 
                    onClick={() => setIsManagingDebt(!isManagingDebt)}
                    className="text-xs text-pink-500 hover:text-pink-400 font-medium"
                  >
                    {isManagingDebt ? 'Đóng' : 'Quản lý'}
                  </button>
                </div>
                
                <div className="space-y-2">
                  {activeContract.installments.map((inst, idx) => {
                    const isOverdue = inst.status === 'pending' && !isSameDayOrAfter(inst.date, new Date());
                    
                    return (
                      <div key={inst.id} className={`flex justify-between items-center text-sm p-3 rounded-xl border ${
                        inst.status === 'paid' ? 'bg-emerald-500/5 border-emerald-500/20' : 
                        isOverdue ? 'bg-red-500/10 border-red-500/30' : 'bg-zinc-950 border-zinc-800/50'
                      }`}>
                        <div className="flex items-center gap-3">
                          <div className={`w-8 h-8 rounded-lg flex items-center justify-center font-bold ${
                            inst.status === 'paid' ? 'bg-emerald-500/20 text-emerald-500' : 
                            isOverdue ? 'bg-red-500/20 text-red-500' : 'bg-zinc-800 text-zinc-400'
                          }`}>
                            {idx + 1}
                          </div>
                          <div>
                            <p className={`font-medium ${inst.status === 'paid' ? 'text-emerald-400' : isOverdue ? 'text-red-400' : 'text-zinc-300'}`}>
                              {inst.amount.toLocaleString('vi-VN')}đ
                            </p>
                            <p className="text-xs text-zinc-500 flex items-center gap-1">
                              <CalendarIcon className="w-3 h-3" />
                              {formatDate(inst.date)}
                            </p>
                          </div>
                        </div>
                        
                        <div className="flex items-center gap-2">
                          {inst.status === 'paid' ? (
                            <div className="flex items-center gap-2">
                              <span className="flex items-center gap-1 text-xs font-bold text-emerald-500 bg-emerald-500/10 px-2 py-1 rounded-md">
                                <CheckCircle className="w-3 h-3" /> Đã thu
                              </span>
                              {isManagingDebt && (
                                <button 
                                  onClick={() => handleUndoInstallment(activeContract.id, inst.id)}
                                  className="text-xs font-bold bg-zinc-800 text-zinc-400 px-3 py-1.5 rounded-lg hover:bg-zinc-700 hover:text-white transition-colors shadow-sm"
                                  title="Hoàn tác thu tiền"
                                >
                                  Hoàn tác
                                </button>
                              )}
                            </div>
                          ) : isManagingDebt ? (
                            <button 
                              onClick={() => handlePayInstallment(activeContract.id, inst.id)}
                              className="text-xs font-bold bg-pink-500 text-white px-3 py-1.5 rounded-lg hover:bg-pink-600 transition-colors shadow-sm"
                            >
                              Thu tiền
                            </button>
                          ) : isOverdue ? (
                            <span className="flex items-center gap-1 text-xs font-bold text-red-500 bg-red-500/10 px-2 py-1 rounded-md">
                              <AlertCircle className="w-3 h-3" /> Quá hạn
                            </span>
                          ) : (
                            <span className="text-xs font-medium text-amber-500 bg-amber-500/10 px-2 py-1 rounded-md">
                              Chờ thu
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <button 
              onClick={handleCheckIn}
              className="w-full mt-2 bg-emerald-500/10 text-emerald-500 border border-emerald-500/30 hover:bg-emerald-500 hover:text-white py-4 rounded-xl font-bold flex items-center justify-center gap-2 transition-all active:scale-95 shadow-[0_0_15px_rgba(16,185,129,0.1)] hover:shadow-[0_0_20px_rgba(16,185,129,0.3)]"
            >
              <CheckCircle className="w-6 h-6" />
              Điểm danh (Trừ 1 buổi)
            </button>
          </div>
        ) : (
          <div className="text-center py-8 relative z-10">
            <p className="text-zinc-500 mb-4">Học viên chưa có gói tập nào đang hoạt động.</p>
            {!isTrainer && (
              <button 
                onClick={() => setIsAddingPackage(true)}
                className="bg-pink-500 text-white px-6 py-3 rounded-xl font-medium hover:bg-pink-600 transition-all active:scale-95 inline-flex items-center gap-2 shadow-[0_0_15px_rgba(255,0,127,0.3)]"
              >
                <Plus className="w-5 h-5" /> Đăng ký gói mới
              </button>
            )}
          </div>
        )}
      </div>

      {/* History */}
      {historyContracts.length > 0 && (
        <div className="bg-zinc-900 p-5 rounded-2xl border border-zinc-800 shadow-sm">
          <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
            <History className="w-5 h-5 text-zinc-400" />
            Lịch sử gói tập
          </h3>
          <div className="space-y-3">
            {historyContracts.map(c => (
              <div key={c.id} className="flex justify-between items-center p-3 bg-zinc-950 rounded-xl border border-zinc-800/50">
                <div>
                  <p className="text-zinc-300 font-medium">{c.packageName}</p>
                  <p className="text-xs text-zinc-500">{formatDate(c.startDate)} - {formatDate(c.endDate)}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium px-2 py-1 rounded-md bg-zinc-800 text-zinc-400">
                    {c.status === 'expired' ? 'Đã hết hạn' : 'Đã hủy'}
                  </span>
                  {!isTrainer && (
                    <>
                      <button 
                        onClick={() => setEditingContract(c)}
                        className="p-1.5 bg-blue-500/10 text-blue-500 hover:bg-blue-500/20 hover:text-blue-400 rounded-lg transition-colors"
                        title="Chỉnh sửa"
                      >
                        <Edit className="w-3.5 h-3.5" />
                      </button>
                      <button 
                        onClick={() => setAddingSessionsContract(c)}
                        className="p-1.5 bg-purple-500/10 text-purple-500 hover:bg-purple-500/20 hover:text-purple-400 rounded-lg transition-colors"
                        title="Mua thêm buổi"
                      >
                        <Plus className="w-3.5 h-3.5" />
                      </button>
                      <button 
                        onClick={() => setRenewingContract(c)}
                        className="p-1.5 bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/20 hover:text-emerald-400 rounded-lg transition-colors"
                        title="Gia hạn"
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                      </button>
                    </>
                  )}
                  <button 
                    onClick={() => setViewingContract(c)}
                    className="p-1.5 bg-zinc-800 text-zinc-400 hover:text-white rounded-lg transition-colors"
                    title="Xem HĐ"
                  >
                    <FileText className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      </>
      )}

      {/* Add Package Modal */}
      <AnimatePresence>
        {isAddingPackage && (
          <div className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/80 backdrop-blur-sm"
              onClick={() => setIsAddingPackage(false)}
            />
            <motion.div 
              initial={{ opacity: 0, y: '100%' }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: '100%' }}
              className="relative w-full max-w-md bg-zinc-900 rounded-3xl p-6 shadow-2xl border border-zinc-800"
            >
              <h3 className="text-xl font-bold text-white mb-6">Đăng ký gói tập mới</h3>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-zinc-400 mb-1">Chọn gói tập</label>
                  <select 
                    value={selectedPackageId}
                    onChange={e => setSelectedPackageId(e.target.value)}
                    className="w-full p-3 rounded-xl border border-zinc-800 bg-zinc-950 text-white focus:outline-none focus:border-pink-500"
                  >
                    <option value="">-- Chọn gói --</option>
                    <option value="custom">Gói tuỳ chỉnh (Nhập tay)</option>
                    {packages.map(p => (
                      <option key={p.id} value={p.id}>{p.name} ({p.totalSessions} buổi - {p.price.toLocaleString('vi-VN')}đ)</option>
                    ))}
                  </select>
                </div>

                {selectedPackageId === 'custom' && (
                  <div className="bg-zinc-950/50 p-4 rounded-xl border border-zinc-800 space-y-3">
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

                <div>
                  <label className="block text-sm font-medium text-zinc-400 mb-1">Chọn cơ sở (Không bắt buộc)</label>
                  <select 
                    value={selectedBranchId}
                    onChange={e => setSelectedBranchId(e.target.value)}
                    className="w-full p-3 rounded-xl border border-zinc-800 bg-zinc-950 text-white focus:outline-none focus:border-pink-500"
                  >
                    <option value="">-- Tất cả cơ sở --</option>
                    {branches.map(b => (
                      <option key={b.id} value={b.id}>{b.name}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-zinc-400 mb-2">Chọn PT</label>
                  <TrainerPrioritySelector
                    trainers={trainers}
                    selectedTrainerIds={selectedTrainerIds}
                    onChange={setSelectedTrainerIds}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-zinc-400 mb-2">Chọn PT Dinh Dưỡng</label>
                  <div className="grid grid-cols-2 gap-2 max-h-32 overflow-y-auto p-2 border border-zinc-800 rounded-xl bg-zinc-950">
                    {trainers.filter(t => t.status === 'active').map(t => (
                      <label key={`nutri-${t.id}`} className="flex items-center gap-2 text-white cursor-pointer hover:bg-zinc-900 p-2 rounded-lg">
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

                <div>
                  <label className="block text-sm font-medium text-zinc-400 mb-1">Mã người giới thiệu (Nếu có)</label>
                  <input 
                    type="text" 
                    value={referralCode}
                    onChange={e => setReferralCode(e.target.value)}
                    placeholder="VD: PT001"
                    className="w-full p-3 rounded-xl border border-zinc-800 bg-zinc-950 text-white focus:outline-none focus:border-pink-500" 
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-zinc-400 mb-1">Giảm giá (VNĐ)</label>
                  <input 
                    type="number" 
                    value={discount}
                    onChange={e => setDiscount(e.target.value)}
                    className="w-full p-3 rounded-xl border border-zinc-800 bg-zinc-950 text-white focus:outline-none focus:border-pink-500" 
                    placeholder="VD: 500000"
                  />
                </div>

                {selectedPackageId && (
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-zinc-400 mb-1">Ngày bắt đầu</label>
                        <input 
                          type="date" 
                          value={startDate}
                          onChange={e => setStartDate(e.target.value)}
                          className="w-full p-3 rounded-xl border border-zinc-800 bg-zinc-950 text-white focus:outline-none focus:border-pink-500" 
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-zinc-400 mb-1">Ngày kết thúc</label>
                        <input 
                          type="date" 
                          value={endDate}
                          disabled
                          className="w-full p-3 rounded-xl border border-zinc-800 bg-zinc-900 text-zinc-500 cursor-not-allowed" 
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-zinc-400 mb-1">Số tiền thanh toán trước (VNĐ)</label>
                      <input 
                        type="number" 
                        value={paidAmount}
                        onChange={e => setPaidAmount(e.target.value)}
                        className="w-full p-3 rounded-xl border border-zinc-800 bg-zinc-950 text-white focus:outline-none focus:border-pink-500" 
                        placeholder="VD: 1000000"
                      />
                      <p className="text-xs text-zinc-500 mt-1">Có thể thanh toán một phần hoặc toàn bộ.</p>
                    </div>

                    {Number(paidAmount) < ((packages.find(p => p.id === selectedPackageId)?.price || 0) - (Number(discount) || 0)) && (
                      <motion.div 
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        className="bg-red-500/5 border border-red-500/20 p-4 rounded-xl space-y-4"
                      >
                        <div className="flex justify-between items-center text-sm">
                          <span className="text-zinc-400">Số tiền còn nợ:</span>
                          <span className="text-red-400 font-bold">
                            {((packages.find(p => p.id === selectedPackageId)?.price || 0) - (Number(discount) || 0) - Number(paidAmount)).toLocaleString('vi-VN')}đ
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
                            <div key={`inst-edit-${idx}`} className="flex gap-2 items-center">
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
                  </div>
                )}

                <div className="pt-4 flex gap-3">
                  <button 
                    onClick={() => setIsAddingPackage(false)}
                    className="flex-1 py-3 rounded-xl font-medium text-zinc-400 bg-zinc-800 hover:bg-zinc-700 transition-colors"
                  >
                    Hủy
                  </button>
                  <button 
                    onClick={handleRegisterPackage}
                    disabled={!selectedPackageId}
                    className="flex-1 py-3 rounded-xl font-medium text-white bg-pink-500 hover:bg-pink-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-[0_0_15px_rgba(255,0,127,0.4)]"
                  >
                    Xác nhận
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Notification */}
      <AnimatePresence>
        {notification && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className={`fixed top-4 right-4 z-[80] p-4 rounded-xl shadow-lg border ${
              notification.type === 'success' ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-500' : 'bg-red-500/10 border-red-500/20 text-red-500'
            }`}
          >
            {notification.message}
          </motion.div>
        )}
      </AnimatePresence>

      {renewingContract && (
        <RenewContractModal
          isOpen={true}
          onClose={() => setRenewingContract(null)}
          student={student}
          latestContract={renewingContract}
        />
      )}

      {addingSessionsContract && (
        <AddSessionsModal
          isOpen={true}
          onClose={() => setAddingSessionsContract(null)}
          contract={addingSessionsContract}
          onSave={(updatedContract, skipPayment) => {
            onUpdateContract(updatedContract, skipPayment);
            setAddingSessionsContract(null);
          }}
        />
      )}

      {/* Confirmation Modal */}
      {confirmAction && (
        <ConfirmationModal
          isOpen={!!confirmAction}
          title={confirmAction.title}
          message={confirmAction.message}
          onConfirm={confirmAction.onConfirm}
          onCancel={() => setConfirmAction(null)}
        />
      )}

      {/* Contract Invoice Modal */}
      <AnimatePresence>
        {viewingContract && (
          <div key="view-contract">
            <ContractInvoice 
              student={student}
              contract={viewingContract}
              onClose={() => setViewingContract(null)}
            />
          </div>
        )}
        {editingContract && (
          <div key="edit-contract">
            <EditContractModal
              contract={editingContract}
              packages={packages}
              trainers={trainers}
              branches={branches}
              onClose={() => setEditingContract(null)}
              onSave={(updatedContract) => {
                onUpdateContract(updatedContract);
                setEditingContract(null);
              }}
            />
          </div>
        )}
        {extendingContract && (
          <div key="extend-contract">
            <ExtendContractModal
              contract={extendingContract}
              onClose={() => setExtendingContract(null)}
              onSave={(updatedContract) => {
                onUpdateContract(updatedContract);
                setExtendingContract(null);
              }}
            />
          </div>
        )}
        {cancelingContract && (
          <div key="cancel-contract">
            <CancelContractModal
              isOpen={!!cancelingContract}
              contract={cancelingContract}
              onClose={() => setCancelingContract(null)}
              onConfirm={handleCancelContractConfirm}
            />
          </div>
        )}
        {showWorkoutLogger && (
          <div key="workout-logger">
            <WorkoutLoggerModal 
              studentId={student.id} 
              initialData={editingWorkoutLog}
              onClose={() => {
                setShowWorkoutLogger(false);
                setEditingWorkoutLog(null);
              }} 
            />
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
