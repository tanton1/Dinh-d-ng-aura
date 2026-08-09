const fs = require('fs');
let code = fs.readFileSync('index.html', 'utf8');

code = code.replace('<link rel="icon" href="/aura-logo.png" />', '');
code = code.replace('<link rel="apple-touch-icon" href="/aura-logo.png" />', '<link rel="apple-touch-icon" href="https://aurafitness.vn/wp-content/uploads/2023/11/LogoAura_Update_final2.png" />');

fs.writeFileSync('index.html', code);
