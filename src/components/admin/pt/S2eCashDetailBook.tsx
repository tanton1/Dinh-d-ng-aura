import { useEffect, useState } from 'react'
import { FileCog, Printer, Save, ShieldCheck, X } from 'lucide-react'
import type { CashAccount, S2eCashDetailBook as S2eBook, S2eCashDetailSettings } from '../../../services/cashbookService'

interface Props {
  accounts: CashAccount[]
  accountId: string
  book: S2eBook | null
  busy: boolean
  loading: boolean
  periodStart: string
  periodEnd: string
  onAccountChange: (value: string) => void
  onPeriodStartChange: (value: string) => void
  onPeriodEndChange: (value: string) => void
  onRefresh: () => void
  onSaveSettings: (settings: S2eCashDetailSettings) => Promise<boolean>
}

const amount = (value: number) => value ? Math.round(value).toLocaleString('vi-VN') : ''
const date = (value: string) => value ? new Date(value).toLocaleDateString('vi-VN') : ''

const emptySettings: S2eCashDetailSettings = {
  businessName: 'AURA FITNESS',
  address: '',
  taxCode: '',
  representativeName: '',
  unit: 'VND',
}

export default function S2eCashDetailBook({
  accounts,
  accountId,
  book,
  busy,
  loading,
  periodStart,
  periodEnd,
  onAccountChange,
  onPeriodStartChange,
  onPeriodEndChange,
  onRefresh,
  onSaveSettings,
}: Props) {
  const [editingSettings, setEditingSettings] = useState(false)
  const [settings, setSettings] = useState<S2eCashDetailSettings>(emptySettings)

  useEffect(() => {
    if (book?.settings) setSettings(book.settings)
  }, [book?.settings])

  const saveSettings = async () => {
    if (await onSaveSettings(settings)) setEditingSettings(false)
  }

  return <section className="s2e-module">
    <div className="s2e-compliance-card">
      <ShieldCheck size={22} />
      <div><strong>Sổ chi tiết tiền theo Mẫu S2e-HKD</strong><span>Đúng cấu trúc Thông tư 152/2025/TT-BTC, hiệu lực từ 01/01/2026. Phiếu thu, phiếu chi và bút toán đối ứng vẫn là dữ liệu gốc.</span></div>
    </div>

    <div className="s2e-controls">
      <label>Từ ngày<input type="date" value={periodStart} max={periodEnd} onChange={(event) => onPeriodStartChange(event.target.value)} /></label>
      <label>Đến ngày<input type="date" value={periodEnd} min={periodStart} onChange={(event) => onPeriodEndChange(event.target.value)} /></label>
      <label>Tài khoản tiền<select value={accountId} onChange={(event) => onAccountChange(event.target.value)}><option value="">Tất cả quỹ và ngân hàng</option>{accounts.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <div className="s2e-controls__actions">
        <button type="button" onClick={onRefresh} disabled={loading}>Cập nhật sổ</button>
        <button type="button" onClick={() => setEditingSettings((value) => !value)}><FileCog size={16} /> Thông tin hộ KD</button>
        <button type="button" className="s2e-print-button" onClick={() => window.print()} disabled={!book || loading}><Printer size={16} /> In / Lưu PDF</button>
      </div>
    </div>

    {editingSettings && <div className="s2e-settings">
      <div className="s2e-settings__heading"><div><small>THÔNG TIN TRÊN MẪU BIỂU</small><h3>Hộ/cá nhân kinh doanh</h3></div><button type="button" onClick={() => setEditingSettings(false)} aria-label="Đóng"><X size={17} /></button></div>
      <div className="s2e-settings__grid">
        <label>Tên hộ/cá nhân kinh doanh<input value={settings.businessName} onChange={(event) => setSettings((value) => ({ ...value, businessName: event.target.value }))} /></label>
        <label>Mã số thuế<input value={settings.taxCode} onChange={(event) => setSettings((value) => ({ ...value, taxCode: event.target.value }))} /></label>
        <label className="s2e-settings__wide">Địa chỉ<input value={settings.address} onChange={(event) => setSettings((value) => ({ ...value, address: event.target.value }))} /></label>
        <label>Người đại diện<input value={settings.representativeName} onChange={(event) => setSettings((value) => ({ ...value, representativeName: event.target.value }))} placeholder="Họ và tên người ký sổ" /></label>
        <label>Đơn vị tính<input value={settings.unit} onChange={(event) => setSettings((value) => ({ ...value, unit: event.target.value }))} /></label>
      </div>
      <button type="button" className="cashbook-primary s2e-settings__save" disabled={busy || !settings.businessName.trim() || !settings.address.trim() || !settings.taxCode.trim()} onClick={() => void saveSettings()}><Save size={16} /> Lưu thông tin mẫu biểu</button>
    </div>}

    {loading && !book && <div className="s2e-empty">Đang tổng hợp S2e-HKD từ dữ liệu sổ quỹ…</div>}
    {!loading && book && book.sections.length === 0 && <div className="s2e-empty">Chưa có tài khoản tiền để lập sổ. Hãy mở quỹ hoặc tài khoản ngân hàng trước.</div>}

    {book && <article className="s2e-print-root" aria-label="Mẫu S2e-HKD - Sổ chi tiết tiền">
      <header className="s2e-document-header">
        <dl>
          <div><dt>HỘ, CÁ NHÂN KINH DOANH:</dt><dd>{book.settings.businessName || '................................'}</dd></div>
          <div><dt>Địa chỉ:</dt><dd>{book.settings.address || '................................'}</dd></div>
          <div><dt>Mã số thuế:</dt><dd>{book.settings.taxCode || '................................'}</dd></div>
        </dl>
        <div><strong>Mẫu số S2e-HKD</strong><i>(Kèm theo Thông tư số 152/2025/TT-BTC<br />ngày 31 tháng 12 năm 2025 của Bộ trưởng<br />Bộ Tài chính)</i></div>
      </header>
      <div className="s2e-document-title"><h2>SỔ CHI TIẾT TIỀN</h2><p>Kỳ kê khai: {date(`${periodStart}T00:00:00+07:00`)} - {date(`${periodEnd}T00:00:00+07:00`)}</p></div>
      <div className="s2e-document-unit">Đơn vị tính: {book.settings.unit || 'VND'}</div>

      {book.sections.map((section, sectionIndex) => {
        const isCash = section.sectionType === 'cash'
        return <section className="s2e-account-section" key={section.account.id}>
          <h3>{isCash ? 'Tiền mặt' : 'Tiền gửi không kỳ hạn'}</h3>
          <h4>{isCash ? `Quỹ: ${section.account.name}` : `Ngân hàng/Tổ chức thanh toán: ${section.account.name}`}</h4>
          <div className="s2e-table-wrap">
            <table>
              <colgroup><col className="s2e-col-number" /><col className="s2e-col-date" /><col className="s2e-col-description" /><col className="s2e-col-money" /><col className="s2e-col-money" /></colgroup>
              <thead>
                <tr><th colSpan={2}>Chứng từ</th><th rowSpan={2}>Diễn giải</th><th colSpan={2}>Số tiền</th></tr>
                <tr><th>Số hiệu</th><th>Ngày tháng</th><th>Thu/Gửi vào</th><th>Chi/Rút ra</th></tr>
                <tr className="s2e-column-codes"><th>A</th><th>B</th><th>C</th><th>1</th><th>2</th></tr>
              </thead>
              <tbody>
                <tr className="s2e-opening-row"><td /><td /><th>{isCash ? 'Tiền mặt đầu kỳ' : 'Tiền gửi đầu kỳ'}</th><td>{amount(section.openingBalance)}</td><td /></tr>
                {section.rows.map((row) => <tr key={row.id}><td>{row.voucherNumber}</td><td>{date(row.documentDate)}</td><td>{row.description}<small className="s2e-running-balance">Số dư sau nghiệp vụ: {amount(row.runningBalance) || '0'} {book.settings.unit}</small></td><td>{amount(row.receipt)}</td><td>{amount(row.payment)}</td></tr>)}
                {section.rows.length === 0 && <tr className="s2e-no-activity"><td /><td /><td>Không phát sinh trong kỳ</td><td /><td /></tr>}
                <tr className="s2e-total-row"><td /><td /><th>{isCash ? 'Tổng tiền thu vào trong kỳ' : 'Tổng gửi vào trong kỳ'}</th><td>{amount(section.totalReceipt)}</td><td /></tr>
                <tr className="s2e-total-row"><td /><td /><th>{isCash ? 'Tổng tiền chi ra trong kỳ' : 'Tổng tiền rút ra trong kỳ'}</th><td /><td>{amount(section.totalPayment)}</td></tr>
                <tr className="s2e-closing-row"><td /><td /><th>{isCash ? 'Tiền mặt tồn cuối kỳ' : 'Tiền gửi cuối kỳ'}</th><td>{amount(section.closingBalance)}</td><td /></tr>
              </tbody>
            </table>
          </div>
          {sectionIndex < book.sections.length - 1 && <div className="s2e-page-break" />}
        </section>
      })}

      <footer className="s2e-document-footer"><p>Ngày ...... tháng ...... năm ......</p><strong>NGƯỜI ĐẠI DIỆN HỘ KINH DOANH/<br />CÁ NHÂN KINH DOANH</strong><i>(Ký, ghi rõ họ tên và đóng dấu (nếu có))</i>{book.settings.representativeName && <b>{book.settings.representativeName}</b>}</footer>
      <div className="s2e-screen-note">Số dư sau nghiệp vụ chỉ hỗ trợ đối soát trên màn hình và được ẩn khi in để giữ đúng 5 cột của Mẫu S2e-HKD.</div>
    </article>}
  </section>
}
