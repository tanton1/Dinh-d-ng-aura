const fs = require('fs');
let code = fs.readFileSync('src/pages/student/NutritionPage.tsx', 'utf8');

code = code.replace("GOAL_LABELS[profileDraft.goal].toLocaleLowerCase('vi-VN')", "(GOAL_LABELS[profileDraft.goal] || '').toLocaleLowerCase('vi-VN')");
fs.writeFileSync('src/pages/student/NutritionPage.tsx', code);
