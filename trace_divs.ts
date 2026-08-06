import fs from 'fs';
const file = 'src/pages/admin/AdminNutritionReviewsPage.tsx';
const content = fs.readFileSync(file, 'utf8');

const lines = content.split('\n');
const start = 281;
const end = 820;

let divCount = 0;
for (let i = start - 1; i < end; i++) {
    const l = lines[i];
    const opens = (l.match(/<div/g) || []).length;
    const closes = (l.match(/<\/div>/g) || []).length;
    divCount += opens - closes;
    if (opens > 0 || closes > 0) {
       console.log(`Line ${i + 1}: +${opens} -${closes} = ${divCount} | ${l.trim()}`);
    }
    if (divCount < 0) {
       console.log(`Negative div count at line ${i + 1}`);
       break;
    }
}
