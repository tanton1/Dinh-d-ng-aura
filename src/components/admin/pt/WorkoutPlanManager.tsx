import React, { useState } from 'react';
import { Target, Dumbbell, Calendar as CalendarIcon, Clock, Activity, FileText, Plus } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { predefinedWorkoutPlans } from '../../../data/workoutPlans';
import { WorkoutPlan } from '../../../types';
import WorkoutPlanEditor from './WorkoutPlanEditor';

export default function WorkoutPlanManager() {
  const [selectedPlan, setSelectedPlan] = useState<WorkoutPlan | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [customPlans, setCustomPlans] = useState<WorkoutPlan[]>([]);

  const allPlans = [...predefinedWorkoutPlans, ...customPlans];

  const handleSavePlan = (plan: WorkoutPlan) => {
    setCustomPlans([...customPlans, plan]);
    setSelectedPlan(plan);
    setIsEditing(false);
  };

  if (isEditing) {
    return <WorkoutPlanEditor onSave={handleSavePlan} onCancel={() => setIsEditing(false)} />;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Target className="w-8 h-8 text-pink-500" />
          <h2 className="text-2xl font-bold bg-gradient-to-r from-pink-500 to-rose-400 bg-clip-text text-transparent">
            Quản lý Giáo án
          </h2>
        </div>
        <button 
          onClick={() => setIsEditing(true)}
          className="bg-pink-500 text-white px-4 py-2 rounded-xl font-bold flex items-center gap-2 hover:bg-pink-600 transition-colors shadow-lg shadow-pink-500/20"
        >
          <Plus className="w-4 h-4" />
          Tạo mới
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1 space-y-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 shadow-sm">
            <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
              <Dumbbell className="w-5 h-5 text-pink-500" />
              Thư viện Giáo án
            </h3>
            <div className="space-y-3">
              {allPlans.length > 0 ? (
                allPlans.map(plan => (
                  <button
                    key={plan.id}
                    onClick={() => setSelectedPlan(plan)}
                    className={`w-full text-left p-4 rounded-xl transition-all ${
                      selectedPlan?.id === plan.id
                        ? 'bg-gradient-to-r from-pink-500/20 to-rose-500/20 border-pink-500/50'
                        : 'bg-zinc-950 border-zinc-800 hover:border-zinc-700'
                    } border shadow-sm`}
                  >
                    <h4 className="font-bold text-white text-base">{plan.name}</h4>
                    <div className="flex flex-wrap gap-2 mt-2">
                      <span className="text-[10px] font-bold uppercase tracking-wider bg-zinc-800 text-zinc-400 px-2 py-1 rounded">
                        {plan.gender === 'female' ? 'Nữ' : plan.gender === 'male' ? 'Nam' : 'Cả hai'}
                      </span>
                      <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded ${
                        plan.target === 'fat_loss' ? 'bg-orange-500/10 text-orange-500' :
                        plan.target === 'muscle_gain' ? 'bg-emerald-500/10 text-emerald-500' :
                        'bg-blue-500/10 text-blue-500'
                      }`}>
                        {plan.target === 'fat_loss' ? 'Giảm mỡ' : plan.target === 'muscle_gain' ? 'Tăng cơ' : 'Sức mạnh'}
                      </span>
                      <span className="text-[10px] font-bold uppercase tracking-wider bg-zinc-800 text-zinc-400 px-2 py-1 rounded">
                        {plan.durationWeeks} Tuần
                      </span>
                    </div>
                  </button>
                ))
              ) : (
                <div className="p-6 text-center text-zinc-500 text-sm border border-zinc-800 rounded-xl bg-zinc-950">
                  Chưa có giáo án nào trong thư viện
                </div>
              )}
            </div>
            
            <button 
              onClick={() => setIsEditing(true)}
              className="w-full mt-4 p-4 border border-dashed border-zinc-700 rounded-xl text-zinc-500 hover:text-zinc-300 hover:border-zinc-500 transition-colors flex items-center justify-center gap-2"
            >
              <span className="text-xl">+</span> Thêm giáo án cá nhân hóa
            </button>
          </div>
        </div>

        <div className="lg:col-span-2">
          {selectedPlan ? (
            <AnimatePresence mode="wait">
              <motion.div
                key={selectedPlan.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 shadow-sm space-y-6"
              >
                <div>
                  <h3 className="text-2xl font-bold text-white mb-2">{selectedPlan.name}</h3>
                  <p className="text-zinc-400 text-sm leading-relaxed">{selectedPlan.description}</p>
                </div>

                <div className="grid grid-cols-3 gap-4">
                  <div className="bg-zinc-950 p-4 rounded-xl border border-zinc-800 flex items-center gap-3">
                    <div className="p-2 bg-pink-500/10 text-pink-500 rounded-lg">
                      <CalendarIcon className="w-5 h-5" />
                    </div>
                    <div>
                      <p className="text-xs text-zinc-500">Thời lượng</p>
                      <p className="font-bold text-white">{selectedPlan.durationWeeks} tuần</p>
                    </div>
                  </div>
                  <div className="bg-zinc-950 p-4 rounded-xl border border-zinc-800 flex items-center gap-3">
                    <div className="p-2 bg-amber-500/10 text-amber-500 rounded-lg">
                      <Activity className="w-5 h-5" />
                    </div>
                    <div>
                      <p className="text-xs text-zinc-500">Cấp độ</p>
                      <p className="font-bold text-white capitalize">{selectedPlan.level}</p>
                    </div>
                  </div>
                  <div className="bg-zinc-950 p-4 rounded-xl border border-zinc-800 flex items-center gap-3">
                    <div className="p-2 bg-blue-500/10 text-blue-500 rounded-lg">
                      <Target className="w-5 h-5" />
                    </div>
                    <div>
                      <p className="text-xs text-zinc-500">Mục tiêu</p>
                      <p className="font-bold text-white">
                        {selectedPlan.target === 'fat_loss' ? 'Giảm mỡ' : selectedPlan.target === 'muscle_gain' ? 'Tăng cơ' : 'Chung'}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="space-y-6">
                  {selectedPlan.weeks.map((week, idx) => (
                    <div key={`week-${idx}`} className="space-y-4">
                      <h4 className="text-lg font-bold text-pink-400 border-b border-zinc-800 pb-2">{week.name}</h4>
                      <div className="space-y-4">
                        {week.days.map((day, dayIdx) => (
                          <div key={`day-${dayIdx}`} className="bg-zinc-950 border border-zinc-800/50 rounded-xl overflow-hidden">
                            <div className="bg-zinc-900/50 p-4 border-b border-zinc-800/50">
                              <h5 className="font-bold text-white">{day.dayName}</h5>
                              {day.description && <p className="text-sm text-zinc-400 mt-1">{day.description}</p>}
                            </div>
                            {day.exercises.length > 0 ? (
                              <div className="divide-y divide-zinc-800/30">
                                {day.exercises.map((ex, exIdx) => (
                                  <div key={`ex-${exIdx}`} className="p-4 flex items-start gap-4">
                                    <div className="w-8 h-8 rounded-lg bg-zinc-900 flex items-center justify-center text-zinc-500 font-bold shrink-0">
                                      {exIdx + 1}
                                    </div>
                                    <div className="flex-1">
                                      <p className="font-bold text-white">{ex.name}</p>
                                      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mt-2 text-sm">
                                        <span className="text-zinc-400">
                                          <strong className="text-zinc-300">{ex.sets}</strong> hiệp
                                        </span>
                                        <span className="text-zinc-600">•</span>
                                        <span className="text-zinc-400">
                                          <strong className="text-zinc-300">{ex.reps}</strong> reps
                                        </span>
                                        <span className="text-zinc-600">•</span>
                                        <span className="text-zinc-400 flex items-center gap-1">
                                          <Clock className="w-3.5 h-3.5" /> {ex.rest} nghỉ
                                        </span>
                                      </div>
                                      {ex.note && (
                                        <p className="mt-2 text-sm text-amber-500/80 bg-amber-500/10 px-3 py-1.5 rounded-lg inline-flex items-center gap-1.5">
                                          <FileText className="w-3.5 h-3.5" />
                                          {ex.note}
                                        </p>
                                      )}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <div className="p-6 text-center text-zinc-500 text-sm">
                                Ngày nghỉ ngơi
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>

              </motion.div>
            </AnimatePresence>
          ) : (
            <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-12 text-center text-zinc-500 shadow-sm flex flex-col items-center justify-center h-full min-h-[400px]">
              <Target className="w-16 h-16 mb-4 text-zinc-800" />
              <p>Chọn một giáo án bên trái để xem chi tiết</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
