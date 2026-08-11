import fs from 'fs';
let content = fs.readFileSync('src/pages/admin/CourseEditorPage.tsx', 'utf8');
content = content.replace(
  /const res = await fetch\("\/api\/ai\/generate-course-outline", \{\n        method: "POST",\n        headers: \{ "Content-Type": "application\/json" \},/g,
  `const token = await firebaseAuth?.currentUser?.getIdToken();\n      const res = await fetch("/api/ai/generate-course-outline", {\n        method: "POST",\n        headers: {\n          "Content-Type": "application/json",\n          ...(token ? { Authorization: \\\`Bearer \${token}\\\` } : {})\n        },`
);
content = content.replace(
  /const res = await fetch\("\/api\/ai\/generate-course-quiz", \{\n        method: "POST",\n        headers: \{ "Content-Type": "application\/json" \},/g,
  `const token = await firebaseAuth?.currentUser?.getIdToken();\n      const res = await fetch("/api/ai/generate-course-quiz", {\n        method: "POST",\n        headers: {\n          "Content-Type": "application/json",\n          ...(token ? { Authorization: \\\`Bearer \${token}\\\` } : {})\n        },`
);
content = content.replace(
  /const res = await fetch\("\/api\/ai\/generate-course-memory", \{\n        method: "POST",\n        headers: \{ "Content-Type": "application\/json" \},/g,
  `const token = await firebaseAuth?.currentUser?.getIdToken();\n      const res = await fetch("/api/ai/generate-course-memory", {\n        method: "POST",\n        headers: {\n          "Content-Type": "application/json",\n          ...(token ? { Authorization: \\\`Bearer \${token}\\\` } : {})\n        },`
);
fs.writeFileSync('src/pages/admin/CourseEditorPage.tsx', content);
