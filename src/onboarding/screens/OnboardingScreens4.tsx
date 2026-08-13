import { calculateNutritionTargets } from '../../services/nutritionSyncService';
import React, { useEffect, useState } from 'react';
import { motion } from 'motion/react';

import { ChoiceCard } from './OnboardingScreens';
import { Loader2, CheckCircle2, Bell } from 'lucide-react';
import { GeneratedPlan } from '../types';
import { normalizeOnboardingProfile } from '../defaults';

export const HealthDetailsScreen = ({ profile, updateProfile, onNext }: any) => {
  const hasDiabetes = profile.healthConditions?.includes('Tiểu đường');
  const hasBP = profile.healthConditions?.includes('Huyết áp cao');

  return (
    <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="step-content" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ textAlign: 'center', marginBottom: '32px' }}><h2 style={{ fontSize: '28px', fontWeight: 800, color: '#0f172a', marginBottom: '8px' }}>Bạn đang gặp tình trạng nào?</h2></div>
      <div style={{ flex: 1, overflowY: 'auto', marginTop: 24, display: 'flex', flexDirection: 'column', gap: 24 }}>
        {hasDiabetes && (
          <div>
            <h3 style={{ fontSize: 15, marginBottom: 12 }}>Tiểu đường</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <ChoiceCard title="Tiểu đường type 1" selected={profile.diabetesType === 'type_1'} onClick={() => updateProfile({ diabetesType: 'type_1' })} />
              <ChoiceCard title="Tiểu đường type 2" selected={profile.diabetesType === 'type_2'} onClick={() => updateProfile({ diabetesType: 'type_2' })} />
              <ChoiceCard title="Tiền tiểu đường" selected={profile.diabetesType === 'pre'} onClick={() => updateProfile({ diabetesType: 'pre' })} />
              <ChoiceCard title="Không rõ" selected={profile.diabetesType === 'unknown'} onClick={() => updateProfile({ diabetesType: 'unknown' })} />
            </div>
          </div>
        )}
        {hasBP && (
          <div>
            <h3 style={{ fontSize: 15, marginBottom: 12 }}>Huyết áp</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <ChoiceCard title="Đang dùng thuốc" selected={profile.bpStatus === 'medicated'} onClick={() => updateProfile({ bpStatus: 'medicated' })} />
              <ChoiceCard title="Không dùng thuốc" selected={profile.bpStatus === 'unmedicated'} onClick={() => updateProfile({ bpStatus: 'unmedicated' })} />
              <ChoiceCard title="Không rõ" selected={profile.bpStatus === 'unknown'} onClick={() => updateProfile({ bpStatus: 'unknown' })} />
            </div>
          </div>
        )}
      </div>
      <div className="bottom-cta" style={{ marginTop: 16 }}>
        <button className="primary-button" 
          disabled={(hasDiabetes && !profile.diabetesType) || (hasBP && !profile.bpStatus)} 
          onClick={onNext}
          style={{ width: '100%', padding: '16px', borderRadius: '24px', background: ((hasDiabetes && !profile.diabetesType) || (hasBP && !profile.bpStatus)) ? '#e2e8f0' : 'linear-gradient(135deg, #ff3f7d, #ff8a38)', color: ((hasDiabetes && !profile.diabetesType) || (hasBP && !profile.bpStatus)) ? '#94a3b8' : 'white', border: 'none', fontSize: '18px', fontWeight: 700, boxShadow: ((hasDiabetes && !profile.diabetesType) || (hasBP && !profile.bpStatus)) ? 'none' : '0 8px 20px rgba(255, 63, 125, 0.3)' }}
        >
          Hoàn tất
        </button>
      </div>
    </motion.div>
  );
};

