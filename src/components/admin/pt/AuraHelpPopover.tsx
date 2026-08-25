import type { ReactNode } from 'react'
import { CircleHelp } from 'lucide-react'
import '../../../styles-aura-help-popover.css'

interface Props {
  title: string
  children: ReactNode
  label?: string
}

export default function AuraHelpPopover({ title, children, label = 'Xem giải thích' }: Props) {
  return <details className="aura-help-popover">
    <summary aria-label={label} title={label}>
      <CircleHelp size={18} />
    </summary>
    <div className="aura-help-popover__panel">
      <strong>{title}</strong>
      <div>{children}</div>
    </div>
  </details>
}
