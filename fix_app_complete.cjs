const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');

code = code.replace(
  "onboardingData: profile,\\n                onboardingCompleted: true,",
  "onboardingData: profile,"
);

code = code.replace(
  "window.location.reload();",
  "window.location.hash = '#/nutrition';\n              window.location.reload();"
);

fs.writeFileSync('src/App.tsx', code);
