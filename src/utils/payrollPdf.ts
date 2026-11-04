import type {
  PayrollRunItem,
  PayrollRunSummary,
  PayrollTeachingSlot,
  PayrollWorkday,
} from '../services/payrollService'
import type {
  MyStaffPayroll,
  StaffTeachingSlot,
  StaffWorkday,
  WorkdayDisplayStatus,
} from '../services/staffPayrollService'

export type PayrollPdfStatus = 'estimating' | 'draft' | 'reviewed' | 'locked' | 'paid'

export interface PayrollPdfFontBundle {
  regular: string
  medium: string
}

export interface PayrollPdfTeachingSlot {
  key: string
  date: string
  hour: number
  branchName: string
  studentCount: number
  dailyPosition: number
  tier: 'standard' | 'after_threshold' | 'after_threshold_evening'
  rate: number
  policyName: string
  crossBranchWarning: boolean
}

export interface PayrollPdfWorkday {
  date: string
  status: string
  holidayName: string
  note: string
  teachingSlotCount: number
  source: 'admin_override' | 'teaching_slots' | 'calendar'
}

export interface PayrollPdfStatement {
  reference: string
  periodId: string
  status: PayrollPdfStatus
  official: boolean
  generatedAt: string
  employee: {
    id: string
    name: string
    employeeCode: string
    branchName: string
    profileLabel: string
  }
  policyName: string
  amounts: {
    baseSalaryAmount: number
    teachingPayAmount: number
    commissionAmount: number
    bonusAmount: number
    adjustmentAmount: number
    deductionAmount: number
    grossAmount: number
    finalAmount: number
  }
  workdays: {
    paidDays: number
    estimatedPaidDays: number
    eligibleWorkdays: number
    autoPaidDays: number
    pendingDays: number
    unpaidDays: number
    benefitReviewDays: number
    rows: PayrollPdfWorkday[]
  }
  teaching: {
    attendanceEventCount: number
    slots: PayrollPdfTeachingSlot[]
  }
  referral: {
    rate: number
    contractCount: number
    cashCollectedAmount: number
    cashReversedAmount: number
    netCashAmount: number
    commissionAmount: number
  }
  adjustments: Array<{
    id: string
    type: 'bonus' | 'deduction'
    amount: number
    reason: string
    evidenceReference: string
  }>
  warnings: string[]
}

interface PayrollPdfBuildOptions {
  branchName?: string
  branchNameById?: (branchId: string) => string
  generatedAt?: string
}

interface PayrollPdfCreateOptions {
  fonts?: PayrollPdfFontBundle
}

const STATUS_LABELS: Record<PayrollPdfStatus, string> = {
  estimating: 'Tạm tính',
  draft: 'Bản nháp',
  reviewed: 'Đã duyệt',
  locked: 'Đã khóa',
  paid: 'Đã chi',
}

const WORKDAY_LABELS: Record<string, string> = {
  auto_present_teaching: 'Đủ công từ ca dạy',
  present: 'Có mặt',
  remote: 'Làm từ xa',
  business_trip: 'Công tác',
  training: 'Đào tạo',
  paid_leave: 'Nghỉ phép có lương',
  unpaid_leave: 'Nghỉ không lương',
  unexcused_absence: 'Vắng không phép',
  sick_leave: 'Nghỉ ốm cần duyệt',
  maternity_leave: 'Nghỉ thai sản cần duyệt',
  pending: 'Chưa chốt công',
  weekly_rest: 'Nghỉ hằng tuần',
  paid_holiday: 'Nghỉ lễ có lương',
  outside_employment: 'Ngoài thời gian làm việc',
  upcoming: 'Chưa đến ngày làm việc',
}

const TIER_LABELS: Record<PayrollPdfTeachingSlot['tier'], string> = {
  standard: 'Ca tiêu chuẩn',
  after_threshold: 'Từ ca thứ 9',
  after_threshold_evening: 'Ca thứ 9+ sau 20h',
}

function number(value: unknown) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function money(value: unknown) {
  return `${Math.round(number(value)).toLocaleString('vi-VN')} đ`
}

