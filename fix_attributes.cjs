const fs = require('fs');

const files = [
  'src/onboarding/screens/OnboardingScreens2.tsx',
  'src/onboarding/screens/OnboardingScreens3.tsx',
  'src/onboarding/screens/OnboardingScreens4.tsx'
];

for (const file of files) {
  let code = fs.readFileSync(file, 'utf8');
  // Handle multiple style attributes
  code = code.replace(/style=\{[^}]+\}\s*style=\{([^}]+)\}/g, 'style={$1}');
  // Specifically fix double classNames on step-content if any
  code = code.replace(/className="step-content" style=\{\{ display: 'flex', flexDirection: 'column', height: '100%' \}\} className="step-content" style=\{\{ display: 'flex', flexDirection: 'column', height: '100%' \}\}/g, 'className="step-content" style={{ display: \'flex\', flexDirection: \'column\', height: \'100%\' }}');
  
  // Custom manual fixes based on where the regex messed up
  code = code.replace(/className="step-content"\s+style=\{\{[^}]+\}\}\s+style=\{\{[^}]+\}\}/g, 'className="step-content" style={{ display: \'flex\', flexDirection: \'column\', height: \'100%\' }}');
  
  code = code.replace(/<button className="primary-button"([^>]*) style=\{\{[^}]+\}\}\s*style=\{\{([^}]+)\}\}/g, '<button className="primary-button"$1 style={{$2}}');
  
  // Specific case for step-content
  code = code.replace(/className="step-content"\s*style=\{\{.*?\}\}\s*style=\{\{.*?\}\}/g, 'className="step-content" style={{ display: \'flex\', flexDirection: \'column\', height: \'100%\' }}');
  code = code.replace(/className="step-content"\s*style=\{\{ display: 'flex', flexDirection: 'column', height: '100%' \}\}\s*style=\{\{ display: 'flex', flexDirection: 'column', height: '100%' \}\}/g, 'className="step-content" style={{ display: \'flex\', flexDirection: \'column\', height: \'100%\' }}');
  
  fs.writeFileSync(file, code);
}
