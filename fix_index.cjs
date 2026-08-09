const fs = require('fs');

let code = fs.readFileSync('index.html', 'utf8');

code = code.replace('<head>', '<head>\\n    <link rel="icon" type="image/png" href="https://aurafitness.vn/wp-content/uploads/2023/11/LogoAura_Update_final2.png" />');

fs.writeFileSync('index.html', code);
