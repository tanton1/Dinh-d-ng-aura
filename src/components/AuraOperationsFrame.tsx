import type { ReactNode } from 'react'
import { AlertTriangle, LoaderCircle } from 'lucide-react'
import { useDatabase } from '../contexts/DatabaseContext'
import '../styles-operations.css'

interface AuraOperationsFrameProps {
  children: ReactNode
  className?: string
}

/**
 * Shared, route-scoped canvas for the PT and food-library workspaces.
 * It deliberately scopes the compatibility layer used by the newly added
 * operations screens so legacy application styles cannot leak into them.
 */
export default function AuraOperationsFrame({ children, className = '' }: AuraOperationsFrameProps) {
  const { operationsSync } = useDatabase()

  return (
    <section className={`aura-operations-page ${className}`.trim()}>
      <span className="aura-operations-page__orb aura-operations-page__orb--pink" aria-hidden="true" />
      <span className="aura-operations-page__orb aura-operations-page__orb--orange" aria-hidden="true" />
      <div className="aura-operations-page__content">
        {operationsSync.status === 'loading' && (
          <div className="aura-operations-sync aura-operations-sync--loading" role="status">
            <LoaderCircle className="aura-operations-sync__spinner" size={18} aria-hidden="true" />
            <span>Đang đồng bộ dữ liệu nhân viên và lịch dạy…</span>
          </div>
        )}
        {operationsSync.status === 'error' && operationsSync.error && (
          <div className="aura-operations-sync aura-operations-sync--error" role="alert">
            <AlertTriangle size={18} aria-hidden="true" />
            <span>{operationsSync.error}</span>
          </div>
        )}
        {children}
      </div>
    </section>
  )
}
