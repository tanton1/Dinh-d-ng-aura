import fs from 'fs';
let content = fs.readFileSync('src/pages/admin/AdminNutritionReviewsPage.tsx', 'utf8');

// I will replace the broken part
content = content.replace(
  /const effectiveGoalAlignment = meal\.goalAlignmentAssessment \|\| parsedAiAnalysis\?\.goalAlignmentAssessment \|\| \(currentProt/s,
  `const effectiveQuantityAndCookingAnalysis = meal.quantityAndCookingAnalysis || parsedAiAnalysis?.quantityAndCookingAnalysis || 'Phân tích định lượng thực tế quan sát qua hình ảnh và cách chế biến giữ vi chất.';
    const effectivePortionAndCalorieRationale = meal.portionAndCalorieRationale || parsedAiAnalysis?.portionAndCalorieRationale || 'Cơ sở dự đoán calo & khối lượng dựa trên đĩa ăn tiêu chuẩn.';
    const effectiveGoalAlignment = meal.goalAlignmentAssessment || parsedAiAnalysis?.goalAlignmentAssessment || (currentProt`
);
fs.writeFileSync('src/pages/admin/AdminNutritionReviewsPage.tsx', content);
