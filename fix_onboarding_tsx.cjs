const fs = require('fs');
let code = fs.readFileSync('src/onboarding/Onboarding.tsx', 'utf8');

code = code.replace(
  '<div className="onboarding-content">',
  '<div className={`onboarding-content ${currentStep === \'welcome\' ? \'no-padding\' : \'\'}`}>'
);

fs.writeFileSync('src/onboarding/Onboarding.tsx', code);
