const fs = require('fs');

// 1. App.tsx
let appCode = fs.readFileSync('src/App.tsx', 'utf8');
appCode = appCode.replace("const { firebaseDb } = await import('./lib/firebase');", "const { firestore } = await import('./lib/firebase');");
appCode = appCode.replace("doc(firebaseDb, 'users', user.uid);", "doc(firestore, 'users', user.uid);");
fs.writeFileSync('src/App.tsx', appCode);

// 2. OnboardingScreens3.tsx
let s3 = fs.readFileSync('src/onboarding/screens/OnboardingScreens3.tsx', 'utf8');
s3 = "import { Check } from 'lucide-react';\n" + s3;
s3 = s3.replace("profile.healthConditions.filter(i =>", "profile.healthConditions.filter((i: string) =>");
fs.writeFileSync('src/onboarding/screens/OnboardingScreens3.tsx', s3);

// 3. OnboardingScreens4.tsx
let s4 = fs.readFileSync('src/onboarding/screens/OnboardingScreens4.tsx', 'utf8');
s4 = s4.replace("import { Loader2 } from 'lucide-react';", "import { Loader2, CheckCircle2 } from 'lucide-react';");
fs.writeFileSync('src/onboarding/screens/OnboardingScreens4.tsx', s4);
