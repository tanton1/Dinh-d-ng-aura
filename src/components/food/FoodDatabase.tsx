import React, { useState } from 'react';
import { motion } from 'motion/react';
import { ArrowLeft, Search, Filter } from 'lucide-react';
import { foodDb } from '../../data/foodDb';

type FoodCategory = 'carb' | 'protein' | 'veg' | 'snack' | 'mixed' | 'drink' | 'supplement';

interface Props {
  onNavigate?: (screen: string) => void;
}

const CATEGORIES: { id: FoodCategory | 'all'; label: string }[] = [
  { id: 'all', label: 'Tất cả' },
  { id: 'carb', label: 'Tinh bột' },
  { id: 'protein', label: 'Chất đạm' },
  { id: 'veg', label: 'Rau củ' },
  { id: 'snack', label: 'Ăn vặt & Trái cây' },
  { id: 'mixed', label: 'Món hỗn hợp' },
  { id: 'drink', label: 'Đồ uống' },
  { id: 'supplement', label: 'TP Bổ sung' },
];

export default function FoodDatabase({ onNavigate }: Props) {
  const [activeTab, setActiveTab] = useState<FoodCategory | 'all'>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const filteredFoods = foodDb.filter(food => {
    const matchesCategory = activeTab === 'all' || food.category === activeTab;
    const matchesSearch = (food.name || '').toLowerCase().includes(searchQuery.toLowerCase());
    return matchesCategory && matchesSearch;
  });

  return (
    <div className="min-h-screen bg-zinc-950 pb-24">
      <div className="bg-zinc-900 p-6 rounded-b-3xl shadow-sm sticky top-0 z-10">
        <div className="flex items-center gap-4 mb-6">
          {onNavigate && (
            <button 
              onClick={() => onNavigate('meal-plan')}
              className="p-2 bg-zinc-800 rounded-full text-zinc-400 hover:text-white transition-colors"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
          )}
          <h1 className="text-2xl font-serif font-medium text-white">
            Kho thực phẩm
          </h1>
        </div>

        {/* Search */}
        <div className="relative mb-6">
          <Search className="w-5 h-5 absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-400" />
          <input
            type="text"
            placeholder="Tìm kiếm thực phẩm, món ăn..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-zinc-800 text-white pl-11 pr-4 py-3 rounded-xl border border-zinc-700/50 focus:outline-none focus:border-pink-500 text-sm"
          />
        </div>

        {/* Categories */}
        <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-none -mx-6 px-6">
          {CATEGORIES.map(cat => (
            <button
              key={cat.id}
              onClick={() => setActiveTab(cat.id)}
              className={`px-4 py-2 rounded-xl text-sm font-medium whitespace-nowrap transition-all ${
                activeTab === cat.id
                  ? 'bg-pink-500 text-white shadow-lg shadow-pink-500/25'
                  : 'bg-zinc-800 text-zinc-400 hover:text-white hover:bg-zinc-700'
              }`}
            >
              {cat.label}
            </button>
          ))}
        </div>
      </div>

      {/* Food List */}
      <div className="p-6">
        <div className="grid grid-cols-1 gap-3">
          {filteredFoods.map((food, idx) => (
            <motion.div
              key={food.id || idx}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-zinc-900 border border-zinc-800/80 rounded-2xl p-4 flex flex-col justify-between"
            >
              <div className="flex justify-between items-start mb-3">
                <div>
                  <h3 className="font-medium text-white text-base mb-1">{food.name || 'Món ăn'}</h3>
                  <p className="text-xs text-zinc-400">
                    Đơn vị: <span className="text-zinc-300 font-medium">{food.portion_common || '100g'}</span>
                  </p>
                </div>
                {food.trigger_food && (
                  <span className="bg-red-500/10 text-red-400 text-xs px-2 py-1 rounded-md font-medium whitespace-nowrap">
                    Hạn chế
                  </span>
                )}
              </div>

              <div className="grid grid-cols-4 gap-2 pt-3 border-t border-zinc-800/50">
                <div className="bg-zinc-800/50 rounded-lg p-2 text-center">
                  <p className="text-xs text-zinc-500 mb-1">Kcal</p>
                  <p className="font-medium text-pink-400">{food.macros?.kcal || 0}</p>
                </div>
                <div className="bg-zinc-800/50 rounded-lg p-2 text-center">
                  <p className="text-xs text-zinc-500 mb-1">Pro</p>
                  <p className="font-medium text-white">{food.macros?.protein || 0}g</p>
                </div>
                <div className="bg-zinc-800/50 rounded-lg p-2 text-center">
                  <p className="text-xs text-zinc-500 mb-1">Carb</p>
                  <p className="font-medium text-white">{food.macros?.carb || 0}g</p>
                </div>
                <div className="bg-zinc-800/50 rounded-lg p-2 text-center">
                  <p className="text-xs text-zinc-500 mb-1">Fat</p>
                  <p className="font-medium text-white">{food.macros?.fat || 0}g</p>
                </div>
              </div>
            </motion.div>
          ))}

          {filteredFoods.length === 0 && (
            <div className="text-center py-12 text-zinc-500">
              Không tìm thấy món ăn nào phù hợp.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
