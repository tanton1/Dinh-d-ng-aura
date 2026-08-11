import fs from 'fs';
let content = fs.readFileSync('src/pages/admin/CourseEditorPage.tsx', 'utf8');
if (!content.includes("import { firebaseAuth }")) {
  content = "import { firebaseAuth } from '@/lib/firebase';\n" + content;
  fs.writeFileSync('src/pages/admin/CourseEditorPage.tsx', content);
}
let content2 = fs.readFileSync('src/pages/student/CourseDetailPage.tsx', 'utf8');
if (!content2.includes("import { firebaseAuth }")) {
  content2 = "import { firebaseAuth } from '@/lib/firebase';\n" + content2;
  fs.writeFileSync('src/pages/student/CourseDetailPage.tsx', content2);
}
