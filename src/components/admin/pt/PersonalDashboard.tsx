import React, { useState } from 'react';
import { UserProfile } from '../../../types';
import WeekPlan from '../../food/WeekPlan';
import StudentProgressAdmin from './StudentProgressAdmin';
import CheckIn from '../../schedule/CheckIn';
import { Home, Calendar, LineChart, Target, Flame, Activity, Sparkles } from 'lucide-react';

interface Props {
  profile: UserProfile;
  user?: any;
  onUpdateProfile?: (profile: UserProfile) => void;
  onResetProfile?: () => void;
  onNavigate: (screen: string) => void;
}

export default function PersonalDashboard({ profile, onNavigate }: Props) {
  const [activeTab, setActiveTab] = useState<'dashboard' | 'week_plan' | 'progress' | 'check_in'>('dashboard');

  const tabs = [
    { id: 'dashboard', label: 'Hôm nay', icon: Home },
    { id: 'week_plan', label: 'Kế hoạch', icon: Calendar },
    { id: 'progress', label: 'Tiến độ', icon: LineChart },
    { id: 'check_in', label: 'Check-in', icon: Target },
  ] as const;

  return (
    <div className="min-h-screen bg-zinc-950 flex flex-col text-white">
      {/* Top Navigation Tabs */}
      <div className="sticky top-0 z-50 bg-zinc-950/80 backdrop-blur-xl border-b border-zinc-800/50 px-4 py-3 overflow-x-auto hide-scrollbar">
        <div className="flex gap-3 min-w-max">
          {tabs.map(tab => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-5 py-2.5 rounded-2xl text-sm font-medium transition-all duration-300 ${
                  isActive 
                    ? 'bg-zinc-100 text-zinc-950 shadow-[0_0_20px_rgba(255,255,255,0.1)] scale-105' 
                    : 'bg-zinc-900/50 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 border border-zinc-800/50'
                }`}
              >
                <Icon className={`w-4 h-4 ${isActive ? 'text-zinc-950' : 'text-zinc-500'}`} />
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Content Area */}
      <div className="flex-1 overflow-y-auto relative p-4 md:p-6 max-w-5xl mx-auto w-full">
        {activeTab === 'dashboard' && (
          <div className="space-y-6">
            <div className="bg-gradient-to-br from-pink-500/20 via-zinc-900 to-zinc-900 border border-pink-500/30 rounded-3xl p-6 md:p-8">
              <div className="flex items-center gap-3 mb-4">
                <Sparkles className="w-6 h-6 text-pink-500" />
                <h2 className="text-2xl font-bold text-white">Chào {profile.displayName || profile.name || 'Học viên'}!</h2>
              </div>
              <p className="text-zinc-300 mb-6">Mục tiêu của bạn: <span className="text-pink-400 font-semibold">{(profile as any).goal || profile.goals?.[0] || 'Giảm mỡ & rèn luyện thể lực'}</span></p>
              
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div className="bg-zinc-950/60 border border-zinc-800 rounded-2xl p-4 text-center">
                  <Flame className="w-5 h-5 text-orange-500 mx-auto mb-1" />
                  <div className="text-xs text-zinc-400">Calories</div>
                  <div className="text-lg font-bold text-white">{profile.calories || 2000} kcal</div>
                </div>
                <div className="bg-zinc-950/60 border border-zinc-800 rounded-2xl p-4 text-center">
                  <Activity className="w-5 h-5 text-emerald-500 mx-auto mb-1" />
                  <div className="text-xs text-zinc-400">Protein</div>
                  <div className="text-lg font-bold text-white">{profile.protein || 150}g</div>
                </div>
                <div className="bg-zinc-950/60 border border-zinc-800 rounded-2xl p-4 text-center">
                  <Target className="w-5 h-5 text-blue-500 mx-auto mb-1" />
                  <div className="text-xs text-zinc-400">Carbs</div>
                  <div className="text-lg font-bold text-white">{profile.carbs || 200}g</div>
                </div>
                <div className="bg-zinc-950/60 border border-zinc-800 rounded-2xl p-4 text-center">
                  <LineChart className="w-5 h-5 text-pink-500 mx-auto mb-1" />
                  <div className="text-xs text-zinc-400">Fat</div>
                  <div className="text-lg font-bold text-white">{profile.fat || 60}g</div>
                </div>
              </div>
            </div>

            <div className="grid md:grid-cols-2 gap-6">
              <div 
                onClick={() => setActiveTab('week_plan')}
                className="bg-zinc-900 hover:bg-zinc-850 border border-zinc-800 rounded-2xl p-6 cursor-pointer transition-all hover:border-pink-500/50"
              >
                <Calendar className="w-8 h-8 text-pink-500 mb-3" />
                <h3 className="text-lg font-bold text-white mb-1">Kế hoạch ăn uống</h3>
                <p className="text-sm text-zinc-400">Xem thực đơn các ngày trong tuần và gợi ý món ăn dinh dưỡng.</p>
              </div>

              <div 
                onClick={() => setActiveTab('check_in')}
                className="bg-zinc-900 hover:bg-zinc-850 border border-zinc-800 rounded-2xl p-6 cursor-pointer transition-all hover:border-pink-500/50"
              >
                <Target className="w-8 h-8 text-emerald-500 mb-3" />
                <h3 className="text-lg font-bold text-white mb-1">Check-in hàng ngày</h3>
                <p className="text-sm text-zinc-400">Ghi nhận mức độ tuân thủ, lượng nước, giấc ngủ và năng lượng.</p>
              </div>
            </div>
          </div>
        )}
        {activeTab === 'week_plan' && <WeekPlan profile={profile} onNavigate={onNavigate} />}
        {activeTab === 'progress' && <StudentProgressAdmin studentId={profile.uid} />}
        {activeTab === 'check_in' && <CheckIn />}
      </div>
    </div>
  );
}
