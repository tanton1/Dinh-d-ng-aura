const fs = require('fs');
let code = fs.readFileSync('src/onboarding/screens/OnboardingScreens.tsx', 'utf8');

code = code.replace(
  /position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,/,
  `width: '100%', height: '100%',`
);

fs.writeFileSync('src/onboarding/screens/OnboardingScreens.tsx', code);
