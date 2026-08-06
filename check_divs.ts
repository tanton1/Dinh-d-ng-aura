import fs from 'fs';
const file = 'src/pages/admin/AdminNutritionReviewsPage.tsx';
const content = fs.readFileSync(file, 'utf8');

const lines = content.split('\n');
const start = 281;
const end = 820;
const block = lines.slice(start - 1, end).join('\n');

let divCount = 0;
let lastOpen = -1;
for (let i = 0; i < lines.length; i++) {
  if (i >= start - 1 && i <= end - 1) {
    const l = lines[i];
    const opens = (l.match(/<div/g) || []).length;
    const closes = (l.match(/<\/div>/g) || []).length;
    divCount += opens - closes;
    if (divCount < 0) {
      console.log(`Negative div count at line ${i + 1}`);
      break;
    }
  }
}
console.log('Final div count for block:', divCount);
