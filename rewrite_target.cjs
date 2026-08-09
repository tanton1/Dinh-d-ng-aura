const fs = require('fs');
let code = fs.readFileSync('src/onboarding/screens/OnboardingScreens.tsx', 'utf8');

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
          <span style={{ fontSize: '80px', fontWeight: 800, color: '#3b82f6', letterSpacing: '-2px', lineHeight: 1 }}>{target.toFixed(1)}</span>
          <span style={{ fontSize: '24px', fontWeight: 700, color: '#94a3b8', marginLeft: '8px' }}>kg</span>
        </div>
        
        <div style={{ padding: '8px 16px', borderRadius: '999px', background: diff > 0 ? '#eff6ff' : diff < 0 ? '#f0fdf4' : '#f8fafc', color: diff > 0 ? '#3b82f6' : diff < 0 ? '#22c55e' : '#64748b', fontWeight: 700, fontSize: '14px', marginBottom: '40px' }}>
          {diff > 0 ? '+' : ''}{diff.toFixed(1)} kg
        </div>
        
        <div style={{ width: '100%', padding: '0 20px', display: 'flex', alignItems: 'center', gap: '20px' }}>
          <button onClick={() => updateProfile({ targetWeightKg: Math.max(30, target - 0.5) })} style={{ width: '60px', height: '60px', borderRadius: '30px', background: '#eff6ff', border: 'none', color: '#3b82f6', fontSize: '32px', fontWeight: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', boxShadow: '0 4px 12px rgba(59, 130, 246, 0.1)' }}>-</button>
          
          <input 
            type="range" min="30" max="150" step="0.5"
            value={target}
            onChange={(e) => updateProfile({ targetWeightKg: parseFloat(e.target.value) })}
            style={{ flex: 1, height: '8px', borderRadius: '4px', background: '#f1f5f9', accentColor: '#3b82f6', outline: 'none' }}
          />
          
          <button onClick={() => updateProfile({ targetWeightKg: Math.min(150, target + 0.5) })} style={{ width: '60px', height: '60px', borderRadius: '30px', background: '#eff6ff', border: 'none', color: '#3b82f6', fontSize: '32px', fontWeight: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', boxShadow: '0 4px 12px rgba(59, 130, 246, 0.1)' }}>+</button>
        </div>
      </div>
      
      <div className="bottom-cta" style={{ marginTop: 'auto' }}>
        <button className="primary-button" onClick={handleNext} style={{ width: '100%', padding: '16px', borderRadius: '24px', background: 'linear-gradient(135deg, #3b82f6, #60a5fa)', color: 'white', border: 'none', fontSize: '18px', fontWeight: 700, boxShadow: '0 8px 20px rgba(59, 130, 246, 0.3)' }}>Tiếp tục</button>
      </div>
    </motion.div>
  );
};`;

code = code.replace(/export const TargetWeightScreen = \(\{ profile, updateProfile, onNext \}: any\) => \{[\s\S]*?\n\};\n/, newTarget + '\n');
fs.writeFileSync('src/onboarding/screens/OnboardingScreens.tsx', code);
