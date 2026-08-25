import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertCircle,
  Banknote,
  CalendarCheck2,
  CheckCircle2,
  CircleDollarSign,
  Dumbbell,
  Gift,
  MessageSquareText,
  RefreshCw,
  Send,
  ShieldCheck,
  WalletCards,
} from 'lucide-react'
import AuraMetricCarousel, { type AuraMetricSlide } from '../../components/admin/pt/AuraMetricCarousel'
import {
  getMyStaffPayroll,
  submitMyPayrollInquiry,
  type MyStaffPayroll,
  type WorkdayDisplayStatus,
} from '../../services/staffPayrollService'
import '../../styles-staff-payroll.css'

const statusMeta: Record<WorkdayDisplayStatus, { short: string; label: string; tone: string }> = {
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

function currentPeriod() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

function money(value: unknown) {
  const parsed = Number(value)
  const safe = Number.isFinite(parsed) ? Math.round(parsed) : 0
  return `${safe.toLocaleString('vi-VN')}đ`
}

function periodLabel(value: string) {
  const matched = /^(\d{4})-(\d{2})$/.exec(value)
  return matched ? `Tháng ${Number(matched[2])}/${matched[1]}` : value
}

function dateLabel(value: string) {
  if (!value) return 'Chưa cập nhật'
  const [year, month, day] = value.slice(0, 10).split('-').map(Number)
  const date = new Date(year, month - 1, day)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('vi-VN')
}

function payrollProfileLabel(value: MyStaffPayroll['compensationPolicy']['payrollProfile'] | undefined) {
  if (value === 'probation') return 'Nhân viên thử việc'
  if (value === 'senior') return 'Nhân viên Senior'
  if (value === 'part_time') return 'Nhân viên Part-time'
  if (value === 'collaborator') return 'Cộng tác viên'
  return 'Nhân viên chính thức'
}

function friendlyError(cause: unknown) {
  const message = cause instanceof Error ? cause.message : ''
  if (/permission|quyền|unauth/i.test(message)) return 'Tài khoản chưa được cấp quyền xem bảng lương cá nhân.'
  if (/internal|unavailable|not found/i.test(message)) return 'Dịch vụ lương đang cập nhật. Hãy tải lại sau ít phút.'
  return message || 'Chưa thể tải dữ liệu lương.'
}

export default function StaffPayrollPage() {
  const [periodId, setPeriodId] = useState(currentPeriod)
  const [data, setData] = useState<MyStaffPayroll | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showInquiry, setShowInquiry] = useState(false)
  const [inquiryCategory, setInquiryCategory] = useState<'attendance' | 'teaching' | 'commission' | 'deduction' | 'other'>('attendance')
  const [inquiryMessage, setInquiryMessage] = useState('')
  const [sending, setSending] = useState(false)
  const [notice, setNotice] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      setData(await getMyStaffPayroll(periodId))
    } catch (cause) {
      setData(null)
      setError(friendlyError(cause))
    } finally {
      setLoading(false)
    }
  }, [periodId])

  useEffect(() => { void load() }, [load])

  const amounts = data?.amounts
  const workdays = data?.workdays
  const slides = useMemo<AuraMetricSlide[]>(() => [
    {
      id: 'take-home', eyebrow: data?.run.official ? 'Thực nhận chính thức' : 'Tạm tính kỳ này',
      value: money(amounts?.finalAmount),
      detail: data?.run.official ? `Kỳ ${periodLabel(periodId)} đã khóa số liệu` : 'Số liệu có thể đổi trước khi kỳ được khóa',
      icon: <WalletCards size={20} />, tone: 'pink',
    },
    {
      id: 'workdays', eyebrow: 'Ngày công hưởng lương',
      value: `${workdays?.estimatedPaidDays || 0}/${workdays?.eligibleWorkdays || 0}`,
      detail: `${workdays?.autoPaidDays || 0} ngày tự tính từ ≥5 ca · ${workdays?.pendingDays || 0} ngày chờ chốt`,
      icon: <CalendarCheck2 size={20} />, tone: 'orange',
    },
    {
      id: 'teaching', eyebrow: 'Ca dạy & hoa hồng',
      value: money((amounts?.teachingPayAmount || 0) + (amounts?.commissionAmount || 0)),
      detail: `${data?.teachingSlots.length || 0} ca dạy · Một khung hai học viên vẫn tính một ca`,
      icon: <Dumbbell size={20} />, tone: 'sunset',
    },
    {
      id: 'status', eyebrow: workdays?.reviewRequired ? 'Cần đối soát' : 'Trạng thái kỳ',
      value: workdays?.reviewRequired ? `${(workdays.pendingDays || 0) + (workdays.benefitReviewDays || 0)} ngày` : data?.run.official ? 'Đã chốt' : 'Tạm tính',
      detail: workdays?.calendarReviewRequired ? 'Lịch công chuẩn chưa được admin duyệt' : workdays?.attendanceReviewRequired ? 'Có ngày công cần admin xác nhận' : 'Không phát hiện ngày công chờ xử lý',
      icon: workdays?.reviewRequired ? <AlertCircle size={20} /> : <ShieldCheck size={20} />, tone: 'ink',
    },
  ], [amounts, data, periodId, workdays])

  const submitInquiry = async () => {
    if (inquiryMessage.trim().length < 10) {
      setNotice('Vui lòng mô tả nội dung cần đối soát từ 10 ký tự.')
      return
    }
    setSending(true)
    setNotice('')
    try {
      await submitMyPayrollInquiry({ periodId, category: inquiryCategory, message: inquiryMessage.trim() })
      setInquiryMessage('')
      setShowInquiry(false)
      setNotice('Đã gửi yêu cầu đối soát đến bộ phận phụ trách lương.')
    } catch (cause) {
      setNotice(friendlyError(cause))
    } finally {
      setSending(false)
    }
  }

  return <main className="staff-payroll" data-testid="staff-payroll-page">
    <section className="staff-payroll__toolbar" aria-label="Bộ lọc kỳ lương">
      <label><span>Kỳ lương</span><input type="month" value={periodId} onChange={(event) => setPeriodId(event.target.value)} /></label>
      <button type="button" aria-label="Tải lại bảng lương" disabled={loading} onClick={() => void load()}><RefreshCw size={18} /></button>
      <button className="is-primary" type="button" onClick={() => setShowInquiry((current) => !current)}><MessageSquareText size={17} /> Đối soát</button>
    </section>

    <AuraMetricCarousel slides={slides} label="Tổng quan bảng lương cá nhân" loading={loading} />

    {error && <section className="staff-payroll__state is-error"><AlertCircle size={21} /><div><strong>Chưa tải được bảng lương</strong><p>{error}</p></div><button type="button" onClick={() => void load()}>Thử lại</button></section>}
    {notice && <section className="staff-payroll__state"><CheckCircle2 size={20} /><p>{notice}</p></section>}
    {data && !data.run.official && <section className="staff-payroll__state is-estimate"><ShieldCheck size={20} /><div><strong>Số liệu đang tạm tính</strong><p>Chỉ số chuyển thành chính thức sau khi admin chốt ngày công và khóa kỳ lương.</p></div></section>}

    {data && <section className="staff-payroll__policy" aria-label="Chính sách thu nhập đang áp dụng">
      <span className="staff-payroll__policy-icon"><ShieldCheck size={21} /></span>
      <div>
        <small>HỒ SƠ & CHÍNH SÁCH THU NHẬP</small>
        <strong>{payrollProfileLabel(data.compensationPolicy.payrollProfile)} · {data.compensationPolicy.name}</strong>
        <p>{data.compensationPolicy.id
          ? `${data.compensationPolicy.assigned ? 'Chính sách được gán trực tiếp trong hồ sơ nhân viên.' : 'Aura đang chọn tự động chính sách mới nhất phù hợp với cấp bậc.'} Hoa hồng và tiền ca bên dưới đã được tạm tính đến thời điểm hiện tại.`
          : 'Hồ sơ chưa có chính sách lương phù hợp. Tiền ca và hoa hồng có thể bằng 0 cho đến khi quản lý hoàn tất thiết lập.'}</p>
      </div>
      <span className={`staff-payroll__policy-status ${data.compensationPolicy.id ? 'is-ready' : 'is-missing'}`}>{data.compensationPolicy.id ? 'Đang áp dụng' : 'Cần thiết lập'}</span>
    </section>}

    {showInquiry && <section className="staff-payroll__inquiry">
      <header><div><span>Gửi phản hồi</span><strong>Yêu cầu đối soát kỳ {periodLabel(periodId)}</strong></div></header>
      <div className="staff-payroll__inquiry-fields">
        <label><span>Nhóm cần kiểm tra</span><select value={inquiryCategory} onChange={(event) => setInquiryCategory(event.target.value as typeof inquiryCategory)}><option value="attendance">Ngày công</option><option value="teaching">Ca dạy</option><option value="commission">Hoa hồng</option><option value="deduction">Khấu trừ</option><option value="other">Khác</option></select></label>
        <label className="is-wide"><span>Nội dung</span><textarea value={inquiryMessage} maxLength={1000} rows={3} placeholder="Ghi rõ ngày hoặc ca dạy cần kiểm tra…" onChange={(event) => setInquiryMessage(event.target.value)} /></label>
        <button type="button" disabled={sending || inquiryMessage.trim().length < 10} onClick={() => void submitInquiry()}><Send size={16} /> {sending ? 'Đang gửi…' : 'Gửi đối soát'}</button>
      </div>
    </section>}

    <section className="staff-payroll__breakdown" aria-label="Chi tiết thu nhập">
      <div className="staff-payroll__section-title"><div><span>Cấu phần lương</span><strong>{periodLabel(periodId)}</strong></div><small>{data?.run.official ? 'Số liệu chính thức' : 'Số liệu tạm tính'}</small></div>
      <div className="staff-payroll__money-grid">
        <article><span className="is-pink"><Banknote size={18} /></span><div><small>{workdays?.employmentType === 'collaborator' ? 'CTV · không lương cơ bản' : 'Lương cơ bản theo công'}</small><strong>{money(amounts?.baseSalaryAmount)}</strong><p>{workdays?.employmentType === 'collaborator' ? 'Thu nhập theo chính sách ca dạy CTV' : `${workdays?.estimatedPaidDays || 0}/${workdays?.eligibleWorkdays || 0} ngày đủ điều kiện`}</p></div></article>
        <article><span className="is-orange"><Dumbbell size={18} /></span><div><small>Tiền ca dạy</small><strong>{money(amounts?.teachingPayAmount)}</strong><p>{data?.teachingSlots.length || 0} ca đã ghi nhận</p></div></article>
        <article><span className="is-sunset"><CircleDollarSign size={18} /></span><div><small>Hoa hồng tạm tính</small><strong>{money(amounts?.commissionAmount)}</strong><p>{data?.run.official ? 'Đã khóa theo kỳ lương' : 'Cập nhật theo ca và chính sách hiện tại'}</p></div></article>
        <article><span className="is-ink"><Gift size={18} /></span><div><small>Thưởng & điều chỉnh</small><strong>{money((amounts?.bonusAmount || 0) + (amounts?.adjustmentAmount || 0))}</strong><p>Khấu trừ {money(amounts?.deductionAmount)}</p></div></article>
      </div>
      <footer><span>Tổng thực nhận</span><strong>{money(amounts?.finalAmount)}</strong></footer>
    </section>

    <section className="staff-payroll__calendar" aria-label="Lịch ngày công">
      <div className="staff-payroll__section-title"><div><span>Ngày công</span><strong>{workdays?.paidDays || 0} ngày đã chốt</strong></div><small>{workdays?.employmentType === 'collaborator' ? 'CTV không áp dụng lương cơ bản theo công' : `${workdays?.autoPaidDays || 0} ngày tự tính từ ca dạy`}</small></div>
      <div className="staff-payroll__weekday"><span>T2</span><span>T3</span><span>T4</span><span>T5</span><span>T6</span><span>T7</span><span>CN</span></div>
      <div className="staff-payroll__days">
        {Array.from({ length: data?.workdays.days[0] ? (data.workdays.days[0].weekday + 6) % 7 : 0 }, (_, index) => <i key={`empty-${index}`} aria-hidden="true" />)}
        {data?.workdays.days.map((day) => {
          const meta = statusMeta[day.status]
          return <article className={`is-${meta.tone}`} key={day.date} title={`${dateLabel(day.date)} · ${meta.label}${day.note ? ` · ${day.note}` : ''}`}>
            <time>{Number(day.date.slice(-2))}</time><b>{meta.short}</b>
          </article>
        })}
      </div>
      <div className="staff-payroll__legend"><span className="is-paid">Đủ công</span><span className="is-review">Chờ duyệt</span><span className="is-unpaid">Không lương</span><span className="is-rest">Nghỉ/Lễ</span></div>
    </section>

    <section className="staff-payroll__teaching" aria-label="Chi tiết ca dạy">
      <div className="staff-payroll__section-title"><div><span>Ca dạy PT</span><strong>{data?.teachingSlots.length || 0} ca</strong></div><small>Hai học viên cùng giờ chỉ tính một ca</small></div>
      {data?.teachingSlots.length ? <div className="staff-payroll__teaching-list">{data.teachingSlots.map((slot) => <article key={slot.key}>
        <time>{dateLabel(slot.date)}<b>{String(slot.hour).padStart(2, '0')}:00</b></time>
        <div><strong>{slot.studentCount} học viên</strong><span>{slot.policyName || 'Chính sách kỳ lương'} · ca thứ {slot.dailyPosition}</span></div>
        <em>{money(slot.rate)}</em>
      </article>)}</div> : <div className="staff-payroll__empty"><Dumbbell size={28} /><strong>Chưa có ca dạy được ghi nhận</strong><p>Ca dạy chỉ xuất hiện sau khi điểm danh hợp lệ.</p></div>}
    </section>
  </main>
}
