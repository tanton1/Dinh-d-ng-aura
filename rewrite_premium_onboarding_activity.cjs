const fs = require('fs');
let code = fs.readFileSync('src/onboarding/screens/OnboardingScreens2.tsx', 'utf8');

const newActivityScreen = `import { ChoiceCard } from './OnboardingScreens';

export const ActivityScreen = ({ profile, updateProfile, onNext }: any) => (
  <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="step-content" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
    <div style={{ textAlign: 'center', marginBottom: '32px' }}>
      <h2 style={{ fontSize: '28px', fontWeight: 800, color: '#0f172a', marginBottom: '8px' }}>Mức độ vận động?</h2>
      <p style={{ color: '#64748b', fontSize: '15px', lineHeight: 1.5 }}>
        Điều này giúp tính toán năng lượng tiêu hao hằng ngày (TDEE).
      </p>
    </div>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0, flex: 1, justifyContent: 'center' }}>
      <ChoiceCard icon="🛋️" title="Ít vận động" subtitle="Làm việc văn phòng, không tập thể dục" selected={profile.activityLevel === 'sedentary'} onClick={() => updateProfile({ activityLevel: 'sedentary' })} />
      <ChoiceCard icon="🚶" title="Vận động nhẹ" subtitle="Tập luyện nhẹ nhàng 1-2 ngày/tuần" selected={profile.activityLevel === 'light'} onClick={() => updateProfile({ activityLevel: 'light' })} />
      <ChoiceCard icon="🏃" title="Vận động vừa" subtitle="Tập luyện 3-5 ngày/tuần" selected={profile.activityLevel === 'moderate'} onClick={() => updateProfile({ activityLevel: 'moderate' })} />
      <ChoiceCard icon="🔥" title="Vận động nhiều" subtitle="Tập luyện nặng 6-7 ngày/tuần" selected={profile.activityLevel === 'high'} onClick={() => updateProfile({ activityLevel: 'high' })} />
    </div>
    <div className="bottom-cta" style={{ marginTop: 'auto' }}>
      <button className="primary-button" disabled={!profile.activityLevel} onClick={onNext} style={{ width: '100%', padding: '16px', borderRadius: '24px', background: !profile.activityLevel ? '#e2e8f0' : 'linear-gradient(135deg, #ff3f7d, #ff8a38)', color: !profile.activityLevel ? '#94a3b8' : 'white', border: 'none', fontSize: '18px', fontWeight: 700, boxShadow: !profile.activityLevel ? 'none' : '0 8px 20px rgba(255, 63, 125, 0.3)' }}>Tiếp tục</button>
    </div>
  </motion.div>
);`;

code = code.replace(/export const ActivityScreen = \(\{ profile, updateProfile, onNext \}: any\) => \([\s\S]*?\n\);\n/, newActivityScreen + '\n');
if (!code.includes("import { ChoiceCard }")) {
  code = code.replace("import React", "import { ChoiceCard } from './OnboardingScreens';\nimport React");
}
fs.writeFileSync('src/onboarding/screens/OnboardingScreens2.tsx', code);