export const AnalyzingScreen = ({ profile, setGeneratedPlan, onNext }: any) => {
  const [stepsCompleted, setStepsCompleted] = useState(0);
  
  useEffect(() => {
    const steps = [
      'Phân tích chỉ số cơ thể',
      'Ước tính nhu cầu năng lượng',
      'Phân tích mục tiêu',
      'Đánh giá mức vận động',
      'Phân tích giấc ngủ và stress',
      'Điều chỉnh theo thói quen ăn uống',
      'Kiểm tra yếu tố sức khỏe',
      'Xây kế hoạch khởi điểm'
    ];

    let interval = setInterval(() => {
      setStepsCompleted(prev => {
        if (prev >= steps.length) {
          clearInterval(interval);
          return prev;
        }
        return prev + 1;
      });
    }, 400);

    const generate = async () => {
      const normalizedProfile = normalizeOnboardingProfile(profile);
      try {
        const res = await fetch('/api/onboarding/preview', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(normalizedProfile)
        });
        if (res.ok) {
          const plan = await res.json();
          setGeneratedPlan(plan);
        } else {
          throw new Error('API failed');
        }
      } catch (e) {
        // Fallback to client-side calc
        const age = normalizedProfile.birthYear ? new Date().getFullYear() - normalizedProfile.birthYear : 30;
        const heightM = (normalizedProfile.heightCm ?? 165) / 100;
        const bmi = (normalizedProfile.weightKg ?? 60) / (heightM * heightM);
        let bmiLabel = 'Bình thường';
        if (bmi < 18.5) bmiLabel = 'Thiếu cân';
        else if (bmi >= 25) bmiLabel = 'Thừa cân';
        
        const targets = calculateNutritionTargets({ ...normalizedProfile, age });
        setGeneratedPlan({
          age,
          bmi: Math.round(bmi * 10) / 10,
          bmiLabel,
          bmrKcal: targets.bmr,
          tdeeKcal: targets.tdee,
          targetCaloriesKcal: targets.targetCaloriesKcal,
          proteinG: targets.proteinG,
          carbsG: targets.carbsG,
          fatG: targets.fatG,
          waterLiters: targets.waterLiters,
          stepsPerDay: targets.stepsPerDay,
          workoutsPerWeek: normalizedProfile.activityLevel === 'sedentary' ? 1 : normalizedProfile.activityLevel === 'light' ? 3 : 5,
          estimatedWeeks: Math.round((targets.timeframeMonths || 3) * 4.33),
          targetWeightDeltaKg: targets.targetDelta,
          targetTimeframeMonths: targets.timeframeMonths
        });
      }
    };

    generate();

    return () => clearInterval(interval);
  }, [profile, setGeneratedPlan]);

  useEffect(() => {
    if (stepsCompleted >= 8) {
      setTimeout(onNext, 600);
    }
  }, [stepsCompleted, onNext]);

  const steps = [
    'Phân tích chỉ số cơ thể', 'Ước tính nhu cầu năng lượng', 'Phân tích mục tiêu', 
    'Đánh giá mức vận động', 'Phân tích giấc ngủ và stress', 'Điều chỉnh theo thói quen ăn uống', 
    'Kiểm tra yếu tố sức khỏe', 'Xây kế hoạch khởi điểm'
  ];

  return (
    <div className="analyzing-container">
      <div style={{ fontSize: 48, marginBottom: 16 }}>✨</div>
      <div style={{ textAlign: 'center', marginBottom: '32px' }}><h2 style={{ fontSize: '28px', fontWeight: 800, color: '#0f172a', marginBottom: '8px' }}>Aura đang xây kế hoạch dành riêng cho bạn...</h2></div>
      <div className="analyzing-list">
        {steps.map((s, i) => (
          <div key={i} className={`analyzing-item ${i >= stepsCompleted ? 'pending' : ''}`}>
            {i < stepsCompleted ? <CheckCircle2 size={20} /> : <Loader2 size={20} className="animate-spin" />}
            <span>{s}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

export const ResultScreen = ({ profile, generatedPlan, onComplete, onBack }: any) => {
  if (!generatedPlan) return null;
  const p = generatedPlan as GeneratedPlan;
  
  const diff = profile.targetWeightKg && profile.weightKg ? profile.targetWeightKg - profile.weightKg : 0;
  
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="step-content" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ textAlign: 'center', marginBottom: 24 }}>
        <h2 style={{ fontSize: 28, fontWeight: 800 }}>Hồ sơ Aura của bạn</h2>
        <p style={{ color: 'var(--aura-muted)', fontSize: 15, marginTop: 8 }}>Đây là kế hoạch khởi điểm được xây từ thông tin bạn vừa cung cấp.</p>
      </div>

      <div className="weight-comparison">
        <div className="weight-side">
          <span>Hiện tại</span>
          <strong>{profile.weightKg?.toFixed(1)} <small style={{ fontSize: 16, fontWeight: 600, color: 'var(--aura-muted)' }}>kg</small></strong>
        </div>
        <div className="weight-badge">{diff > 0 ? '+' : ''}{diff.toFixed(1)} kg</div>
        <div className="weight-side">
          <span>Mục tiêu</span>
          <strong style={{ color: 'var(--aura-pink)' }}>{profile.targetWeightKg?.toFixed(1) || profile.weightKg?.toFixed(1)} <small style={{ fontSize: 16, fontWeight: 600 }}>kg</small></strong>
        </div>
      </div>

      <div className="result-card">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, fontSize: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: 'var(--aura-muted)' }}>BMI</span><strong>{p.bmi.toFixed(1)} <span style={{ color: '#10b981', fontSize: 12, marginLeft: 4, background: '#d1fae5', padding: '2px 6px', borderRadius: 4 }}>{p.bmiLabel}</span></strong></div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: 'var(--aura-muted)' }}>Mục tiêu</span><strong>{profile.primaryGoal === 'fat_loss' ? 'Giảm mỡ' : profile.primaryGoal === 'muscle_gain' ? 'Tăng cơ' : 'Sức khỏe'}</strong></div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: 'var(--aura-muted)' }}>Thời gian</span><strong>{p.estimatedWeeks} tuần</strong></div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: 'var(--aura-muted)' }}>Vận động</span><strong>{profile.activityLevel === 'light' ? 'Nhẹ' : profile.activityLevel === 'moderate' ? 'Vừa' : profile.activityLevel === 'high' ? 'Nhiều' : 'Ít'}</strong></div>
        </div>
      </div>

      <div className="result-card" style={{ marginBottom: 32 }}>
        <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 16 }}>Kế hoạch khởi điểm</h3>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, paddingBottom: 16, borderBottom: '1px solid var(--aura-border)' }}>
          <div style={{ fontSize: 32 }}>🔥</div>
          <div>
            <div style={{ fontSize: 24, fontWeight: 800 }}>{p.targetCaloriesKcal.toLocaleString('vi-VN')} <small style={{ fontSize: 14, color: 'var(--aura-muted)' }}>kcal</small></div>
            <div style={{ fontSize: 13, color: 'var(--aura-muted)' }}>Mục tiêu năng lượng/ngày</div>
          </div>
        </div>
        <div className="macro-grid">
          <div className="macro-item"><span className="macro-label">🥩 Protein/ngày</span><span className="macro-value">{p.proteinG}g</span></div>
          <div className="macro-item"><span className="macro-label">🍚 Carb/ngày</span><span className="macro-value">{p.carbsG}g</span></div>
          <div className="macro-item"><span className="macro-label">🥑 Chất béo/ngày</span><span className="macro-value">{p.fatG}g</span></div>
          <div className="macro-item"><span className="macro-label">💧 Nước/ngày</span><span className="macro-value">{p.waterLiters}L</span></div>
          <div className="macro-item"><span className="macro-label">🚶 Bước/ngày</span><span className="macro-value">{p.stepsPerDay.toLocaleString('vi-VN')}</span></div>
          <div className="macro-item"><span className="macro-label">🏋️ Vận động/tuần</span><span className="macro-value">{p.workoutsPerWeek} buổi</span></div>
        </div>
      </div>

      <div className="bottom-cta" style={{ paddingBottom: 40 }}>
        <button className="primary-button" onClick={() => onComplete(p)} style={{ width: '100%', padding: '16px', borderRadius: '24px', background: 'linear-gradient(135deg, #ff3f7d, #ff8a38)', color: 'white', border: 'none', fontSize: '18px', fontWeight: 700, boxShadow: '0 8px 20px rgba(255, 63, 125, 0.3)' }}>Bắt đầu hành trình</button>
        <button className="secondary-button" onClick={onBack}>Chỉnh sửa thông tin</button>
      </div>
    </motion.div>
  );
};

