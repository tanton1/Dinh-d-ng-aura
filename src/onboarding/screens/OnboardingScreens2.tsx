import { ChoiceCard } from './OnboardingScreens';
import React, { useState } from 'react';
import { motion } from 'motion/react';


export const GoalPaceScreen = ({ profile, updateProfile, onNext }: any) => {
  const current = profile.weightKg || 60;
  const target = profile.targetWeightKg || current;
  const diff = Math.abs(current - target);
  
  const calculateWeeks = (pace: 'fast' | 'balanced' | 'comfortable') => {
    const rate = { fast: 0.6, balanced: 0.4, comfortable: 0.3 }[pace];
    return Math.ceil(diff / rate);
  };

  const [showWarning, setShowWarning] = useState(false);
  const [selectedPace, setSelectedPace] = useState(profile.pace);

  const handlePaceSelect = (pace: 'fast' | 'balanced' | 'comfortable') => {
    setSelectedPace(pace);
    if (pace === 'fast' && diff > 5) {
      setShowWarning(true);
    } else {
      setShowWarning(false);
      updateProfile({ pace });
    }
  };

  if (showWarning) {
    return (
      <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="step-content" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>⚠️</div>
        <div style={{ textAlign: 'center', marginBottom: '32px' }}><h2 style={{ fontSize: '28px', fontWeight: 800, color: '#0f172a', marginBottom: '8px' }}>Mục tiêu này khá nhanh</h2></div>
        <p className="step-subtitle">Aura khuyến nghị kéo dài thêm thời gian để ưu tiên khả năng duy trì và bảo toàn khối cơ.</p>
        <div className="bottom-cta">
          <button className="primary-button" onClick={() => { setShowWarning(false); updateProfile({ pace: 'balanced' }); onNext(); }} style={{ width: '100%', padding: '16px', borderRadius: '24px', background: 'linear-gradient(135deg, #ff3f7d, #ff8a38)', color: 'white', border: 'none', fontSize: '18px', fontWeight: 700, boxShadow: '0 8px 20px rgba(255, 63, 125, 0.3)' }}>Chọn nhịp cân bằng</button>
          <button className="secondary-button" onClick={() => { updateProfile({ pace: 'fast' }); onNext(); }}>Vẫn tiếp tục</button>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="step-content" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ textAlign: 'center', marginBottom: '32px' }}><h2 style={{ fontSize: '28px', fontWeight: 800, color: '#0f172a', marginBottom: '8px' }}>Bạn muốn đạt mục tiêu theo nhịp nào?</h2></div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 24 }}>
        <ChoiceCard title="Nhanh" subtitle={`Khoảng ${calculateWeeks('fast')} tuần • Cần tuân thủ cao hơn`} selected={selectedPace === 'fast'} onClick={() => handlePaceSelect('fast')} />
        <ChoiceCard title="Cân bằng" subtitle={`Khoảng ${calculateWeeks('balanced')} tuần • Khuyến nghị`} selected={selectedPace === 'balanced'} onClick={() => handlePaceSelect('balanced')} />
        <ChoiceCard title="Thoải mái" subtitle={`Khoảng ${calculateWeeks('comfortable')} tuần • Dễ duy trì hơn`} selected={selectedPace === 'comfortable'} onClick={() => handlePaceSelect('comfortable')} />
      </div>
      <div className="bottom-cta" style={{ marginTop: 'auto' }}>
        <button className="primary-button" disabled={!selectedPace} onClick={() => { updateProfile({ pace: selectedPace }); onNext(); }} style={{ width: '100%', padding: '16px', borderRadius: '24px', background: !selectedPace ? '#e2e8f0' : 'linear-gradient(135deg, #ff3f7d, #ff8a38)', color: !selectedPace ? '#94a3b8' : 'white', border: 'none', fontSize: '18px', fontWeight: 700, boxShadow: !selectedPace ? 'none' : '0 8px 20px rgba(255, 63, 125, 0.3)' }}>Tiếp tục</button>
      </div>
    </motion.div>
  );
};



