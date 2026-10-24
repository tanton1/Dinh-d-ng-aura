import { useState } from 'react'
import { MoreHorizontal, type LucideIcon } from 'lucide-react'
import { Sheet } from '../../components/ui'

export interface ClubDestination<T extends string> { id: T; label: string; icon: LucideIcon }

/** One navigation surface: inline on desktop, the only Club dock on mobile. */
export default function ClubNavigation<T extends string>({ label, active, primary, secondary, onSelect, disabled = false, mobileDock = false }: {
  label: string
  active: T
  primary: ClubDestination<T>[]
  secondary: ClubDestination<T>[]
  onSelect: (id: T) => void
  disabled?: boolean
  mobileDock?: boolean
}) {
  const [moreOpen, setMoreOpen] = useState(false)
  return <div className={`club-navigation${mobileDock ? ' club-navigation--mobile-dock' : ''}`}>
    <nav className="club-dock" aria-label={label}>
      {primary.map(({ id, label: itemLabel, icon: Icon }) => <button key={id} type="button" disabled={disabled} aria-current={active === id ? 'page' : undefined} onClick={() => onSelect(id)}><Icon aria-hidden="true" /><span>{itemLabel}</span></button>)}
      {secondary.length > 0 ? <button type="button" disabled={disabled} aria-expanded={moreOpen} aria-haspopup="dialog" className={secondary.some(item => item.id === active) ? 'is-active' : undefined} onClick={() => setMoreOpen(true)}><MoreHorizontal aria-hidden="true" /><span>Thêm</span></button> : null}
    </nav>
    <Sheet open={moreOpen} onClose={() => setMoreOpen(false)} title="Thêm trong Aura Club">
      <div className="club-more-links">
        {secondary.map(({ id, label: itemLabel, icon: Icon }) => <button key={id} type="button" disabled={disabled} aria-current={active === id ? 'page' : undefined} onClick={() => { setMoreOpen(false); onSelect(id) }}><Icon aria-hidden="true" /><span>{itemLabel}</span></button>)}
      </div>
    </Sheet>
  </div>
}
