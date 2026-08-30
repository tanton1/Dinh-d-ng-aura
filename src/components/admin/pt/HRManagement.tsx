import React, { useState, useEffect } from 'react';
import { db } from '../../../lib/firebaseFirestore';
import { getDatesForWeek } from '../../../utils/dateUtils';
import { User as UserIcon, Building, Plus, Trash2, Edit2, ShieldCheck, Users, AlertCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { User as FirebaseUser } from 'firebase/auth';
import { Trainer, Branch, StaffMember, StudentContract, Session } from '../../../types';
import { LOGO_URL } from '../../../constants';
import { useDatabase } from '../../../contexts/DatabaseContext';
import { createAccountInvite } from '../../../services/identityAccessService';

interface Props {
  user: FirebaseUser | null;
  /** Account, role and branch creation now lives in Vai trò & quyền. */
  manageIdentity?: boolean;
}

type HRFormData = Partial<Omit<Trainer, 'status'>>
  & Partial<Omit<Branch, 'status'>>
  & Partial<Omit<StaffMember, 'status'>>
  & { status?: Trainer['status'] | Branch['status'] | StaffMember['status'] };

export default function HRManagement({ user, manageIdentity = true }: Props) {
  const {
    trainers,
    branches,
    staff,
    scheduleConfig,
    contracts,
    students,
    addTrainer,
    updateTrainer,
    addBranch,
    updateBranch,
    deleteBranch,
    addStaff,
    updateStaff,
    updateUserProfile,
    sessions
  } = useDatabase();

  const getCalculatedUsedSessions = (contract: StudentContract | undefined, _allSessions: Session[]) => contract
    ? Math.max(0, Math.floor(Number(contract.usedSessions || 0)))
    : 0;

  const [activeSubTab, setActiveSubTab] = useState<'trainers' | 'branches' | 'staff'>('trainers');
  const [isAdding, setIsAdding] = useState(false);
  const [editingItem, setEditingItem] = useState<Partial<Trainer | Branch | StaffMember> | null>(null);
  const [formData, setFormData] = useState<HRFormData>({});
  const [selectedSlots, setSelectedSlots] = useState<Set<string>>(new Set());
  const [weekOffset, setWeekOffset] = useState(0);
  const currentWeekDates = getDatesForWeek(weekOffset);
  const [error, setError] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [itemToDelete, setItemToDelete] = useState<{id: string, type: 'staff' | 'branch'} | null>(null);
  const [alertMessage, setAlertMessage] = useState<string | null>(null);
  const [expandedTrainerId, setExpandedTrainerId] = useState<string | null>(null);
  const [expandedStatsType, setExpandedStatsType] = useState<'main' | 'sub' | 'nutrition'>('main');

  const toggleSlot = (slotId: string) => {
    setSelectedSlots(prev => {
      const next = new Set(prev);
      if (next.has(slotId)) next.delete(slotId);
      else next.add(slotId);
      return next;
    });
  };

  const handleSave = async () => {
    if (!user) return;
    
    if (activeSubTab === 'trainers') {
      if (editingItem?.id) {
        const updatedTrainer = { 
          ...editingItem, 
          ...formData,
          availableSlots: Array.from(selectedSlots)
        } as Trainer;
        
        // Sync with staff array
        const staffMember = staff.find(s => s.id === editingItem.id);
        if (staffMember) {
            await updateStaff({
              ...staffMember,
              name: updatedTrainer.name,
              email: updatedTrainer.email || staffMember.email,
              phone: updatedTrainer.phone || staffMember.phone,
              branchId: updatedTrainer.branchId || staffMember.branchId,
              status: updatedTrainer.status
            });
        }

        // Sync with users collection
        await updateUserProfile(editingItem.id, {
          name: updatedTrainer.name,
          branchId: updatedTrainer.branchId || '',
          employeeCode: updatedTrainer.employeeCode || '',
        });

        try {
          await updateTrainer(updatedTrainer);
          setAlertMessage('Đã lưu thông tin PT thành công!');
        } catch (e) {
          console.error("Error saving trainers:", e);
          setError("Lỗi lưu dữ liệu PT: " + (e as Error).message);
          return;
        }
      } else {
        if (!formData.email && !formData.phone) {
          setError('Cần Email hoặc Số điện thoại để gửi lời mời xác minh cho PT.');
          return;
        }
        const trainerId = `staff_${crypto.randomUUID()}`;
        const invite = await createAccountInvite({
          displayName: formData.name || 'PT Aura',
          phoneNumber: formData.phone,
          email: formData.email,
          accessRole: 'staff',
          positions: ['trainer_pt'],
          branchIds: formData.branchId ? [formData.branchId] : [],
          crmProfileId: trainerId,
        });
        const newTrainer = {
          id: trainerId,
          status: 'active',
          commissionRate: 5,
          // Legacy field is kept at zero. Teaching pay comes from a payroll
          // policy; referral commission is calculated from posted cash flow.
          commissionPerSession: 0,
          baseSalary: 0,
          availableSlots: Array.from(selectedSlots),
          ...formData
        } as Trainer;
        try {
          await addTrainer(newTrainer);
          await addStaff({ id: trainerId, name: newTrainer.name, email: newTrainer.email || '', phone: newTrainer.phone, role: 'trainer', branchId: newTrainer.branchId, status: 'active' });
          setAlertMessage(`Đã tạo hồ sơ PT và lời mời OTP ${invite.inviteId}.`);
        } catch (e) {
          console.error("Error saving trainers:", e);
          setError("Lỗi lưu dữ liệu PT: " + (e as Error).message);
          return;
        }
      }
      
      setIsAdding(false);
      setEditingItem(null);
      setFormData({});
    } else if (activeSubTab === 'branches') {
      if (editingItem?.id) {
        try {
          await updateBranch({ ...editingItem, ...formData } as Branch);
          setAlertMessage('Đã lưu thông tin chi nhánh thành công!');
        } catch (e) {
          console.error("Error saving branches:", e);
          setError("Lỗi lưu dữ liệu chi nhánh: " + (e as Error).message);
          return;
        }
      } else {
        const newBranch = {
          id: `branch_${crypto.randomUUID()}`,
          status: 'active',
          ...formData
        } as Branch;
        try {
          await addBranch(newBranch);
          setAlertMessage('Đã lưu thông tin chi nhánh thành công!');
        } catch (e) {
          console.error("Error saving branches:", e);
          setError("Lỗi lưu dữ liệu chi nhánh: " + (e as Error).message);
          return;
        }
      }
      setIsAdding(false);
      setEditingItem(null);
      setFormData({});
    } else if (activeSubTab === 'staff') {
      let staffUid = (editingItem as StaffMember)?.id;

      if (!editingItem?.id) {
        if (!formData.email && !formData.phone) {
          setError('Cần Email hoặc Số điện thoại để gửi lời mời xác minh.');
          return;
        }
        staffUid = `staff_${crypto.randomUUID()}`;
        const role = (formData as StaffMember).role || 'trainer';
        const position = role === 'sales' ? 'sales' : role === 'manager' ? 'branch_manager' : 'trainer_pt';
        const invite = await createAccountInvite({
          displayName: formData.name || 'Nhân viên Aura',
          phoneNumber: formData.phone,
          email: formData.email,
          accessRole: 'staff',
          positions: [position],
          branchIds: (formData as StaffMember).branchId ? [(formData as StaffMember).branchId!] : [],
          crmProfileId: staffUid,
        });
        setAlertMessage(`Đã tạo lời mời nhân viên ${invite.inviteId}. Không có mật khẩu mặc định.`);
      }

      if (staffUid && db) {
        const role = (formData as StaffMember).role || 'trainer';

        const sanitize = (obj: any) => {
          const newObj = { ...obj };
          Object.keys(newObj).forEach(key => {
            if (newObj[key] === undefined) {
              newObj[key] = null;
            }
          });
          return newObj;
        };

        const newMember = sanitize({
          id: staffUid,
          status: 'active',
          ...formData,
          role: role // Ensure role is explicitly set in the object
        }) as StaffMember;

        try {
          if (editingItem?.id) {
            await updateStaff(newMember);
          } else {
            await addStaff(newMember);
          }

          // Sync with trainers array
          const existingTrainer = trainers.find(t => t.id === staffUid);
          
          if (existingTrainer) {
            // If they are already in the trainers list, update their info regardless of their new role
            await updateTrainer({
              ...existingTrainer,
              name: newMember.name,
              email: newMember.email,
              phone: newMember.phone,
              branchId: newMember.branchId,
              status: newMember.status,
              // Preserve commission fields and employee code if they exist
              commissionRate: formData.commissionRate ?? existingTrainer.commissionRate ?? 5,
              commissionPerSession: 0,
              baseSalary: formData.baseSalary ?? existingTrainer.baseSalary ?? 0,
              employeeCode: formData.employeeCode ?? existingTrainer.employeeCode ?? ''
            });
          } else if (role === 'trainer') {
            // If they are not in the trainers list, only add them if their role is 'trainer'
            await addTrainer({
              id: staffUid,
              name: newMember.name,
              email: newMember.email,
              phone: newMember.phone,
              branchId: newMember.branchId,
              status: newMember.status,
              commissionRate: formData.commissionRate ?? 5,
              commissionPerSession: 0,
              baseSalary: formData.baseSalary ?? 0,
              employeeCode: formData.employeeCode ?? ''
            });
          }

          setAlertMessage('Đã lưu thông tin nhân viên thành công!');
        } catch (e) {
          console.error("Error saving staff:", e);
          setError("Lỗi lưu dữ liệu nhân viên: " + (e as Error).message);
          return;
        }
        setIsAdding(false);
        setEditingItem(null);
        setFormData({});
      }
    }
    
    setIsAdding(false);
    setEditingItem(null);
    setFormData({});
    setError(null);
  };

  const executeDelete = async () => {
    if (!user || !itemToDelete) return;
    const { id, type } = itemToDelete;

    try {
      if (type === 'staff') {
        const staffMember = staff.find((item) => item.id === id);
        if (staffMember) await updateStaff({ ...staffMember, status: 'inactive' });
        const trainer = trainers.find(t => t.id === id);
        if (trainer) {
          await updateTrainer({ ...trainer, status: 'inactive' });
        }
      } else if (type === 'branch') {
        const referenceCount = students.filter((item) => item.branchId === id).length
          + contracts.filter((item) => item.branchId === id).length
          + staff.filter((item) => item.branchId === id).length;
        await deleteBranch(id);
        setAlertMessage(`Đã lưu trữ chi nhánh và giữ nguyên ${referenceCount} liên kết lịch sử.`);
      }
      
      if (type === 'staff') setAlertMessage('Đã ngừng hoạt động nhân viên và giữ nguyên lịch sử.');
    } catch (e) {
      console.error("Error deleting item:", e);
      setAlertMessage("Lỗi khi xóa: " + (e as Error).message);
    }
    setShowDeleteConfirm(false);
    setItemToDelete(null);
  };

  const handleDelete = async (id: string) => {
    setItemToDelete({ id, type: 'staff' });
    setShowDeleteConfirm(true);
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-300">
      <div className="mb-8 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <img src={LOGO_URL} alt="Aura" className="h-10 w-10 object-contain" />
          <div>
            <h1 className="text-3xl md:text-4xl font-serif font-medium text-white tracking-tight">
              Nhân sự & Chi nhánh
            </h1>
            <p className="text-zinc-400 mt-2">Quản lý đội ngũ, phạm vi làm việc và cấu hình vận hành PT</p>
          </div>
        </div>
      </div>

      {!manageIdentity && <div className="mb-5 rounded-xl border border-pink-500/20 bg-pink-500/10 p-4 text-sm text-zinc-300"><strong className="text-pink-300">Hồ sơ PT lịch sử.</strong> Tạo tài khoản, cấp chức danh và quản lý chi nhánh đã được gom về <strong>Vai trò &amp; quyền</strong> để tránh cấp quyền chồng chéo.</div>}
      <div className="flex p-1 bg-zinc-900 rounded-xl border border-zinc-800 overflow-x-auto hide-scrollbar">
        <button
          onClick={() => setActiveSubTab('trainers')}
          className={`flex-1 min-w-max flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all ${
            activeSubTab === 'trainers' ? 'bg-zinc-800 text-white shadow-sm' : 'text-zinc-500 hover:text-zinc-300'
          }`}
        >
          <UserIcon className="w-4 h-4" />
          Nhân sự PT
        </button>
        {manageIdentity && <button
          onClick={() => setActiveSubTab('staff')}
          className={`flex-1 min-w-max flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all ${
            activeSubTab === 'staff' ? 'bg-zinc-800 text-white shadow-sm' : 'text-zinc-500 hover:text-zinc-300'
          }`}
        >
          <ShieldCheck className="w-4 h-4" />
          Tài Khoản
        </button>}
        {manageIdentity && <button
          onClick={() => setActiveSubTab('branches')}
          className={`flex-1 min-w-max flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all ${
            activeSubTab === 'branches' ? 'bg-zinc-800 text-white shadow-sm' : 'text-zinc-500 hover:text-zinc-300'
          }`}
        >
          <Building className="w-4 h-4" />
          Chi nhánh
        </button>}
      </div>

      {(
        <div className="bg-zinc-900 p-6 rounded-2xl border border-zinc-800">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-xl font-bold text-pink-500 drop-shadow-[0_0_10px_rgba(236,72,153,0.8)] border-b-2 border-pink-500/30 pb-2 inline-block shadow-[0_4px_0_rgba(236,72,153,0.2)]">
              {activeSubTab === 'trainers' ? 'Danh sách PT (Hoa hồng)' : 
               activeSubTab === 'staff' ? 'Tài khoản nhân viên' : 'Danh sách chi nhánh'}
            </h2>
          {manageIdentity && activeSubTab !== 'trainers' && (
            <button 
              onClick={() => {
                setEditingItem(null);
                setFormData({});
                setSelectedSlots(new Set());
                setError(null);
                setIsAdding(true);
              }}
              className="bg-pink-500 text-white px-4 py-2 rounded-xl flex items-center gap-2 hover:bg-pink-600 transition-colors"
            >
              <Plus className="w-4 h-4" />
              Thêm mới
            </button>
          )}
        </div>
        
        <div className="space-y-4">
          {activeSubTab === 'trainers' ? (
            trainers.length > 0 ? trainers.map(t => {
              const activeContracts = contracts.filter(c => c.status === 'active' || c.status === 'frozen');
              
              const mainStudentIds = Array.from(new Set(activeContracts.filter(c => c.trainerIds?.[0] === t.id || (!c.trainerIds?.length && c.trainerId === t.id)).map(c => c.studentId)));
              const subStudentIds = Array.from(new Set(activeContracts.filter(c => c.trainerIds?.slice(1).includes(t.id)).map(c => c.studentId)));
              const nutritionStudentIds = Array.from(new Set(activeContracts.filter(c => c.nutritionPTIds?.includes(t.id)).map(c => c.studentId)));

              const isExpanded = expandedTrainerId === t.id;

              return (
              <div key={t.id} className="flex flex-col bg-zinc-950 rounded-xl border border-zinc-800 overflow-hidden">
                <div className="p-4 flex justify-between items-center bg-zinc-900/30">
                  <div>
                    <h3 className="text-white font-medium">{t.name} {t.employeeCode && <span className="text-zinc-500 text-xs">({t.employeeCode})</span>} {t.status === 'inactive' && <span className="text-red-500 text-xs ml-2">(Ngưng HĐ)</span>}</h3>
                    <p className="text-zinc-500 text-sm mb-3">
                      {t.email} · Hoa hồng giới thiệu {t.commissionRate || 0}% tiền thực thu
                    </p>
                    
                    <div className="flex flex-wrap gap-2">
                      <button 
                        onClick={() => {
                          if (isExpanded && expandedStatsType === 'main') setExpandedTrainerId(null);
                          else { setExpandedTrainerId(t.id); setExpandedStatsType('main'); }
                        }}
                        className={`text-xs px-2.5 py-1.5 rounded-md border transition-colors ${isExpanded && expandedStatsType === 'main' ? 'bg-pink-500/20 border-pink-500/50 text-pink-400' : 'bg-zinc-900 border-zinc-700 text-zinc-400 hover:border-zinc-500'}`}
                      >
                        HV Chính: <span className="font-bold text-white ml-1">{mainStudentIds.length}</span>
                      </button>
                      <button 
                        onClick={() => {
                          if (isExpanded && expandedStatsType === 'sub') setExpandedTrainerId(null);
                          else { setExpandedTrainerId(t.id); setExpandedStatsType('sub'); }
                        }}
                        className={`text-xs px-2.5 py-1.5 rounded-md border transition-colors ${isExpanded && expandedStatsType === 'sub' ? 'bg-indigo-500/20 border-indigo-500/50 text-indigo-400' : 'bg-zinc-900 border-zinc-700 text-zinc-400 hover:border-zinc-500'}`}
                      >
                        HV Phụ: <span className="font-bold text-white ml-1">{subStudentIds.length}</span>
                      </button>
                      <button 
                        onClick={() => {
                          if (isExpanded && expandedStatsType === 'nutrition') setExpandedTrainerId(null);
                          else { setExpandedTrainerId(t.id); setExpandedStatsType('nutrition'); }
                        }}
                        className={`text-xs px-2.5 py-1.5 rounded-md border transition-colors ${isExpanded && expandedStatsType === 'nutrition' ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-400' : 'bg-zinc-900 border-zinc-700 text-zinc-400 hover:border-zinc-500'}`}
                      >
                        Dinh dưỡng: <span className="font-bold text-white ml-1">{nutritionStudentIds.length}</span>
                      </button>
                    </div>
                  </div>
                  <div className="flex gap-2 self-start mt-1">
                   <button 
                     onClick={() => {
                       const newStatus = t.status === 'inactive' ? 'active' : 'inactive';
                       updateTrainer({ ...t, status: newStatus });
                       const staffMember = staff.find(s => s.id === t.id);
                       if (staffMember) {
                         updateStaff({ ...staffMember, status: newStatus });
                       }
                     }}
                     className={`p-2 rounded-lg ${t.status === 'inactive' ? 'text-green-400 hover:text-green-300' : 'text-yellow-400 hover:text-yellow-300'}`}
                     title={t.status === 'inactive' ? 'Kích hoạt' : 'Ngưng HĐ'}
                   >
                     {t.status === 'inactive' ? <ShieldCheck className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
                   </button>
                   <button onClick={() => { setEditingItem(t); setFormData(t); setSelectedSlots(new Set(t.availableSlots || [])); setError(null); setIsAdding(true); }} className="p-2 text-zinc-400 hover:text-white"><Edit2 className="w-4 h-4" /></button>
                   <button onClick={() => handleDelete(t.id)} className="p-2 text-red-400 hover:text-red-300"><Trash2 className="w-4 h-4" /></button>
                 </div>
                </div>
                
                {/* Expanded Details */}
                {isExpanded && (
                  <div className="p-4 border-t border-zinc-800 bg-zinc-950/50">
                    <h4 className="text-sm font-medium text-zinc-300 mb-3">
                      {expandedStatsType === 'main' && 'Danh sách Học viên Chính'}
                      {expandedStatsType === 'sub' && 'Danh sách Học viên Phụ'}
                      {expandedStatsType === 'nutrition' && 'Danh sách Chăm sóc Dinh dưỡng'}
                    </h4>
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                      {(()=>{
                        const ids = expandedStatsType === 'main' ? mainStudentIds : expandedStatsType === 'sub' ? subStudentIds : nutritionStudentIds;
                        if (ids.length === 0) return <div className="text-zinc-500 text-sm italic col-span-full">Không có dữ liệu học viên.</div>;
                        
                        return ids.map(id => {
                          const s = students.find(stud => stud.id === id);
                          if (!s) return null;
                          const activeContract = activeContracts.find(c => c.studentId === id && 
                            (expandedStatsType === 'main' ? (c.trainerIds?.[0] === t.id || (!c.trainerIds?.length && c.trainerId === t.id)) :
                             expandedStatsType === 'sub' ? c.trainerIds?.slice(1).includes(t.id) :
                             c.nutritionPTIds?.includes(t.id)));

                          return (
                            <div key={id} className="flex flex-col gap-2 p-3 rounded-xl bg-zinc-900 border border-zinc-800/80 hover:border-zinc-700 transition-colors">
                              <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-full bg-zinc-800 flex items-center justify-center text-zinc-400 shrink-0">
                                  <UserIcon className="w-5 h-5" />
                                </div>
                                <div className="min-w-0 flex-1">
                                  <p className="text-sm font-medium text-white capitalize truncate">{s.name}</p>
                                  <p className="text-xs text-zinc-500 truncate">{s.phone || 'Không có SĐT'}</p>
                                </div>
                              </div>
                              {activeContract && (
                                <div className="mt-1 pt-2 border-t border-zinc-800/50">
                                  <div className="flex justify-between items-center mb-1.5">
                                    <span className="text-xs text-zinc-400 truncate pr-2" title={activeContract.packageName}>{activeContract.packageName}</span>
                                    <span className="text-xs font-bold text-pink-500 shrink-0 border border-pink-500/20 bg-pink-500/10 px-1.5 py-0.5 rounded">
                                      {getCalculatedUsedSessions(activeContract, sessions)} / {activeContract.totalSessions}
                                    </span>
                                  </div>
                                  <div className="w-full bg-zinc-950 rounded-full h-1.5 overflow-hidden">
                                    <div 
                                      className="bg-gradient-to-r from-pink-600 to-pink-400 h-1.5 rounded-full transition-all duration-500" 
                                      style={{ width: `${Math.min(100, Math.max(0, (getCalculatedUsedSessions(activeContract, sessions) / activeContract.totalSessions) * 100))}%` }}
                                    />
                                  </div>
                                  <div className="mt-1.5 flex justify-between text-[10px] text-zinc-500">
                                     <span>HSD: {new Date(activeContract.endDate).toLocaleDateString('vi-VN')}</span>
                                     <span className={activeContract.status === 'frozen' ? 'text-blue-400' : 'text-emerald-500'}>
                                        {activeContract.status === 'frozen' ? 'Đang bảo lưu' : 'Đang tập'}
                                     </span>
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        });
                      })()}
                    </div>
                  </div>
                )}
              </div>
            )}) : <div className="text-center py-10 text-zinc-500">Chưa có dữ liệu PT.</div>
          ) : activeSubTab === 'staff' ? (
            staff.length > 0 ? staff.map(s => (
              <div key={s.id} className="p-4 bg-zinc-950 rounded-xl border border-zinc-800 flex justify-between items-center">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-white font-medium">{s.name}</h3>
                    <span className="text-[10px] font-bold uppercase tracking-wider bg-zinc-800 text-zinc-400 px-2 py-0.5 rounded-full border border-zinc-700">
                      {s.role}
                    </span>
                  </div>
                  <p className="text-zinc-500 text-sm">{s.email} • {s.phone}</p>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => { setEditingItem(s); setFormData(s); setError(null); setIsAdding(true); }} className="p-2 text-zinc-400 hover:text-white"><Edit2 className="w-4 h-4" /></button>
                  <button onClick={() => handleDelete(s.id)} className="p-2 text-red-400 hover:text-red-300"><Trash2 className="w-4 h-4" /></button>
                </div>
              </div>
            )) : <div className="text-center py-10 text-zinc-500">Chưa có tài khoản nhân viên nào.</div>
          ) : (
            branches.length > 0 ? branches.map(b => (
              <div key={b.id} className="p-4 bg-zinc-950 rounded-xl border border-zinc-800 flex justify-between items-center">
                <div>
                  <h3 className="text-white font-medium">{b.name}</h3>
                  <p className="text-zinc-500 text-sm">{b.address}</p>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => { setEditingItem(b); setFormData(b); setError(null); setIsAdding(true); }} className="p-2 text-zinc-400 hover:text-white"><Edit2 className="w-4 h-4" /></button>
                  <button onClick={() => handleDelete(b.id)} className="p-2 text-red-400 hover:text-red-300"><Trash2 className="w-4 h-4" /></button>
                </div>
              </div>
            )) : <div className="text-center py-10 text-zinc-500">Chưa có dữ liệu chi nhánh.</div>
          )}
        </div>
      </div>
      )}

      {/* Add Modal */}
      {isAdding && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="bg-zinc-900 p-6 rounded-3xl w-full max-w-md border border-zinc-800 max-h-[90vh] overflow-y-auto">
            <h3 className="text-xl font-bold text-white mb-4">
              {editingItem ? 'Sửa' : 'Thêm'} {
                activeSubTab === 'trainers' ? 'PT' : 
                activeSubTab === 'staff' ? 'Tài khoản' : 'chi nhánh'
              }
            </h3>
            
            {error && (
              <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-sm">
                {error}
              </div>
            )}

            <div className="space-y-4">
              {activeSubTab !== 'trainers' && (
                <input 
                  type="text" 
                  placeholder="Tên" 
                  value={formData.name || ''}
                  className="w-full p-3 rounded-xl bg-zinc-950 border border-zinc-800 text-white"
                  onChange={e => setFormData({...formData, name: e.target.value})}
                />
              )}
              {activeSubTab === 'trainers' ? (
                <>
                  <div className="p-3 rounded-xl bg-zinc-800/50 border border-zinc-800 text-zinc-300 mb-4">
                    <p className="font-medium text-white">{formData.name}</p>
                    <p className="text-sm">{formData.email} • {formData.phone}</p>
                  </div>
                  <label className="block text-sm font-medium text-zinc-400 mb-1">Mã nhân viên (Dùng để tính hoa hồng giới thiệu)</label>
                  <input type="text" placeholder="VD: PT001" value={formData.employeeCode || ''} className="w-full p-3 rounded-xl bg-zinc-950 border border-zinc-800 text-white" onChange={e => setFormData({...formData, employeeCode: e.target.value})} />

                  <label className="block text-sm font-medium text-zinc-400 mb-1 mt-3">Độ ưu tiên (PT1, PT2...)</label>
                  <input type="number" placeholder="Độ ưu tiên" value={formData.priority || ''} className="w-full p-3 rounded-xl bg-zinc-950 border border-zinc-800 text-white" onChange={e => setFormData({...formData, priority: Number(e.target.value)})} min="1" />

                  <label className="block text-sm font-medium text-zinc-400 mb-1 mt-3">Lương cơ bản (VNĐ)</label>
                  <input type="number" placeholder="Lương cơ bản (VNĐ)" value={formData.baseSalary || 0} className="w-full p-3 rounded-xl bg-zinc-950 border border-zinc-800 text-white" onChange={e => setFormData({...formData, baseSalary: Number(e.target.value)})} />
                  
                  <label className="block text-sm font-medium text-zinc-400 mb-1 mt-3">Hoa hồng giới thiệu (2–10%)</label>
                  <input
                    type="number"
                    min="0"
                    max="10"
                    step="0.5"
                    placeholder="0 để tắt, hoặc 2–10%"
                    value={formData.commissionRate || 0}
                    className="w-full p-3 rounded-xl bg-zinc-950 border border-zinc-800 text-white"
                    onChange={e => {
                      const nextRate = Number(e.target.value);
                      setFormData({ ...formData, commissionRate: Math.min(10, Math.max(0, nextRate)), commissionPerSession: 0 });
                    }}
                  />
                  <p className="mt-1.5 text-xs leading-5 text-zinc-500">
                    Chỉ tính khi hợp đồng có mã giới thiệu PT và theo dòng tiền thực thu đã ghi sổ. Tiền ca dạy được tính riêng theo chính sách lương.
                  </p>

                  <div className="mt-6 border-t border-zinc-800 pt-6">
                    <div className="flex justify-between items-end mb-4">
                      <label className="block text-sm font-bold text-zinc-300 uppercase tracking-wider">
                        Ma trận thời gian rảnh
                      </label>
                      <div className="flex items-center gap-2">
                        <button 
                          type="button"
                          onClick={() => setWeekOffset(prev => prev - 1)}
                          className="p-1 rounded bg-zinc-800 text-zinc-400 hover:text-white"
                        >
                          &lt;
                        </button>
                        <span className="text-xs text-zinc-400 font-medium">Tuần {weekOffset === 0 ? 'này' : weekOffset}</span>
                        <button 
                          type="button"
                          onClick={() => setWeekOffset(prev => prev + 1)}
                          className="p-1 rounded bg-zinc-800 text-zinc-400 hover:text-white"
                        >
                          &gt;
                        </button>
                      </div>
                      <span className="text-xs text-pink-400 font-medium bg-pink-500/10 px-3 py-1 rounded-full border border-pink-500/20">
                        Đã chọn: {selectedSlots.size} slots
                      </span>
                    </div>
                    
                    <div className="overflow-hidden hide-scrollbar rounded-xl border border-zinc-800 bg-zinc-950 w-full">
                      <table className="w-full text-xs text-left border-collapse table-fixed">
                        <thead>
                          <tr>
                            <th className="border-b border-r border-zinc-800 p-1 bg-zinc-900 w-12 text-center font-bold text-zinc-400 uppercase">Giờ</th>
                            {scheduleConfig.workingDays.map(day => (
                              <th key={day} className="border-b border-r border-zinc-800 p-1 bg-zinc-900 text-center font-bold text-zinc-300 uppercase tracking-wider">
                                <div className="flex flex-col items-center justify-center">
                                  <span>{day}</span>
                                  <span className="text-[9px] text-zinc-500 font-normal mt-0.5">{currentWeekDates[day]?.display}</span>
                                </div>
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {scheduleConfig.workingHours.map(hour => (
                            <tr key={hour} className="group">
                              <td className="border-b border-r border-zinc-800 p-1 text-center font-mono font-bold bg-zinc-900 text-zinc-400 group-hover:text-zinc-200 transition-colors">
                                {hour}h
                              </td>
                              {scheduleConfig.workingDays.map(day => {
                                const slotId = `${day}-${hour}`;
                                const isSelected = selectedSlots.has(slotId);
                                return (
                                  <td 
                                    key={slotId}
                                    onClick={() => toggleSlot(slotId)}
                                    className={`border-b border-r border-zinc-800 p-1 text-center text-sm font-bold cursor-pointer transition-all duration-200 relative ${
                                      isSelected 
                                        ? 'bg-pink-600/20 text-pink-400 font-bold shadow-[inset_0_0_15px_rgba(236,72,153,0.3)]' 
                                        : 'hover:bg-zinc-800 text-transparent hover:text-zinc-600'
                                    }`}
                                  >
                                    {isSelected && (
                                      <div className="absolute inset-0 border-2 border-pink-500 rounded-sm m-[1px] shadow-[0_0_10px_rgba(236,72,153,0.5)]"></div>
                                    )}
                                    {isSelected ? '✓' : '+'}
                                  </td>
                                );
                              })}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </>
              ) : activeSubTab === 'staff' ? (
                <>
                  <input type="email" placeholder="Email (Tài khoản đăng nhập)" value={formData.email || ''} className="w-full p-3 rounded-xl bg-zinc-950 border border-zinc-800 text-white" onChange={e => setFormData({...formData, email: e.target.value})} />
                  <input type="tel" placeholder="SĐT nhận OTP" value={formData.phone || ''} className="w-full p-3 rounded-xl bg-zinc-950 border border-zinc-800 text-white" onChange={e => setFormData({...formData, phone: e.target.value})} />
              <select 
                value={(formData as StaffMember).role || 'trainer'}
                onChange={e => setFormData({...formData, role: e.target.value as StaffMember['role']})}
                className="w-full p-3 rounded-xl bg-zinc-950 border border-zinc-800 text-white"
              >
                <option value="trainer">PT (Huấn luyện viên)</option>
                <option value="sales">Sales (Kinh doanh)</option>
                <option value="manager">Quản lý cơ sở</option>
                <option value="admin">Admin (Toàn quyền)</option>
              </select>
                  <select 
                    value={(formData as StaffMember).branchId || ''}
                    onChange={e => setFormData({...formData, branchId: e.target.value})}
                    className="w-full p-3 rounded-xl bg-zinc-950 border border-zinc-800 text-white"
                  >
                    <option value="">-- Chọn cơ sở --</option>
                    {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                </>
              ) : (
                <input type="text" placeholder="Địa chỉ" value={formData.address || ''} className="w-full p-3 rounded-xl bg-zinc-950 border border-zinc-800 text-white" onChange={e => setFormData({...formData, address: e.target.value})} />
              )}
              <div className="flex gap-3 pt-4">
                <button onClick={() => setIsAdding(false)} className="flex-1 py-3 rounded-xl bg-zinc-800 text-white">Hủy</button>
                <button onClick={handleSave} className="flex-1 py-3 rounded-xl bg-pink-500 text-white">Lưu</button>
              </div>
            </div>
          </div>
        </div>
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
                Bạn có chắc chắn muốn xóa mục này?
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
