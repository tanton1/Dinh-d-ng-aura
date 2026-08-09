const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf8');

code = code.replace(
  "  import { calculateNutritionTargets } from './src/services/nutritionSyncService';\n\n  app.post('/api/onboarding/preview', (req, res) => {",
  "  app.post('/api/onboarding/preview', (req, res) => {"
);

fs.writeFileSync('server.ts', code);
