import fs from 'fs';
let content = fs.readFileSync('src/pages/student/CourseDetailPage.tsx', 'utf8');
content = content.replace(
  /const res = await fetch\("\/api\/ai\/summarize-lesson", \{\n        method: "POST",\n        headers: \{ "Content-Type": "application\/json" \},/g,
  `const token = await firebaseAuth?.currentUser?.getIdToken();\n      const res = await fetch("/api/ai/summarize-lesson", {\n        method: "POST",\n        headers: {\n          "Content-Type": "application/json",\n          ...(token ? { Authorization: \\\`Bearer \${token}\\\` } : {})\n        },`
);
if (!content.includes('import { firebaseAuth }')) {
  content = content.replace(
    /import \{ .* \} from "lucide-react";/,
    "import { firebaseAuth } from '@/lib/firebase';\n$&"
  );
}
fs.writeFileSync('src/pages/student/CourseDetailPage.tsx', content);
