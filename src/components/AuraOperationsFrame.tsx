import type { ReactNode } from 'react'

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
  return (
    <section className={`aura-operations-page ${className}`.trim()}>
      <span className="aura-operations-page__orb aura-operations-page__orb--pink" aria-hidden="true" />
      <span className="aura-operations-page__orb aura-operations-page__orb--orange" aria-hidden="true" />
      <div className="aura-operations-page__content">{children}</div>
    </section>
  )
}
