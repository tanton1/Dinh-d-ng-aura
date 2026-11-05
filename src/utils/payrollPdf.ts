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
  studentNames: string[]
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
  studentNameById?: (studentId: string) => string
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
  const studentNames = (slot.studentIds || [])
    .map((id) => options.studentNameById?.(id) || '')
    .filter(Boolean)
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
    studentNames,
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
    studentNames: [],
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
  const footerY = pageHeight - 9
  const pink: [number, number, number] = [226, 35, 105]
  const ink: [number, number, number] = [43, 35, 41]
  const muted: [number, number, number] = [119, 107, 114]
  const line: [number, number, number] = [229, 222, 226]
  const soft: [number, number, number] = [250, 247, 249]
  const green: [number, number, number] = [31, 112, 78]
  let y = 13

  const ensureSpace = (height: number) => {
    if (y + height <= footerY - 7) return
    doc.addPage()
    y = 18
  }

  const sectionTitle = (title: string, meta = '') => {
    ensureSpace(12)
    doc.setFont('Roboto', 'bold')
    doc.setFontSize(10.5)
    doc.setTextColor(...ink)
    doc.text(title, margin, y)
    if (meta) {
      doc.setFont('Roboto', 'normal')
      doc.setFontSize(7.5)
      doc.setTextColor(...muted)
      doc.text(meta, pageWidth - margin, y, { align: 'right' })
    }
    doc.setDrawColor(...line)
    doc.line(margin, y + 2.5, pageWidth - margin, y + 2.5)
    y += 7
  }

  const table = (body: unknown[], config: Record<string, unknown> = {}) => {
    autoTable(doc, {
      margin: { left: margin, right: margin, bottom: 15 },
      startY: y,
      theme: 'plain',
      styles: {
        font: 'Roboto',
        fontSize: 7.6,
        cellPadding: { top: 1.7, right: 2, bottom: 1.7, left: 2 },
        textColor: ink,
        lineColor: line,
        lineWidth: { bottom: 0.12 },
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
      alternateRowStyles: { fillColor: [253, 251, 252] },
      body: body as never[],
      ...config,
    })
    y = ((doc as typeof doc & { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY || y) + 4
  }

  doc.setFillColor(...pink)
  doc.rect(0, 0, pageWidth, 3, 'F')
  doc.setTextColor(...ink)
  doc.setFont('Roboto', 'bold')
  doc.setFontSize(18)
  doc.text('Phiếu lương', margin, y)
  doc.setFont('Roboto', 'normal')
  doc.setFontSize(8)
  doc.setTextColor(...muted)
  doc.text(`${statement.employee.name}  ·  ${periodLabel(statement.periodId)}`, margin, y + 6)

  const statusLabel = STATUS_LABELS[statement.status]
  doc.setFillColor(statement.official ? 232 : 255, statement.official ? 248 : 245, statement.official ? 240 : 234)
  doc.roundedRect(166, y - 6, 30, 9, 4, 4, 'F')
  doc.setFont('Roboto', 'bold')
  doc.setFontSize(7.5)
  doc.setTextColor(statement.official ? 24 : 157, statement.official ? 112 : 82, statement.official ? 72 : 37)
  doc.text(statusLabel, 181, y - 0.3, { align: 'center' })
  y += 12

  doc.setFillColor(...soft)
  doc.roundedRect(margin, y, contentWidth, 16, 3, 3, 'F')
  doc.setFont('Roboto', 'normal')
  doc.setFontSize(7.4)
  doc.setTextColor(...muted)
  const employeeMeta = [statement.employee.employeeCode, statement.employee.profileLabel, statement.employee.branchName].filter(Boolean)
  doc.text(employeeMeta.join('  ·  '), margin + 5, y + 6)
  doc.setTextColor(...ink)
  doc.text(statement.policyName, margin + 5, y + 11.5, { maxWidth: contentWidth - 10 })
  y += 20

  doc.setFillColor(...ink)
  doc.roundedRect(margin, y, contentWidth, 24, 3, 3, 'F')
  doc.setFont('Roboto', 'normal')
  doc.setTextColor(230, 218, 225)
  doc.setFontSize(7.5)
  doc.text(statement.official ? 'Thực nhận' : 'Tạm tính', margin + 6, y + 7)
  doc.setFont('Roboto', 'bold')
  doc.setTextColor(255, 255, 255)
  doc.setFontSize(18)
  doc.text(money(statement.amounts.finalAmount), margin + 6, y + 18)
  doc.setFontSize(7.5)
  doc.setFont('Roboto', 'normal')
  doc.setTextColor(220, 207, 215)
  doc.text(`${statement.workdays.paidDays}/${statement.workdays.eligibleWorkdays} ngày công  ·  ${statement.teaching.slots.length} ca dạy`, pageWidth - margin - 6, y + 15, { align: 'right' })
  y += 28

  const metricGap = 3
  const metricWidth = (contentWidth - metricGap * 2) / 3
  const metrics = [
    ['Ngày công', `${statement.workdays.paidDays}/${statement.workdays.eligibleWorkdays}`],
    ['Ca dạy', `${statement.teaching.slots.length}`],
    ['Hoa hồng', money(statement.amounts.commissionAmount)],
  ]
  metrics.forEach(([label, value], index) => {
    const x = margin + index * (metricWidth + metricGap)
    doc.setFillColor(...soft)
    doc.roundedRect(x, y, metricWidth, 17, 2.5, 2.5, 'F')
    doc.setFont('Roboto', 'normal')
    doc.setFontSize(6.8)
    doc.setTextColor(...muted)
    doc.text(label, x + 4, y + 5.5)
    doc.setFont('Roboto', 'bold')
    doc.setFontSize(10.5)
    doc.setTextColor(...ink)
    doc.text(value, x + 4, y + 12.8, { maxWidth: metricWidth - 8 })
  })
  y += 22

  const incomeRows: Array<[string, string]> = [
    ['Lương cơ bản', money(statement.amounts.baseSalaryAmount)],
    ['Ca dạy', money(statement.amounts.teachingPayAmount)],
    ...(statement.amounts.commissionAmount || statement.referral.contractCount ? [['Hoa hồng', money(statement.amounts.commissionAmount)] as [string, string]] : []),
    ...(statement.amounts.bonusAmount ? [['Thưởng', money(statement.amounts.bonusAmount)] as [string, string]] : []),
    ...(statement.amounts.adjustmentAmount ? [['Điều chỉnh', money(statement.amounts.adjustmentAmount)] as [string, string]] : []),
    ...(statement.amounts.deductionAmount ? [['Khấu trừ', `-${money(statement.amounts.deductionAmount)}`] as [string, string]] : []),
  ]
  sectionTitle('Thu nhập')
  table(incomeRows, {
    showHead: 'never',
    columnStyles: { 0: { cellWidth: 124 }, 1: { cellWidth: 58, halign: 'right', fontStyle: 'bold' } },
  })

  const [periodYearText, periodMonthText] = statement.periodId.split('-')
  const periodYear = Number(periodYearText)
  const periodMonth = Number(periodMonthText)
  const validPeriod = Number.isInteger(periodYear) && Number.isInteger(periodMonth) && periodMonth >= 1 && periodMonth <= 12
  const daysInPeriod = validPeriod ? new Date(periodYear, periodMonth, 0).getDate() : statement.workdays.rows.length
  const leadingDays = validPeriod ? (new Date(periodYear, periodMonth - 1, 1).getDay() + 6) % 7 : 0
  const calendarRows = Math.max(1, Math.ceil((leadingDays + daysInPeriod) / 7))
  const workdayByDate = new Map(statement.workdays.rows.map((day) => [day.date.slice(0, 10), day]))
  const slotsByDate = new Map<string, number>()
  statement.teaching.slots.forEach((slot) => slotsByDate.set(slot.date, (slotsByDate.get(slot.date) || 0) + 1))
  const calendarHeight = 12 + calendarRows * 13.5
  ensureSpace(calendarHeight + 12)
  sectionTitle('Lịch công & ca dạy', `${statement.workdays.pendingDays} ngày chờ chốt`)
  const weekdays = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN']
  const calendarCellWidth = contentWidth / 7
  doc.setFont('Roboto', 'bold')
  doc.setFontSize(6.5)
  doc.setTextColor(...muted)
  weekdays.forEach((label, index) => doc.text(label, margin + calendarCellWidth * index + calendarCellWidth / 2, y + 3, { align: 'center' }))
  y += 5

  const paidStatuses = new Set(['auto_present_teaching', 'present', 'remote', 'business_trip', 'training', 'paid_leave'])
  const pendingStatuses = new Set(['pending', 'sick_leave', 'maternity_leave'])
  const unpaidStatuses = new Set(['unpaid_leave', 'unexcused_absence'])
  for (let day = 1; day <= daysInPeriod; day += 1) {
    const position = leadingDays + day - 1
    const row = Math.floor(position / 7)
    const column = position % 7
    const date = validPeriod ? `${periodYearText}-${periodMonthText}-${String(day).padStart(2, '0')}` : statement.workdays.rows[day - 1]?.date || ''
    const workday = workdayByDate.get(date)
    const slotCount = slotsByDate.get(date) || workday?.teachingSlotCount || 0
    const status = workday?.status || ''
    let fill: [number, number, number] = [251, 249, 250]
    let accent: [number, number, number] = muted
    let short = ''
    if (paidStatuses.has(status)) {
      fill = [237, 248, 243]
      accent = green
      short = status === 'auto_present_teaching' ? 'Tự động' : 'Đủ công'
    } else if (pendingStatuses.has(status)) {
      fill = [255, 247, 231]
      accent = [168, 100, 24]
      short = 'Chờ'
    } else if (unpaidStatuses.has(status)) {
      fill = [255, 239, 244]
      accent = [183, 51, 88]
      short = 'Không lương'
    } else if (status === 'paid_holiday') {
      fill = [241, 246, 252]
      accent = [65, 96, 132]
      short = 'Nghỉ lễ'
    } else if (status === 'weekly_rest') {
      fill = [245, 243, 245]
      short = 'Nghỉ'
    }
    const x = margin + column * calendarCellWidth + 0.6
    const cellY = y + row * 13.5
    const cellWidth = calendarCellWidth - 1.2
    doc.setFillColor(...fill)
    doc.roundedRect(x, cellY, cellWidth, 12.3, 2, 2, 'F')
    doc.setFont('Roboto', 'bold')
    doc.setFontSize(7)
    doc.setTextColor(...accent)
    doc.text(String(day), x + 2.2, cellY + 4)
    doc.setFontSize(5.8)
    doc.setFont('Roboto', 'normal')
    if (short) doc.text(short, x + 2.2, cellY + 10, { maxWidth: cellWidth - 12 })
    if (slotCount) {
      doc.setFont('Roboto', 'bold')
      doc.text(`${slotCount} ca`, x + cellWidth - 2.2, cellY + 10, { align: 'right' })
    }
  }
  y += calendarRows * 13.5 + 4
  doc.setFont('Roboto', 'normal')
  doc.setFontSize(6.4)
  doc.setTextColor(...muted)
  doc.text('Xanh: đủ công   ·   Vàng: chờ chốt   ·   Hồng: không lương   ·   Xám: nghỉ', margin, y)
  y += 7

  if (y > 205 || statement.teaching.slots.length > 8) {
    doc.addPage()
    y = 18
  }
  sectionTitle('Chi tiết ca dạy', `${statement.teaching.slots.length} ca`)
  if (statement.teaching.slots.length) {
    const groupedSlots = new Map<string, PayrollPdfTeachingSlot[]>()
    statement.teaching.slots
      .slice()
      .sort((left, right) => left.date.localeCompare(right.date) || left.hour - right.hour)
      .forEach((slot) => groupedSlots.set(slot.date, [...(groupedSlots.get(slot.date) || []), slot]))
    const teachingRows: unknown[] = []
    groupedSlots.forEach((slots, date) => {
      const dailyAmount = slots.reduce((total, slot) => total + slot.rate, 0)
      slots.forEach((slot, slotIndex) => {
        const knownStudents = slot.studentNames.filter(Boolean)
        const missingStudents = Math.max(0, slot.studentCount - knownStudents.length)
        const studentLabel = knownStudents.length
          ? `${knownStudents.join(', ')}${missingStudents ? ` + ${missingStudents} học viên` : ''}`
          : `${slot.studentCount} học viên`
        const branch = slot.branchName && slot.branchName !== statement.employee.branchName ? `\n${slot.branchName}` : ''
        const row: unknown[] = [
          `${String(slot.hour).padStart(2, '0')}:00`,
          studentLabel,
          `${TIER_LABELS[slot.tier]}${branch}${slot.crossBranchWarning ? '\nKiểm tra cơ sở' : ''}`,
          money(slot.rate),
        ]
        if (slotIndex === 0) {
          row.unshift({
            content: `${dateLabel(date)}\n${slots.length} ca · ${money(dailyAmount)}`,
            rowSpan: slots.length,
            styles: { fillColor: soft, textColor: ink, fontStyle: 'bold', valign: 'top' },
          })
        }
        teachingRows.push(row)
      })
    })
    table(teachingRows, {
      head: [['Ngày', 'Giờ', 'Học viên', 'Loại ca', 'Tiền ca']],
      showHead: 'everyPage',
      rowPageBreak: 'avoid',
      columnStyles: {
        0: { cellWidth: 31 },
        1: { cellWidth: 17, fontStyle: 'bold' },
        2: { cellWidth: 62 },
        3: { cellWidth: 44 },
        4: { cellWidth: 28, halign: 'right', fontStyle: 'bold' },
      },
    })
  } else {
    doc.setFontSize(8)
    doc.setTextColor(...muted)
    doc.text('Không có ca dạy tính lương trong kỳ.', margin, y)
    y += 8
  }

  const hasReferralDetail = statement.referral.contractCount > 0 || statement.referral.cashCollectedAmount !== 0 || statement.referral.cashReversedAmount !== 0
  if (hasReferralDetail || statement.adjustments.length) {
    sectionTitle('Khoản khác')
    const otherRows: Array<Array<string>> = []
    if (hasReferralDetail) {
      otherRows.push(
        [`Hoa hồng ${statement.referral.rate || 0}% · ${statement.referral.contractCount} hợp đồng`, money(statement.referral.commissionAmount)],
        ['Dòng tiền tính hoa hồng', money(statement.referral.netCashAmount)],
      )
    }
    statement.adjustments.forEach((adjustment) => otherRows.push([
      `${adjustment.type === 'bonus' ? 'Thưởng' : 'Khấu trừ'} · ${adjustment.reason || 'Điều chỉnh lương'}`,
      `${adjustment.type === 'bonus' ? '+' : '-'}${money(adjustment.amount)}`,
    ]))
    table(otherRows, {
      showHead: 'never',
      columnStyles: { 0: { cellWidth: 138 }, 1: { cellWidth: 44, halign: 'right', fontStyle: 'bold' } },
    })
  }

  if (statement.warnings.length) {
    ensureSpace(13 + statement.warnings.length * 7)
    sectionTitle('Cần kiểm tra')
    doc.setFillColor(255, 247, 235)
    const warningHeight = 8 + statement.warnings.reduce((total, warning) => total + doc.splitTextToSize(`- ${warning}`, contentWidth - 12).length * 4.2, 0)
    doc.roundedRect(margin, y - 2, contentWidth, warningHeight, 3, 3, 'F')
    doc.setFont('Roboto', 'normal')
    doc.setFontSize(8.2)
    doc.setTextColor(137, 84, 24)
    for (const warning of statement.warnings) {
      const lines = doc.splitTextToSize(`• ${warning}`, contentWidth - 12)
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
      doc.text('Phiếu lương', margin, 10)
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
    doc.text(statement.official ? 'Số liệu đã khóa' : 'Số liệu tạm tính', margin, footerY)
    doc.text(statement.reference, pageWidth / 2, footerY, { align: 'center', maxWidth: 72 })
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
