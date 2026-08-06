import fs from 'fs';
const file = 'src/pages/admin/AdminNutritionReviewsPage.tsx';
let content = fs.readFileSync(file, 'utf8');

content = content.replace(/<ChevronRight size=\{16\} className="text-pink-600" \/>\s*<\/div>/, '');

fs.writeFileSync(file, content);
