const fs = require('fs');

let code = fs.readFileSync('src/App.tsx', 'utf8');

const oldLogo = `<div className="aura-loading-center">
           <div className="aura-loading-logo-group">
              <h1 className="aura-loading-h1">AURA</h1>
              <h2 className="aura-loading-h2">+FITNESS+</h2>
           </div>
        </div>`;

const newLogo = `<div className="aura-loading-center">
           <div className="aura-loading-logo-group">
              <img src="https://aurafitness.vn/wp-content/uploads/2023/11/LogoAura_Update_final2.png" alt="Aura Fitness" style={{ width: 120, objectFit: 'contain' }} />
           </div>
        </div>`;

code = code.replace(oldLogo, newLogo);

fs.writeFileSync('src/App.tsx', code);
