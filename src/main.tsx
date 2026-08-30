import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { GlobalErrorBoundary } from './GlobalErrorBoundary'
import { initializeClientTelemetry } from './services/clientTelemetryService'
import { recoverFromStaleRelease } from './utils/appReleaseRecovery'
import './styles-bootstrap.css'

initializeClientTelemetry()

const APP_UPDATE_READY_KEY = 'aura:update-ready'
const APP_UPDATE_READY_EVENT = 'aura:update-ready'

// A fresh document already runs the newest shell. This marker is only used to
// carry a controller update across route changes in the current document.
try {
  window.sessionStorage.removeItem(APP_UPDATE_READY_KEY)
} catch {
  // Storage can be unavailable in private browsing.
}

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
        // The schedule workspace can contain a long-running edit. Do not tear
        // it down underneath the operator when a new deploy becomes ready.
        if (window.location.hash.startsWith('#/admin-pt-schedule')) {
          try {
            window.sessionStorage.setItem(APP_UPDATE_READY_KEY, '1')
          } catch {
            // The in-page event still protects the active workspace.
          }
          window.dispatchEvent(new CustomEvent(APP_UPDATE_READY_EVENT))
          return
        }
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
