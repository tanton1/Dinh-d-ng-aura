import { AlertTriangle, Copy, PlugZap, RefreshCw, Webhook } from 'lucide-react'
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { CRM_STAGES, PLATFORM_LABELS, STAGE_LABELS, ago, formatDateTime } from './crmFormat'
import { crmErrorMessage, type CrmService } from './crmService'
import type { CrmIntegrationOverview, CrmPancakePage, CrmPlatform, CrmStaffMember } from './crmTypes'
import { ErrorBanner, Loading, Notice, Spinner } from './crmUi'

export function CrmIntegrationTab({ service }: { service: CrmService }) {
  const [overview, setOverview] = useState<CrmIntegrationOverview | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [revealed, setRevealed] = useState<{ pageId: string; url: string } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      setOverview(await service.integrationOverview())
    } catch (cause) {
      setError(crmErrorMessage(cause, 'Chưa tải được kết nối Pancake.'))
    } finally {
      setLoading(false)
    }
  }, [service])

  useEffect(() => { void load() }, [load])

  const replacePage = (page: CrmPancakePage) => setOverview((current) => current && ({
    ...current,
    pages: current.pages.some((item) => item.pageId === page.pageId) ? current.pages.map((item) => (item.pageId === page.pageId ? page : item)) : [...current.pages, page],
  }))

  return <div className="crm-integration">
    <div className="crm-toolbar">
      <span className="crm-toolbar__summary">{overview ? `${overview.pages.filter((page) => page.enabled).length} page đang đồng bộ` : ''}</span>
      <button type="button" className="crm-icon-button" onClick={() => void load()} aria-label="Làm mới trạng thái kết nối" disabled={loading}>{loading ? <Spinner /> : <RefreshCw size={16} />}</button>
    </div>
    <ErrorBanner message={error} onRetry={() => void load()} />
    {revealed && <WebhookReveal url={revealed.url} onDone={() => setRevealed(null)} />}
    {loading && !overview ? <Loading label="Đang tải kết nối…" /> : overview && <>
      {overview.pages.map((page) => <PageCard key={page.pageId} page={page} overview={overview} service={service} onPage={replacePage} onReveal={(url) => setRevealed({ pageId: page.pageId, url })} />)}
      <ConnectForm overview={overview} service={service} onConnected={(page, url) => { replacePage(page); setRevealed({ pageId: page.pageId, url }) }} />
    </>}
  </div>
}

function WebhookReveal({ url, onDone }: { url: string; onDone: () => void }) {
  const [copied, setCopied] = useState(false)
  return <section className="crm-section crm-reveal" aria-labelledby="crm-webhook-title">
    <h2 id="crm-webhook-title"><Webhook size={17} aria-hidden="true" /> URL webhook — chỉ hiện một lần</h2>
    <p>Mở Pancake, vào cài đặt webhook của page, dán URL này và bật các sự kiện tin nhắn (messaging) và hội thoại (conversation). URL chứa khóa bí mật; không gửi qua chat công khai.</p>
    <div className="crm-reveal__url">
      <code>{url}</code>
      <button type="button" className="crm-button" onClick={async () => { try { await navigator.clipboard.writeText(url); setCopied(true) } catch { setCopied(false) } }}><Copy size={15} /> {copied ? 'Đã sao chép' : 'Sao chép'}</button>
    </div>
    <button type="button" className="crm-button crm-button--primary" onClick={onDone}>Tôi đã dán vào Pancake</button>
  </section>
}

