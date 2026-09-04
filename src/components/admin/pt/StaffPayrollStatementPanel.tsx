import { useMemo, useState } from 'react'
import {
  AlertCircle,
  ArrowLeft,
  Banknote,
  CalendarCheck2,
  CheckCircle2,
  CircleDollarSign,
  Dumbbell,
  Gift,
  RefreshCw,
  ShieldCheck,
  UserRound,
  WalletCards,
} from 'lucide-react'
import type {
  MyStaffPayroll,
  StaffTeachingSlot,
  WorkdayDisplayStatus,
} from '../../../services/staffPayrollService'
import AuraMetricCarousel, { type AuraMetricSlide } from './AuraMetricCarousel'
import '../../../styles-staff-payroll.css'

interface Props {
  data: MyStaffPayroll | null
  periodId: string
  loading: boolean
  error: string
  onBack: () => void
  onRetry: () => void
}

type TeachingFilter = 'all' | StaffTeachingSlot['tier']

const workdayStatus: Record<WorkdayDisplayStatus, { short: string; label: string; tone: string }> = {
  auto_present_teaching: { short: 'TC', label: 'Tự tính đủ công từ ca dạy', tone: 'paid' },
  present: { short: 'Đủ', label: 'Có mặt', tone: 'paid' },
  remote: { short: 'Xa', label: 'Làm từ xa', tone: 'paid' },
  business_trip: { short: 'CT', label: 'Công tác', tone: 'paid' },
  training: { short: 'ĐT', label: 'Đào tạo', tone: 'paid' },
  paid_leave: { short: 'P', label: 'Nghỉ phép có lương', tone: 'paid' },
  unpaid_leave: { short: 'K', label: 'Nghỉ không lương', tone: 'unpaid' },
  unexcused_absence: { short: 'V', label: 'Vắng không phép', tone: 'unpaid' },
  sick_leave: { short: 'Ô', label: 'Nghỉ ốm cần duyệt', tone: 'review' },
  maternity_leave: { short: 'TS', label: 'Nghỉ thai sản cần duyệt', tone: 'review' },
  pending: { short: '?', label: 'Chưa chốt công', tone: 'review' },
  weekly_rest: { short: 'CN', label: 'Nghỉ hằng tuần', tone: 'rest' },
  paid_holiday: { short: 'L', label: 'Nghỉ lễ', tone: 'holiday' },
  outside_employment: { short: '–', label: 'Ngoài thời gian làm việc', tone: 'muted' },
  upcoming: { short: '·', label: 'Chưa đến ngày làm việc', tone: 'upcoming' },
}

function money(value: unknown) {
  const parsed = Number(value)
  return `${Math.round(Number.isFinite(parsed) ? parsed : 0).toLocaleString('vi-VN')}đ`
}

function periodLabel(value: string) {
  const match = /^(\d{4})-(\d{2})$/.exec(value)
  return match ? `Tháng ${Number(match[2])}/${match[1]}` : value
}

function dateLabel(value: string) {
  if (!value) return 'Chưa cập nhật'
  const [year, month, day] = value.slice(0, 10).split('-').map(Number)
  const date = new Date(year, month - 1, day)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('vi-VN')
}

function profileLabel(data: MyStaffPayroll) {
  if (data.workdays.employmentType === 'collaborator') return 'Cộng tác viên'
  if (data.workdays.employmentType === 'part_time') return 'Nhân viên Part-time'
  if (data.workdays.employmentLevel === 'probation') return 'Nhân viên thử việc'
  if (data.workdays.employmentLevel === 'senior') return 'Nhân viên Senior'
  return 'Nhân viên chính thức'
}

function tierLabel(tier: StaffTeachingSlot['tier']) {
  if (tier === 'after_threshold_evening') return 'Tăng ca tối'
  if (tier === 'after_threshold') return 'Từ ca thứ 9'
  return 'Ca tiêu chuẩn'
}

