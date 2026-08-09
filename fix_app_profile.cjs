const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');

code = code.replace(
  "hasProfile={Boolean(profile?.nutritionProfile || localNutritionProfile)}",
  "hasProfile={!forceOnboarding && Boolean(profile?.nutritionProfile || localNutritionProfile)}"
);

fs.writeFileSync('src/App.tsx', code);
