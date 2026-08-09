const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');

const regex = /<img src="https:\/\/aurafitness.vn\/wp-content\/uploads\/2023\/11\/LogoAura_Update_final2.png"[^>]*\/>/g;
const replacement = '<img src="/aura-onboarding.png" alt="Aura Fitness Background" style={{ width: \'100%\', height: \'100%\', objectFit: \'cover\', position: \'absolute\', inset: 0, zIndex: 0 }} />';
code = code.replace(regex, replacement);

fs.writeFileSync('src/App.tsx', code);
