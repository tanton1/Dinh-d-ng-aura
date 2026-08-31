'use strict'

const CHART_OF_ACCOUNTS = Object.freeze({
  '1111': { code: '1111', name: 'Tiền Việt Nam tại quỹ', group: 'asset' },
  '1121': { code: '1121', name: 'Tiền Việt Nam gửi ngân hàng', group: 'asset' },
  '1128': { code: '1128', name: 'Tiền tại ví điện tử', group: 'asset' },
  '131': { code: '131', name: 'Phải thu của khách hàng', group: 'asset' },
  '1331': { code: '1331', name: 'Thuế GTGT được khấu trừ', group: 'asset' },
  '141': { code: '141', name: 'Tạm ứng', group: 'asset' },
  '153': { code: '153', name: 'Công cụ, dụng cụ', group: 'asset' },
  '2111': { code: '2111', name: 'Tài sản cố định hữu hình', group: 'asset' },
  '242': { code: '242', name: 'Chi phí trả trước', group: 'asset' },
  '331': { code: '331', name: 'Phải trả cho người bán', group: 'liability' },
  '334': { code: '334', name: 'Phải trả người lao động', group: 'liability' },
  '3411': { code: '3411', name: 'Các khoản đi vay', group: 'liability' },
  '3387': { code: '3387', name: 'Doanh thu chờ phân bổ', group: 'liability' },
  '33311': { code: '33311', name: 'Thuế GTGT đầu ra', group: 'liability' },
  '4111': { code: '4111', name: 'Vốn góp của chủ sở hữu', group: 'equity' },
  '5113': { code: '5113', name: 'Doanh thu cung cấp dịch vụ', group: 'revenue' },
  '711': { code: '711', name: 'Thu nhập khác', group: 'revenue' },
  '6277': { code: '6277', name: 'Chi phí dịch vụ mua ngoài', group: 'expense' },
  '6417': { code: '6417', name: 'Chi phí dịch vụ mua ngoài bán hàng', group: 'expense' },
  '6421': { code: '6421', name: 'Chi phí nhân viên quản lý', group: 'expense' },
  '6427': { code: '6427', name: 'Chi phí dịch vụ mua ngoài quản lý', group: 'expense' },
  '6428': { code: '6428', name: 'Chi phí quản lý bằng tiền khác', group: 'expense' },
})

const EXPENSE_PURPOSES = Object.freeze({
  premises_rent: { label: 'Thuê mặt bằng', debitAccountCode: '6427', expenseImpact: true, vatAllowed: true },
  utilities: { label: 'Điện, nước, Internet', debitAccountCode: '6427', expenseImpact: true, vatAllowed: true },
  marketing: { label: 'Marketing và bán hàng', debitAccountCode: '6417', expenseImpact: true, vatAllowed: true },
  training_operations: { label: 'Vận hành phòng tập', debitAccountCode: '6277', expenseImpact: true, vatAllowed: true },
  administration: { label: 'Quản lý doanh nghiệp', debitAccountCode: '6427', expenseImpact: true, vatAllowed: true },
  other_operating_expense: { label: 'Chi phí vận hành khác', debitAccountCode: '6428', expenseImpact: true, vatAllowed: true },
  supplier_payment: { label: 'Thanh toán công nợ nhà cung cấp', debitAccountCode: '331', expenseImpact: false, vatAllowed: false },
  employee_advance: { label: 'Tạm ứng nhân viên', debitAccountCode: '141', expenseImpact: false, vatAllowed: false },
  tools_purchase: { label: 'Mua công cụ, dụng cụ', debitAccountCode: '153', expenseImpact: false, vatAllowed: true },
  fixed_asset_purchase: { label: 'Mua tài sản cố định', debitAccountCode: '2111', expenseImpact: false, vatAllowed: true },
  prepaid_expense: { label: 'Chi phí trả trước', debitAccountCode: '242', expenseImpact: false, vatAllowed: true },
  payroll_payment: { label: 'Thanh toán lương phải trả', debitAccountCode: '334', expenseImpact: false, vatAllowed: false },
})

const RECEIPT_PURPOSES = Object.freeze({
  owner_contribution: { label: 'Chủ hộ góp/nộp thêm vốn', creditAccountCode: '4111', revenueImpact: false },
  borrowing: { label: 'Nhận tiền vay', creditAccountCode: '3411', revenueImpact: false },
  advance_recovery: { label: 'Thu hồi tạm ứng', creditAccountCode: '141', revenueImpact: false },
  receivable_collection: { label: 'Thu hồi công nợ phải thu', creditAccountCode: '131', revenueImpact: false },
  supplier_refund: { label: 'Nhà cung cấp hoàn lại tiền', creditAccountCode: '331', revenueImpact: false },
  other_income: { label: 'Thu nhập khác thực tế phát sinh', creditAccountCode: '711', revenueImpact: true },
})

