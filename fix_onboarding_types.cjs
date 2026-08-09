const fs = require('fs');
let code = fs.readFileSync('src/onboarding/types.ts', 'utf8');

if (!code.includes('mealTimes?: string[];')) {
  code = code.replace(
    'bpStatus?: \'medicated\' | \'unmedicated\' | \'unknown\' | null;',
    'bpStatus?: \'medicated\' | \'unmedicated\' | \'unknown\' | null;\n  mealTimes?: string[];\n  notificationsEnabled?: boolean;'
  );
  code = code.replace(
    '| \'health-details\'',
    '| \'health-details\'\n  | \'notifications\''
  );
  fs.writeFileSync('src/onboarding/types.ts', code);
}
