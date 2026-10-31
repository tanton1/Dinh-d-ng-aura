import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import '../../src/styles.css'
import StudentTrainingHistory from '../../src/components/training/StudentTrainingHistory'
import type { TrainingHistoryContract, TrainingHistoryPage, TrainingHistoryRecord } from '../../src/services/businessReportingService'
// Include both host styles so this fixture catches their mobile overrides.
import '../../src/pages/student/StudentSchedulePage.css'
import '../../src/features/student-360/Student360Page.css'

const current: TrainingHistoryContract = { id: 'current', packageName: 'PT Personal 24 buổi', status: 'active', startDate: '2026-09-01', endDate: '2027-03-01' }
const previous: TrainingHistoryContract = { id: 'previous', packageName: 'PT Personal 24 buổi', status: 'expired', startDate: '2026-06-01', endDate: '2026-12-01' }

function session(id: string, date: string, contractId: string, contract?: TrainingHistoryContract, status = 'completed'): TrainingHistoryRecord {
  return { id, date, contractId, contract, hour: 18, status, studentId: 'learner', trainerId: id, branchId: 'branch', counterpartId: id, counterpartName: `PT ${id}`, billingStatus: 'charged', countsTowardContract: true, isExempt: false, attendance: null, events: [], revision: 1 }
}

const firstPage: TrainingHistoryPage = {
  schemaVersion: 3, subjectType: 'student', subjectId: 'learner',
  records: [
    session('buổi cũ', '2026-10-30', previous.id, previous, 'no_show'),
    session('buổi mới', '2026-10-29', current.id),
    session('chưa liên kết', '2026-10-28', ''),
    session('thiếu thông tin', '2026-10-27', 'missing'),
  ],
  summary: { total: 5, completed: 4, noShow: 1, cancelled: 0, byStatus: {}, teaching: null, truncated: false,
    usage: { historySessions: 5, chargedSessions: 5, attendedSessions: 4, presentSessions: 4, lateSessions: 0, noShowSessions: 1, chargedNoShowSessions: 1, policyChargedSessions: 0, chargedPendingAttendanceSessions: 0, exemptSessions: 0, pendingSessions: 0, legacyChargedSessions: 0 },
  },
  hasMore: true, nextCursor: 'next', filters: { startDate: '', endDate: '', status: 'all', allTime: true },
}

function Fixture() {
  const [page, setPage] = useState(firstPage)
  const context = new URLSearchParams(window.location.search).get('context')
  return <main className={context === '360' ? 'student360-page student360-page--v4' : 'student-schedule-page student-schedule-page--classic'} style={{ maxWidth: 1000, margin: '24px auto', padding: 12 }}>
    <StudentTrainingHistory page={page} loading={false} contracts={[current]}
      className={context === '360' ? 'student360-timeline student360-training-history' : ''}
      onLoadMore={() => setPage({ ...page, hasMore: false, nextCursor: null, records: [...page.records, session('buổi cũ tiếp theo', '2026-06-24', previous.id, previous)] })} />
  </main>
}

createRoot(document.getElementById('root')!).render(<Fixture />)
