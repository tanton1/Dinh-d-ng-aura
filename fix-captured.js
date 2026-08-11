import fs from 'fs';
let content = fs.readFileSync('src/pages/student/CapturedMealDetail.tsx', 'utf8');
content = content.replace(
  /<strong style=\{\{ color: '#0f172a' \}\}>🎯 Đánh giá phù hợp mục tiêu: <\/strong>/,
  `{(meal.aiAnalysis?.quantityAndCookingAnalysis) && (
                <p style={{ margin: 0, fontSize: '13px', color: '#1e293b', lineHeight: 1.6, fontWeight: 500, marginBottom: 8 }}>
                  <strong style={{ color: '#0f172a' }}>🔍 Phân tích định lượng & chế biến: </strong>
                  {meal.aiAnalysis.quantityAndCookingAnalysis}
                </p>
              )}
              {(meal.aiAnalysis?.portionAndCalorieRationale) && (
                <p style={{ margin: 0, fontSize: '13px', color: '#1e293b', lineHeight: 1.6, fontWeight: 500, marginBottom: 8 }}>
                  <strong style={{ color: '#0f172a' }}>⚖️ Cơ sở calo & khối lượng: </strong>
                  {meal.aiAnalysis.portionAndCalorieRationale}
                </p>
              )}
              <strong style={{ color: '#0f172a' }}>🎯 Đánh giá phù hợp mục tiêu: </strong>`
);
fs.writeFileSync('src/pages/student/CapturedMealDetail.tsx', content);
