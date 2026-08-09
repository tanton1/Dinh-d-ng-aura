const fs = require('fs');

const files = [
  'src/onboarding/screens/OnboardingScreens2.tsx',
  'src/onboarding/screens/OnboardingScreens3.tsx',
  'src/onboarding/screens/OnboardingScreens4.tsx'
];

for (const file of files) {
  let code = fs.readFileSync(file, 'utf8');
  
  // Make sure all 'Tiếp tục' buttons have the premium styling
  code = code.replace(/<button className="primary-button"([^>]*)>Tiếp tục<\/button>/g, '<button className="primary-button"$1 style={{ width: \'100%\', padding: \'16px\', borderRadius: \'24px\', background: \'linear-gradient(135deg, #ff3f7d, #ff8a38)\', color: \'white\', border: \'none\', fontSize: \'18px\', fontWeight: 700, boxShadow: \'0 8px 20px rgba(255, 63, 125, 0.3)\' }}>Tiếp tục</button>');
  
  // Clean up any double styles again just in case
  code = code.replace(/<button className="primary-button"([^>]*) style=\{\{[^}]+\}\}\s*style=\{\{([^}]+)\}\}/g, '<button className="primary-button"$1 style={{$2}}');
  
  fs.writeFileSync(file, code);
}
