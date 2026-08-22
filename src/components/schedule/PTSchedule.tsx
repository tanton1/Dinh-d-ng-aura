import React, { useState, useMemo, useRef, useEffect } from 'react';
import { Student, Trainer, Schedule, ScheduleEntry, StudentContract, ScheduleConfig } from '../../types';
import { motion, AnimatePresence } from 'motion/react';
import { Calendar, User, Clock, Info, Download, X, Lock, Unlock, Plus, Trash2, Search, ChevronLeft, ChevronRight } from 'lucide-react';
import { getDatesForCurrentWeek, getDatesForWeek } from '../../utils/dateUtils';




interface Props {
  schedule: Schedule;
  students: Student[];
  trainers: Trainer[];
  contracts: StudentContract[];
  currentTrainerId?: string;
  weekOffset?: number;
  onUpdateSlot?: (slotId: string, updater: (currentEntries: ScheduleEntry[]) => ScheduleEntry[]) => void;
  selectedBranchId: string;
  scheduleConfig: ScheduleConfig;
}

export default function PTSchedule({ schedule, students, trainers, contracts, currentTrainerId, weekOffset = 0, onUpdateSlot, selectedBranchId, scheduleConfig }: Props) {
  const [selectedTrainerId, setSelectedTrainerId] = useState<string>(currentTrainerId || trainers[0]?.id || '');
  const [highlightedStudentId, setHighlightedStudentId] = useState<string | null>(null);
  const [hoveredStudentId, setHoveredStudentId] = useState<string | null>(null);
  const [mobileDayPage, setMobileDayPage] = useState(0);
  const scheduleRef = useRef<HTMLDivElement>(null);
  
  const activeStudents = useMemo(() => {
    const now = new Date();
    return (students || []).filter(s => {
      const contract = (contracts || []).find(c => {
        if (c.studentId !== s.id || c.status !== 'active') return false;
        const endDate = new Date(c.endDate);
        const timeDiff = endDate.getTime() - now.getTime();
        const daysLeft = Math.ceil(timeDiff / (1000 * 3600 * 24));
        const sessionsLeft = c.totalSessions - c.usedSessions;
        return daysLeft >= 0 && sessionsLeft > 0;
      });
      return !!contract;
    });
  }, [students, contracts]);
  
  // Manual Scheduling State
  const [editingSlot, setEditingSlot] = useState<{ id: string, day: string, hour: number } | null>(null);
  const [slotStudents, setSlotStudents] = useState<{ id: string, isLocked: boolean }[]>([]);
  const [newStudentId, setNewStudentId] = useState<string>('');
  const [studentSearchTerm, setStudentSearchTerm] = useState('');
  const selectedTrainer = trainers.find((trainer) => trainer.id === selectedTrainerId);
  const selectedTrainerCapacity = Number.isInteger(selectedTrainer?.slotCapacity)
    ? Math.max(1, Math.min(4, Number(selectedTrainer?.slotCapacity)))
    : 2;

  useEffect(() => {
    const candidates = trainers.filter((trainer) => !selectedBranchId || selectedBranchId === 'all' || trainer.branchId === selectedBranchId);
    if (!candidates.some((trainer) => trainer.id === selectedTrainerId)) {
      setSelectedTrainerId(currentTrainerId && candidates.some((trainer) => trainer.id === currentTrainerId) ? currentTrainerId : candidates[0]?.id || '');
    }
  }, [currentTrainerId, selectedBranchId, selectedTrainerId, trainers]);
  
  const currentWeekDates = useMemo(() => getDatesForWeek(weekOffset), [weekOffset]);
  const mobileDayGroups = useMemo(() => {
    const groups: string[][] = [];
    for (let index = 0; index < scheduleConfig.workingDays.length; index += 2) {
      groups.push(scheduleConfig.workingDays.slice(index, index + 2));
    }
    return groups;
  }, [scheduleConfig.workingDays]);
  const mobileVisibleDays = mobileDayGroups[mobileDayPage] || mobileDayGroups[0] || [];

  useEffect(() => {
    setMobileDayPage((current) => Math.min(current, Math.max(0, mobileDayGroups.length - 1)));
  }, [mobileDayGroups.length]);

  const getStudentName = (id: string) => {
    return students.find(s => s.id === id)?.name || 'Unknown';
  };

  const handleExportExcel = () => {
    const data = [
      ['Giờ', ...scheduleConfig.workingDays],
      ...scheduleConfig.workingHours.map(hour => {
        return [
          `${hour}:00`,
          ...scheduleConfig.workingDays.map(day => {
            const slotId = `${day}-${hour}`;
            const slotEntries = schedule[slotId] || [];
            const trainerEntries = slotEntries.filter(e => e.trainerId === selectedTrainerId);
            return trainerEntries.map(e => getStudentName(e.studentId)).join(', ');
          })
        ];
      })
    ];
    const csvCell = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;
    const csv = data.map((row) => row.map(csvCell).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob(['\ufeff', csv], { type: 'text/csv;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `Lich_Tap_PT_${new Date().toLocaleDateString('vi-VN').replace(/\//g, '-')}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const handleExportPDF = async () => {
    try {
      const { default: jsPDF } = await import('jspdf');
      const { default: autoTable } = await import('jspdf-autotable');
      const doc = new jsPDF('l', 'mm', 'a4');
      
      // Fetch Roboto fonts for full Vietnamese support
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

      const [regularBase64, boldBase64] = await Promise.all([
        blobToBase64(regularBlob),
        blobToBase64(boldBlob)
      ]);

      doc.addFileToVFS('Roboto-Regular.ttf', regularBase64);
      doc.addFont('Roboto-Regular.ttf', 'Roboto', 'normal');
      
      doc.addFileToVFS('Roboto-Medium.ttf', boldBase64);
      doc.addFont('Roboto-Medium.ttf', 'Roboto', 'bold');
      
      doc.setFont('Roboto', 'normal');
      
      doc.setFontSize(16);
      doc.text('Lịch Tập PT', 14, 15);
      
      const trainerName = trainers.find(t => t.id === selectedTrainerId)?.name || 'Tất cả';
      doc.setFontSize(12);
      doc.text(`Huấn luyện viên: ${trainerName}`, 14, 25);

      const tableData = scheduleConfig.workingHours.map(hour => {
        return [
          `${hour}:00`,
          ...scheduleConfig.workingDays.map(day => {
            const slotId = `${day}-${hour}`;
            const slotEntries = schedule[slotId] || [];
            const trainerEntries = slotEntries.filter(e => e.trainerId === selectedTrainerId);
            return trainerEntries.map(e => getStudentName(e.studentId)).join('\n');
          })
        ];
      });

      autoTable(doc, {
        head: [['Giờ', ...scheduleConfig.workingDays]],
        body: tableData,
        startY: 30,
        styles: {
          font: 'Roboto',
          fontSize: 9,
          cellPadding: 3,
          overflow: 'linebreak',
          halign: 'center',
          valign: 'middle',
        },
        headStyles: {
          fillColor: [236, 72, 153], // pink-500
          textColor: 255,
          fontStyle: 'bold',
        },
        columnStyles: {
          0: { fontStyle: 'bold', fillColor: [244, 244, 245], textColor: [24, 24, 27] } // zinc-100/zinc-900
        },
        theme: 'grid',
      });

      doc.save(`Lich_Tap_PT_${new Date().toLocaleDateString('vi-VN').replace(/\//g, '-')}.pdf`);
    } catch (error) {
      console.error('Error generating PDF:', error);
      alert('Có lỗi xảy ra khi xuất PDF. Vui lòng kiểm tra kết nối mạng và thử lại.');
    }
  };

  const openSlotEditor = (day: string, hour: number) => {
    if (!onUpdateSlot || !selectedTrainerId || !selectedBranchId || selectedBranchId === 'all') return;
    const slotId = `${day}-${hour}`;
    const slotEntries = schedule[slotId] || [];
    const trainerEntries = slotEntries.filter(e => e.trainerId === selectedTrainerId);
    
    setSlotStudents(trainerEntries.filter(e => e.type !== 'off').map(e => ({ id: e.studentId, isLocked: !!e.isLocked })));
    setEditingSlot({ id: slotId, day, hour });
    setNewStudentId('');
    setStudentSearchTerm('');
  };

  const handleToggleOff = () => {
    if (!editingSlot || !onUpdateSlot) return;
    
    const slotId = editingSlot.id;
    
    onUpdateSlot(slotId, (currentEntries) => {
      const isOff = currentEntries.some(e => e.trainerId === selectedTrainerId && e.type === 'off');
      if (isOff) {
        // Remove OFF entry
        return currentEntries.filter(e => !(e.trainerId === selectedTrainerId && e.type === 'off'));
      } else {
        // Add OFF entry
        return [
          ...currentEntries.filter(e => e.trainerId !== selectedTrainerId),
          { studentId: 'OFF', trainerId: selectedTrainerId, type: 'off', branchId: selectedBranchId, isLocked: true }
        ];
      }
    });
    
    setEditingSlot(null);
  };

  const handleSaveSlot = () => {
    if (!editingSlot || !onUpdateSlot || !selectedBranchId || selectedBranchId === 'all') return;
    
    const slotId = editingSlot.id;
    
    // Add new entries
    const newEntries: ScheduleEntry[] = slotStudents.map(s => ({
      studentId: s.id,
      trainerId: selectedTrainerId,
      isLocked: s.isLocked,
      branchId: selectedBranchId,
      type: 'training'
    }));
    
    onUpdateSlot(slotId, (currentEntries) => {
      // Remove old 'training' entries for this trainer in this slot, but keep 'off' entries
      const otherEntries = currentEntries.filter(e => e.trainerId !== selectedTrainerId || e.type === 'off');
      return [...otherEntries, ...newEntries];
    });
    
    setEditingSlot(null);
  };

  const handleAddStudentToSlot = () => {
    if (!newStudentId || slotStudents.length >= selectedTrainerCapacity) return;
    if (slotStudents.some(s => s.id === newStudentId)) return; // Already in slot
    
    setSlotStudents([...slotStudents, { id: newStudentId, isLocked: true }]);
    setNewStudentId('');
  };

  const handleRemoveStudentFromSlot = (idToRemove: string) => {
    setSlotStudents(slotStudents.filter(s => s.id !== idToRemove));
  };

  const handleToggleLock = (idToToggle: string) => {
    setSlotStudents(slotStudents.map(s => s.id === idToToggle ? { ...s, isLocked: !s.isLocked } : s));
  };

  if (trainers.length === 0) {
    return (
      <div className="pt-schedule-matrix-empty bg-zinc-900 p-8 rounded-2xl text-center text-zinc-400 border border-zinc-800 flex flex-col items-center justify-center min-h-[300px]">
        <Info className="w-12 h-12 text-zinc-600 mb-4" />
        <p className="text-lg font-medium text-zinc-300">Chưa có Huấn luyện viên</p>
        <p className="text-sm mt-2">Vui lòng thêm Huấn luyện viên trước khi xem lịch.</p>
      </div>
    );
  }

  return (
    <div className="pt-schedule-matrix-workspace bg-zinc-900 md:p-6 rounded-2xl shadow-xl border border-zinc-800 flex flex-col h-full overflow-hidden relative">
      {/* Header Section */}
      <div className="pt-schedule-matrix__header flex flex-col md:flex-row justify-between items-start md:items-center p-4 md:p-0 mb-4 gap-4">
        <div className="pt-schedule-matrix__intro w-full md:w-auto">
          <h2 className="text-2xl md:text-3xl font-black text-white uppercase tracking-tight flex items-center gap-3">
            <div className="p-2 bg-pink-500/10 rounded-xl border border-pink-500/20">
              <Calendar className="w-6 h-6 text-pink-500" />
            </div>
            {currentTrainerId ? 'Lịch Của Tôi' : 'Lịch Huấn Luyện'}
          </h2>
          <AnimatePresence mode="wait">
            {highlightedStudentId ? (
              <motion.div 
                key="highlighted"
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 10 }}
                className="mt-3 flex items-center gap-2 flex-wrap"
              >
                <span className="text-sm text-zinc-400">Đang xem lịch của:</span>
                <span className="text-sm font-bold text-pink-400 bg-pink-500/10 px-3 py-1 rounded-full border border-pink-500/20">
                  {getStudentName(highlightedStudentId)}
                </span>
                <button 
                  onClick={() => setHighlightedStudentId(null)}
                  className="text-zinc-500 hover:text-white text-xs underline ml-2 transition-colors"
                >
                  Bỏ chọn
                </button>
              </motion.div>
            ) : (
              <motion.p 
                key="normal"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="text-sm text-zinc-400 mt-3"
              >
                Quản lý và theo dõi lịch tập của học viên theo từng khung giờ.
              </motion.p>
            )}
          </AnimatePresence>
        </div>
        
        <div className="pt-schedule-matrix__actions flex flex-col sm:flex-row gap-2 w-full md:w-auto shrink-0">
          {!currentTrainerId && (
            <div className="relative w-full sm:w-64 shrink-0">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <User className="w-4 h-4 text-zinc-500" />
              </div>
              <select
                value={selectedTrainerId}
                onChange={(e) => setSelectedTrainerId(e.target.value)}
                className="w-full bg-zinc-950 border border-zinc-800 text-white pl-10 pr-10 py-3 rounded-xl outline-none focus:ring-2 focus:ring-pink-500 focus:border-transparent font-medium appearance-none transition-all shadow-sm"
              >
                {trainers
                  .filter((trainer) => !selectedBranchId || selectedBranchId === 'all' || trainer.branchId === selectedBranchId)
                  .map(t => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
              <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
                <svg className="w-4 h-4 text-zinc-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path></svg>
              </div>
            </div>
          )}
          <div className="flex gap-2 w-full sm:w-auto">
            <button
              onClick={handleExportExcel}
              className="flex-1 sm:flex-none justify-center bg-emerald-600 text-white px-4 py-3 rounded-xl font-bold hover:bg-emerald-500 transition-all flex items-center gap-2 shadow-sm shrink-0"
            >
              <Download className="w-4 h-4" /> Excel / CSV
            </button>
            <button
              onClick={handleExportPDF}
              className="flex-1 sm:flex-none justify-center bg-rose-600 text-white px-4 py-3 rounded-xl font-bold hover:bg-rose-500 transition-all flex items-center gap-2 shadow-sm shrink-0"
            >
              <Download className="w-4 h-4" /> PDF
            </button>
          </div>
        </div>
      </div>

      {/* Mobile shows two days per page; desktop always renders the whole week. */}
      <div className="pt-schedule-matrix__day-tabs" aria-label="Chọn cặp ngày hiển thị">
        <button type="button" aria-label="Hai ngày trước" disabled={mobileDayPage === 0} onClick={() => setMobileDayPage((page) => Math.max(0, page - 1))}>
          <ChevronLeft />
        </button>
        <div>
          {mobileDayGroups.map((days, page) => (
            <button key={days.join('-')} type="button" className={mobileDayPage === page ? 'is-active' : ''} aria-current={mobileDayPage === page ? 'page' : undefined} onClick={() => setMobileDayPage(page)}>
              {days.join(' – ')}
            </button>
          ))}
        </div>
        <button type="button" aria-label="Hai ngày sau" disabled={mobileDayPage >= mobileDayGroups.length - 1} onClick={() => setMobileDayPage((page) => Math.min(mobileDayGroups.length - 1, page + 1))}>
          <ChevronRight />
        </button>
      </div>
      
      {/* Schedule Table */}
      <div className="pt-schedule-matrix__table-shell flex-1 overflow-hidden flex flex-col bg-zinc-950 border-y md:border md:rounded-xl border-zinc-800 shadow-inner -mx-px md:mx-0" ref={scheduleRef}>
        <div className="overflow-x-auto overflow-y-auto custom-scrollbar flex-1">
          <div key={`mobile-days-${mobileDayPage}`} className="pt-schedule-matrix__grid">
            <table className="w-full text-sm text-left border-collapse table-fixed">
              <thead className="sticky top-0 z-30">
                <tr>
                  <th className="border-b border-r border-zinc-800 p-2 bg-zinc-900 w-16 md:w-20 text-center font-bold text-zinc-400 uppercase sticky left-0 z-40 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.5)]">
                    <Clock className="w-4 h-4 mx-auto mb-1 opacity-50" />
                    Giờ
                  </th>
                  {scheduleConfig.workingDays.map(day => (
                    <th key={day} className={`border-b border-r border-zinc-800 p-2 bg-zinc-900 text-center font-bold text-zinc-200 uppercase tracking-wider ${!mobileVisibleDays.includes(day) ? 'is-mobile-day-hidden' : ''}`}>
                      <div className="flex flex-col items-center justify-center">
                        <span>{day}</span>
                        <span className="text-[10px] text-zinc-500 font-normal mt-0.5">{currentWeekDates[day]?.display}</span>
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {scheduleConfig.workingHours.map(hour => (
                  <tr key={hour} className="group">
                    <td className="border-b border-r border-zinc-800 p-2 text-center font-mono font-bold bg-zinc-900/80 text-zinc-500 group-hover:text-pink-400 transition-colors sticky left-0 z-20 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.5)]">
                      {hour}:00
                    </td>
                    {scheduleConfig.workingDays.map(day => {
                      const slotId = `${day}-${hour}`;
                      const slotEntries = schedule[slotId] || [];
                      const trainerEntries = slotEntries.filter(e => e.trainerId === selectedTrainerId);
                      const isOff = trainerEntries.some(e => e.type === 'off');
                      
                      const studentIds = trainerEntries.filter(e => e.type !== 'off').map(e => e.studentId);
                      
                      const isHighlighted = highlightedStudentId && studentIds.includes(highlightedStudentId);
                      const isDimmed = highlightedStudentId && !studentIds.includes(highlightedStudentId);
                      const isHoveredStudentAvailable = hoveredStudentId && students.find(s => s.id === hoveredStudentId)?.availableSlots?.includes(slotId);
                      
                      return (
                        <td 
                          key={slotId}
                          onClick={() => openSlotEditor(day, hour)}
                          className={`border-b border-r border-zinc-800/50 p-1 md:p-1.5 text-center transition-all duration-300 align-top relative ${!currentTrainerId ? 'cursor-pointer' : ''} ${
                            !mobileVisibleDays.includes(day) ? 'is-mobile-day-hidden' : ''
                          } ${
                            isOff
                              ? 'bg-zinc-950 text-zinc-600'
                              : isHighlighted
                                ? 'bg-pink-500/10 shadow-[inset_0_0_20px_rgba(236,72,153,0.1)] border-pink-500/30'
                                : isHoveredStudentAvailable
                                  ? 'bg-emerald-500/20 shadow-[inset_0_0_15px_rgba(16,185,129,0.1)] border-emerald-500/30'
                                  : studentIds.length > 0 
                                    ? isDimmed ? 'bg-zinc-950 opacity-30' : 'bg-zinc-900/30 hover:bg-zinc-800/50' 
                                    : 'bg-transparent text-zinc-800 hover:bg-zinc-900/30'
                          }`}
                        >
                          {isOff ? (
                            <div className="h-full w-full flex items-center justify-center font-bold text-xs">NGHỈ</div>
                          ) : studentIds.length > 0 ? (
                            <div className="flex flex-col gap-1 h-full justify-start">
                              {studentIds.map(id => {
                                const isLocked = trainerEntries.find(e => e.studentId === id)?.isLocked;
                                return (
                                  <motion.button 
                                    whileHover={{ scale: 1.02, y: -1 }}
                                    whileTap={{ scale: 0.98 }}
                                    key={id} 
                                    onMouseEnter={() => setHoveredStudentId(id)}
                                    onMouseLeave={() => setHoveredStudentId(null)}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setHighlightedStudentId(id === highlightedStudentId ? null : id);
                                    }}
                                    className={`w-full truncate text-xs md:text-sm font-bold rounded-lg px-2 py-1.5 border text-left transition-all shadow-sm flex items-center justify-between ${
                                      highlightedStudentId === id
                                        ? 'bg-pink-500 text-white border-pink-400 shadow-[0_4px_15px_rgba(236,72,153,0.4)]'
                                        : 'text-zinc-300 bg-zinc-800 border-zinc-700 hover:border-pink-500/50 hover:text-pink-400'
                                    }`}
                                  >
                                    <div className="flex items-center gap-1.5 overflow-hidden">
                                      <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${highlightedStudentId === id ? 'bg-white shadow-[0_0_5px_rgba(255,255,255,0.8)]' : 'bg-pink-500'}`} />
                                      <span className="truncate">{getStudentName(id)}</span>
                                    </div>
                                    {isLocked && <Lock className="w-3 h-3 shrink-0 opacity-50" />}
                                  </motion.button>
                                );
                              })}
                            </div>
                          ) : (
                            <div className="h-full w-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                              <span className="text-zinc-700 text-xs font-bold">+</span>
                            </div>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
      
      {/* Legend */}
      <div className="pt-schedule-matrix__legend mt-4 mx-4 md:mx-0 flex flex-wrap gap-4 text-xs md:text-sm font-medium bg-zinc-950 p-3 md:p-4 rounded-xl border border-zinc-800">
        <div className="flex items-center gap-2 md:gap-3">
          <div className="w-5 h-5 bg-zinc-800 border border-zinc-700 rounded-md flex items-center justify-center shadow-sm">
             <div className="w-1.5 h-1.5 rounded-full bg-pink-500" />
          </div>
          <span className="text-zinc-300">Đã xếp lịch <span className="text-zinc-500 font-normal">(Tối đa 2 HV/Slot)</span></span>
        </div>
        <div className="flex items-center gap-3">
          <div className="w-5 h-5 bg-zinc-950 border border-zinc-800 rounded-md border-dashed"></div>
          <span className="text-zinc-500">Slot trống</span>
        </div>
        <div className="flex items-center gap-2">
          <Lock className="w-4 h-4 text-zinc-500" />
          <span className="text-zinc-500">Đã khóa (không bị xếp lại)</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-5 h-5 bg-emerald-500/20 border border-emerald-500/30 rounded-md"></div>
          <span className="text-zinc-500">Giờ rảnh của học viên (khi rê chuột)</span>
        </div>
      </div>

      {/* Manual Schedule Modal */}
      <AnimatePresence>
        {editingSlot && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl w-full max-w-md overflow-hidden"
            >
              <div className="p-4 border-b border-zinc-800 flex justify-between items-center bg-zinc-950">
                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                  <Calendar className="w-5 h-5 text-pink-500" />
                  Xếp lịch thủ công
                </h3>
                <button onClick={() => setEditingSlot(null)} className="text-zinc-400 hover:text-white transition-colors">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="p-6 space-y-6">
                <div className="flex justify-between items-center bg-zinc-800/50 p-3 rounded-xl border border-zinc-700/50">
                  <div className="text-zinc-300">
                    <span className="block text-xs text-zinc-500 mb-1">Thời gian</span>
                    <span className="font-bold">{editingSlot.day} - {editingSlot.hour}:00</span>
                  </div>
                  <div className="text-right text-zinc-300">
                    <span className="block text-xs text-zinc-500 mb-1">Huấn luyện viên</span>
                    <span className="font-bold">{trainers.find(t => t.id === selectedTrainerId)?.name}</span>
                  </div>
                </div>

                <div className="space-y-3">
                  <label className="block text-sm font-medium text-zinc-400">Học viên trong ca (Tối đa 2)</label>
                  {slotStudents.length === 0 ? (
                    <div className="text-center py-4 text-zinc-500 text-sm border border-dashed border-zinc-700 rounded-xl">
                      Chưa có học viên nào
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {slotStudents.map((s) => (
                        <div key={s.id} className="flex items-center justify-between bg-zinc-800 p-3 rounded-xl border border-zinc-700">
                          <span className="font-medium text-zinc-200">{getStudentName(s.id)}</span>
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => handleToggleLock(s.id)}
                              className={`p-1.5 rounded-lg transition-colors ${s.isLocked ? 'bg-pink-500/20 text-pink-400' : 'bg-zinc-700 text-zinc-400 hover:text-white'}`}
                              title={s.isLocked ? "Đã khóa (không bị ghi đè)" : "Mở khóa (có thể bị ghi đè)"}
                            >
                              {s.isLocked ? <Lock className="w-4 h-4" /> : <Unlock className="w-4 h-4" />}
                            </button>
                            <button
                              onClick={() => handleRemoveStudentFromSlot(s.id)}
                              className="p-1.5 bg-red-500/10 text-red-400 rounded-lg hover:bg-red-500/20 transition-colors"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  <button 
                    onClick={handleToggleOff}
                    className={`w-full py-2 rounded-xl font-medium transition-colors flex items-center justify-center gap-2 ${
                      schedule[editingSlot.id]?.some(e => e.trainerId === selectedTrainerId && e.type === 'off')
                        ? 'bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30'
                        : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'
                    }`}
                  >
                    <Lock className="w-4 h-4" />
                    {schedule[editingSlot.id]?.some(e => e.trainerId === selectedTrainerId && e.type === 'off') ? 'Mở ca' : 'Khóa ca (Nghỉ)'}
                  </button>
                </div>

                {slotStudents.length < selectedTrainerCapacity && (
                  <div className="space-y-3">
                    <label className="block text-sm font-medium text-zinc-400">Thêm học viên</label>
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                      <input
                        type="text"
                        placeholder="Tìm kiếm tên hoặc SĐT..."
                        value={studentSearchTerm}
                        onChange={(e) => setStudentSearchTerm(e.target.value)}
                        className="w-full bg-zinc-950 border border-zinc-800 text-white pl-10 pr-4 py-2 rounded-xl outline-none focus:border-pink-500"
                      />
                    </div>
                    
                    <div className="bg-zinc-950 border border-zinc-800 rounded-xl max-h-48 overflow-y-auto custom-scrollbar">
                      {activeStudents
                        .filter(s => !slotStudents.some(ss => ss.id === s.id))
                        .filter(s => 
                          !studentSearchTerm || 
                          s.name.toLowerCase().includes(studentSearchTerm.toLowerCase()) || 
                          (s.phone && s.phone.includes(studentSearchTerm))
                        )
                        .map(s => (
                          <div 
                            key={s.id} 
                            onMouseEnter={() => setHoveredStudentId(s.id)}
                            onMouseLeave={() => setHoveredStudentId(null)}
                            className="flex items-center justify-between p-3 hover:bg-zinc-800 border-b border-zinc-800/50 last:border-0 transition-colors"
                          >
                            <div>
                              <div className="font-medium text-zinc-200">{s.name}</div>
                              {s.phone && <div className="text-xs text-zinc-500">{s.phone}</div>}
                            </div>
                            <button
                              onClick={() => {
                                setSlotStudents([...slotStudents, { id: s.id, isLocked: true }]);
                                setStudentSearchTerm('');
                              }}
                              className="p-1.5 bg-pink-500/10 text-pink-500 rounded-lg hover:bg-pink-500 hover:text-white transition-colors"
                            >
                              <Plus className="w-4 h-4" />
                            </button>
                          </div>
                        ))
                      }
                      {activeStudents.filter(s => !slotStudents.some(ss => ss.id === s.id)).filter(s => !studentSearchTerm || s.name.toLowerCase().includes(studentSearchTerm.toLowerCase()) || (s.phone && s.phone.includes(studentSearchTerm))).length === 0 && (
                        <div className="p-4 text-center text-zinc-500 text-sm">
                          Không tìm thấy học viên
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              <div className="p-4 border-t border-zinc-800 bg-zinc-950 flex justify-end gap-3">
                <button
                  onClick={() => setEditingSlot(null)}
                  className="px-4 py-2 text-zinc-400 hover:text-white font-medium transition-colors"
                >
                  Hủy
                </button>
                <button
                  onClick={handleSaveSlot}
                  className="px-6 py-2 bg-pink-600 hover:bg-pink-500 text-white font-bold rounded-xl transition-colors shadow-lg shadow-pink-500/20"
                >
                  Lưu thay đổi
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
