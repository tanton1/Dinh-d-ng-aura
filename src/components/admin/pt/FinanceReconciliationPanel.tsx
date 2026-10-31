import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronRight, CircleAlert, FileSearch, Search, X } from 'lucide-react'
import type { BusinessPerformanceReport } from '../../../services/businessReportingService'
import { businessReportCompleteness } from '../../../utils/businessReportCompleteness'
import { getFinanceReconciliationCase, listFinanceReconciliationCases, resolveFinanceReconciliationCase, type ReconciliationCase, type ReconciliationRow, type ReviewContract } from '../../../services/financeReconciliationService'
import './finance-reconciliation.css'

const money = (value: number) => Math.round(value).toLocaleString('vi-VN') + 'đ'
const date = (value: string) => value ? value.slice(0, 10).split('-').reverse().join('/') : 'Chưa có ngày'
const pendingKeys = ['billingReview', 'recognitionReview', 'pendingConfirmation', 'automaticReview', 'unresolved', 'conflicts', 'missingBranch']
const labels: Record<string, string> = {
  billingReview: 'Hạn mức hợp đồng', recognitionReview: 'Giá trị doanh thu', pendingConfirmation: 'Chờ khớp bút toán',
  automaticReview: 'Điểm danh tự động', unresolved: 'Liên kết / kỳ ghi nhận', conflicts: 'Bằng chứng mâu thuẫn', missingBranch: 'Thiếu chi nhánh',
  posted: 'Đã khớp doanh thu', zeroValueConfirmed: 'Giá trị 0đ đã xác minh', exempt: 'Không tính buổi / đã loại trừ',
  duplicate: 'Bản ghi trùng', returned: 'Đã hoàn buổi', complimentary: 'Buổi bù / miễn trừ', other: 'Miễn trừ cần xem lý do',
}
const issues: Record<string, string> = {
  CONTRACT_QUOTA_EXHAUSTED: 'Hợp đồng đã hết số buổi. Chưa trừ buổi này và chưa ghi doanh thu.',
  RECOGNITION_ZERO_VALUE_REQUIRES_REVIEW: 'Giá trị hợp đồng nguồn sau giảm giá là 0đ. Cần xác minh ưu đãi hoặc chứng từ gốc.',
  RECOGNITION_CARRY_VALUE_REQUIRES_REVIEW: 'Cần kiểm tra giá trị buổi chuyển tiếp từ hợp đồng gốc.',
  FINANCE_PERIOD_LOCKED: 'Kỳ tài chính đã khóa. Cần điều chỉnh tại kỳ mở.',
  RECOGNITION_SERVICE_ORDINAL_COLLISION: 'Số thứ tự buổi đang trùng với một bút toán khác.',
}
const actionLabels: Record<string, string> = { acknowledge: 'Đã kiểm tra', recognize: 'Đã đối soát doanh thu', confirm_zero: 'Đã xác minh giá trị 0đ', exempt: 'Đã duyệt không trừ buổi', assign_contract: 'Đã tính vào hợp đồng hợp lệ' }
function explanation(row: ReconciliationRow) {
  if (row.category === 'exempt') return labels[row.exemptionKind] || labels.exempt
  return issues[row.issueCode] || labels[row.category] || 'Cần mở bằng chứng để kiểm tra liên kết và kỳ ghi nhận.'
}
function ContractEvidence({ value, title }: { value: ReviewContract; title: string }) {
  return <section className="finance-review-case__contract"><h4>{title}</h4><strong>{value.packageName}</strong>
    <p>{date(value.startDate)} – {date(value.endDate)} · Đã dùng {value.usedSessions}/{value.totalSessions} buổi</p>
    <dl><div><dt>Giá hợp đồng</dt><dd>{value.totalPrice === null ? 'Chưa có' : money(value.totalPrice)}</dd></div>
      <div><dt>Giảm giá</dt><dd>{money(value.discount)}</dd></div><div><dt>Giá trị ròng</dt><dd>{value.totalPrice === null ? 'Chưa xác định' : money(value.totalPrice - value.discount)}</dd></div>
      <div><dt>Đã thu</dt><dd>{value.paidAmount === null ? 'Chưa có' : money(value.paidAmount)}</dd></div></dl><small>Mã hợp đồng: {value.id}</small></section>
}

