import type { StudentContract } from '../types/ptOperations'
import type { Student360ContractMutation } from '../features/student-360/types'

const editableFields = ['packageId', 'branchId', 'startDate', 'endDate', 'totalSessions', 'trainerId', 'trainerIds', 'nutritionPTIds', 'note'] as const
const financialFields = ['totalPrice', 'discount', 'installments'] as const

function contractFields(contract: StudentContract, previous?: StudentContract): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const key of editableFields) if (contract[key] !== undefined) result[key] = structuredClone(contract[key])
  // Sending unchanged financial fields would unnecessarily require finance
  // authority for a coach/assignment edit. Changes still use the server gate.
  for (const key of financialFields) {
    if (contract[key] !== undefined && (!previous || JSON.stringify(contract[key]) !== JSON.stringify(previous[key]))) result[key] = structuredClone(contract[key])
  }
  return result
}

export function legacyContractCreateCommand(contract: StudentContract): Student360ContractMutation {
  if (!contract.id || !contract.studentId) throw new Error('Thiếu mã hợp đồng hoặc học viên.')
  if (Number(contract.paidAmount || 0) !== 0) throw new Error('Hợp đồng mới phải bắt đầu với số đã thu bằng 0. Ghi tiền qua phiếu thu sau khi tạo.')
  if (!['active', 'future'].includes(contract.status)) throw new Error('Hợp đồng mới phải được tạo trước khi bảo lưu hoặc hủy qua hồ sơ học viên.')
  if (contract.installments?.some(item => item.status !== 'pending')) throw new Error('Kỳ thanh toán mới phải chờ thu. Không tạo lịch sử đã thu từ biểu mẫu hợp đồng.')
  return { action: 'create', contractId: contract.id, studentId: contract.studentId, contract: contractFields(contract) }
}

export function legacyContractEditCommand(contract: StudentContract, previous?: StudentContract): Student360ContractMutation {
  if (!previous || previous.id !== contract.id) throw new Error('Không tìm thấy hợp đồng trong danh sách hiện tại. Hãy tải lại hồ sơ.')
  if (previous.studentId !== contract.studentId) throw new Error('Không thể chuyển hợp đồng sang học viên khác.')
  if (contract.status !== previous.status) throw new Error('Đổi trạng thái, bảo lưu hoặc hủy hợp đồng trong hồ sơ Học viên 360 để lưu lý do và đối soát.')
  if (previous.status === 'cancelled') throw new Error('Hợp đồng đã hủy chỉ được xử lý qua quyết toán trong hồ sơ học viên.')
  if (Number(contract.paidAmount || 0) !== Number(previous.paidAmount || 0)) throw new Error('Tiền đã thu chỉ được cập nhật qua phiếu thu, hoàn tiền hoặc bút toán đảo.')
  const revision = previous.revision ?? 0
  if (!Number.isSafeInteger(revision) || revision < 0 || (contract.revision !== undefined && contract.revision !== revision)) throw new Error('Hợp đồng đã thay đổi. Hãy mở lại hồ sơ trước khi lưu.')
  return { action: 'edit', contractId: previous.id, studentId: previous.studentId, expectedRevision: revision, contract: contractFields(contract, previous) }
}
