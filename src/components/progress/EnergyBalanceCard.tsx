import React from 'react'
interface Props {
  onOpenDetails?: () => void; onLogMeal?: () => void; onLogWorkout?: () => void;
  intake?: number; basal?: number; dailyActivity?: number; workout?: number; thermicEffect?: number;
  confidence?: string; goal?: string; periodDays?: number; totalPeriodDays?: number; activeDays?: number; workoutDays?: number;
}
export const EnergyBalanceCard = React.memo(function EnergyBalanceCard({ intake = 0, basal = 0, periodDays = 0, totalPeriodDays = 7, confidence = 'Thấp', onLogMeal, onOpenDetails }: Props) {
  const hasData = periodDays > 0 && Number.isFinite(basal) && basal > 0
  const balance = hasData ? Math.round((intake - basal) / periodDays) : 0
  return <section className="pg-card">
    <h2>Cân bằng năng lượng ước tính</h2>
    <p>{periodDays}/{totalPeriodDays} ngày có đủ khung bữa để so sánh. Ngày thiếu nhật ký không được coi là nhịn ăn.</p>
    {hasData ? <>
      <dl><dt>Nạp vào đã ghi</dt><dd>{Math.round(intake).toLocaleString('vi-VN')} kcal</dd>
        <dt>Tiêu hao ước tính (TDEE)</dt><dd>{Math.round(basal).toLocaleString('vi-VN')} kcal</dd>
        <dt>Chênh lệch trung bình</dt><dd>{balance > 0 ? '+' : ''}{balance.toLocaleString('vi-VN')} kcal/ngày</dd></dl>
      <p>TDEE đã gồm vận động và hiệu ứng nhiệt thức ăn; không cộng thêm kcal buổi tập lần nữa. Độ tin cậy: {confidence.toLocaleLowerCase('vi-VN')}.</p>
      <small>Ngày cũ chưa có bản lưu mục tiêu sử dụng ước tính theo hồ sơ hiện tại. Đây không phải số đo tiêu hao hoặc xác nhận giảm mỡ thực tế.</small>
      <button type="button" onClick={onOpenDetails}>Xem nhật ký</button>
    </> : <><p>Chưa đủ nhật ký hoặc hồ sơ để ước tính. Hãy ghi đầy đủ các bữa đã ăn.</p><button type="button" onClick={onLogMeal}>Ghi bữa ăn</button></>}
  </section>
})
