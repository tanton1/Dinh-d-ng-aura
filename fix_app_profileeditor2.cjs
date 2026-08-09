const fs = require('fs');
let code = fs.readFileSync('src/pages/student/NutritionPage.tsx', 'utf8');

code = code.replace(
  "    onSave={(nextProfile) => { completeProfile(nextProfile); navigateNutrition('today') }}\\n",
  ""
);

fs.writeFileSync('src/pages/student/NutritionPage.tsx', code);
