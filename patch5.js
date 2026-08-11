import fs from 'fs';
let content = fs.readFileSync('src/firebaseSync.ts', 'utf8');
content = content.replace(
  /coachFeedbackSuggestion: r.coachFeedbackSuggestion/g,
  `quantityAndCookingAnalysis: r.quantityAndCookingAnalysis || mealObj.quantityAndCookingAnalysis || (typeof r.aiAnalysis === 'object' ? r.aiAnalysis?.quantityAndCookingAnalysis : undefined) || (typeof mealObj.aiAnalysis === 'object' ? mealObj.aiAnalysis?.quantityAndCookingAnalysis : undefined),
    portionAndCalorieRationale: r.portionAndCalorieRationale || mealObj.portionAndCalorieRationale || (typeof r.aiAnalysis === 'object' ? r.aiAnalysis?.portionAndCalorieRationale : undefined) || (typeof mealObj.aiAnalysis === 'object' ? mealObj.aiAnalysis?.portionAndCalorieRationale : undefined),
    coachFeedbackSuggestion: r.coachFeedbackSuggestion`
);
fs.writeFileSync('src/firebaseSync.ts', content);
