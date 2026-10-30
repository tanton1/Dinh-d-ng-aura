import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Building2, CalendarDays, CircleAlert, Coins, Landmark, RefreshCw, TrendingDown, TrendingUp, WalletCards } from 'lucide-react'
import { useDatabase } from '../../../contexts/DatabaseContext'
import { listBusinessPerformance, type BusinessPerformanceReport, type BusinessSource } from '../../../services/businessReportingService'
import FinanceOverviewAnalytics from './finance-analytics/FinanceOverviewAnalytics'
import AuraMetricCarousel, { type AuraMetricSlide } from './AuraMetricCarousel'
import AuraHelpPopover from './AuraHelpPopover'
import { businessReportCompleteness } from '../../../utils/businessReportCompleteness'
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
  const requestSequence = useRef(0)
  const reportScope = JSON.stringify([branchId, endDate, source, startDate])
  const latestReportScope = useRef(reportScope)
  latestReportScope.current = reportScope

  const load = useCallback(async () => {
    const sequence = ++requestSequence.current
    const isCurrent = () => sequence === requestSequence.current && latestReportScope.current === reportScope
    setLoading(true)
    setError('')
    setReport(null)
    try {
      const next = await listBusinessPerformance({ startDate, endDate, branchId: branchId === 'all' ? undefined : branchId, source })
      if (!isCurrent()) return
      setReport(next)
    } catch (cause) {
      if (!isCurrent()) return
      setReport(null)
      setError(cause instanceof Error ? cause.message : 'Không thể tải báo cáo kết quả kinh doanh.')
    } finally {
      if (isCurrent()) setLoading(false)
    }
  }, [branchId, endDate, reportScope, source, startDate])

  useEffect(() => {
    void load()
    return () => { requestSequence.current += 1 }
  }, [load])

  const complete = businessReportCompleteness(report)
  const incompleteLabel = report ? 'Chưa đủ dữ liệu' : '—'
  const applyPreset = (days: number) => {
    setActivePreset(days as 7 | 30 | 90)
    setStartDate(daysAgoKey(days - 1))
    setEndDate(todayKey())
  }

  const metricSlides = useMemo<AuraMetricSlide[]>(() => [
    {
      id: 'cash-flow',
      eyebrow: 'Dòng tiền ròng',
      value: complete.ledger ? money(report?.cashFlow.cashNet || 0) : incompleteLabel,
      detail: complete.ledger ? `Thu ${money(report?.cashFlow.cashIn || 0)} · Chi ${money(report?.cashFlow.cashOut || 0)}` : 'Chọn khoảng ngày ngắn hơn để tổng hợp đầy đủ',
      icon: <WalletCards size={20} />,
      tone: 'pink',
    },
    {
      id: 'recognised-revenue',
      eyebrow: 'Doanh thu thực hiện',
      value: complete.ledger ? money(report?.managementPnl.recognisedRevenue || 0) : incompleteLabel,
      detail: 'Dịch vụ đủ điều kiện và điều chỉnh đã ghi nhận',
      icon: <TrendingUp size={20} />,
      tone: 'orange',
    },
    {
      id: 'operating-expense',
      eyebrow: 'Chi phí vận hành',
      value: complete.ledger ? money(report?.managementPnl.operatingExpense || 0) : incompleteLabel,
      detail: 'Chi phí đã hạch toán trong kỳ',
      icon: <TrendingDown size={20} />,
      tone: 'sunset',
    },
    {
      id: 'operating-result',
      eyebrow: 'Kết quả vận hành',
      value: complete.ledger ? money(report?.managementPnl.operatingResult || 0) : incompleteLabel,
      detail: complete.ledger ? `Biến động phải thu ${money(report?.balanceMovement.receivableMovement || 0)}` : 'Chưa xác nhận tổng trong phạm vi này',
      icon: <Landmark size={20} />,
      tone: 'ink',
    },
  ], [report, complete.ledger, incompleteLabel])

  const reconciliationIssues: string[] = []
  if (report) {
    const quality = report.dataQuality
    if (!complete.ledger) reconciliationIssues.push('Dữ liệu sổ cái chưa đầy đủ')
    if (!complete.cashReconciliation) reconciliationIssues.push('Chưa kiểm tra đủ liên kết sổ quỹ')
    if (!complete.payrollReconciliation) reconciliationIssues.push('Chưa kiểm tra đủ lương đã trả ngoài sổ')
    if (!complete.attendance) reconciliationIssues.push('Chưa kiểm tra đủ dữ liệu chấm công')
    if (!complete.cashAccounts) reconciliationIssues.push('Chưa kiểm tra đủ tài khoản sổ quỹ')
    if (quality.contractsTruncated) reconciliationIssues.push('Dữ liệu doanh số hợp đồng chưa đầy đủ')
    if (complete.ledger && quality.legacyUnclassifiedEntries > 0) reconciliationIssues.push(quality.legacyUnclassifiedEntries.toLocaleString('vi-VN') + ' bút toán chưa phân loại')
    if (complete.cashReconciliation && ((quality.unlinkedCashTransactionCount || 0) > 0 || quality.unlinkedCashTransactions)) reconciliationIssues.push('Sổ quỹ chưa liên kết: ' + (quality.unlinkedCashTransactionCount === undefined ? money(quality.unlinkedCashTransactions) : quality.unlinkedCashTransactionCount.toLocaleString('vi-VN') + ' giao dịch · ' + money(quality.unlinkedCashTransactions) + ' ròng'))
    if (complete.payrollReconciliation && quality.payrollPaidOutsideLedger) reconciliationIssues.push('Lương đã trả ngoài sổ: ' + money(quality.payrollPaidOutsideLedger))
    if (complete.recognitionReconciliation && quality.reconciliation) {
      const evidence=quality.reconciliation
      if(evidence.unresolved+evidence.conflicts) reconciliationIssues.push((evidence.unresolved+evidence.conflicts).toLocaleString('vi-VN')+' bằng chứng cần xác minh liên kết/kỳ')
      if(evidence.automaticReview+evidence.billingReview+evidence.recognitionReview) reconciliationIssues.push((evidence.automaticReview+evidence.billingReview+evidence.recognitionReview).toLocaleString('vi-VN')+' bằng chứng cần duyệt điều kiện ghi nhận')
    }
    if (quality.missingSourceIntegrations.length) reconciliationIssues.push('Nguồn chờ tích hợp: ' + quality.missingSourceIntegrations.map(item => sourceLabels[item as BusinessSource] || item).join(', '))
    if (report.sales && (quality.contractSalesDatesMissing || 0) > 0) reconciliationIssues.push(quality.contractSalesDatesMissing + ' hợp đồng thiếu ngày doanh số')
    if (report.sales && quality.contractSalesDatesMissing === undefined) reconciliationIssues.push('Chưa có đủ thông tin kiểm tra doanh số')
  }

  const reconciliation = <article className="business-performance__quality business-performance__quality--compact">
      <div className="business-performance__quality-heading"><h2>Đối soát dữ liệu</h2><AuraHelpPopover title="Thông tin đối soát"><p>Đối soát PT theo chi nhánh và khoảng ngày đang chọn. Bộ lọc nguồn chỉ áp dụng cho kết quả kinh doanh. Chưa khớp bút toán trong kỳ chưa đủ để kết luận thiếu doanh thu.</p></AuraHelpPopover></div>
      {reconciliationIssues.length ? <ul className="business-performance__review-list">{reconciliationIssues.map(issue => <li key={issue}>{issue}</li>)}</ul> : <p className="business-performance__review-status">{report ? 'Chưa thấy mục cần đối soát trong dữ liệu hiện có.' : 'Đang chờ dữ liệu đối soát.'}</p>}
      <details className="business-performance__review-details"><summary>Chi tiết đối soát</summary><dl>
        <div><dt>Legacy chưa phân loại</dt><dd>{complete.ledger ? `${report?.dataQuality.legacyUnclassifiedEntries || 0} bút toán` : incompleteLabel}</dd></div>
        <div><dt>Sổ quỹ chưa liên kết</dt><dd>{complete.cashReconciliation ? money(report?.dataQuality.unlinkedCashTransactions || 0) : incompleteLabel}</dd></div>
        <div><dt>Lương đã trả ngoài ledger</dt><dd>{complete.payrollReconciliation ? money(report?.dataQuality.payrollPaidOutsideLedger || 0) : incompleteLabel}</dd></div>
        {report?.dataQuality.reconciliation ? <>
          <div><dt>Bằng chứng PT trong kỳ</dt><dd>{complete.attendance ? report.dataQuality.reconciliation.evidenceCount.toLocaleString('vi-VN') : incompleteLabel}</dd></div>
          <div><dt>Khớp bút toán trong kỳ</dt><dd>{complete.recognitionReconciliation ? report.dataQuality.reconciliation.matchedInPeriod.toLocaleString('vi-VN') : incompleteLabel}</dd></div>
          <div><dt>Chờ xác nhận điểm danh</dt><dd>{complete.attendance ? report.dataQuality.reconciliation.pendingConfirmation.toLocaleString('vi-VN') : incompleteLabel}</dd></div>
          <div><dt>Tự xác nhận · cần duyệt</dt><dd>{complete.attendance ? report.dataQuality.reconciliation.automaticReview.toLocaleString('vi-VN') : incompleteLabel}</dd></div>
          <div><dt>Cần rà soát hạn mức</dt><dd>{complete.attendance ? report.dataQuality.reconciliation.billingReview.toLocaleString('vi-VN') : incompleteLabel}</dd></div>
          <div><dt>Cần rà soát ghi nhận</dt><dd>{complete.attendance ? report.dataQuality.reconciliation.recognitionReview.toLocaleString('vi-VN') : incompleteLabel}</dd></div>
          <div><dt>Miễn tính phí</dt><dd>{complete.attendance ? report.dataQuality.reconciliation.exempt.toLocaleString('vi-VN') : incompleteLabel}</dd></div>
          <div><dt>Chưa xác minh liên kết/kỳ</dt><dd>{complete.recognitionReconciliation ? (report.dataQuality.reconciliation.unresolved + report.dataQuality.reconciliation.conflicts).toLocaleString('vi-VN') : incompleteLabel}</dd></div>
          <div><dt>Chưa gắn chi nhánh</dt><dd>{complete.attendance ? report.dataQuality.reconciliation.missingBranch.toLocaleString('vi-VN') : incompleteLabel}</dd></div>
        </> : <div><dt>Đối soát điểm danh PT</dt><dd>{complete.attendance ? 'Chưa có phân loại chi tiết' : incompleteLabel}</dd></div>}
        <div><dt>Tài khoản sổ quỹ</dt><dd>{complete.cashAccounts ? `${report?.dataQuality.cashAccounts || 0} tài khoản` : incompleteLabel}</dd></div>
        <div><dt>Nguồn chờ tích hợp</dt><dd>{report?.dataQuality.missingSourceIntegrations.length || 0} nguồn</dd></div>
        {report?.sales && <><div><dt>HĐ thiếu ngày doanh số</dt><dd>{report.dataQuality.contractSalesDatesMissing ?? 'Chưa có thông tin'}</dd></div></>}
      </dl></details>
    </article>

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
        <p>Dòng tiền ròng là tiền thu trừ tiền chi. Doanh thu thực hiện gồm buổi đã xác nhận có tính phí và đơn đã giao.</p>
        <p>Buổi vắng được xác nhận có tính phí vẫn ghi nhận doanh thu. Tự động xác nhận sau 48 giờ chưa đủ để ghi nhận.</p>
        <p>Phí và giảm trừ đã được duyệt trong quyết toán cũng ảnh hưởng doanh thu trong kỳ. Doanh số, doanh thu thực hiện và thu khách có thể thuộc các hợp đồng được ký ở những kỳ khác nhau.</p>
        {report?.dataQuality?.message ? <p>{report.dataQuality.message}</p> : null}
      </AuraHelpPopover>
    </section>

    <AuraMetricCarousel slides={metricSlides} label="Các chỉ số kinh doanh" loading={loading} />

    {error && <div className="business-performance__notice business-performance__notice--error"><CircleAlert size={19} /><span>{error}</span></div>}
    {report?.dataQuality.ledgerTruncated && <div role="alert" className="business-performance__notice"><CircleAlert size={19} /><span>Số liệu chưa đầy đủ: khoảng lọc vượt giới hạn tổng hợp. Chọn khoảng ngày ngắn hơn để đối soát.</span></div>}

    {report?.dataQuality.ledgerTruncated ? <div className="business-performance__empty">Biểu đồ và chi tiết theo nguồn sẽ hiện khi khoảng lọc có đủ dữ liệu.</div> : <>
    {report && <FinanceOverviewAnalytics report={report} sourceLabels={sourceLabels} reconciliation={reconciliation} />}

    <details className="business-performance__source-details">
      <summary><span>Chi tiết theo nguồn</span><small>{report?.sourceRows.reduce((total, row) => total + row.entryCount, 0).toLocaleString('vi-VN') ?? '0'} bút toán · bấm để mở</small></summary>
      <div className="business-performance__table" role="table">
        <div className="business-performance__table-head" role="row"><span>Nguồn</span><span>Dòng tiền ròng</span><span>DT thực hiện</span><span>Chi phí</span><span>Kết quả</span></div>
        {loading && !report ? <div className="business-performance__empty">Đang tổng hợp báo cáo…</div> : report?.sourceRows.length ? report.sourceRows.map((row) => <div key={row.source} className="business-performance__table-row" role="row"><strong>{sourceLabels[row.source] || row.source}</strong><span data-label="Dòng tiền ròng">{money(row.cashNet)}</span><span data-label="Doanh thu">{money(row.recognisedRevenue)}</span><span data-label="Chi phí">{money(row.operatingExpense)}</span><b className={row.operatingResult >= 0 ? 'is-positive' : 'is-negative'} data-label="Kết quả">{money(row.operatingResult)}</b></div>) : <div className="business-performance__empty">Chưa có bút toán quản trị phù hợp với bộ lọc.</div>}
      </div>
    </details>

    </>}


    {(!report || report.dataQuality.ledgerTruncated) && reconciliation}


  </section>
}