export const ActivityScreen = ({ profile, updateProfile, onNext }: any) => (
  <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="step-content" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
    <div style={{ textAlign: 'center', marginBottom: '32px' }}>
      <h2 style={{ fontSize: '28px', fontWeight: 800, color: '#0f172a', marginBottom: '8px' }}>Mức độ vận động?</h2>
      <p style={{ color: '#64748b', fontSize: '15px', lineHeight: 1.5 }}>
        Điều này giúp tính toán năng lượng tiêu hao hằng ngày (TDEE).
      </p>
    </div>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0, flex: 1, justifyContent: 'center' }}>
      <ChoiceCard icon="🛋️" title="Ít vận động" subtitle="Làm việc văn phòng, không tập thể dục" selected={profile.activityLevel === 'sedentary'} onClick={() => updateProfile({ activityLevel: 'sedentary' })} />
      <ChoiceCard icon="🚶" title="Vận động nhẹ" subtitle="Tập luyện nhẹ nhàng 1-2 ngày/tuần" selected={profile.activityLevel === 'light'} onClick={() => updateProfile({ activityLevel: 'light' })} />
      <ChoiceCard icon="🏃" title="Vận động vừa" subtitle="Tập luyện 3-5 ngày/tuần" selected={profile.activityLevel === 'moderate'} onClick={() => updateProfile({ activityLevel: 'moderate' })} />
      <ChoiceCard icon="🔥" title="Vận động nhiều" subtitle="Tập luyện nặng 6-7 ngày/tuần" selected={profile.activityLevel === 'high'} onClick={() => updateProfile({ activityLevel: 'high' })} />
    </div>
    <div className="bottom-cta" style={{ marginTop: 'auto' }}>
      <button className="primary-button" disabled={!profile.activityLevel} onClick={onNext} style={{ width: '100%', padding: '16px', borderRadius: '24px', background: 'linear-gradient(135deg, #ff3f7d, #ff8a38)', color: 'white', border: 'none', fontSize: '18px', fontWeight: 700, boxShadow: '0 8px 20px rgba(255, 63, 125, 0.3)' }}>Tiếp tục</button>
    </div>
  </motion.div>
);

