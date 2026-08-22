import React, { useState, useMemo, lazy, Suspense } from 'react';
import { UserProfile, Student, Session, StudentContract } from '../../../types';
import { useDatabase } from '../../../contexts/DatabaseContext';
import { Users, User, ArrowRight, Activity, Calendar, ChevronLeft, Calendar as CalendarIcon, Search, AlertCircle, CheckCircle, Clock, Download } from 'lucide-react';
const StudentManagement = lazy(() => import('./StudentManagement'));
const StudentDetail = lazy(() => import('./StudentDetail'));
import { motion, AnimatePresence } from 'motion/react';


import { User as FirebaseUser } from 'firebase/auth';

interface Props {
  profile?: UserProfile | null;
  user?: FirebaseUser | null;
  trainerId?: string;
  explicitTrainerId?: string;
  onNavigate?: (screen: string) => void;
}

export default function TrainerDashboard({ profile, user, trainerId: propTrainerId, explicitTrainerId, onNavigate }: Props) {
  const { students, contracts, sessions, packages, trainers, branches, addContract, updateContract } = useDatabase();

  const getCalculatedUsedSessions = (contract: StudentContract | undefined, allSessions: Session[]) => {
    if (!contract) return 0;
    const contractSessions = allSessions.filter(s => {
      if (s.studentId !== contract.studentId) return false;
      if (s.status !== 'completed') return false; 
      const sDate = new Date(s.date).getTime();
      const startDate = new Date(contract.startDate).getTime();
      const endDate = new Date(contract.endDate).getTime() + 86400000 - 1;
      return sDate >= startDate && sDate <= endDate;
    });
    const uniqueClassIds = new Set(contractSessions.map(s => `${s.id.split('-').slice(0,2).join('-')}-${s.date}`));
    const currentAttendedClasses = contract.attendedClasses || [];
    currentAttendedClasses.forEach((id: string) => uniqueClassIds.add(id));
    return uniqueClassIds.size;
  };
  const [activeTab, setActiveTab] = useState<'main' | 'sub' | 'nutrition'>('main');
  const [selectedStudentId, setSelectedStudentId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  // The trainer's user ID is their user.uid or explicitly passed.
  const trainerId: string = explicitTrainerId || propTrainerId || user?.uid || '';

  // Filter active contracts
  const activeContracts = contracts.filter(c => c.status === 'active' || c.status === 'frozen');

  // Categorize students
  const mainStudentIds: string[] = Array.from(new Set(
    activeContracts
      .filter(c => c.trainerIds?.[0] === trainerId || (!c.trainerIds?.length && c.trainerId === trainerId))
      .map(c => c.studentId)
  ));
  
  const subStudentIds: string[] = Array.from(new Set(
    activeContracts
      .filter(c => c.trainerIds && c.trainerIds.length > 1 && c.trainerIds.slice(1).includes(trainerId))
      .map(c => c.studentId)
  ));

  const nutritionStudentIds: string[] = Array.from(new Set(
    activeContracts
      .filter(c => c.nutritionPTIds && c.nutritionPTIds.includes(trainerId))
      .map(c => c.studentId)
  ));

  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const todaySessions = sessions
    .filter(s => s.trainerId === trainerId && s.date.slice(0, 10) === todayStr && (s.status === 'scheduled' || s.status === 'rescheduled'))
    .sort((a, b) => (a.hour || 0) - (b.hour || 0));

  const scheduleBySlot = useMemo(() => {
    return todaySessions.reduce((acc, curr) => {
      const hr = curr.hour !== undefined ? curr.hour : -1; 
      if (!acc[hr]) {
        acc[hr] = [];
      }
      acc[hr].push(curr);
      return acc;
    }, {} as Record<number, Session[]>);
  }, [todaySessions]);

  const slotsCount = Object.keys(scheduleBySlot).length;

  const warnings = useMemo(() => {
     const w: { studentId: string, type: 'low_session' | 'expire_soon', contract: StudentContract }[] = [];
     const allIds = Array.from(new Set([...mainStudentIds, ...subStudentIds, ...nutritionStudentIds]));
     
     allIds.forEach(id => {
       const contract = activeContracts.find(c => c.studentId === id && 
         (c.trainerIds?.includes(trainerId) || c.trainerId === trainerId || c.nutritionPTIds?.includes(trainerId))
       );
       if (contract) {
         const diffDays = Math.ceil((new Date(contract.endDate).getTime() - new Date().getTime()) / 86400000);
         if (contract.totalSessions - getCalculatedUsedSessions(contract, sessions) <= 3) {
            w.push({ studentId: id, type: 'low_session', contract });
         } else if (diffDays >= 0 && diffDays <= 14) {
            w.push({ studentId: id, type: 'expire_soon', contract });
         }
       }
     });
     return w;
  }, [mainStudentIds, subStudentIds, nutritionStudentIds, activeContracts, trainerId]);

  if (selectedStudentId) {
    const s = students.find(stud => stud.id === selectedStudentId);
    if (s) {
      return (
        <div className="p-4 md:p-6 pb-24 max-w-4xl mx-auto">
          <button 
            onClick={() => setSelectedStudentId(null)}
            className="mb-4 text-pink-500 hover:text-pink-400 font-medium text-sm flex items-center gap-1"
          >
             <ChevronLeft className="w-4 h-4" /> Quay lại tổng quan
          </button>
          <Suspense fallback={<div className="p-8 text-center text-zinc-400">Đang tải...</div>}>
          <StudentDetail 
             student={s}
             contracts={contracts}
             packages={packages}
             trainers={trainers}
             branches={branches}
             sessions={sessions}
             profile={profile}
             onBack={() => setSelectedStudentId(null)}
             onSaveContract={addContract}
             onUpdateContract={updateContract}
          />
          </Suspense>
        </div>
      );
    }
  }

  const renderStudentList = (ids: string[], emptyMessage: string) => {
    let filteredIds = ids.filter(id => {
      const s = students.find(stud => stud.id === id);
      if (!s) return false;
      
      const matchesSearch = s.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
                            (s.phone && s.phone.includes(searchQuery));
                            
      let matchesStatus = true;
      if (statusFilter !== 'all') {
        const contract = activeContracts.find(c => c.studentId === id && 
          (c.trainerIds?.includes(trainerId) || c.trainerId === trainerId || c.nutritionPTIds?.includes(trainerId))
        );
        
        if (statusFilter === 'active') {
          matchesStatus = !!contract;
        } else if (statusFilter === 'low_sessions') {
          matchesStatus = contract ? (contract.totalSessions - getCalculatedUsedSessions(contract, sessions) <= 3) : false;
        } else if (statusFilter === 'expire_soon') {
          if (contract) {
            const diffDays = Math.ceil((new Date(contract.endDate).getTime() - new Date().getTime()) / 86400000);
            matchesStatus = diffDays >= 0 && diffDays <= 14;
          } else {
            matchesStatus = false;
          }
        } else if (statusFilter === 'no_contract') {
          matchesStatus = !contract;
        }
      }
      
      return matchesSearch && matchesStatus;
    });

    return (
      <div className="mt-4">
        {filteredIds.length === 0 ? (
          <div className="p-8 rounded-2xl border border-zinc-800 border-dashed text-center bg-zinc-900/50">
            <Users className="w-8 h-8 text-zinc-500 mx-auto mb-3 opacity-50" />
            <p className="text-zinc-400 text-sm">{ids.length === 0 ? emptyMessage : 'Không tìm thấy học viên phù hợp.'}</p>
          </div>
        ) : (
          <div className="grid gap-3">
            {filteredIds.map(id => {
              const s = students.find(stud => stud.id === id);
              if (!s) return null;
              
              const contract = activeContracts.find(c => c.studentId === id && 
                (c.trainerIds?.includes(trainerId) || c.trainerId === trainerId || c.nutritionPTIds?.includes(trainerId))
              );
              
              return (
                <div 
                  key={id} 
                  onClick={() => setSelectedStudentId(id)}
                  className="p-4 rounded-xl bg-zinc-950 border border-zinc-800 flex flex-col sm:flex-row sm:items-center justify-between group hover:border-pink-500/50 hover:bg-zinc-900 transition-all cursor-pointer shadow-sm gap-4"
                >
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-full bg-zinc-800 border border-zinc-700 flex items-center justify-center shrink-0 group-hover:border-pink-500/30 group-hover:bg-pink-500/10 transition-colors">
                      <User className="w-6 h-6 text-zinc-400 group-hover:text-pink-400 transition-colors" />
                    </div>
                    <div>
                      <h4 className="text-white font-bold capitalize group-hover:text-pink-400 transition-colors text-base">{s.name}</h4>
                      <p className="text-xs text-zinc-500 mb-1">{s.phone || 'Không có SĐT'}</p>
                      {s.availableSlots && s.availableSlots.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1">
                          <span className="text-[10px] text-zinc-500 flex items-center"><CalendarIcon className="w-3 h-3 mr-1"/> Rảnh:</span>
                          {s.availableSlots.map((slot, i) => (
                            <span key={`avail-${slot}-${i}`} className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                              {slot}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                  
                  {contract && (
                    <div className="flex flex-row sm:flex-col justify-between sm:justify-center items-center sm:items-end w-full sm:w-auto pt-3 sm:pt-0 border-t border-zinc-800/50 sm:border-0">
                      <div className="text-xs text-zinc-300 font-medium mb-1">
                        Gói: <span className="text-pink-500 px-2 py-0.5 rounded bg-pink-500/10">{contract.packageName}</span>
                      </div>
                      <div className="text-xs text-zinc-500 flex flex-col sm:flex-row items-end sm:items-center gap-1 sm:gap-3">
                        <span className={`flex items-center gap-1 transition-colors ${contract.totalSessions - getCalculatedUsedSessions(contract, sessions) <= 3 ? 'text-orange-400 font-bold' : 'group-hover:text-pink-400'}`}>
                           <Activity className="w-3.5 h-3.5" />
                           Còn {contract.totalSessions - getCalculatedUsedSessions(contract, sessions)} buổi
                        </span>
                        {(() => {
                           const diffDays = Math.ceil((new Date(contract.endDate).getTime() - new Date().getTime()) / 86400000);
                           const isExpiringSoon = diffDays >= 0 && diffDays <= 14;
                           return (
                             <span className={`flex items-center gap-1 transition-colors ${isExpiringSoon ? 'text-amber-500 font-bold' : 'text-zinc-500'}`}>
                               <Calendar className="w-3.5 h-3.5" />
                               HSD: {new Date(contract.endDate).toLocaleDateString('vi-VN')}
                             </span>
                           );
                        })()}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Chào buổi sáng';
    if (hour < 18) return 'Chào buổi chiều';
    return 'Chào buổi tối';
  };

  const handleExportPDF = async () => {
    try {
      const { default: jsPDF } = await import('jspdf');
      const { default: autoTable } = await import('jspdf-autotable');
      const doc = new jsPDF('l', 'mm', 'a4');
      
      const [regularRes, boldRes] = await Promise.all([
        fetch('https://cdnjs.cloudflare.com/ajax/libs/pdfmake/0.2.7/fonts/Roboto/Roboto-Regular.ttf'),
        fetch('https://cdnjs.cloudflare.com/ajax/libs/pdfmake/0.2.7/fonts/Roboto/Roboto-Medium.ttf')
      ]);
      
      const regularBlob = await regularRes.blob();
      const boldBlob = await boldRes.blob();
      
      const blobToBase64 = (blob: Blob): Promise<string> => {
        return new Promise((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve((reader.result as string).split(',')[1]);
          reader.readAsDataURL(blob);
        });
      };

      const regularBase64 = await blobToBase64(regularBlob);
      const boldBase64 = await blobToBase64(boldBlob);
      
      doc.addFileToVFS('Roboto-Regular.ttf', regularBase64);
      doc.addFileToVFS('Roboto-Medium.ttf', boldBase64);
      doc.addFont('Roboto-Regular.ttf', 'Roboto', 'normal');
      doc.addFont('Roboto-Medium.ttf', 'Roboto', 'bold');
      
      doc.setFont('Roboto', 'bold');
      doc.setFontSize(16);
      doc.text(`Danh sach hoc vien - PT: ${profile?.displayName || profile?.name || trainers.find(t => t.id === trainerId)?.name || 'Khong xac dinh'}`, 14, 20);
      
      doc.setFontSize(12);
      doc.setFont('Roboto', 'normal');
      doc.text(`Ngay xuat: ${new Date().toLocaleDateString('vi-VN')}`, 14, 28);
      
      const allIds = Array.from(new Set([...mainStudentIds, ...subStudentIds, ...nutritionStudentIds]));
      
      const tableData = allIds.map(id => {
        const s = students.find(stud => stud.id === id);
        if (!s) return null;
        
        const contract = activeContracts.find(c => c.studentId === id && 
          (c.trainerIds?.includes(trainerId) || c.trainerId === trainerId || c.nutritionPTIds?.includes(trainerId))
        );
        
        let trainingRole = '-';
        let nutritionRole = '-';

        if (contract) {
           if (contract.trainerId === trainerId) trainingRole = 'PT Chinh';
           else if (contract.trainerIds?.includes(trainerId)) trainingRole = 'PT Phu';
           
           if (contract.nutritionPTIds?.includes(trainerId)) nutritionRole = 'Co';
        }
        
        return [
          s.name,
          s.phone || 'Khong co',
          contract ? contract.packageName : 'Khong co',
          contract ? `${getCalculatedUsedSessions(contract, sessions)}/${contract.totalSessions}` : '-',
          contract ? new Date(contract.endDate).toLocaleDateString('vi-VN') : '-',
          trainingRole,
          nutritionRole
        ];
      }).filter(Boolean);

      autoTable(doc, {
        head: [['Ho Ten', 'SDT', 'Goi Tap', 'So Buoi (Da tap/Tong)', 'Han Su Dung', 'PT Tap', 'PT Dinh Duong']],
        body: tableData as (string | number)[][],
        startY: 35,
        styles: {
          font: 'Roboto',
          fontSize: 10,
          cellPadding: 4,
          halign: 'left',
          valign: 'middle',
        },
        headStyles: {
          fillColor: [236, 72, 153],
          textColor: 255,
          fontStyle: 'bold',
          halign: 'center'
        },
        columnStyles: {
          3: { halign: 'center' },
          4: { halign: 'center' },
          5: { halign: 'center' },
          6: { halign: 'center' }
        }
      });
      
      doc.save(`Danh_Sach_Hoc_Vien_${new Date().toLocaleDateString('vi-VN').replace(/\//g, '-')}.pdf`);
    } catch (error) {
      console.error("Error exporting PDF:", error);
      alert("Đã xảy ra lỗi khi tạo PDF. Vui lòng thử lại.");
    }
  };

  return (
    <div className="p-4 md:p-6 pb-24 max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-white mb-1">
            {getGreeting()}, <span className="text-pink-500">{profile?.displayName || profile?.name || 'Huấn luyện viên'}!</span>
          </h2>
          <p className="text-sm text-zinc-400">Chúc bạn một ngày làm việc hiệu quả.</p>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-zinc-900 border border-zinc-800 p-4 rounded-2xl relative overflow-hidden">
          <div className="absolute -right-4 -top-4 w-16 h-16 bg-pink-500/10 rounded-full blur-xl"></div>
          <p className="text-xs text-zinc-400 font-medium mb-1">PT Chính</p>
          <p className="text-2xl font-bold text-white">{mainStudentIds.length}</p>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 p-4 rounded-2xl relative overflow-hidden">
          <div className="absolute -right-4 -top-4 w-16 h-16 bg-indigo-500/10 rounded-full blur-xl"></div>
          <p className="text-xs text-zinc-400 font-medium mb-1">PT Phụ</p>
          <p className="text-2xl font-bold text-white">{subStudentIds.length}</p>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 p-4 rounded-2xl relative overflow-hidden">
          <div className="absolute -right-4 -top-4 w-16 h-16 bg-emerald-500/10 rounded-full blur-xl"></div>
          <p className="text-xs text-zinc-400 font-medium mb-1">Dinh dưỡng</p>
          <p className="text-2xl font-bold text-white">{nutritionStudentIds.length}</p>
        </div>
        <div className="bg-gradient-to-br from-pink-500 to-rose-600 p-4 rounded-2xl text-white relative overflow-hidden shadow-lg shadow-pink-500/20">
          <div className="absolute right-0 top-0 w-24 h-24 bg-white/10 rounded-bl-full"></div>
          <p className="text-xs text-pink-100 font-medium mb-1">Lịch dạy hôm nay</p>
          <div className="flex items-center gap-2">
            <p className="text-2xl font-bold">{slotsCount}</p>
            <span className="text-xs bg-white/20 px-2 py-0.5 rounded-full backdrop-blur-sm">ca dạy</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Main Content (Left, 2 columns on large screens) */}
        <div className="lg:col-span-2 space-y-6">
          {/* Quick Actions / Alerts */}
          {warnings.length > 0 && (
            <div className="bg-orange-500/10 border border-orange-500/20 p-4 rounded-2xl">
              <h3 className="text-sm font-bold text-orange-400 flex items-center gap-2 mb-3">
                <AlertCircle className="w-4 h-4" /> Cần chú ý ({warnings.length})
              </h3>
              <div className="flex overflow-x-auto pb-2 gap-3 snap-x scrollbar-hide">
                {warnings.map((w, idx) => {
                  const s = students.find(stud => stud.id === w.studentId);
                  if (!s) return null;
                  return (
                    <div 
                      key={`${w.studentId}-${idx}`}
                      onClick={() => setSelectedStudentId(w.studentId)}
                      className="min-w-[200px] bg-zinc-950 border border-zinc-800 p-3 rounded-xl shrink-0 snap-start cursor-pointer hover:border-orange-500/50 transition-colors"
                    >
                      <p className="text-sm font-bold text-white mb-1 truncate">{s.name}</p>
                      {w.type === 'low_session' ? (
                        <p className="text-xs text-orange-400 flex items-center gap-1">
                          <Activity className="w-3 h-3" /> Còn {w.contract.totalSessions - getCalculatedUsedSessions(w.contract, sessions)} buổi
                        </p>
                      ) : (
                        <p className="text-xs text-amber-500 flex items-center gap-1">
                          <CalendarIcon className="w-3 h-3" /> HSD: {new Date(w.contract.endDate).toLocaleDateString('vi-VN')}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Student Tabs */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 sm:p-5">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-4 pb-4 border-b border-zinc-800">
              <div className="flex bg-zinc-950 p-1 rounded-xl border border-zinc-800 self-stretch sm:self-auto">
                <button
                  onClick={() => setActiveTab('main')}
                  className={`flex-1 sm:flex-none px-4 py-1.5 text-xs font-bold rounded-lg transition-colors ${activeTab === 'main' ? 'bg-zinc-800 text-white' : 'text-zinc-500 hover:text-zinc-300'}`}
                >
                  PT Chính
                </button>
                <button
                  onClick={() => setActiveTab('sub')}
                  className={`flex-1 sm:flex-none px-4 py-1.5 text-xs font-bold rounded-lg transition-colors ${activeTab === 'sub' ? 'bg-zinc-800 text-white' : 'text-zinc-500 hover:text-zinc-300'}`}
                >
                  PT Phụ
                </button>
                <button
                  onClick={() => setActiveTab('nutrition')}
                  className={`flex-1 sm:flex-none px-4 py-1.5 text-xs font-bold rounded-lg transition-colors ${activeTab === 'nutrition' ? 'bg-zinc-800 text-white' : 'text-zinc-500 hover:text-zinc-300'}`}
                >
                  Dinh dưỡng
                </button>
              </div>

              <div className="flex gap-2 w-full sm:w-auto flex-wrap sm:flex-nowrap">
                <button
                  onClick={handleExportPDF}
                  className="bg-pink-600 border border-pink-500 rounded-xl px-3 py-1.5 text-xs text-white font-bold hover:bg-pink-500 transition-colors flex items-center gap-1.5 w-full sm:w-auto justify-center"
                >
                  <Download className="w-3.5 h-3.5" /> Xuất PDF
                </button>
                <div className="relative flex-1 sm:w-48">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-500" />
                  <input 
                    type="text" 
                    placeholder="Tìm kiếm..." 
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl pl-8 pr-3 py-1.5 text-xs text-white focus:outline-none focus:border-pink-500/50"
                  />
                </div>
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="bg-zinc-950 border border-zinc-800 rounded-xl px-2 py-1.5 text-xs text-zinc-300 focus:outline-none focus:border-pink-500/50 appearance-none min-w-[100px] flex-1 sm:flex-none"
                >
                  <option value="all">Tất cả</option>
                  <option value="active">Đang tập</option>
                  <option value="low_sessions">Sắp hết buổi</option>
                  <option value="expire_soon">Sắp hết hạn</option>
                </select>
              </div>
            </div>

            <AnimatePresence mode="wait">
              <motion.div
                key={activeTab}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.2 }}
              >
                {activeTab === 'main' && renderStudentList(mainStudentIds, "Bạn chưa có học viên chính nào.")}
                {activeTab === 'sub' && renderStudentList(subStudentIds, "Bạn chưa có học viên phụ nào.")}
                {activeTab === 'nutrition' && renderStudentList(nutritionStudentIds, "Chưa chăm sóc dinh dưỡng cho học viên nào.")}
              </motion.div>
            </AnimatePresence>
          </div>
        </div>

        {/* Sidebar (Right) */}
        <div className="space-y-6">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 shadow-sm">
            <h3 className="text-sm font-bold text-white mb-4 flex items-center gap-2">
              <Clock className="w-4 h-4 text-pink-500" /> Lịch dạy hôm nay
            </h3>
            
            {slotsCount === 0 ? (
              <div className="text-center py-6 bg-zinc-950 rounded-xl border border-zinc-800 border-dashed">
                <CalendarIcon className="w-6 h-6 text-zinc-600 mx-auto mb-2 opacity-50" />
                <p className="text-xs text-zinc-500">Không có lịch dạy hôm nay.</p>
              </div>
            ) : (
              <div className="space-y-4">
                {Object.entries(scheduleBySlot).map(([hourStr, slotSessions]) => {
                  const hour = parseInt(hourStr);
                  const sessionsInSlot = slotSessions as Session[];
                  
                  return (
                    <div key={hourStr} className="bg-zinc-950 border border-zinc-800 p-3 rounded-xl flex items-start gap-3 relative overflow-hidden group">
                      <div className="absolute left-0 top-0 bottom-0 w-1 bg-pink-500"></div>
                      <div className="w-11 h-11 rounded-lg bg-pink-500/10 flex flex-col items-center justify-center text-pink-500 shrink-0 border border-pink-500/20 mt-0.5">
                        <span className="text-[10px] font-bold uppercase leading-none mb-1">Giờ</span>
                        <span className="text-sm font-bold leading-none">{hour !== -1 ? `${hour}:00` : '--:--'}</span>
                      </div>
                      <div className="flex-1 min-w-0 space-y-3">
                        {sessionsInSlot.map((session, idx) => {
                          const s = students.find(stud => stud.id === session.studentId);
                          if (!s) return null;
                          return (
                            <div key={`${session.id}-${idx}`} className={`flex items-center justify-between ${idx > 0 ? 'pt-3 border-t border-zinc-800/50' : ''}`}>
                              <div className="min-w-0">
                                <p className="text-sm font-bold text-white truncate">{s.name}</p>
                                <p className="text-xs text-zinc-500 truncate">{s.phone || 'Chưa có SĐT'}</p>
                              </div>
                              <button 
                                onClick={() => setSelectedStudentId(s.id)}
                                className="w-7 h-7 rounded-full bg-zinc-800 flex items-center justify-center text-zinc-400 hover:text-white hover:bg-zinc-700 transition-colors shrink-0"
                              >
                                <ArrowRight className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

