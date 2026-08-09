const fs = require('fs');

let p = fs.readFileSync('src/pages/student/ProfilePage.tsx', 'utf8');

p = p.replace(/\\n/g, '\n');

fs.writeFileSync('src/pages/student/ProfilePage.tsx', p);

