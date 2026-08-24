import { useCallback, useEffect, useMemo, useState } from 'react'
import { createQuote, getMySalesCatalog, listMyQuotes, type SalesCatalog, type SalesQuoteSummary } from '../../services/ptOperationsV2Service'
import './OperationsPortalV2.css'

function vnd(value: number) { return new Intl.NumberFormat('vi-VN').format(value) + 'đ' }

export default function SalesPortalV2({ embedded = false }: { embedded?: boolean }) {
  const [quotes, setQuotes] = useState<SalesQuoteSummary[]>([])
  const [catalog, setCatalog] = useState<SalesCatalog>({ branches: [], packages: [] })
  const [form, setForm] = useState({ customerName: '', customerPhone: '', branchId: '', packageId: '', discount: 0 })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const availablePackages = useMemo(() => catalog.packages.filter((item) => !item.branchId || item.branchId === form.branchId), [catalog.packages, form.branchId])
  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const [quoteResult, catalogResult] = await Promise.all([listMyQuotes(), getMySalesCatalog()])
      setQuotes(quoteResult.quotes); setCatalog(catalogResult)
      setForm((current) => ({ ...current, branchId: current.branchId || catalogResult.branches[0]?.id || '', packageId: current.packageId || catalogResult.packages[0]?.id || '' }))
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Không thể tải dữ liệu bán hàng.') }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { void load() }, [load])

  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setSaving(true); setError('')
    try { await createQuote(form); setForm((current) => ({ ...current, customerName: '', customerPhone: '', discount: 0 })); await load() }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Không thể tạo báo giá.') }
    finally { setSaving(false) }
  }

  return <section className={`opv2-page${embedded ? ' is-embedded' : ''}`}>
    {!embedded && <section className="opv2-hero"><p className="opv2-kicker">Aura Sales · Phạm vi được cấp</p><h1>Báo giá & khách hàng</h1><p>Dữ liệu được backend giới hạn theo nhân viên phụ trách và chi nhánh được cấp.</p></section>}
    <section className="opv2-summary"><div className="opv2-stat"><strong>{quotes.length}</strong><span>báo giá trong phạm vi</span></div><div className="opv2-stat"><strong>{catalog.branches.length}</strong><span>chi nhánh được cấp</span></div></section>
    {error && <div className="opv2-state is-error">{error}</div>}
    <h2 className="opv2-section-title">Tạo báo giá an toàn</h2>
    <form className="opv2-form" onSubmit={submit}><label className="opv2-field">Tên khách hàng<input required value={form.customerName} onChange={(e) => setForm({ ...form, customerName: e.target.value })} /></label><label className="opv2-field">Số điện thoại<input required inputMode="tel" value={form.customerPhone} onChange={(e) => setForm({ ...form, customerPhone: e.target.value })} /></label><label className="opv2-field">Chi nhánh<select required value={form.branchId} onChange={(e) => setForm({ ...form, branchId: e.target.value, packageId: '' })}><option value="">Chọn chi nhánh</option>{catalog.branches.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label><label className="opv2-field">Gói tập<select required value={form.packageId} onChange={(e) => setForm({ ...form, packageId: e.target.value })}><option value="">Chọn gói</option>{availablePackages.map((item) => <option value={item.id} key={item.id}>{item.name} · {vnd(item.price)}</option>)}</select></label><label className="opv2-field">Ưu đãi<input type="number" min="0" value={form.discount} onChange={(e) => setForm({ ...form, discount: Number(e.target.value) })} /></label><button className="opv2-action" disabled={saving || loading}>{saving ? 'Đang tạo…' : 'Tạo báo giá'}</button></form>
    <h2 className="opv2-section-title">Báo giá thuộc phạm vi</h2><div className="opv2-list">{quotes.map((quote) => <article className="opv2-card" key={quote.id}><div className="opv2-card-head"><div><h3>{quote.customerName}</h3><p>{quote.code} · {quote.customerPhone}</p></div><span className="opv2-badge">{quote.status}</span></div><p>{quote.packageName}</p><div className="opv2-price">{vnd(quote.finalPrice)}</div></article>)}{!loading && quotes.length === 0 && <div className="opv2-state">Chưa có báo giá trong phạm vi của bạn.</div>}</div>
  </section>
}
