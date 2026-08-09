const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');

code = code.replace(
  "...mergedProfileData,",
  "...mergedProfileData,\n      age: mergedProfileData.age ?? 30,"
);

fs.writeFileSync('src/App.tsx', code);
