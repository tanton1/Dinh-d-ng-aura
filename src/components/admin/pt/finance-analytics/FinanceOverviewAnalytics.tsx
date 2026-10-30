import type { ReactNode } from 'react'
import AuraHelpPopover from '../AuraHelpPopover'
import type { BusinessPerformanceReport, BusinessSource } from '../../../../services/businessReportingService'
import { businessReportCompleteness } from '../../../../utils/businessReportCompleteness'
import FinanceTrendChart, { revenueComparisonSeries } from './FinanceTrendChart'
import { buildFinanceTimeline, financeDateLabel, financeMoney, financeTimelineReconciles, type FinanceChartSeries } from './financeAnalytics'

export function overviewComparison(report: BusinessPerformanceReport) {
  if (!businessReportCompleteness(report).ledger) return null
  const hasReceipts = Boolean(report.receipts && ['gross', 'refunds', 'reversals', 'adjustments', 'net'].every(key => Number.isFinite(report.receipts?.[key as keyof NonNullable<BusinessPerformanceReport['receipts']>])))
  const hasSales = report.sales?.complete === true && ['grossContractSales', 'contractSalesAdjustment', 'netContractSales'].every(key => Number.isFinite(report.sales?.[key as keyof NonNullable<BusinessPerformanceReport['sales']>])) && !report.dataQuality.contractsTruncated && !report.dataQuality.cancelledSalesBaselineUnverified && !report.dataQuality.contractSalesDatesMissing
  const selected = revenueComparisonSeries.filter(item => item.id === 'recognizedRevenue' || (item.id === 'contractSales' ? hasSales : hasReceipts))
    .map(item => item.id === 'contractSales' ? { ...item, label: 'Doanh số PT' } : item)
  const timeline = report.range ? buildFinanceTimeline(report.range, report.dailySeries.map(row => ({ date: row.date, values: {
    recognizedRevenue: row.recognisedRevenue, grossCash: row.grossCash as number, netCash: row.netCash as number, contractSales: row.contractSales as number,
  } })), selected.map(item => item.id)) : null
  const totals: Record<string, number> = { recognizedRevenue: report.managementPnl.recognisedRevenue }
  if (hasReceipts) Object.assign(totals, { grossCash: report.receipts!.gross, netCash: report.receipts!.net })
  if (hasSales) totals.contractSales = report.sales!.netContractSales
  return { hasReceipts, hasSales, selected, timeline: timeline && financeTimelineReconciles(timeline.points, totals) ? timeline : null }
}

const operatingSeries: FinanceChartSeries[] = [
  { id: 'revenue', label: 'Doanh thu thực hiện', color: '#d76b31', kind: 'line' },
  { id: 'expense', label: 'Chi phí ghi nhận', color: '#9296ad', kind: 'bar' },
  { id: 'result', label: 'Kết quả vận hành', color: '#765071', kind: 'line' },
]

function SourceBreakdown({ report, labels }: { report: BusinessPerformanceReport; labels: Record<BusinessSource, string> }) {
  const rows = report.sourceRows
  const values = rows.flatMap(row => [row.recognisedRevenue, row.operatingExpense])
  if (values.some(value => !Number.isFinite(value))) return <p className="finance-chart__empty">Chưa đủ số liệu để so sánh theo nguồn.</p>
  const minimum = Math.min(0, ...values), maximum = Math.max(1, ...values), span = maximum - minimum
  const position = (value: number) => (value - minimum) / span * 100
  const zero = position(0)
  return <div className="finance-source-breakdown">
    <div className="finance-chart__legend"><span><i style={{ backgroundColor: '#d76b31' }} />Doanh thu thực hiện</span><span><i style={{ backgroundColor: '#9296ad' }} />Chi phí ghi nhận</span></div>
    {rows.length ? rows.map(row => <div className="finance-source-breakdown__row" key={row.source}>
      <header><strong>{labels[row.source] || row.source}</strong><span>{row.entryCount.toLocaleString('vi-VN')} bút toán</span></header>
      {[{ id: 'revenue', label: 'Doanh thu', value: row.recognisedRevenue }, { id: 'expense', label: 'Chi phí', value: row.operatingExpense }].map(item => <div className="finance-source-breakdown__metric" key={item.id}>
        <span>{item.label}</span><div className="finance-source-breakdown__track" aria-hidden="true"><i className="finance-source-breakdown__zero" style={{ left: `${zero}%` }} /><i className={`finance-source-breakdown__bar is-${item.id}`} data-value={item.value} style={{ left: `${Math.min(zero, position(item.value))}%`, width: `${Math.abs(position(item.value) - zero)}%` }} /></div><b>{financeMoney(item.value)}</b>
      </div>)}
      <p>Kết quả vận hành <strong className={row.operatingResult < 0 ? 'is-negative' : ''}>{financeMoney(row.operatingResult)}</strong></p>
    </div>) : <p className="finance-chart__empty">Chưa có bút toán phù hợp để phân tích theo nguồn.</p>}
  </div>
}

