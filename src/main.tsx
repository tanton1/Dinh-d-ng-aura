import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { GlobalErrorBoundary } from './GlobalErrorBoundary'
import { initializeClientTelemetry } from './services/clientTelemetryService'
import './styles.css'
import './styles-aura.css'

initializeClientTelemetry()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <GlobalErrorBoundary>
      <App />
    </GlobalErrorBoundary>
  </StrictMode>,
)

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    const hadActiveController = Boolean(navigator.serviceWorker.controller)
    let refreshing = false

    if (hadActiveController) {
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (refreshing) return
        refreshing = true
        window.location.reload()
      })
    }

    navigator.serviceWorker.register('/sw.js')
      .then((reg) => {
        console.log('FCM Service Worker registered:', reg.scope)
        void reg.update()
      })
      .catch((err) => {
        console.error('FCM Service Worker registration failed:', err)
      })
  })
}
