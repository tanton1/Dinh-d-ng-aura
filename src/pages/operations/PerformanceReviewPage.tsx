import { ArrowLeft, Award, ChartNoAxesCombined, ClipboardCheck, ShieldCheck } from 'lucide-react'
import PerformanceBrandReviewPanel from '../../components/performance/PerformanceBrandReviewPanel'
import type { ViewId } from '../../types'
import './PerformanceReviewPage.css'

export default function PerformanceReviewPage({ isDemo = false, onNavigate, backView, scopeLabel }: {
  isDemo?: boolean
  onNavigate: (view: ViewId) => void
  backView: ViewId
  scopeLabel: string
}) {
  return <main className="performance-review-page" data-testid="performance-review-page">
    <header className="performance-review-page__hero">
      <div className="performance-review-page__heading">
        <button type="button" onClick={() => onNavigate(backView)} aria-label={`Về ${scopeLabel}`}><ArrowLeft /></button>
        <div>
          <span>AURA PERFORMANCE / OPERATIONS</span>
          <h1>Performance PT</h1>
          <p>Dữ liệu thật, bằng chứng rõ và tiêu chuẩn nghề nghiệp có thể đối soát.</p>
        </div>
      </div>
      <dl className="performance-review-page__framework" aria-label="Khung Performance Score">
        <div className="is-score"><dt><Award /></dt><dd><strong>100</strong><span>điểm hiệu suất</span></dd></div>
        <div><dt><ChartNoAxesCombined /></dt><dd><strong>25</strong><span>chỉ số đo lường</span></dd></div>
        <div><dt><ClipboardCheck /></dt><dd><strong>4</strong><span>Gate bắt buộc</span></dd></div>
      </dl>
      <div className="performance-review-page__scoreline" aria-hidden="true"><i /></div>
    </header>

    <div className="performance-review-page__ticker" aria-label="Nguyên tắc chấm Performance">
      <span>THỰC CHIẾN</span><i aria-hidden="true" />
      <span>MINH BẠCH</span><i aria-hidden="true" />
      <span>CÓ BẰNG CHỨNG</span><i aria-hidden="true" />
      <span>ĐỐI SOÁT ĐƯỢC</span>
    </div>

    <details className="performance-review-page__scope">
      <summary><ShieldCheck /><span>Quyền truy cập và lịch sử chỉnh sửa</span></summary>
      <p>Quản lý chỉ xử lý PT thuộc chi nhánh được giao; Admin xử lý toàn hệ thống. Mọi thay đổi điểm, Gate và bằng chứng đều được ghi lại để đối soát.</p>
    </details>

    <PerformanceBrandReviewPanel isDemo={isDemo} />
  </main>
}
