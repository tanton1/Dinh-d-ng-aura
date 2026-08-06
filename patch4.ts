import fs from 'fs';
const file = 'src/firebaseSync.ts';
let content = fs.readFileSync(file, 'utf8');
content = content.replace("approvedMeal: approvedMealData,", "approvedMeal: approvedMealData,\n    approvedAtTimestamp: Date.now(),");
content = content.replace("targetSodium?: number", "targetSodium?: number\n  approvedAtTimestamp?: number");
content = content.replace("targetSodium: r.targetSodium || mealObj.targetSodium || 1500,", "targetSodium: r.targetSodium || mealObj.targetSodium || 1500,\n    approvedAtTimestamp: r.approvedAtTimestamp,");
fs.writeFileSync(file, content);
