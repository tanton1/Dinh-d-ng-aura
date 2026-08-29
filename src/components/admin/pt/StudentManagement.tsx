import React, { useEffect, useState, useMemo, useRef } from 'react';
import { Student, UserProfile, StudentContract, TrainingPackage, Trainer, Branch } from '../../../types';
import { User } from 'firebase/auth';
import { db } from '../../../lib/firebase';
import { Search, Plus, Edit2, Trash2, Phone, Mail, Calendar, CheckCircle, XCircle, AlertCircle, User as UserIcon, Package, RefreshCw, SlidersHorizontal, ChevronRight } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import DateRangeFilter from './DateRangeFilter';
import RenewContractModal from './RenewContractModal';
import { LOGO_URL } from '../../../constants';
import { useDatabase } from '../../../contexts/DatabaseContext';
import { useAuth } from '../../../contexts/AuthContext';
import { provisionStudentAccount } from '../../../services/identityAccessService';
import { recordContractPayment } from '../../../services/financeLedgerService';
import StudentRosterTable from './StudentRosterTable';
import { studentEligibilityForWeek } from '../../../domain/pt/studentEligibility';
import './StudentManagement.css';

const StudentDetail = React.lazy(() => import('./StudentDetail'));

interface Props {
  user: User | null;
  profile: UserProfile | null;
}

