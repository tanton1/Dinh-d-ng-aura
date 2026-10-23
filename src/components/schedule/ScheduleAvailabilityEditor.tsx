import { Save, Unlock } from 'lucide-react'
import type { PtScheduleWorkspaceV2Result } from '../../services/ptSchedulePublishService'
import AvailabilityMatrix from './AvailabilityMatrix'

interface Props {
  student: Pick<PtScheduleWorkspaceV2Result['students'][number], 'name' | 'availabilityLocked' | 'availabilityStatus'>
  weekId: string
  days: string[]
  hours: number[]
  selected: Set<string>
  onChange: (next: Set<string>) => void
  busy: boolean
  error: string
  isAdmin: boolean
  onClose: () => void
  onReopen: () => void
  onSave: () => void
}

// Editing availability is an explicit secondary action. Keep its matrix and
// controls out of the weekly workspace's initial download.
export default function ScheduleAvailabilityEditor({ student, weekId, days, hours, selected, onChange, busy, error, isAdmin, onClose, onReopen, onSave }: Props) {
  return <section className="branch-schedule__availability-editor">
    <header><div><small>LỊCH RẢNH TUẦN {weekId}</small><strong>{student.name}</strong></div><span>{selected.size} khung đã chọn</span></header>
    <AvailabilityMatrix days={days} hours={hours} selected={selected} onChange={onChange} disabled={busy} ariaLabel={`Lịch rảnh của ${student.name}`} />
    {error && <p role="alert">{error}</p>}
    <footer><button type="button" onClick={onClose}>Đóng</button>{isAdmin && (student.availabilityLocked || student.availabilityStatus === 'locked') && <button type="button" className="is-reopen" disabled={busy} onClick={onReopen}><Unlock size={16} />{busy ? 'Đang mở' : 'Mở cho học viên đến hết tuần'}</button>}<button type="button" className="is-save" disabled={busy} onClick={onSave}><Save size={16} />{busy ? 'Đang lưu' : 'Lưu lịch rảnh'}</button></footer>
  </section>
}
