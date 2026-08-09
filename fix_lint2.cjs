const fs = require('fs');

let appCode = fs.readFileSync('src/App.tsx', 'utf8');
appCode = appCode.replace("const { firestore } = await import('./lib/firebase');", "const { firestoreDb } = await import('./lib/firebase');");
appCode = appCode.replace("doc(firestore, 'users', user.uid);", "doc(firestoreDb, 'users', user.uid);");
fs.writeFileSync('src/App.tsx', appCode);

let s3 = fs.readFileSync('src/onboarding/screens/OnboardingScreens3.tsx', 'utf8');
s3 = s3.replace("profile.healthConditions.filter(i =>", "profile.healthConditions.filter((i: string) =>");
fs.writeFileSync('src/onboarding/screens/OnboardingScreens3.tsx', s3);
