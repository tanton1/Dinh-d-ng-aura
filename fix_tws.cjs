const fs = require('fs');
let code = fs.readFileSync('src/onboarding/screens/OnboardingScreens.tsx', 'utf8');

const regex = /export const TargetWeightScreen = \(\{ profile, updateProfile, onNext \}: any\) => \{[\s\S]*?export const SecondaryGoalsScreen = \(\{ profile, updateProfile, onNext \}: any\) => \{/;

const replacement = `export const TargetWeightScreen = ({ profile, updateProfile, onNext }: any) => {
  const current = profile.weightKg || 60;
  const target = profile.targetWeightKg || current;
  const diff = target - current;

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
            className="premium-slider-input" style={{ color: "#ff3f7d" } as any}
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

export const SecondaryGoalsScreen = ({ profile, updateProfile, onNext }: any) => {`;

code = code.replace(regex, replacement);
fs.writeFileSync('src/onboarding/screens/OnboardingScreens.tsx', code);
