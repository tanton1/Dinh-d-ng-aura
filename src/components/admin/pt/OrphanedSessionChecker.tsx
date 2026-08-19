import React, { useState } from 'react';
import { useDatabase } from '../../../contexts/DatabaseContext';
import { Session } from '../../../types';

export const OrphanedSessionChecker: React.FC = () => {
  const { sessions, schedules, deleteSession } = useDatabase();
  const [orphans, setOrphans] = useState<Session[]>([]);
  const [isScanning, setIsScanning] = useState(false);

  const findOrphans = () => {
    setIsScanning(true);
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const found = sessions.filter(s => {
      // Chỉ quét các buổi tập chưa diễn ra (scheduled)
      if (s.status !== 'scheduled') return false;
      
      // BỎ QUA các buổi tập đã qua (chỉ quét từ hôm nay trở đi)
      const sessionDate = new Date(s.date);
      sessionDate.setHours(0, 0, 0, 0);
      if (sessionDate < today) return false;
      
      // Nếu không có scheduleEntryId thì chắc chắn là mồ côi
      if (!s.scheduleEntryId) return true;
      
      // scheduleEntryId có dạng: schedule_YYYY-MM-DD-T2-8-studentId
      const weekId = s.scheduleEntryId.substring(0, 19);
      const rest = s.scheduleEntryId.substring(20);
      const parts = rest.split('-');
      
      if (parts.length < 3) return true; // Lỗi định dạng
      
      const dayCode = parts[0];
      const hour = parts[1];
      const studentId = parts.slice(2).join('-');
      const slotId = `${dayCode}-${hour}`;

      const scheduleWeek = schedules[weekId];
      if (!scheduleWeek || !scheduleWeek.schedule) return true; // Tuần này không tồn tại trong ma trận
      
      const entries = scheduleWeek.schedule[slotId];
      if (!entries) return true; // Khung giờ này không tồn tại trong ma trận
      
      // Kiểm tra xem học viên có nằm trong khung giờ này không
      return !entries.some(e => e.studentId === studentId && e.type !== 'off');
    });
    
    setOrphans(found);
    setIsScanning(false);
  };

  const handleFixAll = async () => {
    if (!confirm(`Bạn có chắc chắn muốn xóa ${orphans.length} buổi tập mồ côi này không?`)) return;
    
    for (const orphan of orphans) {
      await deleteSession(orphan.id);
    }
    
    alert('Đã dọn dẹp xong!');
    findOrphans(); // Quét lại
  };

  return (
    <div className="p-4 bg-zinc-900/50 rounded-xl border border-zinc-800 mb-6">
      <div className="flex justify-between items-center mb-4">
        <div>
          <h2 className="text-white font-bold text-lg">Công cụ dọn dẹp dữ liệu lịch tập</h2>
          <p className="text-sm text-zinc-400">Quét và xóa các buổi tập bị lỗi đồng bộ (có ở Lương nhưng không có ở Ma trận xếp lịch).</p>
        </div>
        <button 
          onClick={findOrphans} 
          disabled={isScanning}
          className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg font-medium transition-colors"
        >
          {isScanning ? 'Đang quét...' : 'Quét dữ liệu'}
        </button>
      </div>

      {orphans.length > 0 && (
        <div className="mt-4">
          <div className="flex justify-between items-center mb-2">
            <span className="text-red-400 font-medium">Phát hiện {orphans.length} buổi tập mồ côi:</span>
            <button 
              onClick={handleFixAll}
              className="bg-red-600 hover:bg-red-500 text-white px-3 py-1.5 rounded-lg text-sm font-medium transition-colors"
            >
              Xóa tất cả lỗi
            </button>
          </div>
          <div className="max-h-40 overflow-y-auto bg-zinc-950 rounded-lg border border-zinc-800 p-2">
            {orphans.map(o => (
              <div key={o.id} className="flex justify-between items-center p-2 border-b border-zinc-800/50 last:border-0 text-sm">
                <span className="text-zinc-300">
                  <span className="text-zinc-500 mr-2">{o.date}</span>
                  Học viên ID: {o.studentId}
                </span>
                <button 
                  onClick={() => deleteSession(o.id).then(findOrphans)} 
                  className="text-red-500 hover:text-red-400 px-2 py-1"
                >
                  Xóa
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
      
      {orphans.length === 0 && isScanning === false && (
        <div className="text-emerald-500 text-sm font-medium mt-2">
          Hệ thống đang hoạt động tốt, không có dữ liệu mồ côi. (Hãy bấm Quét để kiểm tra)
        </div>
      )}
    </div>
  );
};
