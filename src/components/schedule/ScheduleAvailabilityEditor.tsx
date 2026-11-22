import { useEffect, useState } from 'react'
import { RefreshCw, Save, Unlock } from 'lucide-react'
import type { PtScheduleWorkspaceV2Result } from '../../services/ptSchedulePublishService'
import { availabilityOriginLabel } from '../../features/schedule/availabilityPresentation'
import AvailabilityMatrix from './AvailabilityMatrix'

interface Props {
  student: Pick<PtScheduleWorkspaceV2Result['students'][number], 'name' | 'availableSlots' | 'availabilityRevision' | 'availabilityLocked' | 'availabilityStatus' | 'availabilitySource' | 'availabilitySourceWeekId'>
  weekId: string
  days: string[]
  hours: number[]
  /** False from the week after next onwards: those weeks are shown but cannot be registered. */
  weekOpen: boolean
  busy: boolean
  error: string
  isAdmin: boolean
  onClose: () => void
  onReopen: () => void
  onSave: (slots: string[], expectedSlots: string[], expectedRevision: number) => void
}

const slotsKey = (slots: Iterable<string>) => [...new Set(slots)].sort().join('|')

// Editing availability is an explicit secondary action. Keep its matrix and
// controls out of the weekly workspace's initial download.
//
// The editor owns the draft together with the version it started from. It
// follows live data until the operator edits; after that a change underneath
// must be loaded explicitly and can never be saved over.
export default function ScheduleAvailabilityEditor({ student, weekId, days, hours, weekOpen, busy, error, isAdmin, onClose, onReopen, onSave }: Props) {
  const [basis, setBasis] = useState({ slots: student.availableSlots, revision: student.availabilityRevision })
  const [selected, setSelected] = useState(() => new Set(student.availableSlots))
  const liveKey = slotsKey(student.availableSlots)
  const selectedKey = slotsKey(selected)
  const changed = slotsKey(basis.slots) !== liveKey || basis.revision !== student.availabilityRevision
  const conflict = changed && selectedKey !== slotsKey(basis.slots) && selectedKey !== liveKey

  const loadLatest = () => {
    setBasis({ slots: student.availableSlots, revision: student.availabilityRevision })
    setSelected(new Set(student.availableSlots))
  }
  useEffect(() => {
    if (changed && !conflict) loadLatest()
  }, [changed, conflict, liveKey, student.availabilityRevision])

  const canReopen = weekOpen && isAdmin && (student.availabilityLocked || student.availabilityStatus === 'locked')
  return <section className="branch-schedule__availability-editor">
    <header><div><small>LỊCH RẢNH TUẦN {weekId}</small><strong>{student.name}</strong><small>Nguồn: {availabilityOriginLabel(student)}</small></div><span>{selected.size} khung đã chọn</span></header>
    {!weekOpen && <p role="status">Chưa mở đăng ký. Chỉ đăng ký lịch rảnh đến hết tuần sau; tuần chưa đăng ký dùng lịch rảnh gần nhất trước đó.</p>}
    <AvailabilityMatrix days={days} hours={hours} selected={selected} onChange={setSelected} disabled={busy || !weekOpen} ariaLabel={`Lịch rảnh của ${student.name}`} />
    {conflict && !busy && <p role="alert">Lịch rảnh tuần này vừa thay đổi. Hãy tải lịch mới rồi chỉnh lại.</p>}
    {error && <p role="alert">{error}</p>}
    <footer>
      <button type="button" onClick={onClose}>Đóng</button>
      {conflict && !busy && <button type="button" onClick={loadLatest}><RefreshCw size={16} /> Tải lịch mới</button>}
      {canReopen && <button type="button" className="is-reopen" disabled={busy} onClick={onReopen}><Unlock size={16} />{busy ? 'Đang mở' : 'Mở cho học viên đến hết tuần'}</button>}
      {weekOpen && <button type="button" className="is-save" disabled={busy || conflict} onClick={() => onSave([...selected], basis.slots, basis.revision)}><Save size={16} />{busy ? 'Đang lưu' : 'Lưu lịch rảnh'}</button>}
    </footer>
  </section>
}
