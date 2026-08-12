import fs from 'fs';
let content = fs.readFileSync('src/services/nutritionService.ts', 'utf8');
content = content.replace(/meal_analysis_cache_/g, 'meal_analysis_v2_');
fs.writeFileSync('src/services/nutritionService.ts', content);
