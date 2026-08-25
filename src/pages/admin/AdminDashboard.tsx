import '../../styles-admin.css'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertCircle, ArrowRight, BookOpen, CheckCircle2, DollarSign, Dumbbell, GraduationCap, Plus, RefreshCw, TrendingUp, Users, WalletCards } from 'lucide-react'
import type { ViewId } from '../../types'
import { PageHeader } from '../../components/ui'
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
    if (activeTab === 'business') return business
    if (activeTab === 'pt') return operations
    return [business[1], business[3], operations[0], operations[1]]
  }, [activeTab, completionRate, data, onNavigate])

  return <div className="page admin-dashboard">
    <PageHeader eyebrow="AURA · TRUNG TÂM ĐIỀU HÀNH" title={`Hôm nay của ${adminName}`} description="Một nguồn số liệu chung cho kinh doanh, dòng tiền, học viên và vận hành PT." action={<div className="admin-header-actions"><button className="outline-button" onClick={() => void load()} disabled={loading}><RefreshCw size={17} /> {loading ? 'Đang đồng bộ…' : 'Làm mới'}</button>{showDevelopmentSeedTool && <button className="outline-button" onClick={seed}>{seedState === 'done' && <CheckCircle2 size={17} />} Nạp mẫu</button>}{canCreate && <button className="primary-button" onClick={() => onNavigate('admin-course-editor')}><Plus size={18} /> Tạo khóa học</button>}</div>} />
    <div className="admin-tabs admin-operations-tabs" role="tablist">{([['overview','Tổng quan'],['business','Kinh doanh'],['pt','Vận hành PT'],['quality','Chất lượng dữ liệu']] as const).map(([id,label]) => <button key={id} className={activeTab === id ? 'active' : ''} onClick={() => setActiveTab(id)}>{label}</button>)}</div>
    {error && <div className="admin-data-warning"><AlertCircle size={18} /><span>{error}</span><button onClick={() => void load()}>Thử lại</button></div>}
    {!error && data?.quality.completeness === 'partial' && <div className="admin-data-warning"><AlertCircle size={18} /><span>Số liệu đang ở trạng thái một phần: {data.quality.missingContractEffectiveDate} hợp đồng thiếu ngày ký hợp lệ. Aura không tự gán doanh thu vào ngày bắt đầu gói.</span></div>}

    {activeTab !== 'quality' && <AuraMetricCarousel slides={metricSlides} label={`Chỉ số ${activeTab === 'business' ? 'kinh doanh' : activeTab === 'pt' ? 'vận hành PT' : 'điều hành'}`} loading={loading} />}
    {activeTab === 'quality' && <section className="card admin-quality-card"><h2>Độ tin cậy số liệu</h2><p>Tài chính: <b>{data?.quality.canonicalFinanceSource || 'ledgerEntries'}</b>. Chấm công: <b>{data?.quality.canonicalAttendanceSource || 'attendanceEvents'}</b>.</p><p>Trạng thái: <b>{data?.quality.completeness === 'complete' ? 'Đầy đủ trong phạm vi truy vấn' : 'Cần đối soát'}</b>. Dashboard không tạo payment ảo, không suy ngày doanh thu từ ngày bắt đầu hợp đồng.</p><small>Cập nhật gần nhất: {data?.generatedAt ? new Date(data.generatedAt).toLocaleString('vi-VN') : '—'}</small></section>}
    {activeTab === 'overview' && <section className="admin-workspace-grid">
      {canManageAcademy && <article className="admin-workspace-card academy"><span><GraduationCap size={23} /></span><div><small>AURA ACADEMY</small><h2>Đào tạo dinh dưỡng</h2><p>Quản lý nội dung, review, publish và tiến độ học tập.</p><div className="admin-workspace-actions"><button className="text-button" onClick={() => onNavigate('admin-courses')}>Khóa học <ArrowRight size={15} /></button>{canManageEnrollments && <button className="text-button" onClick={() => onNavigate('admin-academy-students')}>Học viên <ArrowRight size={15} /></button>}</div></div></article>}
      {canManageCoaching && <article className="admin-workspace-card coaching"><span><Dumbbell size={23} /></span><div><small>AURA OPERATIONS</small><h2>PT & Khách hàng</h2><p>Học viên, lịch, đội ngũ và tài chính trong cùng hệ điều hành.</p><div className="admin-workspace-actions"><button className="text-button" onClick={() => onNavigate('admin-pt-students')}>Học viên <ArrowRight size={15} /></button><button className="text-button" onClick={() => onNavigate('admin-renewals')}>Tái ký <ArrowRight size={15} /></button><button className="text-button" onClick={() => onNavigate('admin-training-history')}>Nhật ký PT <ArrowRight size={15} /></button><button className="text-button" onClick={() => onNavigate('admin-finance')}>Tài chính <ArrowRight size={15} /></button><button className="text-button" onClick={() => onNavigate('admin-hr')}>Đội ngũ <ArrowRight size={15} /></button></div></div></article>}
    </section>}
  </div>
}
