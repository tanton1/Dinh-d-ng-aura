import React, { useState, useEffect } from 'react';
import { Student, ScheduleConfig } from '../../../types';
import { Save, X } from 'lucide-react';

interface Props {
  onSave: (student: Student) => void;
  initialData?: Student | null;
  onCancelEdit?: () => void;
  isAvailabilityOnly?: boolean;
  scheduleConfig: ScheduleConfig;
  isAdmin?: boolean;
}

export default function StudentForm({ onSave, initialData, onCancelEdit, isAvailabilityOnly, scheduleConfig, isAdmin }: Props) {
  const [name, setName] = useState('');
  const [sessions, setSessions] = useState(3);
  const [selectedSlots, setSelectedSlots] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (initialData) {
      setName(initialData.name);
      setSessions(initialData.sessionsPerWeek);
      setSelectedSlots(new Set(initialData.availableSlots || []));
    } else {
      setName('');
      setSessions(3);
      setSelectedSlots(new Set());
    }
  }, [initialData]);

  const toggleSlot = (slot: string) => {
    const newSlots = new Set(selectedSlots);
    if (newSlots.has(slot)) {
      newSlots.delete(slot);
    } else {
      newSlots.add(slot);
    }
    setSelectedSlots(newSlots);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    
    onSave({
      ...(initialData || {}),
      id: initialData ? initialData.id : Date.now().toString(),
      name: name.trim(),
      sessionsPerWeek: sessions,
      availableSlots: Array.from(selectedSlots)
    });

    if (!initialData) {
      setName('');
      setSessions(3);
      setSelectedSlots(new Set());
    }
  };

  return (
    <div className="bg-transparent md:bg-zinc-900 p-0 md:p-6 md:rounded-2xl md:shadow-xl md:border border-zinc-800">
      <div className="mb-8 flex justify-between items-start">
        <div>
          <h2 className="text-xl md:text-2xl font-black text-pink-500 drop-shadow-[0_0_10px_rgba(236,72,153,0.8)] uppercase tracking-wide flex items-center gap-3 border-b-2 border-pink-500/30 pb-2 inline-block shadow-[0_4px_0_rgba(236,72,153,0.2)] rounded-xl">
            <span className="w-2 h-8 bg-pink-500 rounded-full shadow-[0_0_10px_rgba(236,72,153,0.8)]"></span>
            {isAvailabilityOnly ? `Lịch rảnh mặc định: ${name}` : (initialData ? 'Thông Tin Học Viên' : 'Thêm Học Viên Mới')}
          </h2>
          <p className="text-zinc-400 mt-2">
            {isAvailabilityOnly
              ? 'Đây là lịch fallback. Lịch chính thức từng tuần do học viên gửi tại trang Lịch học viên.'
              : 'Nhập thông tin và thiết lập lịch fallback; lịch theo tuần được quản lý riêng.'}
          </p>
        </div>
        {initialData && onCancelEdit && (
          <button 
            onClick={onCancelEdit}
            className="text-zinc-500 hover:text-white p-2 rounded-lg hover:bg-zinc-800 transition-colors"
            title="Hủy sửa"
          >
            <X size={24} />
          </button>
        )}
      </div>

      <form onSubmit={handleSubmit} className="space-y-8">
        {!isAvailabilityOnly && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <label className="block text-sm font-bold text-zinc-300 uppercase tracking-wider">Tên học viên</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-4 py-3 bg-zinc-950 border border-zinc-800 rounded-xl focus:ring-2 focus:ring-pink-500 focus:border-pink-500 outline-none text-white placeholder-zinc-600 transition-all"
                placeholder="VD: Nguyễn Văn A"
                required={!isAvailabilityOnly}
              />
            </div>
            <div className="space-y-2">
              <label className="block text-sm font-bold text-zinc-300 uppercase tracking-wider">Số buổi / tuần</label>
              <div className="relative">
                <input
                  type="number"
                  min="1"
                  max="6"
                  value={sessions || ''}
                  onChange={(e) => setSessions(parseInt(e.target.value) || 0)}
                  disabled={!isAdmin}
                  className={`w-full px-4 py-3 bg-zinc-950 border border-zinc-800 rounded-xl focus:ring-2 focus:ring-pink-500 focus:border-pink-500 outline-none text-white transition-all appearance-none ${!isAdmin ? 'opacity-60 cursor-not-allowed hidden' : ''}`}
                  required={!isAvailabilityOnly}
                />
                {!isAdmin && (
                  <div className="w-full px-4 py-3 bg-zinc-900 border border-zinc-800 rounded-xl text-white">
                    {sessions} <span className="text-zinc-500">buổi/tuần</span>
                  </div>
                )}
                {isAdmin && (
                  <div className="absolute right-4 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none font-medium">
                    buổi
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        <div className="space-y-4">
          <div className="flex justify-between items-end">
            <label className="block text-sm font-bold text-zinc-300 uppercase tracking-wider">
              Lịch rảnh mặc định (fallback)
            </label>
            <span className="text-xs text-pink-400 font-medium bg-pink-500/10 px-3 py-1 rounded-full border border-pink-500/20">
              Đã chọn: {selectedSlots.size} slots
            </span>
          </div>
          
          
          <div className="mx-0 md:mx-0 overflow-hidden hide-scrollbar rounded-xl border border-zinc-800 bg-zinc-950 w-full">
            <table className="w-full text-xs md:text-sm text-left border-collapse table-fixed">
              <thead>
                <tr>
                  <th className="border-b border-r border-zinc-800 p-1 md:p-2 bg-zinc-900 w-10 md:w-20 text-center font-bold text-zinc-400 uppercase sticky left-0 z-20 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.5)]">Giờ</th>
                  {scheduleConfig.workingDays.map((day: string) => (
                    <th key={day} className="border-b border-r border-zinc-800 p-1 md:p-2 bg-zinc-900 text-center font-bold text-zinc-300 uppercase tracking-wider">
                      <div className="flex flex-col items-center justify-center">
                        <span>{day}</span>
                        <span className="text-[9px] md:text-[10px] text-zinc-500 font-normal mt-0.5">Hàng tuần</span>
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {scheduleConfig.workingHours.map((hour: number) => (
                  <tr key={hour} className="group">
                    <td className="border-b border-r border-zinc-800 p-1 md:p-2 text-center font-mono font-bold bg-zinc-900 text-zinc-400 group-hover:text-zinc-200 transition-colors sticky left-0 z-10 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.5)]">
                      {hour}h
                    </td>
                    {scheduleConfig.workingDays.map((day: string) => {
                      const slotId = `${day}-${hour}`;
                      const isSelected = selectedSlots.has(slotId);
                      return (
                        <td 
                          key={slotId}
                          onClick={() => toggleSlot(slotId)}
                          className={`border-b border-r border-zinc-800 p-1 md:p-2 text-center text-base md:text-lg font-bold cursor-pointer transition-all duration-200 relative ${
                            isSelected 
                              ? 'bg-pink-600/20 text-pink-400 font-bold shadow-[inset_0_0_15px_rgba(236,72,153,0.3)]' 
                              : 'hover:bg-zinc-800 text-transparent hover:text-zinc-600'
                          }`}
                        >
                          {isSelected && (
                            <div className="absolute inset-0 border-2 border-pink-500 rounded-sm m-0.5 shadow-[0_0_10px_rgba(236,72,153,0.5)]"></div>
                          )}
                          {isSelected ? '✓' : '+'}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="flex justify-end pt-4">
          <button
            type="submit"
            className="w-full md:w-auto flex items-center justify-center gap-2 bg-zinc-100 text-zinc-900 px-8 py-3.5 md:py-3 rounded-xl font-bold hover:bg-white hover:shadow-[0_0_20px_rgba(255,255,255,0.3)] transition-all active:scale-95 uppercase tracking-wider"
          >
            <Save size={20} />
            {isAvailabilityOnly ? 'Lưu lịch mặc định' : 'Lưu Học Viên'}
          </button>
        </div>
      </form>
    </div>
  );
}
