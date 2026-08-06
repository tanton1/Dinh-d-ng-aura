import fs from 'fs';
const file = 'src/pages/admin/AdminNutritionReviewsPage.tsx';
const content = fs.readFileSync(file, 'utf8');

const lines = content.split('\n');
const start = 281;
const end = lines.findIndex(l => l.includes('// VIEW 3: DANH SÁCH CẦN DUYỆT')) - 1;

let divCount = 0;
for (let i = start - 1; i < end; i++) {
    const l = lines[i];
    const opens = (l.match(/<div/g) || []).length;
    const closes = (l.match(/<\/div>/g) || []).length;
    divCount += opens - closes;
}
console.log('Final div count:', divCount);
