import fs from 'fs';
let content = fs.readFileSync('src/firebaseSync.ts', 'utf8');
content = content.replace(
  /coachFeedbackSuggestion\?: string\n\s+coachFeedback\?: string\n\}/g,
  `coachFeedbackSuggestion?: string\n  coachFeedback?: string\n  quantityAndCookingAnalysis?: string\n  portionAndCalorieRationale?: string\n}`
);
fs.writeFileSync('src/firebaseSync.ts', content);
