import { Component, type ErrorInfo, type ReactNode } from 'react'
import { reportClientIssue } from './services/clientTelemetryService'

type ErrorBoundaryState = {
  hasError: boolean
  error: Error | null
  incidentId: string
}

function createIncidentId() {
  return `AURA-${Date.now().toString(36).toUpperCase()}`
}

export class GlobalErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false, error: null, incidentId: '' }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error, incidentId: createIncidentId() }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    if (import.meta.env.DEV) console.error('GlobalErrorBoundary caught an error', error, errorInfo)
    reportClientIssue('ui', error, {
      phase: 'global_error_boundary',
      incidentId: this.state.incidentId,
      retryable: true,
    })
  }

  render() {
    if (!this.state.hasError) return this.props.children

    return (
      <main style={{ padding: 24, background: '#fff7ed', color: '#7c2d12', fontFamily: 'sans-serif', minHeight: '100vh' }}>
        <h1 style={{ fontSize: 24, fontWeight: 700 }}>Aura đang gặp sự cố</h1>
        <p style={{ marginTop: 10 }}>Vui lòng tải lại trang. Nếu lỗi vẫn tiếp diễn, hãy gửi mã sự cố bên dưới cho đội hỗ trợ.</p>
        <p style={{ marginTop: 10 }}><strong>Mã sự cố:</strong> {this.state.incidentId}</p>
        {import.meta.env.DEV && this.state.error?.message && (
          <pre style={{ marginTop: 10, padding: 10, background: '#ffedd5', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
            {this.state.error.message}
          </pre>
        )}
        <button
          type="button"
          onClick={() => window.location.reload()}
          style={{ marginTop: 20, padding: '10px 20px', background: '#c2410c', color: 'white', border: 0, borderRadius: 6, cursor: 'pointer' }}
        >
          Tải lại trang
        </button>
      </main>
    )
  }
}
