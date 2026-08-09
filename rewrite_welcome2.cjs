const fs = require('fs');
let code = fs.readFileSync('src/onboarding/screens/OnboardingScreens.tsx', 'utf8');

const newWelcome = `import { ShieldCheck } from 'lucide-react';

export const WelcomeScreen = ({ onNext }: any) => (
  <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="step-content" style={{ justifyContent: 'center', padding: '0', height: '100%', position: 'relative', background: '#fff5f7' }}>
    <div style={{ position: 'absolute', inset: 0, zIndex: 0 }}>
      <img src="/aura-onboarding.png" alt="Aura Fit Background" style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center' }} onError={(e) => { e.currentTarget.style.display = 'none'; }} />
    </div>
    
    <div style={{ position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ textAlign: 'center', paddingTop: 80, paddingBottom: 20, paddingLeft: 24, paddingRight: 24 }}>
        <h1 style={{ fontSize: 32, fontWeight: 800, margin: '0 0 16px', lineHeight: 1.2 }}>
          <span style={{ background: 'linear-gradient(90deg, #ff3f7d, #ff8a38)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
            Chào mừng bạn đến<br/>Aura Fit!
          </span>
        </h1>
        <p style={{ fontSize: 15, color: '#334155', lineHeight: 1.5, fontWeight: 500, margin: '0 auto', maxWidth: 300 }}>
          Chỉ mất khoảng 2 phút để Aura hiểu cơ thể và xây kế hoạch dành riêng cho bạn.
        </p>
      </div>
      
      <div style={{ flex: 1 }}></div>

      <div className="bottom-cta" style={{ padding: '0 24px 32px', background: 'linear-gradient(to top, rgba(255,255,255,1) 0%, rgba(255,255,255,0.9) 70%, rgba(255,255,255,0) 100%)', display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <button className="primary-button" onClick={onNext} style={{ background: 'linear-gradient(135deg, #ff3f7d, #ff8a38)', border: 'none', color: 'white', padding: '16px', borderRadius: '24px', fontSize: '18px', fontWeight: 700, boxShadow: '0 8px 20px rgba(255, 63, 125, 0.3)' }}>Thiết lập hồ sơ</button>
        <button className="secondary-button" onClick={() => window.location.href = '#/nutrition'} style={{ border: '1px solid #ffdde5', background: 'white', color: '#334155', padding: '16px', borderRadius: '24px', fontSize: '18px', fontWeight: 700 }}>Để sau</button>
        
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', marginTop: '4px' }}>
          <ShieldCheck size={16} color="#94a3b8" />
          <span style={{ fontSize: '13px', color: '#94a3b8', fontWeight: 500 }}>Thông tin của bạn được bảo mật tuyệt đối</span>
        </div>
      </div>
    </div>
  </motion.div>
);`;

code = code.replace(/export const WelcomeScreen = \(\{ onNext \}: any\) => \([\s\S]*?\n\);\n/, newWelcome + '\n');
fs.writeFileSync('src/onboarding/screens/OnboardingScreens.tsx', code);
