import React, { useState } from 'react';
import { Target, Save, X, Plus, Trash2, ArrowLeft } from 'lucide-react';
import { WorkoutPlan, WorkoutWeek, WorkoutDay, WorkoutExercise } from '../../../types';

interface Props {
  onSave?: (plan: WorkoutPlan) => void;
  onCancel?: () => void;
}

export default function WorkoutPlanEditor({ onSave, onCancel }: Props = {}) {
  const [plan, setPlan] = useState<WorkoutPlan>({
    id: `wp_${Date.now()}`,
    name: '',
    target: 'general',
    gender: 'both',
    description: '',
    durationWeeks: 4,
    level: 'beginner',
    weeks: []
  });

  const addWeek = () => {
    setPlan({
      ...plan,
      weeks: [
        ...plan.weeks,
        {
          name: `Tuần ${plan.weeks.length + 1}`,
          days: []
        }
      ]
    });
  };

  const addDay = (weekIndex: number) => {
    const newWeeks = [...plan.weeks];
    newWeeks[weekIndex].days.push({
      dayName: `Ngày ${newWeeks[weekIndex].days.length + 1}`,
      description: '',
      exercises: []
    });
    setPlan({ ...plan, weeks: newWeeks });
  };

  const addExercise = (weekIndex: number, dayIndex: number) => {
    const newWeeks = [...plan.weeks];
    newWeeks[weekIndex].days[dayIndex].exercises.push({
      name: '',
      sets: 3,
      reps: '12',
      rest: '60s',
      note: ''
    });
    setPlan({ ...plan, weeks: newWeeks });
  };

  const updateWeek = (weekIndex: number, field: string, value: any) => {
    const newWeeks = [...plan.weeks];
    newWeeks[weekIndex] = { ...newWeeks[weekIndex], [field]: value };
    setPlan({ ...plan, weeks: newWeeks });
  };

  const updateDay = (weekIndex: number, dayIndex: number, field: string, value: any) => {
    const newWeeks = [...plan.weeks];
    newWeeks[weekIndex].days[dayIndex] = { ...newWeeks[weekIndex].days[dayIndex], [field]: value };
    setPlan({ ...plan, weeks: newWeeks });
  };

  const updateExercise = (weekIndex: number, dayIndex: number, exIndex: number, field: string, value: any) => {
    const newWeeks = [...plan.weeks];
    newWeeks[weekIndex].days[dayIndex].exercises[exIndex] = { 
      ...newWeeks[weekIndex].days[dayIndex].exercises[exIndex], 
      [field]: value 
    };
    setPlan({ ...plan, weeks: newWeeks });
  };

  const removeWeek = (weekIndex: number) => {
    const newWeeks = [...plan.weeks];
    newWeeks.splice(weekIndex, 1);
    setPlan({ ...plan, weeks: newWeeks });
  };

  const removeDay = (weekIndex: number, dayIndex: number) => {
    const newWeeks = [...plan.weeks];
    newWeeks[weekIndex].days.splice(dayIndex, 1);
    setPlan({ ...plan, weeks: newWeeks });
  };

  const removeExercise = (weekIndex: number, dayIndex: number, exIndex: number) => {
    const newWeeks = [...plan.weeks];
    newWeeks[weekIndex].days[dayIndex].exercises.splice(exIndex, 1);
    setPlan({ ...plan, weeks: newWeeks });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!plan.name.trim()) {
      alert('Vui lòng nhập tên giáo án');
      return;
    }
    if (onSave) onSave(plan);
  };

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 shadow-sm space-y-6">
      <div className="flex items-center justify-between pb-6 border-b border-zinc-800/50">
        <div className="flex items-center gap-3">
          {onCancel && (
            <button onClick={onCancel} className="p-2 bg-zinc-800 hover:bg-zinc-700 rounded-full transition-colors text-zinc-400 hover:text-white">
              <ArrowLeft className="w-5 h-5" />
            </button>
          )}
          <h3 className="text-2xl font-bold text-white">Tạo giáo án mới</h3>
        </div>
        <button 
          onClick={handleSubmit}
          className="bg-gradient-to-r from-pink-500 to-rose-500 hover:from-pink-600 hover:to-rose-600 text-white px-6 py-2.5 rounded-xl font-bold flex items-center gap-2 transition-all shadow-lg shadow-pink-500/20"
        >
          <Save className="w-4 h-4" />
          Lưu giáo án
        </button>
      </div>

      <div className="space-y-6">
        {/* Thông tin chung */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="lg:col-span-2">
            <label className="block text-sm font-medium text-zinc-400 mb-1">Tên giáo án *</label>
            <input 
              type="text" 
              value={plan.name}
              onChange={e => setPlan({...plan, name: e.target.value})}
              className="w-full p-3 rounded-xl border border-zinc-800 bg-zinc-950 text-white focus:outline-none focus:border-pink-500" 
              placeholder="VD: Giáo án Nữ giảm mỡ 4 tuần"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-zinc-400 mb-1">Đối tượng</label>
            <select 
              value={plan.gender}
              onChange={e => setPlan({...plan, gender: e.target.value as any})}
              className="w-full p-3 rounded-xl border border-zinc-800 bg-zinc-950 text-white focus:outline-none focus:border-pink-500"
            >
              <option value="both">Cả Nam và Nữ</option>
              <option value="female">Dành cho Nữ</option>
              <option value="male">Dành cho Nam</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-zinc-400 mb-1">Thời lượng (Tuần)</label>
            <input 
              type="number" 
              min="1"
              value={plan.durationWeeks}
              onChange={e => setPlan({...plan, durationWeeks: Number(e.target.value)})}
              className="w-full p-3 rounded-xl border border-zinc-800 bg-zinc-950 text-white focus:outline-none focus:border-pink-500" 
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-zinc-400 mb-1">Mục tiêu</label>
            <select 
              value={plan.target}
              onChange={e => setPlan({...plan, target: e.target.value as any})}
              className="w-full p-3 rounded-xl border border-zinc-800 bg-zinc-950 text-white focus:outline-none focus:border-pink-500"
            >
              <option value="fat_loss">Giảm mỡ</option>
              <option value="muscle_gain">Tăng cơ</option>
              <option value="strength">Sức mạnh</option>
              <option value="general">Khác</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-zinc-400 mb-1">Cấp độ</label>
            <select 
              value={plan.level}
              onChange={e => setPlan({...plan, level: e.target.value as any})}
              className="w-full p-3 rounded-xl border border-zinc-800 bg-zinc-950 text-white focus:outline-none focus:border-pink-500"
            >
              <option value="beginner">Cơ bản</option>
              <option value="intermediate">Trung bình</option>
              <option value="advanced">Nâng cao</option>
            </select>
          </div>
          <div className="md:col-span-2 lg:col-span-4">
            <label className="block text-sm font-medium text-zinc-400 mb-1">Mô tả tóm tắt</label>
            <textarea 
              value={plan.description}
              onChange={e => setPlan({...plan, description: e.target.value})}
              className="w-full p-3 rounded-xl border border-zinc-800 bg-zinc-950 text-white focus:outline-none focus:border-pink-500" 
              rows={2}
            ></textarea>
          </div>
        </div>

        {/* Nội dung chi tiết các tuần */}
        <div className="space-y-6 pt-6 border-t border-zinc-800/50">
          <div className="flex items-center justify-between">
            <h4 className="text-xl font-bold text-white flex items-center gap-2">
              <Target className="w-5 h-5 text-pink-500" />
              Chi tiết giáo án
            </h4>
            <button 
              onClick={addWeek}
              className="bg-zinc-800 hover:bg-zinc-700 text-white px-4 py-2 rounded-xl text-sm font-bold flex items-center gap-2 transition-colors"
            >
              <Plus className="w-4 h-4" /> Thêm Tuần mới
            </button>
          </div>

          {plan.weeks.map((week, wIdx) => (
            <div key={`week-${wIdx}`} className="bg-zinc-950 border border-zinc-800 rounded-2xl p-4 space-y-4">
              <div className="flex items-center gap-2">
                <input 
                  type="text" 
                  value={week.name}
                  onChange={e => updateWeek(wIdx, 'name', e.target.value)}
                  className="flex-1 bg-transparent text-lg font-bold text-pink-400 focus:outline-none border-b border-transparent focus:border-pink-500/50"
                  placeholder="VD: Tuần 1-4: Nền tảng"
                />
                <button 
                  onClick={() => removeWeek(wIdx)}
                  className="p-2 text-zinc-500 hover:text-red-400 transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>

              <div className="pl-4 space-y-4 border-l-2 border-zinc-800">
                {week.days.map((day, dIdx) => (
                  <div key={`day-${wIdx}-${dIdx}`} className="bg-zinc-900 border border-zinc-800/80 rounded-xl p-4 space-y-3">
                    <div className="flex items-start gap-2">
                      <div className="flex-1 space-y-2">
                        <input 
                          type="text" 
                          value={day.dayName}
                          onChange={e => updateDay(wIdx, dIdx, 'dayName', e.target.value)}
                          className="w-full bg-transparent text-white font-bold focus:outline-none border-b border-transparent focus:border-zinc-700"
                          placeholder="VD: Ngày 1 - Tập Ngực"
                        />
                        <input 
                          type="text" 
                          value={day.description || ''}
                          onChange={e => updateDay(wIdx, dIdx, 'description', e.target.value)}
                          className="w-full bg-transparent text-sm text-zinc-400 focus:outline-none border-b border-transparent focus:border-zinc-700"
                          placeholder="Mô tả cụ thể buổi tập này (Tùy chọn)"
                        />
                      </div>
                      <button 
                        onClick={() => removeDay(wIdx, dIdx)}
                        className="p-1.5 text-zinc-500 hover:text-red-400 transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>

                    <div className="space-y-2 mt-2">
                      {day.exercises.map((ex, eIdx) => (
                        <div key={`ex-${wIdx}-${dIdx}-${eIdx}`} className="flex flex-wrap md:flex-nowrap items-center gap-2 bg-zinc-950 p-2 rounded-lg border border-zinc-800/50">
                          <input 
                            type="text"
                            value={ex.name}
                            onChange={e => updateExercise(wIdx, dIdx, eIdx, 'name', e.target.value)}
                            className="flex-1 min-w-[200px] bg-transparent text-white focus:outline-none text-sm font-medium"
                            placeholder="Tên bài tập"
                          />
                          <div className="flex items-center gap-2 text-xs">
                            <input 
                              type="number"
                              min="1"
                              value={ex.sets}
                              onChange={e => updateExercise(wIdx, dIdx, eIdx, 'sets', Number(e.target.value))}
                              className="w-12 bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-center text-white focus:outline-none focus:border-pink-500"
                            /> hiệp
                            <span className="text-zinc-600">x</span>
                            <input 
                              type="text"
                              value={ex.reps}
                              onChange={e => updateExercise(wIdx, dIdx, eIdx, 'reps', e.target.value)}
                              className="w-16 bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-center text-white focus:outline-none focus:border-pink-500"
                              placeholder="Reps"
                            />
                            <span className="text-zinc-600 px-1">Nghỉ</span>
                            <input 
                              type="text"
                              value={ex.rest}
                              onChange={e => updateExercise(wIdx, dIdx, eIdx, 'rest', e.target.value)}
                              className="w-16 bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-center text-white focus:outline-none focus:border-pink-500"
                              placeholder="60s"
                            />
                          </div>
                          <input 
                            type="text"
                            value={ex.note || ''}
                            onChange={e => updateExercise(wIdx, dIdx, eIdx, 'note', e.target.value)}
                            className="flex-1 min-w-[150px] bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-xs text-zinc-300 focus:outline-none focus:border-pink-500"
                            placeholder="Ghi chú (tuỳ chọn)"
                          />
                          <button 
                            onClick={() => removeExercise(wIdx, dIdx, eIdx)}
                            className="p-1.5 text-zinc-600 hover:text-red-400 transition-colors"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                      <div className="pt-2">
                        <button 
                          onClick={() => addExercise(wIdx, dIdx)}
                          className="text-xs font-bold text-pink-500 bg-pink-500/10 hover:bg-pink-500/20 px-3 py-1.5 rounded-lg flex items-center gap-1 transition-colors"
                        >
                          <Plus className="w-3.5 h-3.5" /> Thêm Bài Tập
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
                
                <button 
                  onClick={() => addDay(wIdx)}
                  className="w-full p-3 border border-dashed border-zinc-700 hover:border-zinc-500 rounded-xl text-zinc-500 hover:text-zinc-400 text-sm font-bold flex items-center justify-center gap-2 transition-colors"
                >
                  <Plus className="w-4 h-4" /> Thêm Ngày tập vào tuần này
                </button>
              </div>
            </div>
          ))}

          {plan.weeks.length === 0 && (
            <div className="text-center p-8 bg-zinc-950 border border-zinc-800 border-dashed rounded-2xl">
              <p className="text-zinc-500 mb-4">Chưa có nội dung tuần nào</p>
              <button 
                onClick={addWeek}
                className="bg-zinc-800 hover:bg-zinc-700 text-white px-4 py-2 rounded-xl text-sm font-bold inline-flex items-center gap-2 transition-colors"
              >
                <Plus className="w-4 h-4" /> Bắt đầu tạo Tuần 1
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