function integerMoney(value, label = 'Số tiền', allowZero = false) {
  const result = Number(value)
  if (!Number.isSafeInteger(result) || result < (allowZero ? 0 : 1) || result > 100_000_000_000) {
    throw new Error(`${label} không hợp lệ.`)
  }
  return result
}

function cashAccountCode(type) {
  if (type === 'cash') return '1111'
  if (type === 'bank') return '1121'
  if (type === 'wallet') return '1128'
  throw new Error('Loại tài khoản tiền không hợp lệ.')
}

function accountSnapshot(code) {
  const account = CHART_OF_ACCOUNTS[code]
  if (!account) throw new Error(`Tài khoản kế toán ${code} không được hỗ trợ.`)
  return account
}

function line(side, accountCode, amount, description = '') {
  const normalizedAmount = integerMoney(amount)
  const account = accountSnapshot(accountCode)
  return {
    side,
    accountCode,
    accountName: account.name,
    debit: side === 'debit' ? normalizedAmount : 0,
    credit: side === 'credit' ? normalizedAmount : 0,
    description,
  }
}

function assertBalancedJournal(lines) {
  if (!Array.isArray(lines) || lines.length < 2 || lines.length > 20) throw new Error('Bút toán phải có từ 2 đến 20 dòng.')
  const debit = lines.reduce((total, item) => total + integerMoney(item?.debit, 'Số tiền Nợ', true), 0)
  const credit = lines.reduce((total, item) => total + integerMoney(item?.credit, 'Số tiền Có', true), 0)
  if (!debit || debit !== credit) throw new Error('Bút toán không cân bằng Nợ/Có.')
  lines.forEach((item) => {
    const hasDebit = Number(item.debit || 0) > 0
    const hasCredit = Number(item.credit || 0) > 0
    if (hasDebit === hasCredit) throw new Error('Mỗi dòng bút toán chỉ được ghi Nợ hoặc Có.')
    accountSnapshot(item.accountCode)
  })
  return { totalDebit: debit, totalCredit: credit }
}

function expenseVoucherJournal({ purposeCode, amountBeforeTax, vatAmount = 0, cashAccountType, description = '' }) {
  const purpose = EXPENSE_PURPOSES[purposeCode]
  if (!purpose) throw new Error('Mục đích chi không hợp lệ.')
  const net = integerMoney(amountBeforeTax, 'Tiền trước thuế')
  const vat = integerMoney(vatAmount, 'Thuế GTGT', true)
  if (vat && !purpose.vatAllowed) throw new Error('Nghiệp vụ này không được ghi thêm thuế GTGT tại bước chi tiền.')
  const total = net + vat
  const lines = [line('debit', purpose.debitAccountCode, net, description || purpose.label)]
  if (vat) lines.push(line('debit', '1331', vat, 'Thuế GTGT đầu vào đủ điều kiện khấu trừ'))
  lines.push(line('credit', cashAccountCode(cashAccountType), total, 'Chi tiền theo phiếu chi'))
  const balance = assertBalancedJournal(lines)
  return {
    purposeCode,
    purposeLabel: purpose.label,
    expenseImpact: purpose.expenseImpact ? net : 0,
    amountBeforeTax: net,
    vatAmount: vat,
    totalAmount: total,
    lines,
    ...balance,
  }
}

function contractPaymentJournal({ amount, cashAccountType, recognisedReceivable = 0, advanceAccountCode = '131' }) {
  const total = integerMoney(amount)
  const receivable = Math.min(total, integerMoney(recognisedReceivable, 'Công nợ đã ghi nhận', true))
  if (!['131', '3387'].includes(advanceAccountCode)) throw new Error('Tài khoản tiền nhận trước không hợp lệ.')
  const lines = [line('debit', cashAccountCode(cashAccountType), total, 'Thu tiền hợp đồng')]
  if (receivable) lines.push(line('credit', '131', receivable, 'Thu hồi khoản phải thu đã ghi nhận'))
  if (total > receivable) lines.push(line('credit', advanceAccountCode, total - receivable, advanceAccountCode === '3387' ? 'Tiền dịch vụ nhiều kỳ chờ phân bổ' : 'Khách hàng trả trước'))
  const balance = assertBalancedJournal(lines)
  return { lines, ...balance }
}

