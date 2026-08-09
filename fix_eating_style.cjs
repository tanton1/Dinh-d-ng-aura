const fs = require('fs');
let code = fs.readFileSync('src/pages/student/NutritionPage.tsx', 'utf8');

code = code.replace("profileDraft.eatingStyle.toLocaleLowerCase('vi-VN')", "(profileDraft.eatingStyle || 'linh hoạt').toLocaleLowerCase('vi-VN')");
fs.writeFileSync('src/pages/student/NutritionPage.tsx', code);
