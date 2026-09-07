import { useState } from 'react'
import { ArrowLeft, CalendarDays, ShieldCheck, WalletCards } from 'lucide-react'
import PerformanceBrandReviewPanel from '../../components/performance/PerformanceBrandReviewPanel'
import StaffPerformanceBrandPanel from '../../components/performance/StaffPerformanceBrandPanel'
import type { ViewId } from '../../types'
import './StaffPerformancePage.css'

function currentPeriod() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

function periodLabel(value: string) {
  const matched = /^(\d{4})-(\d{2})$/.exec(value)
  return matched ? `Tháng ${Number(matched[2])}/${matched[1]}` : value
}

export default function StaffPerformancePage({ isDemo = false, onNavigate, reviewer = false }: {
  isDemo?: boolean
  onNavigate: (view: ViewId) => void
  reviewer?: boolean
}) {
  const [periodId, setPeriodId] = useState(currentPeriod)

  return <main className="staff-performance-page" data-testid="staff-performance-page">
    <header className="staff-performance-page__header">
      <button type="button" className="is-back" onClick={() => onNavigate('staff-dashboard')} aria-label="Về Tổng quan Staff"><ArrowLeft /></button>
      <div>
        <small>AURA PT · PERFORMANCE SCORE</small>
        <h1>{reviewer ? 'Hiệu suất PT' : 'Hiệu suất của tôi'}</h1>
        <p>{periodLabel(periodId)} · {reviewer ? 'Duyệt bằng chứng, Profile Quality và phiếu điểm PT.' : 'Điểm, bằng chứng và trạng thái duyệt được cập nhật cùng một nơi.'}</p>
      </div>
      <div className="staff-performance-page__actions">
        <label><CalendarDays /><span>Kỳ đánh giá</span><input type="month" value={periodId} onChange={(event) => setPeriodId(event.target.value)} /></label>
        <button type="button" onClick={() => onNavigate('staff-payroll')}><WalletCards /> Xem bảng lương</button>
      </div>
    </header>

    <aside className="staff-performance-page__privacy">
      <ShieldCheck />
      <p><strong>{reviewer ? 'Không gian quản lý Performance PT.' : 'Phiếu điểm cá nhân của PT.'}</strong> {reviewer ? 'Bạn chỉ duyệt dữ liệu trong phạm vi được cấp quyền; mọi thay đổi đều ghi audit.' : 'Bạn chỉ xem và gửi bằng chứng cho chính mình. Quản lý/Admin chịu trách nhiệm duyệt, kết luận Gate và khóa kỳ.'}</p>
    </aside>

    {reviewer ? <PerformanceBrandReviewPanel isDemo={isDemo} /> : <StaffPerformanceBrandPanel periodId={periodId} isDemo={isDemo} />}
  </main>
}
