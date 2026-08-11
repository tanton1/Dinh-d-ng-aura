import fs from 'fs';
let content = fs.readFileSync('src/pages/student/NutritionPage.tsx', 'utf8');
content = content.replace(
  /export interface NutritionMealDraft \{/,
  "export interface NutritionMealDraft {\n  quantityCookingAnalysis?: string\n  portionCalorieRationale?: string\n  goalAlignmentAssessment?: string\n  coachFeedbackSuggestion?: string\n  aiAnalysis?: any"
);
fs.writeFileSync('src/pages/student/NutritionPage.tsx', content);
