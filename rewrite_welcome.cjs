const fs = require('fs');
let code = fs.readFileSync('src/onboarding/screens/OnboardingScreens.tsx', 'utf8');

const newWelcome = `export const WelcomeScreen = ({ onNext }: any) => (
  <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="step-content" style={{ justifyContent: 'center', padding: '0', height: '100%', position: 'relative' }}>
    <div style={{ position: 'absolute', inset: 0, zIndex: 0 }}>
      <img src="/aura-onboarding.png" alt="Aura Fit Background" style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center' }} onError={(e) => { e.currentTarget.style.display = 'none'; }} />
      <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to bottom, rgba(255,255,255,0.8) 0%, rgba(255,255,255,0.2) 50%, rgba(255,255,255,1) 100%)' }}></div>
    </div>
    
    <div style={{ position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ textAlign: 'center', paddingTop: 60, paddingBottom: 20, paddingLeft: 24, paddingRight: 24 }}>
        <img src="/aura-logo.png" alt="Aura Fit Logo" style={{ height: '80px', margin: '0 auto 16px' }} onError={(e) => { e.currentTarget.style.display = 'none'; }} />
        <p style={{ fontSize: 16, color: '#475569', lineHeight: 1.6, fontWeight: 600 }}>Chỉ mất khoảng 2 phút để Aura hiểu cơ thể và xây kế hoạch dành riêng cho bạn.</p>
      </div>
      
      <div style={{ flex: 1 }}></div>

      <div className="bottom-cta" style={{ padding: '24px', background: 'white' }}>
        <button className="primary-button" onClick={onNext} style={{ background: 'linear-gradient(135deg, #ff8a38, #ff3f7d)', border: 'none', color: 'white' }}>Thiết lập hồ sơ</button>
        <button className="secondary-button" onClick={() => window.location.href = '#/nutrition'} style={{ border: 'none', background: '#f1f5f9', color: '#475569' }}>Để sau</button>
      </div>
    </div>
  </motion.div>
);`;

code = code.replace(/export const WelcomeScreen = \(\{ onNext \}: any\) => \([\s\S]*?\n\);\n/, newWelcome + '\n');
fs.writeFileSync('src/onboarding/screens/OnboardingScreens.tsx', code);