function periodLabel(periodId: string) {
  const match = /^(\d{4})-(\d{2})$/.exec(periodId)
  return match ? `Tháng ${Number(match[2])}/${match[1]}` : periodId
}

function dateLabel(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value)
  return match ? `${match[3]}/${match[2]}/${match[1]}` : value || 'Chưa cập nhật'
}

function timeLabel(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? 'Chưa cập nhật'
    : date.toLocaleString('vi-VN', { hour12: false })
}

function profileLabel(employmentType: string, employmentLevel = '') {
  if (employmentType === 'collaborator') return 'Cộng tác viên'
  if (employmentType === 'part_time') return 'Nhân viên Part-time'
  if (employmentLevel === 'probation') return 'Nhân viên thử việc'
  if (employmentLevel === 'senior') return 'Nhân viên Senior'
  return 'Nhân viên chính thức'
}

function branchLabel(branchId: string, options: PayrollPdfBuildOptions) {
  return options.branchName || options.branchNameById?.(branchId) || branchId || 'Chưa gắn chi nhánh'
}

function runTeachingSlot(slot: PayrollTeachingSlot, options: PayrollPdfBuildOptions): PayrollPdfTeachingSlot {
  const observedBranches = (slot.branchIds || []).map((id) => options.branchNameById?.(id) || id).filter(Boolean)
  return {
    key: slot.key,
    date: slot.date,
    hour: slot.hour,
    branchName: observedBranches.length > 1 ? observedBranches.join(', ') : branchLabel(slot.branchId, options),
    studentCount: slot.studentCount,
    dailyPosition: slot.dailyPosition,
    tier: slot.tier,
    rate: slot.rate,
    policyName: slot.policyName,
    crossBranchWarning: slot.crossBranchWarning === true,
  }
}

function staffTeachingSlot(slot: StaffTeachingSlot, options: PayrollPdfBuildOptions): PayrollPdfTeachingSlot {
  return {
    key: slot.key,
    date: slot.date,
    hour: slot.hour,
    branchName: branchLabel(slot.branchId, options),
    studentCount: slot.studentCount,
    dailyPosition: slot.dailyPosition,
    tier: slot.tier,
    rate: slot.rate,
    policyName: slot.policyName,
    crossBranchWarning: false,
  }
}

function workdayRow(day: PayrollWorkday | StaffWorkday): PayrollPdfWorkday {
  return {
    date: day.date,
    status: day.status,
    holidayName: day.holidayName,
    note: day.note,
    teachingSlotCount: day.teachingSlotCount,
    source: day.source,
  }
}

