const fs = require('fs');

let code = fs.readFileSync('src/onboarding/screens/OnboardingScreens2.tsx', 'utf8');

code = code.replace(/<input \n\s*type="range" min="4" max="12" step="0.5"\n\s*value=\{currentHours\}\n\s*onChange=\{\(e\) => updateProfile\(\{ sleepHours: parseFloat\(e\.target\.value\) \}\)\}\n\s*className="slider-input" style=\{\{ width: '100%' \}\}\n\s*\/>/, 
  '<input type="range" min="4" max="12" step="0.5" value={currentHours} onChange={(e) => updateProfile({ sleepHours: parseFloat(e.target.value) })} className="premium-slider-input" style={{ color: "#ff8a38" } as any} />');

fs.writeFileSync('src/onboarding/screens/OnboardingScreens2.tsx', code);
