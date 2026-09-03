import React, { useState } from 'react';
import { TrainingPackage, Branch, UserProfile } from '../../../types';
import { User } from 'firebase/auth';
import { Package, Plus, Edit2, Trash2, Clock, Hash, DollarSign, Building2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { LOGO_URL } from '../../../constants';
import { useDatabase } from '../../../contexts/DatabaseContext';

interface Props {
  user: User | null;
  profile?: UserProfile | null;
}

export default function PackageSettings({ user, profile }: Props) {
  const isTrainer = profile?.role === 'trainer';
  const { packages, branches, addPackage, updatePackage, deletePackage } = useDatabase();
  const [isEditing, setIsEditing] = useState(false);
  const [editingPackage, setEditingPackage] = useState<TrainingPackage | null>(null);
  
  // Form State
  const [formData, setFormData] = useState<Partial<TrainingPackage>>({
    name: '',
    totalSessions: 12,
    price: 0,
    durationMonths: 1,
    branchId: ''
  });

  const handleSave = async () => {
    if (!formData.name || !formData.totalSessions || !formData.price) {
      return;
    }

    if (editingPackage) {
      await updatePackage({ ...editingPackage, ...formData } as TrainingPackage);
    } else {
      const newPkg: TrainingPackage = {
        id: Date.now().toString(),
        name: formData.name,
        totalSessions: formData.totalSessions,
        price: formData.price,
        durationMonths: formData.durationMonths || 1,
        branchId: formData.branchId || undefined,
      };
      await addPackage(newPkg);
    }

    setIsEditing(false);
    setEditingPackage(null);
    setFormData({ name: '', totalSessions: 12, price: 0, durationMonths: 1 });
  };

  const handleDelete = async (id: string) => {
    if (confirm('Bạn có chắc chắn muốn xóa gói tập này?')) {
      await deletePackage(id);
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-300">
      <div className="flex justify-between items-center bg-zinc-900 p-6 rounded-2xl border border-zinc-800">
        <div className="flex items-center gap-3">
          <img src={LOGO_URL} alt="Aura" className="h-10 w-10 object-contain" />
          <h2 className="text-xl font-bold text-pink-500 drop-shadow-[0_0_10px_rgba(236,72,153,0.8)] flex items-center gap-2 border-b-2 border-pink-500/30 pb-2 inline-block shadow-[0_4px_0_rgba(236,72,153,0.2)] rounded-xl">
            <Package className="w-5 h-5 text-pink-500" />
            Danh sách gói tập
          </h2>
        </div>
        {!isTrainer && (
          <button 
            onClick={() => {
              setEditingPackage(null);
              setFormData({ name: '', totalSessions: 12, price: 0, durationMonths: 1 });
              setIsEditing(true);
            }}
            className="bg-pink-500 text-white px-4 py-2 rounded-xl font-medium hover:bg-pink-600 transition-colors flex items-center gap-2 shadow-[0_0_15px_rgba(255,0,127,0.3)]"
          >
            <Plus className="w-4 h-4" /> Thêm gói mới
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4">
        {packages.length > 0 ? packages.map(pkg => (
          <div key={pkg.id} className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 shadow-sm relative overflow-hidden group">
            <div className="absolute -right-4 -top-4 w-20 h-20 bg-pink-500/5 rounded-full blur-2xl group-hover:bg-pink-500/10 transition-colors"></div>
            
            <div className="flex justify-between items-start relative z-10">
              <div>
                <h3 className="text-lg font-bold text-white mb-3">{pkg.name}</h3>
                <div className="grid grid-cols-2 gap-x-6 gap-y-2">
                  <div className="flex items-center gap-2 text-sm text-zinc-400">
                    <Hash className="w-4 h-4 text-zinc-500" />
                    <span>{pkg.totalSessions} buổi tập</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm text-zinc-400">
                    <Clock className="w-4 h-4 text-zinc-500" />
                    <span>Hạn {pkg.durationMonths} tháng</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm text-zinc-400 col-span-2">
                    <Building2 className="w-4 h-4 text-zinc-500" />
                    <span>{pkg.branchId ? branches.find(b => b.id === pkg.branchId)?.name : 'Tất cả chi nhánh'}</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm text-pink-500 font-bold col-span-2 mt-1">
                    <DollarSign className="w-4 h-4" />
                    <span>{pkg.price.toLocaleString('vi-VN')} VNĐ</span>
                  </div>
                </div>
              </div>
              
              {!isTrainer && (
                <div className="flex gap-2">
                  <button 
                    onClick={() => {
                      setEditingPackage(pkg);
                      setFormData(pkg);
                      setIsEditing(true);
                    }}
                    className="p-2 bg-zinc-800 text-zinc-400 hover:text-white rounded-xl transition-colors"
                  >
                    <Edit2 className="w-4 h-4" />
                  </button>
                  <button 
                    onClick={() => handleDelete(pkg.id)}
                    className="p-2 bg-red-500/10 text-red-400 hover:bg-red-500 hover:text-white rounded-xl transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              )}
            </div>
          </div>
        )) : (
          <div className="text-center py-12 bg-zinc-900 border border-zinc-800 rounded-3xl text-zinc-500">
            Chưa có gói tập nào. Hãy bấm nút "+" để tạo gói đầu tiên.
          </div>
        )}
      </div>

      {/* Add/Edit Modal */}
      <AnimatePresence>
        {isEditing && (
          <div className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/80 backdrop-blur-sm"
              onClick={() => setIsEditing(false)}
            />
            <motion.div 
              role="dialog"
              aria-modal="true"
              aria-label={editingPackage ? 'Sửa gói tập' : 'Thêm gói tập mới'}
              initial={{ opacity: 0, y: '100%' }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: '100%' }}
              className="relative w-full max-w-md bg-zinc-900 rounded-3xl p-6 shadow-2xl border border-zinc-800"
            >
              <h3 className="text-xl font-bold text-white mb-6">
                {editingPackage ? 'Sửa gói tập' : 'Thêm gói tập mới'}
              </h3>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-zinc-400 mb-1">Tên gói tập *</label>
                  <input 
                    type="text" 
                    value={formData.name}
                    onChange={e => setFormData({...formData, name: e.target.value})}
                    className="w-full p-3 rounded-xl border border-zinc-800 bg-zinc-950 text-white focus:outline-none focus:border-pink-500" 
                    placeholder="VD: Gói 36 buổi (3 tháng)"
                  />
                </div>
                
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-zinc-400 mb-1">Số buổi tập *</label>
                    <input 
                      type="number" 
                      value={formData.totalSessions}
                      onChange={e => setFormData({...formData, totalSessions: Number(e.target.value)})}
                      className="w-full p-3 rounded-xl border border-zinc-800 bg-zinc-950 text-white focus:outline-none focus:border-pink-500" 
                      placeholder="VD: 36"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-zinc-400 mb-1">Hạn dùng (Tháng)</label>
                    <input 
                      type="number" 
                      value={formData.durationMonths}
                      onChange={e => setFormData({...formData, durationMonths: Number(e.target.value)})}
                      className="w-full p-3 rounded-xl border border-zinc-800 bg-zinc-950 text-white focus:outline-none focus:border-pink-500" 
                      placeholder="VD: 3"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-zinc-400 mb-1">Giá tiền (VNĐ) *</label>
                  <input 
                    type="number" 
                    value={formData.price}
                    onChange={e => setFormData({...formData, price: Number(e.target.value)})}
                    className="w-full p-3 rounded-xl border border-zinc-800 bg-zinc-950 text-white focus:outline-none focus:border-pink-500 text-lg font-bold text-pink-500" 
                    placeholder="VD: 10800000"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-zinc-400 mb-1">Chi nhánh</label>
                  <select 
                    value={formData.branchId || ''}
                    onChange={e => setFormData({...formData, branchId: e.target.value})}
                    className="w-full p-3 rounded-xl border border-zinc-800 bg-zinc-950 text-white focus:outline-none focus:border-pink-500"
                  >
                    <option value="">Tất cả chi nhánh</option>
                    {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                </div>

                <div className="pt-4 flex gap-3">
                  <button 
                    onClick={() => setIsEditing(false)}
                    className="flex-1 py-3 rounded-xl font-medium text-zinc-400 bg-zinc-800 hover:bg-zinc-700 transition-colors"
                  >
                    Hủy
                  </button>
                  <button 
                    onClick={handleSave}
                    disabled={!formData.name || !formData.totalSessions || !formData.price}
                    className="flex-1 py-3 rounded-xl font-medium text-white bg-pink-500 hover:bg-pink-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-[0_0_15px_rgba(255,0,127,0.4)]"
                  >
                    Lưu gói tập
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
