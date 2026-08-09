const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');

code = code.replace(
  "age: mergedProfileData.age ?? 30,",
  "age: mergedProfileData.age ?? 30,\n      biologicalSex: mergedProfileData.biologicalSex ?? 'female',"
);

fs.writeFileSync('src/App.tsx', code);
