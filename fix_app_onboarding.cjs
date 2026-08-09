const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');

code = code.replace(
  "const [localNutritionProfile, setLocalNutritionProfile] = useState<NutritionProfileDraft | null>(null)",
  "const [localNutritionProfile, setLocalNutritionProfile] = useState<NutritionProfileDraft | null>(null)\n  const [forceOnboarding, setForceOnboarding] = useState(false)"
);

code = code.replace(
  "  const isOnboardingDone = Boolean(",
  "  const isOnboardingDone = !forceOnboarding && Boolean("
);

code = code.replace(
  "onSignOut={signOut} />",
  "onSignOut={signOut} onEditProfile={() => setForceOnboarding(true)} />"
);

code = code.replace(
  "onboardingData: profile,",
  "onboardingData: profile,\n                onboardingCompleted: true,"
);

code = code.replace(
  "setLocalProfile(profile)",
  "setLocalProfile(profile)\n          setForceOnboarding(false)"
);

code = code.replace(
  "setLocalNutritionProfile(plan)", // Wait let's see how onComplete is implemented
  "setLocalNutritionProfile(plan)"
);

fs.writeFileSync('src/App.tsx', code);
