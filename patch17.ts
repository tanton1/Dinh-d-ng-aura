import fs from 'fs';
const file = 'src/firebaseSync.ts';
let content = fs.readFileSync(file, 'utf8');

// Remove aiScore logic
content = content.replace(/aiScore: r\.aiScore \|\| mealObj\.aiScore \|\| 85,/g, "");

fs.writeFileSync(file, content);
