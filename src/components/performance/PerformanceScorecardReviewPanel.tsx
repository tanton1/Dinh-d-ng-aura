import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, ClipboardCheck, Edit3, LoaderCircle, Lock, RefreshCw, Save, ShieldAlert, Unlock, X } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import {
  getPerformanceStaffScore,
  savePerformanceGateAssessment,
  savePerformanceMetricAssessment,
  setPerformanceSnapshotLock,
  type MyPerformanceScore,
  type PerformanceAssessmentSource,
  type PerformanceGateResult,
  type PerformanceStaffDirectoryItem,
  type PerformanceSubmetricScore,
} from '../../services/performanceScoreService'
import './PerformanceScorecardReviewPanel.css'

const RATIO_METRICS = new Set(['weekly_checkin', 'at_risk_followup', 'progress_review', 'nutrition_review_completion', 'feedback_sla', 'renewal_process', 'churn_documentation', 'quality_new_referral'])
const ACTUAL_TARGET_METRICS = new Set(['self_generated_revenue', 'renew_cash_vs_forecast', 'qualified_lead_conversion'])
const ACTUAL_METRICS = new Set(['customer_rating', 'coaching_audit', 'renew_rate', 'attendance'])
const BRAND_METRICS = new Set(['personal_brand', 'aura_brand', 'profile_quality'])
const SOURCE_LABELS: Record<PerformanceAssessmentSource, string> = {
  manager_review: 'Manager/Head Coach đánh giá',
  system_fallback: 'Nguồn hệ thống dự phòng',
  rolling_average: 'Trung bình kỳ gần nhất',
  neutral_score: 'Điểm trung lập được duyệt',
}

type MetricDraft = {
  source: PerformanceAssessmentSource
  actual: string
  target: string
  numerator: string
  denominator: string
  manualScore: string
  sampleSize: string
  note: string
  evidenceRefs: string
}

function emptyMetricDraft(metric?: PerformanceSubmetricScore): MetricDraft {
  return {
    source: metric && ['system_fallback', 'rolling_average', 'neutral_score'].includes(metric.source)
      ? metric.source as PerformanceAssessmentSource : 'manager_review',
    actual: metric?.actual === null || metric?.actual === undefined ? '' : String(metric.actual),
    target: metric?.target === null || metric?.target === undefined ? '' : String(metric.target),
    numerator: metric?.numerator === null || metric?.numerator === undefined ? '' : String(metric.numerator),
    denominator: metric?.denominator === null || metric?.denominator === undefined ? '' : String(metric.denominator),
    manualScore: metric?.score === null || metric?.score === undefined ? '' : String(metric.score),
    sampleSize: metric?.sampleSize ? String(metric.sampleSize) : '',
    note: metric?.note || '',
    evidenceRefs: metric?.evidenceRefs.join('\n') || '',
  }
}

function optionalNumber(value: string) {
  return value.trim() === '' ? null : Number(value)
}

function statusCopy(status: PerformanceSubmetricScore['status']) {
  return status === 'available' ? 'Đã xác minh' : status === 'needs_review' ? 'Cần duyệt rubric' : 'Chưa có dữ liệu'
}

function gateCopy(status: PerformanceGateResult['status']) {
  return status === 'pass' ? 'Đạt' : status === 'fail' ? 'Không đạt' : 'Chờ kết luận'
}

