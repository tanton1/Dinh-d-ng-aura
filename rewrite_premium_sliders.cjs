const fs = require('fs');
let code = fs.readFileSync('src/onboarding/screens/OnboardingScreens.tsx', 'utf8');

code = code.replace(/<input \n\s*type="range" min="120" max="230" \n\s*value=\{currentHeight\}\n\s*onChange=\{\(e\) => updateProfile\(\{ heightCm: parseInt\(e\.target\.value\) \}\)\}\n\s*style=\{\{ flex: 1, height: '8px', borderRadius: '4px', background: '#f1f5f9', accentColor: '#ff3f7d', outline: 'none' \}\}\n\s*\/>/, 
  '<input type="range" min="120" max="230" value={currentHeight} onChange={(e) => updateProfile({ heightCm: parseInt(e.target.value) })} className="premium-slider-input" style={{ color: "#ff3f7d" } as any} />');

code = code.replace(/<input \n\s*type="range" min="30" max="150" step="0\.5"\n\s*value=\{currentWeight\}\n\s*onChange=\{\(e\) => updateProfile\(\{ weightKg: parseFloat\(e\.target\.value\) \}\)\}\n\s*style=\{\{ flex: 1, height: '8px', borderRadius: '4px', background: '#f1f5f9', accentColor: '#ff8a38', outline: 'none' \}\}\n\s*\/>/, 
  '<input type="range" min="30" max="150" step="0.5" value={currentWeight} onChange={(e) => updateProfile({ weightKg: parseFloat(e.target.value) })} className="premium-slider-input" style={{ color: "#ff8a38" } as any} />');

code = code.replace(/<input \n\s*type="range" min="30" max="150" step="0\.5"\n\s*value=\{target\}\n\s*onChange=\{\(e\) => updateProfile\(\{ targetWeightKg: parseFloat\(e\.target\.value\) \}\)\}\n\s*style=\{\{ flex: 1, height: '8px', borderRadius: '4px', background: '#f1f5f9', accentColor: '#3b82f6', outline: 'none' \}\}\n\s*\/>/, 
  '<input type="range" min="30" max="150" step="0.5" value={target} onChange={(e) => updateProfile({ targetWeightKg: parseFloat(e.target.value) })} className="premium-slider-input" style={{ color: "#3b82f6" } as any} />');

code = code.replace(/<input \n\s*type="range" min="1940" max=\{currentYear - 10\}\n\s*value=\{year\}\n\s*onChange=\{\(e\) => updateProfile\(\{ birthYear: parseInt\(e\.target\.value\) \}\)\}\n\s*style=\{\{ flex: 1, height: '8px', borderRadius: '4px', background: '#f1f5f9', accentColor: '#a855f7', outline: 'none' \}\}\n\s*\/>/, 
  '<input type="range" min="1940" max={currentYear - 10} value={year} onChange={(e) => updateProfile({ birthYear: parseInt(e.target.value) })} className="premium-slider-input" style={{ color: "#a855f7" } as any} />');

fs.writeFileSync('src/onboarding/screens/OnboardingScreens.tsx', code);
