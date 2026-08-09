const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');

code = code.replace(
  "                nutritionProfile: {",
  "                nutritionProfile: {\n                  ...profile,\n                  age: plan.age || 30,"
);

fs.writeFileSync('src/App.tsx', code);
