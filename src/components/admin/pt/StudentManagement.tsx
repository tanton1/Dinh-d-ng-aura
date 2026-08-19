import React, { useState, useMemo } from 'react';
import { Student, UserProfile, StudentContract, TrainingPackage, Trainer, Branch, Session, PaymentRecord } from '../../../types';
import { User } from 'firebase/auth';
import { doc, setDoc, deleteDoc, writeBatch } from 'firebase/firestore';
import { db, firebaseConfig } from '../../../lib/firebase';
import { initializeApp, getApps, getApp } from 'firebase/app';
// Force reload: 2026-03-29
import { getAuth, createUserWithEmailAndPassword } from 'firebase/auth';
import { Search, Plus, Edit2, Trash2, Phone, Mail, Calendar, CheckCircle, XCircle, AlertCircle, User as UserIcon, Package, RefreshCw } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import StudentDetail from './StudentDetail';
import DateRangeFilter from './DateRangeFilter';
import RenewContractModal from './RenewContractModal';
import { LOGO_URL } from '../../../constants';
import { useDatabase } from '../../../contexts/DatabaseContext';

interface Props {
  user: User | null;
  profile: UserProfile | null;
}

import LeaveApprovals from './LeaveApprovals';
import SessionRequestApprovals from './SessionRequestApprovals';

