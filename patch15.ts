import fs from 'fs';
const file = 'src/pages/admin/AdminNutritionReviewsPage.tsx';
let content = fs.readFileSync(file, 'utf8');

const lines = content.split('\n');
// Find "{/* Slide 1 & Slide 2 Tab Navigation Switcher */}"
const targetLine = lines.findIndex(l => l.includes('Slide 1 & Slide 2 Tab Navigation Switcher'));
if (targetLine !== -1) {
    // Insert a closing div before it
    lines.splice(targetLine, 0, '          </div>');
}
fs.writeFileSync(file, lines.join('\n'));
