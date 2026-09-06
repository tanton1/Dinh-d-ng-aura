import { Component, lazy, type ComponentType, type ReactNode } from 'react'
import { reportClientIssue } from '../services/clientTelemetryService'
import {
  clearStaleReleaseRecoveryMarker,
  isStaleReleaseError,
  recoverFromStaleRelease,
} from '../utils/appReleaseRecovery'

export function lazyWithRetry<T extends ComponentType<any>>(
  factory: () => Promise<{ default: T }>,
) {
  return lazy(async () => {
    try {
      const component = await factory()
      // Vite's prevented preload error may resolve with undefined while the
      // shell is refreshing. Never pass it to React.lazy as a valid module.
      if (!component?.default) throw new Error('Failed to load module script: missing component export.')
      clearStaleReleaseRecoveryMarker()
      return component
    } catch {
      try {
        await new Promise((resolve) => setTimeout(resolve, 500))
        const retryComponent = await factory()
        if (!retryComponent?.default) throw new Error('Failed to load module script: missing component export.')
        clearStaleReleaseRecoveryMarker()
        return retryComponent
      } catch (error) {
        reportClientIssue('ui', error, { phase: 'lazy_chunk_load', retryable: true })
        if (isStaleReleaseError(error) && await recoverFromStaleRelease()) {
          return new Promise<{ default: T }>(() => {})
        }
        throw error
      }
    }
  })
}

interface ChunkErrorBoundaryState {
  hasError: boolean
  error: Error | null
  recovering: boolean
}

export default class ChunkErrorBoundary extends Component<{ children: ReactNode }, ChunkErrorBoundaryState> {
  state: ChunkErrorBoundaryState = { hasError: false, error: null, recovering: false }

  static getDerivedStateFromError(error: Error): ChunkErrorBoundaryState {
    return { hasError: true, error, recovering: false }
  }

  componentDidCatch(error: Error) {
    reportClientIssue('ui', error, { phase: 'chunk_error_boundary', retryable: true })
  }

  recover = async () => {
    this.setState({ recovering: true })
    if (isStaleReleaseError(this.state.error)) {
      await recoverFromStaleRelease({ force: true })
      return
    }
    window.location.reload()
  }

  render() {
    if (!this.state.hasError) return this.props.children
    const staleRelease = isStaleReleaseError(this.state.error)
    return (
      <div className="course-detail-state" role="alert" style={{ padding: '40px 20px', textAlign: 'center' }}>
        <span className="brand-mark compact" aria-hidden="true">A<span /></span>
        <h1 style={{ fontSize: '20px', margin: '16px 0 8px' }}>
          {staleRelease ? 'Aura đang hoàn tất cập nhật' : 'Trang chưa thể hiển thị'}
        </h1>
        <p style={{ color: '#666', marginBottom: '20px' }}>
          {staleRelease
            ? 'Ứng dụng sẽ tải lại bộ giao diện mới nhất và giữ nguyên phiên đăng nhập của bạn.'
            : 'Dữ liệu của bạn vẫn an toàn. Hãy tải lại trang để thử kết nối lần nữa.'}
        </p>
        <button type="button" className="primary-button" onClick={() => void this.recover()} disabled={this.state.recovering}>
          {this.state.recovering ? 'Đang làm mới…' : 'Tải lại trang'}
        </button>
      </div>
    )
  }
}
