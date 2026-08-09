const fs = require('fs');
let code = fs.readFileSync('index.html', 'utf8');

const loadingHtml = `
    <div id="root">
      <style>
        .app-loader {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          height: 100vh;
          background-color: #fff;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          background-image: url('/aura-onboarding.png');
          background-size: cover;
          background-position: center;
          position: relative;
        }
        .app-loader::after {
          content: "";
          position: absolute;
          inset: 0;
          background: rgba(255,255,255,0.7);
          backdrop-filter: blur(5px);
        }
        .app-loader-content {
          position: relative;
          z-index: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 20px;
        }
        .app-loader img {
          width: 200px;
          animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
        }
        .app-loader-spinner {
          width: 40px;
          height: 40px;
          border: 4px solid #ffe4e6;
          border-top-color: #f43f5e;
          border-radius: 50%;
          animation: spin 1s linear infinite;
        }
        @keyframes pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: .8; transform: scale(0.95); }
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      </style>
      <div class="app-loader">
        <div class="app-loader-content">
          <img src="/aura-logo.png" alt="Aura Logo" onerror="this.style.display='none'"/>
          <div class="app-loader-spinner"></div>
        </div>
      </div>
    </div>`;

code = code.replace('<div id="root"></div>', loadingHtml);
code = code.replace('href="/icons/aura-icon.svg"', 'href="/aura-logo.png"');
code = code.replace('href="/icons/aura-icon-192.png"', 'href="/aura-logo.png"');

fs.writeFileSync('index.html', code);
