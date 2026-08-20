import React, { useState, useMemo, useEffect } from 'react';
import { User as FirebaseUser } from 'firebase/auth';
import { Trainer, Session, Payroll, Branch, UserProfile, Student, HOURS } from '../../../types';
import { CheckCircle, XCircle, DollarSign, Calendar, RotateCcw, User as UserIcon, Clock, Filter, Edit2, Lock, Send, WalletCards } from 'lucide-react';
import DateRangeFilter from './DateRangeFilter';
import { LOGO_URL } from '../../../constants';
import { useDatabase } from '../../../contexts/DatabaseContext';
import { OrphanedSessionChecker } from './OrphanedSessionChecker';
import { cancelSession, confirmSessionAttendance, rescheduleSession, swapSessions } from '../../../services/sessionOperationsService';
import { createPayrollRun, listPayrollRuns, lockPayrollRun, markPayrollRunPaid, reviewPayrollRun, type PayrollRunSummary } from '../../../services/payrollService';

interface Props {
  user: FirebaseUser | null;
  profile: UserProfile | null;
}

export default function TrainerPayroll({ user, profile }: Props) {
  const { trainers, sessions, students, branches, contracts, scheduleConfig } = useDatabase();
  const [selectedTrainerId, setSelectedTrainerId] = useState<string>('all');
  const [selectedDay, setSelectedDay] = useState<number | 'all'>('all');
  const [sessionSearch, setSessionSearch] = useState('');
  const [dateRange, setDateRange] = useState<{ start: Date, end: Date } | null>(null);
  const [payrollRuns, setPayrollRuns] = useState<PayrollRunSummary[]>([]);
  const [payrollLoading, setPayrollLoading] = useState(false);
  const [payrollMessage, setPayrollMessage] = useState<string | null>(null);
  const [payrollPeriod, setPayrollPeriod] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });
  
  const isPTUser = profile?.role === 'trainer' || profile?.role === 'coach';
  const currentTrainer = useMemo(() => {
    return trainers.find(t => t.email?.toLowerCase() === user?.email?.toLowerCase());
  }, [trainers, user]);

  useEffect(() => {
    if (isPTUser && currentTrainer) {
      setSelectedTrainerId(currentTrainer.id);
    }
  }, [isPTUser, currentTrainer]);

  const refreshPayrollRuns = async () => {
    if (isPTUser) return;
    setPayrollLoading(true);
    try {
      setPayrollRuns(await listPayrollRuns());
    } catch (cause) {
      setPayrollMessage(cause instanceof Error ? cause.message : 'Không thể tải các kỳ lương chính thức.');
    } finally {
      setPayrollLoading(false);
    }
  };

  useEffect(() => { void refreshPayrollRuns(); }, [isPTUser]);

  const runPayrollAction = async (action: 'create' | 'review' | 'lock' | 'paid', run?: PayrollRunSummary) => {
    setPayrollLoading(true);
    setPayrollMessage(null);
    try {
      if (action === 'create') await createPayrollRun(payrollPeriod);
      else if (action === 'review' && run) await reviewPayrollRun(run.id);
      else if (action === 'lock' && run) await lockPayrollRun(run.id);
      else if (action === 'paid' && run) {
        const reference = window.prompt('Nhập mã tham chiếu chuyển khoản/chứng từ trả lương:')?.trim();
        if (!reference) return;
        await markPayrollRunPaid(run.id, reference);
      }
      await refreshPayrollRuns();
      setPayrollMessage('Đã cập nhật kỳ lương chính thức.');
    } catch (cause) {
      setPayrollMessage(cause instanceof Error ? cause.message : 'Không thể cập nhật kỳ lương.');
    } finally {
      setPayrollLoading(false);
    }
  };

  // Edit Session State
  const [editingSession, setEditingSession] = useState<Session | null>(null);
  const [editFormData, setEditFormData] = useState({ date: '', hour: 0, trainerId: '' });

  const handleUpdateStatus = async (session: Session, status: 'completed' | 'cancelled' | 'scheduled' | 'canceled_by_student') => {
    if (!user) return;
    try {
      const revision = Number((session as Session & { revision?: number }).revision || 0);
      if (status === 'completed') await confirmSessionAttendance(session.id, revision);
      else if (status === 'cancelled' || status === 'canceled_by_student') await cancelSession({ sessionId: session.id, expectedRevision: revision, type: status === 'cancelled' ? 'trainer_cancelled' : 'student_cancelled', reason: 'Cập nhật từ quản trị lương' });
      else alert('Khôi phục buổi đã hủy cần quy trình correction; thao tác trực tiếp đã bị khóa.');
    } catch (e) {
      alert((e as Error).message);
    }
  };

  const markSession = async (sessionId: string, status: 'completed' | 'cancelled' | 'scheduled' | 'canceled_by_student') => {
    const session = sessions.find(s => s.id === sessionId);
    if (session) {
      await handleUpdateStatus(session, status);
    }
  };

  const handleDeleteSession = async (sessionId: string) => {
    const session = sessions.find(s => s.id === sessionId);
    if (!user || !session || !confirm('Buổi tập sẽ được đánh dấu hủy và vẫn giữ lịch sử. Tiếp tục?')) return;
    try { await cancelSession({ sessionId, expectedRevision: Number((session as Session & { revision?: number }).revision || 0), type: 'trainer_cancelled', reason: 'Hủy từ quản trị lương' }); }
    catch (e) { alert((e as Error).message); }
  };

  const handleEditSession = (session: Session) => {
    const hour = Number.isInteger(session.hour) ? Number(session.hour) : parseInt(session.id.split('-')[1]) || 6;
    setEditFormData({
      date: session.date,
      hour: hour,
      trainerId: session.trainerId
    });
    setEditingSession(session);
  };

  const saveEditedSession = async () => {
    if (!user || !editingSession) return;
    try {
      await rescheduleSession({ sessionId: editingSession.id, expectedRevision: Number((editingSession as Session & { revision?: number }).revision || 0), newDate: editFormData.date, newHour: editFormData.hour, trainerId: editFormData.trainerId });
      setEditingSession(null);
    } catch (e) {
      alert('Lỗi khi lưu: ' + (e as Error).message);
    }
  };

  const availableHours = useMemo(() => {
    if (!editFormData.date || !editFormData.trainerId) return scheduleConfig.workingHours.map(h => ({ hour: h, count: 0, sessions: [] as Session[] }));
    return scheduleConfig.workingHours.map(h => {
      const hourSessions = sessions.filter(s => 
        s.trainerId === editFormData.trainerId && 
        s.date.slice(0, 10) === editFormData.date.slice(0, 10) &&
        (Number.isInteger(s.hour) ? Number(s.hour) : parseInt(s.id.split('-')[1])) === h &&
        (s.status === 'scheduled' || s.status === 'rescheduled') &&
        s.id !== editingSession?.id
      );
      return { hour: h, count: hourSessions.length, sessions: hourSessions };
    });
  }, [editFormData.date, editFormData.trainerId, sessions, editingSession]);

  useEffect(() => {
    if (editingSession && availableHours.length > 0) {
      const currentHourObj = availableHours.find(h => h.hour === editFormData.hour);
      if (!currentHourObj) {
        setEditFormData(prev => ({ ...prev, hour: availableHours[0].hour }));
      }
    }
  }, [availableHours, editingSession]);

  const swapSuggestions = useMemo(() => {
    if (!editingSession || !editFormData.date || !editFormData.trainerId) return [];
    
    const selectedHourObj = availableHours.find(h => h.hour === editFormData.hour);
    if (!selectedHourObj || selectedHourObj.count < 2) return [];

    const sourceDateObj = new Date(editingSession.date);
    const sourceDayOfWeek = sourceDateObj.getDay();
    const sourceDayCode = sourceDayOfWeek === 0 ? 'CN' : `T${sourceDayOfWeek + 1}`;
    const sourceHour = parseInt(editingSession.id.split('-')[1]) || 6;
    const sourceSlotString = `${sourceDayCode}-${sourceHour}`;

    const suggestions: { sessionB: Session, studentB: Student }[] = [];

    selectedHourObj.sessions.forEach(sessionB => {
      if (sessionB.status !== 'scheduled' && sessionB.status !== 'rescheduled') return;
      const studentB = students.find(s => s.id === sessionB.studentId);
      if (studentB && studentB.availableSlots.includes(sourceSlotString)) {
        suggestions.push({ sessionB, studentB });
      }
    });

    return suggestions;
  }, [editingSession, editFormData, availableHours, students]);

  const handleSwapSession = async (sessionB: Session) => {
    if (!user || !editingSession) return;
    try {
      await swapSessions({ firstSessionId: editingSession.id, secondSessionId: sessionB.id, firstExpectedRevision: Number((editingSession as Session & { revision?: number }).revision || 0), secondExpectedRevision: Number((sessionB as Session & { revision?: number }).revision || 0) });
      setEditingSession(null);
      alert('Đổi chéo thành công!');
    } catch (e) {
      alert('Lỗi khi đổi chéo: ' + (e as Error).message);
    }
  };

  const filteredSessions = sessions.filter(s => {
    // Learner cancellations are shown separately as make-up sessions.
    if (s.status === 'canceled_by_student' || s.status === 'student_cancelled') return false;

    // Filter by PT subtab
    if (selectedTrainerId !== 'all' && s.trainerId !== selectedTrainerId) return false;

    // Filter by search
    if (sessionSearch) {
      const student = students.find(st => st.id === s.studentId);
      const trainer = trainers.find(t => t.id === s.trainerId);
      const match = student?.name.toLowerCase().includes(sessionSearch.toLowerCase()) ||
                    trainer?.name.toLowerCase().includes(sessionSearch.toLowerCase());
      if (!match) return false;
    }

    // Filter by date range
    if (dateRange) {
      const sessionDate = new Date(s.date);
      if (sessionDate < dateRange.start || sessionDate > dateRange.end) return false;
    }

    // Filter by day
    if (selectedDay !== 'all') {
      const sessionDate = new Date(s.date);
      const dayOfWeek = sessionDate.getDay();
      // getDay() returns 0 for Sunday, 1 for Monday, ..., 6 for Saturday
      // User wants T2-T7, so Monday=1, ..., Saturday=6
      if (dayOfWeek !== selectedDay) return false;
    }

    return true;
  });

  const handleAutoConfirm = async () => {
    alert('Tự động xác nhận toàn hệ thống đã được khóa. Hãy xác nhận từng buổi qua transaction hoặc dùng scheduler backend sau khi được nghiệm thu.');
  };

  const groupedSessions = React.useMemo(() => {
    const groups: Record<string, Session[]> = {};
    filteredSessions.forEach(s => {
      if (!groups[s.date]) {
        groups[s.date] = [];
      }
      groups[s.date].push(s);
    });
    
    const sortedDates = Object.keys(groups).sort((a, b) => (new Date(b).getTime() || 0) - (new Date(a).getTime() || 0));
    
    return sortedDates.map(date => ({
      date,
      sessions: groups[date].sort((a, b) => {
        const hourA = Number.isInteger(a.hour) ? Number(a.hour) : parseInt(a.id.split('-')[1]) || 0;
        const hourB = Number.isInteger(b.hour) ? Number(b.hour) : parseInt(b.id.split('-')[1]) || 0;
        return hourA - hourB;
      })
    }));
  }, [filteredSessions]);

  const canceledSessions = sessions.filter(s => s.status === 'canceled_by_student' || s.status === 'student_cancelled');

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-300">
      <OrphanedSessionChecker />
      <div className="mb-8 flex items-center gap-3">
        <img src={LOGO_URL} alt="Aura" className="h-10 w-10 object-contain" />
        <div>
          <h1 className="text-3xl md:text-4xl font-serif font-medium text-pink-500 drop-shadow-[0_0_10px_rgba(236,72,153,0.8)] tracking-tight border-b-4 border-pink-500/30 pb-2 inline-block shadow-[0_6px_0_rgba(236,72,153,0.2)] rounded-2xl">
            Lương PT
          </h1>
          <p className="text-zinc-400 mt-2">Quản lý lịch dạy và chấm công</p>
        </div>
      </div>

      {!isPTUser && (
        <section className="bg-zinc-900 p-5 md:p-6 rounded-2xl border border-zinc-800" aria-label="Kỳ lương chính thức">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-widest text-pink-500">Sổ lương canonical</p>
              <h2 className="text-xl font-bold text-white mt-1">Kỳ lương chính thức</h2>
              <p className="text-sm text-zinc-400 mt-1">Tính từ attendance events; kỳ đã khóa không thay đổi theo dữ liệu client.</p>
            </div>
            <div className="flex flex-col sm:flex-row gap-2">
              <input type="month" value={payrollPeriod} onChange={(event) => setPayrollPeriod(event.target.value)} className="bg-zinc-950 border border-zinc-800 text-white px-3 py-2.5 rounded-xl" />
              <button type="button" disabled={payrollLoading || !payrollPeriod} onClick={() => void runPayrollAction('create')} className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-pink-500 to-orange-500 text-white font-bold disabled:opacity-50">
                Tạo kỳ lương
              </button>
            </div>
          </div>
          {payrollMessage && <p className="mt-3 rounded-xl border border-pink-500/20 bg-pink-500/10 px-3 py-2 text-sm text-zinc-200" role="status">{payrollMessage}</p>}
          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            {payrollRuns.map((run) => (
              <article key={run.id} className="rounded-2xl border border-zinc-800 bg-zinc-950/50 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div><strong className="text-white">Kỳ {run.periodId}</strong><p className="text-xs text-zinc-500 mt-1">Policy v{run.policyVersion} · {run.attendanceCount} lượt điểm danh · {run.trainerCount} PT</p></div>
                  <span className="rounded-full bg-pink-500/10 px-2.5 py-1 text-[11px] font-bold uppercase text-pink-400">{run.status}</span>
                </div>
                <div className="mt-3 flex items-end justify-between gap-3"><span className="text-xs text-zinc-500">Tổng chính thức</span><strong className="text-lg text-emerald-400">{run.finalAmount.toLocaleString('vi-VN')}đ</strong></div>
                <div className="mt-3 flex flex-wrap justify-end gap-2">
                  {run.status === 'draft' && <button type="button" disabled={payrollLoading} onClick={() => void runPayrollAction('review', run)} className="px-3 py-2 rounded-lg bg-zinc-800 text-zinc-200 text-xs font-bold flex items-center gap-1"><Send size={14} /> Gửi duyệt</button>}
                  {run.status === 'reviewed' && <button type="button" disabled={payrollLoading} onClick={() => void runPayrollAction('lock', run)} className="px-3 py-2 rounded-lg bg-orange-500 text-white text-xs font-bold flex items-center gap-1"><Lock size={14} /> Khóa kỳ</button>}
                  {run.status === 'locked' && <button type="button" disabled={payrollLoading} onClick={() => void runPayrollAction('paid', run)} className="px-3 py-2 rounded-lg bg-emerald-600 text-white text-xs font-bold flex items-center gap-1"><WalletCards size={14} /> Đã chi trả</button>}
                </div>
              </article>
            ))}
            {!payrollLoading && payrollRuns.length === 0 && <div className="rounded-2xl border border-dashed border-zinc-800 p-5 text-sm text-zinc-500">Chưa có kỳ lương canonical. Dữ liệu ước tính phía dưới chỉ dùng để đối chiếu.</div>}
          </div>
        </section>
      )}

      <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4">
        <div className="flex flex-wrap gap-2 w-full lg:w-auto">
          <div className="relative flex-1 min-w-[200px]">
            <UserIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
            <input 
              type="text"
              placeholder="Tìm tên HV hoặc PT..."
              value={sessionSearch}
              onChange={(e) => setSessionSearch(e.target.value)}
              className="w-full bg-zinc-900 border border-zinc-800 text-white pl-10 pr-4 py-2 rounded-xl text-sm focus:outline-none focus:border-pink-500"
            />
          </div>
          <DateRangeFilter onFilter={(start, end) => setDateRange({ start, end })} />
        </div>
      </div>

      {/* PT Subtabs */}
      {!isPTUser && (
      <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
        <button
          onClick={() => setSelectedTrainerId('all')}
          className={`px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-wider transition-all border ${
            selectedTrainerId === 'all' 
              ? 'bg-pink-500 text-white border-pink-500 shadow-[0_0_15px_rgba(255,0,127,0.3)]' 
              : 'bg-zinc-900 text-zinc-500 border-zinc-800 hover:text-zinc-300'
          }`}
        >
          Tất cả PT
        </button>
        {trainers.filter(t => t.status === 'active').map(t => (
          <button
            key={t.id}
            onClick={() => setSelectedTrainerId(t.id)}
            className={`px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-wider whitespace-nowrap transition-all border ${
              selectedTrainerId === t.id 
                ? 'bg-pink-500 text-white border-pink-500 shadow-[0_0_15px_rgba(255,0,127,0.3)]' 
                : 'bg-zinc-900 text-zinc-500 border-zinc-800 hover:text-zinc-300'
            }`}
          >
            {t.name}
          </button>
        ))}
      </div>
      )}

      {/* Day Subtabs */}
      <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
        <button
          onClick={() => setSelectedDay('all')}
          className={`px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-wider transition-all border ${
            selectedDay === 'all' 
              ? 'bg-pink-500 text-white border-pink-500 shadow-[0_0_15px_rgba(255,0,127,0.3)]' 
              : 'bg-zinc-900 text-zinc-500 border-zinc-800 hover:text-zinc-300'
          }`}
        >
          Tất cả
        </button>
        {[1, 2, 3, 4, 5, 6, 0].map(day => (
          <button
            key={day}
            onClick={() => setSelectedDay(day)}
            className={`px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-wider whitespace-nowrap transition-all border ${
              selectedDay === day 
                ? 'bg-pink-500 text-white border-pink-500 shadow-[0_0_15px_rgba(255,0,127,0.3)]' 
                : 'bg-zinc-900 text-zinc-500 border-zinc-800 hover:text-zinc-300'
            }`}
          >
            {day === 0 ? 'CN' : `Thứ ${day + 1}`}
          </button>
        ))}
      </div>
      
      {/* Các buổi cần học bù */}
      {canceledSessions.length > 0 && (
        <div className="bg-orange-950/30 border border-orange-500/30 p-6 rounded-2xl">
          <h3 className="text-lg font-bold text-orange-500 mb-4 flex items-center gap-2">
            <Clock className="w-5 h-5" />
            Các buổi cần học bù ({canceledSessions.length})
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {canceledSessions.map((s, idx) => {
              const student = students.find(st => st.id === s.studentId);
              const trainer = trainers.find(t => t.id === s.trainerId);
              const dateObj = new Date(s.date);
              const isValidDate = s.date && !isNaN(dateObj.getTime());
              
              return (
                <div key={`cancelled-${s.id}-${idx}`} className="p-4 bg-zinc-900 rounded-xl border border-orange-500/20 flex flex-col gap-3">
                  <div className="flex justify-between items-start">
                    <div className="flex items-center gap-2 text-zinc-200 font-medium">
                      <UserIcon className="w-4 h-4 text-orange-500" />
                      {student?.name || 'Học viên ẩn'}
                    </div>
                    <span className="text-xs bg-orange-500/20 text-orange-400 px-2 py-1 rounded-md font-bold">
                      Chờ xếp lịch
                    </span>
                  </div>
                  <div className="text-sm text-zinc-400">
                    <p>PT cũ: <span className="text-zinc-300">{trainer?.name}</span></p>
                    <p>Lịch cũ: {isValidDate ? dateObj.toLocaleDateString('vi-VN') : 'N/A'} - {s.id.split('-')[1]}h</p>
                  </div>
                  <div className="flex justify-end gap-2 mt-2">
                    <button onClick={() => markSession(s.id, 'cancelled')} className="px-3 py-1.5 bg-red-600 hover:bg-red-500 text-white text-sm rounded-lg transition-colors flex items-center gap-1">
                      <XCircle className="w-4 h-4" />
                      Hủy
                    </button>
                    <button onClick={() => handleEditSession(s)} className="px-3 py-1.5 bg-orange-600 hover:bg-orange-500 text-white text-sm rounded-lg transition-colors flex items-center gap-1">
                      <Calendar className="w-4 h-4" />
                      Xếp lịch bù
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="flex flex-col gap-6">
        {/* Lịch dạy */}
        <div className="order-2 bg-zinc-900 p-6 rounded-2xl border border-zinc-800">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-lg font-bold text-white flex items-center gap-2">
              <Calendar className="w-5 h-5 text-pink-500" />
              Lịch dạy ({Array.from(new Set(filteredSessions.map(s => `${s.date}-${s.id.split('-')[1]}`))).length} ca)
            </h3>
            <button
              onClick={handleAutoConfirm}
              className="px-3 py-1.5 bg-green-600 hover:bg-green-500 text-white text-sm rounded-lg transition-colors flex items-center gap-1"
            >
              <CheckCircle className="w-4 h-4" />
              Chốt ca tự động
            </button>
          </div>
          <div className="space-y-6">
            {groupedSessions.map(group => {
              const dateObj = new Date(group.date);
              const isValidDate = group.date && !isNaN(dateObj.getTime());
              const dayOfWeek = isValidDate ? dateObj.getDay() : 0;
              const dayName = isValidDate ? (dayOfWeek === 0 ? 'Chủ Nhật' : `Thứ ${dayOfWeek + 1}`) : 'Unknown';
              
              return (
                <div key={group.date} className="space-y-3">
                  <div className="flex items-center gap-2 pb-2 border-b border-zinc-800">
                    <Calendar className="w-4 h-4 text-pink-500" />
                    <h4 className="font-bold text-white">{dayName}, {isValidDate ? dateObj.toLocaleDateString('vi-VN') : 'N/A'}</h4>
                    <span className="text-xs text-zinc-500 bg-zinc-800 px-2 py-0.5 rounded-full">{new Set(group.sessions.map(s => parseInt(s.id.split('-')[1]) || 0)).size} ca</span>
                  </div>
                  
                  <div className="grid grid-cols-1 gap-3">
                    {group.sessions.map((s, idx) => {
                      const student = students.find(st => st.id === s.studentId);
                      const trainer = trainers.find(t => t.id === s.trainerId);
                      const branch = branches.find(b => b.id === s.branchId);
                      const hour = Number.isInteger(s.hour) ? Number(s.hour) : s.id.split('-')[1];
                      const isTrainerCancelled = s.status === 'cancelled' || s.status === 'trainer_cancelled';
                      const isStudentCancelled = s.status === 'canceled_by_student' || s.status === 'student_cancelled';

                      return (
                        <div key={`group-${s.id}-${idx}`} className="p-3 bg-zinc-950 rounded-xl border border-zinc-800 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                          <div className="flex items-start gap-3">
                            <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-2 text-center min-w-[60px]">
                              <span className="block text-xs text-zinc-500 uppercase">Ca</span>
                              <span className="block text-lg font-black text-pink-500">{hour}h</span>
                            </div>
                            <div className="space-y-1">
                              <div className="flex items-center gap-2 text-zinc-200 font-medium">
                                <UserIcon className="w-4 h-4 text-pink-500" />
                                {student?.name || 'Học viên ẩn (Đã xóa)'}
                              </div>
                              <p className="text-zinc-500 text-xs flex items-center gap-1">
                                PT: <span className="text-zinc-400">{trainer?.name}</span> • {branch?.name || 'N/A'}
                              </p>
                              <div className="flex items-center gap-2 mt-1">
                                <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${s.status === 'completed' ? 'bg-green-900/50 text-green-400 border border-green-500/20' : isTrainerCancelled ? 'bg-red-900/50 text-red-400 border border-red-500/20' : isStudentCancelled ? 'bg-orange-900/50 text-orange-400 border border-orange-500/20' : 'bg-zinc-800 text-zinc-400'}`}>
                                  {s.status === 'completed' ? 'Đã dạy' : isTrainerCancelled ? 'Đã hủy' : isStudentCancelled ? 'HV báo nghỉ' : 'Chưa dạy'}
                                </span>
                                {s.status === 'completed' && (
                                  <span className={`text-[9px] font-bold uppercase tracking-tight text-emerald-500`}>
                                    ✓ Đã ghi nhận
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                          
                          <div className="flex gap-1 w-full sm:w-auto justify-end border-t sm:border-t-0 border-zinc-800 pt-3 sm:pt-0 mt-1 sm:mt-0">
                            {s.status === 'scheduled' || s.status === 'rescheduled' ? (
                              <>
                                <button onClick={() => markSession(s.id, 'completed')} className="p-2 text-green-400 hover:text-green-300 bg-green-500/10 rounded-lg transition-colors" title="Hoàn thành"><CheckCircle className="w-4 h-4" /></button>
                                <button onClick={() => markSession(s.id, 'canceled_by_student')} className="p-2 text-orange-400 hover:text-orange-300 bg-orange-500/10 rounded-lg transition-colors" title="HV Báo nghỉ (Học bù)"><XCircle className="w-4 h-4" /></button>
                                <button onClick={() => markSession(s.id, 'cancelled')} className="p-2 text-red-400 hover:text-red-300 bg-red-500/10 rounded-lg transition-colors" title="Hủy buổi (Bảo lưu)"><XCircle className="w-4 h-4" /></button>
                                <button onClick={() => handleEditSession(s)} className="p-2 text-blue-400 hover:text-blue-300 bg-blue-500/10 rounded-lg transition-colors" title="Đổi lịch/Đổi PT"><Edit2 className="w-4 h-4" /></button>
                              </>
                            ) : (
                              <button onClick={() => markSession(s.id, 'scheduled')} className="p-2 text-zinc-400 hover:text-white bg-zinc-800 rounded-lg transition-colors" title="Hoàn tác"><RotateCcw className="w-4 h-4" /></button>
                            )}
                            {!isPTUser && (
                              <button onClick={() => handleDeleteSession(s.id)} className="p-2 text-zinc-600 hover:text-red-400 transition-colors" title="Hủy và giữ lịch sử"><XCircle className="w-4 h-4" /></button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
            
            {groupedSessions.length === 0 && (
              <div className="text-center py-10 text-zinc-500">
                Không có lịch dạy nào.
              </div>
            )}
          </div>
        </div>

        {/* Chấm công & Lương */}
        <div className="order-1 bg-zinc-900 p-6 rounded-2xl border border-zinc-800">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-lg font-bold text-white flex items-center gap-2">
              <DollarSign className="w-5 h-5 text-green-500" />
              Ước tính đối soát PT
            </h3>
            <div className="text-right">
              <p className="text-[10px] text-zinc-500 uppercase tracking-wider">Ước tính · chưa khóa sổ</p>
              <p className="text-xl font-black text-white">
                {trainers
                  .filter(t => t.status === 'active' && (selectedTrainerId === 'all' || t.id === selectedTrainerId))
                  .reduce((sum, t) => {
                    const completed = sessions.filter(s => {
                      if (s.trainerId !== t.id || s.status !== 'completed') return false;
                      if (dateRange) {
                        const sDate = new Date(s.date);
                        if (sDate < dateRange.start || sDate > dateRange.end) return false;
                      }
                      return true;
                    });
                    
                    const sessionsByDate: Record<string, Session[]> = {};
                    completed.forEach(s => {
                      if (!sessionsByDate[s.date]) sessionsByDate[s.date] = [];
                      sessionsByDate[s.date].push(s);
                    });
                    
                    let sessionComm = 0;
                    Object.values(sessionsByDate).forEach(daySessions => {
                      // Get unique hours taught in this day
                      const uniqueHours = Array.from(new Set(daySessions.map(s => parseInt(s.id.split('-')[1]) || 0))).sort((a, b) => a - b);
                      
                      let count = 0;
                      uniqueHours.forEach(hour => {
                        count++;
                        if (count > 8) {
                          if (hour >= 20) sessionComm += 80000;
                          else sessionComm += 70000;
                        } else {
                          sessionComm += t.commissionPerSession || 20000;
                        }
                      });
                    });

                    const baseSalary = t.baseSalary || 0;
                    const referralContracts = contracts.filter(c => {
                      if (c.referralCode !== t.employeeCode) return false;
                      if (dateRange) {
                        const cDate = new Date(c.startDate || new Date());
                        if (cDate < dateRange.start || cDate > dateRange.end) return false;
                      }
                      return true;
                    });
                    const referralComm = referralContracts.reduce((s, c) => s + (c.referralCommission || 0), 0);
                    
                    return sum + baseSalary + sessionComm + referralComm;
                  }, 0).toLocaleString()}đ
              </p>
            </div>
          </div>
          <div className="space-y-3">
            {trainers
              .filter(t => t.status === 'active' && (selectedTrainerId === 'all' || t.id === selectedTrainerId))
              .map(t => {
                const completedSessions = sessions.filter(s => {
                  if (s.trainerId !== t.id || s.status !== 'completed') return false;
                  if (dateRange) {
                    const sDate = new Date(s.date);
                    if (sDate < dateRange.start || sDate > dateRange.end) return false;
                  }
                  return true;
                });
                
                // Group by date to calculate overtime
                const sessionsByDate: Record<string, Session[]> = {};
                completedSessions.forEach(s => {
                  if (!sessionsByDate[s.date]) sessionsByDate[s.date] = [];
                  sessionsByDate[s.date].push(s);
                });
                
                let sessionCommission = 0;
                let normalCount = 0;
                let totalNormalCommission = 0;
                let overtimeCount = 0;
                let totalOvertimeCommission = 0;
                let eveningCount = 0;
                let totalEveningCommission = 0;

                Object.values(sessionsByDate).forEach(daySessions => {
                  // Get unique hours taught in this day
                  const uniqueHours = Array.from(new Set(daySessions.map(s => parseInt(s.id.split('-')[1]) || 0))).sort((a, b) => a - b);
                  
                  let count = 0;
                  uniqueHours.forEach(hour => {
                    count++;
                    if (count > 8) {
                      if (hour >= 20) {
                        eveningCount++;
                        totalEveningCommission += 80000;
                        sessionCommission += 80000;
                      } else {
                        overtimeCount++;
                        totalOvertimeCommission += 70000;
                        sessionCommission += 70000;
                      }
                    } else {
                      normalCount++;
                      const normalPay = t.commissionPerSession || 20000;
                      totalNormalCommission += normalPay;
                      sessionCommission += normalPay;
                    }
                  });
                });
                
                const workingDays = Object.keys(sessionsByDate).length;
                const baseSalary = t.baseSalary || 0;

              // Referral commissions: find contracts where this PT's employeeCode was used
              const referralContracts = contracts.filter(c => {
                if (c.referralCode !== t.employeeCode) return false;
                if (dateRange) {
                  const cDate = new Date(c.startDate || new Date());
                  if (cDate < dateRange.start || cDate > dateRange.end) return false;
                }
                return true;
              });
              const referralCommission = referralContracts.reduce((sum, c) => sum + (c.referralCommission || 0), 0);
              
              const totalCommission = baseSalary + sessionCommission + referralCommission;

              return (
                <div key={t.id} className="p-4 bg-zinc-950/50 rounded-2xl border border-zinc-800/50 flex flex-col gap-4 hover:border-pink-500/30 transition-colors">
                  <div className="flex justify-between items-center pb-3 border-b border-zinc-800/50">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-pink-500/10 flex items-center justify-center border border-pink-500/20">
                         <UserIcon className="w-5 h-5 text-pink-500" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="text-white font-medium">{t.name}</p>
                          <span className="bg-zinc-800 text-zinc-300 px-2 py-0.5 rounded-md text-[10px] font-bold">
                            {workingDays} ngày công
                          </span>
                        </div>
                        {t.employeeCode && <p className="text-xs text-zinc-500 font-mono">{t.employeeCode}</p>}
                      </div>
                    </div>
                    <div className="text-right">
                       <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-0.5">Tổng nhận</p>
                       <p className="text-green-400 font-black text-lg">{totalCommission.toLocaleString()}đ</p>
                    </div>
                  </div>
                    
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <div className="bg-zinc-900 p-3 rounded-xl border border-zinc-800 flex flex-col">
                      <p className="text-zinc-500 text-[10px] uppercase tracking-wider mb-1">Cơ bản</p>
                      <p className="text-zinc-200 font-medium mt-auto">{baseSalary.toLocaleString()}đ</p>
                    </div>
                    <div className="bg-zinc-900 p-3 rounded-xl border border-zinc-800 flex flex-col">
                      <p className="text-zinc-500 text-[10px] uppercase tracking-wider mb-1">Giới thiệu ({referralContracts.length})</p>
                      <p className="text-zinc-200 font-medium mt-auto">{referralCommission.toLocaleString()}đ</p>
                    </div>
                    <div className="bg-zinc-900 p-3 rounded-xl border border-zinc-800 flex flex-col">
                      <p className="text-zinc-500 text-[10px] uppercase tracking-wider mb-1">Ca Thường ({normalCount})</p>
                      <p className="text-pink-400 font-medium mt-auto">{totalNormalCommission.toLocaleString()}đ</p>
                    </div>
                    <div className="bg-zinc-900 p-3 rounded-xl border border-zinc-800 flex flex-col">
                      <p className="text-zinc-500 text-[10px] uppercase tracking-wider mb-1 mt-auto">TC ({overtimeCount}) + Tối ({eveningCount})</p>
                      <p className="text-orange-400 font-medium mt-auto">{(totalOvertimeCommission + totalEveningCommission).toLocaleString()}đ</p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
      {/* Edit Session Modal */}
      {editingSession && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-zinc-900 rounded-2xl p-6 w-full max-w-md border border-zinc-800 shadow-2xl">
            <h3 className="text-xl font-bold text-white mb-6">Đổi lịch tập / Đổi PT</h3>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-zinc-400 mb-1">Ngày tập</label>
                <input
                  type="date"
                  value={editFormData.date}
                  onChange={e => setEditFormData({...editFormData, date: e.target.value})}
                  className="w-full bg-zinc-950 border border-zinc-800 text-white px-4 py-2.5 rounded-xl focus:outline-none focus:border-pink-500"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-zinc-400 mb-1">Giờ tập</label>
                <select
                  value={editFormData.hour}
                  onChange={e => setEditFormData({...editFormData, hour: parseInt(e.target.value)})}
                  className="w-full bg-zinc-950 border border-zinc-800 text-white px-4 py-2.5 rounded-xl focus:outline-none focus:border-pink-500"
                >
                  {availableHours.length > 0 ? (
                    availableHours.map(h => (
                      <option key={h.hour} value={h.hour}>
                        {h.hour}:00 {h.count >= 2 ? '(Đã đầy)' : ''}
                      </option>
                    ))
                  ) : (
                    <option value="" disabled>Không có giờ trống</option>
                  )}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-zinc-400 mb-1">Huấn luyện viên</label>
                <select
                  value={editFormData.trainerId}
                  onChange={e => setEditFormData({...editFormData, trainerId: e.target.value})}
                  disabled={isPTUser}
                  className="w-full bg-zinc-950 border border-zinc-800 text-white px-4 py-2.5 rounded-xl focus:outline-none focus:border-pink-500 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {trainers.map(t => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
              </div>
            </div>

            {availableHours.find(h => h.hour === editFormData.hour)?.count! >= 2 && (
              <div className="mt-6 p-4 bg-blue-500/10 border border-blue-500/30 rounded-xl">
                <h4 className="text-blue-400 font-medium mb-3 flex items-center gap-2">
                  <RotateCcw className="w-4 h-4" />
                  Đề xuất đổi chéo
                </h4>
                {swapSuggestions.length > 0 ? (
                  <div className="space-y-3">
                    {swapSuggestions.map((suggestion, idx) => (
                      <div key={`sugg-${idx}`} className="bg-zinc-950/50 p-3 rounded-lg border border-zinc-800/50">
                        <p className="text-sm text-zinc-300 mb-3">
                          Có thể đổi chéo: Chuyển <span className="font-bold text-white">{suggestion.studentB.name}</span> sang {parseInt(editingSession.id.split('-')[1]) || 6}h ngày {editingSession.date} (PT: {trainers.find(t => t.id === editingSession.trainerId)?.name}) và đưa <span className="font-bold text-white">{students.find(s => s.id === editingSession.studentId)?.name}</span> vào {editFormData.hour}h ngày {editFormData.date} (PT: {trainers.find(t => t.id === editFormData.trainerId)?.name}).
                        </p>
                        <button
                          onClick={() => handleSwapSession(suggestion.sessionB)}
                          className="w-full py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg transition-colors"
                        >
                          Đổi chéo với {suggestion.studentB.name}
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-zinc-400">Ca này đã đầy và không có học viên nào rảnh vào giờ hiện tại của học viên này để đổi chéo.</p>
                )}
              </div>
            )}

            <div className="flex gap-3 mt-8">
              <button
                onClick={() => setEditingSession(null)}
                className="flex-1 px-4 py-2.5 bg-zinc-800 text-white rounded-xl hover:bg-zinc-700 transition-colors font-medium"
              >
                Hủy
              </button>
              <button
                onClick={saveEditedSession}
                disabled={availableHours.find(h => h.hour === editFormData.hour)?.count! >= 2}
                className="flex-1 px-4 py-2.5 bg-pink-600 text-white rounded-xl hover:bg-pink-500 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Lưu thay đổi
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
