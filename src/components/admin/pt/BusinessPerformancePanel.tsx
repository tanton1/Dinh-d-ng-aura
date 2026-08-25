import { useCallback, useEffect, useMemo, useState } from 'react'
import { Building2, CalendarDays, CircleAlert, Coins, Landmark, RefreshCw, TrendingDown, TrendingUp, WalletCards } from 'lucide-react'
import { useDatabase } from '../../../contexts/DatabaseContext'
import { listBusinessPerformance, type BusinessPerformanceReport, type BusinessSource } from '../../../services/businessReportingService'
import AuraMetricCarousel, { type AuraMetricSlide } from './AuraMetricCarousel'
import AuraHelpPopover from './AuraHelpPopover'
import '../../../styles-business-performance.css'

function vietnamDateKey(value = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(value)
  const part = (type: string) => parts.find((item) => item.type === type)?.value || ''
  return `${part('year')}-${part('month')}-${part('day')}`
}

function todayKey() {
  return vietnamDateKey()
}

function daysAgoKey(days: number) {
  const date = new Date()
  date.setDate(date.getDate() - days)
  return vietnamDateKey(date)
}

function money(value: number) {
  return `${Math.round(value || 0).toLocaleString('vi-VN')}đ`
}

const sourceLabels: Record<BusinessSource, string> = {
  all: 'Tất cả nguồn',
  pt_gym: 'PT Gym',
  online_coaching: 'Coaching online',
  nutrition_coaching: 'Dinh dưỡng',
  academy: 'Aura Academy',
  eat_clean: 'Eat Clean',
  delivery_fee: 'Phí giao hàng',
  payroll: 'Lương & hoa hồng',
  other: 'Khác',
  legacy_unclassified: 'Legacy chưa phân loại',
}

type Props = { compact?: boolean }

