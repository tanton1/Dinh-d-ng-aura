import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Student, StudentContract, TrainingPackage, Installment, Trainer, Branch, Session, DailyCheckin, LeaveRequest, SessionRequest, WorkoutLog } from '../../../types';
import { collection, getDocs, limit, query, where } from 'firebase/firestore';
import { ArrowLeft, CheckCircle, Plus, Activity, History, FileText, CreditCard, Calendar as CalendarIcon, AlertCircle, TrendingUp, Package, ClipboardCheck, Droplets, Moon, Smile, Zap, RefreshCw, Edit, User as UserIcon, CalendarClock, Dumbbell, Trash2, ChevronRight } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import ContractInvoice from './ContractInvoice';
import EditContractModal from './EditContractModal';
import ExtendContractModal from './ExtendContractModal';
import AddSessionsModal from './AddSessionsModal';
import RenewContractModal from './RenewContractModal';
import CancelContractModal from './CancelContractModal';
import StudentProgressAdmin from './StudentProgressAdmin';
import ConfirmationModal from '../../schedule/ConfirmationModal';
import WorkoutLoggerModal from '../../schedule/WorkoutLoggerModal';
import { useDatabase } from '../../../contexts/DatabaseContext';
import { addCalendarMonthsDateOnly, formatDate, isSameDayOrAfter } from '../../../utils/dateUtils';
import { getActiveContract } from '../../../utils/scheduler';
import { recordContractPayment, recordRefund } from '../../../services/financeLedgerService';
import { listCashAccounts, type CashAccount } from '../../../services/cashbookService';
import { getStudentContractUsage, type ContractUsageSummary } from '../../../services/businessReportingService';
import TrainingHistoryPanel from './TrainingHistoryPanel';
import { db } from '../../../lib/firebaseFirestore';
import './StudentManagement.css';

interface Props {
  student: Student;
  profile?: unknown;
  contracts: StudentContract[];
  packages: TrainingPackage[];
  trainers: Trainer[];
  branches: Branch[];
  sessions: Session[];
  onBack: () => void;
  onSaveContract: (contract: StudentContract, initialCashAccountId?: string) => Promise<void>;
  onUpdateContract: (contract: StudentContract, skipPayment?: boolean) => void;
}

type StudentDetailTab = 'info' | 'progress' | 'history' | 'checkin' | 'requests' | 'workout_logs';

import TrainerPrioritySelector from './TrainerPrioritySelector';

function hoChiMinhDateKey(reference = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(reference);
  const value = (type: string) => parts.find((part) => part.type === type)?.value || '';
  return `${value('year')}-${value('month')}-${value('day')}`;
}

function contractPausedOn(contract: StudentContract, date: string) {
  if (String(contract.status || '').toLowerCase() === 'frozen') return true;
  return (contract.pausePeriods || []).some((period) => {
    const startDate = String(period.startDate || '').slice(0, 10);
    const endDate = String(period.endDate || '').slice(0, 10);
    return period.type === 'preservation' && startDate <= date && endDate >= date;
  });
}

