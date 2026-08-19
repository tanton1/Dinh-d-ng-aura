import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Search, Filter, ChevronRight, X, Clock, Flame, Info } from 'lucide-react';
import { HealthyDish } from '../../types';
import { fetchHealthyDishes } from '../../services/dishService';

interface Props {
  onNavigate?: (screen: string) => void;
}

export default function DishCollection({ onNavigate }: Props = {}) {
  const [dishes, setDishes] = useState<HealthyDish[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [selectedDish, setSelectedDish] = useState<HealthyDish | null>(null);

  useEffect(() => {
    const loadDishes = async () => {
      try {
        const data = await fetchHealthyDishes();
        setDishes(data);
      } catch (error) {
        console.error('Error fetching dishes:', error);
      } finally {
        setLoading(false);
      }
    };
    loadDishes();
  }, []);

  const categories = ['all', 'breakfast', 'lunch', 'dinner', 'snack'];

  const filteredDishes = dishes.filter(dish => {
    const matchesSearch = dish.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         dish.ingredients.some(i => i.toLowerCase().includes(searchTerm.toLowerCase()));
    const matchesCategory = selectedCategory === 'all' || dish.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  if (loading) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-pink-500"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-950 pb-24">
      {/* Header */}
      <div className="bg-zinc-900 p-6 rounded-b-3xl shadow-sm sticky top-0 z-20">
        <div className="flex items-center gap-4 mb-4">
          {onNavigate && (
            <button 
              onClick={() => onNavigate('nutrition')}
              className="p-2 bg-zinc-800 rounded-full text-zinc-400 hover:text-white transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          )}
          <h1 className="text-2xl font-serif font-medium text-white">Thư viện Món ăn Healthy</h1>
        </div>
        
        <div className="relative mb-4">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-zinc-500" />
          <input
            type="text"
            placeholder="Tìm món ăn hoặc nguyên liệu..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-zinc-800 border border-zinc-700 rounded-xl pl-10 pr-4 py-3 text-white placeholder-zinc-500 focus:outline-none focus:border-pink-500"
          />
        </div>

        <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
          {categories.map(cat => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              className={`px-4 py-2 rounded-full text-xs font-bold uppercase tracking-wider whitespace-nowrap transition-all border ${
                selectedCategory === cat 
                  ? 'bg-pink-500 text-white border-pink-500 shadow-[0_0_10px_rgba(255,0,127,0.3)]' 
                  : 'bg-zinc-800 text-zinc-500 border-zinc-700 hover:text-zinc-300'
              }`}
            >
              {cat === 'all' ? 'Tất cả' : cat === 'breakfast' ? 'Sáng' : cat === 'lunch' ? 'Trưa' : cat === 'dinner' ? 'Tối' : 'Phụ'}
            </button>
          ))}
        </div>
      </div>

      {/* Dish Grid */}
      <div className="p-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filteredDishes.map(dish => (
          <motion.div
            layoutId={dish.id}
            key={dish.id}
            onClick={() => setSelectedDish(dish)}
            className="bg-zinc-900 rounded-2xl overflow-hidden border border-zinc-800 hover:border-pink-500/50 transition-colors cursor-pointer group"
          >
            <div className="aspect-video relative overflow-hidden">
              <img 
                src={dish.image || `https://picsum.photos/seed/${dish.id}/400/300`} 
                alt={dish.name}
                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                referrerPolicy="no-referrer"
              />
              <div className="absolute top-2 right-2 bg-black/60 backdrop-blur-md px-2 py-1 rounded-lg text-[10px] font-bold text-white uppercase">
                {dish.category}
              </div>
            </div>
            <div className="p-4">
              <h3 className="text-white font-medium mb-2 group-hover:text-pink-400 transition-colors">{dish.name}</h3>
              <div className="flex justify-between items-center text-xs text-zinc-500">
                <div className="flex items-center gap-1">
                  <Flame className="w-3 h-3 text-orange-500" />
                  <span>{dish.calories} kcal</span>
                </div>
                <div className="flex items-center gap-3">
                  <span>P: {dish.protein}g</span>
                  <span>C: {dish.carbs}g</span>
                  <span>F: {dish.fat}g</span>
                </div>
              </div>
            </div>
          </motion.div>
        ))}
      </div>

      {/* Detail Modal */}
      <AnimatePresence>
        {selectedDish && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSelectedDish(null)}
              className="absolute inset-0 bg-black/90 backdrop-blur-sm"
            />
            <motion.div
              layoutId={selectedDish.id}
              className="relative bg-zinc-900 w-full max-w-2xl max-h-[90vh] rounded-3xl overflow-hidden border border-zinc-800 flex flex-col"
            >
              <button 
                onClick={() => setSelectedDish(null)}
                className="absolute top-4 right-4 z-10 bg-black/50 p-2 rounded-full text-white hover:bg-pink-500 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>

              <div className="overflow-y-auto">
                <img 
                  src={selectedDish.image || `https://picsum.photos/seed/${selectedDish.id}/800/600`} 
                  alt={selectedDish.name}
                  className="w-full aspect-video object-cover"
                  referrerPolicy="no-referrer"
                />
                
                <div className="p-6">
                  <div className="flex justify-between items-start mb-6">
                    <div>
                      <h2 className="text-2xl font-serif font-medium text-white mb-1">{selectedDish.name}</h2>
                      <p className="text-pink-500 text-sm font-medium uppercase tracking-widest">{selectedDish.category}</p>
                    </div>
                    <div className="text-right">
                      <div className="text-3xl font-light text-white">{selectedDish.calories}</div>
                      <div className="text-zinc-500 text-xs uppercase tracking-tighter">Calories / {selectedDish.portion || 'phần'}</div>
                    </div>
                  </div>

                  {/* Macros Grid */}
                  <div className="grid grid-cols-3 gap-4 mb-8">
                    <div className="bg-zinc-800/50 p-3 rounded-2xl border border-zinc-800 text-center">
                      <div className="text-zinc-500 text-[10px] uppercase font-bold mb-1">Protein</div>
                      <div className="text-white font-medium">{selectedDish.protein}g</div>
                    </div>
                    <div className="bg-zinc-800/50 p-3 rounded-2xl border border-zinc-800 text-center">
                      <div className="text-zinc-500 text-[10px] uppercase font-bold mb-1">Carbs</div>
                      <div className="text-white font-medium">{selectedDish.carbs}g</div>
                    </div>
                    <div className="bg-zinc-800/50 p-3 rounded-2xl border border-zinc-800 text-center">
                      <div className="text-zinc-500 text-[10px] uppercase font-bold mb-1">Fat</div>
                      <div className="text-white font-medium">{selectedDish.fat}g</div>
                    </div>
                  </div>

                  {/* Ingredients */}
                  <div className="mb-8">
                    <h4 className="text-white font-medium mb-3 flex items-center gap-2">
                      <Info className="w-4 h-4 text-pink-500" />
                      Nguyên liệu
                    </h4>
                    <ul className="grid grid-cols-1 md:grid-cols-2 gap-2">
                      {selectedDish.ingredients.map((ing, i) => (
                        <li key={i} className="flex items-center gap-2 text-zinc-400 text-sm">
                          <div className="w-1 h-1 rounded-full bg-pink-500" />
                          {ing}
                        </li>
                      ))}
                    </ul>
                  </div>

                  {/* Instructions */}
                  {selectedDish.instructions && (
                    <div className="mb-4">
                      <h4 className="text-white font-medium mb-3 flex items-center gap-2">
                        <Clock className="w-4 h-4 text-pink-500" />
                        Cách chế biến
                      </h4>
                      <div className="space-y-4">
                        {selectedDish.instructions.map((step, i) => (
                          <div key={i} className="flex gap-4">
                            <div className="shrink-0 w-6 h-6 rounded-full bg-zinc-800 border border-zinc-700 flex items-center justify-center text-[10px] font-bold text-pink-500">
                              {i + 1}
                            </div>
                            <p className="text-zinc-400 text-sm leading-relaxed">{step}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
