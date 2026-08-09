const fs = require('fs');

let code = fs.readFileSync('index.html', 'utf8');

const oldLogo = `<h1 style="color: #ff3f7d; font-size: 36px; font-weight: 800; margin-bottom: 24px; letter-spacing: -1px;">AURA FIT</h1>`;

const newLogo = `<img src="https://aurafitness.vn/wp-content/uploads/2023/11/LogoAura_Update_final2.png" alt="Aura Fitness" style="width: 150px; margin-bottom: 24px;" />`;

code = code.replace(oldLogo, newLogo);

fs.writeFileSync('index.html', code);
