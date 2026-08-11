import fs from 'fs';
let content = fs.readFileSync('src/pages/student/CourseDetailPage.tsx', 'utf8');
content = content.replace(/\\`Bearer \$\{token\}\\`/g, '`Bearer ${token}`');
fs.writeFileSync('src/pages/student/CourseDetailPage.tsx', content);

let content2 = fs.readFileSync('src/pages/admin/CourseEditorPage.tsx', 'utf8');
content2 = content2.replace(/\\`Bearer \$\{token\}\\`/g, '`Bearer ${token}`');
fs.writeFileSync('src/pages/admin/CourseEditorPage.tsx', content2);
