const fs = require('fs');
let code = fs.readFileSync('src/onboarding/screens/OnboardingScreens.tsx', 'utf8');

const newGoalScreen = `export const PrimaryGoalScreen = ({ profile, updateProfile, onNext }: any) => (
  <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="step-content" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
    <div style={{ textAlign: 'center', marginBottom: '32px' }}>
      <h2 style={{ fontSize: '28px', fontWeight: 800, color: '#0f172a', marginBottom: '8px' }}>Mục tiêu chính?</h2>
      <p style={{ color: '#64748b', fontSize: '15px', lineHeight: 1.5 }}>
        Lựa chọn này sẽ quyết định lộ trình ăn uống và luyện tập của bạn.
      </p>
    </div>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0, flex: 1, justifyContent: 'center' }}>
      <ChoiceCard icon="🔥" title="Giảm mỡ / Giảm cân" subtitle="Tập trung thâm hụt calo và đốt mỡ" selected={profile.primaryGoal === 'fat_loss'} onClick={() => updateProfile({ primaryGoal: 'fat_loss' })} />
      <ChoiceCard icon="💪" title="Tăng cơ / Tăng cân" subtitle="Tập trung thặng dư calo và phát triển cơ" selected={profile.primaryGoal === 'muscle_gain'} onClick={() => updateProfile({ primaryGoal: 'muscle_gain' })} />
      <ChoiceCard icon="⚖️" title="Duy trì vóc dáng" subtitle="Cân bằng năng lượng và giữ mức cân hiện tại" selected={profile.primaryGoal === 'maintenance'} onClick={() => updateProfile({ primaryGoal: 'maintenance' })} />
      <ChoiceCard icon="❤️" title="Sống khỏe hơn" subtitle="Cải thiện sức bền, dinh dưỡng linh hoạt" selected={profile.primaryGoal === 'health'} onClick={() => updateProfile({ primaryGoal: 'health' })} />
    </div>
    <div className="bottom-cta" style={{ marginTop: 'auto' }}>
      <button className="primary-button" disabled={!profile.primaryGoal} onClick={onNext} style={{ width: '100%', padding: '16px', borderRadius: '24px', background: !profile.primaryGoal ? '#e2e8f0' : 'linear-gradient(135deg, #ff3f7d, #ff8a38)', color: !profile.primaryGoal ? '#94a3b8' : 'white', border: 'none', fontSize: '18px', fontWeight: 700, boxShadow: !profile.primaryGoal ? 'none' : '0 8px 20px rgba(255, 63, 125, 0.3)' }}>Tiếp tục</button>
    </div>
  </motion.div>
);`;

code = code.replace(/export const PrimaryGoalScreen = \(\{ profile, updateProfile, onNext \}: any\) => \([\s\S]*?\n\);\n/, newGoalScreen + '\n');
fs.writeFileSync('src/onboarding/screens/OnboardingScreens.tsx', code);
