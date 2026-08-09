const fs = require('fs');

// 1. Fix index.html loading screen
let indexHtml = fs.readFileSync('index.html', 'utf8');
indexHtml = indexHtml.replace(/<div id="root">[\s\S]*?<\/div>\n    <div id="recaptcha-container">/, `<div id="root">
      <style>
        .app-loader {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          height: 100vh;
          background-color: #fff5f7;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          position: relative;
        }
        .app-loader-spinner {
          width: 48px;
          height: 48px;
          border: 4px solid #ffe4e6;
          border-top-color: #ff3f7d;
          border-radius: 50%;
          animation: spin 1s linear infinite;
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      </style>
      <div class="app-loader">
        <h1 style="color: #ff3f7d; font-size: 36px; font-weight: 800; margin-bottom: 24px; letter-spacing: -1px;">AURA FIT</h1>
        <div class="app-loader-spinner"></div>
      </div>
    </div>
    <div id="recaptcha-container">`);
fs.writeFileSync('index.html', indexHtml);

// 2. Fix OnboardingScreens.tsx
let screens1 = fs.readFileSync('src/onboarding/screens/OnboardingScreens.tsx', 'utf8');

const newWelcome = `export const WelcomeScreen = ({ onNext }: any) => (
  <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="step-content" style={{ padding: '0', height: '100%', position: 'relative', background: '#fff5f7', display: 'flex', flexDirection: 'column' }}>
    <div style={{ position: 'absolute', inset: 0, zIndex: 0 }}>
      <img src="/aura-onboarding.png" alt="Aura Fit Background" style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center' }} onError={(e) => { e.currentTarget.style.display = 'none'; }} />
    </div>
    
    <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '35%', background: 'linear-gradient(to bottom, rgba(255,255,255,1) 0%, rgba(255,255,255,0.85) 50%, rgba(255,255,255,0) 100%)', zIndex: 1, pointerEvents: 'none' }}></div>
    <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: '40%', background: 'linear-gradient(to top, rgba(255,255,255,1) 0%, rgba(255,255,255,0.95) 60%, rgba(255,255,255,0) 100%)', zIndex: 1, pointerEvents: 'none' }}></div>

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

      <div className="bottom-cta" style={{ padding: '32px 24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <button className="primary-button" onClick={onNext} style={{ background: 'linear-gradient(135deg, #ff3f7d, #ff8a38)', border: 'none', color: 'white', padding: '18px', borderRadius: '24px', fontSize: '18px', fontWeight: 700, boxShadow: '0 8px 20px rgba(255, 63, 125, 0.3)', width: '100%' }}>Thiết lập hồ sơ</button>
        <button className="secondary-button" onClick={() => window.location.href = '#/nutrition'} style={{ border: 'none', background: 'rgba(255,255,255,0.9)', color: '#475569', padding: '18px', borderRadius: '24px', fontSize: '18px', fontWeight: 700, width: '100%' }}>Để sau</button>
        
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', marginTop: '4px' }}>
          <ShieldCheck size={16} color="#94a3b8" />
          <span style={{ fontSize: '13px', color: '#94a3b8', fontWeight: 500 }}>Thông tin của bạn được bảo mật tuyệt đối</span>
        </div>
      </div>
    </div>
  </motion.div>
);`;
screens1 = screens1.replace(/export const WelcomeScreen = \(\{ onNext \}: any\) => \([\s\S]*?\n\);\n/, newWelcome + '\n');

