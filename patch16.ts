import fs from 'fs';
const file = 'src/pages/admin/AdminNutritionReviewsPage.tsx';
let content = fs.readFileSync(file, 'utf8');

content = content.replace(/'admin_nutrition_reviews'/g, "'admin-nutrition-reviews'");
content = content.replace(/'admin_programs'/g, "'admin-programs'");
content = content.replace(/'admin_roles'/g, "'admin-roles'");

fs.writeFileSync(file, content);
