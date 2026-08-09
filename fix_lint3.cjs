const fs = require('fs');

let appCode = fs.readFileSync('src/App.tsx', 'utf8');
appCode = appCode.replace("doc(firestoreDb, 'users', user.uid);", "if (!firestoreDb) return;\n              const userRef = doc(firestoreDb, 'users', user.uid);");
fs.writeFileSync('src/App.tsx', appCode);

let s3 = fs.readFileSync('src/onboarding/screens/OnboardingScreens3.tsx', 'utf8');
s3 = s3.replace(/profile\.healthConditions\.filter\(i =>/g, "profile.healthConditions.filter((i: string) =>");
s3 = s3.replace(/profile\.healthConditions\?\.includes\(c\.id\)/g, "profile.healthConditions?.includes(c.id as never)");
fs.writeFileSync('src/onboarding/screens/OnboardingScreens3.tsx', s3);
