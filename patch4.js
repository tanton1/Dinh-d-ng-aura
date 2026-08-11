import fs from 'fs';
let content = fs.readFileSync('src/pages/admin/AdminNutritionReviewsPage.tsx', 'utf8');
content = content.replace(
  /const effectiveGoalAlignment = meal.goalAlignmentAssessment\n\s+\|\| parsedAiAnalysis\?\.goalAlignmentAssessment/g,
  `const effectiveGoalAlignment = meal.goalAlignmentAssessment || parsedAiAnalysis?.goalAlignmentAssessment;
    const effectiveQuantityAndCookingAnalysis = meal.quantityAndCookingAnalysis || parsedAiAnalysis?.quantityAndCookingAnalysis || 'Phân tích định lượng thực tế quan sát qua hình ảnh và cách chế biến giữ vi chất.';
    const effectivePortionAndCalorieRationale = meal.portionAndCalorieRationale || parsedAiAnalysis?.portionAndCalorieRationale || 'Cơ sở dự đoán calo & khối lượng dựa trên đĩa ăn tiêu chuẩn.';
    `
);
content = content.replace(
  /\{\/\* Goal Alignment Assessment \*\/\}/g,
  `
            <div className="bg-white/90 p-3.5 rounded-2xl text-xs text-slate-700 leading-relaxed shadow-xs mb-2">
              <strong className="font-bold text-xs text-slate-800 block mb-1">🔍 Phân tích Định lượng & Chế biến:</strong>
              <p className="margin-0 font-medium text-slate-700">{effectiveQuantityAndCookingAnalysis}</p>
            </div>
            <div className="bg-white/90 p-3.5 rounded-2xl text-xs text-slate-700 leading-relaxed shadow-xs mb-2">
              <strong className="font-bold text-xs text-slate-800 block mb-1">⚖️ Cơ sở Khối lượng & Calo:</strong>
              <p className="margin-0 font-medium text-slate-700">{effectivePortionAndCalorieRationale}</p>
            </div>
            {/* Goal Alignment Assessment */}`
);
fs.writeFileSync('src/pages/admin/AdminNutritionReviewsPage.tsx', content);
