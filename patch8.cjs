const fs = require('fs');
let code = fs.readFileSync('src/pages/student/NutritionPage.tsx', 'utf8');

const target = `    catalogCandidates: analysis.catalogCandidates,
    notices: response.notices,
    model: response.model,
  }`;

const replacement = `    catalogCandidates: analysis.catalogCandidates,
    notices: response.notices,
    model: response.model,
    quantityAndCookingAnalysis: analysis.quantityAndCookingAnalysis,
    portionAndCalorieRationale: analysis.portionAndCalorieRationale,
    goalAlignmentAssessment: analysis.goalAlignmentAssessment,
    coachFeedbackSuggestion: analysis.coachFeedbackSuggestion,
  }`;

if (code.includes(target)) {
  code = code.replace(target, replacement);
  fs.writeFileSync('src/pages/student/NutritionPage.tsx', code);
  console.log("Patched successfully!");
} else {
  console.log("Target not found!");
}
