import React, { useState, useEffect } from 'react';
import { OnboardingProfile, GeneratedPlan } from '../types';
import { ArrowLeft, Check, CheckCircle2 } from 'lucide-react';
import { motion } from 'motion/react';
import { getSteps } from '../flow';

// Shared UI components
export const ChoiceCard = ({ title, subtitle, selected, onClick, icon }: any) => (
  <div 
    onClick={onClick} 
    style={{ 
      padding: '24px 20px', 
      borderRadius: '24px', 
      border: `2px solid ${selected ? '#ff3f7d' : 'transparent'}`, 
      background: selected ? '#fff4f7' : 'white', 
      boxShadow: selected ? '0 8px 24px rgba(255, 63, 125, 0.15)' : '0 4px 12px rgba(0,0,0,0.04)',
      display: 'flex', 
      alignItems: 'center', 
      gap: '16px',
      cursor: 'pointer', 
      transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)', 
      marginBottom: '16px',
      transform: selected ? 'scale(1.02)' : 'scale(1)'
    }}
  >
    {icon && (
      <div style={{ 
        width: '56px', height: '56px', borderRadius: '28px', 
        background: selected ? 'linear-gradient(135deg, #ff3f7d, #ff8a38)' : '#f1f5f9', 
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: '28px', color: selected ? 'white' : '#64748b',
        transition: 'all 0.3s',
        boxShadow: selected ? '0 4px 12px rgba(255, 63, 125, 0.3)' : 'none'
      }}>
        {icon}
      </div>
    )}
    <div style={{ flex: 1 }}>
      <div style={{ fontWeight: 800, fontSize: '18px', color: selected ? '#ff3f7d' : '#0f172a', marginBottom: '4px' }}>{title}</div>
      {subtitle && <div style={{ fontSize: '14px', color: selected ? '#fb7185' : '#64748b', lineHeight: 1.4 }}>{subtitle}</div>}
    </div>
    <div style={{ 
      width: '28px', height: '28px', borderRadius: '14px', 
      border: `2px solid ${selected ? '#ff3f7d' : '#cbd5e1'}`,
      background: selected ? '#ff3f7d' : 'transparent',
      display: 'flex', alignItems: 'center', justifyContent: 'center'
    }}>
      {selected && <Check size={16} color="white" strokeWidth={3} />}
    </div>
  </div>
);

export const Header = ({ currentStep, profile, onBack, onSkip }: any) => {
  const steps = getSteps(profile);
  const index = steps.indexOf(currentStep);
  const progress = ((index + 1) / steps.length) * 100;
  
  if (currentStep === 'welcome' || currentStep === 'analyzing' || currentStep === 'result') return null;

  return (
    <div className="onboarding-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px' }}>
      <button className="back-button" onClick={onBack} aria-label="Quay lại"><ArrowLeft size={24} /></button>
      <div className="progress-bar" style={{ flex: 1 }}>
        <div className="progress-fill" style={{ width: `${progress}%` }} />
      </div>
      <div className="progress-text">{index + 1} / {steps.length}</div>
      {onSkip && (
        <button 
          type="button"
          onClick={onSkip}
          style={{
            background: 'rgba(241, 245, 249, 0.9)',
            border: 'none',
            color: '#64748b',
            fontSize: '13px',
            fontWeight: 700,
            cursor: 'pointer',
            padding: '6px 12px',
            borderRadius: '12px',
            whiteSpace: 'nowrap',
            marginLeft: '4px'
          }}
        >
          Để sau
        </button>
      )}
    </div>
  );
};

import { ShieldCheck } from 'lucide-react';

