import React from 'react';
import { Trainer } from '../../../types';
import { Star, GripVertical, ChevronUp, ChevronDown, X } from 'lucide-react';

interface Props {
  trainers: Trainer[];
  selectedTrainerIds: string[];
  onChange: (trainerIds: string[]) => void;
}

export default function TrainerPrioritySelector({ trainers, selectedTrainerIds, onChange }: Props) {
  const handleToggle = (trainerId: string) => {
    if (selectedTrainerIds.includes(trainerId)) {
      onChange(selectedTrainerIds.filter(id => id !== trainerId));
    } else {
      onChange([...selectedTrainerIds, trainerId]);
    }
  };

  const moveUp = (index: number) => {
    if (index === 0) return;
    const newIds = [...selectedTrainerIds];
    const temp = newIds[index - 1];
    newIds[index - 1] = newIds[index];
    newIds[index] = temp;
    onChange(newIds);
  };

  const moveDown = (index: number) => {
    if (index === selectedTrainerIds.length - 1) return;
    const newIds = [...selectedTrainerIds];
    const temp = newIds[index + 1];
    newIds[index + 1] = newIds[index];
    newIds[index] = temp;
    onChange(newIds);
  };

  const getTrainerName = (id: string) => trainers.find(t => t.id === id)?.name || 'Unknown Trainer';

  return (
    <div className="space-y-4">
      {selectedTrainerIds.length > 0 && (
        <div className="bg-zinc-900/50 p-3 rounded-xl border border-zinc-800 space-y-2">
          <p className="text-xs font-medium text-zinc-400 uppercase tracking-wider mb-2">Thứ tự ưu tiên ghép lớp</p>
          {selectedTrainerIds.map((tId, index) => (
            <div key={tId} className="flex items-center justify-between bg-zinc-800 p-2 rounded-lg border border-zinc-700">
              <div className="flex items-center gap-2">
                {index === 0 ? (
                  <span className="flex items-center gap-1 text-[10px] uppercase font-bold bg-amber-500/20 text-amber-500 px-2 py-1 rounded-md border border-amber-500/20">
                    <Star className="w-3 h-3" /> PT Chính
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-[10px] uppercase font-bold bg-zinc-700 text-zinc-300 px-2 py-1 rounded-md">
                    PT Phụ {index}
                  </span>
                )}
                <span className="text-sm font-medium text-white">{getTrainerName(tId)}</span>
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => moveUp(index)}
                  disabled={index === 0}
                  className="p-1 text-zinc-400 hover:text-white disabled:opacity-30 transition-colors"
                >
                  <ChevronUp className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => moveDown(index)}
                  disabled={index === selectedTrainerIds.length - 1}
                  className="p-1 text-zinc-400 hover:text-white disabled:opacity-30 transition-colors"
                >
                  <ChevronDown className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => handleToggle(tId)}
                  className="p-1 text-red-400 hover:text-red-300 transition-colors ml-2"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-2 gap-2 max-h-48 overflow-y-auto p-2 border border-zinc-800 rounded-xl bg-zinc-950">
        {trainers.filter(t => t.status === 'active').map(t => (
          <label key={t.id} className="flex items-center gap-2 text-white cursor-pointer hover:bg-zinc-900 p-2 rounded-lg">
            <input
              type="checkbox"
              checked={selectedTrainerIds.includes(t.id)}
              onChange={() => handleToggle(t.id)}
              className="rounded border-zinc-700 bg-zinc-900 text-pink-500 focus:ring-pink-500"
            />
            <span className="text-sm">{t.name}</span>
          </label>
        ))}
      </div>
    </div>
  );
}
