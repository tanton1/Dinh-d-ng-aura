const fs = require('fs');
let code = fs.readFileSync('src/onboarding/screens/OnboardingScreens.tsx', 'utf8');

const newBirth = `export const BirthYearScreen = ({ profile, updateProfile, onNext }: any) => {
  const currentYear = new Date().getFullYear();
  const year = profile.birthYear || 1995;
  const age = currentYear - year;

  return (
    <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="step-content" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ textAlign: 'center', marginBottom: '40px' }}>
        <h2 style={{ fontSize: '28px', fontWeight: 800, color: '#0f172a', marginBottom: '8px' }}>Năm sinh của bạn?</h2>
        <p style={{ color: '#64748b', fontSize: '15px' }}>
          Tuổi hiện tại: <span style={{ fontWeight: 700, color: '#a855f7' }}>{age} tuổi</span>
        </p>
      </div>
      
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ position: 'relative', display: 'flex', alignItems: 'baseline', justifyContent: 'center', marginBottom: '40px' }}>
          <span style={{ fontSize: '80px', fontWeight: 800, color: '#a855f7', letterSpacing: '-2px', lineHeight: 1 }}>{year}</span>
        </div>
        
        <div style={{ width: '100%', padding: '0 20px', display: 'flex', alignItems: 'center', gap: '20px' }}>
          <button onClick={() => updateProfile({ birthYear: Math.max(1940, year - 1) })} style={{ width: '60px', height: '60px', borderRadius: '30px', background: '#f3e8ff', border: 'none', color: '#a855f7', fontSize: '32px', fontWeight: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', boxShadow: '0 4px 12px rgba(168, 85, 247, 0.1)' }}>-</button>
          
          <input 
            type="range" min="1940" max={currentYear - 10}
            value={year}
            onChange={(e) => updateProfile({ birthYear: parseInt(e.target.value) })}
            style={{ flex: 1, height: '8px', borderRadius: '4px', background: '#f1f5f9', accentColor: '#a855f7', outline: 'none' }}
          />
          
          <button onClick={() => updateProfile({ birthYear: Math.min(currentYear - 10, year + 1) })} style={{ width: '60px', height: '60px', borderRadius: '30px', background: '#f3e8ff', border: 'none', color: '#a855f7', fontSize: '32px', fontWeight: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', boxShadow: '0 4px 12px rgba(168, 85, 247, 0.1)' }}>+</button>
        </div>
      </div>
      
      <div className="bottom-cta" style={{ marginTop: 'auto' }}>
        <button className="primary-button" onClick={() => {
          if (!profile.birthYear) updateProfile({ birthYear: year });
          onNext();
        }} style={{ width: '100%', padding: '16px', borderRadius: '24px', background: 'linear-gradient(135deg, #a855f7, #ec4899)', color: 'white', border: 'none', fontSize: '18px', fontWeight: 700, boxShadow: '0 8px 20px rgba(168, 85, 247, 0.3)' }}>Tiếp tục</button>
      </div>
    </motion.div>
  );
};`;

code = code.replace(/export const BirthYearScreen = \(\{ profile, updateProfile, onNext \}: any\) => \{[\s\S]*?\n\};\n/, newBirth + '\n');
fs.writeFileSync('src/onboarding/screens/OnboardingScreens.tsx', code);
