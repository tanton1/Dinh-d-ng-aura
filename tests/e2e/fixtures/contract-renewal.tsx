import React from 'react'
import '../../../src/styles-bootstrap.css'
import { createRoot } from 'react-dom/client'
import RenewContractModal from '../../../src/components/admin/pt/RenewContractModal'
import Student360ContractWorkspace from '../../../src/features/student-360/Student360ContractWorkspace'
import '../../../src/components/admin/pt/ContractRenewals.css'
import type { PreparedContractRenewal } from '../../../src/services/contractRenewalService'
import type { Student360Overview } from '../../../src/features/student-360/types'

const fixture = (window as unknown as { renewalFixture?: PreparedContractRenewal }).renewalFixture
if (fixture) {
  const { row, options } = fixture
  const overview = {
    studentId: row.student.id, generatedAt: new Date().toISOString(), identity: row.student,
    assignments: { branchId: row.branchId, branchName: 'Aura', trainerIds: [], trainerNames: [], nutritionCoachIds: [] },
    permissions: { canViewRenewal: true },
    contract: { ...row.contract, storedUsedSessions: row.contract.usedSessions, chargedSessions: row.contract.usedSessions,
      exemptSessions: 0, pendingReconciliationSessions: 0, remainingSessions: row.risk.sessionsLeft, reconciliationStatus: 'matched',
      extensions: [], pausePeriods: [], payment: { total: row.contract.totalPrice, paid: row.contract.paidAmount } },
  } as unknown as Student360Overview
  createRoot(document.getElementById('root')!).render(new URLSearchParams(location.search).has('workspace')
    ? <Student360ContractWorkspace studentId={row.student.id} overview={overview} source="admin-pt-students" isDemo onNavigate={() => {}} onChanged={async () => {}} onNotice={() => {}} />
    : <RenewContractModal row={row} options={options} scope="system" onClose={() => {}} onSuccess={() => {}} />)
}
