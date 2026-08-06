import fs from 'fs';
const file = 'src/pages/admin/AdminNutritionReviewsPage.tsx';
let content = fs.readFileSync(file, 'utf8');

content = content.replace(/AI \{meal\.aiScore.*?%\}/g, "");
content = content.replace(/const highAiMeals = allMeals\.filter\(\(m\) => m\.status === 'pending' && \(m\.aiScore \|\| 0\) >= 90\)/g, "const highAiMeals: any[] = []");

fs.writeFileSync(file, content);
