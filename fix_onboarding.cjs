const fs = require('fs');
let code = fs.readFileSync('src/onboarding/Onboarding.tsx', 'utf8');

if (!code.includes('NotificationsScreen')) {
  code = code.replace(
    "import { HealthDetailsScreen, AnalyzingScreen, ResultScreen } from './screens/OnboardingScreens4';",
    "import { HealthDetailsScreen, NotificationsScreen, AnalyzingScreen, ResultScreen } from './screens/OnboardingScreens4';"
  );
  
  code = code.replace(
    "case 'health-details': return <HealthDetailsScreen profile={profile} updateProfile={updateProfile} onNext={goNext} />;",
    "case 'health-details': return <HealthDetailsScreen profile={profile} updateProfile={updateProfile} onNext={goNext} />;\n      case 'notifications': return <NotificationsScreen profile={profile} updateProfile={updateProfile} onNext={goNext} />;"
  );

  fs.writeFileSync('src/onboarding/Onboarding.tsx', code);
}
