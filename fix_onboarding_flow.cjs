const fs = require('fs');
let code = fs.readFileSync('src/onboarding/flow.ts', 'utf8');

if (!code.includes("'notifications'")) {
  code = code.replace(
    "steps.push('analyzing', 'result');",
    "steps.push('notifications', 'analyzing', 'result');"
  );
  fs.writeFileSync('src/onboarding/flow.ts', code);
}
