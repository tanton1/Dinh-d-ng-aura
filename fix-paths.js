import fs from 'fs';
let content = fs.readFileSync('src/pages/admin/CourseEditorPage.tsx', 'utf8');
content = content.replace("import { firebaseAuth } from '@/lib/firebase';", "import { firebaseAuth } from '../../lib/firebase';");
fs.writeFileSync('src/pages/admin/CourseEditorPage.tsx', content);

let content2 = fs.readFileSync('src/pages/student/CourseDetailPage.tsx', 'utf8');
content2 = content2.replace("import { firebaseAuth } from '@/lib/firebase';", "import { firebaseAuth } from '../../lib/firebase';");
fs.writeFileSync('src/pages/student/CourseDetailPage.tsx', content2);
