import React from 'react';
import { Student, Schedule, Warning, Branch, StudentContract, Trainer, ScheduleEntry } from '../../types';
import { AlertTriangle, MessageSquare, Trash2, Edit2, CheckCircle2, Circle, MapPin, Lock, Unlock, AlertCircle } from 'lucide-react';

interface Props {
  students: Student[];
  schedule: Schedule;
  warnings: Warning[];
  branches?: Branch[];
  contracts?: StudentContract[];
  trainers?: Trainer[];
  activeStudentIds?: Set<string>;
  overriddenSessions?: Record<string, number>;
  onUpdateSessionOverride?: (studentId: string, sessions: number) => void;
  onDelete?: (id: string) => void;
  onEdit: (student: Student) => void;
  onToggleConfirm?: (id: string) => void;
  onToggleLockSchedule?: (id: string) => void;
}

export default function StudentList({ students, schedule, warnings, branches, contracts = [], trainers = [], activeStudentIds, overriddenSessions = {}, onUpdateSessionOverride, onDelete, onEdit, onToggleConfirm, onToggleLockSchedule }: Props) {
  const [expandedStudentId, setExpandedStudentId] = React.useState<string | null>(null);
  const [filterTab, setFilterTab] = React.useState<'all' | 'no_slots' | 'not_enough_days' | 'low_slots' | 'no_contract'>('all');
  const [filterBranch, setFilterBranch] = React.useState<string>('all');

  const toggleExpand = (id: string) => {
    setExpandedStudentId(prev => (prev === id ? null : id));
  };
  const getStudentSchedule = (studentId: string) => {
    const slots: string[] = [];
    Object.entries(schedule).forEach(([slotId, entries]) => {
      if ((entries as ScheduleEntry[])?.some((e: ScheduleEntry) => e.studentId === studentId)) {
        slots.push(slotId);
      }
    });
    
    // Sort slots by day then hour
    return slots.sort((a, b) => {
      const [dayA, hourA] = a.split('-');
      const [dayB, hourB] = b.split('-');
      if (dayA !== dayB) return dayA.localeCompare(dayB);
      return parseInt(hourA) - parseInt(hourB);
    });
  };

  const isStudentLocked = (studentId: string) => {
    let locked = false;
    Object.values(schedule).forEach((entries: ScheduleEntry[]) => {
      if (entries?.some((e: ScheduleEntry) => e.studentId === studentId && e.isLocked)) {
        locked = true;
      }
    });
    return locked;
  };

  const formatSlot = (slotId: string) => {
    const [day, hour] = slotId.split('-');
    return `${day} (${hour}h)`;
  };

  const [warningBranchTab, setWarningBranchTab] = React.useState<string>('all');

  const warningsByBranch = React.useMemo(() => {
    const grouped: Record<string, Warning[]> = {};
    (warnings || []).forEach(w => {
      const student = (students || []).find(s => s.id === w.studentId);
      const branchId = student?.branchId || 'none';
      if (!grouped[branchId]) {
        grouped[branchId] = [];
      }
      grouped[branchId].push(w);
    });
    return grouped;
  }, [warnings, students]);

  const getBranchName = (branchId: string) => {
    if (branchId === 'none') return 'Chưa xác định';
    return branches?.find(b => b.id === branchId)?.name || 'Chưa xác định';
  };

  const filteredStudents = React.useMemo(() => {
    let result = students || [];
    
    if (filterBranch !== 'all') {
      if (filterBranch === 'none') {
        result = result.filter(s => !s.branchId);
      } else {
        result = result.filter(s => s.branchId === filterBranch);
      }
    }

    switch (filterTab) {
      case 'no_contract':
        return result.filter(s => activeStudentIds ? !activeStudentIds.has(s.id) : false);
      case 'no_slots':
        return result.filter(s => (activeStudentIds ? activeStudentIds.has(s.id) : true) && (!s.availableSlots || s.availableSlots.length === 0));
      case 'not_enough_days':
        return result.filter(s => {
          if (activeStudentIds && !activeStudentIds.has(s.id)) return false;
          if (!s.availableSlots || s.availableSlots.length === 0) return false;
          const uniqueDays = new Set((s.availableSlots || []).map((slot: string) => slot.split('-')[0])).size;
          const sessionsNum = overriddenSessions[s.id] !== undefined ? overriddenSessions[s.id] : s.sessionsPerWeek;
          return uniqueDays < sessionsNum;
        });
      case 'low_slots':
        return result.filter(s => (activeStudentIds ? activeStudentIds.has(s.id) : true) && s.availableSlots && s.availableSlots.length > 0 && s.availableSlots.length < 5);
      case 'all':
      default:
        return result.filter(s => activeStudentIds ? activeStudentIds.has(s.id) : true);
    }
  }, [students, filterTab, filterBranch, activeStudentIds, overriddenSessions]);

  return (
    <div className="space-y-6">
      {warnings.length > 0 && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-2xl p-5 space-y-4">
          <h3 className="text-amber-400 font-bold uppercase tracking-wide flex items-center gap-2 text-sm">
            <AlertTriangle size={18} />
            Cảnh báo xếp lịch ({warnings.length})
          </h3>
          <div className="space-y-4">
            <div className="flex overflow-x-auto gap-2 pb-2 -mx-2 px-2 hide-scrollbar">
              <button
                onClick={() => setWarningBranchTab('all')}
                className={`px-4 py-2 rounded-xl text-xs font-bold transition-colors whitespace-nowrap flex-shrink-0 ${
                  warningBranchTab === 'all'
                    ? 'bg-amber-600/80 text-white shadow-lg shadow-amber-600/20'
                    : 'bg-amber-500/10 text-amber-500 hover:bg-amber-500/20 border border-amber-500/20'
                }`}
              >
                Tất cả cơ sở
              </button>
              {Object.keys(warningsByBranch).map(branchId => (
                <button
                  key={branchId}
                  onClick={() => setWarningBranchTab(branchId)}
                  className={`px-4 py-2 rounded-xl text-xs font-bold transition-colors whitespace-nowrap flex-shrink-0 ${
                    warningBranchTab === branchId
                      ? 'bg-amber-600/80 text-white shadow-lg shadow-amber-600/20'
                      : 'bg-amber-500/10 text-amber-500 hover:bg-amber-500/20 border border-amber-500/20'
                  }`}
                >
                  {getBranchName(branchId)} ({warningsByBranch[branchId].length})
                </button>
              ))}
            </div>

            {Object.entries(warningsByBranch).map(([branchId, branchWarnings]: [string, Warning[]]) => {
              if (warningBranchTab !== 'all' && warningBranchTab !== branchId) return null;
              return (
              <div key={branchId} className="space-y-4">
                {warningBranchTab === 'all' && (
                  <h4 className="text-amber-500/80 text-xs font-bold uppercase tracking-wider flex items-center gap-1 border-b border-amber-500/10 pb-2">
                    <MapPin size={14} />
                    {getBranchName(branchId)} ({branchWarnings.length})
                  </h4>
                )}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {branchWarnings.map((warning, idx) => {
                    const student = students.find(s => s.id === warning.studentId);
                    return (
                      <div key={`warning-${warning.studentId}-${idx}`} className="bg-zinc-950/50 p-4 rounded-xl border border-amber-500/20 shadow-sm flex flex-col justify-between">
                        <div>
                          <p className="font-medium text-zinc-200 text-sm flex items-center gap-1">
                            <span 
                              className="text-amber-400 font-bold cursor-pointer hover:text-amber-300 transition-colors underline decoration-amber-400/30 underline-offset-4"
                              title="Bấm để xem nhanh lịch rảnh và PT"
                              onClick={() => student && toggleExpand(`warning-${student.id}`)}
                            >
                              {student?.name}
                            </span>
                            <span className="text-zinc-400 ml-1">: {warning.scheduled}/{warning.requested} buổi</span>
                          </p>
                          {warning.multipleSessionsDays && warning.multipleSessionsDays.length > 0 && (
                            <p className="text-xs text-red-400 mt-1">
                              Trùng ngày: {warning.multipleSessionsDays.join(', ')}
                            </p>
                          )}
                          {warning.overlappingSlots && warning.overlappingSlots.length > 0 && (
                            <p className="text-xs text-red-400 mt-1">
                              Trùng ca: {warning.overlappingSlots.join(', ')}
                            </p>
                          )}
                          {warning.suggestions.length > 0 && (
                            <div className="mt-2 text-xs">
                              <span className="text-zinc-500">Gợi ý thêm giờ rảnh: </span>
                              <div className="flex flex-wrap gap-1 mt-1">
                                {warning.suggestions.slice(0, 3).map((slot: string, i: number) => (
                                  <span key={`sugg-${slot}-${i}`} className="text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                                    {formatSlot(slot)}
                                  </span>
                                ))}
                                {warning.suggestions.length > 3 && (
                                  <span className="text-[10px] text-zinc-500 px-1 py-0.5">+{warning.suggestions.length - 3}</span>
                                )}
                              </div>
                            </div>
                          )}

                          {student && expandedStudentId === `warning-${student.id}` && (
                            <div className="mt-3 bg-zinc-900 border border-zinc-800 p-3 rounded-lg animate-in fade-in slide-in-from-top-2 duration-200">
                              <div className="space-y-3">
                                <div>
                                  <span className="text-[10px] text-zinc-500 uppercase font-bold block mb-1">PT Phụ trách</span>
                                  {contracts.filter(c => c.studentId === student.id && c.status === 'active').length > 0 ? (
                                    <div className="flex flex-wrap gap-1">
                                      {contracts.filter(c => c.studentId === student.id && c.status === 'active').flatMap(c => {
                                        const ptIds = new Set<string>();
                                        if (c.trainerId) ptIds.add(c.trainerId);
                                        if (c.trainerIds) c.trainerIds.forEach((id: string) => ptIds.add(id));
                                        
                                        return Array.from(ptIds).map(ptId => {
                                          const pt = trainers.find(t => t.id === ptId);
                                          return (
                                            <span key={`${c.id}-${ptId}`} className="text-[11px] font-medium bg-zinc-800 border border-zinc-700 px-1.5 py-0.5 rounded text-emerald-400">
                                              {pt?.name || 'PT Không xác định'}
                                            </span>
                                          );
                                        });
                                      })}
                                    </div>
                                  ) : (
                                    <span className="text-[11px] text-zinc-500 italic">Chưa có hợp đồng/PT</span>
                                  )}
                                </div>
                                <div>
                                  <span className="text-[10px] text-zinc-500 uppercase font-bold block mb-1">Khung giờ rảnh ({student.availableSlots?.length || 0})</span>
                                  <div className="flex flex-wrap gap-1">
                                    {student.availableSlots && student.availableSlots.length > 0 ? (
                                      student.availableSlots.map((slot: string, i: number) => (
                                        <span key={`avail-${slot}-${i}`} className="text-[10px] px-1.5 py-0.5 rounded bg-pink-500/10 text-pink-400 border border-pink-500/20">
                                          {formatSlot(slot)}
                                        </span>
                                      ))
                                    ) : (
                                      <span className="text-[11px] text-zinc-500 italic">Chưa nhập lịch rảnh</span>
                                    )}
                                  </div>
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="bg-zinc-900 rounded-2xl shadow-xl border border-zinc-800 overflow-hidden">
        <div className="p-6 border-b border-zinc-800 bg-zinc-900/50">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-4">
            <h2 className="text-xl font-black text-white uppercase tracking-wide flex items-center gap-3">
              <span className="w-2 h-6 bg-pink-500 rounded-full shadow-[0_0_10px_rgba(236,72,153,0.8)]"></span>
              Danh sách Học viên ({filteredStudents.length}/{students?.length || 0})
            </h2>
            
            {branches && branches.length > 0 && (
              <select
                value={filterBranch}
                onChange={(e) => setFilterBranch(e.target.value)}
                className="bg-zinc-800 border border-zinc-700 text-zinc-300 px-3 py-2 rounded-xl text-sm font-medium focus:outline-none focus:border-pink-500 w-full md:w-auto"
              >
                <option value="all">Tất cả chi nhánh</option>
                <option value="none">Chưa xếp chi nhánh</option>
                {branches.map(b => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
            )}
          </div>
          
          <div className="flex overflow-x-auto gap-2 pb-2 -mx-2 px-2 hide-scrollbar">
            <button
              onClick={() => setFilterTab('all')}
              className={`px-4 py-2 rounded-xl text-sm font-bold transition-colors whitespace-nowrap flex-shrink-0 ${
                filterTab === 'all'
                  ? 'bg-pink-600 text-white shadow-lg'
                  : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-white'
              }`}
            >
              Đang xếp lịch
            </button>
            <button
              onClick={() => setFilterTab('no_slots')}
              className={`px-4 py-2 rounded-xl text-sm font-bold transition-colors whitespace-nowrap flex-shrink-0 ${
                filterTab === 'no_slots'
                  ? 'bg-red-600/80 text-white shadow-lg shadow-red-600/20'
                  : 'bg-zinc-800 text-red-500 hover:bg-zinc-700'
              }`}
            >
              Chưa đky lịch rảnh
            </button>
            <button
              onClick={() => setFilterTab('not_enough_days')}
              className={`px-4 py-2 rounded-xl text-sm font-bold transition-colors whitespace-nowrap flex-shrink-0 ${
                filterTab === 'not_enough_days'
                  ? 'bg-amber-600/80 text-white shadow-lg shadow-amber-600/20'
                  : 'bg-zinc-800 text-amber-500 hover:bg-zinc-700'
              }`}
            >
              Thiếu ngày rảnh
            </button>
            <button
              onClick={() => setFilterTab('low_slots')}
              className={`px-4 py-2 rounded-xl text-sm font-bold transition-colors whitespace-nowrap flex-shrink-0 ${
                filterTab === 'low_slots'
                  ? 'bg-orange-600/80 text-white shadow-lg shadow-orange-600/20'
                  : 'bg-zinc-800 text-orange-500 hover:bg-zinc-700'
              }`}
            >
              Cần thêm slot rảnh (&lt;5)
            </button>
            <button
              onClick={() => setFilterTab('no_contract')}
              className={`px-4 py-2 rounded-xl text-sm font-bold transition-colors whitespace-nowrap flex-shrink-0 ${
                filterTab === 'no_contract'
                  ? 'bg-purple-600/80 text-white shadow-lg shadow-purple-600/20'
                  : 'bg-zinc-800 text-purple-400 hover:bg-zinc-700'
              }`}
            >
              Không đủ điều kiện
            </button>
          </div>
        </div>
        <div className="divide-y divide-zinc-800/50">
          {filteredStudents.length === 0 ? (
            <div className="p-8 text-center text-zinc-500 font-medium">
              Không tìm thấy học viên nào trong mục này.
            </div>
          ) : (
            filteredStudents.map(student => {
              const studentSchedule = getStudentSchedule(student.id);
              const message = `Chào ${student.name}, lịch tập tuần này của bạn là: ${studentSchedule.map(formatSlot).join(', ')}.`;
              
              // Check for warnings
              const now = new Date();
              const activeContract = contracts.find(c => {
                if (c.studentId !== student.id || c.status !== 'active') return false;
                const endDate = new Date(c.endDate);
                const timeDiff = endDate.getTime() - now.getTime();
                const daysLeft = Math.ceil(timeDiff / (1000 * 3600 * 24));
                const sessionsLeft = c.totalSessions - c.usedSessions;
                return daysLeft >= 0 && sessionsLeft > 0;
              });
              const hasBranchMismatch = activeContract && activeContract.branchId !== student.branchId;
              const hasNoBranch = !student.branchId || student.branchId === 'none';
              const hasLowSlots = (student.availableSlots?.length || 0) < 5;
              
              const warning = warnings.find(w => w.studentId === student.id);
              const customSessions = overriddenSessions[student.id];
              const displaySessions = customSessions !== undefined ? customSessions : student.sessionsPerWeek;
              const isUnderScheduled = warning && warning.scheduled < warning.requested;
              const isOverScheduled = warning && warning.scheduled > warning.requested;
              const hasMultipleSessions = warning && warning.multipleSessionsDays && warning.multipleSessionsDays.length > 0;
              const hasOverlappingSlots = warning && warning.overlappingSlots && warning.overlappingSlots.length > 0;
              
              const showRedWarning = hasBranchMismatch || hasNoBranch || hasLowSlots || isUnderScheduled || isOverScheduled || hasMultipleSessions || hasOverlappingSlots;
              const noContract = activeStudentIds ? !activeStudentIds.has(student.id) : false;
              
              return (
                <div key={student.id} className={`p-6 hover:bg-zinc-800/30 transition-colors ${showRedWarning ? 'bg-red-500/5 border-l-4 border-l-red-500' : ''} ${noContract ? 'opacity-80 bg-zinc-900/50' : ''}`}>
                  <div className="flex flex-col sm:flex-row justify-between items-start gap-4 mb-4">
                    <div className="w-full sm:w-auto flex-1">
                      <h3 
                        className="font-black text-zinc-100 text-lg sm:text-xl flex flex-wrap items-center gap-2 cursor-pointer hover:text-pink-400 transition-colors"
                        onClick={() => toggleExpand(student.id)}
                        title="Bấm để xem nhanh lịch rảnh và PT"
                      >
                        {student.name}
                        {showRedWarning && (
                          <AlertCircle size={18} className="text-red-500 shrink-0" />
                        )}
                        {noContract && (
                          <span className="text-[10px] font-bold bg-purple-500/10 text-purple-400 py-0.5 px-2 rounded-full border border-purple-500/20 whitespace-nowrap">
                            Không đủ đk xếp lịch
                          </span>
                        )}
                      </h3>
                      <div className="text-sm text-zinc-400 mt-2 font-medium flex flex-wrap items-center gap-x-3 gap-y-2">
                        <div className="flex items-center gap-1 bg-zinc-900 px-2 py-1 rounded-lg border border-zinc-800">
                          <span>Đăng ký:</span> 
                          <select 
                            value={displaySessions}
                            onChange={(e) => onUpdateSessionOverride && onUpdateSessionOverride(student.id, parseInt(e.target.value))}
                            className="bg-zinc-950 border border-zinc-700 text-pink-400 rounded-md px-1 focus:outline-none focus:border-pink-500 appearance-none font-bold"
                            title="Thay đổi số buổi tuần này"
                          >
                            {[0, 1, 2, 3, 4, 5, 6, 7].map(n => (
                              <option key={n} value={n}>{n}</option>
                            ))}
                          </select>
                          <span className="text-pink-400">buổi</span>
                          {customSessions !== undefined && <span className="text-[10px] text-orange-400" title="Đã thay đổi riêng cho tuần này">(Tạm thời)</span>}
                        </div>
                        <div className="flex flex-wrap items-center gap-3">
                          <span className="flex items-center gap-1">Đã xếp: <span className={`${isUnderScheduled || isOverScheduled ? 'text-red-400 font-bold bg-red-500/10 px-1.5 rounded' : 'text-emerald-400 font-bold'}`}>{warning?.scheduled || 0}</span></span>
                          <span className="w-1 h-1 rounded-full bg-zinc-700 hidden sm:block"></span>
                          <span className="flex items-center gap-1">Rảnh: <span className={`${hasLowSlots ? 'text-red-400 font-bold bg-red-500/10 px-1.5 rounded' : 'text-pink-400 font-bold'}`}>{student.availableSlots?.length || 0} slots</span></span>
                        </div>
                      </div>
                      {showRedWarning && (
                        <div className="mt-3 bg-red-500/5 border border-red-500/20 p-3 rounded-xl text-xs font-medium text-red-400 flex flex-col gap-1.5">
                          {(hasNoBranch || hasBranchMismatch) && (
                            <p className="flex items-start gap-1.5"><strong className="mt-0.5">•</strong> <span>Chi nhánh học viên: {getBranchName(student.branchId || 'none')} <br className="sm:hidden" />(Hợp đồng: {activeContract ? getBranchName(activeContract.branchId || 'none') : 'Không có'})</span></p>
                          )}
                          {hasLowSlots && (
                            <p className="flex items-center gap-1.5"><strong>•</strong> Khung giờ rảnh ít (&lt; 5 slots)</p>
                          )}
                          {isUnderScheduled && (
                            <p className="flex items-center gap-1.5"><strong>•</strong> Thiếu lịch ({warning.scheduled}/{warning.requested})</p>
                          )}
                          {isOverScheduled && (
                            <p className="flex items-center gap-1.5"><strong>•</strong> Dư lịch ({warning.scheduled}/{warning.requested})</p>
                          )}
                          {hasMultipleSessions && (
                            <p className="flex items-start gap-1.5"><strong className="mt-0.5">•</strong> <span>Trùng ngày: {warning.multipleSessionsDays?.join(', ')}</span></p>
                          )}
                          {hasOverlappingSlots && (
                            <p className="flex items-start gap-1.5"><strong className="mt-0.5">•</strong> <span>Trùng ca: {warning.overlappingSlots?.join(', ')}</span></p>
                          )}
                        </div>
                      )}
                    </div>
                    <div className="flex gap-1 self-end sm:self-auto shrink-0 bg-zinc-900/80 p-1 sm:p-0 rounded-xl sm:bg-transparent border border-zinc-800 sm:border-none">
                      {onToggleLockSchedule && studentSchedule.length > 0 && (
                        <button 
                          onClick={() => onToggleLockSchedule(student.id)}
                          className={`p-2.5 rounded-lg transition-colors ${isStudentLocked(student.id) ? 'text-pink-500 bg-pink-500/10' : 'text-zinc-500 hover:text-pink-400 hover:bg-pink-500/10'}`}
                          title={isStudentLocked(student.id) ? "Mở khóa lịch tập" : "Khóa lịch tập (không bị đổi khi xếp lại)"}
                        >
                          {isStudentLocked(student.id) ? <Lock size={18} /> : <Unlock size={18} />}
                        </button>
                      )}
                      {onToggleConfirm && (
                        <button 
                          onClick={() => onToggleConfirm(student.id)}
                          className={`p-2.5 rounded-lg transition-colors ${student.isScheduleConfirmed ? 'text-emerald-500 bg-emerald-500/10' : 'text-zinc-500 hover:text-emerald-400 hover:bg-emerald-500/10'}`}
                          title={student.isScheduleConfirmed ? "Đã chốt lịch rảnh" : "Chưa chốt lịch rảnh"}
                        >
                          {student.isScheduleConfirmed ? <CheckCircle2 size={18} /> : <Circle size={18} />}
                        </button>
                      )}
                      <button 
                        onClick={() => onEdit(student)}
                        className="text-zinc-500 hover:text-pink-400 p-2.5 rounded-lg hover:bg-pink-500/10 transition-colors"
                        title="Sửa học viên"
                      >
                        <Edit2 size={18} />
                      </button>
                      {onDelete && (
                        <button 
                          onClick={() => onDelete(student.id)}
                          className="text-zinc-500 hover:text-red-400 p-2.5 rounded-lg hover:bg-red-500/10 transition-colors"
                          title="Xóa học viên"
                        >
                          <Trash2 size={18} />
                        </button>
                      )}
                    </div>
                  </div>
                  
                  {studentSchedule.length > 0 ? (
                    <div className="bg-zinc-950 p-4 rounded-xl border border-zinc-800 flex items-start gap-3">
                      <MessageSquare size={18} className="text-pink-500 mt-0.5 shrink-0" />
                      <p className="text-sm text-zinc-300 font-medium leading-relaxed">
                        {message}
                      </p>
                    </div>
                  ) : (
                    <p className="text-sm text-zinc-600 italic font-medium">Chưa được xếp lịch</p>
                  )}

                  {expandedStudentId === student.id && (
                    <div className="mt-4 bg-zinc-950 p-4 rounded-xl border border-zinc-800 animate-in fade-in slide-in-from-top-2 duration-200">
                      <h4 className="text-sm font-bold text-zinc-300 mb-2 border-b border-zinc-800 pb-2">Thông tin chi tiết ({student.availableSlots?.length || 0} slots rảnh)</h4>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <span className="text-xs text-zinc-500 uppercase font-bold block mb-1">PT Phụ trách</span>
                          {contracts.filter(c => c.studentId === student.id && c.status === 'active').length > 0 ? (
                            <div className="flex flex-wrap gap-2">
                              {contracts.filter(c => c.studentId === student.id && c.status === 'active').flatMap(c => {
                                const ptIds = new Set<string>();
                                if (c.trainerId) ptIds.add(c.trainerId);
                                if (c.trainerIds) c.trainerIds.forEach((id: string) => ptIds.add(id));
                                
                                return Array.from(ptIds).map(ptId => {
                                  const pt = trainers.find(t => t.id === ptId);
                                  return (
                                    <span key={`${c.id}-${ptId}`} className="text-sm font-medium bg-zinc-900 border border-zinc-700 px-2 py-1 rounded-lg text-emerald-400">
                                      {pt?.name || 'PT Không xác định'}
                                    </span>
                                  );
                                });
                              })}
                            </div>
                          ) : (
                            <span className="text-sm text-zinc-500 italic">Chưa có hợp đồng/PT</span>
                          )}
                        </div>
                        <div>
                          <span className="text-xs text-zinc-500 uppercase font-bold block mb-1">Khung giờ rảnh</span>
                          <div className="flex flex-wrap gap-1">
                            {student.availableSlots && student.availableSlots.length > 0 ? (
                              student.availableSlots.map((slot: string, i: number) => (
                                <span key={`avail-${slot}-${i}`} className="text-xs px-2 py-0.5 rounded bg-pink-500/10 text-pink-400 border border-pink-500/20">
                                  {formatSlot(slot)}
                                </span>
                              ))
                            ) : (
                              <span className="text-sm text-zinc-500 italic">Chưa nhập lịch rảnh</span>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
