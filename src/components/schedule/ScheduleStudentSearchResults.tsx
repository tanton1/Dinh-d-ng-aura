import { useEffect, useState } from 'react'
import { getPtScheduleSlotCandidates, type PtScheduleBranchOption, type PtScheduleSlotCandidate } from '../../services/ptSchedulePublishService'
import { normalizeScheduleSearchText } from '../../features/schedule/workspaceModel'
import './ScheduleStudentSearchResults.css'

export default function ScheduleStudentSearchResults({ query, branchId, weekId, branches, onSelectBranch }: {
  query: string; branchId: string; weekId: string; branches: PtScheduleBranchOption[]; onSelectBranch: (id: string) => void
}) {
  const [rows, setRows] = useState<PtScheduleSlotCandidate[]>([])
  const [status, setStatus] = useState('')
  const search = normalizeScheduleSearchText(query)
  useEffect(() => {
    let active = true
    setRows([])
    if (search.length < 2) return
    setStatus('Đang tìm ở cơ sở khác…')
    const timer = window.setTimeout(() => {
      getPtScheduleSlotCandidates({ branchId, weekId, search, directoryOnly: true }).then(result => {
        if (!active) return
        setRows(result.candidates.filter(row => row.studentHomeBranchId && row.studentHomeBranchId !== branchId))
        setStatus('')
      }).catch(() => { if (active) setStatus('Chưa tìm được ở cơ sở khác. Hãy thử lại từ khóa.') })
    }, 350)
    return () => { active = false; window.clearTimeout(timer) }
  }, [search, branchId, weekId])
  return <section aria-label="Kết quả ở cơ sở khác" className="schedule-student-search-results">
    {status && <p role="status">{status}</p>}
    {rows.map(row => <div key={row.studentId}>
      <span><strong>{row.name}</strong><small>{branches.find(branch => branch.id === row.studentHomeBranchId)?.name || 'Cơ sở khác'}{row.phone ? ` · SĐT …${row.phone.slice(-4)}` : ''}</small></span>
      <button type="button" onClick={() => onSelectBranch(row.studentHomeBranchId!)}>Xem học viên</button>
    </div>)}
  </section>
}