export default function StaffPayrollStatementPanel({ data, periodId, loading, error, onBack, onRetry }: Props) {
  const [teachingFilter, setTeachingFilter] = useState<TeachingFilter>('all')
  const filteredTeaching = useMemo(() => data?.teachingSlots.filter((slot) => teachingFilter === 'all' || slot.tier === teachingFilter) || [], [data, teachingFilter])
  const referralGroups = useMemo(() => {
    const groups = new Map<string, { contractId: string; cashImpact: number; commissionImpact: number; rate: number; count: number }>()
    data?.referralCommission.evidence.forEach((entry) => {
      const key = entry.contractId || 'unlinked'
      const current = groups.get(key) || { contractId: entry.contractId, cashImpact: 0, commissionImpact: 0, rate: entry.rate, count: 0 }
      current.cashImpact += entry.cashImpact
      current.commissionImpact += entry.commissionImpact
      current.count += 1
      groups.set(key, current)
    })
    return [...groups.values()].sort((left, right) => right.commissionImpact - left.commissionImpact)
  }, [data])

  const amounts = data?.amounts
  const workdays = data?.workdays
  const slides = useMemo<AuraMetricSlide[]>(() => [
    {
      id: 'total', eyebrow: data?.run.official ? 'Thực nhận chính thức' : 'Dự tính toàn kỳ',
      value: money(amounts?.finalAmount),
      detail: data?.run.official ? `${periodLabel(periodId)} đã khóa số liệu` : 'Số liệu thay đổi đến khi kỳ lương được khóa',
      icon: <WalletCards size={20} />, tone: 'pink',
    },
    {
      id: 'workdays', eyebrow: 'Dự tính công toàn kỳ', value: `${workdays?.estimatedPaidDays || 0}/${workdays?.eligibleWorkdays || 0}`,
      detail: `${workdays?.paidDays || 0} ngày đã ghi nhận · ${workdays?.autoPaidDays || 0} ngày tự tính · ${workdays?.pendingDays || 0} ngày chờ chốt`,
      icon: <CalendarCheck2 size={20} />, tone: 'orange',
    },
    {
      id: 'teaching', eyebrow: 'Tiền ca dạy', value: money(amounts?.teachingPayAmount),
      detail: `${data?.teachingSlots.length || 0} ca · hai học viên cùng giờ vẫn tính một ca`,
      icon: <Dumbbell size={20} />, tone: 'sunset',
    },
    {
      id: 'commission', eyebrow: 'Hoa hồng giới thiệu', value: money(amounts?.commissionAmount),
      detail: `${data?.referralCommission.rate || 0}% trên ${money(data?.referralCommission.netCashAmount)} thực thu`,
      icon: <CircleDollarSign size={20} />, tone: 'pink',
    },
    {
      id: 'review', eyebrow: workdays?.reviewRequired ? 'Cần đối soát' : 'Hồ sơ đã khớp',
      value: workdays?.reviewRequired ? `${(workdays.pendingDays || 0) + (workdays.benefitReviewDays || 0)} ngày` : 'Sẵn sàng',
      detail: workdays?.calendarReviewRequired ? 'Lịch chuẩn chưa được duyệt' : workdays?.attendanceReviewRequired ? 'Ngày công còn thiếu hoặc cần xác minh' : 'Không phát hiện dữ liệu chờ xử lý',
      icon: workdays?.reviewRequired ? <AlertCircle size={20} /> : <ShieldCheck size={20} />, tone: 'ink',
    },
  ], [amounts, data, periodId, workdays])

  return <main className="staff-payroll staff-payroll--admin-statement" data-testid="admin-staff-payroll-statement">
    <header className="staff-payroll__statement-head">
      <button type="button" onClick={onBack}><ArrowLeft size={19} /> Danh sách lương</button>
      <div><small>SAO KÊ NHÂN VIÊN · {periodLabel(periodId).toUpperCase()}</small><strong>{data?.identity.name || 'Đang tải hồ sơ…'}</strong><span>{data ? `${data.identity.employeeCode || 'Chưa có mã NV'} · ${profileLabel(data)}` : 'Đang đối chiếu dữ liệu lương'}</span></div>
      <em className={data?.run.official ? 'is-official' : ''}>{data?.run.official ? 'Chính thức' : 'Tạm tính'}</em>
    </header>

    {error && <section className="staff-payroll__state is-error"><AlertCircle size={21} /><div><strong>Chưa tải được sao kê</strong><p>{error}</p></div><button type="button" onClick={onRetry}><RefreshCw size={15} /> Thử lại</button></section>}
    <AuraMetricCarousel slides={slides} label={`Bảng lương ${data?.identity.name || 'nhân viên'}`} loading={loading} />

    {data && <>
      {!data.run.official && <section className="staff-payroll__state is-estimate"><ShieldCheck size={20} /><div><strong>Sao kê đang tạm tính</strong><p>Ngày công, ca dạy và dòng tiền hoa hồng vẫn có thể thay đổi trước khi khóa kỳ.</p></div></section>}

      <section className="staff-payroll__policy" aria-label="Hồ sơ và chính sách lương">
        <span className="staff-payroll__policy-icon"><UserRound size={21} /></span>
        <div><small>HỒ SƠ & CHÍNH SÁCH THU NHẬP</small><strong>{profileLabel(data)} · {data.compensationPolicy.name}</strong><p>{data.compensationPolicy.id ? 'Tiền ca lấy theo chính sách được gán; hoa hồng lấy riêng từ dòng tiền hợp đồng có mã giới thiệu.' : 'Chưa có chính sách tiền ca phù hợp. Kỳ lương cần được đối soát trước khi duyệt.'}</p></div>
        <span className={`staff-payroll__policy-status ${data.compensationPolicy.id ? 'is-ready' : 'is-missing'}`}>{data.compensationPolicy.id ? 'Đang áp dụng' : 'Thiếu chính sách'}</span>
      </section>

      <section className="staff-payroll__breakdown" aria-label="Cấu phần lương nhân viên">
        <div className="staff-payroll__section-title"><div><span>Cấu phần lương</span><strong>{periodLabel(periodId)}</strong></div><small>{data.run.official ? 'Snapshot chính thức' : 'Dữ liệu tạm tính'}</small></div>
        <div className="staff-payroll__money-grid">
          <article><span className="is-pink"><Banknote size={18} /></span><div><small>{data.run.official ? 'Lương cơ bản theo công' : 'Lương cơ bản dự tính toàn kỳ'}</small><strong>{money(amounts?.baseSalaryAmount)}</strong><p>{workdays?.employmentType === 'collaborator' ? 'CTV không áp dụng lương cơ bản' : `${workdays?.paidDays || 0} ngày đã ghi nhận · ${workdays?.estimatedPaidDays || 0}/${workdays?.eligibleWorkdays || 0} ngày dự tính`}</p></div></article>
          <article><span className="is-orange"><Dumbbell size={18} /></span><div><small>Tiền ca dạy</small><strong>{money(amounts?.teachingPayAmount)}</strong><p>{data.teachingSlots.length} ca đã ghi nhận</p></div></article>
          <article><span className="is-sunset"><CircleDollarSign size={18} /></span><div><small>Hoa hồng giới thiệu</small><strong>{money(amounts?.commissionAmount)}</strong><p>{data.referralCommission.contractCount} hợp đồng · {data.referralCommission.rate || 0}% thực thu</p></div></article>
          <article><span className="is-ink"><Gift size={18} /></span><div><small>Thưởng & điều chỉnh</small><strong>{money((amounts?.bonusAmount || 0) + (amounts?.adjustmentAmount || 0))}</strong><p>Khấu trừ {money(amounts?.deductionAmount)}</p></div></article>
        </div>
        <footer><span>{data.run.official ? 'Tổng thực nhận' : 'Tổng dự tính toàn kỳ'}</span><strong>{money(amounts?.finalAmount)}</strong></footer>
      </section>

      <section className="staff-payroll__calendar" aria-label="Chi tiết ngày công nhân viên">
        <div className="staff-payroll__section-title"><div><span>Ngày công đã ghi nhận</span><strong>{workdays?.paidDays || 0}/{workdays?.eligibleWorkdays || 0} ngày</strong></div><small>Dự tính toàn kỳ {workdays?.estimatedPaidDays || 0}/{workdays?.eligibleWorkdays || 0} · {workdays?.autoPaidDays || 0} ngày tự tính từ ≥5 ca</small></div>
        <div className="staff-payroll__weekday"><span>T2</span><span>T3</span><span>T4</span><span>T5</span><span>T6</span><span>T7</span><span>CN</span></div>
        <div className="staff-payroll__days">
          {Array.from({ length: workdays?.days[0] ? (workdays.days[0].weekday + 6) % 7 : 0 }, (_, index) => <i key={`empty-${index}`} aria-hidden="true" />)}
          {workdays?.days.map((day) => { const meta = workdayStatus[day.status]; return <article className={`is-${meta.tone}`} key={day.date} title={`${dateLabel(day.date)} · ${meta.label}`}><time>{Number(day.date.slice(-2))}</time><b>{meta.short}</b></article> })}
        </div>
        <div className="staff-payroll__legend"><span className="is-paid">Đủ công</span><span className="is-review">Chờ duyệt</span><span className="is-unpaid">Không lương</span><span className="is-rest">Nghỉ/Lễ</span></div>
      </section>

      <section className="staff-payroll__teaching" aria-label="Chi tiết ca dạy nhân viên">
        <div className="staff-payroll__section-title"><div><span>Ca dạy PT</span><strong>{filteredTeaching.length}/{data.teachingSlots.length} ca</strong></div><small>Hai học viên cùng giờ chỉ tính một ca</small></div>
        <div className="staff-payroll__segmented" role="group" aria-label="Lọc loại ca dạy">
          {([['all', 'Tất cả'], ['standard', 'Ca 1–8'], ['after_threshold', 'Từ ca 9'], ['after_threshold_evening', 'Ca tối']] as const).map(([id, label]) => <button type="button" className={teachingFilter === id ? 'is-active' : ''} onClick={() => setTeachingFilter(id)} key={id}>{label}</button>)}
        </div>
        {filteredTeaching.length ? <div className="staff-payroll__teaching-list">{filteredTeaching.map((slot) => <article key={slot.key}><time>{dateLabel(slot.date)}<b>{String(slot.hour).padStart(2, '0')}:00</b></time><div><strong>{slot.studentCount} học viên · {tierLabel(slot.tier)}</strong><span>{slot.policyName || 'Chính sách kỳ lương'} · ca thứ {slot.dailyPosition}</span></div><em>{money(slot.rate)}</em></article>)}</div> : <div className="staff-payroll__empty"><Dumbbell size={27} /><strong>Không có ca thuộc bộ lọc</strong><p>Ca chỉ được tính sau khi điểm danh hợp lệ.</p></div>}
      </section>

      <section className="staff-payroll__referrals" aria-label="Đối soát hoa hồng giới thiệu">
        <div className="staff-payroll__section-title"><div><span>Hoa hồng giới thiệu</span><strong>{money(data.referralCommission.commissionAmount)}</strong></div><small>{data.referralCommission.rate || 0}% trên {money(data.referralCommission.netCashAmount)} thực thu</small></div>
        <div className="staff-payroll__referral-summary"><span>Đã thu <b>{money(data.referralCommission.cashCollectedAmount)}</b></span><span>Hoàn/đảo <b>-{money(data.referralCommission.cashReversedAmount)}</b></span><span>Hợp đồng <b>{data.referralCommission.contractCount}</b></span></div>
        {referralGroups.length ? <div className="staff-payroll__referral-list">{referralGroups.map((group) => <article key={group.contractId || 'unlinked'}><span><strong>Hợp đồng {group.contractId ? group.contractId.slice(0, 12) : 'chưa liên kết'}</strong><small>{group.count} giao dịch · tỷ lệ {group.rate}%</small></span><span><small>Dòng tiền tính HH</small><b>{money(group.cashImpact)}</b></span><em className={group.commissionImpact < 0 ? 'is-negative' : ''}>{money(group.commissionImpact)}</em></article>)}</div> : <div className="staff-payroll__empty"><CircleDollarSign size={27} /><strong>Chưa có hoa hồng trong kỳ</strong><p>Chỉ ghi nhận hợp đồng có mã giới thiệu và dòng tiền đã vào ledger.</p></div>}
        {(data.referralCommission.unresolvedEntryCount > 0 || data.referralCommission.ambiguousCodeEntryCount > 0 || data.referralCommission.invalidRateEntryCount > 0) && <p className="staff-payroll__reconcile-warning"><AlertCircle size={16} /> Có {data.referralCommission.unresolvedEntryCount + data.referralCommission.ambiguousCodeEntryCount + data.referralCommission.invalidRateEntryCount} giao dịch cần kiểm tra mã PT hoặc tỷ lệ hoa hồng.</p>}
      </section>
    </>}
  </main>
}