export default function BusinessPerformancePanel({ compact = false }: Props) {
  const { branches } = useDatabase()
  const [startDate, setStartDate] = useState(() => daysAgoKey(29))
  const [endDate, setEndDate] = useState(todayKey)
  const [branchId, setBranchId] = useState('all')
  const [source, setSource] = useState<BusinessSource>('all')
  const [report, setReport] = useState<BusinessPerformanceReport | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [activePreset, setActivePreset] = useState<7 | 30 | 90 | 'custom'>(30)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const next = await listBusinessPerformance({ startDate, endDate, branchId: branchId === 'all' ? undefined : branchId, source })
      setReport(next)
    } catch (cause) {
      setReport(null)
      setError(cause instanceof Error ? cause.message : 'Không thể tải báo cáo kết quả kinh doanh.')
    } finally {
      setLoading(false)
    }
  }, [branchId, endDate, source, startDate])

  useEffect(() => { void load() }, [load])

  const days = useMemo(() => report?.dailySeries.slice(-14) || [], [report])
  const peak = Math.max(1, ...days.map((item) => Math.max(Math.abs(item.cashNet), Math.abs(item.recognisedRevenue), Math.abs(item.operatingResult))))
  const applyPreset = (days: number) => {
    setActivePreset(days as 7 | 30 | 90)
    setStartDate(daysAgoKey(days - 1))
    setEndDate(todayKey())
  }

  const metricSlides = useMemo<AuraMetricSlide[]>(() => [
    {
      id: 'cash-flow',
      eyebrow: 'Dòng tiền ròng',
      value: money(report?.cashFlow.cashNet || 0),
      detail: `Thu ${money(report?.cashFlow.cashIn || 0)} · Chi ${money(report?.cashFlow.cashOut || 0)}`,
      icon: <WalletCards size={20} />,
      tone: 'pink',
    },
    {
      id: 'recognised-revenue',
      eyebrow: 'Doanh thu thực hiện',
      value: money(report?.managementPnl.recognisedRevenue || 0),
      detail: 'Chỉ ghi nhận dịch vụ đã hoàn thành',
      icon: <TrendingUp size={20} />,
      tone: 'orange',
    },
    {
      id: 'operating-expense',
      eyebrow: 'Chi phí vận hành',
      value: money(report?.managementPnl.operatingExpense || 0),
      detail: 'Chi phí đã hạch toán trong kỳ',
      icon: <TrendingDown size={20} />,
      tone: 'sunset',
    },
    {
      id: 'operating-result',
      eyebrow: 'Kết quả vận hành',
      value: money(report?.managementPnl.operatingResult || 0),
      detail: `Biến động phải thu ${money(report?.balanceMovement.receivableMovement || 0)}`,
      icon: <Landmark size={20} />,
      tone: 'ink',
    },
  ], [report])

  return <section className={`business-performance ${compact ? 'business-performance--compact' : ''}`} aria-busy={loading}>
    <AuraMetricCarousel slides={metricSlides} label="Các chỉ số kinh doanh" loading={loading} />

    <section className="business-performance__toolbar" aria-label="Bộ lọc báo cáo">
      <div className="business-performance__preset-row">
        {[{ label: '7 ngày', days: 7 }, { label: '30 ngày', days: 30 }, { label: '90 ngày', days: 90 }].map((preset) => (
          <button key={preset.days} type="button" className={activePreset === preset.days ? 'is-active' : ''} aria-pressed={activePreset === preset.days} onClick={() => applyPreset(preset.days)}>{preset.label}</button>
        ))}
      </div>
      <label className="business-performance__select"><Building2 size={16} /><select aria-label="Lọc chi nhánh" value={branchId} onChange={(event) => setBranchId(event.target.value)}><option value="all">Toàn hệ thống</option>{branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label>
      <label className="business-performance__select"><Coins size={16} /><select aria-label="Lọc nguồn kinh doanh" value={source} onChange={(event) => setSource(event.target.value as BusinessSource)}>{Object.entries(sourceLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <details className="business-performance__date-picker">
        <summary title="Chọn khoảng ngày"><CalendarDays size={16} /><span>{activePreset === 'custom' ? 'Tùy chỉnh' : 'Ngày'}</span></summary>
        <div className="business-performance__date-panel">
          <label><span>Từ ngày</span><input type="date" value={startDate} max={endDate} onChange={(event) => { setActivePreset('custom'); setStartDate(event.target.value) }} /></label>
          <label><span>Đến ngày</span><input type="date" value={endDate} min={startDate} max={todayKey()} onChange={(event) => { setActivePreset('custom'); setEndDate(event.target.value) }} /></label>
        </div>
      </details>
      <button type="button" onClick={() => void load()} className="business-performance__refresh" disabled={loading} aria-label="Làm mới báo cáo" title="Làm mới">
        <RefreshCw size={17} className={loading ? 'is-spinning' : ''} />
      </button>
      <AuraHelpPopover title="Cách đọc báo cáo">
        <p>Dòng tiền là số tiền thực thu/chi; doanh thu chỉ ghi nhận phần dịch vụ đã hoàn thành.</p>
        {report?.dataQuality?.message ? <p>{report.dataQuality.message}</p> : null}
      </AuraHelpPopover>
    </section>

    {error && <div className="business-performance__notice business-performance__notice--error"><CircleAlert size={19} /><span>{error}</span></div>}

    <div className="business-performance__grid">
      <article className="business-performance__card business-performance__card--trend business-performance__card--wide">
        <div className="business-performance__card-heading"><div><h2>Xu hướng 14 ngày</h2></div></div>
        {days.length ? <div className="business-performance__bars">{days.map((item) => <div className="business-performance__bar-column" key={item.date}><div className="business-performance__bars-stack" title={`${item.date}: dòng tiền ${money(item.cashNet)}, kết quả ${money(item.operatingResult)}`}><i className="business-performance__bar business-performance__bar--cash" style={{ height: `${Math.max(5, Math.round(Math.abs(item.cashNet) / peak * 100))}%` }} /><i className="business-performance__bar business-performance__bar--profit" style={{ height: `${Math.max(5, Math.round(Math.abs(item.operatingResult) / peak * 100))}%` }} /></div><small>{item.date.slice(8)}</small></div>)}</div> : <div className="business-performance__empty">Khi có bút toán quản trị, xu hướng ngày sẽ hiện ở đây.</div>}
      </article>
    </div>

    <details className="business-performance__source-details">
      <summary><span>Chi tiết theo nguồn</span><small>{report?.sourceRows.reduce((total, row) => total + row.entryCount, 0).toLocaleString('vi-VN') ?? '0'} bút toán · bấm để mở</small></summary>
      <div className="business-performance__table" role="table">
        <div className="business-performance__table-head" role="row"><span>Nguồn</span><span>Thu tiền</span><span>DT thực hiện</span><span>Chi phí</span><span>Kết quả</span></div>
        {loading && !report ? <div className="business-performance__empty">Đang tổng hợp báo cáo…</div> : report?.sourceRows.length ? report.sourceRows.map((row) => <div key={row.source} className="business-performance__table-row" role="row"><strong>{sourceLabels[row.source] || row.source}</strong><span data-label="Thu tiền">{money(row.cashNet)}</span><span data-label="Doanh thu">{money(row.recognisedRevenue)}</span><span data-label="Chi phí">{money(row.operatingExpense)}</span><b className={row.operatingResult >= 0 ? 'is-positive' : 'is-negative'} data-label="Kết quả">{money(row.operatingResult)}</b></div>) : <div className="business-performance__empty">Chưa có bút toán quản trị phù hợp với bộ lọc.</div>}
      </div>
    </details>

    <article className="business-performance__quality">
      <div className="business-performance__quality-heading"><h2>Đối soát dữ liệu</h2><AuraHelpPopover title="Thông tin đối soát"><p>Các mục này giúp phát hiện dữ liệu cũ hoặc nguồn chưa liên kết; chúng không tự được cộng vào kết quả kinh doanh.</p></AuraHelpPopover></div>
      <dl>
        <div><dt>Legacy chưa phân loại</dt><dd>{report?.dataQuality.legacyUnclassifiedEntries || 0} bút toán</dd></div>
        <div><dt>Sổ quỹ chưa liên kết</dt><dd>{money(report?.dataQuality.unlinkedCashTransactions || 0)}</dd></div>
        <div><dt>Lương đã trả ngoài ledger</dt><dd>{money(report?.dataQuality.payrollPaidOutsideLedger || 0)}</dd></div>
        <div><dt>Buổi đã chấm công</dt><dd>{(report?.dataQuality.attendanceEvents || 0).toLocaleString('vi-VN')} buổi</dd></div>
        <div><dt>Đã ghi nhận doanh thu</dt><dd>{(report?.dataQuality.recognisedAttendanceEvents || 0).toLocaleString('vi-VN')} buổi</dd></div>
        <div><dt>Chờ đối soát doanh thu</dt><dd>{(report?.dataQuality.unrecognisedAttendanceEvents || 0).toLocaleString('vi-VN')} buổi</dd></div>
        <div><dt>Tài khoản sổ quỹ</dt><dd>{report?.dataQuality.cashAccounts || 0} tài khoản</dd></div>
        <div><dt>Nguồn chờ tích hợp</dt><dd>{report?.dataQuality.missingSourceIntegrations.length || 0} nguồn</dd></div>
      </dl>
      {report?.dataQuality.missingSourceIntegrations.length ? <p>Nguồn chờ tích hợp: {report.dataQuality.missingSourceIntegrations.map((item) => sourceLabels[item as BusinessSource] || item).join(', ')}.</p> : null}
    </article>
  </section>
}
