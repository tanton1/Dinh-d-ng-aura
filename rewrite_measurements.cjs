const fs = require('fs');
let code = fs.readFileSync('src/onboarding/screens/OnboardingScreens.tsx', 'utf8');

const newHeight = `export const HeightScreen = ({ profile, updateProfile, onNext }: any) => {
  const currentHeight = profile.heightCm || 165;
  return (
    <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="step-content" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ textAlign: 'center', marginBottom: '40px' }}>
        <h2 style={{ fontSize: '28px', fontWeight: 800, color: '#0f172a', marginBottom: '8px' }}>Chiều cao của bạn?</h2>
        <p style={{ color: '#64748b', fontSize: '15px' }}>Dùng để tính toán lượng calo cơ bản BMR.</p>
      </div>
      
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ position: 'relative', display: 'flex', alignItems: 'baseline', justifyContent: 'center', marginBottom: '40px' }}>
          <span style={{ fontSize: '80px', fontWeight: 800, color: '#ff3f7d', letterSpacing: '-2px', lineHeight: 1 }}>{currentHeight}</span>
          <span style={{ fontSize: '24px', fontWeight: 700, color: '#94a3b8', marginLeft: '8px' }}>cm</span>
        </div>
        
        <div style={{ width: '100%', padding: '0 20px', display: 'flex', alignItems: 'center', gap: '20px' }}>
          <button onClick={() => updateProfile({ heightCm: Math.max(120, currentHeight - 1) })} style={{ width: '60px', height: '60px', borderRadius: '30px', background: '#fff4f7', border: 'none', color: '#ff3f7d', fontSize: '32px', fontWeight: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', boxShadow: '0 4px 12px rgba(255, 63, 125, 0.1)' }}>-</button>
          
          <input 
            type="range" min="120" max="230" 
            value={currentHeight}
            onChange={(e) => updateProfile({ heightCm: parseInt(e.target.value) })}
            style={{ flex: 1, height: '8px', borderRadius: '4px', background: '#f1f5f9', accentColor: '#ff3f7d', outline: 'none' }}
          />
          
          <button onClick={() => updateProfile({ heightCm: Math.min(230, currentHeight + 1) })} style={{ width: '60px', height: '60px', borderRadius: '30px', background: '#fff4f7', border: 'none', color: '#ff3f7d', fontSize: '32px', fontWeight: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', boxShadow: '0 4px 12px rgba(255, 63, 125, 0.1)' }}>+</button>
        </div>
      </div>
      
      <div className="bottom-cta" style={{ marginTop: 'auto' }}>
        <button className="primary-button" onClick={() => {
          if (!profile.heightCm) updateProfile({ heightCm: currentHeight });
          onNext();
        }} style={{ width: '100%', padding: '16px', borderRadius: '24px', background: 'linear-gradient(135deg, #ff3f7d, #ff8a38)', color: 'white', border: 'none', fontSize: '18px', fontWeight: 700, boxShadow: '0 8px 20px rgba(255, 63, 125, 0.3)' }}>Tiếp tục</button>
      </div>
    </motion.div>
  );
};`;

const newWeight = `export const WeightScreen = ({ profile, updateProfile, onNext }: any) => {
  const currentWeight = profile.weightKg || 60;
  return (
    <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="step-content" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ textAlign: 'center', marginBottom: '40px' }}>
        <h2 style={{ fontSize: '28px', fontWeight: 800, color: '#0f172a', marginBottom: '8px' }}>Cân nặng hiện tại?</h2>
        <p style={{ color: '#64748b', fontSize: '15px' }}>Aura dùng số liệu này làm mốc bắt đầu.</p>
      </div>
      
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ position: 'relative', display: 'flex', alignItems: 'baseline', justifyContent: 'center', marginBottom: '40px' }}>
          <span style={{ fontSize: '80px', fontWeight: 800, color: '#ff8a38', letterSpacing: '-2px', lineHeight: 1 }}>{currentWeight.toFixed(1)}</span>
          <span style={{ fontSize: '24px', fontWeight: 700, color: '#94a3b8', marginLeft: '8px' }}>kg</span>
        </div>
        
        <div style={{ width: '100%', padding: '0 20px', display: 'flex', alignItems: 'center', gap: '20px' }}>
          <button onClick={() => updateProfile({ weightKg: Math.max(30, currentWeight - 0.5) })} style={{ width: '60px', height: '60px', borderRadius: '30px', background: '#fff7ed', border: 'none', color: '#ff8a38', fontSize: '32px', fontWeight: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', boxShadow: '0 4px 12px rgba(255, 138, 56, 0.1)' }}>-</button>
          
          <input 
            type="range" min="30" max="150" step="0.5"
            value={currentWeight}
            onChange={(e) => updateProfile({ weightKg: parseFloat(e.target.value) })}
            style={{ flex: 1, height: '8px', borderRadius: '4px', background: '#f1f5f9', accentColor: '#ff8a38', outline: 'none' }}
          />
          
          <button onClick={() => updateProfile({ weightKg: Math.min(150, currentWeight + 0.5) })} style={{ width: '60px', height: '60px', borderRadius: '30px', background: '#fff7ed', border: 'none', color: '#ff8a38', fontSize: '32px', fontWeight: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', boxShadow: '0 4px 12px rgba(255, 138, 56, 0.1)' }}>+</button>
        </div>
      </div>
      
      <div className="bottom-cta" style={{ marginTop: 'auto' }}>
        <button className="primary-button" onClick={() => {
          if (!profile.weightKg) updateProfile({ weightKg: currentWeight });
          onNext();
        }} style={{ width: '100%', padding: '16px', borderRadius: '24px', background: 'linear-gradient(135deg, #ff8a38, #ff3f7d)', color: 'white', border: 'none', fontSize: '18px', fontWeight: 700, boxShadow: '0 8px 20px rgba(255, 138, 56, 0.3)' }}>Tiếp tục</button>
      </div>
    </motion.div>
  );
};`;

code = code.replace(/export const HeightScreen = \(\{ profile, updateProfile, onNext \}: any\) => \{[\s\S]*?\n\};\n/, newHeight + '\n');
code = code.replace(/export const WeightScreen = \(\{ profile, updateProfile, onNext \}: any\) => \{[\s\S]*?\n\};\n/, newWeight + '\n');
fs.writeFileSync('src/onboarding/screens/OnboardingScreens.tsx', code);
