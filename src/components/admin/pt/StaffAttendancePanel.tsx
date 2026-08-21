import { useEffect, useMemo, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { useDatabase } from '../../../contexts/DatabaseContext'
import { listStaffAttendance } from '../../../services/operationsDashboardService'

export default function StaffAttendancePanel() {
  const now = new Date()
  const [periodId, setPeriodId] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`)
  const [rows, setRows] = useState<Array<{ trainerId: string; sessionCount: number; lastOccurredAt: string }>>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const { trainers } = useDatabase()
  useEffect(() => { let active = true; setLoading(true); setError(''); void listStaffAttendance(periodId).then((result) => { if (active) setRows(result.rows) }).catch(() => { if (active) setError('Không thể tải chấm công canonical. Dữ liệu legacy chưa được dùng thay thế.') }).finally(() => { if (active) setLoading(false) }); return () => { active = false } }, [periodId])
  const name = useMemo(() => new Map(trainers.map((item) => [item.id, item.name])), [trainers])
  return <section className="cashbook-panel"><div className="cashbook-summary"><div><span>CHẤM CÔNG PT · ATTENDANCE EVENTS</span><strong>{rows.reduce((sum, item) => sum + item.sessionCount, 0).toLocaleString('vi-VN')} buổi</strong><small>Không tính trực tiếp từ session phía trình duyệt</small></div><RefreshCw /></div><div className="cashbook-toolbar"><input type="month" value={periodId} onChange={(event) => setPeriodId(event.target.value)} /></div>{error && <div className="cashbook-error">{error}</div>}<div className="cashbook-list">{rows.map((item) => <article key={item.trainerId}><div><b>{name.get(item.trainerId) || 'PT đã xóa / chưa liên kết'}</b><span>{item.trainerId} · gần nhất {item.lastOccurredAt ? new Date(item.lastOccurredAt).toLocaleString('vi-VN') : '—'}</span></div><strong>{item.sessionCount} buổi</strong></article>)}{!loading && !rows.length && <p>Chưa có attendance event trong kỳ. Cần chạy migration các session completed hợp lệ.</p>}</div></section>
}
