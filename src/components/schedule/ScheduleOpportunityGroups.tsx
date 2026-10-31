import { ChevronRight } from 'lucide-react'
import type { ScheduleOpportunity } from '../../features/schedule/opportunities'
import { scheduleSlotLabel } from '../../features/schedule/workspaceModel'

interface Props {
  scheduleOpportunities: ScheduleOpportunity[]
  opportunityHasAssignedTrainer: boolean
  opportunityStudentId: string
  weekDates: Record<string, { display: string; full: string }>
  openScheduleOpportunity: (opportunity: ScheduleOpportunity) => void
}

export default function ScheduleOpportunityGroups({ scheduleOpportunities, opportunityHasAssignedTrainer, opportunityStudentId, weekDates, openScheduleOpportunity }: Props) {
  return (
    <div className="schedule-opportunities__groups">
      {([1, 2, 3] as const).map((tier) => {
        const items = scheduleOpportunities.filter((item) => (opportunityHasAssignedTrainer ? item.isPrimaryTrainer ? 1 : item.isAssignedTrainer ? 2 : 3 : item.priorityTier) === tier).slice(0, 120)
        const label = opportunityHasAssignedTrainer
          ? tier === 1 ? 'Ưu tiên 1 · PT chính' : tier === 2 ? 'Ưu tiên 2 · PT phụ' : 'Ưu tiên 3 · PT hỗ trợ · có cảnh báo'
          : tier === 1 ? 'Ưu tiên 1 · Ghép vào ca 1/2' : tier === 2 ? 'Ưu tiên 2 · PT chính thức cùng chi nhánh dưới mốc cân tải' : 'Ưu tiên 3 · Các PT cùng chi nhánh còn lại'
        return <section key={tier} className="schedule-opportunities__group" data-priority={tier}><header><strong>{label}</strong><span>{items.length} cơ hội{items.length === 120 ? ' · đang hiển thị 120 đầu tiên' : ''}</span></header><div>{items.length ? items.map((item) => {
          const assignedLabel = opportunityStudentId
            ? item.isPrimaryTrainer ? 'Khớp PT chính' : item.secondaryMatchCount > 0 ? 'Khớp PT phụ' : opportunityHasAssignedTrainer ? 'PT hỗ trợ ngoài danh sách chính/phụ' : ''
            : item.assignedMatchCount > 0 ? `Khớp PT chính/phụ của ${item.assignedMatchCount} học viên` : ''
          return <button type="button" key={`${item.trainerId}|${item.slotId}`} onClick={() => openScheduleOpportunity(item)}><span><strong>{scheduleSlotLabel(item.slotId, weekDates)}</strong><small>{item.trainerName}{item.priorityTier === 2 ? ` · PT chính thức · dưới mốc ${item.dailyTarget}` : ' · cùng chi nhánh'}</small>{assignedLabel && <small className="schedule-opportunity-assignment">{assignedLabel}{item.isAssignedTrainer ? ' · xếp trước' : ''}</small>}</span><em>{item.occupancy}/{item.capacity} · {item.occupancy === 1 ? 'còn 1 ghế' : `${item.dailyLoad}/${item.dailyTarget} mốc tải`}</em><ChevronRight size={16} /></button>
        }) : <p className="schedule-opportunities__empty">Chưa có cơ hội ở tầng này cho bộ lọc hiện tại.</p>}</div></section>
      })}
    </div>
  )
}
