const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');
code = code.replace("goal: profile.primaryGoal,", "goal: profile.primaryGoal === 'fat_loss' ? 'lose-fat' : profile.primaryGoal === 'muscle_gain' ? 'gain-muscle' : 'maintain',");
fs.writeFileSync('src/App.tsx', code);
