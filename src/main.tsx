import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { GlobalErrorBoundary } from './GlobalErrorBoundary'
import { initializeClientTelemetry } from './services/clientTelemetryService'
import { recoverFromStaleRelease } from './utils/appReleaseRecovery'
import './styles.css'
import './styles-aura.css'

initializeClientTelemetry()

window.addEventListener('vite:preloadError', (event) => {
  event.preventDefault()
  void recoverFromStaleRelease()
})

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
        if (reg.waiting && hadActiveController) reg.waiting.postMessage({ type: 'SKIP_WAITING' })
        reg.addEventListener('updatefound', () => {
          const installing = reg.installing
          if (!installing) return
          installing.addEventListener('statechange', () => {
            if (installing.state === 'installed' && navigator.serviceWorker.controller) {
              installing.postMessage({ type: 'SKIP_WAITING' })
            }
          })
        })
        void reg.update()
        const updateWhenVisible = () => {
          if (document.visibilityState === 'visible') void reg.update()
        }
        document.addEventListener('visibilitychange', updateWhenVisible)
        window.setInterval(updateWhenVisible, 5 * 60_000)
      })
      .catch((err) => {
        console.error('FCM Service Worker registration failed:', err)
      })
  })
}
