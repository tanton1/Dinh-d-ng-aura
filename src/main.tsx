import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { GlobalErrorBoundary } from './GlobalErrorBoundary'
import './styles.css'
import './styles-aura.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <GlobalErrorBoundary>
      <App />
    </GlobalErrorBoundary>
  </StrictMode>,
)

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .then((reg) => {
        console.log('FCM Service Worker registered:', reg.scope);
      })
      .catch((err) => {
        console.error('FCM Service Worker registration failed:', err);
      });
  });
}
