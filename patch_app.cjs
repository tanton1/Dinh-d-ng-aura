const fs = require('fs');
const file = 'src/App.tsx';
let code = fs.readFileSync(file, 'utf8');

// Replace the import
code = code.replace(
  "import OnboardingFlow, { type OnboardingData } from './components/OnboardingFlow'",
  "import Onboarding from './onboarding/Onboarding'"
);

// Replace the Onboarding component usage
// The old component usage was:
// <OnboardingFlow onComplete={handleOnboardingComplete} defaultData={undefined} />

const newComponentUsage = `<Onboarding 
        initialProfile={{}}
        onComplete={async (profile, plan) => {
          if (backendMode === 'firebase' && user) {
            try {
              const { doc, setDoc } = await import('firebase/firestore');
              const { firebaseDb } = await import('./lib/firebase');
              const userRef = doc(firebaseDb, 'users', user.uid);
              await setDoc(userRef, { 
                onboardingCompleted: true,
                onboardingData: profile,
                nutritionProfile: {
                  goal: profile.primaryGoal,
                  targetCalories: plan.targetCaloriesKcal,
                  protein: plan.proteinG,
                  carbs: plan.carbsG,
                  fat: plan.fatG,
                  waterLiters: plan.waterLiters,
                  steps: plan.stepsPerDay
                }
              }, { merge: true });
              window.location.reload();
            } catch (e) {
              console.error(e);
            }
          }
        }} 
      />`;

code = code.replace(
  /<OnboardingFlow[\s\S]*?\/>/,
  newComponentUsage
);

fs.writeFileSync(file, code);
