const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');

const regex = /<div className="aura-loading-container">[\s\S]*?<div className="aura-loading-progress-bar">/g;
const replacement = `<div className="aura-loading-container" style={{ position: 'relative', overflow: 'hidden' }}>
        <img src="/aura-onboarding.png" alt="Aura Fitness" style={{ width: '100%', height: '100%', objectFit: 'cover', position: 'absolute', top: 0, left: 0, zIndex: 0 }} />
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, background: 'linear-gradient(to top, rgba(255,255,255,1) 0%, rgba(255,255,255,0.7) 30%, rgba(255,255,255,0) 100%)', zIndex: 1 }}></div>
        <div style={{ zIndex: 2, position: 'absolute', bottom: '80px', left: '50%', transform: 'translateX(-50%)' }}>
            <div className="aura-loading-progress-bar">`;

code = code.replace(regex, replacement);

fs.writeFileSync('src/App.tsx', code);