export function payrollPdfFromRunItem(
  run: PayrollRunSummary,
  item: PayrollRunItem,
  options: PayrollPdfBuildOptions = {},
): PayrollPdfStatement {
  const employeeName = item.staffSnapshot?.name || item.trainerSnapshot?.name || 'Chưa cập nhật tên nhân viên'
  const employeeCode = item.staffSnapshot?.employeeCode || item.trainerSnapshot?.employeeCode || ''
  const branchId = item.staffSnapshot?.branchId || item.trainerSnapshot?.branchId || ''
  const warnings = [
    item.attendanceReviewRequired ? 'Ngày công còn thiếu hoặc cần xác minh.' : '',
    item.calendarReviewRequired ? 'Lịch làm việc chuẩn của chi nhánh chưa được duyệt.' : '',
    number(item.sessionEvidencePendingAmount) > 0 ? `Có bằng chứng ca dạy đang chờ duyệt, giá trị ${money(item.sessionEvidencePendingAmount)}.` : '',
    number(item.crossBranchWarningCount) > 0 ? `${item.crossBranchWarningCount} ca có dữ liệu khác chi nhánh và cần kiểm tra.` : '',
    run.status === 'draft' ? 'Kỳ lương đang là bản nháp và có thể thay đổi trước khi duyệt, khóa kỳ.' : '',
  ].filter(Boolean)
  return {
    reference: `${run.id}/${item.id}`,
    periodId: run.periodId,
    status: run.status,
    official: run.status === 'locked' || run.status === 'paid',
    generatedAt: options.generatedAt || new Date().toISOString(),
    employee: {
      id: item.staffId || item.trainerId,
      name: employeeName,
      employeeCode,
      branchName: branchLabel(branchId, options),
      profileLabel: profileLabel(item.employmentType),
    },
    policyName: [...new Set(item.teachingSlots.map((slot) => slot.policyName).filter(Boolean))].join(', ') || run.policyName || 'Chưa cập nhật chính sách',
    amounts: {
      baseSalaryAmount: item.baseSalaryAmount,
      teachingPayAmount: item.teachingPayAmount,
      commissionAmount: item.commissionAmount,
      bonusAmount: item.bonusAmount,
      adjustmentAmount: item.adjustmentAmount,
      deductionAmount: item.deductionAmount,
      grossAmount: item.grossAmount,
      finalAmount: item.finalAmount,
    },
    workdays: {
      paidDays: item.workdaySummary.paidDays,
      estimatedPaidDays: item.workdaySummary.estimatedPaidDays,
      eligibleWorkdays: item.workdaySummary.eligibleWorkdays,
      autoPaidDays: item.workdaySummary.autoPaidDays,
      pendingDays: item.workdaySummary.pendingDays,
      unpaidDays: item.workdaySummary.unpaidDays,
      benefitReviewDays: item.workdaySummary.benefitReviewDays,
      rows: item.workdayDays.map(workdayRow),
    },
    teaching: {
      attendanceEventCount: item.attendanceEventCount,
      slots: item.teachingSlots.map((slot) => runTeachingSlot(slot, options)),
    },
    referral: {
      rate: item.referralCommission?.rate || 0,
      contractCount: item.referralCommission?.contractCount || 0,
      cashCollectedAmount: item.referralCommission?.cashCollectedAmount || 0,
      cashReversedAmount: item.referralCommission?.cashReversedAmount || 0,
      netCashAmount: item.referralCommission?.netCashAmount || 0,
      commissionAmount: item.referralCommission?.commissionAmount || item.commissionAmount,
    },
    adjustments: item.payrollAdjustments,
    warnings,
  }
}

export function payrollPdfFromStaffStatement(
  data: MyStaffPayroll,
  options: PayrollPdfBuildOptions = {},
): PayrollPdfStatement {
  const warnings = [
    data.workdays.attendanceReviewRequired ? 'Ngày công còn thiếu hoặc cần xác minh.' : '',
    data.workdays.calendarReviewRequired ? 'Lịch làm việc chuẩn của chi nhánh chưa được duyệt.' : '',
    data.teachingEvidence?.truncated ? 'Danh sách bằng chứng ca dạy đã chạm giới hạn tải an toàn.' : '',
    !data.run.official ? 'Số liệu đang tạm tính và có thể thay đổi trước khi kỳ lương được khóa.' : '',
  ].filter(Boolean)
  return {
    reference: `${data.periodId}/${data.staffId}`,
    periodId: data.periodId,
    status: data.run.status,
    official: data.run.official,
    generatedAt: options.generatedAt || data.generatedAt || new Date().toISOString(),
    employee: {
      id: data.staffId,
      name: data.identity.name,
      employeeCode: data.identity.employeeCode,
      branchName: branchLabel(data.identity.branchId, options),
      profileLabel: profileLabel(data.workdays.employmentType, data.workdays.employmentLevel),
    },
    policyName: data.compensationPolicy.name,
    amounts: { ...data.amounts },
    workdays: {
      paidDays: data.workdays.paidDays,
      estimatedPaidDays: data.workdays.estimatedPaidDays,
      eligibleWorkdays: data.workdays.eligibleWorkdays,
      autoPaidDays: data.workdays.autoPaidDays,
      pendingDays: data.workdays.pendingDays,
      unpaidDays: data.workdays.unpaidDays,
      benefitReviewDays: data.workdays.benefitReviewDays,
      rows: data.workdays.days.map(workdayRow),
    },
    teaching: {
      attendanceEventCount: data.teachingSlots.reduce((total, slot) => total + Math.max(1, slot.sessionIds.length), 0),
      slots: data.teachingSlots.map((slot) => staffTeachingSlot(slot, options)),
    },
    referral: {
      rate: data.referralCommission.rate,
      contractCount: data.referralCommission.contractCount,
      cashCollectedAmount: data.referralCommission.cashCollectedAmount,
      cashReversedAmount: data.referralCommission.cashReversedAmount,
      netCashAmount: data.referralCommission.netCashAmount,
      commissionAmount: data.referralCommission.commissionAmount,
    },
    adjustments: [],
    warnings,
  }
}

