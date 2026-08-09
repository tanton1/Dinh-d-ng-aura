const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');

code = code.replace(
  "onboardingCompleted: true,\n                onboardingData: profile,\n                onboardingCompleted: true,",
  "onboardingCompleted: true,\n                onboardingData: profile,"
);

fs.writeFileSync('src/App.tsx', code);
