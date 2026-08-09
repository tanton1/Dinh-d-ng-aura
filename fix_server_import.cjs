const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf8');

code = code.replace(
  'import { z } from "zod";',
  'import { z } from "zod";\nimport { calculateNutritionTargets } from "./src/services/nutritionSyncService";'
);

fs.writeFileSync('server.ts', code);
