const fs = require('fs');
let code = fs.readFileSync('src/onboarding/screens/OnboardingScreens3.tsx', 'utf8');

const newDietScreen = `export const DietScreen = ({ profile, updateProfile, onNext }: any) => {
  const diets = [
    { id: 'balanced', icon: '🍽️', label: 'Cân bằng', desc: 'Đa dạng thực phẩm' },
    { id: 'low_carb', icon: '🍚', label: 'Ít tinh bột', desc: 'Giảm thiểu carb' },
    { id: 'high_protein', icon: '💪', label: 'Giàu protein', desc: 'Phát triển cơ bắp' },
    { id: 'vegetarian', icon: '🥗', label: 'Ăn chay', desc: 'Không thịt/cá' },
    { id: 'keto', icon: '🥑', label: 'Keto', desc: 'Nhiều béo, rất ít carb' },
    { id: 'none', icon: '✨', label: 'Không theo chế độ', desc: 'Ăn uống linh hoạt' },
  ];
  return (
    <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="step-content" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ textAlign: 'center', marginBottom: '24px' }}>
        <h2 style={{ fontSize: '28px', fontWeight: 800, color: '#0f172a', marginBottom: '8px' }}>Chế độ ăn uống?</h2>
        <p style={{ color: '#64748b', fontSize: '15px', lineHeight: 1.5 }}>
          Giúp Aura lên thực đơn phù hợp với sở thích của bạn.
        </p>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', paddingBottom: '16px', display: 'flex', flexDirection: 'column' }}>
        {diets.map(d => (
          <ChoiceCard key={d.id} icon={d.icon} title={d.label} subtitle={d.desc} selected={profile.dietType === d.id} onClick={() => updateProfile({ dietType: d.id })} />
        ))}
      </div>
      <div className="bottom-cta" style={{ marginTop: 'auto', paddingTop: '16px' }}>
        <button className="primary-button" disabled={!profile.dietType} onClick={onNext} style={{ width: '100%', padding: '16px', borderRadius: '24px', background: !profile.dietType ? '#e2e8f0' : 'linear-gradient(135deg, #ff3f7d, #ff8a38)', color: !profile.dietType ? '#94a3b8' : 'white', border: 'none', fontSize: '18px', fontWeight: 700, boxShadow: !profile.dietType ? 'none' : '0 8px 20px rgba(255, 63, 125, 0.3)' }}>Tiếp tục</button>
      </div>
    </motion.div>
  );
};`;

code = code.replace(/export const DietScreen = \(\{ profile, updateProfile, onNext \}: any\) => \{[\s\S]*?\n\};\n/, newDietScreen + '\n');
fs.writeFileSync('src/onboarding/screens/OnboardingScreens3.tsx', code);
