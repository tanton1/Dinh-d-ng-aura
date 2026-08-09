const fs = require('fs');

let code = fs.readFileSync('src/onboarding/screens/OnboardingScreens.tsx', 'utf8');

const welcomeOld = `export const WelcomeScreen = ({ onNext }: any) => (
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
      </div>`;

const welcomeNew = `export const WelcomeScreen = ({ onNext }: any) => (
  <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="step-content" style={{ padding: '0', height: '100%', position: 'relative', background: '#fff5f7', display: 'flex', flexDirection: 'column' }}>
    <div style={{ position: 'absolute', inset: 0, zIndex: 0 }}>
      <img src="/aura-onboarding.png" alt="Aura Fit Background" style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center' }} onError={(e) => { e.currentTarget.style.display = 'none'; }} />
    </div>
    
    <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '35%', background: 'linear-gradient(to bottom, rgba(255,255,255,1) 0%, rgba(255,255,255,0.85) 50%, rgba(255,255,255,0) 100%)', zIndex: 1, pointerEvents: 'none' }}></div>
    <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: '40%', background: 'linear-gradient(to top, rgba(255,255,255,1) 0%, rgba(255,255,255,0.95) 60%, rgba(255,255,255,0) 100%)', zIndex: 1, pointerEvents: 'none' }}></div>
    <div style={{ position: 'relative', zIndex: 2, display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ textAlign: 'center', paddingTop: '40px', paddingBottom: 20, paddingLeft: 24, paddingRight: 24 }}>
        <img src="https://aurafitness.vn/wp-content/uploads/2023/11/LogoAura_Update_final2.png" alt="Aura Fitness" style={{ width: 140, objectFit: 'contain', margin: '0 auto 24px' }} />
        <h1 style={{ fontSize: 32, fontWeight: 800, margin: '0 0 12px', lineHeight: 1.2 }}>
          <span style={{ color: '#ff3f7d' }}>
            Chào mừng bạn!
          </span>
        </h1>
        <p style={{ fontSize: 15, color: '#334155', lineHeight: 1.5, fontWeight: 600, margin: '0 auto', maxWidth: 300 }}>
          Chỉ mất khoảng 2 phút để Aura hiểu cơ thể và xây kế hoạch dành riêng cho bạn.
        </p>
      </div>`;

code = code.replace(welcomeOld, welcomeNew);

fs.writeFileSync('src/onboarding/screens/OnboardingScreens.tsx', code);