// TargetWeightScreen
const newTarget = `export const TargetWeightScreen = ({ profile, updateProfile, onNext }: any) => {
  const current = profile.weightKg || 60;
  const target = profile.targetWeightKg || (profile.primaryGoal === 'fat_loss' ? current - 5 : current + 5);
  const diff = target - current;
  
  const handleNext = () => {
    if (profile.primaryGoal === 'fat_loss' && target >= current) {
      alert('Cân nặng mục tiêu cần thấp hơn cân nặng hiện tại.');
      return;
    }
    if (profile.primaryGoal === 'muscle_gain' && target <= current) {
      alert('Cân nặng mục tiêu cần cao hơn cân nặng hiện tại.');
      return;
    }
    if (!profile.targetWeightKg) updateProfile({ targetWeightKg: target });
    onNext();
  };

  return (
    <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="step-content" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ textAlign: 'center', marginBottom: '40px' }}>
        <h2 style={{ fontSize: '28px', fontWeight: 800, color: '#0f172a', marginBottom: '8px' }}>Mức cân mong muốn?</h2>
        <p style={{ color: '#64748b', fontSize: '15px' }}>
          Hiện tại: <span style={{ fontWeight: 700, color: '#ff8a38' }}>{current.toFixed(1)} kg</span>
        </p>
      </div>
      
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ position: 'relative', display: 'flex', alignItems: 'baseline', justifyContent: 'center', marginBottom: '16px' }}>
          <span style={{ fontSize: '80px', fontWeight: 800, color: '#ff3f7d', letterSpacing: '-2px', lineHeight: 1 }}>{target.toFixed(1)}</span>
          <span style={{ fontSize: '24px', fontWeight: 700, color: '#94a3b8', marginLeft: '8px' }}>kg</span>
        </div>
        
        <div style={{ padding: '8px 16px', borderRadius: '999px', background: diff > 0 ? '#fff4f7' : diff < 0 ? '#fff7ed' : '#f8fafc', color: diff > 0 ? '#ff3f7d' : diff < 0 ? '#ff8a38' : '#64748b', fontWeight: 700, fontSize: '14px', marginBottom: '40px' }}>
          {diff > 0 ? '+' : ''}{diff.toFixed(1)} kg
        </div>
        
        <div style={{ width: '100%', padding: '0 20px', display: 'flex', alignItems: 'center', gap: '20px' }}>
          <button onClick={() => updateProfile({ targetWeightKg: Math.max(30, target - 0.5) })} style={{ width: '60px', height: '60px', borderRadius: '30px', background: '#fff4f7', border: 'none', color: '#ff3f7d', fontSize: '32px', fontWeight: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', boxShadow: '0 4px 12px rgba(255, 63, 125, 0.1)' }}>-</button>
          
          <input 
            type="range" min="30" max="150" step="0.5"
            value={target}
            onChange={(e) => updateProfile({ targetWeightKg: parseFloat(e.target.value) })}
            className="premium-slider-input" style={{ color: "#ff3f7d" } as any}
          />
          
          <button onClick={() => updateProfile({ targetWeightKg: Math.min(150, target + 0.5) })} style={{ width: '60px', height: '60px', borderRadius: '30px', background: '#fff4f7', border: 'none', color: '#ff3f7d', fontSize: '32px', fontWeight: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', boxShadow: '0 4px 12px rgba(255, 63, 125, 0.1)' }}>+</button>
        </div>
      </div>
      
      <div className="bottom-cta" style={{ marginTop: 'auto' }}>
        <button className="primary-button" onClick={handleNext} style={{ width: '100%', padding: '16px', borderRadius: '24px', background: 'linear-gradient(135deg, #ff3f7d, #ff8a38)', color: 'white', border: 'none', fontSize: '18px', fontWeight: 700, boxShadow: '0 8px 20px rgba(255, 63, 125, 0.3)' }}>Tiếp tục</button>
      </div>
    </motion.div>
  );
};`;
screens1 = screens1.replace(/export const TargetWeightScreen = \(\{ profile, updateProfile, onNext \}: any\) => \{[\s\S]*?\n\};\n/, newTarget + '\n');

// BirthYearScreen
const newBirthYear = `export const BirthYearScreen = ({ profile, updateProfile, onNext }: any) => {
  const currentYear = new Date().getFullYear();
  const year = profile.birthYear || 1995;
  const age = currentYear - year;

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
            className="premium-slider-input" style={{ color: "#ff3f7d" } as any}
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
};`;
screens1 = screens1.replace(/export const BirthYearScreen = \(\{ profile, updateProfile, onNext \}: any\) => \{[\s\S]*?\n\};\n/, newBirthYear + '\n');
fs.writeFileSync('src/onboarding/screens/OnboardingScreens.tsx', screens1);

// 3. Fix OnboardingScreens4.tsx Notification colors
let screens4 = fs.readFileSync('src/onboarding/screens/OnboardingScreens4.tsx', 'utf8');
const newNotif = `export const NotificationsScreen = ({ profile, updateProfile, onNext }: any) => {
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
};`;
screens4 = screens4.replace(/export const NotificationsScreen = \(\{ profile, updateProfile, onNext \}: any\) => \{[\s\S]*?\n\};\n/, newNotif + '\n');
fs.writeFileSync('src/onboarding/screens/OnboardingScreens4.tsx', screens4);

