const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');

const regex = /<div className="aura-loading-container">[\s\S]*?<div className="aura-loading-progress-bar">/g;

code = code.replace(/<div className="aura-loading-container">[\s\S]*?<\/div>\s*<\/div>\s*<\/div>\s*<div className="aura-loading-progress-container">/g, 
`<div className="aura-loading-container" style={{ position: 'relative', overflow: 'hidden' }}>
        <img src="/aura-onboarding.png" alt="Aura Fitness" style={{ width: '100%', height: '100%', objectFit: 'cover', position: 'absolute', top: 0, left: 0, zIndex: 0 }} onError={(e) => { e.currentTarget.style.display = 'none'; }} />
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, background: 'linear-gradient(to top, rgba(255,255,255,1) 0%, rgba(255,255,255,0.7) 30%, rgba(255,255,255,0) 100%)', zIndex: 1 }}></div>
        <div className="aura-loading-progress-container" style={{ zIndex: 2, position: 'absolute', bottom: '80px', left: '50%', transform: 'translateX(-50%)' }}>`
);

fs.writeFileSync('src/App.tsx', code);
