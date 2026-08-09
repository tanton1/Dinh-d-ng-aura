const fs = require('fs');

// Ensure loading component has the logo correctly
let appCode = fs.readFileSync('src/App.tsx', 'utf8');
const oldLoading = `<div style={{ fontSize: 48, fontWeight: 800, color: '#ff3f7d', marginBottom: 24, letterSpacing: '-1px' }}>
          Aura Fit
        </div>`;
const newLoading = `<img src="https://aurafitness.vn/wp-content/uploads/2023/11/LogoAura_Update_final2.png" alt="Aura Fitness" style={{ width: 180, objectFit: 'contain', marginBottom: 24 }} />`;
if (appCode.includes(oldLoading)) {
  appCode = appCode.replace(oldLoading, newLoading);
  fs.writeFileSync('src/App.tsx', appCode);
}
