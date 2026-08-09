const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');

code = code.replace(
  "steps: newTargets.stepsPerDay\n    };",
  "steps: newTargets.stepsPerDay\n    } as any;"
);

fs.writeFileSync('src/App.tsx', code);