function PageCard({ page, overview, service, onPage, onReveal }: {
  page: CrmPancakePage
  overview: CrmIntegrationOverview
  service: CrmService
  onPage: (page: CrmPancakePage) => void
  onReveal: (url: string) => void
}) {
  const [branchId, setBranchId] = useState(page.branchId || '')
  const [enabled, setEnabled] = useState(page.enabled)
  const [tagMap, setTagMap] = useState<Record<string, string>>(() => ({ ...page.tagMap }) as Record<string, string>)
  const [staffMap, setStaffMap] = useState<Record<string, string>>(() => Object.fromEntries(Object.entries(page.staffMap).map(([key, value]) => [key, value.uid])))
  const [staff, setStaff] = useState<CrmStaffMember[]>([])
  const [token, setToken] = useState('')
  const [days, setDays] = useState(90)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  useEffect(() => {
    if (!branchId) return
    let active = true
    service.staff(branchId).then((result) => { if (active) setStaff(result.staff) }).catch(() => {})
    return () => { active = false }
  }, [branchId, service])

  const act = async (name: string, action: () => Promise<unknown>, success: string) => {
    setBusy(name)
    setError('')
    setNotice('')
    try {
      await action()
      setNotice(success)
    } catch (cause) {
      setError(crmErrorMessage(cause))
    } finally {
      setBusy('')
    }
  }

  const save = (event: FormEvent) => {
    event.preventDefault()
    void act('save', async () => {
      const result = await service.updatePage({ pageId: page.pageId, expectedRevision: page.revision, branchId: branchId || undefined, enabled, tagMap, staffMap })
      onPage(result.page)
    }, 'Đã lưu cấu hình page.')
  }

  const webhookAge = page.webhookLastReceivedAt ? ago(page.webhookLastReceivedAt) : 'chưa nhận lần nào'
  const statusLabel = page.status === 'needs_reconnect' ? 'Cần kết nối lại' : page.enabled ? 'Đang đồng bộ' : 'Đã tắt'

  return <section className="crm-section crm-page-card" aria-labelledby={`crm-page-${page.pageId}`}>
    <header className="crm-section__head">
      <div>
        <h2 id={`crm-page-${page.pageId}`}>{page.name}</h2>
        <p>{PLATFORM_LABELS[page.platform] || page.platform} · mã page {page.pageId}{page.webhookSecretHint ? ` · khóa …${page.webhookSecretHint}` : ''}</p>
      </div>
      <span className={`crm-chip crm-chip--${page.status === 'needs_reconnect' ? 'danger' : page.enabled ? 'success' : 'neutral'}`}>{statusLabel}</span>
    </header>
    <dl className="crm-health">
      <div><dt>Webhook</dt><dd>{webhookAge}</dd></div>
      <div><dt>Đối soát</dt><dd>{page.lastReconcileAt ? `${ago(page.lastReconcileAt)}${page.lastReconcileSynced ? ` · bù ${page.lastReconcileSynced} hội thoại` : ''}` : '—'}</dd></div>
      <div><dt>Lịch sử</dt><dd>{page.backfill ? page.backfill.status === 'running' ? `Đang lấy · ${page.backfill.conversations} hội thoại` : `Xong · ${page.backfill.conversations} hội thoại` : 'Chưa lấy'}</dd></div>
    </dl>
    {page.webhookSuspectedDown && <div className="crm-banner crm-banner--warning" role="status"><AlertTriangle size={16} aria-hidden="true" /><span>Đối soát tìm thấy tin mới nhưng webhook im lặng hơn 15 phút. Pancake có thể đã tạm ngưng webhook do lỗi; hãy kiểm tra và bật lại trong cài đặt Pancake. Tin vẫn về qua đối soát 5 phút.</span></div>}
    {page.lastError && <div className="crm-banner crm-banner--error" role="status"><AlertTriangle size={16} aria-hidden="true" /><span>{page.lastError.message} · {formatDateTime(page.lastError.at)}</span></div>}
    <ErrorBanner message={error} />
    {notice && <Notice tone="success">{notice}</Notice>}

    <form className="crm-form" onSubmit={save}>
      <div className="crm-form--grid">
        <label className="crm-field"><span>Chi nhánh nhận khách</span>
          <select value={branchId} onChange={(event) => setBranchId(event.target.value)}>
            {overview.branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
          </select>
        </label>
        <label className="crm-toggle"><input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} /> <span>Đồng bộ page này</span></label>
      </div>
      <details className="crm-details" open={!Object.keys(page.tagMap).length}>
        <summary>Thẻ Pancake theo giai đoạn ({Object.keys(tagMap).filter((key) => tagMap[key]).length}/{CRM_STAGES.length})</summary>
        <p className="crm-hint">Tạo sẵn các thẻ "AURA: …" trên Pancake rồi bấm Làm mới thẻ. Đổi giai đoạn ở Aura sẽ gỡ thẻ cũ và gắn thẻ mới.</p>
        <div className="crm-map">
          {CRM_STAGES.map((stage) => <label key={stage} className="crm-field"><span>{STAGE_LABELS[stage]}</span>
            <select value={tagMap[stage] || ''} onChange={(event) => setTagMap((current) => ({ ...current, [stage]: event.target.value }))}>
              <option value="">Không gắn thẻ</option>
              {page.pancakeTags.map((tag) => <option key={tag.id} value={tag.id}>{tag.text}</option>)}
            </select>
          </label>)}
        </div>
      </details>
      <details className="crm-details" open={!Object.keys(page.staffMap).length && page.pancakeUsers.length > 0}>
        <summary>Nhân viên Pancake ↔ tài khoản Aura ({Object.values(staffMap).filter(Boolean).length}/{page.pancakeUsers.length})</summary>
        <p className="crm-hint">Người được phân công trên Pancake trở thành Sales phụ trách khách mới; giao khách ở Aura cũng phân công lại trên Pancake.</p>
        <div className="crm-map">
          {page.pancakeUsers.map((user) => <label key={user.id} className="crm-field"><span>{user.name || user.email || user.id}</span>
            <select value={staffMap[user.id] || ''} onChange={(event) => setStaffMap((current) => ({ ...current, [user.id]: event.target.value }))}>
              <option value="">Chưa gắn</option>
              {staff.map((member) => <option key={member.uid} value={member.uid}>{member.name}</option>)}
            </select>
          </label>)}
          {!page.pancakeUsers.length && <p className="crm-muted">Chưa đọc được nhân viên của page. Bấm Làm mới thẻ & nhân viên.</p>}
        </div>
      </details>
      <button type="submit" className="crm-button crm-button--primary" disabled={busy === 'save'}>{busy === 'save' ? <Spinner /> : null} Lưu cấu hình</button>
    </form>

    <div className="crm-actions crm-actions--wrap">
      <button type="button" className="crm-button" disabled={Boolean(busy)} onClick={() => void act('meta', async () => onPage((await service.refreshPageMeta(page.pageId)).page), 'Đã đọc lại thẻ và nhân viên từ Pancake.')}>{busy === 'meta' ? <Spinner /> : <RefreshCw size={15} />} Làm mới thẻ & nhân viên</button>
      <button type="button" className="crm-button" disabled={Boolean(busy)} onClick={() => void act('rotate', async () => onReveal((await service.rotateWebhookSecret(page.pageId)).webhookUrl), 'Đã tạo URL webhook mới. URL cũ ngừng nhận sau tối đa 1 phút.')}>{busy === 'rotate' ? <Spinner /> : <Webhook size={15} />} Tạo lại URL webhook</button>
      <span className="crm-inline-field">
        <label htmlFor={`crm-days-${page.pageId}`}>Lấy lại</label>
        <input id={`crm-days-${page.pageId}`} type="number" min={1} max={90} value={days} onChange={(event) => setDays(Math.max(1, Math.min(90, Number(event.target.value) || 1)))} />
        <span>ngày</span>
        <button type="button" className="crm-button" disabled={Boolean(busy) || page.backfill?.status === 'running'} onClick={() => void act('backfill', async () => onPage((await service.startBackfill({ pageId: page.pageId, days })).page), 'Đã bắt đầu lấy lại lịch sử. Tiến độ cập nhật mỗi 5 phút.')}>{busy === 'backfill' ? <Spinner /> : null} Bắt đầu</button>
      </span>
    </div>
    <details className="crm-details">
      <summary>Token và ngắt kết nối</summary>
      <form className="crm-inline-form" onSubmit={(event) => { event.preventDefault(); void act('token', async () => { onPage((await service.replaceToken({ pageId: page.pageId, pageAccessToken: token.trim() })).page); setToken('') }, 'Đã thay token. Đồng bộ chạy lại ở lượt kế tiếp.') }}>
        <label className="crm-sr-only" htmlFor={`crm-token-${page.pageId}`}>Token page mới</label>
        <input id={`crm-token-${page.pageId}`} type="password" autoComplete="off" value={token} placeholder="Dán page_access_token mới" onChange={(event) => setToken(event.target.value)} />
        <button type="submit" className="crm-button" disabled={token.trim().length < 20 || Boolean(busy)}>{busy === 'token' ? <Spinner /> : null} Thay token</button>
      </form>
      <button type="button" className="crm-button crm-button--danger" disabled={Boolean(busy) || !page.enabled} onClick={() => {
        if (window.confirm(`Ngắt kết nối ${page.name}? Token bị xóa khỏi Aura; dữ liệu đã đồng bộ được giữ lại.`)) void act('disconnect', async () => onPage((await service.disconnectPage(page.pageId)).page), 'Đã ngắt kết nối page.')
      }}>Ngắt kết nối</button>
    </details>
  </section>
}

