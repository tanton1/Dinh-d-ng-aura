import { AlertCircle, History, LoaderCircle } from 'lucide-react'
import type { TrainingHistoryContract, TrainingHistoryPage, TrainingHistoryRecord } from '../../services/businessReportingService'
import './StudentTrainingHistory.css'

export type StudentTrainingHistoryDemoSession = {
  id: string
  contractId?: string
  date: string
  hour: number | null
  trainerName: string
  status: string
}

export type StudentTrainingHistoryDemoSummary = {
  total: number
  attended: number
  chargedNoShow: number
  exempt: number
}

type Props = {
  page: TrainingHistoryPage | null
  loading: boolean
  error?: string
  isDemo?: boolean
  contracts?: TrainingHistoryContract[]
  demoSessions?: StudentTrainingHistoryDemoSession[]
  demoSummary?: StudentTrainingHistoryDemoSummary
  onRetry?: () => void
  onLoadMore?: () => void
  className?: string
}

const statusLabels: Record<string, string> = {
  scheduled: 'Đã xếp lịch',
  completed: 'Đã hoàn thành',
  cancelled: 'Đã hủy',
  canceled_by_student: 'Học viên báo nghỉ',
  student_cancelled: 'Học viên báo nghỉ',
  trainer_cancelled: 'PT báo nghỉ',
  no_show: 'Vắng mặt',
  rescheduled: 'Đã đổi lịch',
}

function formatSessionDate(value: string) {
  const parsed = new Date(`${value.slice(0, 10)}T00:00:00+07:00`)
  return Number.isNaN(parsed.getTime())
    ? value
    : new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' }).format(parsed)
}

function historyBillingStatus(record: TrainingHistoryRecord) {
  return String(record.billingStatus || record.attendance?.billingStatus || '').trim().toLowerCase()
}

function historyRecordLabel(record: TrainingHistoryRecord) {
  const billingStatus = historyBillingStatus(record)
  const attendanceStatus = String(record.attendance?.attendanceStatus || '').trim().toLowerCase()
  const exempt = record.isExempt || billingStatus === 'exempt'
  const noShow = attendanceStatus === 'no_show' || record.status === 'no_show'
  const attended = ['present', 'late'].includes(attendanceStatus) || ['completed', 'attended'].includes(record.status)
  if (exempt) {
    if (noShow) return 'Vắng mặt · miễn trừ'
    if (attended) return attendanceStatus === 'late' ? 'Đã tập · miễn trừ · đi trễ' : 'Đã tập · miễn trừ'
    return `${statusLabels[record.status] ?? record.status} · miễn trừ`
  }
  if (noShow) return record.countsTowardContract || billingStatus === 'charged' ? 'Vắng mặt · tính buổi' : 'Vắng mặt · chờ đối soát'
  if (attended) return attendanceStatus === 'late' ? 'Đã tập · đi trễ' : 'Đã tập'
  if (billingStatus === 'charged') return 'Tính buổi · chờ xác nhận'
  return statusLabels[record.status] ?? record.status
}

function historyRecordTone(record: TrainingHistoryRecord) {
  const billingStatus = historyBillingStatus(record)
  if (record.isExempt || billingStatus === 'exempt') return 'is-exempt'
  if (record.attendance?.attendanceStatus === 'no_show' || record.status === 'no_show') return record.countsTowardContract || billingStatus === 'charged' ? 'is-charged' : 'is-pending'
  if (['present', 'late'].includes(String(record.attendance?.attendanceStatus || '').toLowerCase()) || ['completed', 'attended'].includes(record.status)) return 'is-attended'
  return 'is-pending'
}

function demoTone(status: string) {
  if (['completed', 'attended'].includes(status)) return 'is-attended'
  if (status === 'no_show') return 'is-charged'
  if (status.includes('cancel')) return 'is-exempt'
  return 'is-pending'
}

type ContractKind = 'current' | 'previous' | 'upcoming' | 'unknown' | 'unlinked'
const contractLabels: Record<ContractKind, string> = {
  current: 'Hợp đồng hiện tại',
  previous: 'Hợp đồng cũ',
  upcoming: 'Hợp đồng sắp tới',
  unknown: 'Chưa rõ thời hạn',
  unlinked: 'Chưa gắn hợp đồng',
}
const contractOrder: Record<ContractKind, number> = { current: 0, upcoming: 1, previous: 2, unknown: 3, unlinked: 4 }

function contractKind(contract: TrainingHistoryContract | undefined, today: string): ContractKind {
  if (!contract) return 'unknown'
  const status = contract.status.toLowerCase()
  const start = contract.startDate?.slice(0, 10) || ''
  const end = contract.endDate?.slice(0, 10) || ''
  if (['expired', 'cancelled', 'inactive', 'archived'].includes(status) || (end && end < today)) return 'previous'
  if (status === 'future' || (start && start > today)) return 'upcoming'
  if (['active', 'frozen'].includes(status) && start && end && start <= today && today <= end) return 'current'
  return 'unknown'
}

function formatContractDate(value: string | null) {
  if (!value) return ''
  const parsed = new Date(`${value.slice(0, 10)}T00:00:00+07:00`)
  return Number.isNaN(parsed.getTime()) ? '' : new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit', year: 'numeric' }).format(parsed)
}

