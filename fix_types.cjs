const fs = require('fs');
let code = fs.readFileSync('src/onboarding/types.ts', 'utf8');

if (!code.includes('targetWeightDeltaKg?: number;')) {
  code = code.replace('estimatedWeeks: number;', 'estimatedWeeks: number;\n  targetWeightDeltaKg?: number;\n  targetTimeframeMonths?: number;');
  fs.writeFileSync('src/onboarding/types.ts', code);
}
