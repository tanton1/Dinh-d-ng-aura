import { useState } from 'react'
import { ArrowLeft, CalendarDays, ShieldCheck, WalletCards } from 'lucide-react'
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

export default function StaffPerformancePage({ isDemo = false, onNavigate }: {
  isDemo?: boolean
  onNavigate: (view: ViewId) => void
}) {
  const [periodId, setPeriodId] = useState(currentPeriod)

  return <main className="staff-performance-page" data-testid="staff-performance-page">
    <header className="staff-performance-page__header">
      <button type="button" className="is-back" onClick={() => onNavigate('staff-dashboard')} aria-label="Về Tổng quan Staff"><ArrowLeft /></button>
      <div>
        <small>AURA PT · PERFORMANCE SCORE</small>
        <h1>Hiệu suất của tôi</h1>
        <p>{periodLabel(periodId)} · Điểm, bằng chứng và trạng thái duyệt được cập nhật cùng một nơi.</p>
      </div>
      <div className="staff-performance-page__actions">
        <label><CalendarDays /><span>Kỳ đánh giá</span><input type="month" value={periodId} onChange={(event) => setPeriodId(event.target.value)} /></label>
        <button type="button" onClick={() => onNavigate('staff-payroll')}><WalletCards /> Xem bảng lương</button>
      </div>
    </header>

    <aside className="staff-performance-page__privacy">
      <ShieldCheck />
      <p><strong>Phiếu điểm cá nhân của PT.</strong> Bạn chỉ xem và gửi bằng chứng cho chính mình. Quản lý/Admin chịu trách nhiệm duyệt, kết luận Gate và khóa kỳ.</p>
    </aside>

    <StaffPerformanceBrandPanel periodId={periodId} isDemo={isDemo} />
  </main>
}
