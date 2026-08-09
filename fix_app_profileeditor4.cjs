const fs = require('fs');
let code = fs.readFileSync('src/pages/student/NutritionPage.tsx', 'utf8');

const before = `  if (activeSection === 'profile') return <NutritionOnboarding editing={true}
    onComplete={(nextProfile) => { completeProfile(nextProfile); navigateNutrition('today') }}

    initialProfile={profileDraft}
    onCancel={() => navigateNutrition('today')}
  />`;

const after = `  if (activeSection === 'profile') return <NutritionProfileEditor
    onSave={(nextProfile) => { completeProfile(nextProfile); navigateNutrition('today') }}
    initialProfile={profileDraft}
    onCancel={() => navigateNutrition('today')}
  />`;

code = code.replace(before, after);
fs.writeFileSync('src/pages/student/NutritionPage.tsx', code);