export const WelcomeScreen = ({ onNext, onSkip }: any) => (
  <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="step-content" style={{ padding: '0', height: '100%', position: 'relative', background: '#fff5f7', display: 'flex', flexDirection: 'column' }}>
    <div style={{ position: 'absolute', inset: 0, zIndex: 0 }}>
      <img src="/aura-onboarding.webp" alt="Aura Fit Background" decoding="async" fetchPriority="high" style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center' }} onError={(e) => { e.currentTarget.style.display = 'none'; }} />
    </div>
    
    <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '35%', background: 'linear-gradient(to bottom, rgba(255,255,255,1) 0%, rgba(255,255,255,0.85) 50%, rgba(255,255,255,0) 100%)', zIndex: 1, pointerEvents: 'none' }}></div>
    <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: '48%', background: 'linear-gradient(to top, rgba(255,255,255,1) 0%, rgba(255,255,255,0.95) 70%, rgba(255,255,255,0) 100%)', zIndex: 1, pointerEvents: 'none' }}></div>

    <div style={{ position: 'relative', zIndex: 2, display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ textAlign: 'center', paddingTop: '40px', paddingBottom: 20, paddingLeft: 24, paddingRight: 24 }}>
        <h1 style={{ fontSize: 32, fontWeight: 800, margin: '0 0 12px', lineHeight: 1.2 }}>
          <span style={{ color: '#ff3f7d' }}>
            Chào mừng bạn đến<br/>Aura Fit!
          </span>
        </h1>
        <p style={{ fontSize: 15, color: '#334155', lineHeight: 1.5, fontWeight: 600, margin: '0 auto', maxWidth: 300 }}>
          Chỉ mất khoảng 2 phút để Aura hiểu cơ thể và xây kế hoạch dành riêng cho bạn.
        </p>
      </div>
      
      <div style={{ flex: 1 }}></div>

      <div className="bottom-cta" style={{ padding: '4px 24px 8px 24px', display: 'flex', flexDirection: 'column', gap: '10px', marginTop: 'auto' }}>
        <button className="primary-button" onClick={onNext} style={{ background: 'linear-gradient(135deg, #ff3f7d, #ff8a38)', border: 'none', color: 'white', padding: '18px', borderRadius: '24px', fontSize: '18px', fontWeight: 700, boxShadow: '0 8px 20px rgba(255, 63, 125, 0.3)', width: '100%', cursor: 'pointer' }}>
          Thiết lập hồ sơ
        </button>

        <button 
          className="secondary-button" 
          onClick={() => {
            if (onSkip) {
              onSkip();
            } else {
              window.location.hash = '#/home';
            }
          }} 
          style={{ 
            background: '#ffffff', 
            color: '#0f172a', 
            padding: '16px', 
            borderRadius: '24px', 
            fontSize: '17px', 
            fontWeight: 700, 
            width: '100%',
            border: '2px solid transparent',
            backgroundImage: 'linear-gradient(#ffffff, #ffffff), linear-gradient(135deg, #ff3f7d, #ff8a38)',
            backgroundOrigin: 'border-box',
            backgroundClip: 'padding-box, border-box',
            boxShadow: '0 4px 12px rgba(0,0,0,0.06)',
            cursor: 'pointer'
          }}
        >
          Để sau / Bỏ qua
        </button>
        
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', marginTop: '4px' }}>
          <ShieldCheck size={16} color="#94a3b8" />
          <span style={{ fontSize: '13px', color: '#94a3b8', fontWeight: 500 }}>Thông tin của bạn được bảo mật tuyệt đối</span>
        </div>
      </div>
    </div>
  </motion.div>
);

export const SexScreen = ({ profile, updateProfile, onNext }: any) => (
  <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="step-content" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
    <div style={{ textAlign: 'center', marginBottom: '32px' }}>
      <h2 style={{ fontSize: '28px', fontWeight: 800, color: '#0f172a', marginBottom: '8px' }}>Giới tính sinh học?</h2>
      <p style={{ color: '#64748b', fontSize: '15px', lineHeight: 1.5 }}>
        Thông tin này giúp Aura tính toán nhu cầu năng lượng và hormone chính xác hơn.
      </p>
    </div>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0, flex: 1, justifyContent: 'center' }}>
      <ChoiceCard icon="👩" title="Nữ giới" subtitle="Tính toán dựa trên cơ địa nữ" selected={profile.biologicalSex === 'female'} onClick={() => updateProfile({ biologicalSex: 'female' })} />
      <ChoiceCard icon="👨" title="Nam giới" subtitle="Tính toán dựa trên cơ địa nam" selected={profile.biologicalSex === 'male'} onClick={() => updateProfile({ biologicalSex: 'male' })} />
      <ChoiceCard icon="✨" title="Khác / Không muốn trả lời" selected={profile.biologicalSex === 'other'} onClick={() => updateProfile({ biologicalSex: 'other' })} />
    </div>
    <div className="bottom-cta" style={{ marginTop: 'auto' }}>
      <button className="primary-button" disabled={!profile.biologicalSex} onClick={onNext} style={{ width: '100%', padding: '16px', borderRadius: '24px', background: !profile.biologicalSex ? '#e2e8f0' : 'linear-gradient(135deg, #ff3f7d, #ff8a38)', color: !profile.biologicalSex ? '#94a3b8' : 'white', border: 'none', fontSize: '18px', fontWeight: 700, boxShadow: !profile.biologicalSex ? 'none' : '0 8px 20px rgba(255, 63, 125, 0.3)' }}>Tiếp tục</button>
    </div>
  </motion.div>
);