export default function StudentManagement({ user, profile }: Props) {
  const { 
    students, contracts, payments, packages, trainers, branches, sessions, leaveRequests, sessionRequests,
    addStudent, updateStudent, deleteStudent,
    addContract, updateContract, deleteContract,
    addPayment, deletePayment, deleteSession,
    updateUserProfile
  } = useDatabase();
  
  const getCalculatedUsedSessions = (contract: any, allSessions: Session[]) => {
    if (!contract) return 0;
    const contractSessions = allSessions.filter(s => {
      if (s.studentId !== contract.studentId) return false;
      if (s.status !== 'completed') return false; 
      const sDate = new Date(s.date).getTime();
      const startDate = new Date(contract.startDate).getTime();
      const endDate = new Date(contract.endDate).getTime() + (86400000 * 60);
      return sDate >= startDate && sDate <= endDate;
    });
    const uniqueClassIds = new Set(contractSessions.map(s => `${s.id.split('-').slice(0,2).join('-')}-${s.date}`));
    const currentAttendedClasses = contract.attendedClasses || [];
    currentAttendedClasses.forEach((id: string) => uniqueClassIds.add(id));
    return uniqueClassIds.size;
  };
  
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
    let allowed = [...students];

    // Restrict what PTs can see globally
    if (profile?.role === 'trainer') {
      const currentTrainer = trainers.find(t => t.email?.toLowerCase() === user?.email?.toLowerCase());
      if (currentTrainer) {
        allowed = allowed.filter(s => {
          const studentContracts = contracts.filter(c => c.studentId === s.id);
          const activeContracts = studentContracts.filter(c => c.status === 'active');
          
          let isAssignedToMe = false;
          if (activeContracts.length > 0) {
            isAssignedToMe = activeContracts.some(c => c.trainerId === currentTrainer.id || c.trainerIds?.includes(currentTrainer.id));
          } else if (studentContracts.length > 0) {
            studentContracts.sort((a, b) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime());
            isAssignedToMe = studentContracts[0].trainerId === currentTrainer.id || studentContracts[0].trainerIds?.includes(currentTrainer.id) || false;
          }

          const isSameBranch = currentTrainer.branchId ? s.branchId === currentTrainer.branchId : false;

          return isAssignedToMe || isSameBranch;
        });
      }
    } else if (profile?.branchId && profile.role !== 'admin') {
      // Restrict other roles by branch globally
      allowed = allowed.filter(s => s.branchId === profile.branchId || !s.branchId);
    }

    return allowed;
  }, [students, profile, trainers, user, contracts]);

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
        filtered = filtered.filter(s => {
          const studentContracts = contracts.filter(c => c.studentId === s.id && c.status === 'active');
          return studentContracts.length === 0 || studentContracts.every(c => !c.trainerId && (!c.trainerIds || c.trainerIds.length === 0));
        });
      } else {
        filtered = filtered.filter(s => {
          const studentContracts = contracts.filter(c => c.studentId === s.id);
          // If no contracts, they aren't assigned to this trainer
          if (studentContracts.length === 0) return false;
          // Check if any active contract is assigned to this trainer
          // Or if no active contracts, check the latest contract
          studentContracts.sort((a, b) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime());
          const activeContracts = studentContracts.filter(c => c.status === 'active');
          if (activeContracts.length > 0) {
            return activeContracts.some(c => c.trainerId === selectedTrainerId || c.trainerIds?.includes(selectedTrainerId));
          } else {
            return studentContracts[0].trainerId === selectedTrainerId || studentContracts[0].trainerIds?.includes(selectedTrainerId);
          }
        });
      }
    }

    // Filter by nutrition PT dropdown
    if (selectedNutritionPTId !== 'all') {
      if (selectedNutritionPTId === 'none') {
        filtered = filtered.filter(s => {
          const studentContracts = contracts.filter(c => c.studentId === s.id && c.status === 'active');
          return studentContracts.length === 0 || studentContracts.every(c => !c.nutritionPTIds || c.nutritionPTIds.length === 0);
        });
      } else {
        filtered = filtered.filter(s => {
          const studentContracts = contracts.filter(c => c.studentId === s.id);
          if (studentContracts.length === 0) return false;
          studentContracts.sort((a, b) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime());
          const activeContracts = studentContracts.filter(c => c.status === 'active');
          if (activeContracts.length > 0) {
            return activeContracts.some(c => c.nutritionPTIds?.includes(selectedNutritionPTId));
          } else {
            return studentContracts[0].nutritionPTIds?.includes(selectedNutritionPTId) || false;
          }
        });
      }
    }

    if (contractFilter !== 'all') {
      filtered = filtered.filter(s => {
        const studentContracts = contracts.filter(c => c.studentId === s.id);
        let status = 'none';
        
        if (studentContracts.length > 0) {
          studentContracts.sort((a, b) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime());
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
            const sessionsLeft = latestContract.totalSessions - getCalculatedUsedSessions(latestContract, sessions);
            
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
          return s.status !== 'inactive' && (status === 'active' || status === 'expiring_month' || status === 'expiring_week');
        }
        if (contractFilter === 'expiring_month') {
          return s.status !== 'inactive' && (status === 'expiring_month' || status === 'expiring_week');
        }
        if (contractFilter === 'paused') {
          const latestContract = studentContracts.length > 0 ? studentContracts[0] : null;
          return latestContract?.status === 'frozen';
        }
        if (contractFilter === 'cancelled') {
          const latestContract = studentContracts.length > 0 ? studentContracts[0] : null;
          return latestContract?.status === 'cancelled';
        }
        return s.status !== 'inactive' && status === contractFilter;
      });
    }

    return filtered;
  }, [students, searchTerm, dateRange, selectedBranchId, profile, contracts, contractFilter, selectedTrainerId, selectedNutritionPTId, trainers, user]);

  const handleSaveContract = async (newContract: StudentContract) => {
    try {
      if (newContract.trainerId) {
        const trainer = trainers.find(t => t.id === newContract.trainerId);
        if (trainer) {
          const commission = newContract.totalPrice * (trainer.commissionRate / 100);
          console.log(`Commission for ${trainer.name}: ${commission}`);
        }
      }

      const student = students.find(s => s.id === newContract.studentId);
      if (student && student.status !== 'active') {
        await updateStudent(student.id, { status: 'active' });
      }

      await addContract(newContract);

      if (newContract.paidAmount > 0) {
        const initInst = newContract.installments?.find(i => i.status === 'paid');
        const payment: PaymentRecord = {
          id: Date.now().toString() + '-p',
          contractId: newContract.id,
          studentId: newContract.studentId,
          amount: newContract.paidAmount,
          date: new Date().toISOString(),
          method: 'transfer',
          note: 'Thanh toán lần đầu khi đăng ký gói',
          installmentId: initInst ? initInst.id : undefined
        };
        await addPayment(payment);
      }
    } catch (e) {
      console.error("Error saving contract:", e);
      setAlertMessage("Lỗi lưu hợp đồng: " + (e as Error).message);
    }
  };

  const handleUpdateContract = async (updatedContract: StudentContract, skipPayment?: boolean) => {
    try {
      const oldContract = contracts.find(c => c.id === updatedContract.id);
      await updateContract(updatedContract);
      
      if (!skipPayment) {
        if (oldContract && updatedContract.paidAmount > oldContract.paidAmount) {
          const diff = updatedContract.paidAmount - oldContract.paidAmount;
          const payment: PaymentRecord = {
            id: Date.now().toString() + '-p',
            contractId: updatedContract.id,
            studentId: updatedContract.studentId,
            amount: diff,
            date: new Date().toISOString(),
            method: 'transfer',
            note: 'Thanh toán thêm (cập nhật hợp đồng)'
          };
          await addPayment(payment);
        } else if (oldContract && updatedContract.paidAmount < oldContract.paidAmount) {
          const diff = oldContract.paidAmount - updatedContract.paidAmount;
          // Find the most recent payment for this contract with the exact amount
          const contractPayments = payments.filter(p => p.contractId === updatedContract.id && p.amount === diff);
          if (contractPayments.length > 0) {
            // Sort by date descending to get the most recent one
            contractPayments.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
            const paymentToRemove = contractPayments[0];
            await deletePayment(paymentToRemove.id);
          }
        }
      }
    } catch (e) {
      console.error("Error updating contract:", e);
      setAlertMessage("Lỗi cập nhật hợp đồng: " + (e as Error).message);
    }
  };

  const [isSaving, setIsSaving] = useState(false);

  // ... (inside handleSave)
  const handleSave = async () => {
    if (profile?.role !== 'admin') {
      setAlertMessage("Bạn không có quyền thực hiện thao tác này.");
      return;
    }
    if (!formData.name) return;
    setError(null);
    setIsSaving(true);

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
      setIsSaving(false);
      return;
    }
    if (isDuplicateEmail) {
      setError("Email này đã tồn tại trong hệ thống.");
      setIsSaving(false);
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
      console.log("Editing student:", editingStudent.id);
      console.log("Form data:", formData);
      
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

      const updatedStudent = sanitize({ ...editingStudent, ...updates }) as Student;
      console.log("Updated student:", updatedStudent);
      
      // Send only the updates to Firestore to avoid overwriting fields like availableSlots
      await updateStudent(editingStudent.id, sanitize(updates));
      console.log("Student updated in Firestore");
      
      // Update User Profile in Firestore if it exists
      try {
        await updateUserProfile(editingStudent.id, {
          name: formData.name,
          branchId: formData.branchId || profile?.branchId || '',
        });
        console.log("User profile updated");
        
        // Update Auth credentials if email or phone (password) changed
        if (formData.email !== editingStudent.email || formData.phone !== editingStudent.phone) {
          if (formData.phone && formData.phone.length < 6) {
            throw new Error("Mật khẩu (số điện thoại) phải có ít nhất 6 ký tự.");
          }
          console.log("Updating auth credentials...");
          const response = await fetch('/api/update-user', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              uid: editingStudent.id,
              email: formData.email,
              password: formData.phone
            })
          });
          if (!response.ok) {
            throw new Error(`Failed to update auth: ${await response.text()}`);
          }
          console.log("Auth credentials updated");
        }
      } catch (e) {
        console.error("Error updating user profile or auth:", e);
      }
    } else {
      let studentId = Date.now().toString();
      let authCreated = false;
      if (formData.phone) {
        try {
          const email = formData.email || `${formData.phone}@aurafitness.com`;
          const password = formData.phone;
          
          if (password.length < 6) {
            console.warn("Phone number too short for password, skipping auth creation");
          } else {
            const secondaryApp = getApps().length > 1 ? getApp("Secondary") : initializeApp(firebaseConfig, "Secondary");
            const secondaryAuth = getAuth(secondaryApp);
            const userCred = await createUserWithEmailAndPassword(secondaryAuth, email, password);
            studentId = userCred.user.uid;
            authCreated = true;
            await secondaryAuth.signOut();
          }
        } catch (e: any) {
          console.error("Error creating auth user:", e);
          if (e.code === 'auth/email-already-in-use') {
            setError("Email hoặc số điện thoại này đã được sử dụng cho một tài khoản khác.");
            setIsSaving(false);
            return;
          }
        }
      }

      const newStudent: Student = {
        id: studentId,
        name: formData.name,
        phone: formData.phone || '',
        email: formData.email || (formData.phone ? `${formData.phone}@aurafitness.com` : ''),
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
      
      await addStudent(newStudent);
    }

    setIsAdding(false);
    setEditingStudent(null);
    setFormData({ name: '', phone: '', email: '', dob: '', sessionsPerWeek: 3, availableSlots: [], status: 'active', branchId: '', nutritionNote: '' });
    setError(null);
    setIsSaving(false);
  };

  const handleDelete = (id: string) => {
    setStudentToDelete(id);
    setShowDeleteConfirm(true);
  };

  const executeDelete = async () => {
    if (profile?.role !== 'admin') {
      setAlertMessage("Bạn không có quyền thực hiện thao tác này.");
      setShowDeleteConfirm(false);
      return;
    }
    if (!studentToDelete || !db) return;
    
    const id = studentToDelete;
    
    try {
      const batch = writeBatch(db);

      // Delete associated sessions
      const studentSessions = sessions.filter(s => s.studentId === id);
      for (const s of studentSessions) {
        batch.delete(doc(db, 'sessions', s.id));
      }

      // Delete associated payments
      const studentPayments = payments.filter(p => p.studentId === id);
      for (const p of studentPayments) {
        batch.delete(doc(db, 'payments', p.id));
      }

      // Delete associated contracts
      const studentContracts = contracts.filter(c => c.studentId === id);
      for (const c of studentContracts) {
        batch.delete(doc(db, 'contracts', c.id));
      }

      // Delete auth user doc (if exists in 'users' collection)
      batch.delete(doc(db, 'users', id));

      // Finally, delete the student document
      batch.delete(doc(db, 'students', id));
      
      // Commit the batch atomically
      await batch.commit();

      setAlertMessage("Đã xóa học viên thành công!");
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
      );
    }
  }

  return (
    <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-300">
      <div className="mb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <img src={LOGO_URL} alt="Aura" className="h-10 w-10 object-contain" />
          <div>
            <h1 className="text-3xl md:text-4xl font-serif font-medium text-pink-500 drop-shadow-[0_0_10px_rgba(236,72,153,0.8)] tracking-tight border-b-4 border-pink-500/30 pb-2 inline-block shadow-[0_6px_0_rgba(236,72,153,0.2)] rounded-2xl">
              Học viên ({filteredStudents.length})
            </h1>
            <p className="text-zinc-400 mt-2 text-sm">Quản lý danh sách học viên và hợp đồng</p>
          </div>
        </div>
        <button
          onClick={() => {
            if (profile?.role !== 'admin') {
              setAlertMessage("Bạn không có quyền thực hiện thao tác này.");
              return;
            }
            setEditingStudent(null);
            setFormData({ name: '', phone: '', email: '', dob: '', sessionsPerWeek: 3, availableSlots: [], status: 'active', branchId: '', nutritionNote: '' });
            setError(null);
            setIsAdding(true);
          }}
          className={`bg-pink-500 text-white px-5 py-2.5 rounded-xl transition-colors flex items-center justify-center shadow-[0_0_15px_rgba(255,0,127,0.4)] ${profile?.role !== 'admin' ? 'opacity-50 cursor-not-allowed' : 'hover:bg-pink-600'}`}
        >
          <Plus className="w-5 h-5 mr-2" />
          <span className="font-medium">Thêm học viên</span>
        </button>
      </div>

      <div className="bg-zinc-900/50 p-4 rounded-2xl border border-zinc-800 space-y-4 mb-6">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-zinc-500" />
          <input
            type="text"
            placeholder="Tìm tên, SĐT học viên..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-zinc-900 border border-zinc-800 rounded-xl pl-10 pr-4 py-3 text-white focus:outline-none focus:border-pink-500 transition-colors"
          />
        </div>
        
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
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
            <option value="active">Đang tập (Ẩn hết hạn)</option>
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

      <SessionRequestApprovals
        students={allowedStudents}
        contracts={contracts}
        sessions={sessions}
      />
      <LeaveApprovals 
        leaveRequests={leaveRequests || []} 
        students={allowedStudents} 
        contracts={contracts} 
      />

      <div className="space-y-3">
            {filteredStudents.map(student => {
              const hasOverdueDebt = contracts.some(c => {
                if (c.studentId !== student.id || c.status === 'frozen') return false;
                const pending = c.installments?.filter(i => i.status === 'pending') || [];
                if (pending.length === 0 && c.nextPaymentDate && c.paidAmount < (c.totalPrice - (c.discount || 0)) && new Date(c.nextPaymentDate) <= new Date()) {
                  return true;
                }
                return pending.some(i => new Date(i.date) <= new Date());
              });

              const { isExpiringThisMonth, isExpiringThisWeek, isExpired } = (() => {
                const studentContracts = contracts.filter(c => c.studentId === student.id);
                if (studentContracts.length === 0) return { isExpiringThisMonth: false, isExpiringThisWeek: false, isExpired: false };
                
                studentContracts.sort((a, b) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime());
                const latestContract = studentContracts[0];
                
                if (latestContract.status === 'expired') {
                  return { isExpiringThisMonth: false, isExpiringThisWeek: false, isExpired: true };
                } else if (latestContract.status !== 'active') {
                  return { isExpiringThisMonth: false, isExpiringThisWeek: false, isExpired: false };
                }
                
                const endDate = new Date(latestContract.endDate);
                const now = new Date();
                
                const timeDiff = endDate.getTime() - now.getTime();
                const daysLeft = Math.ceil(timeDiff / (1000 * 3600 * 24));
                const sessionsLeft = latestContract.totalSessions - getCalculatedUsedSessions(latestContract, sessions);
                
                if (daysLeft < 0 || sessionsLeft <= 0) {
                  return { isExpiringThisMonth: false, isExpiringThisWeek: false, isExpired: true };
                }
                
                const isWeek = daysLeft <= 7 || sessionsLeft <= 2;
                const isMonth = (!isNaN(endDate.getTime()) && endDate.getMonth() === now.getMonth() && endDate.getFullYear() === now.getFullYear()) || sessionsLeft <= 5;
                
                return { isExpiringThisMonth: isMonth, isExpiringThisWeek: isWeek, isExpired: false };
              })();

              return (
              <div key={student.id} className={`bg-zinc-900 border rounded-2xl p-4 shadow-sm transition-colors ${hasOverdueDebt ? 'border-red-500/30' : isExpired ? 'border-red-500/30' : (isExpiringThisMonth || isExpiringThisWeek) ? 'border-amber-500/30' : 'border-zinc-800'}`}>
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
                        const studentContracts = contracts.filter(c => c.studentId === student.id);
                        if (studentContracts.length === 0) return null;
                        
                        studentContracts.sort((a, b) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime());
                        const activeContract = studentContracts.find(c => c.status === 'active') || studentContracts[0];
                        
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
                    {(isExpired || isExpiringThisMonth || isExpiringThisWeek) && profile?.role === 'admin' && (
                      <button
                        onClick={() => {
                          const studentContracts = contracts.filter(c => c.studentId === student.id);
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
                        if (profile?.role !== 'admin') {
                          setAlertMessage("Bạn không có quyền thực hiện thao tác này.");
                          return;
                        }
                        setEditingStudent(student);
                        setFormData(student);
                        setError(null);
                        setIsAdding(true);
                      }}
                      className={`p-2 rounded-lg transition-colors ${profile?.role !== 'admin' ? 'text-zinc-600 bg-zinc-800/50 cursor-not-allowed' : 'text-zinc-400 hover:text-white bg-zinc-800'}`}
                    >
                      <Edit2 className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => {
                        if (profile?.role !== 'admin') {
                          setAlertMessage("Bạn không có quyền thực hiện thao tác này.");
                          return;
                        }
                        handleDelete(student.id);
                      }}
                      className={`p-2 rounded-lg transition-colors ${profile?.role !== 'admin' ? 'text-red-900 bg-red-900/10 cursor-not-allowed' : 'text-red-400 hover:text-red-300 bg-red-500/10'}`}
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

      {/* Add/Edit Modal */}
      <AnimatePresence>
        {isAdding && (
          <div key="add-edit-modal" className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/80 backdrop-blur-sm"
              onClick={() => setIsAdding(false)}
            />
            <motion.div 
              initial={{ opacity: 0, y: '100%' }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: '100%' }}
              className="relative w-full max-w-md bg-zinc-900 rounded-3xl p-6 shadow-2xl border border-zinc-800 max-h-[90vh] overflow-y-auto"
            >
              <h3 className="text-xl font-bold text-white mb-6">
                {editingStudent ? 'Sửa thông tin học viên' : 'Thêm học viên mới'}
              </h3>

              {error && (
                <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-sm flex items-center gap-2">
                  <AlertCircle className="w-4 h-4" />
                  {error}
                </div>
              )}

              <div className="space-y-4">
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
                  <label className="block text-sm font-medium text-zinc-400 mb-1">Số điện thoại</label>
                  <input 
                    type="tel" 
                    value={formData.phone}
                    onChange={e => setFormData({...formData, phone: e.target.value})}
                    className="w-full p-3 rounded-xl border border-zinc-800 bg-zinc-950 text-white focus:outline-none focus:border-pink-500" 
                    placeholder="VD: 0987654321"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-zinc-400 mb-1">Email</label>
                  <input 
                    type="email" 
                    value={formData.email}
                    onChange={e => setFormData({...formData, email: e.target.value})}
                    className="w-full p-3 rounded-xl border border-zinc-800 bg-zinc-950 text-white focus:outline-none focus:border-pink-500" 
                    placeholder="VD: email@example.com"
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
                    <option value="">-- Tất cả cơ sở --</option>
                    {branches.map(b => (
                      <option key={b.id} value={b.id}>{b.name}</option>
                    ))}
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-4">
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

                <div className="pt-4 flex gap-3">
                  <button 
                    onClick={() => setIsAdding(false)}
                    className="flex-1 py-3 rounded-xl font-medium text-zinc-400 bg-zinc-800 hover:bg-zinc-700 transition-colors"
                  >
                    Hủy
                  </button>
                  <button 
                    onClick={handleSave}
                    disabled={!formData.name || isSaving}
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
                Bạn có chắc chắn muốn xóa học viên này? Thao tác này sẽ xóa toàn bộ hợp đồng, lịch sử thanh toán và buổi tập của học viên.
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
