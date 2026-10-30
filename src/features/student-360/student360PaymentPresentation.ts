import type { Student360Overview } from './types'

export function student360PaymentPresentation(contract: Student360Overview['contract'], canViewAmounts: boolean) {
  const payment = contract?.payment
  const cancelled = contract?.status === 'cancelled' || contract?.storedStatus === 'cancelled'
  // Cached projections from before the settlement rollout still carry raw
  // paid/due/overdue labels. They are not a decision on a cancelled contract.
  const status = cancelled && !payment?.status.startsWith('settlement_') && payment?.status !== 'settled'
    ? 'settlement_review' : payment?.status
  const amount = (value?: number) => canViewAmounts && Number.isFinite(value) ? `${value!.toLocaleString('vi-VN')}đ` : ''
  if (status === 'settled') return { label: 'Quyết toán', value: 'Đã quyết toán', note: 'Đã xác nhận hoàn tất', tone: 'stable' as const }
  if (status === 'settlement_review') return { label: 'Quyết toán', value: payment?.settlementStatus === 'pending_approval' ? 'Chờ duyệt' : 'Cần rà soát', note: 'Mở hợp đồng để đối soát', tone: 'attention' as const }
  if (status === 'settlement_due') return { label: 'Quyết toán', value: 'Còn phải thu', note: amount(payment?.outstanding) || 'Theo quyết toán đã duyệt', tone: 'attention' as const }
  if (status === 'settlement_refund') return { label: 'Quyết toán', value: 'Cần hoàn khách', note: amount(payment?.refundDue) || 'Theo quyết toán đã duyệt', tone: 'attention' as const }
  if (status === 'settlement_ready') return { label: 'Quyết toán', value: 'Chờ hoàn tất', note: 'Đã cân đối tiền; chưa đóng hồ sơ', tone: 'attention' as const }
  return { label: 'Thanh toán', value: status === 'paid' ? 'Đã thanh toán' : status === 'overdue' ? 'Quá hạn' : status === 'due' ? 'Sắp đến hạn' : 'Chưa có lịch thu', note: null, tone: status === 'overdue' ? 'action_required' as const : status === 'due' ? 'attention' as const : 'stable' as const }
}
