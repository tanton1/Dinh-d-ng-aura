const fs = require('fs');

let code = fs.readFileSync('src/onboarding/screens/OnboardingScreens.tsx', 'utf8');

const heightScreen = `export const HeightScreen = ({ profile, updateProfile, onNext }: any) => {
  const h = profile.heightCm || 165;
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
            className="premium-slider-input" style={{ color: "#ff3f7d" } as any}
          />
          
          <button onClick={() => updateProfile({ heightCm: Math.min(220, h + 1) })} style={{ width: '60px', height: '60px', borderRadius: '30px', background: '#fff4f7', border: 'none', color: '#ff3f7d', fontSize: '32px', fontWeight: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', boxShadow: '0 4px 12px rgba(255, 63, 125, 0.1)', flexShrink: 0 }}>+</button>
        </div>
      </div>
      
      <div className="bottom-cta" style={{ marginTop: 'auto' }}>
        <button className="primary-button" onClick={onNext} style={{ width: '100%', padding: '16px', borderRadius: '24px', background: 'linear-gradient(135deg, #ff3f7d, #ff8a38)', color: 'white', border: 'none', fontSize: '18px', fontWeight: 700, boxShadow: '0 8px 20px rgba(255, 63, 125, 0.3)' }}>Tiếp tục</button>
      </div>
    </motion.div>
  );
};`;

const weightScreen = `export const WeightScreen = ({ profile, updateProfile, onNext }: any) => {
  const currentWeight = profile.weightKg || 60;
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
            className="premium-slider-input" style={{ color: "#ff8a38" } as any}
          />
          
          <button onClick={() => updateProfile({ weightKg: Math.min(150, currentWeight + 0.5) })} style={{ width: '60px', height: '60px', borderRadius: '30px', background: '#fff7ed', border: 'none', color: '#ff8a38', fontSize: '32px', fontWeight: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', boxShadow: '0 4px 12px rgba(255, 138, 56, 0.1)', flexShrink: 0 }}>+</button>
        </div>
      </div>
      
      <div className="bottom-cta" style={{ marginTop: 'auto' }}>
        <button className="primary-button" onClick={onNext} style={{ width: '100%', padding: '16px', borderRadius: '24px', background: 'linear-gradient(135deg, #ff3f7d, #ff8a38)', color: 'white', border: 'none', fontSize: '18px', fontWeight: 700, boxShadow: '0 8px 20px rgba(255, 63, 125, 0.3)' }}>Tiếp tục</button>
      </div>
    </motion.div>
  );
};`;

const targetWeightScreen = `export const TargetWeightScreen = ({ profile, updateProfile, onNext }: any) => {
  const t = profile.targetWeightKg || (profile.weightKg || 60);
  const diff = profile.weightKg ? t - profile.weightKg : 0;
  
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
          <span style={{ fontSize: '80px', fontWeight: 800, color: '#ff3f7d', letterSpacing: '-2px', lineHeight: 1 }}>{t.toFixed(1)}</span>
          <span style={{ fontSize: '24px', fontWeight: 600, color: '#64748b', marginLeft: '8px' }}>kg</span>
        </div>
        
        <div style={{ width: '100%', padding: '0 20px', display: 'flex', alignItems: 'center', gap: '20px' }}>
          <button onClick={() => updateProfile({ targetWeightKg: Math.max(30, t - 0.5) })} style={{ width: '60px', height: '60px', borderRadius: '30px', background: '#fff4f7', border: 'none', color: '#ff3f7d', fontSize: '32px', fontWeight: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', boxShadow: '0 4px 12px rgba(255, 63, 125, 0.1)', flexShrink: 0 }}>-</button>
          
          <input 
            type="range" min="30" max="150" step="0.5"
            value={t}
            onChange={(e) => updateProfile({ targetWeightKg: parseFloat(e.target.value) })}
            className="premium-slider-input" style={{ color: "#ff3f7d" } as any}
          />
          
          <button onClick={() => updateProfile({ targetWeightKg: Math.min(150, t + 0.5) })} style={{ width: '60px', height: '60px', borderRadius: '30px', background: '#fff4f7', border: 'none', color: '#ff3f7d', fontSize: '32px', fontWeight: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', boxShadow: '0 4px 12px rgba(255, 63, 125, 0.1)', flexShrink: 0 }}>+</button>
        </div>
      </div>
      
      <div className="bottom-cta" style={{ marginTop: 'auto' }}>
        <button className="primary-button" onClick={onNext} style={{ width: '100%', padding: '16px', borderRadius: '24px', background: 'linear-gradient(135deg, #ff3f7d, #ff8a38)', color: 'white', border: 'none', fontSize: '18px', fontWeight: 700, boxShadow: '0 8px 20px rgba(255, 63, 125, 0.3)' }}>Tiếp tục</button>
      </div>
    </motion.div>
  );
};`;

code = code.replace(/export const HeightScreen = \(\{[\s\S]*?\};/m, heightScreen);
code = code.replace(/export const WeightScreen = \(\{[\s\S]*?\};/m, weightScreen);
code = code.replace(/export const TargetWeightScreen = \(\{[\s\S]*?\};/m, targetWeightScreen);

fs.writeFileSync('src/onboarding/screens/OnboardingScreens.tsx', code);
