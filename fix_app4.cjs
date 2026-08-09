const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');

const startStr = 'if (loading) {';
const endStr = 'return <RouterProvider router={router} />;}';

const startIndex = code.indexOf(startStr);
const endIndex = code.indexOf(endStr);

if (startIndex !== -1 && endIndex !== -1) {
  const newLoadingBlock = `if (loading) {
    return (
      <div className="aura-loading-container" style={{ position: 'relative', overflow: 'hidden', height: '100dvh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', backgroundColor: '#fff5f7' }}>
        <img src="/aura-onboarding.png" alt="Aura Fitness Background" style={{ width: '100%', height: '100%', objectFit: 'cover', position: 'absolute', top: 0, left: 0, zIndex: 0 }} onError={(e) => { e.currentTarget.style.display = 'none'; }} />
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, background: 'linear-gradient(to top, rgba(255,255,255,1) 0%, rgba(255,255,255,0.7) 30%, rgba(255,255,255,0) 100%)', zIndex: 1 }}></div>
        <div style={{ zIndex: 2, marginBottom: '80px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <div className="aura-loading-progress-container" style={{ width: '200px' }}>
            <div className="aura-loading-progress-bar">
              <div className="aura-loading-progress-fill"></div>
            </div>
          </div>
          <p className="aura-loading-text" style={{ marginTop: '16px', fontWeight: 600, color: '#334155' }}>Đang tải dữ liệu...</p>
        </div>
      </div>
    );
  }

  `;
  
  code = code.substring(0, startIndex) + newLoadingBlock + code.substring(endIndex);
  fs.writeFileSync('src/App.tsx', code);
}