export function payrollPdfFilename(statement: PayrollPdfStatement) {
  const employee = statement.employee.name.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd').replace(/Đ/g, 'D').replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '')
  return `Phieu_luong_${statement.periodId}_${employee || statement.employee.id.slice(0, 12) || 'Nhan_vien'}.pdf`
}

function arrayBufferToBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
  }
  return btoa(binary)
}

let defaultFontPromise: Promise<PayrollPdfFontBundle> | null = null

async function loadDefaultFonts(): Promise<PayrollPdfFontBundle> {
  if (defaultFontPromise) return defaultFontPromise
  defaultFontPromise = (async () => {
    const baseUrl = (import.meta as ImportMeta & { env?: { BASE_URL?: string } }).env?.BASE_URL || '/'
    const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`
    const [regularResponse, mediumResponse] = await Promise.all([
      fetch(`${base}fonts/Roboto-Regular.ttf`),
      fetch(`${base}fonts/Roboto-Medium.ttf`),
    ])
    if (!regularResponse.ok || !mediumResponse.ok) throw new Error('Không tải được phông chữ tiếng Việt cho PDF.')
    const [regular, medium] = await Promise.all([regularResponse.arrayBuffer(), mediumResponse.arrayBuffer()])
    return { regular: arrayBufferToBase64(regular), medium: arrayBufferToBase64(medium) }
  })().catch((error) => {
    defaultFontPromise = null
    throw error
  })
  return defaultFontPromise
}

function sourceLabel(source: PayrollPdfWorkday['source']) {
  if (source === 'admin_override') return 'Admin chốt'
  if (source === 'teaching_slots') return 'Ca dạy'
  return 'Lịch chuẩn'
}

export async function createPayrollStatementPdf(statement: PayrollPdfStatement, options: PayrollPdfCreateOptions = {}) {
  const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ])
  const fonts = options.fonts || await loadDefaultFonts()
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true })
  doc.addFileToVFS('Roboto-Regular.ttf', fonts.regular)
  doc.addFont('Roboto-Regular.ttf', 'Roboto', 'normal')
  doc.addFileToVFS('Roboto-Medium.ttf', fonts.medium)
  doc.addFont('Roboto-Medium.ttf', 'Roboto', 'bold')
  doc.setFont('Roboto', 'normal')

  const pageWidth = 210
  const pageHeight = 297
  const margin = 14
  const contentWidth = pageWidth - margin * 2
  const footerY = pageHeight - 10
  const pink: [number, number, number] = [236, 45, 118]
  const ink: [number, number, number] = [52, 38, 48]
  const muted: [number, number, number] = [120, 104, 114]
  const line: [number, number, number] = [232, 222, 228]
  const soft: [number, number, number] = [252, 247, 250]
  let y = 16

  const ensureSpace = (height: number) => {
    if (y + height <= footerY - 7) return
    doc.addPage()
    y = 20
  }

  const sectionTitle = (title: string, meta = '') => {
    ensureSpace(14)
    doc.setFont('Roboto', 'bold')
    doc.setFontSize(11)
    doc.setTextColor(...ink)
    doc.text(title, margin, y)
    if (meta) {
      doc.setFont('Roboto', 'normal')
      doc.setFontSize(8)
      doc.setTextColor(...muted)
      doc.text(meta, pageWidth - margin, y, { align: 'right' })
    }
    doc.setDrawColor(...line)
    doc.line(margin, y + 3, pageWidth - margin, y + 3)
    y += 8
  }

  const table = (body: Array<Array<string | number>>, config: Record<string, unknown> = {}) => {
    autoTable(doc, {
      margin: { left: margin, right: margin, bottom: 17 },
      startY: y,
      theme: 'plain',
      styles: {
        font: 'Roboto',
        fontSize: 8,
        cellPadding: { top: 2.2, right: 2.2, bottom: 2.2, left: 2.2 },
        textColor: ink,
        lineColor: line,
        lineWidth: { bottom: 0.15 },
        overflow: 'linebreak',
        valign: 'middle',
      },
      headStyles: {
        font: 'Roboto',
        fontStyle: 'bold',
        fillColor: soft,
        textColor: ink,
        lineColor: line,
        lineWidth: { bottom: 0.35 },
      },
      alternateRowStyles: { fillColor: [254, 252, 253] },
      body,
      ...config,
    })
    y = ((doc as typeof doc & { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY || y) + 6
  }

  doc.setFillColor(...pink)
  doc.rect(0, 0, pageWidth, 4, 'F')
  doc.setTextColor(...pink)
  doc.setFont('Roboto', 'bold')
  doc.setFontSize(8)
  doc.text('AURA OPERATIONS', margin, y)
  doc.setTextColor(...ink)
  doc.setFontSize(22)
  doc.text('PHIẾU LƯƠNG', margin, y + 10)
  doc.setFont('Roboto', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(...muted)
  doc.text(`${periodLabel(statement.periodId)} | Xuất lúc ${timeLabel(statement.generatedAt)}`, margin, y + 17)

  const statusLabel = STATUS_LABELS[statement.status]
  doc.setFillColor(statement.official ? 232 : 255, statement.official ? 248 : 244, statement.official ? 240 : 230)
  doc.roundedRect(162, y - 4, 34, 10, 4, 4, 'F')
  doc.setFont('Roboto', 'bold')
  doc.setFontSize(8)
  doc.setTextColor(statement.official ? 24 : 157, statement.official ? 112 : 82, statement.official ? 72 : 37)
  doc.text(statusLabel, 179, y + 2.2, { align: 'center' })
  y += 26

  doc.setFillColor(...soft)
  doc.roundedRect(margin, y, contentWidth, 27, 4, 4, 'F')
  doc.setFont('Roboto', 'bold')
  doc.setTextColor(...ink)
  doc.setFontSize(15)
  doc.text(statement.employee.name, margin + 6, y + 8)
  doc.setFont('Roboto', 'normal')
  doc.setFontSize(8.5)
  doc.setTextColor(...muted)
  const employeeMeta = [statement.employee.employeeCode || 'Chưa có mã NV', statement.employee.profileLabel, statement.employee.branchName]
  doc.text(employeeMeta.join(' | '), margin + 6, y + 15)
  doc.text(`Chính sách: ${statement.policyName}`, margin + 6, y + 21.5, { maxWidth: contentWidth - 12 })
  y += 33

  doc.setFillColor(...ink)
  doc.roundedRect(margin, y, contentWidth, 28, 4, 4, 'F')
  doc.setFont('Roboto', 'normal')
  doc.setTextColor(244, 233, 239)
  doc.setFontSize(8.5)
  doc.text(statement.official ? 'TỔNG THỰC NHẬN' : 'TỔNG TẠM TÍNH', margin + 7, y + 8)
  doc.setFont('Roboto', 'bold')
  doc.setTextColor(255, 255, 255)
  doc.setFontSize(22)
  doc.text(money(statement.amounts.finalAmount), margin + 7, y + 19.5)
  doc.setFontSize(8)
  doc.setFont('Roboto', 'normal')
  doc.setTextColor(231, 214, 224)
  doc.text(`${statement.teaching.slots.length} ca dạy | ${statement.workdays.paidDays}/${statement.workdays.eligibleWorkdays} ngày công | ${statement.referral.contractCount} hợp đồng giới thiệu`, pageWidth - margin - 7, y + 18, { align: 'right', maxWidth: 88 })
  y += 35

  sectionTitle('Cấu phần thu nhập', `${statement.teaching.attendanceEventCount} lượt điểm danh -> ${statement.teaching.slots.length} ca tính tiền`)
  table([
    ['Lương cơ bản', `${statement.workdays.paidDays} ngày đã ghi nhận | dự tính ${statement.workdays.estimatedPaidDays}/${statement.workdays.eligibleWorkdays} ngày`, money(statement.amounts.baseSalaryAmount)],
    ['Tiền ca dạy', `${statement.teaching.slots.length} ca duy nhất theo PT + ngày + giờ`, money(statement.amounts.teachingPayAmount)],
    ['Hoa hồng giới thiệu', `${statement.referral.rate || 0}% trên ${money(statement.referral.netCashAmount)} thực thu`, money(statement.amounts.commissionAmount)],
    ['Thưởng', 'Khoản thưởng đã đủ điều kiện trong kỳ', money(statement.amounts.bonusAmount)],
    ['Điều chỉnh', 'Điều chỉnh khác đã ghi nhận', money(statement.amounts.adjustmentAmount)],
    ['Khấu trừ', 'Khấu trừ và khoản hoàn/đảo đã duyệt', `-${money(statement.amounts.deductionAmount)}`],
    ['Tổng thực nhận', 'Tổng sau thưởng, điều chỉnh và khấu trừ', money(statement.amounts.finalAmount)],
  ], {
    head: [['Khoản', 'Căn cứ', 'Số tiền']],
    columnStyles: { 0: { cellWidth: 39, fontStyle: 'bold' }, 1: { cellWidth: 95 }, 2: { cellWidth: 48, halign: 'right', fontStyle: 'bold' } },
    didParseCell: (hook: { row: { index: number }; cell: { styles: { fillColor?: [number, number, number]; textColor?: [number, number, number]; fontStyle?: string } } }) => {
      if (hook.row.index === 6) {
        hook.cell.styles.fillColor = [255, 240, 247]
        hook.cell.styles.textColor = pink
        hook.cell.styles.fontStyle = 'bold'
      }
    },
  })

  sectionTitle('Ngày công', `${statement.workdays.autoPaidDays} ngày tự tính từ ca dạy | ${statement.workdays.pendingDays} ngày chờ chốt`)
  if (statement.workdays.rows.length) {
    table(statement.workdays.rows.map((day) => [
      dateLabel(day.date),
      day.holidayName || WORKDAY_LABELS[day.status] || day.status,
      `${day.teachingSlotCount} ca`,
      sourceLabel(day.source),
      day.note || '',
    ]), {
      head: [['Ngày', 'Tình trạng', 'Ca dạy', 'Nguồn', 'Ghi chú']],
      columnStyles: { 0: { cellWidth: 25 }, 1: { cellWidth: 45 }, 2: { cellWidth: 20, halign: 'center' }, 3: { cellWidth: 27 }, 4: { cellWidth: 65 } },
    })
  } else {
    doc.setFontSize(8.5)
    doc.setTextColor(...muted)
    doc.text('Kỳ này chưa lưu bảng ngày công theo ngày.', margin, y)
    y += 8
  }

  sectionTitle('Hoa hồng và điều chỉnh', `${statement.referral.contractCount} hợp đồng giới thiệu`)
  table([
    ['Dòng tiền đã thu', money(statement.referral.cashCollectedAmount)],
    ['Hoàn/đảo dòng tiền', `-${money(statement.referral.cashReversedAmount)}`],
    ['Dòng tiền tính hoa hồng', money(statement.referral.netCashAmount)],
    [`Hoa hồng ${statement.referral.rate || 0}%`, money(statement.referral.commissionAmount)],
  ], {
    head: [['Nội dung', 'Giá trị']],
    columnStyles: { 0: { cellWidth: 132 }, 1: { cellWidth: 50, halign: 'right', fontStyle: 'bold' } },
  })
  if (statement.adjustments.length) {
    table(statement.adjustments.map((adjustment) => [
      adjustment.type === 'bonus' ? 'Thưởng' : 'Khấu trừ',
      adjustment.reason || 'Chưa ghi lý do',
      adjustment.evidenceReference || 'Không có',
      `${adjustment.type === 'bonus' ? '+' : '-'}${money(adjustment.amount)}`,
    ]), {
      head: [['Loại', 'Lý do', 'Bằng chứng', 'Số tiền']],
      columnStyles: { 0: { cellWidth: 25 }, 1: { cellWidth: 70 }, 2: { cellWidth: 45 }, 3: { cellWidth: 42, halign: 'right', fontStyle: 'bold' } },
    })
  }

  sectionTitle('Chi tiết ca dạy', 'Hai học viên cùng PT, ngày và giờ chỉ tính một ca')
  if (statement.teaching.slots.length) {
    table(statement.teaching.slots.map((slot, index) => [
      index + 1,
      `${dateLabel(slot.date)}\n${String(slot.hour).padStart(2, '0')}:00`,
      slot.branchName,
      `${slot.studentCount} HV`,
      `${TIER_LABELS[slot.tier]}\n${slot.policyName || 'Chính sách kỳ lương'}${slot.crossBranchWarning ? '\nCần kiểm tra chi nhánh' : ''}`,
      money(slot.rate),
    ]), {
      head: [['#', 'Ngày / giờ', 'Chi nhánh', 'Số HV', 'Loại ca / chính sách', 'Đơn giá']],
      showHead: 'everyPage',
      rowPageBreak: 'avoid',
      columnStyles: {
        0: { cellWidth: 8, halign: 'center' },
        1: { cellWidth: 29 },
        2: { cellWidth: 29 },
        3: { cellWidth: 17, halign: 'center' },
        4: { cellWidth: 69 },
        5: { cellWidth: 30, halign: 'right', fontStyle: 'bold' },
      },
    })
  } else {
    doc.setFontSize(8.5)
    doc.setTextColor(...muted)
    doc.text('Chưa có ca dạy đủ điều kiện tính lương trong kỳ.', margin, y)
    y += 8
  }

  if (statement.warnings.length) {
    ensureSpace(13 + statement.warnings.length * 7)
    sectionTitle('Mục cần lưu ý')
    doc.setFillColor(255, 247, 235)
    const warningHeight = 8 + statement.warnings.reduce((total, warning) => total + doc.splitTextToSize(`- ${warning}`, contentWidth - 12).length * 4.2, 0)
    doc.roundedRect(margin, y - 2, contentWidth, warningHeight, 3, 3, 'F')
    doc.setFont('Roboto', 'normal')
    doc.setFontSize(8.2)
    doc.setTextColor(137, 84, 24)
    for (const warning of statement.warnings) {
      const lines = doc.splitTextToSize(`- ${warning}`, contentWidth - 12)
      doc.text(lines, margin + 6, y + 4)
      y += lines.length * 4.2 + 2
    }
  }

  const pages = doc.getNumberOfPages()
  for (let page = 1; page <= pages; page += 1) {
    doc.setPage(page)
    if (page > 1) {
      doc.setFont('Roboto', 'bold')
      doc.setFontSize(7.5)
      doc.setTextColor(...pink)
      doc.text('AURA OPERATIONS', margin, 10)
      doc.setFont('Roboto', 'normal')
      doc.setTextColor(...muted)
      doc.text(`${statement.employee.name} | ${periodLabel(statement.periodId)}`, pageWidth - margin, 10, { align: 'right' })
      doc.setDrawColor(...line)
      doc.line(margin, 13, pageWidth - margin, 13)
    }
    doc.setDrawColor(...line)
    doc.line(margin, footerY - 4, pageWidth - margin, footerY - 4)
    doc.setFont('Roboto', 'normal')
    doc.setFontSize(7)
    doc.setTextColor(...muted)
    doc.text(statement.official ? 'Phiếu lương đã khóa số liệu.' : 'Bản tạm tính - không dùng làm chứng từ chi lương.', margin, footerY)
    doc.text(`Mã: ${statement.reference}`, pageWidth / 2, footerY, { align: 'center', maxWidth: 72 })
    doc.text(`Trang ${page}/${pages}`, pageWidth - margin, footerY, { align: 'right' })
  }

  return { doc, filename: payrollPdfFilename(statement) }
}

export async function downloadPayrollStatementPdf(statement: PayrollPdfStatement) {
  const { doc, filename } = await createPayrollStatementPdf(statement)
  doc.save(filename)
  return filename
}

export const payrollPdfLabels = {
  money,
  periodLabel,
  dateLabel,
  status: STATUS_LABELS,
  workday: WORKDAY_LABELS as Record<WorkdayDisplayStatus | string, string>,
}
