const fs = require('fs');

// Fix OnboardingScreens2.tsx
let code2 = fs.readFileSync('src/onboarding/screens/OnboardingScreens2.tsx', 'utf8');
code2 = code2.replace(/import \{ ChoiceCard \} from '\.\/OnboardingScreens';/g, '');
code2 = "import { ChoiceCard } from './OnboardingScreens';\n" + code2;
fs.writeFileSync('src/onboarding/screens/OnboardingScreens2.tsx', code2);

// Fix OnboardingScreens.tsx imports
let code1 = fs.readFileSync('src/onboarding/screens/OnboardingScreens.tsx', 'utf8');
if (!code1.includes("import { ShieldCheck }")) {
  code1 = "import { ShieldCheck } from 'lucide-react';\n" + code1;
}
if (!code1.includes("import { Check }")) {
  code1 = code1.replace(/import \{.*?\} from 'lucide-react';/, (match) => {
    if (match.includes("Check")) return match;
    return match.replace("}", ", Check }");
  });
}
fs.writeFileSync('src/onboarding/screens/OnboardingScreens.tsx', code1);

