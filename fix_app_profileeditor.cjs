const fs = require('fs');
let code = fs.readFileSync('src/pages/student/NutritionPage.tsx', 'utf8');

code = code.replace(
  "if (activeSection === 'profile') return <NutritionProfileEditor",
  "if (activeSection === 'profile') return <NutritionOnboarding editing={true}\n    onComplete={(nextProfile) => { completeProfile(nextProfile); navigateNutrition('today') }}"
);

fs.writeFileSync('src/pages/student/NutritionPage.tsx', code);