function manualReceiptJournal({ purposeCode, amount, cashAccountType, description = '' }) {
  const purpose = RECEIPT_PURPOSES[purposeCode]
  if (!purpose) throw new Error('Mục đích thu không hợp lệ.')
  const total = integerMoney(amount)
  const lines = [
    line('debit', cashAccountCode(cashAccountType), total, 'Thu tiền theo phiếu thu'),
    line('credit', purpose.creditAccountCode, total, description || purpose.label),
  ]
  return {
    purposeCode,
    purposeLabel: purpose.label,
    revenueImpact: purpose.revenueImpact ? total : 0,
    totalAmount: total,
    lines,
    ...assertBalancedJournal(lines),
  }
}

function serviceRevenueJournal({ amount, paidAllocation = 0, advanceAccountCode = '131' }) {
  const total = integerMoney(amount)
  const allocated = Math.min(total, integerMoney(paidAllocation, 'Doanh thu đã thu tiền', true))
  if (!['131', '3387'].includes(advanceAccountCode)) throw new Error('Tài khoản tiền nhận trước không hợp lệ.')
  const lines = []
  if (allocated) lines.push(line('debit', advanceAccountCode, allocated, 'Phân bổ tiền khách đã trả'))
  if (total > allocated) lines.push(line('debit', '131', total - allocated, 'Doanh thu dịch vụ chưa thu tiền'))
  lines.push(line('credit', '5113', total, 'Doanh thu dịch vụ PT hoàn thành'))
  const balance = assertBalancedJournal(lines)
  return { lines, ...balance }
}

function payrollAccrualJournal({ amount }) {
  const total = integerMoney(amount, 'Tiền lương phải trả')
  const lines = [
    line('debit', '6421', total, 'Ghi nhận chi phí lương, tiền ca và hoa hồng'),
    line('credit', '334', total, 'Phải trả người lao động'),
  ]
  return { lines, ...assertBalancedJournal(lines) }
}

function payrollPaymentJournal({ amount, cashAccountType }) {
  const total = integerMoney(amount, 'Tiền lương thanh toán')
  const lines = [
    line('debit', '334', total, 'Thanh toán khoản phải trả người lao động'),
    line('credit', cashAccountCode(cashAccountType), total, 'Chi trả lương qua quỹ'),
  ]
  return { lines, ...assertBalancedJournal(lines) }
}

function reversedJournalLines(lines) {
  const reversed = lines.map((item) => line(item.debit > 0 ? 'credit' : 'debit', item.accountCode, item.debit || item.credit, `Đảo: ${item.description || ''}`.trim()))
  assertBalancedJournal(reversed)
  return reversed
}

function amountInVietnameseWords(value) {
  const amount = integerMoney(value, 'Số tiền', true)
  if (amount === 0) return 'Không đồng'
  const digits = ['không', 'một', 'hai', 'ba', 'bốn', 'năm', 'sáu', 'bảy', 'tám', 'chín']
  const scales = ['', 'nghìn', 'triệu', 'tỷ']
  const readThree = (number, full) => {
    const hundred = Math.floor(number / 100)
    const ten = Math.floor((number % 100) / 10)
    const unit = number % 10
    const words = []
    if (hundred || full) words.push(digits[hundred], 'trăm')
    if (ten > 1) words.push(digits[ten], 'mươi')
    else if (ten === 1) words.push('mười')
    else if (unit && (hundred || full)) words.push('lẻ')
    if (unit) {
      if (unit === 1 && ten > 1) words.push('mốt')
      else if (unit === 5 && ten > 0) words.push('lăm')
      else words.push(digits[unit])
    }
    return words.join(' ')
  }
  const groups = []
  let remaining = amount
  while (remaining > 0) {
    groups.push(remaining % 1000)
    remaining = Math.floor(remaining / 1000)
  }
  const words = []
  for (let index = groups.length - 1; index >= 0; index -= 1) {
    const group = groups[index]
    if (!group) continue
    const scaleIndex = index % 3
    const billionIndex = Math.floor(index / 3)
    words.push(readThree(group, index < groups.length - 1 && group < 100))
    if (scales[scaleIndex]) words.push(scales[scaleIndex])
    if (billionIndex) words.push(...Array.from({ length: billionIndex }, () => 'tỷ'))
  }
  const result = `${words.join(' ').replace(/\s+/g, ' ').trim()} đồng`
  return result.charAt(0).toUpperCase() + result.slice(1)
}

module.exports = {
  CHART_OF_ACCOUNTS,
  EXPENSE_PURPOSES,
  RECEIPT_PURPOSES,
  cashAccountCode,
  assertBalancedJournal,
  expenseVoucherJournal,
  contractPaymentJournal,
  manualReceiptJournal,
  serviceRevenueJournal,
  payrollAccrualJournal,
  payrollPaymentJournal,
  reversedJournalLines,
  amountInVietnameseWords,
}
