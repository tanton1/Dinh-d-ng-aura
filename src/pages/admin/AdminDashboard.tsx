import '../../styles-admin.css'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertCircle, ArrowRight, BookOpen, CheckCircle2, DollarSign, Dumbbell, GraduationCap, Plus, RefreshCw, TrendingUp, Users, WalletCards } from 'lucide-react'
import type { ViewId } from '../../types'
import { getOperationsDashboard, type OperationsDashboardData } from '../../services/operationsDashboardService'
import AuraMetricCarousel, { type AuraMetricSlide } from '../../components/admin/pt/AuraMetricCarousel'

function money(value: number) { return `${Math.round(value).toLocaleString('vi-VN')}đ` }
function startOfMonth() { const now = new Date(); return new Date(now.getFullYear(), now.getMonth(), 1).toISOString() }

export default function AdminDashboard({ onNavigate, onSeed, adminName = 'Admin Aura', canCreate = false, canManageAcademy = false, canManageCoaching = false, canManageEnrollments = false }: { onNavigate: (view: ViewId) => void; onSeed?: () => Promise<void>; adminName?: string; canCreate?: boolean; canManageAcademy?: boolean; canManageCoaching?: boolean; canManageEnrollments?: boolean }) {
  const [seedState, setSeedState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle')
  const [data, setData] = useState<OperationsDashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [activeTab, setActiveTab] = useState<'overview' | 'business' | 'pt' | 'quality'>('overview')
  const showDevelopmentSeedTool = import.meta.env.DEV && Boolean(onSeed)
  const load = useCallback(async () => {
    setLoading(true); setError('')
    try { setData(await getOperationsDashboard({ startAt: startOfMonth(), endAt: new Date().toISOString(), branchId: 'all' })) }
    catch { setError('Không thể tải dữ liệu điều hành. Hãy kiểm tra quyền tài khoản hoặc kết nối Firebase.') }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { void load() }, [load])
  const seed = async () => { if (!import.meta.env.DEV || !onSeed) return; setSeedState('loading'); try { await onSeed(); setSeedState('done') } catch { setSeedState('error') } }
  const completionRate = useMemo(() => !data?.operations.sessions ? 0 : Math.round(((data.operations.sessionStatus.completed || 0) + (data.operations.sessionStatus.attended || 0)) / data.operations.sessions * 100), [data])
  const metricSlides = useMemo<AuraMetricSlide[]>(() => {
    const business: AuraMetricSlide[] = [
      { id: 'sales', eyebrow: 'DOANH SỐ HỢP ĐỒNG', value: money(data?.finance.contractSales || 0), detail: 'Giá trị hợp đồng ký trong kỳ', icon: <TrendingUp size={20} />, tone: 'pink', actionLabel: 'Mở báo cáo', onSelect: () => onNavigate('admin-report') },
      { id: 'cash', eyebrow: 'TIỀN THỰC THU', value: money(data?.finance.cashCollected || 0), detail: 'Tiền đã đi vào quỹ từ ledger canonical', icon: <WalletCards size={20} />, tone: 'orange', actionLabel: 'Mở tài chính', onSelect: () => onNavigate('admin-finance') },
      { id: 'net-cash', eyebrow: 'DÒNG TIỀN THUẦN', value: money(data?.finance.netCash || 0), detail: 'Tiền vào trừ tiền ra trong kỳ', icon: <DollarSign size={20} />, tone: 'sunset', actionLabel: 'Đối chiếu', onSelect: () => onNavigate('admin-finance') },
      { id: 'receivables', eyebrow: 'CÔNG NỢ', value: money(data?.finance.receivables || 0), detail: 'Số tiền còn phải thu theo hợp đồng', icon: <AlertCircle size={20} />, tone: 'ink', actionLabel: 'Xem công nợ', onSelect: () => onNavigate('admin-finance') },
    ]
    const operations: AuraMetricSlide[] = [
      { id: 'students', eyebrow: 'HỌC VIÊN HOẠT ĐỘNG', value: (data?.clients.active || 0).toLocaleString('vi-VN'), detail: `${data?.clients.newInRange || 0} học viên mới trong kỳ`, icon: <Users size={20} />, tone: 'pink', actionLabel: 'Mở học viên', onSelect: () => onNavigate('admin-pt-students') },
      { id: 'completion', eyebrow: 'HOÀN THÀNH BUỔI TẬP', value: `${completionRate}%`, detail: `${data?.operations.attendanceEvents || 0} sự kiện điểm danh chuẩn`, icon: <TrendingUp size={20} />, tone: 'orange', actionLabel: 'Xem nhật ký', onSelect: () => onNavigate('admin-training-history') },
      { id: 'sessions', eyebrow: 'BUỔI TẬP TRONG KỲ', value: (data?.operations.sessions || 0).toLocaleString('vi-VN'), detail: `${data?.clients.activeContracts || 0} hợp đồng hoạt động`, icon: <BookOpen size={20} />, tone: 'sunset', actionLabel: 'Mở lịch PT', onSelect: () => onNavigate('admin-pt-schedule') },
      { id: 'team', eyebrow: 'ĐỘI NGŨ PT', value: String(data?.operations.activeTrainers || 0), detail: `${data?.operations.activeStaff || 0} nhân sự · ${data?.operations.branches || 0} chi nhánh`, icon: <Dumbbell size={20} />, tone: 'ink', actionLabel: 'Mở đội ngũ', onSelect: () => onNavigate('admin-hr') },
    ]
    const quality: AuraMetricSlide[] = [
      { id: 'quality-status', eyebrow: 'ĐỘ TIN CẬY DỮ LIỆU', value: data?.quality.completeness === 'complete' ? 'Đã đối soát' : 'Cần kiểm tra', detail: 'Tài chính từ ledger canonical · điểm danh từ attendanceEvents', icon: <CheckCircle2 size={20} />, tone: 'pink' },
      { id: 'quality-contracts', eyebrow: 'HỢP ĐỒNG THIẾU NGÀY KÝ', value: String(data?.quality.missingContractEffectiveDate || 0), detail: 'Không tự suy doanh thu từ ngày bắt đầu gói', icon: <AlertCircle size={20} />, tone: 'orange', actionLabel: 'Mở báo cáo', onSelect: () => onNavigate('admin-report') },
      { id: 'quality-scan', eyebrow: 'GIỚI HẠN TRUY VẤN', value: data?.quality.truncated ? 'Đã chạm ngưỡng' : 'Trong ngưỡng', detail: 'Mọi truy vấn tổng quan đều có giới hạn an toàn', icon: <BookOpen size={20} />, tone: 'sunset' },
      { id: 'quality-sync', eyebrow: 'ĐỒNG BỘ GẦN NHẤT', value: data?.generatedAt ? new Date(data.generatedAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) : '—', detail: data?.generatedAt ? new Date(data.generatedAt).toLocaleDateString('vi-VN') : 'Chưa có dữ liệu', icon: <RefreshCw size={20} />, tone: 'ink', actionLabel: 'Làm mới', onSelect: () => void load() },
    ]
    if (activeTab === 'business') return business
    if (activeTab === 'pt') return operations
    if (activeTab === 'quality') return quality
    return [business[1], business[3], operations[0], operations[1]]
  }, [activeTab, completionRate, data, load, onNavigate])

  return <div className="page admin-dashboard">
    <AuraMetricCarousel slides={metricSlides} label={`Chỉ số ${activeTab === 'business' ? 'kinh doanh' : activeTab === 'pt' ? 'vận hành PT' : activeTab === 'quality' ? 'chất lượng dữ liệu' : 'điều hành'}`} loading={loading} />
    <section className="admin-dashboard__commandbar" aria-label="Điều khiển tổng quan">
      <div className="admin-dashboard__identity"><small>AURA · TRUNG TÂM ĐIỀU HÀNH</small><strong>Chào {adminName}</strong><span>{data?.generatedAt ? `Đồng bộ ${new Date(data.generatedAt).toLocaleString('vi-VN')}` : 'Đang kết nối dữ liệu vận hành'}</span></div>
      <div className="admin-dashboard__actions"><button className="outline-button" onClick={() => void load()} disabled={loading}><RefreshCw className={loading ? 'spin' : ''} size={17} /> {loading ? 'Đang tải' : 'Làm mới'}</button>{showDevelopmentSeedTool && <button className="outline-button" onClick={seed}>{seedState === 'done' && <CheckCircle2 size={17} />} Nạp mẫu</button>}{canCreate && <button className="primary-button" onClick={() => onNavigate('admin-course-editor')}><Plus size={17} /> Tạo khóa học</button>}</div>
    </section>
    <div className="admin-tabs admin-operations-tabs" role="tablist">{([['overview','Tổng quan'],['business','Kinh doanh'],['pt','Vận hành PT'],['quality','Chất lượng dữ liệu']] as const).map(([id,label]) => <button key={id} className={activeTab === id ? 'active' : ''} onClick={() => setActiveTab(id)}>{label}</button>)}</div>
    {error && <div className="admin-data-warning"><AlertCircle size={18} /><span>{error}</span><button onClick={() => void load()}>Thử lại</button></div>}
    {!error && data?.quality.completeness === 'partial' && <div className="admin-data-warning"><AlertCircle size={18} /><span>Số liệu đang ở trạng thái một phần: {data.quality.missingContractEffectiveDate} hợp đồng thiếu ngày ký hợp lệ. Aura không tự gán doanh thu vào ngày bắt đầu gói.</span></div>}

    {activeTab === 'quality' && <section className="card admin-quality-card"><h2>Độ tin cậy số liệu</h2><p>Tài chính: <b>{data?.quality.canonicalFinanceSource || 'ledgerEntries'}</b>. Chấm công: <b>{data?.quality.canonicalAttendanceSource || 'attendanceEvents'}</b>.</p><p>Trạng thái: <b>{data?.quality.completeness === 'complete' ? 'Đầy đủ trong phạm vi truy vấn' : 'Cần đối soát'}</b>. Dashboard không tạo payment ảo, không suy ngày doanh thu từ ngày bắt đầu hợp đồng.</p><small>Cập nhật gần nhất: {data?.generatedAt ? new Date(data.generatedAt).toLocaleString('vi-VN') : '—'}</small></section>}
    {activeTab === 'overview' && <section className="admin-workspace-grid">
      {canManageAcademy && <article className="admin-workspace-card academy"><span><GraduationCap size={23} /></span><div><small>AURA ACADEMY</small><h2>Đào tạo dinh dưỡng</h2><p>Quản lý nội dung, review, publish và tiến độ học tập.</p><div className="admin-workspace-actions"><button className="text-button" onClick={() => onNavigate('admin-courses')}>Khóa học <ArrowRight size={15} /></button>{canManageEnrollments && <button className="text-button" onClick={() => onNavigate('admin-academy-students')}>Học viên <ArrowRight size={15} /></button>}</div></div></article>}
      {canManageCoaching && <article className="admin-workspace-card coaching"><span><Dumbbell size={23} /></span><div><small>AURA OPERATIONS</small><h2>PT & Khách hàng</h2><p>Học viên, lịch, đội ngũ và tài chính trong cùng hệ điều hành.</p><div className="admin-workspace-actions"><button className="text-button" onClick={() => onNavigate('admin-pt-students')}>Học viên <ArrowRight size={15} /></button><button className="text-button" onClick={() => onNavigate('admin-renewals')}>Tái ký <ArrowRight size={15} /></button><button className="text-button" onClick={() => onNavigate('admin-training-history')}>Nhật ký PT <ArrowRight size={15} /></button><button className="text-button" onClick={() => onNavigate('admin-finance')}>Tài chính <ArrowRight size={15} /></button><button className="text-button" onClick={() => onNavigate('admin-hr')}>Đội ngũ <ArrowRight size={15} /></button></div></div></article>}
    </section>}
    {activeTab === 'business' && <section className="admin-dashboard__quick-grid" aria-label="Lối tắt kinh doanh"><button onClick={() => onNavigate('admin-report')}><TrendingUp size={20} /><span><strong>Báo cáo kinh doanh</strong><small>Doanh số, doanh thu và nguồn thu</small></span><ArrowRight size={17} /></button><button onClick={() => onNavigate('admin-finance')}><WalletCards size={20} /><span><strong>Trả góp & công nợ</strong><small>Khoản phải thu, quá hạn và dòng tiền</small></span><ArrowRight size={17} /></button><button onClick={() => onNavigate('admin-renewals')}><Users size={20} /><span><strong>Tái ký học viên</strong><small>Hợp đồng sắp hết hạn hoặc hết buổi</small></span><ArrowRight size={17} /></button></section>}
    {activeTab === 'pt' && <section className="admin-dashboard__quick-grid" aria-label="Lối tắt vận hành PT"><button onClick={() => onNavigate('admin-pt-students')}><Users size={20} /><span><strong>Học viên PT</strong><small>Hồ sơ, hợp đồng và cảnh báo vận hành</small></span><ArrowRight size={17} /></button><button onClick={() => onNavigate('admin-pt-schedule')}><BookOpen size={20} /><span><strong>Lịch & yêu cầu</strong><small>Xếp lịch, đổi/hủy và nghỉ tuần</small></span><ArrowRight size={17} /></button><button onClick={() => onNavigate('admin-training-history')}><Dumbbell size={20} /><span><strong>Lịch sử tập</strong><small>Ca dạy HLV và buổi tập học viên</small></span><ArrowRight size={17} /></button></section>}
  </div>
}