export const NotificationsScreen = ({ profile, updateProfile, onNext }: any) => {
  const times = profile.mealTimes || ['07:30', '12:00', '19:00'];
  
  const handleTimeChange = (index: number, value: string) => {
    const newTimes = [...times];
    newTimes[index] = value;
    updateProfile({ mealTimes: newTimes });
  };

  return (
    <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="step-content" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ textAlign: 'center', marginBottom: '32px' }}>
        <div style={{ width: '80px', height: '80px', borderRadius: '40px', background: 'linear-gradient(135deg, #ff3f7d, #ff8a38)', margin: '0 auto 24px', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 8px 24px rgba(255, 63, 125, 0.2)' }}>
          <Bell size={40} color="white" />
        </div>
        <h2 style={{ fontSize: '28px', fontWeight: 800, color: '#0f172a', marginBottom: '8px' }}>Giờ ăn của bạn</h2>
        <p style={{ color: '#64748b', fontSize: '15px', lineHeight: 1.5, padding: '0 20px' }}>
          Aura sẽ nhắc nhở bạn ghi chép bữa ăn để theo dõi calo chính xác nhất.
        </p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ background: 'white', padding: '20px', borderRadius: '24px', border: '1px solid var(--aura-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', boxShadow: '0 4px 12px rgba(0,0,0,0.02)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <div style={{ width: '48px', height: '48px', borderRadius: '24px', background: '#fff7ed', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <span style={{ fontSize: '20px' }}>🌅</span>
            </div>
            <div>
              <div style={{ fontWeight: 800, fontSize: '18px', color: '#0f172a' }}>Bữa sáng</div>
              <div style={{ fontSize: '13px', color: 'var(--aura-muted)', marginTop: '2px' }}>Bắt đầu ngày mới</div>
            </div>
          </div>
          <input type="time" value={times[0]} onChange={e => handleTimeChange(0, e.target.value)} style={{ padding: '10px 16px', borderRadius: '16px', border: 'none', background: '#fff4f7', fontSize: '18px', fontWeight: 700, color: '#ff3f7d', outline: 'none' }} />
        </div>
        
        <div style={{ background: 'white', padding: '20px', borderRadius: '24px', border: '1px solid var(--aura-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', boxShadow: '0 4px 12px rgba(0,0,0,0.02)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <div style={{ width: '48px', height: '48px', borderRadius: '24px', background: '#fff7ed', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <span style={{ fontSize: '20px' }}>☀️</span>
            </div>
            <div>
              <div style={{ fontWeight: 800, fontSize: '18px', color: '#0f172a' }}>Bữa trưa</div>
              <div style={{ fontSize: '13px', color: 'var(--aura-muted)', marginTop: '2px' }}>Nạp lại năng lượng</div>
            </div>
          </div>
          <input type="time" value={times[1]} onChange={e => handleTimeChange(1, e.target.value)} style={{ padding: '10px 16px', borderRadius: '16px', border: 'none', background: '#fff4f7', fontSize: '18px', fontWeight: 700, color: '#ff3f7d', outline: 'none' }} />
        </div>
        
        <div style={{ background: 'white', padding: '20px', borderRadius: '24px', border: '1px solid var(--aura-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', boxShadow: '0 4px 12px rgba(0,0,0,0.02)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <div style={{ width: '48px', height: '48px', borderRadius: '24px', background: '#fff7ed', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <span style={{ fontSize: '20px' }}>🌙</span>
            </div>
            <div>
              <div style={{ fontWeight: 800, fontSize: '18px', color: '#0f172a' }}>Bữa tối</div>
              <div style={{ fontSize: '13px', color: 'var(--aura-muted)', marginTop: '2px' }}>Kết thúc ngày</div>
            </div>
          </div>
          <input type="time" value={times[2]} onChange={e => handleTimeChange(2, e.target.value)} style={{ padding: '10px 16px', borderRadius: '16px', border: 'none', background: '#fff4f7', fontSize: '18px', fontWeight: 700, color: '#ff3f7d', outline: 'none' }} />
        </div>
      </div>

      <div className="bottom-cta" style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <button className="primary-button" style={{ width: '100%', padding: '16px', borderRadius: '24px', background: 'linear-gradient(135deg, #ff3f7d, #ff8a38)', color: 'white', border: 'none', fontSize: '18px', fontWeight: 700, boxShadow: '0 8px 20px rgba(255, 63, 125, 0.3)' }} onClick={() => {
          updateProfile({ notificationsEnabled: true, mealTimes: times });
          onNext();
        }}>
          Bật thông báo nhắc nhở
        </button>
        <button className="secondary-button" onClick={() => {
          updateProfile({ notificationsEnabled: false, mealTimes: times });
          onNext();
        }} style={{ width: '100%', padding: '16px', borderRadius: '24px', background: 'transparent', color: '#64748b', border: 'none', fontSize: '16px', fontWeight: 600 }}>
          Lúc khác
        </button>
      </div>
    </motion.div>
  );
};