export default function PerformanceScorecardReviewPanel({ periodId, staff, isDemo = false }: {
  periodId: string
  staff: PerformanceStaffDirectoryItem[]
  isDemo?: boolean
}) {
  const { hasCapability } = useAuth()
  const canLock = hasCapability('performance.snapshot.lock')
  const [staffId, setStaffId] = useState('')
  const [score, setScore] = useState<MyPerformanceScore | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [editingMetric, setEditingMetric] = useState<PerformanceSubmetricScore | null>(null)
  const [metricDraft, setMetricDraft] = useState<MetricDraft>(emptyMetricDraft())
  const [editingGate, setEditingGate] = useState<PerformanceGateResult | null>(null)
  const [gateStatus, setGateStatus] = useState<'pass' | 'fail' | 'unknown'>('pass')
  const [gateReason, setGateReason] = useState('')
  const [gateEvidence, setGateEvidence] = useState('')
  const [lockReason, setLockReason] = useState('')
  const [working, setWorking] = useState('')

  useEffect(() => {
    if (staffId && staff.some((item) => item.staffId === staffId)) return
    setStaffId(staff[0]?.staffId || '')
  }, [staff, staffId])

  const load = useCallback(async () => {
    if (!staffId) { setScore(null); return }
    setLoading(true); setError(''); setNotice('')
    try {
      if (isDemo) { setScore(null); setNotice('Bản demo không ghi phiếu Performance Score.'); return }
      setScore(await getPerformanceStaffScore(periodId, staffId))
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Chưa tải được phiếu Performance Score.') }
    finally { setLoading(false) }
  }, [isDemo, periodId, staffId])

  useEffect(() => { void load() }, [load])
  const metrics = useMemo(() => score?.categories.flatMap((category) => category.submetrics) || [], [score])

  const openMetric = (metric: PerformanceSubmetricScore) => {
    setEditingMetric(metric); setMetricDraft(emptyMetricDraft(metric)); setNotice('')
  }

  const saveMetric = async () => {
    if (!score || !editingMetric) return
    setWorking('metric'); setNotice('')
    try {
      await savePerformanceMetricAssessment({
        periodId, staffId, metricId: editingMetric.id, expectedRevision: score.assessmentRevision,
        source: metricDraft.source,
        actual: optionalNumber(metricDraft.actual), target: optionalNumber(metricDraft.target),
        numerator: optionalNumber(metricDraft.numerator), denominator: optionalNumber(metricDraft.denominator),
        manualScore: optionalNumber(metricDraft.manualScore), sampleSize: optionalNumber(metricDraft.sampleSize),
        note: metricDraft.note.trim(), evidenceRefs: metricDraft.evidenceRefs.split(/\r?\n/).map((item) => item.trim()).filter(Boolean),
      })
      setEditingMetric(null); setNotice(`Đã cập nhật ${editingMetric.label}.`); await load()
    } catch (cause) { setNotice(cause instanceof Error ? cause.message : 'Chưa lưu được chỉ số.') }
    finally { setWorking('') }
  }

  const openGate = (gate: PerformanceGateResult) => {
    setEditingGate(gate); setGateStatus(gate.status === 'unknown' ? 'pass' : gate.status)
    setGateReason(gate.source === 'manager_review' ? gate.reason : ''); setGateEvidence(gate.evidenceRefs.join('\n')); setNotice('')
  }

  const saveGate = async () => {
    if (!score || !editingGate || editingGate.id === 'quality') return
    setWorking('gate'); setNotice('')
    try {
      await savePerformanceGateAssessment({
        periodId, staffId, gateId: editingGate.id as 'attendance' | 'client_safety' | 'integrity',
        expectedRevision: score.assessmentRevision, status: gateStatus, reason: gateReason.trim(),
        evidenceRefs: gateEvidence.split(/\r?\n/).map((item) => item.trim()).filter(Boolean),
      })
      setEditingGate(null); setNotice(`Đã cập nhật ${editingGate.label}.`); await load()
    } catch (cause) { setNotice(cause instanceof Error ? cause.message : 'Chưa lưu được Gate.') }
    finally { setWorking('') }
  }

  const toggleLock = async () => {
    if (!score || lockReason.trim().length < 3) { setNotice('Cần ghi rõ lý do khóa hoặc mở kỳ.'); return }
    setWorking('lock'); setNotice('')
    try {
      setScore(await setPerformanceSnapshotLock({ periodId, staffId, locked: !score.locked, reason: lockReason.trim() }))
      setLockReason(''); setNotice(score.locked ? 'Đã mở lại kỳ để điều chỉnh.' : 'Đã khóa phiếu Performance Score của kỳ.')
    } catch (cause) { setNotice(cause instanceof Error ? cause.message : 'Chưa thay đổi được trạng thái kỳ.') }
    finally { setWorking('') }
  }

  const isFallback = metricDraft.source !== 'manager_review'
  return <section className="performance-scorecard-review" aria-label="Phiếu Aura PT Performance Score">
    <header className="performance-scorecard-review__header">
      <span><ClipboardCheck /></span><div><small>PHIẾU KPI THÁNG · 100 ĐIỂM</small><h2>Chấm Aura PT Performance Score</h2><p>Điểm, nguồn dữ liệu, Gate và mọi thay đổi đều được lưu lịch sử audit.</p></div>
      <label><span>Chọn PT</span><select value={staffId} onChange={(event) => setStaffId(event.target.value)}><option value="">Chọn nhân sự</option>{staff.map((item) => <option key={item.staffId} value={item.staffId}>{item.name}</option>)}</select></label>
      <button type="button" disabled={!staffId || loading} onClick={() => void load()} aria-label="Tải lại phiếu"><RefreshCw /></button>
    </header>

    {loading && <div className="performance-scorecard-review__state"><LoaderCircle className="spin" /> Đang tổng hợp 25 chỉ số…</div>}
    {error && <div className="performance-scorecard-review__state is-error"><AlertTriangle /> {error}</div>}
    {notice && <div className="performance-scorecard-review__state"><CheckCircle2 /> {notice}</div>}

    {score && !loading && <>
      <div className="performance-scorecard-review__summary">
        <article><small>ĐIỂM {score.score.value === null ? 'TẠM TÍNH' : 'CHÍNH THỨC'}</small><strong>{score.score.value ?? score.score.provisionalValue}<em>/100</em></strong><span>{score.coverage.availableWeight}/100 trọng số đã xác minh</span></article>
        <article><small>XẾP LOẠI</small><strong>{score.bonus.classification}</strong><span>{score.bonus.eligibility === 'eligible' ? 'Đủ điều kiện thưởng' : score.bonus.eligibility === 'ineligible' ? 'Không đủ Gate' : 'Chờ đủ dữ liệu/Gate'}</span></article>
        <article><small>THƯỞNG ĐỀ XUẤT</small><strong>{score.bonus.recommendedAmount === null ? '—' : `${score.bonus.recommendedAmount.toLocaleString('vi-VN')}đ`}</strong><span>Chưa tự ghi vào payroll</span></article>
      </div>
      <div className="performance-scorecard-review__gates">{score.gates.map((gate) => <button type="button" className={`is-${gate.status}`} key={gate.id} disabled={score.locked || gate.id === 'quality'} onClick={() => openGate(gate)}><span><b>{gate.label}</b><small>{gate.reason}</small></span><em>{gateCopy(gate.status)}</em>{gate.id !== 'quality' && !score.locked && <Edit3 />}</button>)}</div>
      <div className="performance-scorecard-review__categories">{score.categories.map((category) => <section key={category.id}>
        <header><div><strong>{category.label}</strong><small>{category.availableWeight}/{category.weight} trọng số có dữ liệu</small></div><b>{category.score === null ? 'N/A' : `${category.score}/${category.weight}`}</b></header>
        <div>{category.submetrics.map((metric) => <article className={`is-${metric.status}`} key={metric.id}>
          <span><strong>{metric.label}</strong><small>{metric.note || metric.reason || statusCopy(metric.status)}</small><em>{metric.source || 'Chưa xác định nguồn'}</em></span>
          <b>{metric.score === null ? 'N/A' : `${metric.score}/${metric.weight}`}</b>
          {!BRAND_METRICS.has(metric.id) && <button type="button" disabled={score.locked} onClick={() => openMetric(metric)} aria-label={`Chấm ${metric.label}`}><Edit3 /></button>}
        </article>)}</div>
      </section>)}</div>
      {canLock && <footer className="performance-scorecard-review__lock"><div><strong>{score.locked ? 'Kỳ đã khóa' : 'Khóa kỳ sau khi đủ dữ liệu và Gate'}</strong><span>Khóa giữ nguyên công thức, chi tiết chỉ số và bằng chứng để đối soát.</span></div><input value={lockReason} maxLength={500} onChange={(event) => setLockReason(event.target.value)} placeholder="Lý do khóa/mở kỳ…" /><button type="button" disabled={Boolean(working)} onClick={() => void toggleLock()}>{score.locked ? <Unlock /> : <Lock />} {score.locked ? 'Mở kỳ' : 'Khóa kỳ'}</button></footer>}
    </>}

    {editingMetric && <div className="performance-scorecard-review__editor" role="dialog" aria-modal="true" aria-label={`Chấm ${editingMetric.label}`}>
      <header><div><small>{editingMetric.id}</small><strong>{editingMetric.label} · tối đa {editingMetric.weight} điểm</strong></div><button type="button" onClick={() => setEditingMetric(null)} aria-label="Đóng"><X /></button></header>
      <label><span>Nguồn đánh giá</span><select value={metricDraft.source} onChange={(event) => setMetricDraft((current) => ({ ...current, source: event.target.value as PerformanceAssessmentSource }))}>{Object.entries(SOURCE_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
      {isFallback ? <label><span>Điểm được duyệt (0–{editingMetric.weight})</span><input type="number" min="0" max={editingMetric.weight} step="0.1" value={metricDraft.manualScore} onChange={(event) => setMetricDraft((current) => ({ ...current, manualScore: event.target.value }))} /></label> : <>
        {ACTUAL_METRICS.has(editingMetric.id) && <label><span>{editingMetric.id === 'coaching_audit' ? 'Điểm audit /100' : editingMetric.id === 'customer_rating' ? 'Rating trung bình /5' : 'Tỷ lệ thực tế (%)'}</span><input type="number" min="0" step="0.01" value={metricDraft.actual} onChange={(event) => setMetricDraft((current) => ({ ...current, actual: event.target.value }))} /></label>}
        {ACTUAL_TARGET_METRICS.has(editingMetric.id) && <><label><span>Thực tế</span><input type="number" min="0" step="0.01" value={metricDraft.actual} onChange={(event) => setMetricDraft((current) => ({ ...current, actual: event.target.value }))} /></label><label><span>Target đã duyệt</span><input type="number" min="0" step="0.01" value={metricDraft.target} onChange={(event) => setMetricDraft((current) => ({ ...current, target: event.target.value }))} /></label></>}
        {RATIO_METRICS.has(editingMetric.id) && <><label><span>Số hoàn tất đúng hạn</span><input type="number" min="0" step="1" value={metricDraft.numerator} onChange={(event) => setMetricDraft((current) => ({ ...current, numerator: event.target.value }))} /></label><label><span>Tổng số đến hạn</span><input type="number" min="1" step="1" value={metricDraft.denominator} onChange={(event) => setMetricDraft((current) => ({ ...current, denominator: event.target.value }))} /></label></>}
        {!ACTUAL_METRICS.has(editingMetric.id) && !ACTUAL_TARGET_METRICS.has(editingMetric.id) && !RATIO_METRICS.has(editingMetric.id) && <label><span>Điểm rubric đã duyệt (0–{editingMetric.weight})</span><input type="number" min="0" max={editingMetric.weight} step="0.1" value={metricDraft.manualScore} onChange={(event) => setMetricDraft((current) => ({ ...current, manualScore: event.target.value }))} /></label>}
        {['customer_rating', 'renew_rate'].includes(editingMetric.id) && <label><span>Điểm rubric nếu dưới ngưỡng tự động</span><input type="number" min="0" max={editingMetric.id === 'customer_rating' ? 4 : 5} step="0.1" value={metricDraft.manualScore} onChange={(event) => setMetricDraft((current) => ({ ...current, manualScore: event.target.value }))} /></label>}
      </>}
      <label><span>Cỡ mẫu (nếu có)</span><input type="number" min="0" step="1" value={metricDraft.sampleSize} onChange={(event) => setMetricDraft((current) => ({ ...current, sampleSize: event.target.value }))} /></label>
      <label className="is-wide"><span>Nguồn/bằng chứng — mỗi dòng một tham chiếu</span><textarea rows={2} value={metricDraft.evidenceRefs} onChange={(event) => setMetricDraft((current) => ({ ...current, evidenceRefs: event.target.value }))} placeholder="sessionFeedback/... hoặc mã biên bản" /></label>
      <label className="is-wide"><span>Lý do và ghi chú bắt buộc</span><textarea rows={3} maxLength={500} value={metricDraft.note} onChange={(event) => setMetricDraft((current) => ({ ...current, note: event.target.value }))} /></label>
      <footer><button type="button" onClick={() => setEditingMetric(null)}>Hủy</button><button type="button" className="is-primary" disabled={working === 'metric' || metricDraft.note.trim().length < 3} onClick={() => void saveMetric()}>{working === 'metric' ? <LoaderCircle className="spin" /> : <Save />} Lưu chỉ số</button></footer>
    </div>}

    {editingGate && <div className="performance-scorecard-review__editor is-gate" role="dialog" aria-modal="true" aria-label={`Kết luận ${editingGate.label}`}>
      <header><div><small>GATE BẮT BUỘC</small><strong>{editingGate.label}</strong></div><button type="button" onClick={() => setEditingGate(null)} aria-label="Đóng"><X /></button></header>
      <label><span>Kết luận</span><select value={gateStatus} onChange={(event) => setGateStatus(event.target.value as typeof gateStatus)}><option value="pass">Đạt</option><option value="fail">Không đạt</option><option value="unknown">Chưa kết luận</option></select></label>
      <label className="is-wide"><span>Bằng chứng — mỗi dòng một tham chiếu</span><textarea rows={2} value={gateEvidence} onChange={(event) => setGateEvidence(event.target.value)} /></label>
      <label className="is-wide"><span>Lý do kết luận bắt buộc</span><textarea rows={3} maxLength={500} value={gateReason} onChange={(event) => setGateReason(event.target.value)} /></label>
      <div className="performance-scorecard-review__gate-warning"><ShieldAlert /> Fail Safety hoặc Integrity làm KPI Bonus bằng 0 nhưng không tự cắt lương hay tiền ca hợp lệ.</div>
      <footer><button type="button" onClick={() => setEditingGate(null)}>Hủy</button><button type="button" className="is-primary" disabled={working === 'gate' || gateReason.trim().length < 3} onClick={() => void saveGate()}><Save /> Lưu Gate</button></footer>
    </div>}
  </section>
}
