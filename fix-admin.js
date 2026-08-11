import fs from 'fs';
let content = fs.readFileSync('src/pages/admin/AdminNutritionReviewsPage.tsx', 'utf8');

// I will replace the broken part
content = content.replace(
  /const effectiveGoalAlignment = meal\.goalAlignmentAssessment \|\| parsedAiAnalysis\?\.goalAlignmentAssessment;\n    const effectiveQuantityAndCookingAnalysis = .*?\n    const effectivePortionAndCalorieRationale = .*?\n    \n      \|\| \(currentProt/s,
  `const effectiveGoalAlignment = meal.goalAlignmentAssessment || parsedAiAnalysis?.goalAlignmentAssessment || (currentProt`
);
fs.writeFileSync('src/pages/admin/AdminNutritionReviewsPage.tsx', content);
