import fs from 'fs';
let content = fs.readFileSync('server.ts', 'utf8');

content = content.replace(
  /  \/\/ AI Meal Analysis endpoint using Gemini 3\.6 Flash Vision\n  aiRouter\.post\("\/analyze-meal", async \(req, res\) => \{\n    try \{\n      const parsed = analyzeMealSchema\.safeParse\(req\.body\);/,
  `  // AI Meal Analysis endpoint using Gemini 3.6 Flash Vision
  aiRouter.post("/analyze-meal", async (req, res) => {
    const rawApiKey = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY || '';
    const maskedKey = rawApiKey.length > 8 ? \`\${rawApiKey.substring(0, 4)}...\${rawApiKey.substring(rawApiKey.length - 4)}\` : (rawApiKey ? 'TOO_SHORT' : 'MISSING');
    console.log(\`[Diagnostic] /api/ai/analyze-meal called. GEMINI_API_KEY present: \${!!rawApiKey}, Masked Key: \${maskedKey}\`);

    try {
      const parsed = analyzeMealSchema.safeParse(req.body);`
);

content = content.replace(
  /    \} catch \(e: any\) \{\n      console\.error\('Failed in \/api\/ai\/analyze-meal:', e\);\n      res\.status\(500\)\.json\(\{/,
  `    } catch (e: any) {
      console.error('[Diagnostic] /api/ai/analyze-meal failed. Error:', e);
      if (e.status) console.error(\`[Diagnostic] API response status code: \${e.status}\`);
      if (e.response && e.response.status) console.error(\`[Diagnostic] API response status code: \${e.response.status}\`);
      console.error('Failed in /api/ai/analyze-meal:', e);
      res.status(500).json({`
);

fs.writeFileSync('server.ts', content);
