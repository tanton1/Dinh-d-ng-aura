import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Building2, CalendarDays, CircleAlert, Coins, RefreshCw } from 'lucide-react'
import { useDatabase } from '../../../contexts/DatabaseContext'
import { listBusinessPerformance, type BusinessPerformanceReport, type BusinessSource } from '../../../services/businessReportingService'
import FinanceReconciliationPanel from './FinanceReconciliationPanel'
import AuraHelpPopover from './AuraHelpPopover'
import { businessReportCompleteness } from '../../../utils/businessReportCompleteness'
import '../../../styles-business-performance.css'

const FinanceOverviewAnalytics = lazy(() => import('./finance-analytics/FinanceOverviewAnalytics'))

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
  const [startDate, setStartDate] = useState(() => daysAgoKey(6))
  const [endDate, setEndDate] = useState(todayKey)
  const [branchId, setBranchId] = useState('all')
  const [source, setSource] = useState<BusinessSource>('all')
  const [report, setReport] = useState<BusinessPerformanceReport | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [activePreset, setActivePreset] = useState<7 | 30 | 90 | 'custom'>(7)
  const [analysisOpen, setAnalysisOpen] = useState(false)
  const [draftStart, setDraftStart] = useState(startDate)
  const [draftEnd, setDraftEnd] = useState(endDate)
  const datePicker = useRef<HTMLDetailsElement>(null)
  const requestSequence = useRef(0)
  const loadedScope = useRef('')
  const [updatedAt, setUpdatedAt] = useState('')
  const reportScope = JSON.stringify([branchId, endDate, source, startDate])
  const latestReportScope = useRef(reportScope)
  latestReportScope.current = reportScope

  const load = useCallback(async () => {
    const sequence = ++requestSequence.current
    const isCurrent = () => sequence === requestSequence.current && latestReportScope.current === reportScope
    setLoading(true)
    setError('')
    if (loadedScope.current !== reportScope) setReport(null)
    try {
      const next = await listBusinessPerformance({ startDate, endDate, branchId: branchId === 'all' ? undefined : branchId, source, includeReconciliationIndex: true })
      if (!isCurrent()) return
      setReport(next)
      loadedScope.current = reportScope
      setUpdatedAt(new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }))
    } catch (cause) {
      if (!isCurrent()) return
      setError(cause instanceof Error ? cause.message : 'Không thể tải báo cáo kết quả kinh doanh.')
    } finally {
      if (isCurrent()) setLoading(false)
    }
  }, [branchId, endDate, reportScope, source, startDate])

  useEffect(() => {
    let active = true
    // A tab closed before effects settle, including StrictMode's replay,
    // must not start a report aggregation that nobody will see.
    queueMicrotask(() => { if (active) void load() })
    return () => { active = false; requestSequence.current += 1 }
  }, [load])

  const complete = businessReportCompleteness(report)
  const incompleteLabel = report ? 'Chưa đủ dữ liệu' : '—'
  const applyPreset = (days: number) => {
    setActivePreset(days as 7 | 30 | 90)
    setStartDate(daysAgoKey(days - 1))
    setEndDate(todayKey())
  }
  const validDraft = Boolean(draftStart && draftEnd && draftStart <= draftEnd && draftEnd <= todayKey())
  const applyDates = () => {
    if (!validDraft) return
    setActivePreset('custom')
    setStartDate(draftStart)
    setEndDate(draftEnd)
    if (datePicker.current) datePicker.current.open = false
  }

  const metricSlides = useMemo(() => [
    {
      id: 'cash-flow',
      eyebrow: 'Dòng tiền ròng',
      value: complete.ledger ? money(report?.cashFlow.cashNet || 0) : incompleteLabel,
      detail: complete.ledger ? `Thu ${money(report?.cashFlow.cashIn || 0)} · Chi ${money(report?.cashFlow.cashOut || 0)}` : 'Chọn khoảng ngày ngắn hơn để tổng hợp đầy đủ',
    },
    {
      id: 'recognised-revenue',
      eyebrow: 'Doanh thu thực hiện',
      value: complete.ledger ? money(report?.managementPnl.recognisedRevenue || 0) : incompleteLabel,
      detail: 'Dịch vụ đủ điều kiện và điều chỉnh đã ghi nhận',
    },
    {
      id: 'operating-expense',
      eyebrow: 'Chi phí vận hành',
      value: complete.ledger ? money(report?.managementPnl.operatingExpense || 0) : incompleteLabel,
      detail: 'Chi phí đã hạch toán trong kỳ',
    },
    {
      id: 'operating-result',
      eyebrow: 'Kết quả vận hành',
      value: complete.ledger ? money(report?.managementPnl.operatingResult || 0) : incompleteLabel,
      detail: complete.ledger ? `Biến động phải thu ${money(report?.balanceMovement.receivableMovement || 0)}` : 'Chưa xác nhận tổng trong phạm vi này',
    },
  ], [report, complete.ledger, incompleteLabel])

  return <section className={`business-performance ${compact ? 'business-performance--compact' : ''}`} aria-busy={loading}>
    <header className="business-performance__report-heading"><h2>Báo cáo kỳ</h2><p>{startDate.split('-').reverse().join('/')} – {endDate.split('-').reverse().join('/')}</p></header>

    <section className="business-performance__toolbar" aria-label="Bộ lọc báo cáo">
      <div className="business-performance__preset-row">
        {[{ label: '7 ngày', days: 7 }, { label: '30 ngày', days: 30 }, { label: '90 ngày', days: 90 }].map((preset) => (
          <button key={preset.days} type="button" className={activePreset === preset.days ? 'is-active' : ''} aria-pressed={activePreset === preset.days} onClick={() => applyPreset(preset.days)}>{preset.label}</button>
        ))}
      </div>
      <label className="business-performance__select"><Building2 size={16} /><select aria-label="Lọc chi nhánh" value={branchId} onChange={(event) => setBranchId(event.target.value)}><option value="all">Toàn hệ thống</option>{branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label>
      <label className="business-performance__select"><Coins size={16} /><select aria-label="Lọc nguồn kinh doanh" value={source} onChange={(event) => setSource(event.target.value as BusinessSource)}>{Object.entries(sourceLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <details ref={datePicker} className="business-performance__date-picker">
        <summary title="Chọn khoảng ngày" onClick={() => {
          if (!datePicker.current?.open) { setDraftStart(startDate); setDraftEnd(endDate) }
        }}><CalendarDays size={16} /><span>{activePreset === 'custom' ? 'Tùy chỉnh' : 'Ngày'}</span></summary>
        <div className="business-performance__date-panel">
          <label><span>Từ ngày</span><input type="date" value={draftStart} max={draftEnd} onChange={event => setDraftStart(event.target.value)} /></label>
          <label><span>Đến ngày</span><input type="date" value={draftEnd} min={draftStart} max={todayKey()} onChange={event => setDraftEnd(event.target.value)} /></label>
          <button type="button" className="business-performance__apply-dates" disabled={!validDraft} onClick={applyDates}>Áp dụng khoảng ngày</button>
        </div>
      </details>
      <button type="button" onClick={() => void load()} className="business-performance__refresh" disabled={loading} aria-label="Làm mới báo cáo" title="Làm mới">
        <RefreshCw size={17} className={loading ? 'is-spinning' : ''} />
      </button>
      <AuraHelpPopover title="Cách đọc báo cáo">
        <p>Dòng tiền ròng là tiền thu trừ tiền chi. Doanh thu thực hiện gồm buổi đã trừ hợp lệ và đơn đã giao.</p>
        <p>Buổi đã trừ ghi nhận doanh thu ngay, kể cả chờ điểm danh hoặc vắng có tính buổi. Hoàn buổi sẽ đảo doanh thu; buổi chuyển tiếp giữ đơn giá hợp đồng gốc.</p>
        <p>Phí và giảm trừ đã được duyệt trong quyết toán cũng ảnh hưởng doanh thu trong kỳ. Doanh số, doanh thu thực hiện và thu khách có thể thuộc các hợp đồng được ký ở những kỳ khác nhau.</p>
        {report?.dataQuality?.message ? <p>{report.dataQuality.message}</p> : null}
      </AuraHelpPopover>
    </section>

    <div className="finance-report-metrics" aria-label="Các chỉ số kinh doanh">{metricSlides.map(item => <article key={item.id}><span>{item.eyebrow}</span><strong>{loading && !report ? 'Đang tải…' : item.value}</strong><small>{item.detail}</small></article>)}</div>
    <p className="finance-report-updated">{loading ? 'Đang cập nhật báo cáo…' : updatedAt ? `Cập nhật lúc ${updatedAt}. Làm mới khi cần xem dữ liệu mới.` : 'Chọn phạm vi để mở báo cáo.'}</p>

    {error && <div className="business-performance__notice business-performance__notice--error"><CircleAlert size={19} /><span>{error}</span></div>}
    {report?.dataQuality.ledgerTruncated && <div role="alert" className="business-performance__notice"><CircleAlert size={19} /><span>Số liệu chưa đầy đủ: khoảng lọc vượt giới hạn tổng hợp. Chọn khoảng ngày ngắn hơn để đối soát.</span></div>}

    {report && <FinanceReconciliationPanel report={report} onChanged={load} />}

    {report?.dataQuality.ledgerTruncated ? <div className="business-performance__empty">Biểu đồ và chi tiết theo nguồn sẽ hiện khi khoảng lọc có đủ dữ liệu.</div> : <>
    {report && <details className="finance-report-analysis" open={analysisOpen} onToggle={event => setAnalysisOpen(event.currentTarget.open)}><summary>Phân tích dòng tiền và kết quả</summary>{analysisOpen && <Suspense fallback={<p role="status">Đang mở phân tích…</p>}><FinanceOverviewAnalytics report={report} sourceLabels={sourceLabels} /></Suspense>}</details>}

    <details className="business-performance__source-details">
      <summary><span>Chi tiết theo nguồn</span><small>{report?.sourceRows.reduce((total, row) => total + row.entryCount, 0).toLocaleString('vi-VN') ?? '0'} bút toán · bấm để mở</small></summary>
      <div className="business-performance__table" role="table">
        <div className="business-performance__table-head" role="row"><span>Nguồn</span><span>Dòng tiền ròng</span><span>DT thực hiện</span><span>Chi phí</span><span>Kết quả</span></div>
        {loading && !report ? <div className="business-performance__empty">Đang tổng hợp báo cáo…</div> : report?.sourceRows.length ? report.sourceRows.map((row) => <div key={row.source} className="business-performance__table-row" role="row"><strong>{sourceLabels[row.source] || row.source}</strong><span data-label="Dòng tiền ròng">{money(row.cashNet)}</span><span data-label="Doanh thu">{money(row.recognisedRevenue)}</span><span data-label="Chi phí">{money(row.operatingExpense)}</span><b className={row.operatingResult >= 0 ? 'is-positive' : 'is-negative'} data-label="Kết quả">{money(row.operatingResult)}</b></div>) : <div className="business-performance__empty">Chưa có bút toán quản trị phù hợp với bộ lọc.</div>}
      </div>
    </details>

    </>}





  </section>
}