export const BirthYearScreen = ({ profile, updateProfile, onNext }: any) => {
  const currentYear = new Date().getFullYear();
  const year = profile.birthYear || 1995;
  const age = currentYear - year;
  const pct = Math.min(100, Math.max(0, ((year - 1940) / (currentYear - 10 - 1940)) * 100));

  return (
    <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="step-content" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ textAlign: 'center', marginBottom: '40px' }}>
        <h2 style={{ fontSize: '28px', fontWeight: 800, color: '#0f172a', marginBottom: '8px' }}>Năm sinh của bạn?</h2>
        <p style={{ color: '#64748b', fontSize: '15px' }}>
          Tuổi hiện tại: <span style={{ fontWeight: 700, color: '#ff3f7d' }}>{age} tuổi</span>
        </p>
      </div>
      
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ position: 'relative', display: 'flex', alignItems: 'baseline', justifyContent: 'center', marginBottom: '40px' }}>
          <span style={{ fontSize: '80px', fontWeight: 800, color: '#ff3f7d', letterSpacing: '-2px', lineHeight: 1 }}>{year}</span>
        </div>
        
        <div style={{ width: '100%', padding: '0 20px', display: 'flex', alignItems: 'center', gap: '20px' }}>
          <button onClick={() => updateProfile({ birthYear: Math.max(1940, year - 1) })} style={{ width: '60px', height: '60px', borderRadius: '30px', background: '#fff4f7', border: 'none', color: '#ff3f7d', fontSize: '32px', fontWeight: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', boxShadow: '0 4px 12px rgba(255, 63, 125, 0.1)' }}>-</button>
          
          <input 
            type="range" min="1940" max={currentYear - 10}
            value={year}
            onChange={(e) => updateProfile({ birthYear: parseInt(e.target.value) })}
            className="premium-slider-input" style={{ background: `linear-gradient(to right, #ff3f7d 0%, #ff3f7d ${pct}%, #e2e8f0 ${pct}%, #e2e8f0 100%)`, color: "#ff3f7d" } as any}
          />
          
          <button onClick={() => updateProfile({ birthYear: Math.min(currentYear - 10, year + 1) })} style={{ width: '60px', height: '60px', borderRadius: '30px', background: '#fff4f7', border: 'none', color: '#ff3f7d', fontSize: '32px', fontWeight: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', boxShadow: '0 4px 12px rgba(255, 63, 125, 0.1)' }}>+</button>
        </div>
      </div>
      
      <div className="bottom-cta" style={{ marginTop: 'auto' }}>
        <button className="primary-button" onClick={() => {
          if (!profile.birthYear) updateProfile({ birthYear: year });
          onNext();
        }} style={{ width: '100%', padding: '16px', borderRadius: '24px', background: 'linear-gradient(135deg, #ff3f7d, #ff8a38)', color: 'white', border: 'none', fontSize: '18px', fontWeight: 700, boxShadow: '0 8px 20px rgba(255, 63, 125, 0.3)' }}>Tiếp tục</button>
      </div>
    </motion.div>
  );
};

export const HeightScreen = ({ profile, updateProfile, onNext }: any) => {
  const h = profile.heightCm || 165;
  const pct = Math.min(100, Math.max(0, ((h - 100) / (220 - 100)) * 100));

  return (
    <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="step-content" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ textAlign: 'center', marginBottom: '40px' }}>
        <h2 style={{ fontSize: '28px', fontWeight: 800, color: '#0f172a', marginBottom: '8px' }}>Chiều cao của bạn?</h2>
        <p style={{ color: '#64748b', fontSize: '15px' }}>Dùng để tính toán chỉ số BMI</p>
      </div>
      
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ position: 'relative', display: 'flex', alignItems: 'baseline', justifyContent: 'center', marginBottom: '40px' }}>
          <span style={{ fontSize: '80px', fontWeight: 800, color: '#ff3f7d', letterSpacing: '-2px', lineHeight: 1 }}>{h}</span>
          <span style={{ fontSize: '24px', fontWeight: 600, color: '#64748b', marginLeft: '8px' }}>cm</span>
        </div>
        
        <div style={{ width: '100%', padding: '0 20px', display: 'flex', alignItems: 'center', gap: '20px' }}>
          <button onClick={() => updateProfile({ heightCm: Math.max(100, h - 1) })} style={{ width: '60px', height: '60px', borderRadius: '30px', background: '#fff4f7', border: 'none', color: '#ff3f7d', fontSize: '32px', fontWeight: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', boxShadow: '0 4px 12px rgba(255, 63, 125, 0.1)', flexShrink: 0 }}>-</button>
          
          <input 
            type="range" min="100" max="220"
            value={h}
            onChange={(e) => updateProfile({ heightCm: parseInt(e.target.value) })}
            className="premium-slider-input" style={{ background: `linear-gradient(to right, #ff3f7d 0%, #ff3f7d ${pct}%, #e2e8f0 ${pct}%, #e2e8f0 100%)`, color: "#ff3f7d" } as any}
          />
          
          <button onClick={() => updateProfile({ heightCm: Math.min(220, h + 1) })} style={{ width: '60px', height: '60px', borderRadius: '30px', background: '#fff4f7', border: 'none', color: '#ff3f7d', fontSize: '32px', fontWeight: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', boxShadow: '0 4px 12px rgba(255, 63, 125, 0.1)', flexShrink: 0 }}>+</button>
        </div>
      </div>
      
      <div className="bottom-cta" style={{ marginTop: 'auto' }}>
        <button className="primary-button" onClick={() => {
          updateProfile({ heightCm: h });
          onNext();
        }} style={{ width: '100%', padding: '16px', borderRadius: '24px', background: 'linear-gradient(135deg, #ff3f7d, #ff8a38)', color: 'white', border: 'none', fontSize: '18px', fontWeight: 700, boxShadow: '0 8px 20px rgba(255, 63, 125, 0.3)' }}>Tiếp tục</button>
      </div>
    </motion.div>
  );
};

export const WeightScreen = ({ profile, updateProfile, onNext }: any) => {
  const currentWeight = profile.weightKg || 60;
  const pct = Math.min(100, Math.max(0, ((currentWeight - 30) / (150 - 30)) * 100));

  return (
    <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="step-content" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ textAlign: 'center', marginBottom: '40px' }}>
        <h2 style={{ fontSize: '28px', fontWeight: 800, color: '#0f172a', marginBottom: '8px' }}>Cân nặng hiện tại?</h2>
        <p style={{ color: '#64748b', fontSize: '15px' }}>Để theo dõi sự thay đổi của cơ thể</p>
      </div>
      
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ position: 'relative', display: 'flex', alignItems: 'baseline', justifyContent: 'center', marginBottom: '40px' }}>
          <span style={{ fontSize: '80px', fontWeight: 800, color: '#ff8a38', letterSpacing: '-2px', lineHeight: 1 }}>{currentWeight.toFixed(1)}</span>
          <span style={{ fontSize: '24px', fontWeight: 600, color: '#64748b', marginLeft: '8px' }}>kg</span>
        </div>
        
        <div style={{ width: '100%', padding: '0 20px', display: 'flex', alignItems: 'center', gap: '20px' }}>
          <button onClick={() => updateProfile({ weightKg: Math.max(30, currentWeight - 0.5) })} style={{ width: '60px', height: '60px', borderRadius: '30px', background: '#fff7ed', border: 'none', color: '#ff8a38', fontSize: '32px', fontWeight: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', boxShadow: '0 4px 12px rgba(255, 138, 56, 0.1)', flexShrink: 0 }}>-</button>
          
          <input 
            type="range" min="30" max="150" step="0.5"
            value={currentWeight}
            onChange={(e) => updateProfile({ weightKg: parseFloat(e.target.value) })}
            className="premium-slider-input" style={{ background: `linear-gradient(to right, #ff8a38 0%, #ff8a38 ${pct}%, #e2e8f0 ${pct}%, #e2e8f0 100%)`, color: "#ff8a38" } as any}
          />
          
          <button onClick={() => updateProfile({ weightKg: Math.min(150, currentWeight + 0.5) })} style={{ width: '60px', height: '60px', borderRadius: '30px', background: '#fff7ed', border: 'none', color: '#ff8a38', fontSize: '32px', fontWeight: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', boxShadow: '0 4px 12px rgba(255, 138, 56, 0.1)', flexShrink: 0 }}>+</button>
        </div>
      </div>
      
      <div className="bottom-cta" style={{ marginTop: 'auto' }}>
        <button className="primary-button" onClick={() => {
          updateProfile({ weightKg: currentWeight });
          onNext();
        }} style={{ width: '100%', padding: '16px', borderRadius: '24px', background: 'linear-gradient(135deg, #ff3f7d, #ff8a38)', color: 'white', border: 'none', fontSize: '18px', fontWeight: 700, boxShadow: '0 8px 20px rgba(255, 63, 125, 0.3)' }}>Tiếp tục</button>
      </div>
    </motion.div>
  );
};

export const PrimaryGoalScreen = ({ profile, updateProfile, onNext }: any) => (
  <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="step-content" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
    <div style={{ textAlign: 'center', marginBottom: '32px' }}>
      <h2 style={{ fontSize: '28px', fontWeight: 800, color: '#0f172a', marginBottom: '8px' }}>Mục tiêu chính?</h2>
      <p style={{ color: '#64748b', fontSize: '15px', lineHeight: 1.5 }}>
        Lựa chọn này sẽ quyết định lộ trình ăn uống và luyện tập của bạn.
      </p>
    </div>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0, flex: 1, justifyContent: 'center' }}>
      <ChoiceCard icon="🔥" title="Giảm mỡ / Giảm cân" subtitle="Tập trung thâm hụt calo và đốt mỡ" selected={profile.primaryGoal === 'fat_loss'} onClick={() => updateProfile({ primaryGoal: 'fat_loss' })} />
      <ChoiceCard icon="💪" title="Tăng cơ / Tăng cân" subtitle="Tập trung thặng dư calo và phát triển cơ" selected={profile.primaryGoal === 'muscle_gain'} onClick={() => updateProfile({ primaryGoal: 'muscle_gain' })} />
      <ChoiceCard icon="⚖️" title="Duy trì vóc dáng" subtitle="Cân bằng năng lượng và giữ mức cân hiện tại" selected={profile.primaryGoal === 'maintenance'} onClick={() => updateProfile({ primaryGoal: 'maintenance' })} />
      <ChoiceCard icon="❤️" title="Sống khỏe hơn" subtitle="Cải thiện sức bền, dinh dưỡng linh hoạt" selected={profile.primaryGoal === 'health'} onClick={() => updateProfile({ primaryGoal: 'health' })} />
    </div>
    <div className="bottom-cta" style={{ marginTop: 'auto' }}>
      <button className="primary-button" disabled={!profile.primaryGoal} onClick={onNext} style={{ width: '100%', padding: '16px', borderRadius: '24px', background: !profile.primaryGoal ? '#e2e8f0' : 'linear-gradient(135deg, #ff3f7d, #ff8a38)', color: !profile.primaryGoal ? '#94a3b8' : 'white', border: 'none', fontSize: '18px', fontWeight: 700, boxShadow: !profile.primaryGoal ? 'none' : '0 8px 20px rgba(255, 63, 125, 0.3)' }}>Tiếp tục</button>
    </div>
  </motion.div>
);

