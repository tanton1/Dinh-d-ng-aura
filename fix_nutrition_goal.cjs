const fs = require('fs');
let code = fs.readFileSync('src/pages/student/NutritionPage.tsx', 'utf8');

const regex = /const GOAL_LABELS: Record<NutritionGoal, string> = {([^}]*)}/m;
const match = code.match(regex);
if (match) {
  const replacement = `const GOAL_LABELS: Record<string, string> = {${match[1]}  'fat_loss': 'Giảm mỡ bền vững',
  'muscle_gain': 'Tăng cơ & phục hồi',
  'maintenance': 'Duy trì thể trạng',
  'health': 'Cải thiện sức khỏe'
}`;
  code = code.replace(regex, replacement);
  fs.writeFileSync('src/pages/student/NutritionPage.tsx', code);
}
