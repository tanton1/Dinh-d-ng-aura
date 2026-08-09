const fs = require('fs');
let code = fs.readFileSync('index.html', 'utf8');

// Fix the \n literal
code = code.replace('<head>\\n    <link', '<head>\n    <link');

// Update the loader
const oldLoader = `<img src="https://aurafitness.vn/wp-content/uploads/2023/11/LogoAura_Update_final2.png" alt="Aura Fitness" style="width: 150px; margin-bottom: 24px;" />`;
const newLoader = `<img src="/aura-onboarding.png" alt="Aura Fitness" style="width: 100%; height: 100%; object-fit: cover; position: absolute; top: 0; left: 0; z-index: 0;" />
        <div style="position: absolute; top: 0; left: 0; right: 0; bottom: 0; background: linear-gradient(to top, rgba(255,255,255,1) 0%, rgba(255,255,255,0.7) 30%, rgba(255,255,255,0) 100%); z-index: 1;"></div>
        <div class="app-loader-spinner" style="z-index: 2; margin-top: auto; margin-bottom: 80px;"></div>`;

// update the app-loader css to handle the new layout
code = code.replace(/.app-loader \{[^}]*\}/, `.app-loader {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: flex-end;
          height: 100vh;
          height: 100dvh;
          background-color: #fff5f7;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          position: relative;
          overflow: hidden;
        }`);

code = code.replace(oldLoader, newLoader);

fs.writeFileSync('index.html', code);
