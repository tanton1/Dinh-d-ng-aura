const fs = require('fs');
let code = fs.readFileSync('src/onboarding/screens/OnboardingScreens4.tsx', 'utf8');
code = code.replace("import { Bell } from 'motion/react';", "");
code = code.replace("import { Loader2, CheckCircle2 } from 'lucide-react';", "import { Loader2, CheckCircle2, Bell } from 'lucide-react';");
fs.writeFileSync('src/onboarding/screens/OnboardingScreens4.tsx', code);