function CaseDialog({ attendanceId, onClose, onChanged }: { attendanceId: string; onClose: () => void; onChanged: () => Promise<void> }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [detail, setDetail] = useState<ReconciliationCase | null>(null)
  const [target, setTarget] = useState('')
  const [action, setAction] = useState('acknowledge')
  const [reason, setReason] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [generation, setGeneration] = useState(0)
  const attempt = useRef({ signature: '', requestId: '' })
  useEffect(() => { const el = dialog.current; el?.showModal(); return () => { el?.close() } }, [])
  useEffect(() => {
    let current = true
    setLoading(true); setDetail(null); setError(''); setConfirmed(false)
    void getFinanceReconciliationCase(attendanceId, target).then(value => {
      if (!current) return
      setDetail(value)
      setAction(previous => value.actions.some(a => a.id === previous) ? previous : value.actions[0]?.id || '')
    }).catch(cause => { if (current) setError(cause instanceof Error ? cause.message : 'Không thể tải bằng chứng.') })
      .finally(() => { if (current) setLoading(false) })
    return () => { current = false }
  }, [attendanceId, target, generation])
  const effect = detail?.actions.find(item => item.id === action)
  const financial = action !== 'acknowledge'
  const submit = async () => {
    if (!detail || !effect || saving || loading || reason.trim().length < 5 || (financial && !confirmed)) return
    const input = { attendanceId, targetContractId: target, action, reason: reason.trim(), token: detail.token }
    const signature = JSON.stringify(input)
    if (attempt.current.signature !== signature) attempt.current = { signature, requestId: crypto.randomUUID() }
    setSaving(true); setError(''); setNotice('')
    try {
      await resolveFinanceReconciliationCase({ ...input, requestId: attempt.current.requestId })
      setNotice(action === 'acknowledge' ? 'Đã lưu việc kiểm tra. Mục cần xử lý vẫn được giữ nếu dữ liệu chưa khớp.' : 'Đã xử lý và lưu lịch sử đối soát.')
      setReason(''); setConfirmed(false); setGeneration(n => n + 1)
      await onChanged()
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Chưa xác nhận được kết quả. Mở lại bằng chứng trước khi thử lại.') }
    finally { setSaving(false) }
  }
  return <dialog ref={dialog} className="finance-review-case" aria-labelledby="finance-review-case-title" onCancel={event => { event.preventDefault(); if (!saving) onClose() }}>
    <header><div><h3 id="finance-review-case-title">Bằng chứng đối soát</h3><p>{detail ? `${detail.studentName} · ${date(detail.date)}${detail.hour === null ? '' : ` lúc ${detail.hour}:00`}` : 'Đang mở hồ sơ…'}</p></div><button type="button" aria-label="Đóng bằng chứng" disabled={saving} onClick={onClose}><X size={21} /></button></header>
    <div className="finance-review-case__body" aria-busy={loading}>
      {notice && <p className="finance-review-notice is-success" role="status"><Check size={18} />{notice}</p>}
      {error && <div className="finance-review-notice" role="alert"><CircleAlert size={18} /><span>{error}</span><button disabled={saving || loading} onClick={() => setGeneration(n => n + 1)}>Tải lại</button></div>}
      {loading && <p role="status">Đang kiểm tra bằng chứng mới nhất…</p>}
      {detail && <>
        <div className="finance-review-case__reason"><strong>{labels[detail.category]}</strong><p>{explanation(detail)}</p>{detail.reason && <p>Lý do đã lưu: {detail.reason}</p>}</div>
        <dl className="finance-review-case__facts"><div><dt>PT phụ trách</dt><dd>{detail.trainerName}</dd></div><div><dt>Điểm danh</dt><dd>{{ present: 'Có tập', late: 'Đi trễ', no_show: 'Không đến', pending: 'Chờ xác nhận', policy_charge: 'Tính theo chính sách' }[detail.attendanceStatus] || detail.attendanceStatus}</dd></div>
          <div><dt>Trừ buổi</dt><dd>{detail.billingStatus === 'charged' ? 'Đã trừ 1 buổi' : detail.category === 'exempt' ? 'Không trừ / đã hoàn' : 'Chưa trừ buổi'}</dd></div><div><dt>Thứ tự tính buổi</dt><dd>{detail.billing?.ordinal ?? 'Chưa có'}</dd></div></dl>
        {detail.contract && <ContractEvidence value={detail.contract} title="Hợp đồng sử dụng buổi" />}
        {detail.usageProof && <p className="finance-review-notice">Đã đối chiếu {detail.usageProof.chargedSessions} buổi thực trừ với hợp đồng. Bản ghi này còn số thứ tự cũ {detail.usageProof.retainedOrdinal}, nhưng chưa có chứng từ trừ buổi. Duyệt miễn trừ sẽ giữ nguyên số buổi đã dùng.</p>}
        {detail.revenueContract && detail.revenueContract.id !== detail.contract?.id && <ContractEvidence value={detail.revenueContract} title="Hợp đồng gốc cung cấp giá trị buổi chuyển tiếp" />}
        <section><h4>Bút toán liên quan</h4>{detail.ledger.length ? <ul className="finance-review-case__ledger">{detail.ledger.map(entry => <li key={entry.id}><div><b>{date(entry.date)}</b><small>{entry.status === 'reversed' ? 'Đã đảo' : 'Đã ghi nhận'} · {entry.id}</small></div><span>Doanh thu <strong>{money(entry.revenue)}</strong><small>Tiền thu {money(entry.cash)}</small></span></li>)}</ul>
          : <p>{detail.category === 'zeroValueConfirmed' ? 'Đã xác minh doanh thu 0đ. Biên bản xác nhận được lưu trong lịch sử.' : 'Chưa tìm thấy bút toán liên quan, kể cả ngoài kỳ đang xem.'}</p>}</section>
        {detail.returned && <p className="finance-review-notice is-success">Đã hoàn {detail.returned.returnedSessions} buổi; đảo doanh thu {money(detail.returned.revenueReversed)}. {detail.returned.reason}</p>}
        <div className="finance-review-case__links"><a href={`#/admin-training-history?studentId=${encodeURIComponent(detail.studentId)}&sessionId=${encodeURIComponent(detail.sessionId)}&date=${detail.date}`}>Mở lịch sử / điều chỉnh buổi</a>
          <a href={`#/student-360?studentId=${encodeURIComponent(detail.studentId)}&source=admin-finance`}>Mở hồ sơ và hợp đồng</a>
          {detail.duplicateOfSessionId && <a href={`#/admin-training-history?studentId=${encodeURIComponent(detail.studentId)}&sessionId=${encodeURIComponent(detail.duplicateOfSessionId)}&date=${detail.date}`}>Xem buổi gốc của bản ghi trùng</a>}</div>
        {detail.blockers.map(message => <p key={message} className="finance-review-notice">{message}</p>)}
        {detail.actions.length > 0 && <fieldset disabled={saving || loading} className="finance-review-case__resolution"><legend>Xác nhận xử lý</legend>
          {detail.category === 'billingReview' && <label>Hợp đồng để tính buổi<select aria-label="Hợp đồng để tính buổi" value={target} onChange={event => setTarget(event.target.value)}><option value="">Chọn hợp đồng hợp lệ nếu cần tính buổi</option>{detail.candidates.map(c => <option key={c.id} value={c.id}>{c.packageName} · còn {c.totalSessions - c.usedSessions} buổi · {date(c.startDate)}</option>)}</select><small>{detail.candidates.length ? 'Chỉ hiện hợp đồng còn buổi và có hiệu lực vào ngày tập.' : 'Chưa có hợp đồng đủ điều kiện cho ngày tập. Có thể mở hồ sơ để kiểm tra hoặc duyệt miễn trừ có lý do.'}</small></label>}
          <label>Thao tác<select aria-label="Thao tác đối soát" value={action} onChange={event => { setAction(event.target.value); setConfirmed(false) }}>{detail.actions.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
          {effect && <div className="finance-review-case__preview"><strong>Tác động khi xác nhận</strong><p>{effect.sessionsDelta ? `Trừ thêm ${effect.sessionsDelta} buổi vào hợp đồng đã chọn.` : 'Số buổi đã trừ giữ nguyên.'}</p><p>Doanh thu thay đổi: <b>{money(effect.revenueDelta)}</b> · Tiền thu: <b>{money(effect.cashDelta)}</b></p>{action === 'confirm_zero' && <p>Giữ buổi đã trừ và xác minh doanh thu 0đ theo giá trị hợp đồng nguồn.</p>}{action === 'acknowledge' && <p>Ghi chú kiểm tra được lưu. Sai lệch chưa xử lý vẫn xuất hiện trong danh sách.</p>}</div>}
          <label>Lý do và căn cứ<textarea aria-label="Lý do và căn cứ" value={reason} onChange={event => setReason(event.target.value)} maxLength={1000} rows={3} placeholder="Ghi chứng từ, ưu đãi hoặc kết quả đối chiếu…" /></label>
          {financial && <label className="finance-review-case__confirm"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />Tôi đã kiểm tra bằng chứng và đồng ý với tác động trên.</label>}
          <button className="finance-review-primary" type="button" disabled={!effect || reason.trim().length < 5 || (financial && !confirmed)} onClick={() => void submit()}>{saving ? 'Đang lưu…' : effect?.label || 'Xác nhận'}</button>
        </fieldset>}
        <section className="finance-review-case__history"><h4>Lịch sử đối soát</h4>{detail.history.length ? <ol>{detail.history.map(item => <li key={item.id}><strong>{actionLabels[item.action] || item.action}</strong><p>{item.reason}</p><small>{item.actorName} · {new Date(item.createdAt).toLocaleString('vi-VN')}{item.action === 'acknowledge' && !item.currentEvidence ? ' · Bằng chứng đã thay đổi, cần kiểm tra lại' : ''}</small></li>)}</ol> : <p>Chưa có xác nhận xử lý.</p>}</section>
      </>}
    </div>
  </dialog>
}

export default function FinanceReconciliationPanel({ report, onChanged }: { report: BusinessPerformanceReport; onChanged: () => Promise<void> }) {
  const quality = report.dataQuality, reconciliation = quality.reconciliation
  const complete = businessReportCompleteness(report)
  const [group, setGroup] = useState<'pending' | 'matched' | 'excluded' | null>(null)
  const [filter, setFilter] = useState('all')
  const [page, setPage] = useState(0)
  const [search, setSearch] = useState('')
  const [rows, setRows] = useState<ReconciliationRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState('')
  const scope = JSON.stringify([report.range, report.branchId])
  const previousScope = useRef(scope)
  useEffect(() => { if (previousScope.current !== scope) { setGroup(null); setSelected(''); setPage(0); previousScope.current = scope } }, [scope])
  const index = reconciliation?.caseIndex
  const keys = group === 'pending' ? pendingKeys : group === 'matched' ? ['posted', 'zeroValueConfirmed'] : ['duplicate', 'returned', 'complimentary', 'other']
  const ids = useMemo(() => [...new Set((filter === 'all' ? group === 'excluded' ? ['exempt'] : keys : [filter]).flatMap(key => index?.[key] || []))], [index, group, filter]) // eslint-disable-line react-hooks/exhaustive-deps
  const pageIds = ids.slice(page * 25, page * 25 + 25)
  const pageKey = JSON.stringify(pageIds)
  useEffect(() => {
    let current = true
    setRows([]); setError('')
    if (!group || !pageIds.length) { setLoading(false); return }
    setLoading(true)
    void listFinanceReconciliationCases(JSON.parse(pageKey) as string[]).then(result => { if (current) { setRows(result.rows); if (result.missing.length) setError('Một số bằng chứng đã thay đổi. Làm mới báo cáo để cập nhật danh sách.') } })
      .catch(cause => { if (current) setError(cause instanceof Error ? cause.message : 'Không thể mở danh sách đối soát.') })
      .finally(() => { if (current) setLoading(false) })
    return () => { current = false }
  }, [group, pageKey]) // eslint-disable-line react-hooks/exhaustive-deps
  const pending = reconciliation ? reconciliation.billingReview + reconciliation.recognitionReview + reconciliation.pendingConfirmation + reconciliation.automaticReview + reconciliation.unresolved + reconciliation.conflicts : 0
  const matched = (reconciliation?.matchedInPeriod || 0) + (reconciliation?.zeroValueConfirmed || 0)
  const select = (value: typeof group) => { setGroup(value === group ? null : value); setFilter('all'); setPage(0); setSearch('') }
  const filtered = rows.filter(row => `${row.studentName} ${row.trainerName}`.toLocaleLowerCase('vi').includes(search.toLocaleLowerCase('vi')))
  const supplementary = [quality.legacyUnclassifiedEntries ? `${quality.legacyUnclassifiedEntries} bút toán chưa phân loại` : '', quality.unlinkedCashTransactionCount ? `${quality.unlinkedCashTransactionCount} giao dịch sổ quỹ chưa liên kết` : '', quality.payrollPaidOutsideLedger ? `${money(quality.payrollPaidOutsideLedger)} lương cần đối chiếu` : '', quality.contractSalesDatesMissing ? `${quality.contractSalesDatesMissing} hợp đồng thiếu ngày doanh số` : ''].filter(Boolean)
  const incomplete = [!complete.attendance ? 'Chưa kiểm tra đủ dữ liệu chấm công' : '', !complete.cashReconciliation ? 'Chưa kiểm tra đủ liên kết sổ quỹ' : '', !complete.payrollReconciliation ? 'Chưa kiểm tra đủ lương đã trả' : '', !complete.cashAccounts ? 'Chưa kiểm tra đủ tài khoản sổ quỹ' : '', quality.contractsTruncated ? 'Chưa kiểm tra đủ hợp đồng' : ''].filter(Boolean)
  return <section className="finance-review" aria-label="Đối soát dữ liệu">
    <header className="finance-review__heading"><div><h2>Đối soát dữ liệu</h2><p>{complete.recognitionReconciliation ? `${(reconciliation?.evidenceCount || 0).toLocaleString('vi-VN')} bằng chứng PT trong kỳ` : 'Phạm vi chưa đủ dữ liệu để kết luận'} · {report.branchId === 'all' ? 'Toàn hệ thống' : 'Chi nhánh đang chọn'}</p></div><FileSearch size={24} /></header>
    <div className="finance-review__groups">{[
      { id: 'pending' as const, count: pending, title: 'Cần xử lý', note: 'Hạn mức, doanh thu và liên kết' },
      { id: 'matched' as const, count: matched, title: 'Đã khớp', note: 'Có bút toán hoặc xác minh 0đ' },
      { id: 'excluded' as const, count: reconciliation?.exempt || 0, title: 'Đã loại trừ', note: 'Miễn trừ, bản ghi trùng, hoàn buổi' },
    ].map(item => <button key={item.id} type="button" className={`${group === item.id ? 'is-selected' : ''} is-${item.id}`} aria-expanded={group === item.id} disabled={!index || !complete.attendance || !complete.recognitionReconciliation} onClick={() => select(item.id)}><span><strong>{item.title}</strong><small>{item.note}</small></span><b>{complete.recognitionReconciliation ? item.count.toLocaleString('vi-VN') : '—'}</b><ChevronRight size={17} /></button>)}</div>
    {!index && <p className="finance-review__hint">Làm mới báo cáo để mở danh sách từng buổi.</p>}
    {incomplete.length > 0 && <p className="finance-review__hint">{incomplete.join('. ')}. Thu hẹp phạm vi để kiểm tra đầy đủ.</p>}
    {supplementary.length > 0 && <p className="finance-review__hint">{supplementary.join(' · ')}</p>}
    {(reconciliation?.missingBranch || 0) > 0 && <p className="finance-review__hint">Có {reconciliation?.missingBranch} bằng chứng thiếu chi nhánh; xem trong nhóm Cần xử lý.</p>}
    {group && <div className="finance-review__workspace">
      <div className="finance-review__filters"><label>Phân loại<select aria-label="Phân loại đối soát" value={filter} onChange={event => { setFilter(event.target.value); setPage(0); setSearch('') }}><option value="all">Tất cả trong nhóm</option>{keys.filter(key => index?.[key]?.length).map(key => <option key={key} value={key}>{labels[key]} ({index?.[key]?.length})</option>)}</select></label><label className="finance-review__search"><Search size={16} /><input aria-label="Tìm học viên hoặc PT trong trang" placeholder="Tìm học viên / PT trong trang" value={search} onChange={event => setSearch(event.target.value)} /></label></div>
      {error && <p role="alert" className="finance-review-notice">{error}</p>}
      {loading ? <p role="status" className="finance-review__empty">Đang mở danh sách…</p> : filtered.length ? <ul className="finance-review__list">{filtered.map(row => <li key={row.attendanceId}><button type="button" onClick={() => setSelected(row.attendanceId)}><span className="finance-review__date">{date(row.date)}<small>{row.hour === null ? '' : `${row.hour}:00`}</small></span><span className="finance-review__person"><strong>{row.studentName}</strong><small>PT {row.trainerName}</small><span>{group === 'matched' && row.category !== 'zeroValueConfirmed' ? 'Mở bút toán và bằng chứng' : explanation(row)}</span></span><ChevronRight size={18} /></button></li>)}</ul> : <p className="finance-review__empty">{search ? 'Không có kết quả trong trang này.' : 'Không có buổi trong nhóm đã chọn.'}</p>}
      <footer className="finance-review__pagination"><span>{ids.length ? `${page * 25 + 1}–${Math.min((page + 1) * 25, ids.length)} / ${ids.length} mục` : '0 mục'}</span><div><button disabled={page === 0 || loading} onClick={() => setPage(p => p - 1)}>Trước</button><button disabled={(page + 1) * 25 >= ids.length || loading} onClick={() => setPage(p => p + 1)}>Tiếp</button></div></footer>
    </div>}
    <details className="finance-review__other"><summary>Kiểm tra khác và phạm vi dữ liệu{supplementary.length > 0 ? ` (${supplementary.length})` : ''}</summary>{supplementary.length ? <ul>{supplementary.map(item => <li key={item}>{item}</li>)}</ul> : <p>Chưa có cảnh báo khác trong dữ liệu đã tải.</p>}<p>{quality.cashAccounts || 0} tài khoản sổ quỹ. Các nguồn chưa tích hợp: {quality.missingSourceIntegrations.map(s => ({ online_coaching: 'Coaching online', nutrition_coaching: 'Dinh dưỡng', academy: 'Aura Academy' })[s] || s).join(', ') || 'không có'}.</p><p>Đối soát PT theo ngày và chi nhánh; bộ lọc nguồn chỉ áp dụng cho báo cáo kinh doanh.</p></details>
    {selected && <CaseDialog key={selected} attendanceId={selected} onClose={() => setSelected('')} onChanged={onChanged} />}
  </section>
}
