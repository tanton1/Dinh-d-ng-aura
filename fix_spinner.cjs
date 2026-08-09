const fs = require('fs');
let code = fs.readFileSync('index.html', 'utf8');

code = code.replace(/<div class="app-loader-spinner"[^>]*><\/div>\s*<div class="app-loader-spinner"><\/div>/, '<div class="app-loader-spinner" style="z-index: 2; margin-top: auto; margin-bottom: 80px;"></div>');

fs.writeFileSync('index.html', code);
