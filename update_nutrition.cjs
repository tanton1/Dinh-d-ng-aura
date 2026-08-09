const fs = require('fs');
let code = fs.readFileSync('src/pages/student/NutritionPage.tsx', 'utf8');

code = code.replace(
  "const calorieGoal = Math.min(4500, Math.max(1200, Math.round((maintenanceCalories + dailyAdjustment) / 50) * 50))",
  "// Limit deficit to not go below BMR * 0.9 or 1200\\n  const floorCalories = Math.max(1200, Math.round(restingCalories * 0.95));\\n  const calorieGoal = Math.min(4500, Math.max(floorCalories, Math.round((maintenanceCalories + dailyAdjustment) / 50) * 50))"
);

code = code.replace(
  "low: 1.25,",
  "low: 1.3," // Boost base activity factor to prevent artificially low TDEE
);

fs.writeFileSync('src/pages/student/NutritionPage.tsx', code);
