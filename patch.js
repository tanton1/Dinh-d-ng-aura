import fs from 'fs';
let content = fs.readFileSync('src/pages/student/NutritionPage.tsx', 'utf8');
content = content.replace(
  /source: resultMode === 'live' \? 'ai-scan' : 'demo',\n\s+submitForReview\n\s+\}\)/g,
  `source: resultMode === 'live' ? 'ai-scan' : 'demo',\n      submitForReview,\n      quantityCookingAnalysis,\n      portionCalorieRationale,\n      goalAlignmentAssessment,\n      coachFeedbackSuggestion\n    })`
);
fs.writeFileSync('src/pages/student/NutritionPage.tsx', content);
