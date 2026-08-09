const fs = require('fs');
let code = fs.readFileSync('src/components/OnboardingFlow.tsx', 'utf8');

code = code.replace(
  "if (targetCalories < 1200) targetCalories = 1200",
  "const floorCalories = Math.max(1200, Math.round(bmr * 0.95));\\n    if (targetCalories < floorCalories) targetCalories = floorCalories"
);

code = code.replace(
  "low: 1.2,",
  "low: 1.3,"
);

fs.writeFileSync('src/components/OnboardingFlow.tsx', code);
