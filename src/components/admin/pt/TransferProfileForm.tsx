import { useMemo, useState } from 'react'
import { Landmark, X } from 'lucide-react'
import type { CashAccount } from '../../../services/cashbookService'
import { configureCashAccountTransferProfile, installmentPaymentErrorMessage } from '../../../services/installmentPaymentService'
import { VIETQR_BANKS } from '../../../domain/payments/vietQr'

interface Props {
  accounts: CashAccount[]
  branches: Array<{ id: string; name: string }>
  onSaved: (message: string) => void
  onClose: () => void
}

const OTHER_BANK = 'other'

function formFor(account: CashAccount | undefined) {
  const profile = account?.transferProfile
  const known = VIETQR_BANKS.find((bank) => bank.bin === profile?.bankBin)
  return {
    enabled: profile ? profile.enabled : true,
    bank: profile?.bankBin ? (known ? known.bin : OTHER_BANK) : VIETQR_BANKS[0].bin,
    bankBin: profile?.bankBin || '',
    bankName: profile?.bankName || '',
    accountNumber: profile?.accountNumber || '',
    accountName: profile?.accountName || '',
  }
}

/** Receiving account shown to students as VietQR on the installment payment page. */
export default function TransferProfileForm({ accounts, branches, onSaved, onClose }: Props) {
  const bankAccounts = useMemo(() => accounts.filter((item) => item.type === 'bank' && item.status === 'active'), [accounts])
  const [accountId, setAccountId] = useState(() => bankAccounts.find((item) => item.transferProfile)?.id || bankAccounts[0]?.id || '')
  const [form, setForm] = useState(() => formFor(bankAccounts.find((item) => item.id === accountId)))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const account = bankAccounts.find((item) => item.id === accountId)
  const branchName = branches.find((item) => item.id === account?.branchId)?.name || 'chưa gán chi nhánh'
  const enabledCount = bankAccounts.filter((item) => item.transferProfile?.enabled).length

  const chooseAccount = (id: string) => {
    setAccountId(id)
    setForm(formFor(bankAccounts.find((item) => item.id === id)))
    setError('')
  }

  const save = async () => {
    if (!account || busy) return
    const known = VIETQR_BANKS.find((bank) => bank.bin === form.bank)
    const bankBin = known ? known.bin : form.bankBin.trim()
    const bankName = known ? known.name : form.bankName.trim()
    setBusy(true)
    setError('')
    try {
      await configureCashAccountTransferProfile({ accountId: account.id, enabled: form.enabled, bankBin, bankName, accountNumber: form.accountNumber, accountName: form.accountName })
      onSaved(form.enabled ? `Học viên ${branchName} sẽ thấy mã VietQR của ${account.name}.` : `Đã tắt nhận chuyển khoản qua app cho ${account.name}.`)
    } catch (cause) {
      setError(installmentPaymentErrorMessage(cause))
    } finally {
      setBusy(false)
    }
  }

  if (!bankAccounts.length) {
    return <div className="cashbook-form">
      <p role="status">Chưa có tài khoản quỹ loại Ngân hàng. Hãy mở quỹ ngân hàng trước, rồi bật nhận chuyển khoản qua VietQR.</p>
      <div className="cashbook-form__actions"><button onClick={onClose}><X size={15} /> Đóng</button></div>
    </div>
  }

  return <div className="cashbook-form" aria-labelledby="transfer-profile-title">
    <p id="transfer-profile-title" style={{ gridColumn: '1 / -1', margin: 0 }}><Landmark size={15} style={{ verticalAlign: '-2px' }} /> <b>Nhận chuyển khoản trả góp qua VietQR.</b> Học viên thấy tài khoản của chi nhánh mình; nếu cả hệ thống chỉ bật một tài khoản, mọi chi nhánh dùng chung tài khoản đó.</p>
    <label>Tài khoản quỹ<select value={accountId} onChange={(event) => chooseAccount(event.target.value)}>{bankAccounts.map((item) => <option key={item.id} value={item.id}>{item.name}{item.transferProfile?.enabled ? ' · đang nhận' : ''}</option>)}</select></label>
    <label>Trạng thái<select value={form.enabled ? 'on' : 'off'} onChange={(event) => setForm((value) => ({ ...value, enabled: event.target.value === 'on' }))}><option value="on">Bật cho học viên</option><option value="off">Tắt</option></select></label>
    <label>Ngân hàng<select value={form.bank} onChange={(event) => setForm((value) => ({ ...value, bank: event.target.value }))}>{VIETQR_BANKS.map((bank) => <option key={bank.bin} value={bank.bin}>{bank.name}</option>)}<option value={OTHER_BANK}>Ngân hàng khác</option></select></label>
    {form.bank === OTHER_BANK && <>
      <label>Mã BIN (6 số)<input inputMode="numeric" maxLength={6} value={form.bankBin} onChange={(event) => setForm((value) => ({ ...value, bankBin: event.target.value.replace(/\D/g, '') }))} placeholder="970436" /></label>
      <label>Tên ngân hàng<input maxLength={60} value={form.bankName} onChange={(event) => setForm((value) => ({ ...value, bankName: event.target.value }))} placeholder="Tên hiển thị cho học viên" /></label>
    </>}
    <label>Số tài khoản<input inputMode="numeric" maxLength={24} value={form.accountNumber} onChange={(event) => setForm((value) => ({ ...value, accountNumber: event.target.value }))} placeholder="0123456789" /></label>
    <label>Tên chủ tài khoản<input maxLength={50} value={form.accountName} onChange={(event) => setForm((value) => ({ ...value, accountName: event.target.value }))} placeholder="CONG TY TNHH AURA" /></label>
    <p style={{ gridColumn: '1 / -1', margin: 0, fontSize: 12 }}>{account ? `Áp dụng cho học viên chi nhánh ${branchName}.` : ''} {enabledCount > 1 ? 'Nhiều tài khoản đang bật: chi nhánh không có tài khoản riêng sẽ chưa hiện mã QR.' : ''}</p>
    {error && <p role="alert" className="cashbook-error" style={{ gridColumn: '1 / -1', margin: 0 }}>{error}</p>}
    <div className="cashbook-form__actions"><button className="cashbook-primary" onClick={() => void save()} disabled={busy}>{busy ? 'Đang lưu…' : 'Lưu'}</button><button onClick={onClose}><X size={15} /> Hủy</button></div>
  </div>
}
