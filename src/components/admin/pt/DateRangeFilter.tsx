import React, { useState } from 'react';
import { Calendar } from 'lucide-react';

interface Props {
  onFilter: (start: Date, end: Date) => void;
  excludeFuture?: boolean;
}

export default function DateRangeFilter({ onFilter, excludeFuture }: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const [range, setRange] = useState('Tất cả');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');

  React.useEffect(() => {
    applyFilter(range);
  }, []);

  const applyFilter = (r: string, start?: Date, end?: Date) => {
    let s = start || new Date();
    let e = end || new Date();

    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

    switch (r) {
      case 'Tất cả':
        s = new Date(0);
        e = new Date(8640000000000000); // Max date
        break;
      case 'Hôm nay':
        s = startOfToday;
        e = endOfToday;
        break;
      case 'Ngày mai':
        s = new Date(startOfToday); s.setDate(s.getDate() + 1);
        e = new Date(endOfToday); e.setDate(e.getDate() + 1);
        break;
      case 'Hôm qua':
        s = new Date(startOfToday); s.setDate(s.getDate() - 1);
        e = new Date(endOfToday); e.setDate(e.getDate() - 1);
        break;
      case 'Tuần này':
        const day = now.getDay(); // 0 is Sunday
        const diff = now.getDate() - day + (day === 0 ? -6 : 1); // Adjust to Monday
        s = new Date(now.setDate(diff)); s.setHours(0, 0, 0, 0);
        e = new Date(s); e.setDate(e.getDate() + 6); e.setHours(23, 59, 59, 999);
        break;
      case 'Tuần sau':
        const dayNext = now.getDay();
        const diffNext = now.getDate() - dayNext + (dayNext === 0 ? -6 : 1) + 7;
        s = new Date(now.setDate(diffNext)); s.setHours(0, 0, 0, 0);
        e = new Date(s); e.setDate(e.getDate() + 6); e.setHours(23, 59, 59, 999);
        break;
      case 'Tháng này':
        s = new Date(now.getFullYear(), now.getMonth(), 1);
        e = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
        break;
      case 'Tháng trước':
        s = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        e = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
        break;
    }
    onFilter(s, e);
  };

  const options = ['Tất cả', 'Hôm nay', 'Hôm qua', 'Tuần này', 'Tháng này', 'Tháng trước'];
  if (!excludeFuture) {
    options.splice(2, 0, 'Ngày mai');
    options.splice(5, 0, 'Tuần sau');
  }

  return (
    <div className="relative w-full">
      <button onClick={() => setIsOpen(!isOpen)} className="w-full flex items-center justify-between gap-2 bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-2.5 text-zinc-400 hover:text-white hover:bg-zinc-800/50 transition-colors whitespace-nowrap">
        <div className="flex items-center gap-2 truncate">
          <Calendar className="w-4 h-4 shrink-0" />
          <span className="truncate text-sm">{range}</span>
        </div>
        <div className="shrink-0 text-xs text-zinc-500">▾</div>
      </button>
      {isOpen && (
        <div className="absolute top-full left-0 mt-2 bg-zinc-900 border border-zinc-800 rounded-xl p-2 shadow-xl z-[60] w-64 sm:w-48">
          {options.map(r => (
            <button key={r} onClick={() => { setRange(r); applyFilter(r); setIsOpen(false); }} className="block w-full text-left px-4 py-2 text-zinc-300 hover:bg-zinc-800 rounded-lg text-sm">
              {r}
            </button>
          ))}
          <div className="border-t border-zinc-800 pt-2 mt-2">
            <input type="date" value={customStart} onChange={e => setCustomStart(e.target.value)} className="w-full bg-zinc-950 text-white p-2 rounded-lg mb-1" />
            <input type="date" value={customEnd} onChange={e => setCustomEnd(e.target.value)} className="w-full bg-zinc-950 text-white p-2 rounded-lg mb-2" />
            <button onClick={() => { 
              setRange('Tùy chỉnh'); 
              
              let sDate = new Date();
              if (customStart) {
                const [y, m, d] = customStart.split('-').map(Number);
                sDate = new Date(y, m - 1, d, 0, 0, 0, 0);
              }
              
              let eDate = new Date();
              if (customEnd) {
                const [y, m, d] = customEnd.split('-').map(Number);
                eDate = new Date(y, m - 1, d, 23, 59, 59, 999);
              }
              
              applyFilter('Tùy chỉnh', sDate, eDate); 
              setIsOpen(false); 
            }} className="w-full bg-pink-500 text-white py-2 rounded-lg">Áp dụng</button>
          </div>
        </div>
      )}
    </div>
  );
}