export default function StudentManagement({ user, profile }: Props) {
  const { authzReady, hasCapability } = useAuth();
  const { 
    students, contracts, packages, trainers, branches, sessions, ptAvailability,
    updateStudent, deleteStudent,
    addContract, updateContract, deleteContract,
    updateUserProfile
  } = useDatabase();
  const canManageStudents = (authzReady && hasCapability('pt.operations.manage')) || import.meta.env.MODE === 'e2e';
  const canInviteStudents = authzReady && hasCapability('identity.invite.manage');
  const canOpenStudentForm = canInviteStudents || import.meta.env.MODE === 'e2e';
  
  const getCalculatedUsedSessions = (contract: StudentContract | undefined) => contract
    ? Math.max(0, Math.floor(Number(contract.usedSessions || 0)))
    : 0;
  
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedBranchId, setSelectedBranchId] = useState<string>('all');
  const [selectedTrainerId, setSelectedTrainerId] = useState<string>('all');
  const [selectedNutritionPTId, setSelectedNutritionPTId] = useState<string>('all');
  const [contractFilter, setContractFilter] = useState<'active' | 'expiring_week' | 'expiring_month' | 'expired' | 'paused' | 'inactive' | 'cancelled' | 'all'>('all');
  const [dateRange, setDateRange] = useState<{ start: Date, end: Date } | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [editingStudent, setEditingStudent] = useState<Student | null>(null);
  const [selectedStudentId, setSelectedStudentId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [studentToDelete, setStudentToDelete] = useState<string | null>(null);
  const [alertMessage, setAlertMessage] = useState<string | null>(null);
  const contractCreationPromises = useRef(new Map<string, Promise<void>>());
  const [studentPage, setStudentPage] = useState(1);
  const [overviewSlide, setOverviewSlide] = useState(0);
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const overviewTrackRef = useRef<HTMLDivElement>(null);
  const [renewingStudent, setRenewingStudent] = useState<{ student: Student, contract: StudentContract } | null>(null);
  const [formData, setFormData] = useState<Partial<Student>>({
    name: '',
    phone: '',
    email: '',
    dob: '',
    sessionsPerWeek: 3,
    availableSlots: [],
    status: 'active',
    branchId: '',
    nutritionNote: '',
  });

  const allowedStudents = useMemo(() => {
    // This legacy CRM reads admin-only collections. Never fall back to a
    // same-branch client filter for trainers/managers: their actor-scoped
    // workspaces use callables and must not receive the full collection.
    return canManageStudents ? [...students] : [];
  }, [canManageStudents, students]);

  const contractsByStudent = useMemo(() => {
    const index = new Map<string, StudentContract[]>();
    contracts.forEach((contract) => {
      const current = index.get(contract.studentId) || [];
      current.push(contract);
      index.set(contract.studentId, current);
    });
    index.forEach((items) => items.sort((left, right) => right.startDate.localeCompare(left.startDate)));
    return index;
  }, [contracts]);
  const contractsById = useMemo(() => new Map(contracts.map((contract) => [contract.id, contract])), [contracts]);

  const weekEligibilityByStudent = useMemo(() => new Map(allowedStudents.map((student) => [
    student.id,
    studentEligibilityForWeek(student, contractsByStudent.get(student.id) || []),
  ])), [allowedStudents, contractsByStudent]);

  const filteredStudents = useMemo(() => {
    let filtered = allowedStudents.filter(s => {
      if (!searchTerm) return true;
      const matchName = s.name && s.name.toLowerCase().includes(searchTerm.toLowerCase());
      const matchPhone = s.phone && s.phone.includes(searchTerm);
      return matchName || matchPhone;
    });

    // Filter by branch (on top of allowed)
    if (selectedBranchId !== 'all') {
      if (selectedBranchId === 'none') {
        filtered = filtered.filter(s => !s.branchId || s.branchId === '');
      } else {
        filtered = filtered.filter(s => s.branchId === selectedBranchId);
      }
    }

    if (dateRange) {
      // If range is 'Tất cả' (start is 1970), don't filter out students without joinDate
      const isAllTime = dateRange.start.getTime() === 0;
      
      filtered = filtered.filter(s => {
        if (!s.joinDate) return isAllTime;
        const joinDate = new Date(s.joinDate);
        return joinDate >= dateRange.start && joinDate <= dateRange.end;
      });
    }

    // Filter by trainer dropdown
    if (selectedTrainerId !== 'all') {
      if (selectedTrainerId === 'none') {
        filtered = filtered.filter(s => (weekEligibilityByStudent.get(s.id)?.eligibleContracts || [])
          .every(c => !c.trainerId && (!c.trainerIds || c.trainerIds.length === 0)));
      } else {
        filtered = filtered.filter(s => (weekEligibilityByStudent.get(s.id)?.eligibleContracts || [])
          .some(c => c.trainerId === selectedTrainerId || c.trainerIds?.includes(selectedTrainerId)));
      }
    }

    // Filter by nutrition PT dropdown
    if (selectedNutritionPTId !== 'all') {
      if (selectedNutritionPTId === 'none') {
        filtered = filtered.filter(s => (weekEligibilityByStudent.get(s.id)?.eligibleContracts || [])
          .every(c => !c.nutritionPTIds || c.nutritionPTIds.length === 0));
      } else {
        filtered = filtered.filter(s => (weekEligibilityByStudent.get(s.id)?.eligibleContracts || [])
          .some(c => c.nutritionPTIds?.includes(selectedNutritionPTId)));
      }
    }

    if (contractFilter !== 'all') {
      filtered = filtered.filter(s => {
        const studentContracts = contractsByStudent.get(s.id) || [];
        const weekEligibility = weekEligibilityByStudent.get(s.id);
        const effectiveContract = weekEligibility?.eligibleContracts[0];
        let status = 'none';
        
        if (studentContracts.length > 0) {
          const latestContract = studentContracts[0];
          
          if (latestContract.status === 'expired') {
            status = 'expired';
          } else if (latestContract.status === 'cancelled') {
            status = 'cancelled';
          } else if (latestContract.status === 'frozen') {
            status = 'paused';
          } else if (latestContract.status !== 'active') {
            status = 'inactive';
          } else {
            const endDate = new Date(latestContract.endDate);
            const now = new Date();
            
            const timeDiff = endDate.getTime() - now.getTime();
            const daysLeft = Math.ceil(timeDiff / (1000 * 3600 * 24));
            const sessionsLeft = latestContract.totalSessions - getCalculatedUsedSessions(latestContract);
            
            if (daysLeft < 0 || sessionsLeft <= 0) {
              status = 'expired';
            } else if (daysLeft <= 7 || sessionsLeft <= 2) {
              status = 'expiring_week';
            } else {
              const isSameMonth = !isNaN(endDate.getTime()) && endDate.getMonth() === now.getMonth() && endDate.getFullYear() === now.getFullYear();
              if (isSameMonth || sessionsLeft <= 5) {
                status = 'expiring_month';
              } else {
                status = 'active';
              }
            }
          }
        }
        
        if (contractFilter === 'inactive') {
          return s.status === 'inactive';
        }
        if (contractFilter === 'active') {
          return weekEligibility?.eligible === true;
        }
        if (contractFilter === 'expiring_month') {
          if (!effectiveContract) return false;
          const daysLeft = Math.ceil((new Date(`${effectiveContract.endDate}T23:59:59`).getTime() - Date.now()) / 86_400_000);
          const sessionsLeft = effectiveContract.totalSessions - getCalculatedUsedSessions(effectiveContract);
          return daysLeft <= 31 || sessionsLeft <= 5;
        }
        if (contractFilter === 'expiring_week') {
          if (!effectiveContract) return false;
          const daysLeft = Math.ceil((new Date(`${effectiveContract.endDate}T23:59:59`).getTime() - Date.now()) / 86_400_000);
          const sessionsLeft = effectiveContract.totalSessions - getCalculatedUsedSessions(effectiveContract);
          return daysLeft <= 7 || sessionsLeft <= 2;
        }
        if (contractFilter === 'paused') {
          const latestContract = studentContracts.length > 0 ? studentContracts[0] : null;
          return latestContract?.status === 'frozen' || Boolean(!weekEligibility?.eligible && weekEligibility?.pausedDates.length);
        }
        if (contractFilter === 'cancelled') {
          const latestContract = studentContracts.length > 0 ? studentContracts[0] : null;
          return latestContract?.status === 'cancelled';
        }
        return s.status !== 'inactive' && status === contractFilter;
      });
    }

    return filtered;
  }, [allowedStudents, searchTerm, dateRange, selectedBranchId, contractFilter, selectedTrainerId, selectedNutritionPTId, weekEligibilityByStudent, contractsByStudent]);

  const studentPageSize = 30;
  const studentPageCount = Math.max(1, Math.ceil(filteredStudents.length / studentPageSize));
  const visibleStudents = useMemo(
    () => filteredStudents.slice((studentPage - 1) * studentPageSize, studentPage * studentPageSize),
    [filteredStudents, studentPage],
  );

  const studentOverview = useMemo(() => {
    const now = new Date();
    const activeStudentIds = new Set<string>();
    const expiringStudentIds = new Set<string>();
    const unassignedStudentIds = new Set<string>();

    allowedStudents.forEach((student) => {
      const eligibility = weekEligibilityByStudent.get(student.id);
      const activeContract = eligibility?.eligibleContracts[0];
      if (!eligibility?.eligible || !activeContract) return;
      activeStudentIds.add(student.id);
      const sessionsLeft = activeContract.totalSessions - getCalculatedUsedSessions(activeContract);
      const daysLeft = Math.ceil((new Date(activeContract.endDate).getTime() - now.getTime()) / 86_400_000);
      if (daysLeft <= 7 || sessionsLeft <= 2) expiringStudentIds.add(student.id);
      if (!activeContract.trainerId && !(activeContract.trainerIds || []).length) unassignedStudentIds.add(student.id);
    });

    return {
      total: allowedStudents.length,
      active: activeStudentIds.size,
      expiring: expiringStudentIds.size,
      unassigned: unassignedStudentIds.size,
    };
  }, [allowedStudents, weekEligibilityByStudent]);

  const activeFilterCount = [
    selectedBranchId !== 'all',
    selectedTrainerId !== 'all',
    selectedNutritionPTId !== 'all',
    contractFilter !== 'all',
    Boolean(dateRange && dateRange.start.getTime() !== 0),
    Boolean(searchTerm.trim()),
  ].filter(Boolean).length;

  const activeFilterSummary = [
    selectedBranchId === 'all' ? null : selectedBranchId === 'none' ? 'Chưa xác định chi nhánh' : branches.find((branch) => branch.id === selectedBranchId)?.name,
    contractFilter === 'active' ? 'Đang tập tuần này' : contractFilter === 'expiring_week' ? 'Sắp hết trong tuần' : contractFilter === 'expiring_month' ? 'Sắp hết trong tháng' : contractFilter === 'expired' ? 'Đã hết hạn' : contractFilter === 'paused' ? 'Đang bảo lưu' : contractFilter === 'cancelled' ? 'Đã hủy' : contractFilter === 'inactive' ? 'Đã nghỉ' : null,
    selectedTrainerId === 'all' ? null : selectedTrainerId === 'none' ? 'Chưa có PT' : trainers.find((trainer) => trainer.id === selectedTrainerId)?.name,
    searchTerm.trim() ? `Tìm “${searchTerm.trim().slice(0, 30)}”` : null,
  ].filter(Boolean).join(' · ');

  const selectOverviewSlide = (index: number) => {
    const normalizedIndex = Math.min(2, Math.max(0, index));
    setOverviewSlide(normalizedIndex);
    const track = overviewTrackRef.current;
    if (track) track.scrollTo({ left: track.clientWidth * normalizedIndex, behavior: 'smooth' });
  };

  const carouselOrder = activeFilterCount > 0
    ? (['results', 'overview', 'alerts'] as const)
    : (['overview', 'alerts', 'results'] as const);

  useEffect(() => setStudentPage(1), [searchTerm, dateRange, selectedBranchId, contractFilter, selectedTrainerId, selectedNutritionPTId]);
  useEffect(() => setStudentPage((current) => Math.min(current, studentPageCount)), [studentPageCount]);
  useEffect(() => {
    setOverviewSlide(0);
    overviewTrackRef.current?.scrollTo({ left: 0, behavior: 'smooth' });
  }, [searchTerm, dateRange, selectedBranchId, contractFilter, selectedTrainerId, selectedNutritionPTId]);

  const handleSaveContract = async (newContract: StudentContract) => {
    try {
      const student = students.find(s => s.id === newContract.studentId);
      if (student && student.status !== 'active') {
        await updateStudent(student.id, { status: 'active' });
      }

      // The contract projection starts at zero. Any money collected is posted
      // through the immutable ledger, which updates paidAmount atomically.
      const initialPaidAmount = Math.max(0, Number(newContract.paidAmount || 0));
      const initialInstallment = initialPaidAmount > 0
        ? newContract.installments?.find((item) => item.status === 'paid' && Number(item.amount || 0) === initialPaidAmount)
        : undefined;
      const contractToPersist: StudentContract = {
        ...newContract,
        paidAmount: 0,
        installments: newContract.installments?.map((item) => (
          item.id === initialInstallment?.id ? { ...item, status: 'pending' as const } : item
        )),
      };
      const persistedPending = contractToPersist.installments
        ?.filter((item) => item.status === 'pending' && item.date)
        .sort((left, right) => left.date.localeCompare(right.date))[0];
      contractToPersist.nextPaymentDate = persistedPending?.date || null;

      const existingContract = contractsById.get(newContract.id);
      if (existingContract && existingContract.studentId !== newContract.studentId) {
        throw new Error('Mã hợp đồng đã thuộc về một học viên khác.');
      }
      if (!existingContract) {
        let creation = contractCreationPromises.current.get(newContract.id);
        if (!creation) {
          creation = addContract(contractToPersist).catch((error) => {
            contractCreationPromises.current.delete(newContract.id);
            throw error;
          });
          contractCreationPromises.current.set(newContract.id, creation);
        }
        await creation;
      }

      if (initialPaidAmount > 0) {
        await recordContractPayment({
          contractId: newContract.id,
          amount: initialPaidAmount,
          effectiveAt: new Date().toISOString(),
          paymentMethod: 'transfer',
          idempotencyKey: `initial-payment:${newContract.id}`,
          note: 'Thanh toán lần đầu khi đăng ký gói',
          installmentId: initialInstallment?.id,
        });
      }
      contractCreationPromises.current.delete(newContract.id);
    } catch (e) {
      setAlertMessage("Lỗi lưu hợp đồng: " + (e as Error).message);
      throw e;
    }
  };

  const handleUpdateContract = async (updatedContract: StudentContract, skipPayment?: boolean) => {
    try {
      const oldContract = contractsById.get(updatedContract.id);
      const previousPaidAmount = Number(oldContract?.paidAmount || 0);
      const requestedPaidAmount = Number(updatedContract.paidAmount || 0);
      if (!skipPayment && oldContract && requestedPaidAmount !== previousPaidAmount) {
        throw new Error('Tiền đã thu là projection của sổ giao dịch. Hãy dùng trang Tài chính để ghi nhận khoản thu, hoàn tiền hoặc bút toán điều chỉnh.');
      }
      // paidAmount is a backend-maintained projection and must never be set by
      // a browser write. Save all other contract fields with the current value.
      await updateContract({ ...updatedContract, paidAmount: previousPaidAmount });
    } catch (e) {
      setAlertMessage("Lỗi cập nhật hợp đồng: " + (e as Error).message);
    }
  };

  const [isSaving, setIsSaving] = useState(false);

  // ... (inside handleSave)
  const handleSave = async () => {
    if (!canManageStudents) {
      setAlertMessage("Bạn không có quyền thực hiện thao tác này.");
      return;
    }
    if (!formData.name) return;
    setError(null);
    setIsSaving(true);
    try {

    const sanitizePhone = (phone: string) => {
      let p = phone.replace(/\D/g, '');
      if (p.startsWith('84')) {
        p = '0' + p.slice(2);
      }
      return p;
    };
    const sanitizedFormDataPhone = formData.phone ? sanitizePhone(formData.phone) : '';

    const isDuplicatePhone = students.some(s => 
      s.phone && formData.phone && sanitizePhone(s.phone) === sanitizedFormDataPhone && s.id !== editingStudent?.id
    );
    const isDuplicateEmail = students.some(s => 
      s.email && formData.email && s.email.toLowerCase() === formData.email.toLowerCase() && s.id !== editingStudent?.id
    );

    if (isDuplicatePhone) {
      setError("Số điện thoại này đã tồn tại trong hệ thống.");
      return;
    }
    if (isDuplicateEmail) {
      setError("Email này đã tồn tại trong hệ thống.");
      return;
    }

    const sanitize = (obj: any) => {
      const newObj = { ...obj };
      Object.keys(newObj).forEach(key => {
        if (newObj[key] === undefined) {
          delete newObj[key];
        }
      });
      return newObj;
    };

    if (editingStudent) {
      // CHỈ CẬP NHẬT CÁC TRƯỜNG CÓ TRONG FORM, BỎ QUA availableSlots ĐỂ TRÁNH LƯU ĐÈ
      const updates: Partial<Student> = {
        name: formData.name,
        phone: formData.phone,
        email: formData.email,
        dob: formData.dob,
        sessionsPerWeek: formData.sessionsPerWeek,
        status: formData.status,
        branchId: formData.branchId,
        nutritionNote: formData.nutritionNote,
      };

      // Send only the updates to Firestore to avoid overwriting fields like availableSlots
      await updateStudent(editingStudent.id, sanitize(updates));
      
      // Update User Profile in Firestore if it exists
      try {
        await updateUserProfile(editingStudent.id, {
          name: formData.name,
          branchId: formData.branchId || profile?.branchId || '',
        });
      } catch (e) {
        console.error("Error updating linked user profile:", e);
      }
    } else {
      if (!formData.phone) {
        setError('Cần số điện thoại để tạo tài khoản học viên.');
        setIsSaving(false);
        return;
      }
      const studentId = `student_${crypto.randomUUID()}`;
      const newStudent: Student = {
        id: studentId,
        name: formData.name,
        phone: formData.phone || '',
        email: formData.email || '',
        dob: formData.dob || '',
        sessionsPerWeek: formData.sessionsPerWeek || 3,
        availableSlots: formData.availableSlots || [],
        status: formData.status || 'active',
        joinDate: (() => {
          const d = new Date();
          const y = d.getFullYear();
          const m = String(d.getMonth() + 1).padStart(2, '0');
          const day = String(d.getDate()).padStart(2, '0');
          return `${y}-${m}-${day}`;
        })(),
        branchId: formData.branchId || profile?.branchId || '',
        nutritionNote: formData.nutritionNote || '',
      };
      const account = await provisionStudentAccount({
        displayName: formData.name,
        phoneNumber: formData.phone,
        email: formData.email,
        crmProfileId: studentId,
        legacyStudent: newStudent,
      });
      setAlertMessage(`Đã tạo hồ sơ Aura. Email đăng nhập: ${account.email}. Mật khẩu ban đầu là số điện thoại của học viên; học viên có thể đổi trong Hồ sơ cá nhân.`);
    }

    setIsAdding(false);
    setEditingStudent(null);
    setFormData({ name: '', phone: '', email: '', dob: '', sessionsPerWeek: 3, availableSlots: [], status: 'active', branchId: '', nutritionNote: '' });
    setError(null);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Chưa thể lưu hồ sơ học viên. Vui lòng thử lại.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = (id: string) => {
    setStudentToDelete(id);
    setShowDeleteConfirm(true);
  };

  const executeDelete = async () => {
    if (!canManageStudents) {
      setAlertMessage("Tài khoản này chưa có quyền lưu trữ hồ sơ học viên.");
      setShowDeleteConfirm(false);
      return;
    }
    if (!studentToDelete || !db) return;
    try {
      await updateStudent(studentToDelete, { status: 'inactive' });
      setAlertMessage('Đã lưu trữ học viên. Hợp đồng, chứng từ và lịch sử buổi tập được giữ nguyên.');
    } catch (e) {
      console.error("Error deleting student data:", e);
      setAlertMessage("Lỗi xóa dữ liệu học viên: " + (e as Error).message);
    }
    
    setShowDeleteConfirm(false);
    setStudentToDelete(null);
  };

  if (selectedStudentId) {
    const student = students.find(s => s.id === selectedStudentId);
    if (student) {
      return (
        <React.Suspense fallback={<div className="student-management" role="status" aria-live="polite">Đang tải hồ sơ học viên…</div>}>
          <StudentDetail
            student={student}
            profile={profile}
            contracts={contracts}
            packages={packages}
            trainers={trainers}
            branches={branches}
            sessions={sessions}
            onBack={() => setSelectedStudentId(null)}
            onSaveContract={handleSaveContract}
            onUpdateContract={handleUpdateContract}
          />
        </React.Suspense>
      );
    }
  }

  return (
    <div className="student-management space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-300">
      <div className="student-management__heading">
        <div className="flex items-center gap-3">
          <img src={LOGO_URL} alt="Aura" className="student-management__brand h-10 w-10 object-contain" />
          <div>
            <p className="student-management__eyebrow">AURA OPERATIONS · CRM PT</p>
            <h1 className="student-management__title text-3xl md:text-4xl font-serif font-medium text-pink-500 tracking-tight">
              Học viên PT
            </h1>
            <p className="student-management__subtitle text-zinc-400 mt-2 text-sm">Hồ sơ, tài khoản đăng nhập, hợp đồng và lịch trong một nơi.</p>
          </div>
        </div>
        <button
          aria-label="Thêm học viên"
          onClick={() => {
            if (!canOpenStudentForm) {
              setAlertMessage("Tài khoản này chưa có quyền tạo tài khoản học viên.");
              return;
            }
            setEditingStudent(null);
            setFormData({ name: '', phone: '', email: '', dob: '', sessionsPerWeek: 3, availableSlots: [], status: 'active', branchId: '', nutritionNote: '' });
            setError(null);
            setIsAdding(true);
          }}
          className={`student-management__primary-action transition-colors ${!canOpenStudentForm ? 'opacity-50 cursor-not-allowed' : ''}`}
          disabled={!canOpenStudentForm}
        >
          <Plus className="w-4 h-4" />
          <span>Thêm</span>
        </button>
      </div>

      <section className="student-management__carousel" aria-roledescription="carousel" aria-label="Tổng quan vận hành học viên">
        <div
          ref={overviewTrackRef}
          className="student-management__carousel-track"
          onScroll={(event) => {
            const track = event.currentTarget;
            if (track.clientWidth > 0) setOverviewSlide(Math.min(2, Math.max(0, Math.round(track.scrollLeft / track.clientWidth))));
          }}
        >
          {carouselOrder.map((slide) => slide === 'overview' ? (
            <article key={slide} className="student-management__carousel-slide is-overview">
              <div><small>AURA CRM · TỔNG QUAN</small><h2>{studentOverview.total} học viên</h2><p>Đang tập được đối chiếu cùng quy tắc hợp đồng của Xếp lịch trong tuần hiện tại.</p></div>
              <div className="student-management__carousel-metrics"><span><strong>{studentOverview.active}</strong>Đủ điều kiện tuần</span><span><strong>{studentOverview.unassigned}</strong>Chưa phân PT</span></div>
            </article>
          ) : slide === 'alerts' ? (
            <article key={slide} className="student-management__carousel-slide is-alerts">
              <div><small>CẦN XỬ LÝ SỚM</small><h2>{studentOverview.expiring} hồ sơ</h2><p>Sắp hết hạn hoặc chỉ còn tối đa hai buổi tập.</p></div>
              <button type="button" onClick={() => { setContractFilter('expiring_week'); setStudentPage(1); }}>Lọc danh sách cảnh báo <ChevronRight size={16} /></button>
            </article>
          ) : (
            <article key={slide} className="student-management__carousel-slide is-results">
              <div><small>KẾT QUẢ BỘ LỌC</small><h2>{filteredStudents.length} học viên</h2><p>{activeFilterSummary || 'Chưa áp dụng bộ lọc.'}</p></div>
              <div className="student-management__carousel-metrics"><span><strong>{studentPage}</strong>Trang hiện tại</span><span><strong>{studentPageCount}</strong>Tổng số trang</span></div>
            </article>
          ))}
        </div>
        <footer className="student-management__carousel-controls">
          <span>{overviewSlide + 1}/3</span>
          <div>{[0, 1, 2].map((index) => <button type="button" key={index} className={overviewSlide === index ? 'active' : ''} aria-label={`Xem tổng quan ${index + 1}`} aria-current={overviewSlide === index ? 'true' : undefined} onClick={() => selectOverviewSlide(index)} />)}</div>
          <button type="button" aria-label="Slide tổng quan tiếp theo" onClick={() => selectOverviewSlide(overviewSlide === 2 ? 0 : overviewSlide + 1)}><ChevronRight size={17} /></button>
        </footer>
      </section>

      <div className="student-management__filters">
        <div className="student-management__filter-toolbar">
          <div className="student-management__search relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-zinc-500" />
          <input
            type="text"
            placeholder="Tìm tên, SĐT học viên..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-zinc-900 border border-zinc-800 rounded-xl pl-10 pr-4 py-3 text-white focus:outline-none focus:border-pink-500 transition-colors"
          />
          </div>
          <button type="button" className="student-management__filter-toggle" aria-expanded={showAdvancedFilters} onClick={() => setShowAdvancedFilters((current) => !current)}>
            <SlidersHorizontal size={17} /><span>Bộ lọc</span>{activeFilterCount > 0 && <small>{activeFilterCount}</small>}
          </button>
        </div>
        
        <div className={`student-management__filter-grid ${showAdvancedFilters ? 'is-open' : ''}`}>
          {profile?.role !== 'trainer' && (
            <select 
              value={selectedTrainerId}
              onChange={(e) => setSelectedTrainerId(e.target.value)}
              className="w-full bg-zinc-900 border border-zinc-800 text-zinc-300 px-4 py-2.5 rounded-xl focus:outline-none focus:border-pink-500 transition-colors text-sm"
            >
              <option value="all">Tất cả PT Chính</option>
              <option value="none">Chưa có PT</option>
              {trainers.filter(t => t.status === 'active').map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          )}
          {profile?.role !== 'trainer' && (
            <select 
              value={selectedNutritionPTId}
              onChange={(e) => setSelectedNutritionPTId(e.target.value)}
              className="w-full bg-zinc-900 border border-zinc-800 text-zinc-300 px-4 py-2.5 rounded-xl focus:outline-none focus:border-pink-500 transition-colors text-sm"
            >
              <option value="all">Tất cả PT Dinh Dưỡng</option>
              <option value="none">Không có PT DD</option>
              {trainers.filter(t => t.status === 'active').map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          )}
          <select 
            value={selectedBranchId}
            onChange={(e) => setSelectedBranchId(e.target.value)}
            className="w-full bg-zinc-900 border border-zinc-800 text-zinc-300 px-4 py-2.5 rounded-xl focus:outline-none focus:border-pink-500 transition-colors text-sm"
          >
            <option value="all">Tất cả chi nhánh</option>
            <option value="none">Chưa xác định</option>
            {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
          <select 
            value={contractFilter}
            onChange={(e) => setContractFilter(e.target.value as any)}
            className="w-full bg-zinc-900 border border-zinc-800 text-zinc-300 px-4 py-2.5 rounded-xl focus:outline-none focus:border-pink-500 transition-colors text-sm"
          >
            <option value="active">Đang tập tuần này</option>
            <option value="expiring_week">Sắp hết trong tuần</option>
            <option value="expiring_month">Sắp hết trong tháng</option>
            <option value="expired">Đã hết hạn</option>
            <option value="paused">Khách bảo lưu</option>
            <option value="cancelled">Đã hủy</option>
            <option value="inactive">Đã nghỉ</option>
            <option value="all">Tất cả trạng thái</option>
          </select>
          <DateRangeFilter onFilter={(start, end) => setDateRange({ start, end })} />
        </div>
      </div>

      <StudentRosterTable
        students={visibleStudents}
        contracts={contracts}
        sessions={sessions}
        trainers={trainers}
        branches={branches}
        availability={ptAvailability}
        canManage={canManageStudents}
        onOpen={setSelectedStudentId}
        onEdit={(student) => {
          setEditingStudent(student);
          setFormData(student);
          setError(null);
          setIsAdding(true);
        }}
        onArchive={handleDelete}
        onRenew={(student, contract) => setRenewingStudent({ student, contract })}
      />

      <div className="student-management__mobile-list space-y-3">
            {visibleStudents.map(student => {
              const weekEligibility = weekEligibilityByStudent.get(student.id);
              const hasOverdueDebt = contracts.some(c => {
                if (c.studentId !== student.id || c.status === 'frozen') return false;
                const pending = c.installments?.filter(i => i.status === 'pending') || [];
                if (pending.length === 0 && c.nextPaymentDate && c.paidAmount < (c.totalPrice - (c.discount || 0)) && new Date(c.nextPaymentDate) <= new Date()) {
                  return true;
                }
                return pending.some(i => new Date(i.date) <= new Date());
              });

              const { isExpiringThisMonth, isExpiringThisWeek, isExpired } = (() => {
                const studentContracts = contractsByStudent.get(student.id) || [];
                if (studentContracts.length === 0) return { isExpiringThisMonth: false, isExpiringThisWeek: false, isExpired: false };
                
                studentContracts.sort((a, b) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime());
                const latestContract = weekEligibility?.eligibleContracts[0] || studentContracts[0];
                
                if (latestContract.status === 'expired') {
                  return { isExpiringThisMonth: false, isExpiringThisWeek: false, isExpired: true };
                } else if (latestContract.status !== 'active') {
                  return { isExpiringThisMonth: false, isExpiringThisWeek: false, isExpired: false };
                }
                
                const endDate = new Date(latestContract.endDate);
                const now = new Date();
                
                const timeDiff = endDate.getTime() - now.getTime();
                const daysLeft = Math.ceil(timeDiff / (1000 * 3600 * 24));
                const sessionsLeft = latestContract.totalSessions - getCalculatedUsedSessions(latestContract);
                
                if (daysLeft < 0 || sessionsLeft <= 0) {
                  return { isExpiringThisMonth: false, isExpiringThisWeek: false, isExpired: true };
                }
                
                const isWeek = daysLeft <= 7 || sessionsLeft <= 2;
                const isMonth = (!isNaN(endDate.getTime()) && endDate.getMonth() === now.getMonth() && endDate.getFullYear() === now.getFullYear()) || sessionsLeft <= 5;
                
                return { isExpiringThisMonth: isMonth, isExpiringThisWeek: isWeek, isExpired: false };
              })();

              return (
              <div key={student.id} className={`student-management__card bg-zinc-900 border rounded-2xl p-4 shadow-sm transition-colors ${hasOverdueDebt ? 'border-red-500/30' : isExpired ? 'border-red-500/30' : (isExpiringThisMonth || isExpiringThisWeek) ? 'border-amber-500/30' : 'border-zinc-800'}`}>
                <div className="flex justify-between items-start mb-3">
                  <div>
                    <h3 className="text-lg font-medium text-white flex items-center gap-2 flex-wrap">
                      {student.name}
                      {student.status === 'active' ? (
                        <CheckCircle className="w-4 h-4 text-emerald-500" />
                      ) : (
                        <XCircle className="w-4 h-4 text-zinc-500" />
                      )}
                      {hasOverdueDebt && (
                        <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider bg-red-500/10 text-red-500 px-2 py-0.5 rounded-full border border-red-500/20">
                          <AlertCircle className="w-3 h-3" />
                          Nợ quá hạn
                        </span>
                      )}
                      {isExpired ? (
                        <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider bg-red-500/10 text-red-500 px-2 py-0.5 rounded-full border border-red-500/20">
                          <AlertCircle className="w-3 h-3" />
                          Đã hết hạn
                        </span>
                      ) : isExpiringThisWeek ? (
                        <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider bg-orange-500/10 text-orange-500 px-2 py-0.5 rounded-full border border-orange-500/20">
                          <AlertCircle className="w-3 h-3" />
                          Sắp hết hạn (Tuần)
                        </span>
                      ) : isExpiringThisMonth ? (
                        <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider bg-amber-500/10 text-amber-500 px-2 py-0.5 rounded-full border border-amber-500/20">
                          <AlertCircle className="w-3 h-3" />
                          Gia Hạn Gói Tập
                        </span>
                      ) : null}
                    </h3>
                    <div className="flex flex-col gap-1 mt-2 text-sm text-zinc-400">
                      {student.phone && (
                        <div className="flex items-center gap-2">
                          <Phone className="w-3.5 h-3.5" />
                          {student.phone}
                        </div>
                      )}
                      {student.email && (
                        <div className="flex items-center gap-2">
                          <Mail className="w-3.5 h-3.5" />
                          {student.email}
                        </div>
                      )}
                      {student.dob && !isNaN(new Date(student.dob).getTime()) && (
                        <div className="flex items-center gap-2">
                          <Calendar className="w-3.5 h-3.5" />
                          {new Date(student.dob).toLocaleDateString('vi-VN')}
                        </div>
                      )}
                      <div className="flex items-center gap-2">
                        <Calendar className="w-3.5 h-3.5" />
                        {student.sessionsPerWeek} buổi/tuần
                      </div>
                      {(() => {
                        const studentContracts = contractsByStudent.get(student.id) || [];
                        if (studentContracts.length === 0) return null;
                        
                        studentContracts.sort((a, b) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime());
                        const activeContract = weekEligibility?.eligibleContracts[0] || studentContracts[0];
                        
                        let pts: string[] = [];
                        if (activeContract.trainerIds && activeContract.trainerIds.length > 0) {
                          pts = activeContract.trainerIds;
                        } else if (activeContract.trainerId) {
                          pts = [activeContract.trainerId];
                        }
                        
                        if (pts.length === 0) return null;
                        
                        return (
                          <div className="flex flex-col gap-1 mt-1">
                            {pts.map((id, index) => {
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
                        );
                      })()}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    {(isExpired || isExpiringThisMonth || isExpiringThisWeek) && canManageStudents && (
                      <button
                        onClick={() => {
                          const studentContracts = contractsByStudent.get(student.id) || [];
                          if (studentContracts.length > 0) {
                            studentContracts.sort((a, b) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime());
                            setRenewingStudent({ student, contract: studentContracts[0] });
                          }
                        }}
                        className="p-2 rounded-lg transition-colors text-pink-500 hover:text-pink-400 bg-pink-500/10 hover:bg-pink-500/20 flex items-center gap-1"
                        title="Gia hạn hợp đồng"
                      >
                        <RefreshCw className="w-4 h-4" />
                      </button>
                    )}
                    <button
                      onClick={() => {
                        if (!canManageStudents) {
                          setAlertMessage("Tài khoản này chưa có quyền sửa hồ sơ học viên.");
                          return;
                        }
                        setEditingStudent(student);
                        setFormData(student);
                        setError(null);
                        setIsAdding(true);
                      }}
                      className={`p-2 rounded-lg transition-colors ${!canManageStudents ? 'text-zinc-600 bg-zinc-800/50 cursor-not-allowed' : 'text-zinc-400 hover:text-white bg-zinc-800'}`}
                      disabled={!canManageStudents}
                    >
                      <Edit2 className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => {
                        if (!canManageStudents) {
                          setAlertMessage("Tài khoản này chưa có quyền lưu trữ hồ sơ học viên.");
                          return;
                        }
                        handleDelete(student.id);
                      }}
                      className={`p-2 rounded-lg transition-colors ${!canManageStudents ? 'text-red-900 bg-red-900/10 cursor-not-allowed' : 'text-red-400 hover:text-red-300 bg-red-500/10'}`}
                      disabled={!canManageStudents}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
                
                <div className="mt-4 pt-4 border-t border-zinc-800 flex justify-between items-center">
                  <span className="text-xs text-zinc-500">
                    Tham gia: {student.joinDate && !isNaN(new Date(student.joinDate).getTime()) ? new Date(student.joinDate).toLocaleDateString('vi-VN') : 'N/A'}
                  </span>
                  <button 
                    onClick={() => setSelectedStudentId(student.id)}
                    className="text-xs font-medium text-pink-500 hover:text-pink-400 transition-colors"
                  >
                    Xem chi tiết & Gói tập &rarr;
                  </button>
                </div>
              </div>
              );
            })}

            {filteredStudents.length === 0 && (
              <div className="text-center py-10 text-zinc-500">
                Không tìm thấy học viên nào.
              </div>
            )}
          </div>

          {filteredStudents.length > studentPageSize && (
            <nav className="mt-4 flex items-center justify-between gap-3 rounded-2xl border border-zinc-800 bg-zinc-900 px-4 py-3" aria-label="Phân trang học viên">
              <span className="text-xs text-zinc-500">Trang {studentPage}/{studentPageCount} · {filteredStudents.length} học viên</span>
              <div className="flex gap-2">
                <button type="button" disabled={studentPage === 1} onClick={() => setStudentPage((current) => Math.max(1, current - 1))} className="rounded-lg bg-zinc-800 px-3 py-2 text-xs font-bold text-zinc-200 disabled:opacity-40">Trước</button>
                <button type="button" disabled={studentPage === studentPageCount} onClick={() => setStudentPage((current) => Math.min(studentPageCount, current + 1))} className="rounded-lg bg-gradient-to-r from-pink-500 to-orange-500 px-3 py-2 text-xs font-bold text-white disabled:opacity-40">Tiếp</button>
              </div>
            </nav>
          )}

      {/* Add/Edit Modal */}
      <AnimatePresence>
        {isAdding && (
          <div key="add-edit-modal" className="student-management__modal fixed inset-0 z-[60] flex items-end justify-center sm:items-center p-4" role="dialog" aria-modal="true" aria-labelledby="student-form-title">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="student-management__modal-backdrop absolute inset-0 bg-black/80 backdrop-blur-sm"
              onClick={() => setIsAdding(false)}
            />
            <motion.div 
              initial={{ opacity: 0, y: '100%' }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: '100%' }}
              className="student-management__dialog relative w-full max-w-md bg-zinc-900 rounded-3xl p-6 shadow-2xl border border-zinc-800 max-h-[90vh] overflow-y-auto"
            >
              <div className="student-management__dialog-heading">
                <div>
                  <p className="student-management__eyebrow">HỒ SƠ HỌC VIÊN</p>
                  <h3 id="student-form-title" className="text-xl font-bold text-white mb-1">
                {editingStudent ? 'Sửa thông tin học viên' : 'Thêm học viên mới'}
                  </h3>
                  {!editingStudent && <p className="text-zinc-400 text-sm">Tạo hồ sơ và tài khoản Aura cùng lúc. Mật khẩu ban đầu là số điện thoại; học viên có thể đổi sau khi đăng nhập.</p>}
                </div>
                <button type="button" onClick={() => setIsAdding(false)} className="student-management__close" aria-label="Đóng biểu mẫu">×</button>
              </div>

              {error && (
                <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-sm flex items-center gap-2">
                  <AlertCircle className="w-4 h-4" />
                  {error}
                </div>
              )}

              <div className="student-management__form space-y-4">
                <div>
                  <label className="block text-sm font-medium text-zinc-400 mb-1">Tên học viên *</label>
                  <input 
                    type="text" 
                    value={formData.name}
                    onChange={e => setFormData({...formData, name: e.target.value})}
                    className="w-full p-3 rounded-xl border border-zinc-800 bg-zinc-950 text-white focus:outline-none focus:border-pink-500" 
                    placeholder="VD: Nguyễn Văn A"
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-zinc-400 mb-1">Số điện thoại *</label>
                  <input 
                    type="tel" 
                    value={formData.phone}
                    onChange={e => setFormData({...formData, phone: e.target.value})}
                    className="w-full p-3 rounded-xl border border-zinc-800 bg-zinc-950 text-white focus:outline-none focus:border-pink-500" 
                    placeholder="VD: 0987654321"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-zinc-400 mb-1">Email đăng nhập (không bắt buộc)</label>
                  <input 
                    type="email" 
                    value={formData.email}
                    onChange={e => setFormData({...formData, email: e.target.value})}
                    className="w-full p-3 rounded-xl border border-zinc-800 bg-zinc-950 text-white focus:outline-none focus:border-pink-500" 
                    placeholder="Bỏ trống: SĐT@aurafitness.vn"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-zinc-400 mb-1">Ngày sinh</label>
                  <input 
                    type="date" 
                    value={formData.dob || ''}
                    onChange={e => setFormData({...formData, dob: e.target.value})}
                    className="w-full p-3 rounded-xl border border-zinc-800 bg-zinc-950 text-white focus:outline-none focus:border-pink-500" 
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-zinc-400 mb-1">Cơ sở (Không bắt buộc)</label>
                  <select 
                    value={formData.branchId || ''}
                    onChange={e => setFormData({...formData, branchId: e.target.value})}
                    className="w-full p-3 rounded-xl border border-zinc-800 bg-zinc-950 text-white focus:outline-none focus:border-pink-500"
                  >
                    <option value="">-- Chưa chọn cơ sở --</option>
                    {branches.map(b => (
                      <option key={b.id} value={b.id}>{b.name}</option>
                    ))}
                  </select>
                </div>

                <div className="student-management__two-columns grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-zinc-400 mb-1">Số buổi/tuần</label>
                    <input 
                      type="number" 
                      value={formData.sessionsPerWeek}
                      onChange={e => setFormData({...formData, sessionsPerWeek: Number(e.target.value)})}
                      className="w-full p-3 rounded-xl border border-zinc-800 bg-zinc-950 text-white focus:outline-none focus:border-pink-500" 
                      min="1" max="7"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-zinc-400 mb-1">Trạng thái</label>
                    <select 
                      value={formData.status}
                      onChange={e => setFormData({...formData, status: e.target.value as 'active' | 'inactive'})}
                      className="w-full p-3 rounded-xl border border-zinc-800 bg-zinc-950 text-white focus:outline-none focus:border-pink-500"
                    >
                      <option value="active">Đang tập</option>
                      <option value="inactive">Đã nghỉ</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-zinc-400 mb-1">Ghi chú PT chăm dinh dưỡng</label>
                  <textarea 
                    value={formData.nutritionNote || ''}
                    onChange={e => setFormData({...formData, nutritionNote: e.target.value})}
                    className="w-full p-3 rounded-xl border border-zinc-800 bg-zinc-950 text-white focus:outline-none focus:border-pink-500 resize-none h-20"
                    placeholder="VD: PT Nguyễn Văn A - Chế độ ăn kiêng..."
                  />
                </div>

                <div className="student-management__form-actions pt-4 flex gap-3">
                  <button 
                    onClick={() => setIsAdding(false)}
                    className="flex-1 py-3 rounded-xl font-medium text-zinc-400 bg-zinc-800 hover:bg-zinc-700 transition-colors"
                  >
                    Hủy
                  </button>
                  <button 
                    onClick={handleSave}
                    disabled={!formData.name || isSaving || (!editingStudent && !canInviteStudents) || (Boolean(editingStudent) && !canManageStudents)}
                    className="flex-1 py-3 rounded-xl font-medium text-white bg-pink-500 hover:bg-pink-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-[0_0_15px_rgba(255,0,127,0.4)]"
                  >
                    {isSaving ? 'Đang lưu...' : 'Lưu thông tin'}
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {renewingStudent && (
        <RenewContractModal
          isOpen={true}
          onClose={() => setRenewingStudent(null)}
          student={renewingStudent.student}
          latestContract={renewingStudent.contract}
        />
      )}

      {/* Confirm Delete Modal */}
      <AnimatePresence>
        {showDeleteConfirm && (
          <div key="delete-confirm" className="fixed inset-0 z-[70] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/80 backdrop-blur-sm"
              onClick={() => setShowDeleteConfirm(false)}
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
              <h3 className="text-xl font-bold text-white mb-2">Xác nhận xóa</h3>
              <p className="text-zinc-400 mb-6">
                Hồ sơ sẽ được lưu trữ và ngừng hiển thị trong danh sách đang tập. Hợp đồng, chứng từ và lịch sử buổi tập vẫn được giữ nguyên.
              </p>
              <div className="flex gap-3">
                <button 
                  onClick={() => setShowDeleteConfirm(false)}
                  className="flex-1 py-3 rounded-xl font-medium text-zinc-400 bg-zinc-800 hover:bg-zinc-700 transition-colors"
                >
                  Hủy
                </button>
                <button 
                  onClick={executeDelete}
                  className="flex-1 py-3 rounded-xl font-medium text-white bg-red-500 hover:bg-red-600 transition-colors shadow-[0_0_15px_rgba(239,68,68,0.4)]"
                >
                  Đồng ý xóa
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