export const TargetWeightScreen = ({ profile, updateProfile, onNext }: any) => {
  const current = profile.weightKg || 60;
  const target = profile.targetWeightKg || current;
  const diff = target - current;
  const pct = Math.min(100, Math.max(0, ((target - 30) / (150 - 30)) * 100));

  const handleNext = () => {
    if (!profile.targetWeightKg) updateProfile({ targetWeightKg: target });
    onNext();
  };

  return (
    <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="step-content" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ textAlign: 'center', marginBottom: '40px' }}>
        <h2 style={{ fontSize: '28px', fontWeight: 800, color: '#0f172a', marginBottom: '8px' }}>Mục tiêu cân nặng?</h2>
        <p style={{ color: '#64748b', fontSize: '15px' }}>
          Bạn muốn {diff < 0 ? 'giảm' : diff > 0 ? 'tăng' : 'duy trì'} <span style={{ fontWeight: 700, color: '#ff3f7d' }}>{Math.abs(diff).toFixed(1)} kg</span>
        </p>
      </div>
      
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ position: 'relative', display: 'flex', alignItems: 'baseline', justifyContent: 'center', marginBottom: '40px' }}>
          <span style={{ fontSize: '80px', fontWeight: 800, color: '#ff3f7d', letterSpacing: '-2px', lineHeight: 1 }}>{target.toFixed(1)}</span>
          <span style={{ fontSize: '24px', fontWeight: 600, color: '#64748b', marginLeft: '8px' }}>kg</span>
        </div>
        
        <div style={{ width: '100%', padding: '0 20px', display: 'flex', alignItems: 'center', gap: '20px' }}>
          <button onClick={() => updateProfile({ targetWeightKg: Math.max(30, target - 0.5) })} style={{ width: '60px', height: '60px', borderRadius: '30px', background: '#fff4f7', border: 'none', color: '#ff3f7d', fontSize: '32px', fontWeight: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', boxShadow: '0 4px 12px rgba(255, 63, 125, 0.1)', flexShrink: 0 }}>-</button>
          
          <input 
            type="range" min="30" max="150" step="0.5"
            value={target}
            onChange={(e) => updateProfile({ targetWeightKg: parseFloat(e.target.value) })}
            className="premium-slider-input" style={{ background: `linear-gradient(to right, #ff3f7d 0%, #ff3f7d ${pct}%, #e2e8f0 ${pct}%, #e2e8f0 100%)`, color: "#ff3f7d" } as any}
          />
          
          <button onClick={() => updateProfile({ targetWeightKg: Math.min(150, target + 0.5) })} style={{ width: '60px', height: '60px', borderRadius: '30px', background: '#fff4f7', border: 'none', color: '#ff3f7d', fontSize: '32px', fontWeight: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', boxShadow: '0 4px 12px rgba(255, 63, 125, 0.1)', flexShrink: 0 }}>+</button>
        </div>
      </div>
      
      <div className="bottom-cta" style={{ marginTop: 'auto' }}>
        <button className="primary-button" onClick={handleNext} style={{ width: '100%', padding: '16px', borderRadius: '24px', background: 'linear-gradient(135deg, #ff3f7d, #ff8a38)', color: 'white', border: 'none', fontSize: '18px', fontWeight: 700, boxShadow: '0 8px 20px rgba(255, 63, 125, 0.3)' }}>Tiếp tục</button>
      </div>
    </motion.div>
  );
};

export const SecondaryGoalsScreen = ({ profile, updateProfile, onNext }: any) => {
  const toggleGoal = (goal: string) => {
    const current = profile.secondaryGoals;
    if (current.includes(goal)) {
      updateProfile({ secondaryGoals: current.filter((g: string) => g !== goal) });
    } else {
      if (current.length >= 3) {
        alert('Bạn có thể chọn tối đa 3 mục tiêu.');
        return;
      }
      updateProfile({ secondaryGoals: [...current, goal] });
    }
  };

  const goalsList = [
    { id: 'fat_loss', icon: '🔥', label: 'Giảm mỡ' },
    { id: 'muscle', icon: '💪', label: 'Tăng cơ' },
    { id: 'stamina', icon: '🏃', label: 'Sức bền' },
    { id: 'toning', icon: '✨', label: 'Săn chắc' },
    { id: 'energy', icon: '⚡', label: 'Năng lượng' },
    { id: 'health', icon: '❤️', label: 'Sức khỏe' },
    { id: 'sleep', icon: '🌙', label: 'Ngủ tốt hơn' },
    { id: 'digestion', icon: '🍽️', label: 'Tiêu hóa' },
    { id: 'focus', icon: '🧠', label: 'Tập trung' },
  ];

  return (
    <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="step-content">
      <h2 className="step-title">Ngoài cân nặng, bạn muốn cải thiện điều gì nhất?</h2>
      <p className="step-subtitle">Chọn tối đa 3 mục tiêu.</p>
      <div className="secondary-goals-grid">
        {goalsList.map(g => (
          <div 
            key={g.id} 
            className={`secondary-goal-item ${profile.secondaryGoals.includes(g.id) ? 'selected' : ''}`}
            onClick={() => toggleGoal(g.id)}
          >
            <div style={{ fontSize: 24 }}>{g.icon}</div>
            <div>{g.label}</div>
          </div>
        ))}
      </div>
      <div className="bottom-cta" style={{ marginTop: 'auto' }}>
        <button className="primary-button" onClick={onNext} style={{ width: '100%', padding: '16px', borderRadius: '24px', background: 'linear-gradient(135deg, #ff3f7d, #ff8a38)', color: 'white', border: 'none', fontSize: '18px', fontWeight: 700, boxShadow: '0 8px 20px rgba(255, 63, 125, 0.3)' }}>Tiếp tục</button>
      </div>
    </motion.div>
  );
};
