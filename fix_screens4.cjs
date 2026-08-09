const fs = require('fs');
let code = fs.readFileSync('src/onboarding/screens/OnboardingScreens4.tsx', 'utf8');

const notifCode = `
export const NotificationsScreen = ({ profile, updateProfile, onNext }: any) => {
  const times = profile.mealTimes || ['07:30', '12:00', '19:00'];
  
  const handleTimeChange = (index, value) => {
    const newTimes = [...times];
    newTimes[index] = value;
    updateProfile({ mealTimes: newTimes });
  };

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="step-content">
      <h2 className="step-title">Giờ ăn của bạn</h2>
      <p className="step-subtitle">Aura sẽ nhắc nhở bạn ghi chép bữa ăn để theo dõi calo chính xác nhất.</p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 24 }}>
        <div className="choice-card" style={{ padding: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontWeight: 600, fontSize: 16 }}>Bữa sáng</div>
            <div style={{ fontSize: 13, color: 'var(--aura-muted)', marginTop: 4 }}>Bắt đầu ngày mới</div>
          </div>
          <input type="time" value={times[0]} onChange={e => handleTimeChange(0, e.target.value)} style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid var(--aura-border)', fontSize: 16, outline: 'none' }} />
        </div>
        
        <div className="choice-card" style={{ padding: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontWeight: 600, fontSize: 16 }}>Bữa trưa</div>
            <div style={{ fontSize: 13, color: 'var(--aura-muted)', marginTop: 4 }}>Nạp lại năng lượng</div>
          </div>
          <input type="time" value={times[1]} onChange={e => handleTimeChange(1, e.target.value)} style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid var(--aura-border)', fontSize: 16, outline: 'none' }} />
        </div>
        
        <div className="choice-card" style={{ padding: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontWeight: 600, fontSize: 16 }}>Bữa tối</div>
            <div style={{ fontSize: 13, color: 'var(--aura-muted)', marginTop: 4 }}>Kết thúc ngày</div>
          </div>
          <input type="time" value={times[2]} onChange={e => handleTimeChange(2, e.target.value)} style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid var(--aura-border)', fontSize: 16, outline: 'none' }} />
        </div>
      </div>

      <div className="bottom-cta" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <button className="primary-button" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }} onClick={() => {
          updateProfile({ notificationsEnabled: true, mealTimes: times });
          onNext();
        }}>
          Bật thông báo nhắc nhở
        </button>
        <button className="secondary-button" onClick={() => {
          updateProfile({ notificationsEnabled: false, mealTimes: times });
          onNext();
        }}>
          Lúc khác
        </button>
      </div>
    </motion.div>
  );
};
`;

if (!code.includes('NotificationsScreen')) {
  code = code + notifCode;
  fs.writeFileSync('src/onboarding/screens/OnboardingScreens4.tsx', code);
}
