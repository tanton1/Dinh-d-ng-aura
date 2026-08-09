const fs = require('fs');
let code = fs.readFileSync('src/pages/student/NutritionDashboardHome.tsx', 'utf8');
code = code.replace(
  "  onDeleteActivity,",
  "  onDeleteActivity,\\n  onEditProfile,\\n  goalLabel,"
);
fs.writeFileSync('src/pages/student/NutritionDashboardHome.tsx', code);
