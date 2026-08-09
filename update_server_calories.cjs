const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf8');

code = code.replace(
  "if (profile.primaryGoal === 'fat_loss') targetCals -= 500;",
  "if (profile.primaryGoal === 'fat_loss') targetCals -= 500;\\n    targetCals = Math.max(1200, Math.round(bmr * 0.95), targetCals);"
);
code = code.replace(
  "const factor = activityFactors[profile.activityLevel] || 1.2;",
  "const factor = activityFactors[profile.activityLevel] || 1.3;"
);
code = code.replace("sedentary: 1.2,", "sedentary: 1.3,");

fs.writeFileSync('server.ts', code);
