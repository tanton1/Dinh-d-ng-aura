const fs = require('fs');
let code = fs.readFileSync('src/components/OnboardingFlow.tsx', 'utf8');
code = code.replace("\\\\n", "\\n"); // Or replace literal \n
fs.writeFileSync('src/components/OnboardingFlow.tsx', code.replace(/\\n/g, '\n'));
