const fs = require('fs');
let code = fs.readFileSync('src/onboarding/screens/OnboardingScreens4.tsx', 'utf8');

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
        <div style={{ width: '80px', height: '80px', borderRadius: '40px', background: 'linear-gradient(135deg, #f3e8ff, #e9d5ff)', margin: '0 auto 24px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Bell size={40} color="#9333ea" />
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
          <input type="time" value={times[0]} onChange={e => handleTimeChange(0, e.target.value)} style={{ padding: '10px 16px', borderRadius: '16px', border: 'none', background: '#f8fafc', fontSize: '18px', fontWeight: 700, color: '#334155', outline: 'none' }} />
        </div>
        
        <div style={{ background: 'white', padding: '20px', borderRadius: '24px', border: '1px solid var(--aura-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', boxShadow: '0 4px 12px rgba(0,0,0,0.02)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <div style={{ width: '48px', height: '48px', borderRadius: '24px', background: '#f0fdf4', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <span style={{ fontSize: '20px' }}>☀️</span>
            </div>
            <div>
              <div style={{ fontWeight: 800, fontSize: '18px', color: '#0f172a' }}>Bữa trưa</div>
              <div style={{ fontSize: '13px', color: 'var(--aura-muted)', marginTop: '2px' }}>Nạp lại năng lượng</div>
            </div>
          </div>
          <input type="time" value={times[1]} onChange={e => handleTimeChange(1, e.target.value)} style={{ padding: '10px 16px', borderRadius: '16px', border: 'none', background: '#f8fafc', fontSize: '18px', fontWeight: 700, color: '#334155', outline: 'none' }} />
        </div>
        
        <div style={{ background: 'white', padding: '20px', borderRadius: '24px', border: '1px solid var(--aura-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', boxShadow: '0 4px 12px rgba(0,0,0,0.02)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <div style={{ width: '48px', height: '48px', borderRadius: '24px', background: '#eff6ff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <span style={{ fontSize: '20px' }}>🌙</span>
            </div>
            <div>
              <div style={{ fontWeight: 800, fontSize: '18px', color: '#0f172a' }}>Bữa tối</div>
              <div style={{ fontSize: '13px', color: 'var(--aura-muted)', marginTop: '2px' }}>Kết thúc ngày</div>
            </div>
          </div>
          <input type="time" value={times[2]} onChange={e => handleTimeChange(2, e.target.value)} style={{ padding: '10px 16px', borderRadius: '16px', border: 'none', background: '#f8fafc', fontSize: '18px', fontWeight: 700, color: '#334155', outline: 'none' }} />
        </div>
      </div>

      <div className="bottom-cta" style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <button className="primary-button" style={{ width: '100%', padding: '16px', borderRadius: '24px', background: 'linear-gradient(135deg, #a855f7, #ec4899)', color: 'white', border: 'none', fontSize: '18px', fontWeight: 700, boxShadow: '0 8px 20px rgba(168, 85, 247, 0.3)' }} onClick={() => {
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

code = code.replace(/export const NotificationsScreen = \(\{ profile, updateProfile, onNext \}: any\) => \{[\s\S]*?\n\};\n/, newNotif + '\n');
if (!code.includes("import { Bell }")) {
  code = code.replace("import { motion }", "import { motion } from 'motion/react';\nimport { Bell }");
}
fs.writeFileSync('src/onboarding/screens/OnboardingScreens4.tsx', code);
