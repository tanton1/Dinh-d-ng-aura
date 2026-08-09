const fs = require('fs');
let code = fs.readFileSync('src/pages/student/ProfilePage.tsx', 'utf8');
code = code.replace(
  "linear-gradient(135deg, #ff7a18, #af002d 31.4%, #319197 100%)",
  "linear-gradient(135deg, #ff8a38, #ff3f7d)"
);
fs.writeFileSync('src/pages/student/ProfilePage.tsx', code);
