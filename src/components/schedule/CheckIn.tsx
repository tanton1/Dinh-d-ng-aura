import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { CheckCircle2, Smile, Zap, Target, Droplets, Moon, Loader2, History } from 'lucide-react';
import { auth } from '../../lib/firebase';
import { DailyCheckin } from '../../types';
import { useDatabase } from '../../contexts/DatabaseContext';

export default function CheckIn() {
  const { dailyCheckins, addDailyCheckin } = useDatabase();
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [hunger, setHunger] = useState(3);
  const [energy, setEnergy] = useState(3);
  const [compliance, setCompliance] = useState(80);
  const [water, setWater] = useState(2);
  const [sleep, setSleep] = useState(7);
  const [note, setNote] = useState('');
  const [history, setHistory] = useState<DailyCheckin[]>([]);
  const [showHistory, setShowHistory] = useState(false);

  useEffect(() => {
    const currentUser = auth?.currentUser;
    if (showHistory && currentUser) {
      const userCheckins = dailyCheckins
        .filter(c => c.studentId === currentUser.uid)
        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      setHistory(userCheckins);
    }
  }, [showHistory, dailyCheckins]);

  const today = new Date().toISOString().split('T')[0];
  const currentUid = auth?.currentUser?.uid || 'anonymous';
  const checkinId = `${currentUid}_${today}`;

  useEffect(() => {
    if (!auth?.currentUser) return;
    const existingCheckin = dailyCheckins.find(c => c.id === checkinId);
    if (existingCheckin) {
      setHunger(existingCheckin.hunger);
      setEnergy(existingCheckin.energy);
      setCompliance(existingCheckin.compliance);
      setWater(existingCheckin.waterIntake || 2);
      setSleep(existingCheckin.sleepQuality || 7);
      setNote(existingCheckin.note || '');
      setStep(2); // Already completed
    }
    setLoading(false);
  }, [checkinId, dailyCheckins]);

  const handleComplete = async () => {
    const currentUser = auth?.currentUser;
    if (!currentUser) return;
    setSubmitting(true);
    try {
      const checkinData: DailyCheckin = {
        id: checkinId,
        studentId: currentUser.uid,
        date: today,
        hunger,
        energy,
        compliance,
        waterIntake: water,
        sleepQuality: sleep,
        note,
        createdAt: new Date().toISOString()
      };

      await addDailyCheckin(checkinData);
      setStep(2);
    } catch (error) {
      console.error("Error saving check-in:", error);
      alert("Có lỗi xảy ra khi lưu check-in. Vui lòng thử lại.");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-pink-500 animate-spin" />
      </div>
    );
  }

  if (step === 2 && !showHistory) {
    return (
      <div className="min-h-screen bg-zinc-950 flex flex-col items-center justify-center p-6 text-center">
        <motion.div 
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="bg-zinc-900 p-8 rounded-3xl shadow-sm max-w-sm w-full border border-zinc-800"
        >
          <div className="w-20 h-20 bg-pink-500/20 rounded-full flex items-center justify-center mx-auto mb-6">
            <CheckCircle2 className="w-10 h-10 text-pink-500" />
          </div>
          <h2 className="text-2xl font-serif font-medium text-white mb-2">Tuyệt vời!</h2>
          <p className="text-zinc-400 mb-8">
            Bạn đã hoàn thành check-in hôm nay. Chúng tôi đã ghi nhận và sẽ điều chỉnh plan ngày mai cho phù hợp nhé.
          </p>
          <div className="space-y-3">
            <button 
              onClick={() => setStep(1)}
              className="w-full bg-zinc-800 text-white py-4 rounded-2xl font-medium hover:bg-zinc-700 transition-colors border border-zinc-700"
            >
              Chỉnh sửa lại
            </button>
            <button 
              onClick={() => setShowHistory(true)}
              className="w-full bg-zinc-900 text-zinc-400 py-4 rounded-2xl font-medium hover:text-white transition-colors"
            >
              Xem lịch sử check-in
            </button>
          </div>
        </motion.div>
      </div>
    );
  }

  if (showHistory) {
    return (
      <div className="min-h-screen bg-zinc-950 pb-24">
        <div className="bg-zinc-900 p-6 rounded-b-3xl shadow-sm mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-serif font-medium text-white">Lịch sử Check-in</h1>
            <p className="text-zinc-400 text-sm mt-1">Hành trình nỗ lực của bạn.</p>
          </div>
          <button 
            onClick={() => setShowHistory(false)}
            className="p-2 text-zinc-400 hover:text-white"
          >
            <History className="w-6 h-6" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          {history.length === 0 ? (
            <div className="text-center py-12 text-zinc-500">Chưa có dữ liệu lịch sử.</div>
          ) : (
            history.map((checkin) => (
              <div key={checkin.id} className="bg-zinc-900 p-5 rounded-2xl border border-zinc-800">
                <div className="flex justify-between items-center mb-4">
                  <span className="text-white font-bold">{new Date(checkin.date).toLocaleDateString('vi-VN')}</span>
                  <span className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase ${
                    checkin.compliance >= 90 ? 'bg-emerald-500/10 text-emerald-400' :
                    checkin.compliance >= 70 ? 'bg-orange-500/10 text-orange-400' :
                    'bg-red-500/10 text-red-400'
                  }`}>
                    {checkin.compliance}% Plan
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-4 text-xs">
                  <div className="flex items-center gap-2 text-zinc-400">
                    <Smile className="w-3 h-3" /> No/Đói: {checkin.hunger}/5
                  </div>
                  <div className="flex items-center gap-2 text-zinc-400">
                    <Zap className="w-3 h-3" /> Năng lượng: {checkin.energy}/5
                  </div>
                  <div className="flex items-center gap-2 text-zinc-400">
                    <Droplets className="w-3 h-3" /> Nước: {checkin.waterIntake}L
                  </div>
                  <div className="flex items-center gap-2 text-zinc-400">
                    <Moon className="w-3 h-3" /> Ngủ: {checkin.sleepQuality}h
                  </div>
                </div>
                {checkin.note && (
                  <div className="mt-3 pt-3 border-t border-zinc-800 text-xs text-zinc-500 italic">
                    "{checkin.note}"
                  </div>
                )}
              </div>
            ))
          )}
          <button 
            onClick={() => setShowHistory(false)}
            className="w-full bg-zinc-800 text-white py-4 rounded-2xl font-medium mt-6"
          >
            Quay lại
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-950 pb-24">
      <div className="bg-zinc-900 p-6 rounded-b-3xl shadow-sm mb-6">
        <h1 className="text-2xl font-serif font-medium text-white flex items-center gap-2">
          <Target className="w-6 h-6 text-pink-500" />
          Check-in cuối ngày
        </h1>
        <p className="text-zinc-400 text-sm mt-2">Dành 30s để chúng tôi hiểu bạn hơn nhé.</p>
      </div>

      <div className="p-6 space-y-8">
        {/* Hunger */}
        <div className="bg-zinc-900 p-6 rounded-2xl shadow-sm border border-zinc-800">
          <div className="flex items-center gap-2 mb-4">
            <Smile className="w-5 h-5 text-orange-500" />
            <h3 className="font-medium text-white">Mức độ no/đói hôm nay?</h3>
          </div>
          <input 
            type="range" min="1" max="5" value={hunger} 
            onChange={e => setHunger(Number(e.target.value))}
            className="w-full accent-orange-500 mb-2" 
          />
          <div className="flex justify-between text-xs text-zinc-500 font-medium">
            <span>Rất đói</span>
            <span>Vừa vặn</span>
            <span>Quá no</span>
          </div>
        </div>

        {/* Energy */}
        <div className="bg-zinc-900 p-6 rounded-2xl shadow-sm border border-zinc-800">
          <div className="flex items-center gap-2 mb-4">
            <Zap className="w-5 h-5 text-blue-500" />
            <h3 className="font-medium text-white">Năng lượng của bạn?</h3>
          </div>
          <input 
            type="range" min="1" max="5" value={energy} 
            onChange={e => setEnergy(Number(e.target.value))}
            className="w-full accent-blue-500 mb-2" 
          />
          <div className="flex justify-between text-xs text-zinc-500 font-medium">
            <span>Mệt mỏi</span>
            <span>Bình thường</span>
            <span>Tràn trề</span>
          </div>
        </div>

        {/* Water */}
        <div className="bg-zinc-900 p-6 rounded-2xl shadow-sm border border-zinc-800">
          <div className="flex items-center gap-2 mb-4">
            <Droplets className="w-5 h-5 text-cyan-500" />
            <h3 className="font-medium text-white">Lượng nước đã uống (Lít)?</h3>
          </div>
          <div className="flex items-center gap-4">
            <input 
              type="range" min="0" max="5" step="0.5" value={water} 
              onChange={e => setWater(Number(e.target.value))}
              className="flex-1 accent-cyan-500" 
            />
            <span className="text-xl font-medium text-cyan-500 w-12 text-right">{water}L</span>
          </div>
        </div>

        {/* Sleep */}
        <div className="bg-zinc-900 p-6 rounded-2xl shadow-sm border border-zinc-800">
          <div className="flex items-center gap-2 mb-4">
            <Moon className="w-5 h-5 text-indigo-500" />
            <h3 className="font-medium text-white">Thời gian ngủ (Giờ)?</h3>
          </div>
          <div className="flex items-center gap-4">
            <input 
              type="range" min="0" max="12" step="0.5" value={sleep} 
              onChange={e => setSleep(Number(e.target.value))}
              className="flex-1 accent-indigo-500" 
            />
            <span className="text-xl font-medium text-indigo-500 w-12 text-right">{sleep}h</span>
          </div>
        </div>

        {/* Compliance */}
        <div className="bg-zinc-900 p-6 rounded-2xl shadow-sm border border-zinc-800">
          <div className="flex items-center gap-2 mb-4">
            <CheckCircle2 className="w-5 h-5 text-pink-500" />
            <h3 className="font-medium text-white">Mức độ bám sát Plan?</h3>
          </div>
          <div className="flex items-center gap-4">
            <input 
              type="range" min="0" max="100" step="10" value={compliance} 
              onChange={e => setCompliance(Number(e.target.value))}
              className="flex-1 accent-pink-500" 
            />
            <span className="text-xl font-medium text-pink-500 w-12 text-right">{compliance}%</span>
          </div>
        </div>

        {/* Note */}
        <div className="bg-zinc-900 p-6 rounded-2xl shadow-sm border border-zinc-800">
          <h3 className="font-medium text-white mb-3">Ghi chú thêm (nếu có)</h3>
          <textarea 
            rows={3}
            placeholder="VD: Hôm nay thèm ngọt quá..."
            value={note}
            onChange={e => setNote(e.target.value)}
            className="w-full p-4 rounded-xl border border-zinc-700 bg-zinc-950 text-sm text-white focus:outline-none focus:ring-2 focus:ring-pink-500"
          />
        </div>

        <button 
          onClick={handleComplete}
          disabled={submitting}
          className="w-full bg-pink-600 text-white py-4 rounded-2xl font-medium hover:bg-pink-700 transition-colors shadow-[0_0_15px_rgba(255,0,127,0.4)] flex items-center justify-center gap-2 disabled:opacity-50"
        >
          {submitting && <Loader2 className="w-5 h-5 animate-spin" />}
          {submitting ? 'Đang lưu...' : 'Hoàn thành Check-in'}
        </button>
      </div>
    </div>
  );
}
