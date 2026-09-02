import React, { useEffect, useState } from 'react';
import { Save, Clock, CalendarDays, Lock, CalendarOff, Gauge, X } from 'lucide-react';
import { ScheduleConfig, Day } from '../../../types';
import { useDatabase } from '../../../contexts/DatabaseContext';

const ALL_DAYS: { id: Day; label: string }[] = [
  { id: 'T2', label: 'Thứ 2' },
  { id: 'T3', label: 'Thứ 3' },
  { id: 'T4', label: 'Thứ 4' },
  { id: 'T5', label: 'Thứ 5' },
  { id: 'T6', label: 'Thứ 6' },
  { id: 'T7', label: 'Thứ 7' },
];

export default function ScheduleSettings() {
  const { branches, scheduleConfig, updateScheduleConfig } = useDatabase();
  const [config, setConfig] = useState<ScheduleConfig>({
    workingDays: scheduleConfig?.workingDays || ['T2', 'T3', 'T4', 'T5', 'T6', 'T7'],
    workingHours: scheduleConfig?.workingHours || [6, 7, 8, 9, 10, 11, 14, 15, 16, 17, 18, 19, 20],
    lockDayOfWeek: scheduleConfig?.lockDayOfWeek ?? 6,
    lockHour: scheduleConfig?.lockHour ?? 12,
    isAutoLockEnabled: scheduleConfig?.isAutoLockEnabled ?? false,
    holidays: scheduleConfig?.holidays || [],
    holidayDetails: scheduleConfig?.holidayDetails || [],
    branchCapacityBySlot: scheduleConfig?.branchCapacityBySlot || {}
  });
  const [isSaving, setIsSaving] = useState(false);
  const [newHoliday, setNewHoliday] = useState('');

  useEffect(() => {
    setConfig({
      workingDays: scheduleConfig?.workingDays || ['T2', 'T3', 'T4', 'T5', 'T6', 'T7'],
      workingHours: scheduleConfig?.workingHours || [6, 7, 8, 9, 10, 11, 14, 15, 16, 17, 18, 19, 20],
      lockDayOfWeek: scheduleConfig?.lockDayOfWeek ?? 6,
      lockHour: scheduleConfig?.lockHour ?? 12,
      isAutoLockEnabled: scheduleConfig?.isAutoLockEnabled ?? false,
      holidays: scheduleConfig?.holidays || [],
      holidayDetails: scheduleConfig?.holidayDetails || [],
      branchCapacityBySlot: scheduleConfig?.branchCapacityBySlot || {},
    });
  }, [scheduleConfig]);

  const setBranchCapacity = (branchId: string, rawValue: string) => {
    setConfig((current) => {
      const branchCapacityBySlot = { ...(current.branchCapacityBySlot || {}) };
      const existing = { ...(branchCapacityBySlot[branchId] || {}) };
      if (!rawValue) existing.default = null;
      else existing.default = Math.max(1, Math.min(500, Math.trunc(Number(rawValue) || 1)));
      if (Object.keys(existing).length) branchCapacityBySlot[branchId] = existing;
      else delete branchCapacityBySlot[branchId];
      return { ...current, branchCapacityBySlot };
    });
  };
  
  const toggleDay = (day: Day) => {
    setConfig(prev => ({
      ...prev,
      workingDays: prev.workingDays.includes(day) 
        ? prev.workingDays.filter(d => d !== day)
        : [...prev.workingDays, day].sort((a,b) => ALL_DAYS.findIndex(x=>x.id===a) - ALL_DAYS.findIndex(x=>x.id===b))
    }));
  };

  const toggleHour = (hour: number) => {
    setConfig(prev => ({
      ...prev,
      workingHours: prev.workingHours.includes(hour)
        ? prev.workingHours.filter(h => h !== hour)
        : [...prev.workingHours, hour].sort((a,b) => a - b)
    }));
  };

  const addHoliday = () => {
    if (!newHoliday) return;
    if (config.holidays?.includes(newHoliday)) return;
    
    setConfig(prev => ({
      ...prev,
      holidays: [...(prev.holidays || []), newHoliday].sort(),
      holidayDetails: [...(prev.holidayDetails || []), { date: newHoliday, name: 'Ngày nghỉ lễ', paid: true as const }]
        .filter((holiday, index, values) => values.findIndex((item) => item.date === holiday.date) === index)
        .sort((left, right) => left.date.localeCompare(right.date))
    }));
    setNewHoliday('');
  };

  const removeHoliday = (date: string) => {
    setConfig(prev => ({
      ...prev,
      holidays: (prev.holidays || []).filter(d => d !== date),
      holidayDetails: (prev.holidayDetails || []).filter((holiday) => holiday.date !== date)
    }));
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await updateScheduleConfig(config);
      alert('Đã lưu cấu hình tuần lễ');
    } catch (error) {
      console.error(error);
      alert('Lỗi lưu cấu hình');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-300">
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6">
        <h3 className="text-lg font-bold text-white mb-6 flex items-center gap-2">
          <CalendarDays className="w-5 h-5 text-pink-500" />
          Ngày làm việc trong tuần
        </h3>
        
        <div className="flex flex-wrap gap-3">
          {ALL_DAYS.map(day => {
            const isActive = config.workingDays.includes(day.id);
            return (
              <button
                key={day.id}
                onClick={() => toggleDay(day.id)}
                className={`px-4 py-2 rounded-xl text-sm font-medium transition-all ${
                  isActive 
                    ? 'bg-pink-500 text-white shadow-lg shadow-pink-500/20' 
                    : 'bg-zinc-800 text-zinc-400 hover:text-white border border-zinc-700'
                }`}
              >
                {day.label}
              </button>
            )
          })}
        </div>
      </div>

      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6">
        <h3 className="text-lg font-bold text-white mb-2 flex items-center gap-2">
          <Gauge className="w-5 h-5 text-sky-400" />
          Công suất đồng thời theo chi nhánh
        </h3>
        <p className="text-sm text-zinc-400 mb-5">
          Giới hạn tổng số học viên trong cùng một khung giờ, tính trên tất cả PT. Để trống nếu chi nhánh không cần giới hạn.
        </p>
        {branches.filter((branch) => branch.status !== 'archived').length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {branches.filter((branch) => branch.status !== 'archived').map((branch) => {
              const configuredCapacity = config.branchCapacityBySlot?.[branch.id]?.default;
              const capacity = typeof configuredCapacity === 'number' && configuredCapacity > 0 ? configuredCapacity : '';
              return (
                <label key={branch.id} className="flex items-center justify-between gap-4 bg-zinc-950/70 border border-zinc-800 rounded-xl px-4 py-3">
                  <span className="min-w-0">
                    <strong className="block text-sm text-white truncate">{branch.name}</strong>
                    <small className="text-zinc-500">Tổng học viên / một khung giờ</small>
                  </span>
                  <input
                    type="number"
                    min="1"
                    max="500"
                    inputMode="numeric"
                    aria-label={`Công suất đồng thời của ${branch.name}`}
                    value={capacity ?? ''}
                    placeholder="∞"
                    onChange={(event) => setBranchCapacity(branch.id, event.target.value)}
                    className="w-24 bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-right text-white focus:outline-none focus:border-sky-400"
                  />
                </label>
              );
            })}
          </div>
        ) : (
          <div className="text-center py-6 border border-dashed border-zinc-800 rounded-xl text-zinc-500 text-sm">
            Chưa có chi nhánh hoạt động để cấu hình.
          </div>
        )}
      </div>

      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6">
        <h3 className="text-lg font-bold text-white mb-6 flex items-center gap-2">
          <Clock className="w-5 h-5 text-emerald-500" />
          Khung giờ hoạt động
        </h3>
        
        <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 gap-2">
          {Array.from({ length: 17 }, (_, i) => i + 5).map(hour => {
            const isActive = config.workingHours.includes(hour);
            return (
              <button
                key={hour}
                onClick={() => toggleHour(hour)}
                className={`py-2 rounded-lg text-sm font-medium transition-all ${
                  isActive 
                    ? 'bg-emerald-500 text-white shadow-lg shadow-emerald-500/20' 
                    : 'bg-zinc-800 text-zinc-400 hover:text-white border border-zinc-700'
                }`}
              >
                {hour}:00
              </button>
            )
          })}
        </div>
      </div>

      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-lg font-bold text-white flex items-center gap-2">
            <Lock className="w-5 h-5 text-orange-500" />
            Tự động chốt lịch (Deadline)
          </h3>
          <button
            onClick={() => setConfig(prev => ({ ...prev, isAutoLockEnabled: !prev.isAutoLockEnabled }))}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${config.isAutoLockEnabled ? 'bg-pink-500' : 'bg-zinc-700'}`}
          >
            <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${config.isAutoLockEnabled ? 'translate-x-6' : 'translate-x-1'}`} />
          </button>
        </div>
        
        {config.isAutoLockEnabled && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 animate-in fade-in slide-in-from-top-4">
            <div>
              <label className="block text-sm font-medium text-zinc-400 mb-2">Ngày chốt lịch (cho tuần tiếp theo)</label>
              <select
                value={config.lockDayOfWeek}
                onChange={(e) => setConfig(prev => ({ ...prev, lockDayOfWeek: parseInt(e.target.value) }))}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-pink-500"
              >
                <option value="6">Thứ 7</option>
                <option value="0">Chủ nhật</option>
                <option value="1">Thứ 2</option>
                <option value="2">Thứ 3</option>
                <option value="3">Thứ 4</option>
                <option value="4">Thứ 5</option>
                <option value="5">Thứ 6</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-zinc-400 mb-2">Giờ chốt lịch</label>
              <select
                value={config.lockHour}
                onChange={(e) => setConfig(prev => ({ ...prev, lockHour: parseInt(e.target.value) }))}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-pink-500"
              >
                {Array.from({ length: 24 }, (_, i) => (
                  <option key={i} value={i}>{i.toString().padStart(2, '0')}:00</option>
                ))}
              </select>
            </div>
          </div>
        )}
      </div>

      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6">
        <h3 className="text-lg font-bold text-white mb-6 flex items-center gap-2">
          <CalendarOff className="w-5 h-5 text-red-500" />
          Ngày nghỉ lễ
        </h3>
        <p className="text-sm text-zinc-400 mb-4">
          Thêm các ngày nghỉ lễ. Hệ thống sẽ tự động đóng và không thể xếp lịch vào các ngày này.
        </p>
        
        <div className="flex items-center gap-4 mb-6">
          <input
            type="date"
            value={newHoliday}
            onChange={(e) => setNewHoliday(e.target.value)}
            className="flex-1 bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-pink-500"
          />
          <button
            onClick={addHoliday}
            disabled={!newHoliday}
            className="bg-zinc-800 text-white px-6 py-3 rounded-xl font-bold hover:bg-zinc-700 transition-colors disabled:opacity-50"
          >
            Thêm
          </button>
        </div>

        {config.holidays && config.holidays.length > 0 ? (
          <div className="flex flex-wrap gap-3">
            {config.holidays.map(date => (
              <div key={date} className="flex items-center gap-2 bg-zinc-800/50 border border-zinc-700 rounded-lg px-3 py-2">
                <span className="text-sm text-zinc-300 font-medium">{new Date(date).toLocaleDateString('vi-VN')}</span>
                <button
                  onClick={() => removeHoliday(date)}
                  className="p-1 hover:bg-zinc-700 rounded-full text-zinc-400 hover:text-red-400 transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-6 border border-dashed border-zinc-800 rounded-xl">
            <p className="text-zinc-500 text-sm">Chưa có ngày nghỉ lễ nào</p>
          </div>
        )}
      </div>

      <div className="flex justify-end">
        <button
          onClick={handleSave}
          disabled={isSaving}
          className="bg-white text-black px-8 py-3 rounded-xl font-bold flex items-center gap-2 hover:bg-zinc-200 transition-colors disabled:opacity-50"
        >
          <Save className="w-5 h-5" />
          {isSaving ? 'Đang lưu...' : 'Lưu cấu hình'}
        </button>
      </div>
    </div>
  );
}
