import fs from 'fs';
let content = fs.readFileSync('src/pages/student/NutritionPage.tsx', 'utf8');

// Update MealLog interface
content = content.replace(
  /coachFeedback\?: string\n\s+studentGoal\?: string/g,
  `coachFeedback?: string\n  aiAnalysis?: any\n  studentGoal?: string`
);

// Update saveScannedMeal
content = content.replace(
  /reviewStatus: meal.submitForReview \? 'pending' : undefined,/g,
  `reviewStatus: meal.submitForReview ? 'pending' : undefined,\n      aiAnalysis: {\n        quantityAndCookingAnalysis: meal.quantityCookingAnalysis,\n        portionAndCalorieRationale: meal.portionCalorieRationale,\n        goalAlignmentAssessment: meal.goalAlignmentAssessment,\n        coachFeedbackSuggestion: meal.coachFeedbackSuggestion\n      },`
);

fs.writeFileSync('src/pages/student/NutritionPage.tsx', content);
