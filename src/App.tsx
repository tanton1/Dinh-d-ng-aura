import { Suspense } from 'react'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import { lazyWithRetry } from './components/ChunkErrorBoundary'

const AuthPage = lazyWithRetry(() => import('./pages/auth/AuthPage'))
const AuthenticatedAuraApplication = lazyWithRetry(() => import('./AuraApplication'))

function BootstrapLoading({ label = 'Đang mở không gian của bạn…' }: { label?: string }) {
  return (
    <main className="aura-bootstrap" role="status" aria-live="polite">
      <div className="aura-bootstrap__mark" aria-hidden="true">A<span /></div>
      <strong>Aura Fitness</strong>
      <p>{label}</p>
      <span className="aura-bootstrap__progress"><i /></span>
    </main>
  )
}

function ApplicationBoundary() {
  const { user, loading, backendMode } = useAuth()
  const authPreview = import.meta.env.MODE === 'e2e' && window.location.hash.startsWith('#/auth-preview')

  if (loading) return <BootstrapLoading label="Đang kiểm tra phiên đăng nhập…" />

  if (authPreview || (backendMode === 'firebase' && !user)) {
    return (
      <Suspense fallback={<BootstrapLoading label="Đang mở trang đăng nhập…" />}>
        <AuthPage />
      </Suspense>
    )
  }

  return (
    <Suspense fallback={<BootstrapLoading />}>
      <AuthenticatedAuraApplication />
    </Suspense>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <ApplicationBoundary />
    </AuthProvider>
  )
}
