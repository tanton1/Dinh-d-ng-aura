import fs from 'fs';
const file = 'src/pages/admin/AdminNutritionReviewsPage.tsx';
let content = fs.readFileSync(file, 'utf8');

// I will just use Babel to fix it, or just remove lines 504 and 506.
// Let's replace:
//           </div>
// 
//           </div>
//           {/* Slide 1 & Slide 2 Tab Navigation Switcher */}
// With just nothing (or remove the extra divs)

content = content.replace(/<\/div>\s*<\/div>\s*\{\/\* Slide 1 & Slide 2 Tab Navigation Switcher \*\/\}/g, '{/* Slide 1 & Slide 2 Tab Navigation Switcher */}');

fs.writeFileSync(file, content);
