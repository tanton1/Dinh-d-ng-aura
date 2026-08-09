const fs = require('fs');
let css = fs.readFileSync('src/styles-onboarding.css', 'utf8');

css = css.replace(/\.onboarding-container \{[\s\S]*?\}/, `.onboarding-container {
  height: 100dvh;
  background-color: var(--aura-bg);
  display: flex;
  flex-direction: column;
  color: var(--aura-text);
  font-family: 'Plus Jakarta Sans', sans-serif;
  overflow: hidden;
  position: relative;
}`);

css = css.replace(/\.onboarding-content \{[\s\S]*?\}/, `.onboarding-content {
  flex: 1;
  max-width: 480px;
  width: 100%;
  margin: 0 auto;
  padding: 24px;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  position: relative;
}

.onboarding-content.no-padding {
  padding: 0;
  max-width: 100%;
  overflow: hidden;
}`);

fs.writeFileSync('src/styles-onboarding.css', css);
