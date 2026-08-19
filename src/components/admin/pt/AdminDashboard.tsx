import React, { useState, useEffect, lazy, Suspense } from 'react';
import { UserProfile, StudentContract } from '../../../types';
import { User } from 'firebase/auth';
const StudentManagement = lazy(() => import('./StudentManagement'));
const FinanceManagement = lazy(() => import('./FinanceManagement'));
const HRManagement = lazy(() => import('./HRManagement'));
const TrainerPayroll = lazy(() => import('./TrainerPayroll'));
const PackageSettings = lazy(() => import('./PackageSettings'));
const ScheduleSettings = lazy(() => import('./ScheduleSettings'));
const WorkoutPlanManager = lazy(() => import('./WorkoutPlanManager'));
import { useDatabase } from '../../../contexts/DatabaseContext';

const AdminReportDashboard = lazy(() => import('./AdminReportDashboard'));
const ContractRenewals = lazy(() => import('./ContractRenewals'));

interface Props {
  user: User | null;
  profile: UserProfile | null;
  activeTab: 'overview' | 'students' | 'finance' | 'hr' | 'payroll' | 'packages' | 'settings' | 'workout_plans' | 'renewals';
  onNavigate?: (screen: string) => void;
}

export default function AdminDashboard({ user, profile, activeTab, onNavigate }: Props) {
  const { contracts, migrateData, isMigrating, isMigrated } = useDatabase();
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    setLastUpdate(new Date());
  }, [contracts]);

  const overdueCount = contracts.filter(c => {
    if (c.status === 'frozen') return false;
    const pending = c.installments?.filter(i => i.status === 'pending') || [];
    if (pending.length === 0 && c.nextPaymentDate && c.paidAmount < (c.totalPrice - (c.discount || 0)) && new Date(c.nextPaymentDate) <= new Date()) {
      return true;
    }
    return pending.some(i => new Date(i.date) <= new Date());
  }).length;

  return (
    <div className="min-h-screen bg-zinc-950 pb-24">
      {/* Tab Content */}
      <div className="p-4 pt-6">
        <Suspense fallback={<div className="p-8 text-center text-zinc-400">Đang tải...</div>}>
        {activeTab === 'overview' && <AdminReportDashboard onNavigate={onNavigate} />}
        {activeTab === 'students' && <StudentManagement user={user} profile={profile} />}
        {activeTab === 'finance' && <FinanceManagement user={user} profile={profile} />}
        {activeTab === 'packages' && <PackageSettings user={user} profile={profile} />}
        {activeTab === 'renewals' && <ContractRenewals user={user} profile={profile} onNavigate={onNavigate} />}
        {activeTab === 'hr' && <HRManagement user={user} />}
        {activeTab === 'payroll' && <TrainerPayroll user={user} profile={profile} />}
        {activeTab === 'settings' && <ScheduleSettings />}
        {activeTab === 'workout_plans' && <WorkoutPlanManager />}
        </Suspense>
      </div>
    </div>
  );
}
