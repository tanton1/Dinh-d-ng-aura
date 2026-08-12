import fs from 'fs';

let content = fs.readFileSync('src/App.tsx', 'utf8');

content = content.replace(
  /initialProfile=\{profile \|\| \{\}\}/,
  `initialProfile={
          (() => {
            const src = profile?.onboardingData || profile || {};
            return Object.fromEntries(Object.entries(src).filter(([_, v]) => v !== undefined));
          })()
        }`
);

const oldSetDoc = `await setDoc(userRef, { 
                  onboardingCompleted: true,
                  onboardingData: profile,
                  nutritionProfile,
                  heightCm: profile.heightCm,
                  weightKg: profile.weightKg,
                  goals: profile.goals || (profile.primaryGoal ? [profile.primaryGoal] : []),
                  biologicalSex: profile.biologicalSex,
                  birthYear: profile.birthYear,
                  activityLevel: profile.activityLevel,
                  sleepHours: profile.sleepHours,
                  sleepQuality: profile.sleepQuality,
                  stressLevel: profile.stressLevel,
                  dietType: profile.dietType,
                  healthConditions: profile.healthConditions
                }, { merge: true });`;

const newSetDoc = `const { withoutUndefined } = await import('./services/firebaseService');
                await setDoc(userRef, withoutUndefined({ 
                  onboardingCompleted: true,
                  onboardingData: profile,
                  nutritionProfile,
                  heightCm: profile.heightCm,
                  weightKg: profile.weightKg,
                  goals: profile.goals || (profile.primaryGoal ? [profile.primaryGoal] : []),
                  biologicalSex: profile.biologicalSex,
                  birthYear: profile.birthYear,
                  activityLevel: profile.activityLevel,
                  sleepHours: profile.sleepHours,
                  sleepQuality: profile.sleepQuality,
                  stressLevel: profile.stressLevel,
                  dietType: profile.dietType,
                  healthConditions: profile.healthConditions
                }), { merge: true });`;

content = content.replace(oldSetDoc, newSetDoc);

fs.writeFileSync('src/App.tsx', content);
