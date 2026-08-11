import fs from 'fs';
let content = fs.readFileSync('src/pages/admin/CourseEditorPage.tsx', 'utf8');
if (!content.includes('import { firebaseAuth }')) {
  content = content.replace(
    /import \{ .* \} from "lucide-react";/,
    "import { firebaseAuth } from '@/lib/firebase';\n$&"
  );
  fs.writeFileSync('src/pages/admin/CourseEditorPage.tsx', content);
}
