import { Check } from 'lucide-react'
import './AvailabilityMatrix.css'

const LABELS: Record<string, string> = { T2: 'Thứ 2', T3: 'Thứ 3', T4: 'Thứ 4', T5: 'Thứ 5', T6: 'Thứ 6', T7: 'Thứ 7', CN: 'CN' }

interface Props {
  days: string[]
  hours: number[]
  selected: Set<string>
  onChange: (next: Set<string>) => void
  disabled?: boolean
  ariaLabel?: string
}

export default function AvailabilityMatrix({ days, hours, selected, onChange, disabled = false, ariaLabel = 'Ma trận thời gian rảnh' }: Props) {
  const toggle = (slot: string) => {
    if (disabled) return
    const next = new Set(selected)
    if (next.has(slot)) next.delete(slot)
    else next.add(slot)
    onChange(next)
  }
  return <section className="availability-matrix" aria-label={ariaLabel}>
    <div className="availability-matrix__scroll" tabIndex={0}>
      <table><thead><tr><th>Giờ</th>{days.map((day) => <th key={day}><span className="availability-matrix__day-long">{LABELS[day] || day}</span><span className="availability-matrix__day-short">{day}</span></th>)}</tr></thead>
        <tbody>{hours.map((hour) => <tr key={hour}><th>{String(hour).padStart(2, '0')}:00</th>{days.map((day) => {
          const slot = `${day}-${hour}`
          const active = selected.has(slot)
          return <td key={slot}><button type="button" disabled={disabled} aria-pressed={active} aria-label={`${LABELS[day] || day} ${hour} giờ${active ? ', đã chọn' : ''}`} className={active ? 'is-selected' : ''} onClick={() => toggle(slot)}>{active && <Check />}</button></td>
        })}</tr>)}</tbody>
      </table>
    </div>
  </section>
}
