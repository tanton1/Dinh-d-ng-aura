import { useMemo, useRef, useState } from 'react'
import { Check, ChevronLeft, ChevronRight } from 'lucide-react'
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
  const pages = useMemo(() => {
    const result: string[][] = []
    for (let index = 0; index < days.length; index += 2) result.push(days.slice(index, index + 2))
    return result
  }, [days])
  const [page, setPage] = useState(0)
  const touchStart = useRef<number | null>(null)
  const visibleDays = pages[Math.min(page, Math.max(0, pages.length - 1))] || days.slice(0, 2)
  const toggle = (slot: string) => {
    if (disabled) return
    const next = new Set(selected)
    if (next.has(slot)) next.delete(slot)
    else next.add(slot)
    onChange(next)
  }
  const move = (direction: -1 | 1) => setPage((current) => Math.max(0, Math.min(pages.length - 1, current + direction)))

  return <section className="availability-matrix" aria-label={ariaLabel}>
    <div className="availability-matrix__mobile-nav">
      <button type="button" disabled={page === 0} onClick={() => move(-1)} aria-label="Hai ngày trước"><ChevronLeft /></button>
      <strong>{visibleDays.map((day) => LABELS[day] || day).join(' · ')}</strong>
      <button type="button" disabled={page >= pages.length - 1} onClick={() => move(1)} aria-label="Hai ngày tiếp theo"><ChevronRight /></button>
    </div>
    <div
      className="availability-matrix__scroll"
      tabIndex={0}
      onTouchStart={(event) => { touchStart.current = event.touches[0]?.clientX ?? null }}
      onTouchEnd={(event) => {
        if (touchStart.current === null) return
        const distance = (event.changedTouches[0]?.clientX ?? touchStart.current) - touchStart.current
        if (Math.abs(distance) > 45) move(distance < 0 ? 1 : -1)
        touchStart.current = null
      }}
    >
      <table><thead><tr><th>Giờ</th>{days.map((day) => <th key={day} className={visibleDays.includes(day) ? 'is-mobile-visible' : ''}>{LABELS[day] || day}</th>)}</tr></thead>
        <tbody>{hours.map((hour) => <tr key={hour}><th>{String(hour).padStart(2, '0')}:00</th>{days.map((day) => {
          const slot = `${day}-${hour}`
          const active = selected.has(slot)
          return <td key={slot} className={visibleDays.includes(day) ? 'is-mobile-visible' : ''}><button type="button" disabled={disabled} aria-pressed={active} aria-label={`${LABELS[day] || day} ${hour} giờ${active ? ', đã chọn' : ''}`} className={active ? 'is-selected' : ''} onClick={() => toggle(slot)}>{active && <Check />}</button></td>
        })}</tr>)}</tbody>
      </table>
    </div>
  </section>
}