export default function StudentTrainingHistory({
  page,
  loading,
  error = '',
  isDemo = false,
  contracts = [],
  demoSessions = [],
  demoSummary = { total: 0, attended: 0, chargedNoShow: 0, exempt: 0 },
  onRetry,
  onLoadMore,
  className = '',
}: Props) {
  const total = isDemo ? demoSummary.total : page?.summary?.total ?? 0
  const usage = page?.summary?.usage
  const contractsById = new Map(contracts.map((contract) => [contract.id, contract]))
  for (const record of page?.records ?? []) {
    if (record.contract?.id === record.contractId) contractsById.set(record.contractId, record.contract)
  }
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
  const sessions = isDemo ? demoSessions.map((session) => ({
    ...session, contractId: session.contractId || '', label: statusLabels[session.status] ?? session.status, tone: demoTone(session.status),
  })) : (page?.records ?? []).map((record) => ({
    id: record.id, date: record.date, hour: record.hour, contractId: record.contractId || '',
    trainerName: record.counterpartName, label: historyRecordLabel(record), tone: historyRecordTone(record),
  }))
  const grouped = new Map<string, { contractId: string; contract?: TrainingHistoryContract; kind: ContractKind; sessions: typeof sessions }>()
  for (const session of sessions) {
    const group = grouped.get(session.contractId)
    if (group) group.sessions.push(session)
    else {
      const contract = contractsById.get(session.contractId)
      grouped.set(session.contractId, { contractId: session.contractId, contract, kind: session.contractId ? contractKind(contract, today) : 'unlinked', sessions: [session] })
    }
  }
  const groups = [...grouped.values()]
  for (const group of groups) group.sessions.sort((left, right) => right.date.localeCompare(left.date) || (right.hour ?? -1) - (left.hour ?? -1))
  groups.sort((left, right) => contractOrder[left.kind] - contractOrder[right.kind]
    || (right.contract?.startDate || right.sessions[0].date).localeCompare(left.contract?.startDate || left.sessions[0].date)
    || left.contractId.localeCompare(right.contractId))

  return <section className={`student-session-history${className ? ` ${className}` : ''}`} aria-busy={loading}>
    <header>
      <h2>Lịch sử buổi tập</h2>
      <span>Tổng {total} buổi</span>
    </header>
    {isDemo || usage ? <div className="student-history-summary" aria-label="Tổng hợp tất cả hợp đồng"><span><b>{isDemo ? demoSummary.attended : usage?.attendedSessions ?? 0}</b>Đã tập</span><span><b>{isDemo ? demoSummary.chargedNoShow : usage?.chargedNoShowSessions ?? 0}</b>Vắng tính buổi</span><span><b>{isDemo ? demoSummary.exempt : usage?.exemptSessions ?? 0}</b>Miễn trừ</span></div> : null}
    {error ? <div className="student-history-notice" role="alert"><AlertCircle size={17} /><span>{error}</span>{onRetry && <button type="button" onClick={onRetry}>Thử lại</button>}</div> : null}
    {loading && !page && !isDemo ? <div className="student-session-empty" role="status"><LoaderCircle size={28} className="is-spinning" /><strong>Đang tải lịch sử…</strong></div> : null}
    {!loading && !error && (isDemo || page) && !sessions.length ? <div className="student-session-empty"><History size={28} /><strong>{!isDemo && page?.hasMore ? 'Chưa có buổi tập trong phần đã tải' : 'Chưa có lịch sử tập luyện'}</strong></div> : null}
    {groups.length > 0 && <div className="student-history-contracts">{groups.map((group) => {
      const name = group.kind === 'unlinked' ? contractLabels.unlinked : group.contract?.packageName || `Hợp đồng ${group.contractId}`
      const dates = [formatContractDate(group.contract?.startDate ?? null), formatContractDate(group.contract?.endDate ?? null)].filter(Boolean).join(' – ')
      return <section className={`student-history-contract is-${group.kind}`} key={group.contractId} aria-label={group.kind === 'unlinked' ? name : `${contractLabels[group.kind]}: ${name}`}>
        <header className="student-history-contract__header">
          <div>{group.kind !== 'unlinked' && <span className="student-history-contract__badge">{contractLabels[group.kind]}</span>}<h3>{name}</h3>{dates && <p>{dates}</p>}</div>
          <span className="student-history-contract__count">{group.sessions.length} buổi{!isDemo && page?.hasMore ? ' đã tải' : ''}</span>
        </header>
        <div className="student-history-contract__sessions">{group.sessions.map((session) => <article className={session.tone} key={session.id}><span>{formatSessionDate(session.date)} · {session.hour === null ? '--:--' : `${String(session.hour).padStart(2, '0')}:00`}</span><strong>{session.trainerName}</strong><em>{session.label}</em></article>)}</div>
      </section>
    })}</div>}
    {!isDemo && page?.summary?.truncated ? <div className="student-history-notice"><AlertCircle size={17} /><span>Tổng số buổi chưa bao gồm toàn bộ lịch sử.</span></div> : null}
    {!isDemo && page?.hasMore && onLoadMore ? <button type="button" className="student-history-more" disabled={loading} onClick={onLoadMore}>{loading ? 'Đang tải…' : 'Tải thêm buổi tập'}</button> : null}
  </section>
}
