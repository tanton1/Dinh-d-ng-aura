const fs = require('fs');

let code = fs.readFileSync('src/onboarding/screens/OnboardingScreens.tsx', 'utf8');

const welcomeOld = `<img src="https://aurafitness.vn/wp-content/uploads/2023/11/LogoAura_Update_final2.png" alt="Aura Fitness" style={{ width: 140, objectFit: 'contain', margin: '0 auto 24px' }} />
        <h1 style={{ fontSize: 32, fontWeight: 800, margin: '0 0 12px', lineHeight: 1.2 }}>
          <span style={{ color: '#ff3f7d' }}>
            Chào mừng bạn!
          </span>
        </h1>`;

const welcomeNew = `<h1 style={{ fontSize: 32, fontWeight: 800, margin: '0 0 12px', lineHeight: 1.2 }}>
          <span style={{ color: '#ff3f7d' }}>
            Chào mừng bạn đến<br/>Aura Fit!
          </span>
        </h1>`;

if (code.includes(welcomeOld)) {
  code = code.replace(welcomeOld, welcomeNew);
  fs.writeFileSync('src/onboarding/screens/OnboardingScreens.tsx', code);
}