export const SleepScreen = ({ profile, updateProfile, onNext }: any) => {
  const currentHours = profile.sleepHours || 7;
  const pct = Math.min(100, Math.max(0, ((currentHours - 4) / (12 - 4)) * 100));

  return (
    <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="step-content" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ textAlign: 'center', marginBottom: '32px' }}><h2 style={{ fontSize: '28px', fontWeight: 800, color: '#0f172a', marginBottom: '8px' }}>Trung bình bạn ngủ bao nhiêu giờ mỗi đêm?</h2></div>
      
      <div className="weight-slider-container">
        <div style={{ textAlign: 'center', fontSize: 32, marginBottom: 8 }}>🌙</div>
        <div className="weight-display">{currentHours.toFixed(1)}<small>giờ</small></div>
        
        <div style={{ width: '100%', padding: '0 20px', display: 'flex', alignItems: 'center', gap: '20px' }}>
          <button onClick={() => updateProfile({ sleepHours: Math.max(4, currentHours - 0.5) })} style={{ width: '60px', height: '60px', borderRadius: '30px', background: '#fff7ed', border: 'none', color: '#ff8a38', fontSize: '32px', fontWeight: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', boxShadow: '0 4px 12px rgba(255, 138, 56, 0.1)', flexShrink: 0 }}>-</button>
          
          <input 
            type="range" min="4" max="12" step="0.5" 
            value={currentHours} 
            onChange={(e) => updateProfile({ sleepHours: parseFloat(e.target.value) })} 
            className="premium-slider-input" style={{ background: `linear-gradient(to right, #ff8a38 0%, #ff8a38 ${pct}%, #e2e8f0 ${pct}%, #e2e8f0 100%)`, color: "#ff8a38" } as any} 
          />
          
          <button onClick={() => updateProfile({ sleepHours: Math.min(12, currentHours + 0.5) })} style={{ width: '60px', height: '60px', borderRadius: '30px', background: '#fff7ed', border: 'none', color: '#ff8a38', fontSize: '32px', fontWeight: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', boxShadow: '0 4px 12px rgba(255, 138, 56, 0.1)', flexShrink: 0 }}>+</button>
        </div>
        
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: 'var(--aura-muted)', marginTop: 8, padding: '0 20px' }}>
          <span>4 giờ</span>
          <span>12 giờ</span>
        </div>
      </div>

      <div style={{ marginTop: 32 }}>
        <h3 style={{ fontSize: 15, textAlign: 'center', marginBottom: 16 }}>Chất lượng giấc ngủ</h3>
        <div style={{ display: 'flex', gap: 12 }}>
          {['poor', 'average', 'good'].map(q => (
            <div 
              key={q} 
              style={{ flex: 1, textAlign: 'center', padding: '12px 0', borderRadius: 12, border: '1px solid var(--aura-border)', cursor: 'pointer', fontWeight: 600, fontSize: 14,
                ...(profile.sleepQuality === q ? { border: '1px solid #ff5a79', background: 'linear-gradient(135deg, #fff4f7, #fff8f2)', color: '#ff3f7d' } : {})
               }}
              onClick={() => updateProfile({ sleepQuality: q })}
            >
              {q === 'poor' ? 'Kém' : q === 'average' ? 'Trung bình' : 'Tốt'}
            </div>
          ))}
        </div>
      </div>

      <div className="bottom-cta" style={{ marginTop: 'auto' }}>
        <button className="primary-button" disabled={!profile.sleepQuality} onClick={() => {
          if (!profile.sleepHours) updateProfile({ sleepHours: currentHours });
          onNext();
        }} style={{ width: '100%', padding: '16px', borderRadius: '24px', background: !profile.sleepQuality ? '#e2e8f0' : 'linear-gradient(135deg, #ff3f7d, #ff8a38)', color: !profile.sleepQuality ? '#94a3b8' : 'white', border: 'none', fontSize: '18px', fontWeight: 700, boxShadow: !profile.sleepQuality ? 'none' : '0 8px 20px rgba(255, 63, 125, 0.3)' }}>Tiếp tục</button>
      </div>
    </motion.div>
  );
};

export const StressScreen = ({ profile, updateProfile, onNext }: any) => (
  <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="step-content" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
    <div style={{ textAlign: 'center', marginBottom: '32px' }}><h2 style={{ fontSize: '28px', fontWeight: 800, color: '#0f172a', marginBottom: '8px' }}>Mức độ căng thẳng gần đây của bạn?</h2></div>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 24 }}>
      <ChoiceCard title="😌 Ít" subtitle="Thoải mái, thư giãn" selected={profile.stressLevel === 'low'} onClick={() => updateProfile({ stressLevel: 'low' })} />
      <ChoiceCard title="🙂 Vừa" subtitle="Đôi lúc căng thẳng" selected={profile.stressLevel === 'medium'} onClick={() => updateProfile({ stressLevel: 'medium' })} />
      <ChoiceCard title="😟 Nhiều" subtitle="Thường xuyên căng thẳng" selected={profile.stressLevel === 'high'} onClick={() => updateProfile({ stressLevel: 'high' })} />
      <ChoiceCard title="😫 Rất nhiều" subtitle="Căng thẳng kéo dài" selected={profile.stressLevel === 'very_high'} onClick={() => updateProfile({ stressLevel: 'very_high' })} />
    </div>
    <div className="bottom-cta" style={{ marginTop: 'auto' }}>
      <button className="primary-button" disabled={!profile.stressLevel} onClick={onNext} style={{ width: '100%', padding: '16px', borderRadius: '24px', background: 'linear-gradient(135deg, #ff3f7d, #ff8a38)', color: 'white', border: 'none', fontSize: '18px', fontWeight: 700, boxShadow: '0 8px 20px rgba(255, 63, 125, 0.3)' }}>Tiếp tục</button>
    </div>
  </motion.div>
);
