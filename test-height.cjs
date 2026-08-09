const fs = require('fs');
let code = fs.readFileSync('src/styles-onboarding.css', 'utf8');

// Ensure html, body use 100% height and overflow hidden to avoid scrolling bugs on mobile
if (!code.includes('html, body {')) {
  code = `html, body {
  margin: 0;
  padding: 0;
  height: 100%;
  width: 100%;
  overflow-x: hidden;
  overscroll-behavior-y: none;
}\n` + code;
}

// Modify onboarding-container
code = code.replace(/.onboarding-container\s*{[^}]*}/, `.onboarding-container {
  height: 100dvh;
  width: 100vw;
  background-color: var(--aura-bg);
  display: flex;
  flex-direction: column;
  color: var(--aura-text);
  font-family: 'Plus Jakarta Sans', sans-serif;
  overflow: hidden;
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
}`);

// Modify onboarding-content
code = code.replace(/.onboarding-content\s*{[^}]*}/, `.onboarding-content {
  flex: 1;
  max-width: 480px;
  width: 100%;
  margin: 0 auto;
  padding: 24px;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  position: relative;
  height: 100%;
}`);

fs.writeFileSync('src/styles-onboarding.css', code);
