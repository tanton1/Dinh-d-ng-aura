import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { X, Plus, Trash2, Save, Dumbbell, Activity, CalendarDays } from 'lucide-react';
import { WorkoutLog, WorkoutSetLog } from '../../types';
import { useDatabase } from '../../contexts/DatabaseContext';

interface Props {
  studentId: string;
  sessionId?: string; // If this log is bound to a session
  defaultDate?: string;
  initialData?: WorkoutLog;
  onClose: () => void;
}

export default function WorkoutLoggerModal({ studentId, sessionId, defaultDate, initialData, onClose }: Props) {
  const { addWorkoutLog, updateWorkoutLog, workoutLogs } = useDatabase();
  const [date, setDate] = useState(defaultDate || new Date().toISOString().split('T')[0]);
  const [exerciseName, setExerciseName] = useState('');
  const [sets, setSets] = useState<WorkoutSetLog[]>([{ reps: 0, weight: 0 }]);
  const [feeling, setFeeling] = useState('');
  const [note, setNote] = useState('');

  useEffect(() => {
    if (initialData) {
      setDate(initialData.date);
      setExerciseName(initialData.exerciseName);
      setSets(initialData.sets || [{ reps: 0, weight: 0 }]);
      setFeeling(initialData.feeling || '');
      setNote(initialData.note || '');
    }
  }, [initialData]);

  const EXERCISE_CATEGORIES = [
    {
      name: 'Thân dưới (Lower Body)',
      items: [
        'Barbell Hip Thrust', 'Romanian Deadlift (RDL)', 'Bulgarian Split Squat', 
        'Goblet Squat', 'Cable Kickback', 'Hip Abduction', 'Leg Press', 
        'Leg Extension', 'Leg Curl', 'Glute Bridge', 'Sumo Deadlift', 
        'Cable Pull Through', 'Donkey Kicks', 'Walking Lunges', 'Smith Machine Squat'
      ]
    },
    {
      name: 'Thân trên (Upper Body)',
      items: [
        'Lat Pulldown', 'Seated Cable Row', 'Dumbbell Shoulder Press', 
        'Dumbbell Lateral Raise', 'Incline Dumbbell Press', 'Tricep Pushdown', 
        'Dumbbell Bicep Curl', 'Face Pull', 'Chest Press'
      ]
    },
    {
      name: 'Cơ bụng/Core',
      items: [
        'Plank', 'Side Plank', 'Cable Crunch', 'Hanging Leg Raise', 'Russian Twist'
      ]
    }
  ];

  // Extract unique exercise names from past logs for suggestions
  const recentExercises: string[] = React.useMemo(() => {
    if (!workoutLogs) return [];
    const myLogs = workoutLogs.filter((l: WorkoutLog) => l.studentId === studentId);
    // Sort by most recent
    myLogs.sort((a: WorkoutLog, b: WorkoutLog) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    const names = new Set<string>(myLogs.map((l: WorkoutLog) => l.exerciseName));
    return Array.from(names).slice(0, 8); // Top 8 suggestions
  }, [workoutLogs, studentId]);

  const [showSuggestions, setShowSuggestions] = useState(false);

  const handleAddSet = () => {
    setSets([...sets, { reps: 0, weight: 0 }]);
  };

  const handleRemoveSet = (index: number) => {
    if (sets.length > 1) {
      setSets(sets.filter((_, i) => i !== index));
    }
  };

  const handleUpdateSet = (index: number, field: 'reps' | 'weight', value: number) => {
    const newSets = [...sets];
    newSets[index][field] = value;
    setSets(newSets);
  };

  const handleSave = async () => {
    if (!exerciseName.trim()) {
      alert('Vui lòng nhập tên bài tập');
      return;
    }

    const log: WorkoutLog = {
      id: initialData ? initialData.id : Date.now().toString() + '_' + Math.random().toString(36).substr(2, 9),
      studentId,
      sessionId,
      date,
      exerciseName: exerciseName.trim(),
      sets,
      feeling,
      note,
      createdAt: initialData ? initialData.createdAt : new Date().toISOString()
    };

    try {
      if (initialData) {
        await updateWorkoutLog(log);
      } else {
        await addWorkoutLog(log);
      }
      onClose();
    } catch (error) {
      console.error('Lỗi khi lưu lịch sử:', error);
      alert('Có lỗi xảy ra khi lưu lịch sử tập. Vui lòng thử lại.');
    }
  };

  return (
    <div className="fixed inset-0 bg-black/80 z-[60] flex items-center justify-center p-4">
      <motion.div 
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="bg-zinc-900 w-full max-w-md rounded-3xl p-6 border border-zinc-800 shadow-xl max-h-[90vh] flex flex-col"
      >
        <div className="flex justify-between items-center mb-6 shrink-0">
          <h3 className="text-xl font-bold text-white flex items-center gap-2">
            <Dumbbell className="w-5 h-5 text-pink-500" />
            {initialData ? 'Sửa lịch sử tập' : 'Ghi lịch sử tập'}
          </h3>
          <button onClick={onClose} className="text-zinc-400 hover:text-white p-2 hover:bg-zinc-800 rounded-full transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-5 overflow-y-auto pr-2 custom-scrollbar flex-1">
          {/* Date */}
          <div className="space-y-1">
            <label className="block text-xs font-medium text-zinc-400 flex items-center gap-1"><CalendarDays className="w-3 h-3" /> Ngày tập</label>
            <input 
              type="date" 
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-pink-500 transition-colors"
            />
          </div>

          {/* Exercise Name */}
          <div className="space-y-2 relative">
            <label className="block text-xs font-medium text-zinc-400">Tên bài tập</label>
            <input 
              type="text" 
              placeholder="VD: Barbell Hip Thrust..."
              value={exerciseName}
              onChange={(e) => setExerciseName(e.target.value)}
              onFocus={() => setShowSuggestions(true)}
              className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-pink-500 transition-colors"
            />
            {showSuggestions && (
              <div className="mt-2 bg-zinc-900 border border-zinc-800 rounded-xl p-3 max-h-64 overflow-y-auto hidden-scrollbar">
                <div className="flex justify-between items-center mb-3">
                  <span className="text-xs font-bold text-white">Gợi ý bài tập</span>
                  <button onClick={() => setShowSuggestions(false)} className="text-zinc-500 hover:text-white p-1 hover:bg-zinc-800 rounded-lg transition-colors">
                    <X className="w-4 h-4"/>
                  </button>
                </div>
                
                {recentExercises.length > 0 && (
                  <div className="mb-4">
                    <h4 className="text-[10px] uppercase text-zinc-500 font-bold mb-2 tracking-wider">Tập gần đây</h4>
                    <div className="flex flex-wrap gap-1.5">
                      {recentExercises.map(ex => (
                        <button
                          key={ex}
                          onClick={() => { setExerciseName(ex); setShowSuggestions(false); }}
                          className="bg-zinc-800 hover:bg-zinc-700 text-zinc-300 px-2.5 py-1.5 rounded-lg text-xs transition-colors text-left"
                        >
                          {ex}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {EXERCISE_CATEGORIES.map(cat => (
                  <div key={cat.name} className="mb-4 last:mb-0">
                    <h4 className="text-[10px] uppercase text-zinc-500 font-bold mb-2 tracking-wider">{cat.name}</h4>
                    <div className="flex flex-wrap gap-1.5">
                      {cat.items.map(ex => (
                        <button
                          key={ex}
                          onClick={() => { setExerciseName(ex); setShowSuggestions(false); }}
                          className="bg-zinc-950 border border-zinc-800 hover:border-pink-500/50 text-zinc-400 hover:text-white px-2.5 py-1.5 rounded-lg text-xs transition-colors text-left"
                        >
                          {ex}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Sets */}
          <div className="space-y-2">
            <div className="flex justify-between items-center">
              <label className="block text-xs font-medium text-zinc-400">Các hiệp (Sets)</label>
              <button 
                onClick={handleAddSet}
                className="text-xs text-pink-400 hover:text-pink-300 font-medium flex items-center gap-1 bg-pink-500/10 px-2 py-1 rounded-lg"
              >
                <Plus className="w-3 h-3" /> Thêm hiệp
              </button>
            </div>
            
            <div className="space-y-3">
              <div className="flex justify-between items-center bg-zinc-900/50 p-2 rounded-lg mb-2 border border-zinc-800/50">
                <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider w-8 text-center">Hiệp</span>
                <div className="flex-1 flex gap-2 justify-between">
                  <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider flex-1 text-center">Trọng lượng (kg)</span>
                  <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider flex-1 text-center">Số rep</span>
                </div>
                <span className="w-8"></span>
              </div>
              {sets.map((set, index) => (
                <div key={index} className="flex gap-2 items-center bg-zinc-950 p-2 rounded-xl border border-zinc-800/80 shadow-sm focus-within:border-pink-500/50 transition-colors">
                  <span className="text-xs text-zinc-400 font-bold w-8 text-center bg-zinc-900 rounded-lg py-3">{index + 1}</span>
                  <div className="flex-1 flex gap-2">
                    <div className="flex-1 relative">
                      <input 
                        type="number" 
                        min="0"
                        value={set.weight || ''}
                        onChange={(e) => handleUpdateSet(index, 'weight', Number(e.target.value))}
                        className="w-full bg-zinc-900 border-none rounded-lg px-2 py-3 text-base font-medium text-white focus:outline-none focus:ring-1 focus:ring-pink-500 transition-colors text-center"
                        placeholder="0"
                      />
                    </div>
                    <div className="flex-1 relative">
                      <input 
                        type="number" 
                        min="0"
                        value={set.reps || ''}
                        onChange={(e) => handleUpdateSet(index, 'reps', Number(e.target.value))}
                        className="w-full bg-zinc-900 border-none rounded-lg px-2 py-3 text-base font-medium text-white focus:outline-none focus:ring-1 focus:ring-pink-500 transition-colors text-center"
                        placeholder="0"
                      />
                    </div>
                  </div>
                  <button 
                    onClick={() => handleRemoveSet(index)}
                    disabled={sets.length === 1}
                    className="w-8 h-10 flex items-center justify-center text-red-500/70 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors disabled:opacity-20 disabled:cursor-not-allowed"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Feeling */}
          <div className="space-y-2 pt-2">
            <label className="block text-xs font-medium text-zinc-400 flex items-center gap-1"><Activity className="w-3 h-3" /> Cảm giác khi tập</label>
            <div className="grid grid-cols-3 gap-2">
              {['Rất nhẹ', 'Vừa sức', 'Rất nặng', 'Đuối', 'Tốt', 'Căng cơ'].map(f => (
                <button
                  key={f}
                  onClick={() => setFeeling(f)}
                  className={`px-2 py-2.5 rounded-xl text-[11px] sm:text-xs font-bold transition-all border ${
                    feeling === f ? 'bg-pink-500 text-white border-pink-500 shadow-[0_0_10px_rgba(255,0,127,0.3)]' : 'bg-zinc-950 text-zinc-400 border-zinc-800 hover:bg-zinc-900 hover:text-zinc-300'
                  }`}
                >
                  {f}
                </button>
              ))}
            </div>
          </div>

          {/* Note */}
          <div className="space-y-1">
            <label className="block text-xs font-medium text-zinc-400">Ghi chú thêm (Tuỳ chọn)</label>
            <textarea 
              rows={2}
              placeholder="Ghi chú thêm về bài tập..."
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-pink-500 transition-colors resize-none"
            />
          </div>
        </div>

        <div className="mt-6 pt-4 border-t border-zinc-800 shrink-0">
          <button
            onClick={handleSave}
            className="w-full bg-pink-500 text-white font-bold py-3 rounded-xl hover:bg-pink-600 transition-colors flex items-center justify-center gap-2"
          >
            <Save className="w-5 h-5" />
            Lưu bài tập
          </button>
        </div>
      </motion.div>
    </div>
  );
}
