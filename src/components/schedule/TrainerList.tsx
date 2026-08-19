import React, { useState } from 'react';
import { Trainer } from '../../types';
import { Trash2, Plus, UserCircle } from 'lucide-react';

interface Props {
  trainers: Trainer[];
  onAdd: (name: string, priority: number) => void;
  onDelete: (id: string) => void;
}

export default function TrainerList({ trainers, onAdd, onDelete }: Props) {
  const [name, setName] = useState('');
  const [priority, setPriority] = useState<number>(1);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    onAdd(name.trim(), priority);
    setName('');
  };

  return (
    <div className="bg-zinc-900 p-6 md:p-8 rounded-2xl shadow-xl border border-zinc-800">
      <div className="mb-8">
        <h2 className="text-2xl font-black text-white uppercase tracking-wide flex items-center gap-3">
          <span className="w-2 h-8 bg-pink-500 rounded-full shadow-[0_0_10px_rgba(236,72,153,0.8)]"></span>
          Quản lý Huấn Luyện Viên
        </h2>
        <p className="text-zinc-400 mt-2">Thêm hoặc xóa PT khỏi hệ thống.</p>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-4 mb-8">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="flex-1 px-4 py-3 bg-zinc-950 border border-zinc-800 rounded-xl focus:ring-2 focus:ring-pink-500 focus:border-pink-500 outline-none text-white placeholder-zinc-600 transition-all"
          placeholder="Tên PT mới..."
          required
        />
        <input
          type="number"
          value={priority}
          onChange={(e) => setPriority(parseInt(e.target.value))}
          className="w-20 px-4 py-3 bg-zinc-950 border border-zinc-800 rounded-xl focus:ring-2 focus:ring-pink-500 focus:border-pink-500 outline-none text-white placeholder-zinc-600 transition-all"
          placeholder="Ưu tiên"
          min="1"
        />
        <button
          type="submit"
          className="flex items-center justify-center gap-2 bg-pink-600 text-white px-6 py-3 rounded-xl font-bold hover:bg-pink-500 hover:shadow-[0_0_20px_rgba(236,72,153,0.4)] transition-all active:scale-95 uppercase tracking-wider shrink-0"
        >
          <Plus size={20} />
          Thêm PT
        </button>
      </form>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {trainers.map(trainer => (
          <div key={trainer.id} className="bg-zinc-950 border border-zinc-800 p-4 rounded-xl flex justify-between items-center group hover:border-zinc-700 transition-colors">
            <div className="flex items-center gap-3">
              <UserCircle size={24} className="text-pink-500" />
              <span className="font-bold text-zinc-200">{trainer.name}</span>
              <span className="text-xs text-zinc-500 bg-zinc-900 px-2 py-1 rounded">Ưu tiên: {trainer.priority || 999}</span>
            </div>
            <button
              onClick={() => onDelete(trainer.id)}
              className="text-zinc-600 hover:text-red-500 p-2 rounded-lg hover:bg-red-500/10 transition-colors"
            >
              <Trash2 size={18} />
            </button>
          </div>
        ))}
        {trainers.length === 0 && (
          <div className="col-span-full text-center py-8 text-zinc-500">
            Chưa có PT nào. Hãy thêm PT để bắt đầu xếp lịch.
          </div>
        )}
      </div>
    </div>
  );
}
