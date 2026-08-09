const fs = require('fs');
let code = fs.readFileSync('src/pages/student/NutritionPage.tsx', 'utf8');
fs.writeFileSync('src/pages/student/NutritionPage.tsx', code.replace(/\\n/g, '\n'));

let serverCode = fs.readFileSync('server.ts', 'utf8');
fs.writeFileSync('server.ts', serverCode.replace(/\\n/g, '\n'));
