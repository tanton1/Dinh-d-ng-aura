import React, { useState, useMemo } from 'react';
import { UserProfile, Student, StudentContract, Session } from '../../../types';
import { User } from 'firebase/auth';
import { useDatabase } from '../../../contexts/DatabaseContext';
import { AlertCircle, Calendar, RefreshCw, AlertTriangle, TrendingUp, Search, User as UserIcon, CheckCircle, Clock } from 'lucide-react';
import { getMonthRange, isSameDayOrAfter } from '../../../utils/dateUtils';
import RenewContractModal from './RenewContractModal';
import StudentDetail from './StudentDetail';
import { LOGO_URL } from '../../../constants';

interface Props {
  user: User | null;
  profile: UserProfile | null;
  onNavigate?: (screen: string) => void;
}

export default function ContractRenewals({ user, profile, onNavigate }: Props) {
  const { students, contracts, packages, branches, trainers, sessions, addContract, updateContract } = useDatabase();

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
  const [showFilters, setShowFilters] = useState(false);
  const [filterBranch, setFilterBranch] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all'); // all, urgent, upcoming
  const [renewingStudent, setRenewingStudent] = useState<{ student: Student, contract: StudentContract } | null>(null);
  const [viewingStudent, setViewingStudent] = useState<Student | null>(null);

  const today = new Date();
  
  const { 
    expiringStats, 
    expiringList, 
    expiredList, 
    outOfSessionsList,
    potentialRevenueUrgent,
    potentialRevenueOutOfSessions,
    potentialRevenueUpcoming
  } = useMemo(() => {
    const expiring: { student: Student; contract: StudentContract, daysLeft?: number, sessionsLeft?: number }[] = [];
    const expired: { student: Student; contract: StudentContract, daysPassed?: number }[] = [];
    const outOfSessions: { student: Student; contract: StudentContract }[] = [];

    let potentialRevUrgent = 0;
    let potentialRevOutOfSessions = 0;
    let potentialRevUpcoming = 0;

    // Xem xét tất cả học viên (kể cả inactive)
    students.forEach(student => {
      // Apply filters early
      if (filterBranch !== 'all' && student.branchId !== filterBranch) return;
      
      // Lấy tất cả hợp đồng của học viên này (loại phần đã huỷ)
      const studentContracts = contracts.filter(c => c.studentId === student.id && c.status !== 'cancelled');
      if (studentContracts.length === 0) return;

      // Tìm hợp đồng mới nhất theo endDate
      const latestContract = studentContracts.reduce((prev, current) => {
        return new Date(prev.endDate) > new Date(current.endDate) ? prev : current;
      });

      const endDate = new Date(latestContract.endDate);
      const daysLeft = Math.ceil((endDate.getTime() - today.getTime()) / (1000 * 3600 * 24));
      const sessionsLeft = latestContract.totalSessions - getCalculatedUsedSessions(latestContract, sessions);

      // Nếu học viên đã có 1 hợp đồng active khác còn hạn dài (> 30 ngày và > 3 buổi) -> Bỏ qua
      const hasValidFutureContract = studentContracts.some(c => 
         c.status === 'active' && 
         Math.ceil((new Date(c.endDate).getTime() - today.getTime()) / (1000 * 3600 * 24)) > 30 &&
         (c.totalSessions - getCalculatedUsedSessions(c, sessions)) > 3
      );
      
      if (hasValidFutureContract) return;

      // Nếu hợp đồng đã hết hạn (status = expired) hoặc hết buổi hoặc hết ngày dẫu status = active
      if (latestContract.status === 'expired' || sessionsLeft <= 0 || daysLeft < 0) {
        const pkg = packages.find(p => p.id === latestContract.packageId);
        const revenue = latestContract.totalPrice || (pkg ? pkg.price : 0);

        if (sessionsLeft <= 0 && daysLeft >= 0) {
          // Hết buổi nhưng còn hạn
          outOfSessions.push({ student, contract: latestContract });
          potentialRevOutOfSessions += revenue;
        } else {
          // Đã hết hạn ngày
          expired.push({ student, contract: latestContract, daysPassed: Math.abs(daysLeft < 0 ? daysLeft : 0) });
          potentialRevUrgent += revenue;
        }
      } 
      // Nếu hợp đồng còn hạn nhưng sắp hết
      else if (latestContract.status === 'active' && (daysLeft <= 30 || sessionsLeft <= 3)) {
        expiring.push({ student, contract: latestContract, daysLeft, sessionsLeft });
        const pkg = packages.find(p => p.id === latestContract.packageId);
        if (pkg) potentialRevUpcoming += latestContract.totalPrice || pkg.price;
      }
    });

    expiring.sort((a, b) => (a.daysLeft || 0) - (b.daysLeft || 0));
    expired.sort((a, b) => (a.daysPassed || 0) - (b.daysPassed || 0));
    outOfSessions.sort((a, b) => new Date(b.contract.endDate).getTime() - new Date(a.contract.endDate).getTime());

    return {
      expiringStats: {
        total: expiring.length + expired.length + outOfSessions.length,
        expiringCount: expiring.length,
        expiredCount: expired.length,
        outOfSessionsCount: outOfSessions.length,
      },
      expiringList: expiring,
      expiredList: expired,
      outOfSessionsList: outOfSessions,
      potentialRevenueUrgent: potentialRevUrgent,
      potentialRevenueOutOfSessions: potentialRevOutOfSessions,
      potentialRevenueUpcoming: potentialRevUpcoming,
    };
  }, [students, contracts, packages, filterBranch]);

  const filteredUrgent = useMemo(() => {
    let list = expiredList;
    if (searchTerm) {
      const lower = searchTerm.toLowerCase();
      list = list.filter(item => item.student.name.toLowerCase().includes(lower) || item.student.phone?.includes(lower));
    }
    return list;
  }, [expiredList, searchTerm]);

  const filteredOutOfSessions = useMemo(() => {
    let list = outOfSessionsList;
    if (searchTerm) {
      const lower = searchTerm.toLowerCase();
      list = list.filter(item => item.student.name.toLowerCase().includes(lower) || item.student.phone?.includes(lower));
    }
    return list;
  }, [outOfSessionsList, searchTerm]);

  const filteredExpiring = useMemo(() => {
    let list = expiringList;
    if (searchTerm) {
      const lower = searchTerm.toLowerCase();
      list = list.filter(item => item.student.name.toLowerCase().includes(lower) || item.student.phone?.includes(lower));
    }
    return list;
  }, [expiringList, searchTerm]);

  if (viewingStudent) {
    return (
      <StudentDetail 
        student={viewingStudent} 
        profile={profile}
        contracts={contracts}
        packages={packages}
        trainers={trainers}
        branches={branches}
        sessions={sessions}
        onBack={() => setViewingStudent(null)}
        onSaveContract={addContract as any}
        onUpdateContract={updateContract}
      />
    );
  }

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex items-center gap-3">
        <div className="w-12 h-12 rounded-2xl bg-zinc-900 border border-zinc-800 flex items-center justify-center overflow-hidden shrink-0 shadow-lg relative">
          <img 
            src={LOGO_URL} 
            alt="Aura Logo" 
            className="w-8 h-8 object-contain"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = 'none';
              if (e.currentTarget.nextElementSibling) {
                 (e.currentTarget.nextElementSibling as HTMLElement).style.display = 'flex';
              }
            }}
          />
          <div className="hidden absolute inset-0 bg-gradient-to-br from-pink-500 to-rose-500 flex-col items-center justify-center">
            <span className="text-xl font-bold text-white">A</span>
          </div>
        </div>
        <div>
          <h1 className="text-2xl font-black text-white tracking-tight">Tái Ký Hợp Đồng</h1>
          <p className="text-sm text-zinc-400">Aura Fitness & Yoga</p>
        </div>
      </div>

      {/* Header section with Stats (Tabs) */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <button 
          onClick={() => setFilterStatus('all')}
          className={`text-left rounded-2xl p-4 transition-all border ${
            filterStatus === 'all' 
              ? 'bg-zinc-800 border-zinc-700 shadow-md ring-1 ring-zinc-700' 
              : 'bg-zinc-900 border-zinc-800 hover:bg-zinc-800/80 hover:border-zinc-700'
          }`}
        >
          <div className="flex items-start justify-between">
            <div>
              <p className={`text-xs font-medium ${filterStatus === 'all' ? 'text-zinc-300' : 'text-zinc-500'}`}>Tất cả</p>
              <h3 className="text-2xl font-black text-white mt-1">{expiringStats.total}</h3>
            </div>
            <div className={`w-10 h-10 rounded-full flex items-center justify-center transition-colors ${filterStatus === 'all' ? 'bg-pink-500/20' : 'bg-pink-500/10'}`}>
              <RefreshCw className="w-5 h-5 text-pink-500" />
            </div>
          </div>
        </button>

        <button 
          onClick={() => setFilterStatus('urgent')}
          className={`text-left rounded-2xl p-4 transition-all border ${
            filterStatus === 'urgent' 
              ? 'bg-red-950/30 border-red-500/50 shadow-[0_0_15px_rgba(239,68,68,0.1)] ring-1 ring-red-500/50' 
              : 'bg-zinc-900 border-zinc-800 hover:bg-zinc-800/80 hover:border-red-500/30'
          }`}
        >
          <div className="flex items-start justify-between">
            <div>
              <p className={`text-xs font-medium ${filterStatus === 'urgent' ? 'text-red-400' : 'text-red-500/70'}`}>Hết hạn</p>
              <h3 className="text-2xl font-black text-white mt-1">{expiringStats.expiredCount}</h3>
            </div>
            <div className={`w-10 h-10 rounded-full flex items-center justify-center transition-colors ${filterStatus === 'urgent' ? 'bg-red-500/20' : 'bg-red-500/10'}`}>
              <AlertTriangle className="w-5 h-5 text-red-500" />
            </div>
          </div>
        </button>

        <button 
          onClick={() => setFilterStatus('out_of_sessions')}
          className={`text-left rounded-2xl p-4 transition-all border ${
            filterStatus === 'out_of_sessions' 
              ? 'bg-orange-950/30 border-orange-500/50 shadow-[0_0_15px_rgba(249,115,22,0.1)] ring-1 ring-orange-500/50' 
              : 'bg-zinc-900 border-zinc-800 hover:bg-zinc-800/80 hover:border-orange-500/30'
          }`}
        >
          <div className="flex items-start justify-between">
            <div>
              <p className={`text-xs font-medium ${filterStatus === 'out_of_sessions' ? 'text-orange-400' : 'text-orange-500/70'}`}>Hết buổi</p>
              <h3 className="text-2xl font-black text-white mt-1">{expiringStats.outOfSessionsCount}</h3>
            </div>
            <div className={`w-10 h-10 rounded-full flex items-center justify-center transition-colors ${filterStatus === 'out_of_sessions' ? 'bg-orange-500/20' : 'bg-orange-500/10'}`}>
              <CheckCircle className="w-5 h-5 text-orange-500" />
            </div>
          </div>
        </button>

        <button 
          onClick={() => setFilterStatus('upcoming')}
          className={`text-left rounded-2xl p-4 transition-all border ${
            filterStatus === 'upcoming' 
              ? 'bg-amber-950/30 border-amber-500/50 shadow-[0_0_15px_rgba(245,158,11,0.1)] ring-1 ring-amber-500/50' 
              : 'bg-zinc-900 border-zinc-800 hover:bg-zinc-800/80 hover:border-amber-500/30'
          }`}
        >
          <div className="flex items-start justify-between">
            <div>
              <p className={`text-xs font-medium ${filterStatus === 'upcoming' ? 'text-amber-400' : 'text-amber-500/70'}`}>Sắp hết hạn</p>
              <h3 className="text-2xl font-black text-white mt-1">{expiringStats.expiringCount}</h3>
            </div>
            <div className={`w-10 h-10 rounded-full flex items-center justify-center transition-colors ${filterStatus === 'upcoming' ? 'bg-amber-500/20' : 'bg-amber-500/10'}`}>
              <Calendar className="w-5 h-5 text-amber-500" />
            </div>
          </div>
        </button>

        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 opacity-80 backdrop-blur-sm">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-emerald-500/70 text-xs font-medium">Doanh thu dự kiến</p>
              <h3 className="text-xl sm:text-2xl font-black text-white mt-1 line-clamp-1">
                {(filterStatus === 'all' 
                  ? potentialRevenueUrgent + potentialRevenueUpcoming + potentialRevenueOutOfSessions
                  : filterStatus === 'urgent' 
                    ? potentialRevenueUrgent 
                    : filterStatus === 'out_of_sessions'
                      ? potentialRevenueOutOfSessions
                      : potentialRevenueUpcoming).toLocaleString('vi-VN')}đ
              </h3>
            </div>
            <div className="w-10 h-10 rounded-full bg-emerald-500/10 flex items-center justify-center shrink-0">
              <TrendingUp className="w-5 h-5 text-emerald-500" />
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 lg:p-6">
        {/* Branch Tabs */}
        <div className="flex overflow-x-auto hide-scrollbar gap-2 mb-6">
          <button
            onClick={() => setFilterBranch('all')}
            className={`px-4 py-2 rounded-xl whitespace-nowrap text-sm font-medium transition-colors ${
              filterBranch === 'all'
                ? 'bg-pink-500 text-white'
                : 'bg-zinc-800 border border-zinc-700 text-zinc-400 hover:text-white'
            }`}
          >
            Tất cả chi nhánh
          </button>
          {branches?.map(branch => (
            <button
              key={branch.id}
              onClick={() => setFilterBranch(branch.id)}
              className={`px-4 py-2 rounded-xl whitespace-nowrap text-sm font-medium transition-colors ${
                filterBranch === branch.id
                  ? 'bg-pink-500 text-white'
                  : 'bg-zinc-800 border border-zinc-700 text-zinc-400 hover:text-white'
              }`}
            >
              {branch.name}
            </button>
          ))}
        </div>

        <div className="flex flex-col sm:flex-row gap-4 justify-between items-start sm:items-center border-b border-zinc-800 pb-4 mb-4">
          <div>
            <h2 className="text-xl font-bold text-white flex items-center gap-2">
              <AlertCircle className="w-5 h-5 text-pink-500" />
              Danh sách chi tiết
            </h2>
            <p className="text-sm text-zinc-400 mt-1">
              {filterStatus === 'all' && 'Hiển thị tất cả học viên sắp hoặc đã hết hạn.'}
              {filterStatus === 'urgent' && 'Các học viên ĐÃ HẾT HẠN hoặc HẾT BUỔI tập.'}
              {filterStatus === 'upcoming' && 'Các học viên sắp hết hạn (≤ 30 ngày hoặc ≤ 3 buổi).'}
            </p>
          </div>
          <div className="flex flex-col sm:flex-row gap-3 w-full sm:w-auto">
            <div className="relative w-full sm:w-56">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
              <input
                type="text"
                placeholder="Tìm tên, SĐT..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-xl pl-9 pr-4 py-2 text-sm text-white focus:outline-none focus:border-pink-500 transition-colors"
              />
            </div>
          </div>
        </div>

        <div className="space-y-6">
          {/* Section: Hết hạn */}
          {(filterStatus === 'all' || filterStatus === 'urgent') && filteredUrgent.length > 0 && (
            <div>
              <h3 className="text-sm font-bold text-red-500 mb-3 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4" />
                Hết hạn hợp đồng ({filteredUrgent.length})
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {filteredUrgent.map((item, idx) => (
                  <div key={idx} className="bg-zinc-950 border border-red-500/30 rounded-2xl p-5 flex flex-col relative overflow-hidden group hover:border-red-500/50 transition-colors">
                    {/* Background accent */}
                    <div className="absolute top-0 right-0 w-32 h-32 bg-red-500/5 rounded-full blur-2xl -mr-16 -mt-16 pointer-events-none" />
                    
                    <div className="flex items-start justify-between mb-4">
                      <div className="flex items-center gap-3">
                        <div className="w-12 h-12 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center shrink-0">
                          <UserIcon className="w-6 h-6 text-red-500" />
                        </div>
                        <div>
                          <h4 className="font-bold text-white text-lg leading-tight">{item.student.name}</h4>
                          <p className="text-zinc-500 text-xs mt-1">{item.student.phone || 'Chưa cập nhật SĐT'}</p>
                        </div>
                      </div>
                      <div className="bg-red-500/10 text-red-500 px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider">
                        Đã hết hạn
                      </div>
                    </div>

                    <div className="bg-zinc-900/50 rounded-xl p-3 mb-4 flex-1">
                      <div className="flex justify-between items-center mb-1">
                        <span className="text-xs text-zinc-400">Gói tập</span>
                        <span className="text-xs font-semibold text-white">{item.contract.packageName}</span>
                      </div>
                      <div className="w-full h-px bg-zinc-800 my-2" />
                      <div className="space-y-1.5">
                        <div className="flex justify-between items-center">
                          <span className="text-xs text-zinc-400">Trạng thái</span>
                          {getCalculatedUsedSessions(item.contract, sessions) >= item.contract.totalSessions ? (
                            <span className="text-red-400 text-xs font-bold">Hết buổi ({getCalculatedUsedSessions(item.contract, sessions)}/{item.contract.totalSessions})</span>
                          ) : (
                            <span className="text-red-400 text-xs font-bold">Trễ {(item as any).daysPassed} ngày</span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 mt-auto">
                      <button 
                        onClick={() => {
                          const msg = encodeURIComponent(`Kính chào ${item.student.name},\nGói tập "${item.contract.packageName}" của quý khách đã hết hạn. Vui lòng liên hệ để gia hạn và tiếp tục tập luyện. Xin cảm ơn!`);
                          window.open(`https://zalo.me/${item.student.phone?.replace(/[^0-9]/g, '')}?text=${msg}`, '_blank');
                        }}
                        className="flex-1 px-3 py-2.5 bg-zinc-900 text-white text-sm font-medium rounded-xl hover:bg-zinc-800 transition-colors border border-zinc-800 flex items-center justify-center gap-1.5"
                      >
                        <AlertCircle className="w-4 h-4 text-zinc-400" />
                        Nhắc nhở
                      </button>
                      <button 
                        onClick={() => setViewingStudent(item.student)}
                        className="flex-1 px-3 py-2.5 bg-zinc-900 border border-zinc-800 text-white text-sm font-medium rounded-xl hover:bg-zinc-800 transition-colors flex items-center justify-center gap-1.5"
                      >
                        Hồ sơ
                      </button>
                      <button 
                        onClick={() => setRenewingStudent({ student: item.student, contract: item.contract })}
                        className="flex-1 px-3 py-2.5 bg-red-500 text-white text-sm font-bold rounded-xl hover:bg-red-600 transition-colors shadow-lg shadow-red-500/20 whitespace-nowrap"
                      >
                        Tái ký
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Section: Hết buổi nhưng còn hạn */}
          {(filterStatus === 'all' || filterStatus === 'out_of_sessions') && filteredOutOfSessions.length > 0 && (
            <div>
              <h3 className="text-sm font-bold text-orange-500 mb-3 flex items-center gap-2">
                <CheckCircle className="w-4 h-4" />
                Hết buổi ({filteredOutOfSessions.length})
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {filteredOutOfSessions.map((item, idx) => (
                  <div key={idx} className="bg-zinc-950 border border-orange-500/30 rounded-2xl p-5 flex flex-col relative overflow-hidden group hover:border-orange-500/50 transition-colors">
                    <div className="absolute top-0 right-0 w-32 h-32 bg-orange-500/5 rounded-full blur-2xl -mr-16 -mt-16 pointer-events-none" />
                    
                    <div className="flex items-start justify-between mb-4">
                      <div className="flex items-center gap-3">
                        <div className="w-12 h-12 rounded-full bg-orange-500/10 border border-orange-500/20 flex items-center justify-center shrink-0">
                          <UserIcon className="w-6 h-6 text-orange-500" />
                        </div>
                        <div>
                          <h4 className="font-bold text-white text-lg leading-tight">{item.student.name}</h4>
                          <p className="text-zinc-500 text-xs mt-1">{item.student.phone || 'Chưa cập nhật SĐT'}</p>
                        </div>
                      </div>
                      <div className="bg-orange-500/10 text-orange-500 px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider">
                        Hết buổi
                      </div>
                    </div>

                    <div className="bg-zinc-900/50 rounded-xl p-3 mb-4 flex-1">
                      <div className="flex justify-between items-center mb-1">
                        <span className="text-xs text-zinc-400">Gói tập</span>
                        <span className="text-xs font-semibold text-white">{item.contract.packageName}</span>
                      </div>
                      <div className="w-full h-px bg-zinc-800 my-2" />
                      <div className="space-y-1.5">
                        <div className="flex justify-between items-center">
                          <span className="text-xs text-zinc-400">Trạng thái</span>
                          <span className="text-orange-400 text-xs font-bold">Hết buổi ({getCalculatedUsedSessions(item.contract, sessions)}/{item.contract.totalSessions})</span>
                        </div>
                        <div className="flex justify-between items-center">
                          <span className="text-xs text-zinc-400">Thời hạn hợp đồng</span>
                          <span className="text-zinc-300 text-xs font-medium">Đến {new Date(item.contract.endDate).toLocaleDateString('vi-VN')}</span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 mt-auto">
                      <button 
                        onClick={() => {
                          const msg = encodeURIComponent(`Kính chào ${item.student.name},\nGói tập "${item.contract.packageName}" của quý khách đã hết buổi. Vui lòng liên hệ để gia hạn và tiếp tục tập luyện. Xin cảm ơn!`);
                          window.open(`https://zalo.me/${item.student.phone?.replace(/[^0-9]/g, '')}?text=${msg}`, '_blank');
                        }}
                        className="flex-1 px-3 py-2.5 bg-zinc-900 text-white text-sm font-medium rounded-xl hover:bg-zinc-800 transition-colors border border-zinc-800 flex items-center justify-center gap-1.5"
                      >
                        <AlertCircle className="w-4 h-4 text-zinc-400" />
                        Nhắc nhở
                      </button>
                      <button 
                        onClick={() => setViewingStudent(item.student)}
                        className="flex-1 px-3 py-2.5 bg-zinc-900 border border-zinc-800 text-white text-sm font-medium rounded-xl hover:bg-zinc-800 transition-colors flex items-center justify-center gap-1.5"
                      >
                        Hồ sơ
                      </button>
                      <button 
                        onClick={() => setRenewingStudent({ student: item.student, contract: item.contract })}
                        className="flex-1 px-3 py-2.5 bg-orange-500 text-white text-sm font-bold rounded-xl hover:bg-orange-600 transition-colors shadow-lg shadow-orange-500/20 whitespace-nowrap"
                      >
                        Tái ký
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Section: Sắp hết hạn */}
          {(filterStatus === 'all' || filterStatus === 'upcoming') && filteredExpiring.length > 0 && (
            <div>
              <h3 className="text-sm font-bold text-amber-500 mb-3 flex items-center gap-2">
                <Clock className="w-4 h-4" />
                Sắp hết hạn ({filteredExpiring.length})
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {filteredExpiring.map((item, idx) => (
                  <div key={idx} className="bg-zinc-950 border border-amber-500/20 rounded-2xl p-5 flex flex-col relative overflow-hidden group hover:border-amber-500/40 transition-colors">
                    {/* Background accent */}
                    <div className="absolute top-0 right-0 w-32 h-32 bg-amber-500/5 rounded-full blur-2xl -mr-16 -mt-16 pointer-events-none" />
                    
                    <div className="flex items-start justify-between mb-4">
                      <div className="flex items-center gap-3">
                        <div className="w-12 h-12 rounded-full bg-amber-500/10 border border-amber-500/20 flex items-center justify-center shrink-0">
                          <UserIcon className="w-6 h-6 text-amber-500" />
                        </div>
                        <div>
                          <h4 className="font-bold text-white text-lg leading-tight">{item.student.name}</h4>
                          <p className="text-zinc-500 text-xs mt-1">{item.student.phone || 'Chưa cập nhật SĐT'}</p>
                        </div>
                      </div>
                      <div className="bg-amber-500/10 text-amber-500 px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider">
                        Sắp hết hạn
                      </div>
                    </div>

                    <div className="bg-zinc-900/50 rounded-xl p-3 mb-4 flex-1">
                      <div className="flex justify-between items-center mb-1">
                        <span className="text-xs text-zinc-400">Gói tập</span>
                        <span className="text-xs font-semibold text-white">{item.contract.packageName}</span>
                      </div>
                      <div className="w-full h-px bg-zinc-800 my-2" />
                      
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-zinc-400">Thời gian</span>
                          <span className="text-xs font-medium text-amber-400">Còn {item.daysLeft} ngày</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-zinc-400">Số buổi</span>
                          <span className="text-xs font-medium text-amber-400">Còn {item.sessionsLeft} buổi</span>
                        </div>
                        
                        {/* Progress bar */}
                        <div className="w-full h-1.5 bg-zinc-800 rounded-full overflow-hidden mt-1">
                          <div 
                            className="h-full bg-amber-500 rounded-full"
                            style={{ width: `${Math.min(100, (getCalculatedUsedSessions(item.contract, sessions) / item.contract.totalSessions) * 100)}%` }}
                          />
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 mt-auto">
                      <button 
                        onClick={() => {
                          const msg = encodeURIComponent(`Kính chào ${item.student.name},\nGói tập "${item.contract.packageName}" của quý khách sắp hết hạn (còn ${item.daysLeft} ngày / ${item.sessionsLeft} buổi). Vui lòng cân nhắc gia hạn. Cảm ơn quý khách!`);
                          window.open(`https://zalo.me/${item.student.phone?.replace(/[^0-9]/g, '')}?text=${msg}`, '_blank');
                        }}
                        className="flex-1 px-3 py-2.5 bg-zinc-900 text-white text-sm font-medium rounded-xl hover:bg-zinc-800 transition-colors border border-zinc-800 flex items-center justify-center gap-1.5"
                      >
                        <AlertCircle className="w-4 h-4 text-zinc-400" />
                        Nhắc nhở
                      </button>
                      <button 
                        onClick={() => setViewingStudent(item.student)}
                        className="flex-1 px-3 py-2.5 bg-zinc-900 border border-zinc-800 text-white text-sm font-medium rounded-xl hover:bg-zinc-800 transition-colors flex items-center justify-center gap-1.5"
                      >
                        Hồ sơ
                      </button>
                      <button 
                        onClick={() => setRenewingStudent({ student: item.student, contract: item.contract })}
                        className="flex-1 px-3 py-2.5 bg-amber-500/20 text-amber-500 border border-amber-500/30 text-sm font-bold rounded-xl hover:bg-amber-500/30 transition-colors whitespace-nowrap"
                      >
                        Báo giá
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {filteredUrgent.length === 0 && filteredExpiring.length === 0 && filteredOutOfSessions.length === 0 && (
            <div className="text-center py-12">
              <CheckCircle className="w-12 h-12 text-emerald-500 mx-auto mb-3 opacity-50" />
              <p className="text-zinc-400 font-medium">Không có học viên nào {filterBranch !== 'all' ? 'trong chi nhánh này' : 'sắp hết hạn hoặc cần tái ký'}.</p>
            </div>
          )}
        </div>
      </div>

      {renewingStudent && (
        <RenewContractModal
          isOpen={true}
          latestContract={renewingStudent.contract}
          student={renewingStudent.student}
          onClose={() => setRenewingStudent(null)}
        />
      )}
    </div>
  );
}