export default function StudentDetail({ student, profile, contracts, packages, trainers, branches, sessions, onBack, onSaveContract, onUpdateContract }: Props) {
  const isTrainer = (profile as any)?.role === 'trainer';
  const { deleteWorkoutLog } = useDatabase();
  const manualAttendanceUnavailable = 'Chưa thể điểm danh thủ công an toàn vì tạo buổi tập và trừ buổi hợp đồng cần một giao dịch máy chủ duy nhất. Vui lòng dùng quy trình chấm công đã kiểm toán.';
  const [isAddingPackage, setIsAddingPackage] = useState(false);
  const [isSavingPackage, setIsSavingPackage] = useState(false);
  const packageDraftContractId = useRef<string | null>(null);
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
  const [confirmAction, setConfirmAction] = useState<{title: string, message: string, onConfirm: () => void | Promise<void>} | null>(null);
  const [notification, setNotification] = useState<{message: string, type: 'success' | 'error'} | null>(null);
  const [referralCode, setReferralCode] = useState('');
  const [activeTab, setActiveTab] = useState<StudentDetailTab>(isTrainer ? 'progress' : 'info');
  const [detailSlide, setDetailSlide] = useState(0);
  const detailTrackRef = useRef<HTMLDivElement>(null);
  const [dailyCheckins, setDailyCheckins] = useState<DailyCheckin[]>([]);
  const [allDailyCheckins, setAllDailyCheckins] = useState<DailyCheckin[]>([]);
  const [sessionRequests, setSessionRequests] = useState<SessionRequest[]>([]);
  const [leaveRequests, setLeaveRequests] = useState<LeaveRequest[]>([]);
  const [workoutLogs, setWorkoutLogs] = useState<WorkoutLog[]>([]);
  const [relatedDataRevision, setRelatedDataRevision] = useState(0);
  const [loadingCheckins, setLoadingCheckins] = useState(false);
  const [activeContractUsage, setActiveContractUsage] = useState<ContractUsageSummary | null>(null);
  const [contractUsageLoading, setContractUsageLoading] = useState(false);
  const [contractUsageError, setContractUsageError] = useState('');
  const [cashAccounts, setCashAccounts] = useState<CashAccount[]>([]);
  const [initialCashAccountId, setInitialCashAccountId] = useState('');
  const [debtCashAccountId, setDebtCashAccountId] = useState('');

  useEffect(() => {
    if (isTrainer) return;
    let active = true;
    void listCashAccounts()
      .then((result) => { if (active) setCashAccounts(result.accounts.filter((item) => item.status === 'active')); })
      .catch(() => { if (active) setCashAccounts([]); });
    return () => { active = false; };
  }, [isTrainer]);

  useEffect(() => {
    if (notification) {
      const timer = setTimeout(() => setNotification(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [notification]);

  const activeContract = getActiveContract(student.id, contracts);
  const todayId = hoChiMinhDateKey();
  const pausedContract = contracts
    .filter((contract) => contract.studentId === student.id && contractPausedOn(contract, todayId))
    .sort((left, right) => new Date(right.endDate).getTime() - new Date(left.endDate).getTime())[0];
  const displayContract = activeContract || pausedContract;
  const historyContracts = contracts.filter(c => c.studentId === student.id && c.id !== activeContract?.id && c.id !== pausedContract?.id);
  const studentSessions = sessions.filter(s => s.studentId === student.id);

  useEffect(() => {
    let active = true;
    if (!db) return () => { active = false; };
    const firestore = db;
    const loadRelated = async () => {
      const studentQuery = (collectionName: string, maximum = 250) => getDocs(query(
        collection(firestore, collectionName),
        where('studentId', '==', student.id),
        limit(maximum),
      ));
      const [checkinsSnapshot, sessionRequestsSnapshot, leaveRequestsSnapshot, workoutLogsSnapshot] = await Promise.all([
        studentQuery('dailyCheckins', 180),
        studentQuery('sessionRequests', 250),
        studentQuery('leaveRequests', 250),
        studentQuery('workoutLogs', 500),
      ]);
      if (!active) return;
      const values = <T,>(snapshot: typeof checkinsSnapshot) => snapshot.docs.map((item) => ({ id: item.id, ...item.data() }) as T);
      setAllDailyCheckins(values<DailyCheckin>(checkinsSnapshot));
      setSessionRequests(values<SessionRequest>(sessionRequestsSnapshot));
      setLeaveRequests(values<LeaveRequest>(leaveRequestsSnapshot));
      setWorkoutLogs(values<WorkoutLog>(workoutLogsSnapshot));
    };
    void loadRelated().catch((cause) => {
      console.warn('Không thể tải dữ liệu chi tiết học viên.', cause);
      if (!active) return;
      setAllDailyCheckins([]);
      setSessionRequests([]);
      setLeaveRequests([]);
      setWorkoutLogs([]);
    });
    return () => { active = false; };
  }, [relatedDataRevision, student.id]);

  useEffect(() => {
    let active = true;
    if (!displayContract?.id) {
      setActiveContractUsage(null);
      setContractUsageError('');
      setContractUsageLoading(false);
      return () => { active = false; };
    }
    setContractUsageLoading(true);
    setContractUsageError('');
    setActiveContractUsage(null);
    void getStudentContractUsage(student.id, displayContract.id)
      .then((response) => {
        if (!active) return;
        setActiveContractUsage(response.summaries[0] ?? null);
        if (!response.summaries.length) setContractUsageError('Chưa có tổng hợp số buổi cho hợp đồng này.');
      })
      .catch((cause) => {
        if (!active) return;
        setContractUsageError(cause instanceof Error ? cause.message : 'Không thể đối chiếu số buổi.');
      })
      .finally(() => { if (active) setContractUsageLoading(false); });
    return () => { active = false; };
  }, [displayContract?.id, student.id]);

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

  const linkedTabs = React.useMemo(() => [
    { id: 'info' as const, label: 'Gói tập', shortLabel: 'Gói tập', icon: Package, visible: true },
    { id: 'progress' as const, label: 'Tiến độ cơ thể', shortLabel: 'Tiến độ', icon: TrendingUp, visible: true },
    { id: 'history' as const, label: 'Lịch sử tập', shortLabel: 'Lịch sử', icon: History, visible: true },
    { id: 'checkin' as const, label: 'Check-in', shortLabel: 'Check-in', icon: ClipboardCheck, visible: allDailyCheckins.some((item) => item.studentId === student.id) },
    { id: 'requests' as const, label: 'Yêu cầu', shortLabel: 'Yêu cầu', icon: CalendarClock, visible: allRequests.length > 0 },
    { id: 'workout_logs' as const, label: 'Nhật ký tạ', shortLabel: 'Tạ', icon: Dumbbell, visible: studentWorkoutLogs.length > 0 },
  ].filter((tab) => tab.visible), [allDailyCheckins, allRequests.length, student.id, studentWorkoutLogs.length]);

  useEffect(() => {
    if (!linkedTabs.some((tab) => tab.id === activeTab)) setActiveTab(isTrainer ? 'progress' : 'info');
  }, [activeTab, isTrainer, linkedTabs]);

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
        setEndDate(addCalendarMonthsDateOnly(startDate, customDurationMonths));
      }
      return;
    }

    const pkg = packages.find(p => p.id === selectedPackageId);
    if (!pkg) {
      setEndDate('');
      return;
    }
    
    if (startDate) {
      setEndDate(addCalendarMonthsDateOnly(startDate, pkg.durationMonths));
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

  const closePackageModal = () => {
    if (isSavingPackage) return;
    setIsAddingPackage(false);
    packageDraftContractId.current = null;
  };

  const handleRegisterPackage = async () => {
    if (isSavingPackage) return;

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
    const totalDue = pkgPrice - discountAmount;
    if (discountAmount < 0 || totalDue < 0) {
      setNotification({ message: 'Mức giảm giá không hợp lệ.', type: 'error' });
      return;
    }
    if (amountPaid < 0 || amountPaid > totalDue) {
      setNotification({ message: 'Số tiền thu lần đầu không được vượt số tiền phải thanh toán.', type: 'error' });
      return;
    }
    if (amountPaid > 0 && !initialCashAccountId) {
      setNotification({ message: 'Hãy chọn quỹ nhận khoản thanh toán lần đầu.', type: 'error' });
      return;
    }

    const debt = totalDue - amountPaid;
    const contractId = packageDraftContractId.current || crypto.randomUUID();
    packageDraftContractId.current = contractId;
    let finalInstallments: Installment[] = [];

    let referringPT: Trainer | undefined;
    if (referralCode) {
      const normalizedCode = referralCode.trim().replace(/\s+/g, '').toUpperCase();
      referringPT = trainers.find(t => (t.employeeCode || '').trim().replace(/\s+/g, '').toUpperCase() === normalizedCode);
      if (!referringPT) {
        setNotification({ message: 'Mã giới thiệu PT không tồn tại hoặc chưa được gắn cho nhân viên.', type: 'error' });
        return;
      }
      if (!Number.isFinite(referringPT.commissionRate) || referringPT.commissionRate < 2 || referringPT.commissionRate > 10) {
        setNotification({ message: 'PT giới thiệu chưa được thiết lập hoa hồng hợp lệ từ 2–10%.', type: 'error' });
        return;
      }
    }

    if (amountPaid > 0) {
      finalInstallments.push({
        id: `${contractId}-initial`,
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
          id: `${contractId}-installment-${idx + 1}`,
          amount: inst.amount,
          date: inst.date,
          status: 'pending' as const
        }))
      ];
    }

    const newContract: StudentContract = {
      id: contractId,
      studentId: student.id,
      trainerId: selectedTrainerIds[0] || undefined,
      trainerIds: selectedTrainerIds,
      nutritionPTIds: nutritionPTIds,
      branchId: selectedBranchId,
      packageId: selectedPackageId === 'custom' ? `custom-${contractId}` : selectedPackageId,
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
      referralStaffId: referringPT?.id || null,
      referralCommissionRate: referringPT?.commissionRate || null,
      referralCommission: null,
    };
    
    const pendingInstallments = finalInstallments.filter(i => i.status === 'pending');
    if (pendingInstallments.length > 0) {
      newContract.nextPaymentDate = pendingInstallments[0].date;
    }

    setIsSavingPackage(true);
    try {
      await onSaveContract(newContract, initialCashAccountId || undefined);
      setIsAddingPackage(false);
      packageDraftContractId.current = null;
      setSelectedPackageId('');
      setSelectedTrainerIds([]);
      setNutritionPTIds([]);
      setSelectedBranchId('');
      setReferralCode('');
      setStartDate(new Date().toISOString().split('T')[0]);
      setEndDate('');
      setPaidAmount('');
      setDiscount('');
      setInstallmentCount(1);
      setInstallments([]);
      setInitialCashAccountId('');
      setNotification({ message: 'Đã tạo hợp đồng và ghi nhận khoản thu ban đầu.', type: 'success' });
    } catch (error) {
      setNotification({
        message: error instanceof Error ? error.message : 'Không thể tạo hợp đồng. Dữ liệu đã nhập được giữ lại để thử lại.',
        type: 'error',
      });
    } finally {
      setIsSavingPackage(false);
    }
  };

  const handlePayInstallment = (contractId: string, installmentId: string) => {
    const contract = contracts.find(c => c.id === contractId);
    if (!contract || !contract.installments) return;

    const installmentToPay = contract.installments.find(i => i.id === installmentId);
    if (!installmentToPay) return;
    if (installmentToPay.status !== 'pending') {
      setNotification({ message: 'Kỳ trả góp này đã được xử lý hoặc không còn hiệu lực.', type: 'error' });
      return;
    }
    const cashAccount = cashAccounts.find((item) => item.id === debtCashAccountId && (!contract.branchId || item.branchId === contract.branchId));
    if (!cashAccount) {
      setNotification({ message: 'Hãy chọn đúng quỹ nhận tiền trước khi thu kỳ trả góp.', type: 'error' });
      return;
    }

    const idempotencyKey = crypto.randomUUID();
    const effectiveAt = new Date().toISOString();

    setConfirmAction({
      title: 'Xác nhận thu tiền',
      message: `Xác nhận thu tiền kỳ này: ${installmentToPay.amount.toLocaleString('vi-VN')}đ?`,
      onConfirm: async () => {
        setPayingInstallmentId(installmentId);
        try {
          await recordContractPayment({
            contractId: contract.id,
            amount: installmentToPay.amount,
            effectiveAt,
            paymentMethod: 'transfer',
            cashAccountId: cashAccount.id,
            installmentId,
            idempotencyKey,
            note: `Thu kỳ trả góp ${installmentId}`,
          });
          setConfirmAction(null);
          setNotification({ message: 'Đã thu tiền và ghi sổ tài chính thành công.', type: 'success' });
        } catch (error) {
          setNotification({
            message: error instanceof Error ? error.message : 'Không thể ghi nhận khoản thu. Hãy tải lại và thử lại.',
            type: 'error',
          });
          throw error;
        } finally {
          setPayingInstallmentId(null);
        }
      }
    });
  };

  const handleUndoInstallment = (contractId: string, installmentId: string) => {
    const contract = contracts.find(c => c.id === contractId);
    if (!contract || !contract.installments) return;

    const installmentToUndo = contract.installments.find(i => i.id === installmentId);
    if (!installmentToUndo) return;
    if (installmentToUndo.status !== 'paid') {
      setNotification({ message: 'Chỉ có thể hoàn khoản thu của kỳ đã thanh toán.', type: 'error' });
      return;
    }
    const cashAccount = cashAccounts.find((item) => item.id === debtCashAccountId && (!contract.branchId || item.branchId === contract.branchId));
    if (!cashAccount) {
      setNotification({ message: 'Hãy chọn đúng quỹ chi trước khi hoàn tiền.', type: 'error' });
      return;
    }

    const idempotencyKey = crypto.randomUUID();
    const effectiveAt = new Date().toISOString();

    setConfirmAction({
      title: 'Xác nhận hoàn tác',
      message: `Xác nhận hoàn khoản thu kỳ này: ${installmentToUndo.amount.toLocaleString('vi-VN')}đ? Hệ thống sẽ tạo bút toán hoàn tiền, không xóa chứng từ cũ.`,
      onConfirm: async () => {
        setPayingInstallmentId(installmentId);
        try {
          await recordRefund({
            contractId: contract.id,
            amount: installmentToUndo.amount,
            effectiveAt,
            paymentMethod: 'transfer',
            cashAccountId: cashAccount.id,
            installmentId,
            idempotencyKey,
            reason: `Hoàn khoản thu kỳ trả góp ${installmentId}`,
          });
          setConfirmAction(null);
          setNotification({ message: 'Đã tạo bút toán hoàn tiền và mở lại kỳ thanh toán.', type: 'success' });
        } catch (error) {
          setNotification({
            message: error instanceof Error ? error.message : 'Không thể hoàn khoản thu. Hãy tải lại và thử lại.',
            type: 'error',
          });
          throw error;
        } finally {
          setPayingInstallmentId(null);
        }
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

  // The callable and training history share contract-usage-v2. The stored
  // projection is only a visibly marked fallback while the canonical summary
  // is loading or temporarily unavailable.
  const actualUsed = displayContract
    ? Math.max(0, Math.floor(Number(activeContractUsage?.usedSessions ?? displayContract.usedSessions ?? 0)))
    : 0;
  const pendingAttendanceCount = activeContractUsage
    ? Math.max(0, Math.floor(Number(
      activeContractUsage.chargedPendingAttendanceSessions
        ?? activeContractUsage.usedSessions
          - activeContractUsage.attendedSessions
          - activeContractUsage.noShowSessions
          - activeContractUsage.policyChargedSessions
          - activeContractUsage.legacyProjectionAdjustment,
    )))
    : 0;
  const nextStudentSession = studentSessions
    .filter((session) => (session.status === 'scheduled' || session.status === 'rescheduled') && session.date >= todayId)
    .sort((left, right) => left.date.localeCompare(right.date) || Number(left.hour || 0) - Number(right.hour || 0))[0];
  const contractDebt = displayContract
    ? Math.max(0, Number(displayContract.totalPrice || 0) - Number(displayContract.discount || 0) - Number(displayContract.paidAmount || 0))
    : 0;
  const primaryTrainerId = displayContract?.trainerIds?.[0] || displayContract?.trainerId;
  const primaryTrainer = primaryTrainerId ? trainers.find((trainer) => trainer.id === primaryTrainerId) : undefined;
  const selectDetailSlide = (index: number) => {
    const normalizedIndex = Math.min(2, Math.max(0, index));
    setDetailSlide(normalizedIndex);
    const track = detailTrackRef.current;
    if (track) track.scrollTo({ left: track.clientWidth * normalizedIndex, behavior: 'smooth' });
  };

  return (
    <div className="student-detail space-y-4 animate-in fade-in slide-in-from-right-4 duration-300">
      <button onClick={onBack} className="student-detail__back flex items-center gap-2 text-zinc-400 hover:text-white mb-2 transition-colors">
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

      <section className="student-detail__carousel" aria-roledescription="carousel" aria-label="Tóm tắt hồ sơ và gói tập">
        <div
          ref={detailTrackRef}
          className="student-detail__carousel-track"
          onScroll={(event) => {
            const track = event.currentTarget;
            if (track.clientWidth > 0) setDetailSlide(Math.min(2, Math.max(0, Math.round(track.scrollLeft / track.clientWidth))));
          }}
        >
          <article className="student-detail__carousel-slide is-profile">
            <div><small>HỒ SƠ HỌC VIÊN</small><h2>{student.name}</h2><p>{student.phone || 'Chưa có SĐT'} · {student.email || 'Chưa có email'}</p></div>
            <span className="student-detail__carousel-badge">{student.status === 'active' ? 'Đang hoạt động' : 'Đã lưu trữ'}</span>
          </article>
          <article className="student-detail__carousel-slide is-package">
            <div><small>GÓI TẬP ĐANG LIÊN KẾT</small><h2>{displayContract?.packageName || 'Chưa có gói tập'}</h2><p>{activeContract ? `Hết hạn ${formatDate(activeContract.endDate)}` : pausedContract ? `Đang bảo lưu · hết hạn ${formatDate(pausedContract.endDate)}` : 'Đăng ký gói để bắt đầu quản lý lịch và số buổi.'}</p></div>
            <div className="student-detail__carousel-metric"><strong>{displayContract ? Math.max(0, displayContract.totalSessions - actualUsed) : 0}</strong><span>Buổi còn lại</span></div>
            {displayContract && <div className="student-detail__carousel-progress"><i style={{ width: `${Math.min(100, displayContract.totalSessions ? actualUsed / displayContract.totalSessions * 100 : 0)}%` }} /></div>}
          </article>
          <article className="student-detail__carousel-slide is-operations">
            <div><small>LỊCH & TÀI CHÍNH</small><h2>{nextStudentSession ? `${formatDate(nextStudentSession.date)} · ${String(nextStudentSession.hour ?? 0).padStart(2, '0')}:00` : 'Chưa xếp lịch'}</h2><p>PT chính: {primaryTrainer?.name || 'Chưa phân công'}</p></div>
            <div className={`student-detail__carousel-metric ${contractDebt > 0 ? 'is-debt' : ''}`}><strong>{contractDebt.toLocaleString('vi-VN')}đ</strong><span>Công nợ</span></div>
          </article>
        </div>
        <footer className="student-detail__carousel-controls">
          <span>{detailSlide + 1}/3</span>
          <div>{[0, 1, 2].map((index) => <button type="button" key={index} className={detailSlide === index ? 'active' : ''} aria-label={`Xem thông tin học viên ${index + 1}`} aria-current={detailSlide === index ? 'true' : undefined} onClick={() => selectDetailSlide(index)} />)}</div>
          <button type="button" aria-label="Slide thông tin tiếp theo" onClick={() => selectDetailSlide(detailSlide === 2 ? 0 : detailSlide + 1)}><ChevronRight size={17} /></button>
        </footer>
      </section>

      {/* Tabs */}
      <div className="student-detail__tabs" role="tablist" aria-label="Nội dung hồ sơ học viên">
        {linkedTabs.map((tab) => {
          const Icon = tab.icon;
          return <button key={tab.id} type="button" role="tab" aria-selected={activeTab === tab.id} onClick={() => setActiveTab(tab.id)} className={activeTab === tab.id ? 'active' : ''}><Icon size={16} /><span className="student-detail__tab-label-full">{tab.label}</span><span className="student-detail__tab-label-short">{tab.shortLabel}</span></button>;
        })}
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
                                void deleteWorkoutLog(log.id).then(() => {
                                  setWorkoutLogs((current) => current.filter((item) => item.id !== log.id));
                                });
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
        <TrainingHistoryPanel subject="student" subjectId={student.id} subjectName={student.name || 'Học viên Aura'} contractId={displayContract?.id} />
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
                  setConfirmAction({
                    title: 'Xác nhận bảo lưu',
                    message: 'Học viên sẽ tạm ngừng nhận lịch mới. Lịch sử và số buổi đã dùng vẫn được giữ nguyên.',
                    onConfirm: () => {
                      onUpdateContract({
                        ...activeContract,
                        status: 'frozen',
                        frozenAt: new Date().toISOString()
                      });
                      setConfirmAction(null);
                      setNotification({message: 'Đã bảo lưu thành công!', type: 'success'});
                    }
                  });
                }}
                className="text-xs font-medium flex items-center gap-1 px-2 py-1 rounded-lg text-blue-500 bg-blue-500/10 hover:text-blue-400"
              >
                Bảo lưu
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
        
        {!activeContract && pausedContract && <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-200" role="status">
          <span>Gói <strong>{pausedContract.packageName}</strong> đang bảo lưu nên không nhận lịch mới. Đã dùng {actualUsed}/{pausedContract.totalSessions} buổi; lịch sử vẫn được giữ để đối soát.</span>
          {!isTrainer && String(pausedContract.status || '').toLowerCase() === 'frozen' && <button
            type="button"
            className="rounded-lg bg-emerald-500/15 px-3 py-2 font-bold text-emerald-300 hover:bg-emerald-500/25"
            onClick={() => setConfirmAction({
              title: 'Mở lại hợp đồng bảo lưu',
              message: 'Học viên sẽ có thể nhận lịch mới từ hôm nay. Thời gian đã bảo lưu được cộng vào ngày hết hạn.',
              onConfirm: () => {
                const frozenAt = pausedContract.frozenAt ? new Date(pausedContract.frozenAt).getTime() : NaN;
                const now = Date.now();
                const frozenDuration = Number.isFinite(frozenAt) ? Math.max(0, now - frozenAt) : 0;
                const endAt = new Date(`${pausedContract.endDate}T12:00:00+07:00`).getTime();
                const nextEndDate = Number.isFinite(endAt)
                  ? hoChiMinhDateKey(new Date(endAt + frozenDuration))
                  : pausedContract.endDate;
                onUpdateContract({ ...pausedContract, frozenAt: undefined, status: 'active', endDate: nextEndDate });
                setConfirmAction(null);
                setNotification({ message: 'Đã mở lại hợp đồng bảo lưu!', type: 'success' });
              },
            })}
          >Mở bảo lưu</button>}
        </div>}

        {activeContract ? (
          <div className="space-y-4 relative z-10">
            {/* contract details */}
            <div className="flex justify-between items-center">
              <span className="text-zinc-200 font-medium text-lg">{activeContract.packageName}</span>
              <div className="flex flex-col items-end gap-0.5">
                <span className="text-pink-500 font-bold text-xl">{actualUsed} / {activeContract.totalSessions}</span>
                <small className="text-[10px] font-semibold text-zinc-500">{contractUsageLoading ? 'Đang đối chiếu lịch sử…' : contractUsageError ? 'Projection · chưa xác minh' : 'Đã tính theo lịch sử'}</small>
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
                style={{ width: `${Math.min(100, activeContract.totalSessions ? (actualUsed / activeContract.totalSessions) * 100 : 0)}%` }}
              ></div>
            </div>
            {activeContractUsage && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center text-[10px] text-zinc-400">
                <span className="rounded-lg bg-zinc-950/60 p-2"><b className="block text-emerald-400 text-sm">{activeContractUsage.attendedSessions}</b>Có tập</span>
                <span className="rounded-lg bg-zinc-950/60 p-2"><b className="block text-sky-400 text-sm">{pendingAttendanceCount}</b>Chờ PT</span>
                <span className="rounded-lg bg-zinc-950/60 p-2"><b className="block text-amber-400 text-sm">{activeContractUsage.noShowSessions + activeContractUsage.policyChargedSessions}</b>Vắng tính buổi</span>
                <span className="rounded-lg bg-zinc-950/60 p-2"><b className="block text-pink-400 text-sm">{activeContractUsage.remainingSessions}</b>Còn lại</span>
              </div>
            )}
            {pendingAttendanceCount > 0 ? <p className="m-0 text-[10px] leading-relaxed text-sky-300">Có {pendingAttendanceCount} buổi đã tự tính khi đến giờ và đang chờ PT xác nhận có tập, đi trễ hoặc không đến.</p> : null}
            {activeContractUsage?.legacyProjectionAdjustment ? <p className="m-0 text-[10px] leading-relaxed text-amber-300">Có {activeContractUsage.legacyProjectionAdjustment} buổi dữ liệu cũ chưa liên kết được session; Aura giữ riêng để không làm mất quyền lợi.</p> : null}
            {contractUsageError ? <p className="m-0 text-[10px] leading-relaxed text-red-300">{contractUsageError}</p> : null}
            
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
                {isManagingDebt && <label className="mb-3 block text-xs font-bold text-zinc-500">Quỹ nhận/chi
                  <select value={debtCashAccountId} onChange={(event) => setDebtCashAccountId(event.target.value)} className="mt-2 min-h-11 w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 text-sm font-bold text-white">
                    <option value="">Chọn quỹ bắt buộc</option>
                    {cashAccounts.filter((item) => !activeContract.branchId || item.branchId === activeContract.branchId).map((item) => <option key={item.id} value={item.id}>{item.name} · {item.balance.toLocaleString('vi-VN')}đ</option>)}
                  </select>
                </label>}
                
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
                                  disabled={payingInstallmentId === inst.id}
                                  className="text-xs font-bold bg-zinc-800 text-zinc-400 px-3 py-1.5 rounded-lg hover:bg-zinc-700 hover:text-white transition-colors shadow-sm disabled:cursor-not-allowed disabled:opacity-50"
                                  title="Hoàn tác thu tiền"
                                >
                                  {payingInstallmentId === inst.id ? 'Đang xử lý…' : 'Hoàn tác'}
                                </button>
                              )}
                            </div>
                          ) : inst.status === 'cancelled' ? (
                            <span className="text-xs font-medium text-zinc-500 bg-zinc-800 px-2 py-1 rounded-md">
                              Đã hủy
                            </span>
                          ) : isManagingDebt ? (
                            <button 
                              onClick={() => handlePayInstallment(activeContract.id, inst.id)}
                              disabled={payingInstallmentId === inst.id}
                              className="text-xs font-bold bg-pink-500 text-white px-3 py-1.5 rounded-lg hover:bg-pink-600 transition-colors shadow-sm disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              {payingInstallmentId === inst.id ? 'Đang xử lý…' : 'Thu tiền'}
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
              type="button"
              disabled
              title={manualAttendanceUnavailable}
              className="w-full mt-2 bg-zinc-800/70 text-zinc-500 border border-zinc-700 py-4 rounded-xl font-bold flex items-center justify-center gap-2 cursor-not-allowed"
            >
              <CheckCircle className="w-6 h-6" />
              Chưa thể điểm danh thủ công
            </button>
            <p className="mt-2 text-xs text-amber-400/90">{manualAttendanceUnavailable}</p>
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
          <div className="student-package-modal" role="dialog" aria-modal="true" aria-labelledby="student-package-modal-title">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="student-package-modal__backdrop"
              onClick={closePackageModal}
            />
            <motion.div 
              initial={{ opacity: 0, y: '100%' }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: '100%' }}
              className="student-package-modal__dialog"
            >
              <h3 id="student-package-modal-title" className="student-package-modal__title">Đăng ký gói tập mới</h3>

              <div className="student-package-modal__content">
                <div className="student-package-modal__field">
                  <label>Chọn gói tập</label>
                  <select 
                    value={selectedPackageId}
                    onChange={e => setSelectedPackageId(e.target.value)}
                    className="student-package-modal__input"
                  >
                    <option value="">-- Chọn gói --</option>
                    <option value="custom">Gói tuỳ chỉnh (Nhập tay)</option>
                    {packages.map(p => (
                      <option key={p.id} value={p.id}>{p.name} ({p.totalSessions} buổi - {p.price.toLocaleString('vi-VN')}đ)</option>
                    ))}
                  </select>
                </div>

                {selectedPackageId === 'custom' && (
                  <div className="student-package-modal__custom">
                    <div className="student-package-modal__field">
                      <label>Tên gói tập</label>
                      <input 
                        type="text" 
                        value={customPackageName}
                        onChange={e => setCustomPackageName(e.target.value)}
                        className="student-package-modal__input"
                      />
                    </div>
                    <div className="student-package-modal__two-columns">
                      <div className="student-package-modal__field">
                        <label>Số buổi</label>
                        <input 
                          type="number" 
                          min="1"
                          value={customTotalSessions}
                          onChange={e => setCustomTotalSessions(Number(e.target.value))}
                          className="student-package-modal__input"
                        />
                      </div>
                      <div className="student-package-modal__field">
                        <label>Thời hạn (Tháng)</label>
                        <input 
                          type="number" 
                          min="1"
                          value={customDurationMonths}
                          onChange={e => setCustomDurationMonths(Number(e.target.value))}
                          className="student-package-modal__input"
                        />
                      </div>
                    </div>
                    <div className="student-package-modal__field">
                      <label>Giá gói (VNĐ)</label>
                      <input 
                        type="number" 
                        min="0"
                        value={customPrice}
                        onChange={e => setCustomPrice(Number(e.target.value))}
                        className="student-package-modal__input"
                      />
                    </div>
                  </div>
                )}

                <div className="student-package-modal__field">
                  <label>Chọn cơ sở <small>(không bắt buộc)</small></label>
                  <select 
                    value={selectedBranchId}
                    onChange={e => setSelectedBranchId(e.target.value)}
                    className="student-package-modal__input"
                  >
                    <option value="">-- Tất cả cơ sở --</option>
                    {branches.map(b => (
                      <option key={b.id} value={b.id}>{b.name}</option>
                    ))}
                  </select>
                </div>

                <div className="student-package-modal__field">
                  <label>Chọn PT</label>
                  <TrainerPrioritySelector
                    trainers={trainers}
                    selectedTrainerIds={selectedTrainerIds}
                    onChange={setSelectedTrainerIds}
                  />
                </div>

                <div className="student-package-modal__field">
                  <label>Chọn PT Dinh Dưỡng</label>
                  <div className="student-package-modal__choices">
                    {trainers.filter(t => t.status === 'active').map(t => (
                      <label key={`nutri-${t.id}`}>
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
                          className="student-package-modal__checkbox"
                        />
                        <span>{t.name}</span>
                      </label>
                    ))}
                  </div>
                </div>

                <div className="student-package-modal__field">
                  <label>Mã người giới thiệu <small>(nếu có)</small></label>
                  <input 
                    type="text" 
                    value={referralCode}
                    onChange={e => setReferralCode(e.target.value)}
                    placeholder="VD: PT001"
                    className="student-package-modal__input"
                  />
                </div>

                <div className="student-package-modal__field">
                  <label>Giảm giá (VNĐ)</label>
                  <input 
                    type="number" 
                    value={discount}
                    onChange={e => setDiscount(e.target.value)}
                    className="student-package-modal__input"
                    placeholder="VD: 500000"
                  />
                </div>

                {selectedPackageId && (
                  <div className="student-package-modal__selected">
                    <div className="student-package-modal__two-columns">
                      <div className="student-package-modal__field">
                        <label>Ngày bắt đầu</label>
                        <input 
                          type="date" 
                          value={startDate}
                          onChange={e => setStartDate(e.target.value)}
                          className="student-package-modal__input"
                        />
                      </div>
                      <div className="student-package-modal__field">
                        <label>Ngày kết thúc</label>
                        <input 
                          type="date" 
                          value={endDate}
                          disabled
                          className="student-package-modal__input student-package-modal__input--disabled"
                        />
                      </div>
                    </div>

                    <div className="student-package-modal__field">
                      <label>Số tiền thanh toán trước (VNĐ)</label>
                      <input 
                        type="number" 
                        value={paidAmount}
                        onChange={e => setPaidAmount(e.target.value)}
                        className="student-package-modal__input"
                        placeholder="VD: 1000000"
                      />
                      <p className="student-package-modal__hint">Có thể thanh toán một phần hoặc toàn bộ.</p>
                    </div>

                    {Number(paidAmount) > 0 && <div className="student-package-modal__field">
                      <label>Quỹ nhận tiền</label>
                      <select value={initialCashAccountId} onChange={(event) => setInitialCashAccountId(event.target.value)} className="student-package-modal__input" required>
                        <option value="">Chọn quỹ bắt buộc</option>
                        {cashAccounts.filter((item) => !selectedBranchId || item.branchId === selectedBranchId).map((item) => <option key={item.id} value={item.id}>{item.name} · {item.balance.toLocaleString('vi-VN')}đ</option>)}
                      </select>
                      {!cashAccounts.length && <p className="student-package-modal__hint">Chưa có quỹ hoạt động. Hãy mở Sổ quỹ trước.</p>}
                    </div>}

                    {Number(paidAmount) < ((packages.find(p => p.id === selectedPackageId)?.price || 0) - (Number(discount) || 0)) && (
                      <motion.div 
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        className="student-package-modal__debt"
                      >
                        <div className="student-package-modal__debt-total">
                          <span>Số tiền còn nợ:</span>
                          <strong>
                            {((packages.find(p => p.id === selectedPackageId)?.price || 0) - (Number(discount) || 0) - Number(paidAmount)).toLocaleString('vi-VN')}đ
                          </strong>
                        </div>
                        
                        <div className="student-package-modal__field">
                          <label>Số kỳ thanh toán</label>
                          <select 
                            value={installmentCount}
                            onChange={e => setInstallmentCount(Number(e.target.value))}
                            className="student-package-modal__input"
                          >
                            {[1, 2, 3, 4, 5, 6].map(n => (
                              <option key={n} value={n}>{n} kỳ</option>
                            ))}
                          </select>
                        </div>

                        <div className="student-package-modal__installments">
                          {installments.map((inst, idx) => (
                            <div key={`inst-edit-${idx}`} className="student-package-modal__two-columns">
                              <div className="student-package-modal__field">
                                <label>Hẹn trả kỳ {idx + 1}</label>
                                <input 
                                  type="date" 
                                  value={inst.date}
                                  onChange={e => handleInstallmentChange(idx, 'date', e.target.value)}
                                  className="student-package-modal__input"
                                />
                              </div>
                              <div className="student-package-modal__field">
                                <label>Số tiền (VNĐ)</label>
                                <input 
                                  type="number" 
                                  value={inst.amount}
                                  onChange={e => handleInstallmentChange(idx, 'amount', Number(e.target.value))}
                                  className="student-package-modal__input"
                                />
                              </div>
                            </div>
                          ))}
                        </div>
                      </motion.div>
                    )}
                  </div>
                )}

                <div className="student-package-modal__actions">
                  <button 
                    onClick={closePackageModal}
                    disabled={isSavingPackage}
                    className="student-package-modal__cancel"
                  >
                    Hủy
                  </button>
                  <button 
                    onClick={() => void handleRegisterPackage()}
                    disabled={!selectedPackageId || isSavingPackage}
                    className="student-package-modal__confirm"
                  >
                    {isSavingPackage ? 'Đang ghi nhận…' : 'Xác nhận'}
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
                setRelatedDataRevision((current) => current + 1);
              }} 
            />
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