function ConnectForm({ overview, service, onConnected }: { overview: CrmIntegrationOverview; service: CrmService; onConnected: (page: CrmPancakePage, url: string) => void }) {
  const [pageId, setPageId] = useState('')
  const [token, setToken] = useState('')
  const [name, setName] = useState('')
  const [branchId, setBranchId] = useState(overview.branches[0]?.id || '')
  const [platform, setPlatform] = useState<CrmPlatform | ''>('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  return <form className="crm-section crm-form" aria-labelledby="crm-connect-title" onSubmit={async (event) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const result = await service.connectPage({ pageId: pageId.trim(), pageAccessToken: token.trim(), branchId, name: name.trim() || undefined, platform: platform || undefined })
      setPageId(''); setToken(''); setName('')
      onConnected(result.page, result.webhookUrl)
    } catch (cause) {
      setError(crmErrorMessage(cause, 'Chưa kết nối được page.'))
    } finally {
      setBusy(false)
    }
  }}>
    <h2 id="crm-connect-title"><PlugZap size={17} aria-hidden="true" /> Kết nối page Pancake</h2>
    <p className="crm-hint">Người quản trị page tạo page_access_token trong Pancake (Cài đặt → Công cụ / API). Aura mã hóa token và không bao giờ trả về trình duyệt.</p>
    <ErrorBanner message={error} />
    <div className="crm-form--grid">
      <label className="crm-field"><span>Mã page</span><input value={pageId} required pattern="[A-Za-z0-9_\-]{1,80}" onChange={(event) => setPageId(event.target.value)} placeholder="1029384756 hoặc pzl_…" /></label>
      <label className="crm-field"><span>Tên hiển thị</span><input value={name} maxLength={120} onChange={(event) => setName(event.target.value)} placeholder="Aura Fitness Q7" /></label>
      <label className="crm-field"><span>Chi nhánh nhận khách</span><select value={branchId} required onChange={(event) => setBranchId(event.target.value)}>
        {overview.branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
      </select></label>
      <label className="crm-field"><span>Nền tảng</span><select value={platform} onChange={(event) => setPlatform(event.target.value as CrmPlatform | '')}>
        <option value="">Tự nhận từ mã page</option>
        {(Object.keys(PLATFORM_LABELS) as CrmPlatform[]).map((item) => <option key={item} value={item}>{PLATFORM_LABELS[item]}</option>)}
      </select></label>
      <label className="crm-field crm-field--wide"><span>page_access_token</span><input type="password" autoComplete="off" value={token} required minLength={20} onChange={(event) => setToken(event.target.value)} /></label>
    </div>
    <button type="submit" className="crm-button crm-button--primary" disabled={busy || !branchId}>{busy ? <Spinner /> : <PlugZap size={15} />} Kiểm tra & kết nối</button>
  </form>
}
