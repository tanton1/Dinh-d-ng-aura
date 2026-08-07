import { useState } from 'react'
import { AlertCircle, ArrowRight, Bell, BookOpen, CalendarClock, CheckCircle2, DollarSign, Dumbbell, GraduationCap, Plus, TrendingUp, Users } from 'lucide-react'
import type { ViewId } from '../../types'
import { PageHeader } from '../../components/ui'

export default function AdminDashboard({ onNavigate, onSeed, adminName = 'Admin Aura', canCreate = false, canManageAcademy = false, canManageCoaching = false, canManageEnrollments = false }: { onNavigate: (view: ViewId) => void; onSeed?: () => Promise<void>; adminName?: string; canCreate?: boolean; canManageAcademy?: boolean; canManageCoaching?: boolean; canManageEnrollments?: boolean }) {
  const [seedState, setSeedState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle')
  const showDevelopmentSeedTool = import.meta.env.DEV && Boolean(onSeed)
  const seed = async () => {
    if (!import.meta.env.DEV || !onSeed) return
    setSeedState('loading')
    try { await onSeed(); setSeedState('done') }
    catch { setSeedState('error') }
  }
  return (
    <div className="page admin-dashboard">
      <PageHeader eyebrow="AURA · ADMIN" title={`Xin chào, ${adminName}`} description="Hai không gian vận hành độc lập cho đào tạo chuyên sâu và dịch vụ huấn luyện PT." action={(showDevelopmentSeedTool || canCreate) ? <div className="admin-header-actions">{showDevelopmentSeedTool && <button className="outline-button" onClick={seed} disabled={seedState === 'loading'} title="Công cụ nội bộ chỉ hiển thị trong môi trường phát triển">{seedState === 'done' ? <CheckCircle2 size={17} /> : <CalendarClock size={17} />} {seedState === 'loading' ? 'Đang nạp template...' : seedState === 'done' ? 'Đã nạp template' : seedState === 'error' ? 'Thử nạp lại' : 'Nạp template thử nghiệm'}</button>}{canCreate && <button className="primary-button" onClick={() => onNavigate('admin-course-editor')}><Plus size={18} /> Tạo khóa học</button>}</div> : undefined} />

      <section className="admin-workspace-grid" aria-label="Không gian quản trị Aura">
        {canManageAcademy && <article className="admin-workspace-card academy"><span><GraduationCap size={23} /></span><div><small>AURA ACADEMY</small><h2>Đào tạo dinh dưỡng</h2><p>Quản lý khóa học chuyên sâu, nội dung ghi nhớ, bài kiểm tra và tiến độ học tập.</p><div className="admin-workspace-actions"><button className="text-button" onClick={() => onNavigate('admin-courses')}>Khóa học <ArrowRight size={15} /></button>{canManageEnrollments && <button className="text-button" onClick={() => onNavigate('admin-academy-students')}>Học viên <ArrowRight size={15} /></button>}</div></div></article>}
        {canManageCoaching && <article className="admin-workspace-card coaching"><span><Dumbbell size={23} /></span><div><small>PT COACHING</small><h2>Quản lý khách hàng gym</h2><p>Theo dõi khách hàng, xây dựng giáo án gym và đánh giá mức độ tuân thủ tập luyện.</p><div className="admin-workspace-actions"><button className="text-button" onClick={() => onNavigate('admin-students')}>Khách hàng <ArrowRight size={15} /></button><button className="text-button" onClick={() => onNavigate('admin-programs')}>Giáo án <ArrowRight size={15} /></button><button className="text-button" onClick={() => onNavigate('admin-nutrition-reviews')}>Duyệt ăn <ArrowRight size={15} /></button><button className="text-button" onClick={() => onNavigate('admin-notifications')}>Push Notification <Bell size={14} /></button></div></div></article>}
      </section>

      <div className="admin-kpi-grid">
        <article className="admin-kpi"><div className="admin-kpi__icon purple"><Users /></div><div><span>HỌC VIÊN HOẠT ĐỘNG</span><strong>—</strong><small><em>Chưa kết nối dữ liệu hoạt động</em></small></div></article>
        <article className="admin-kpi"><div className="admin-kpi__icon green"><TrendingUp /></div><div><span>TỶ LỆ HOÀN THÀNH</span><strong>—</strong><small><em>Chưa có dữ liệu tiến độ tổng hợp</em></small></div></article>
        <article className="admin-kpi"><div className="admin-kpi__icon orange"><BookOpen /></div><div><span>BUỔI TẬP TUẦN NÀY</span><strong>—</strong><small><em>Chưa kết nối nhật ký tập luyện</em></small></div></article>
        <article className="admin-kpi"><div className="admin-kpi__icon pink"><DollarSign /></div><div><span>DOANH THU THÁNG</span><strong>—</strong><small><em>Chưa kết nối dữ liệu thanh toán</em></small></div></article>
      </div>

      <section className="admin-chart-grid">
        <article className="card engagement-chart">
          <div className="section-heading"><div><h2>Mức độ tương tác</h2><p>Dữ liệu học tập và tập luyện theo thời gian</p></div><span className="status-badge draft">Sắp có dữ liệu</span></div>
          <div className="empty-state" role="status"><TrendingUp size={30} /><h3>Chưa có báo cáo tương tác</h3><p>Biểu đồ sẽ xuất hiện sau khi tiến độ khóa học và nhật ký tập luyện được tổng hợp.</p></div>
        </article>
        <article className="card attention-card">
          <div className="section-heading"><div><h2>Cần chú ý</h2><p>Hàng đợi công việc vận hành</p></div><span className="status-badge draft">Chưa kết nối</span></div>
          <div className="empty-state" role="status"><AlertCircle size={30} /><h3>Chưa có hàng đợi tác vụ</h3><p>Cảnh báo học viên, bài nộp và nội dung chờ duyệt sẽ hiển thị khi workflow tương ứng được kết nối.</p></div>
        </article>
      </section>

      <section className="admin-bottom-grid">
        {canManageAcademy && <article className="card course-performance">
          <div className="section-heading"><div><h2>Hiệu quả khóa học</h2><p>Thống kê enrollment, hoàn thành và đánh giá</p></div><button className="text-button" onClick={() => onNavigate('admin-courses')}>Tất cả khóa học <ArrowRight size={15} /></button></div>
          <div className="empty-state" role="status"><BookOpen size={30} /><h3>Chưa có thống kê hiệu quả</h3><p>Danh sách khóa học vẫn có thể quản lý; báo cáo sẽ xuất hiện sau khi có dữ liệu enrollment và đánh giá thật.</p></div>
        </article>}
        <article className="card recent-activity">
          <div className="section-heading"><div><h2>Hoạt động gần đây</h2><p>Nhật ký thay đổi từ đội ngũ</p></div><span className="status-badge draft">Chưa kết nối</span></div>
          <div className="empty-state" role="status"><CalendarClock size={30} /><h3>Chưa có nhật ký hoạt động</h3><p>Các thay đổi khóa học, giáo án và quyền truy cập sẽ xuất hiện sau khi audit log được nối vào dashboard.</p></div>
        </article>
      </section>
    </div>
  )
}
