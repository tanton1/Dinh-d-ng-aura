import { ArrowLeft, Award, ShieldCheck } from 'lucide-react'
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
    <header className="performance-review-page__header">
      <button type="button" onClick={() => onNavigate(backView)} aria-label={`Về ${scopeLabel}`}><ArrowLeft /></button>
      <span><Award /></span>
      <div>
        <small>AURA OPERATIONS · PERFORMANCE SCORE</small>
        <h1>Performance PT</h1>
        <p>Duyệt bằng chứng, Profile Quality, 25 chỉ số và bốn Gate trong một module độc lập.</p>
      </div>
    </header>

    <aside className="performance-review-page__scope">
      <ShieldCheck />
      <p><strong>Phạm vi dữ liệu được kiểm soát theo quyền.</strong> Quản lý chỉ xử lý PT thuộc chi nhánh được giao; Admin xử lý toàn hệ thống. Mọi quyết định đều được ghi audit.</p>
    </aside>

    <PerformanceBrandReviewPanel isDemo={isDemo} />
  </main>
}