export default function FinanceOverviewAnalytics({ report, sourceLabels, reconciliation }: { report: BusinessPerformanceReport; sourceLabels: Record<BusinessSource, string>; reconciliation?: ReactNode }) {
  const comparison = overviewComparison(report)
  if (!comparison) return null
  const { hasSales, hasReceipts, selected, timeline } = comparison
  const operatingCandidate = report.range ? buildFinanceTimeline(report.range, report.dailySeries.map(row => ({ date: row.date, values: {
    revenue: row.recognisedRevenue, expense: row.operatingExpense, result: row.operatingResult,
  } })), operatingSeries.map(item => item.id)) : null
  const operatingTimeline = operatingCandidate && financeTimelineReconciles(operatingCandidate.points, {
    revenue: report.managementPnl.recognisedRevenue, expense: report.managementPnl.operatingExpense, result: report.managementPnl.operatingResult,
  }) ? operatingCandidate : null
  const range = report.range ? `${financeDateLabel(report.range.startDate)}/${report.range.startDate.slice(0, 4)} – ${financeDateLabel(report.range.endDate)}/${report.range.endDate.slice(0, 4)}` : 'Kỳ đang chọn'
  return <section className="finance-overview-analytics" aria-label="Phân tích tài chính trong kỳ">
    <div className="finance-overview-analytics__details">
      <article className="finance-overview-analytics__cash"><header className="finance-overview-analytics__heading"><div><h2>Thu và dòng tiền</h2></div><AuraHelpPopover title="Cách đọc thu và dòng tiền"><p>Thực thu gồm các phiếu thu, hoàn và điều chỉnh thu, kể cả khoản thu khác đã ghi nhận.</p><p>Dòng tiền ròng tính mọi khoản tiền vào và ra đã ghi nhận, bao gồm cả chi phí và lương.</p></AuraHelpPopover></header>
        {hasReceipts ? <dl className="finance-overview-analytics__receipt-breakdown" aria-label="Chi tiết thu">
          <div><dt>Thu gộp</dt><dd>{financeMoney(report.receipts!.gross)}</dd></div>
          <div><dt>Trừ hoàn tiền</dt><dd>{financeMoney(report.receipts!.refunds)}</dd></div>
          <div><dt>Trừ đảo phiếu thu</dt><dd>{financeMoney(report.receipts!.reversals)}</dd></div>
          <div><dt>Điều chỉnh thu</dt><dd>{financeMoney(report.receipts!.adjustments)}</dd></div>
          <div><dt>Thực thu ròng</dt><dd>{financeMoney(report.receipts!.net)}</dd></div>
        </dl> : <p className="finance-overview-analytics__notice">Chưa có dữ liệu phân loại thu để đối chiếu với dòng tiền.</p>}
        <dl className="finance-overview-analytics__cash-equation"><div><dt>Tổng tiền vào</dt><dd>{financeMoney(report.cashFlow.cashIn)}</dd></div><div><dt>Trừ tiền ra</dt><dd>{financeMoney(report.cashFlow.cashOut)}</dd></div><div><dt>Dòng tiền ròng</dt><dd className={report.cashFlow.cashNet < 0 ? 'is-negative' : ''}>{financeMoney(report.cashFlow.cashNet)}</dd></div></dl>
        <details className="finance-overview-analytics__balance-movements"><summary>Biến động phải thu và tiền ứng trước</summary><dl className="finance-overview-analytics__movements"><div><dt>Biến động phải thu</dt><dd>{financeMoney(report.balanceMovement.receivableMovement)}</dd></div><div><dt>Biến động doanh thu chưa thực hiện</dt><dd>{financeMoney(report.balanceMovement.deferredRevenueMovement)}</dd></div></dl><p className="finance-overview-analytics__explanation">Đây là tăng/giảm phát sinh trong kỳ, không phải số dư công nợ hoặc tiền khách ứng trước cuối kỳ.</p></details>
      </article>
      <article className="finance-overview-analytics__sources"><header className="finance-overview-analytics__heading"><div><h2>Kết quả theo nguồn</h2><p>Doanh thu thực hiện trừ chi phí đã ghi nhận</p></div><AuraHelpPopover title="Cách đọc kết quả theo nguồn"><p>Giữ nguyên số âm do điều chỉnh. Nguồn chưa tích hợp và chi phí chưa hạch toán chưa nằm trong kết quả này.</p></AuraHelpPopover></header><SourceBreakdown report={report} labels={sourceLabels} /></article>
    </div>
    {reconciliation}
    <details className="finance-overview-analytics__comparison"><summary>{report.source === 'all' || report.source === 'pt_gym' ? 'Đối chiếu doanh số PT và thực thu' : 'Đối chiếu doanh thu và thực thu'}</summary>
      <header className="finance-overview-analytics__heading"><div><h2>Doanh số, thực hiện & thực thu</h2><p>{range}{timeline ? ` · Theo ${timeline.granularity === 'week' ? 'tuần' : 'ngày'}` : ''}</p></div><span>{sourceLabels[report.source] || 'Nguồn đang chọn'}</span></header>
      <dl className="finance-overview-analytics__totals">
        <div><dt>Doanh số PT</dt><dd>{hasSales ? financeMoney(report.sales!.netContractSales) : report.sales === null ? 'Không áp dụng' : 'Chưa đủ dữ liệu'}</dd>{hasSales && <small>Ký gốc {financeMoney(report.sales!.grossContractSales)}<br />Điều chỉnh {financeMoney(report.sales!.contractSalesAdjustment)}</small>}</div>
        <div><dt>Doanh thu thực hiện</dt><dd>{financeMoney(report.managementPnl.recognisedRevenue)}</dd><small>Dịch vụ và điều chỉnh ghi nhận trong kỳ</small></div>
        <div><dt>Thực thu ròng</dt><dd>{hasReceipts ? financeMoney(report.receipts!.net) : 'Chưa có dữ liệu phân loại'}</dd><small>{hasReceipts ? `Thu gộp ${financeMoney(report.receipts!.gross)}` : 'Không thay thế bằng dòng tiền ròng'}</small></div>
      </dl>
      {!hasReceipts && <p role="note" className="finance-overview-analytics__notice">Báo cáo chưa có phân loại thu. Biểu đồ chỉ hiển thị các chỉ số đã có dữ liệu.</p>}
      {report.sales && !hasSales && <p role="note" className="finance-overview-analytics__notice">Chưa thể kết luận doanh số PT: có hồ sơ thiếu căn cứ doanh số hoặc dữ liệu vượt giới hạn. Các giá trị hợp đồng này chưa được vẽ.</p>}
      {timeline ? <FinanceTrendChart points={timeline.points} series={selected} label="Doanh số PT, doanh thu thực hiện và thực thu theo kỳ" /> : <p className="finance-chart__empty">Chưa đủ dữ liệu theo ngày để vẽ biểu đồ cho phạm vi này.</p>}
      <p className="finance-overview-analytics__explanation">Doanh số PT tính theo ngày ký và ngày điều chỉnh; doanh thu thực hiện và thực thu tính theo ngày ghi nhận. Đây là so sánh trong cùng kỳ, không phải tỷ lệ thu tiền của các hợp đồng vừa ký.{report.source === 'all' ? ' Doanh số chỉ gồm PT; hai chỉ số còn lại gồm các nguồn đang ghi nhận.' : ''}</p>
    </details>

    <details className="finance-overview-analytics__operating"><summary>Diễn biến doanh thu, chi phí và kết quả vận hành</summary><p className="finance-overview-analytics__explanation">Kết quả vận hành = doanh thu thực hiện − chi phí đã ghi nhận. Nguồn chưa tích hợp hoặc chi phí chưa hạch toán chưa nằm trong số liệu này.</p>{operatingTimeline ? <FinanceTrendChart points={operatingTimeline.points} series={operatingSeries} label="Doanh thu, chi phí và kết quả vận hành trong kỳ" /> : <p className="finance-chart__empty">Chưa có đủ dữ liệu theo ngày.</p>}</details>
  </section>
}
