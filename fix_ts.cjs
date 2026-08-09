const fs = require('fs');
let code = fs.readFileSync('src/onboarding/screens/OnboardingScreens4.tsx', 'utf8');
code = code.replace(
  "const handleTimeChange = (index, value) => {",
  "const handleTimeChange = (index: number, value: string) => {"
);
fs.writeFileSync('src/onboarding/screens/OnboardingScreens4.tsx', code);
