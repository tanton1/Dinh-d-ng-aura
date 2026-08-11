import fs from 'fs';

let content = fs.readFileSync('server.ts', 'utf8');

const endpoints = [
  '"/generate-course-outline"',
  '"/generate-course-quiz"',
  '"/generate-course-memory"'
];

for (const ep of endpoints) {
  const searchStr = `aiRouter.post(${ep}, async (req, res) => {\n    try {`;
  
  const replaceStr = `aiRouter.post(${ep}, async (req, res) => {\n    try {\n      const ai = getGenAI();\n      if (!ai) return res.status(500).json({ error: "Thiếu Gemini API Key" });`;
      
  content = content.replace(searchStr, replaceStr);
}

fs.writeFileSync('server.ts', content);
