import { Component, lazy, type ComponentType, type ReactNode } from 'react'
import { reportClientIssue } from '../services/clientTelemetryService'

export function lazyWithRetry<T extends ComponentType<any>>(
  factory: () => Promise<{ default: T }>,
) {
  return lazy(async () => {
    let pageHasBeenRefreshed = false
    try {
      pageHasBeenRefreshed = sessionStorage.getItem('aura_page_refreshed_for_chunk') === 'true'
    } catch {
      // Continue without session storage.
    }

    try {
      const component = await factory()
      try { sessionStorage.removeItem('aura_page_refreshed_for_chunk') } catch {}
      return component
    } catch {
      try {
        await new Promise((resolve) => setTimeout(resolve, 500))
        const retryComponent = await factory()
        try { sessionStorage.removeItem('aura_page_refreshed_for_chunk') } catch {}
        return retryComponent
      } catch (error) {
        reportClientIssue('ui', error, { phase: 'lazy_chunk_load', retryable: true })
        if (!pageHasBeenRefreshed) {
          try { sessionStorage.setItem('aura_page_refreshed_for_chunk', 'true') } catch {}
          window.location.reload()
          return new Promise<{ default: T }>(() => {})
        }
        try { sessionStorage.removeItem('aura_page_refreshed_for_chunk') } catch {}
        throw error
      }
    }
  })
}

interface ChunkErrorBoundaryState {
  hasError: boolean
  error: Error | null
}

export default class ChunkErrorBoundary extends Component<{ children: ReactNode }, ChunkErrorBoundaryState> {
  state: ChunkErrorBoundaryState = { hasError: false, error: null }

  static getDerivedStateFromError(error: Error): ChunkErrorBoundaryState {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error) {
    reportClientIssue('ui', error, { phase: 'chunk_error_boundary', retryable: true })
  }

  render() {
    if (!this.state.hasError) return this.props.children
    return (
      <div className="course-detail-state" role="alert" style={{ padding: '40px 20px', textAlign: 'center' }}>
        <span className="brand-mark compact" aria-hidden="true">A<span /></span>
        <h1 style={{ fontSize: '20px', margin: '16px 0 8px' }}>Giao diện đang được cập nhật</h1>
        <p style={{ color: '#666', marginBottom: '20px' }}>Một số tập tin vừa được đổi mới. Vui lòng tải lại ứng dụng.</p>
        <button type="button" className="primary-button" onClick={() => window.location.reload()}>
          Tải lại ứng dụng
        </button>
      </div>
    )
  }
}
