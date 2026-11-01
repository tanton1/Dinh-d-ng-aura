export const calls = { reports: 0, lists: [] as string[][], details: [] as string[], writes: [] as unknown[] }
Object.assign(window, { financeCalls: calls })
let resolved = false
const matched = Array.from({ length: 30 }, (_, n) => 'matched' + n)
export const useDatabase = () => ({ branches: [{ id: 'branch', name: 'Aura Thảo Điền' }] })
export async function listBusinessPerformance(input: Record<string, string>) {
  calls.reports++
  return { schemaVersion: 3, range: { startDate: input.startDate, endDate: input.endDate, timeZone: 'Asia/Ho_Chi_Minh' }, branchId: input.branchId || 'all', source: input.source,
    managementPnl: { recognisedRevenue: 367600863, operatingExpense: 40000000, operatingResult: 327600863 },
    cashFlow: { cashIn: 242600000, cashOut: 40000000, cashNet: 202600000 }, balanceMovement: { receivableMovement: 0, deferredRevenueMovement: 0 },
    sourceRows: [], dailySeries: [], dataQuality: { scannedLedgerEntries: 30, ledgerTruncated: false, attendanceTruncated: false,
      legacyUnclassifiedEntries: 0, unlinkedCashTransactions: 0, payrollPaidOutsideLedger: 0, cashAccounts: 2, missingSourceIntegrations: ['academy'], message: '',
      reconciliation: { schemaVersion: 1, evidenceCount: 35, matchedInPeriod: 30, pendingConfirmation: 0, automaticReview: 0, billingReview: 1, recognitionReview: resolved ? 0 : 1,
        exempt: 3, unresolved: 0, conflicts: 0, missingBranch: 0, posted: 30, zeroValueConfirmed: resolved ? 1 : 0, verifiedMissingPosting: null,
        caseIndex: { billingReview: ['quota'], recognitionReview: resolved ? [] : ['zero'], zeroValueConfirmed: resolved ? ['zero'] : [], posted: matched,
          exempt: ['duplicate', 'returned', 'free'], duplicate: ['duplicate'], returned: ['returned'], complimentary: ['free'] } } } }
}
function row(id: string) { return { attendanceId: id, sessionId: id, studentId: 'student', trainerId: 'trainer', studentName: id === 'zero' ? 'Học viên giá trị 0đ' : id === 'quota' ? 'Học viên hết buổi' : 'Học viên ' + id,
  trainerName: 'PT Minh', date: '2026-10-20', hour: 8, branchId: 'branch', contractId: 'contract', billingStatus: id === 'quota' ? 'review_required' : ['duplicate', 'returned', 'free'].includes(id) ? 'exempt' : 'charged',
  attendanceStatus: 'present', category: id === 'zero' ? resolved ? 'zeroValueConfirmed' : 'recognitionReview' : id === 'quota' ? 'billingReview' : ['duplicate', 'returned', 'free'].includes(id) ? 'exempt' : 'posted',
  exemptionKind: id, issueCode: id === 'zero' ? 'RECOGNITION_ZERO_VALUE_REQUIRES_REVIEW' : id === 'quota' ? 'CONTRACT_QUOTA_EXHAUSTED' : '', reason: '' } }
export async function listFinanceReconciliationCases(ids: string[]) { calls.lists.push(ids); return { rows: ids.map(row), missing: [] } }
export async function getFinanceReconciliationCase(id: string) {
  calls.details.push(id)
  const base = { sessionsDelta: 0, revenueDelta: 0, cashDelta: 0 }
  return { ...row(id), token: 'a'.repeat(64), contract: { id: 'contract', packageName: 'Gói 3 Tháng', totalSessions: 36, usedSessions: 35, totalPrice: 9600000, discount: 9600000, paidAmount: 0, startDate: '2026-10-01', endDate: '2026-12-31' },
    revenueContract: null, actions: [{ id: 'acknowledge', label: 'Lưu xác nhận đã kiểm tra', ...base }, ...(id === 'zero' && !resolved ? [{ id: 'confirm_zero', label: 'Xác nhận giá trị 0đ hợp lệ', ...base }] : [])],
    blockers: [], candidates: [], duplicateOfSessionId: id === 'duplicate' ? 'original' : '', billing: { status: 'charged', ordinal: 35 }, returned: null,
    ledger: new URLSearchParams(window.location.search).has('businessDate') ? [{ id: 'ledger-date', type: 'payment', status: 'posted', date: '2026-10-31T18:00:00Z', revenue: 0, cash: 100000, contractId: 'contract' }] : [], history: resolved ? [{ id: 'one', action: 'confirm_zero', reason: 'Đã đối chiếu chứng từ gốc', actorName: 'Quản trị viên', createdAt: '2026-10-31T04:00:00Z', effect: base, currentEvidence: false }] : [] }
}
export async function resolveFinanceReconciliationCase(input: { action: string }) { calls.writes.push(input); if (input.action === 'confirm_zero') resolved = true; return { unchanged: false } }
