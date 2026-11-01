import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import ContractAmendmentDialog from '../../src/features/student-360/ContractAmendmentDialog'
import type { ContractAmendmentCommand, ContractAmendmentTerms, Student360ContractRecord } from '../../src/features/student-360/types'
import './style.css'
const state = { previews: 0, commands: [] as ContractAmendmentCommand[] }
Object.assign(window, { amendmentTest: state })
const scenario = new URLSearchParams(location.search).get('scenario')
const contract: Student360ContractRecord = { id: 'contract', studentId: 'student', branchId: 'branch', packageId: 'six', packageName: 'Gói 6 tháng',
  totalSessions: 72, usedSessions: 24, totalPrice: 18000000, paidAmount: 12000000, discount: 0,
  startDate: '2026-09-01', endDate: '2027-03-01', trainerId: null, trainerIds: [], nutritionPTIds: [], frozenAt: null,
  status: 'active', nextPaymentDate: null, installments: [], extensions: [], pausePeriods: [], note: '', revision: 1, updatedAt: null, updatedByName: '' }
const packages = [{ id: 'six', name: 'Gói 6 tháng', totalSessions: 72, price: 18000000, durationMonths: 6, branchId: 'branch' },
  { id: 'three', name: 'Gói 3 tháng', totalSessions: 36, price: 10800000, durationMonths: 3, branchId: 'branch' }]
function App() {
  const [open, setOpen] = useState(false), [done, setDone] = useState(false)
  return <main><h1>Hồ sơ hợp đồng</h1><button onClick={() => setOpen(true)}>Điều chỉnh gói tập</button>{done && <p role="status">Đã điều chỉnh gói tập</p>}{open && <ContractAmendmentDialog contract={contract} packages={packages} onClose={() => setOpen(false)}
    onPreview={async (terms: ContractAmendmentTerms) => {
      state.previews++; const netValue = terms.totalPrice - terms.discount
      return { snapshotHash: `snapshot-${state.previews}`, revision: state.previews, used: 24, recognized: 6000000, cash: 12000000, remainingValue: netValue - 6000000,
        blockers: scenario === 'blocked' ? ['Có buổi đã trừ chưa khớp doanh thu.'] : [],
        before: { packageId: 'six', packageName: 'Gói 6 tháng', totalSessions: 72, remainingSessions: 48, netValue: 18000000, endDate: '2027-03-01' },
        after: { ...terms, packageName: 'Gói 3 tháng', netValue, remainingSessions: terms.totalSessions - 24, refundDue: Math.max(0, 12000000 - netValue), receivable: Math.max(0, netValue - 12000000) },
        affectedBookings: scenario === 'bookings' ? [{ id: 'future', date: '2026-12-15', hour: 8 }] : [], installments: [] }
    }} onConfirm={async command => {
      state.commands.push(structuredClone(command))
      if (state.commands.length === 1 && scenario === 'stale') throw Object.assign(new Error('Có buổi mới; hãy kiểm tra lại bảng trước/sau.'), { code: 'functions/aborted' })
      if (state.commands.length === 1 && scenario === 'retry') throw Object.assign(new Error('Mất kết nối'), { code: 'functions/unavailable' })
      setDone(true); setOpen(false)
    }} />}</main>
}
createRoot(document.getElementById('root')!).render(<App />)
