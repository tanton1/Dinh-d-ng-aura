import { Component, ReactNode, ErrorInfo } from 'react';

export class GlobalErrorBoundary extends Component<{children: ReactNode}, {hasError: boolean, error: Error | null}> {
  state: {hasError: boolean, error: Error | null} = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('GlobalErrorBoundary caught an error', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: '20px', background: '#fee2e2', color: '#991b1b', fontFamily: 'sans-serif', minHeight: '100vh' }}>
          <h1 style={{ fontSize: '24px', fontWeight: 'bold' }}>Lỗi Hệ Thống</h1>
          <p style={{ marginTop: '10px' }}>Đã xảy ra lỗi nghiêm trọng. Vui lòng báo cáo lỗi này:</p>
          <pre style={{ marginTop: '10px', padding: '10px', background: '#fef2f2', border: '1px solid #f87171', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
            {this.state.error?.message}
            <br />
            {this.state.error?.stack}
          </pre>
          <button onClick={() => window.location.reload()} style={{ marginTop: '20px', padding: '10px 20px', background: '#dc2626', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>
            Tải Lại Trang
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
