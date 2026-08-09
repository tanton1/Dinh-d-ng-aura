const fs = require('fs');
let code = fs.readFileSync('src/onboarding/screens/OnboardingScreens.tsx', 'utf8');

// Upgrade ChoiceCard
const newChoiceCard = `export const ChoiceCard = ({ title, subtitle, selected, onClick, icon }: any) => (
  <div 
    onClick={onClick} 
    style={{ 
      padding: '24px 20px', 
      borderRadius: '24px', 
      border: \`2px solid \${selected ? '#ff3f7d' : 'transparent'}\`, 
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
      border: \`2px solid \${selected ? '#ff3f7d' : '#cbd5e1'}\`,
      background: selected ? '#ff3f7d' : 'transparent',
      display: 'flex', alignItems: 'center', justifyContent: 'center'
    }}>
      {selected && <Check size={16} color="white" strokeWidth={3} />}
    </div>
  </div>
);`;

code = code.replace(/export const ChoiceCard = \(\{ title, subtitle, selected, onClick \}: any\) => \([\s\S]*?\);\n/, newChoiceCard + '\n');
if (!code.includes("import { Check }")) {
  code = code.replace("import { ArrowLeft, Check, CheckCircle2 }", "import { ArrowLeft, Check, CheckCircle2 }");
}

// Upgrade WelcomeScreen text position
const newWelcome = `export const WelcomeScreen = ({ onNext }: any) => (
  <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="step-content" style={{ padding: '0', height: '100%', position: 'relative', background: '#fff5f7', display: 'flex', flexDirection: 'column' }}>
    <div style={{ position: 'absolute', inset: 0, zIndex: 0, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
      <img src="/aura-onboarding.png" alt="Aura Fit Background" style={{ width: '100%', height: '70%', objectFit: 'contain', objectPosition: 'bottom center' }} onError={(e) => { e.currentTarget.style.display = 'none'; }} />
    </div>
    
    <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '40%', background: 'linear-gradient(to bottom, #fff5f7 70%, rgba(255,245,247,0) 100%)', zIndex: 1, pointerEvents: 'none' }}></div>

    <div style={{ position: 'relative', zIndex: 2, display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ textAlign: 'center', paddingTop: '12vh', paddingBottom: 20, paddingLeft: 24, paddingRight: 24 }}>
        <h1 style={{ fontSize: 36, fontWeight: 800, margin: '0 0 16px', lineHeight: 1.2 }}>
          <span style={{ color: '#ff3f7d' }}>
            Chào mừng bạn đến<br/>Aura Fit!
          </span>
        </h1>
        <p style={{ fontSize: 16, color: '#334155', lineHeight: 1.5, fontWeight: 500, margin: '0 auto', maxWidth: 300 }}>
          Chỉ mất khoảng 2 phút để Aura hiểu cơ thể và xây kế hoạch dành riêng cho bạn.
        </p>
      </div>
      
      <div style={{ flex: 1 }}></div>

      <div className="bottom-cta" style={{ padding: '32px 24px', background: 'linear-gradient(to top, rgba(255,255,255,1) 0%, rgba(255,255,255,0.95) 70%, rgba(255,255,255,0) 100%)', display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <button className="primary-button" onClick={onNext} style={{ background: 'linear-gradient(135deg, #ff3f7d, #ff8a38)', border: 'none', color: 'white', padding: '18px', borderRadius: '24px', fontSize: '18px', fontWeight: 700, boxShadow: '0 8px 20px rgba(255, 63, 125, 0.3)', width: '100%' }}>Thiết lập hồ sơ</button>
        <button className="secondary-button" onClick={() => window.location.href = '#/nutrition'} style={{ border: 'none', background: 'rgba(255,255,255,0.8)', color: '#475569', padding: '18px', borderRadius: '24px', fontSize: '18px', fontWeight: 700, width: '100%' }}>Để sau</button>
        
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', marginTop: '4px' }}>
          <ShieldCheck size={16} color="#94a3b8" />
          <span style={{ fontSize: '13px', color: '#94a3b8', fontWeight: 500 }}>Thông tin của bạn được bảo mật tuyệt đối</span>
        </div>
      </div>
    </div>
  </motion.div>
);`;
code = code.replace(/export const WelcomeScreen = \(\{ onNext \}: any\) => \([\s\S]*?\n\);\n/, newWelcome + '\n');

// Upgrade SexScreen
const newSexScreen = `export const SexScreen = ({ profile, updateProfile, onNext }: any) => (
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
);`;
code = code.replace(/export const SexScreen = \(\{ profile, updateProfile, onNext \}: any\) => \([\s\S]*?\n\);\n/, newSexScreen + '\n');

fs.writeFileSync('src/onboarding/screens/OnboardingScreens.tsx', code);
