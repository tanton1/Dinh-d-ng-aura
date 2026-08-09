const fs = require('fs');

const files = [
  'src/onboarding/screens/OnboardingScreens2.tsx',
  'src/onboarding/screens/OnboardingScreens3.tsx',
  'src/onboarding/screens/OnboardingScreens4.tsx'
];

for (const file of files) {
  let code = fs.readFileSync(file, 'utf8');
  code = code.replace(/className="step-content"/g, 'className="step-content" style={{ display: \'flex\', flexDirection: \'column\', height: \'100%\' }}');
  code = code.replace(/<h2 className="step-title">([^<]+)<\/h2>/g, '<div style={{ textAlign: \'center\', marginBottom: \'32px\' }}><h2 style={{ fontSize: \'28px\', fontWeight: 800, color: \'#0f172a\', marginBottom: \'8px\' }}>$1</h2></div>');
  code = code.replace(/<button className="primary-button"([^>]*)>Tiếp tục<\/button>/g, '<button className="primary-button"$1 style={{ width: \'100%\', padding: \'16px\', borderRadius: \'24px\', background: \'linear-gradient(135deg, #ff3f7d, #ff8a38)\', color: \'white\', border: \'none\', fontSize: \'18px\', fontWeight: 700, boxShadow: \'0 8px 20px rgba(255, 63, 125, 0.3)\' }}>Tiếp tục</button>');
  
  fs.writeFileSync(file, code);
}
