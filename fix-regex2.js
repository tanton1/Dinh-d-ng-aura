import fs from 'fs';
let content = fs.readFileSync('server.ts', 'utf8');
content = content.replace(
  'const match = imageBase64.match(/^data:(image\\/[a-zA-Z+]+);base64,(.+)$/);',
  'const match = imageBase64.match(/^data:(image\\/[a-zA-Z0-9+-]+);base64,(.+)$/s);'
);
fs.writeFileSync('server.ts', content);
