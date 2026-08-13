import { useState, type FormEvent } from 'react'
import { BadgeCheck, KeyRound, Link2, LoaderCircle, Mail, Phone, ShieldCheck } from 'lucide-react'
import { getFriendlyAuthError, useAuth } from '../../contexts/AuthContext'
import '../../styles-account-connections.css'

type ConnectionForm = 'phone' | 'email' | null

function GoogleMark() {
  return <svg viewBox="0 0 24 24" width="21" height="21" aria-hidden="true"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" /><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" /><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l3.66-2.85z" /><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.85c.87-2.6 3.3-4.53 6.16-4.53z" /></svg>
}

export default function AccountConnectionsCard() {
  const { user, backendMode, linkGoogleProvider, linkEmailProvider, sendPhoneLinkOtp, verifyPhoneLinkOtp } = useAuth()
  const [openForm, setOpenForm] = useState<ConnectionForm>(null)
  const [phone, setPhone] = useState('')
  const [otp, setOtp] = useState('')
  const [otpSent, setOtpSent] = useState(false)
  const [email, setEmail] = useState(user?.email ?? '')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const providers = new Set(user?.providerIds ?? [])
  const googleConnected = providers.has('google.com')
  const phoneConnected = providers.has('phone') || Boolean(user?.phoneNumber)
  const emailConnected = providers.has('password')

  const start = (key: string) => {
    setBusy(key)
    setMessage(null)
    setError(null)
  }

  const stopWithError = (reason: unknown) => {
    setError(getFriendlyAuthError(reason))
    setBusy(null)
  }

  const connectGoogle = async () => {
    start('google')
    try {
      await linkGoogleProvider()
      setMessage('Đã liên kết Google với tài khoản Aura hiện tại.')
      setBusy(null)
    } catch (reason) {
      stopWithError(reason)
    }
  }

  const submitPhone = async (event: FormEvent) => {
    event.preventDefault()
    start('phone')
    try {
      if (!otpSent) {
        setMessage(await sendPhoneLinkOtp(phone))
        setOtpSent(true)
      } else {
        await verifyPhoneLinkOtp(phone, otp)
        setMessage('Số điện thoại đã được liên kết. Bạn có thể dùng OTP ở lần đăng nhập sau.')
        setOpenForm(null)
      }
      setBusy(null)
    } catch (reason) {
      stopWithError(reason)
    }
  }

  const submitEmail = async (event: FormEvent) => {
    event.preventDefault()
    start('email')
    try {
      await linkEmailProvider(email, password)
      setMessage('Email đã được liên kết. Aura đã gửi thư xác minh đến hộp thư của bạn.')
      setOpenForm(null)
      setBusy(null)
    } catch (reason) {
      stopWithError(reason)
    }
  }

  const toggle = (form: ConnectionForm) => {
    setOpenForm((current) => current === form ? null : form)
    setMessage(null)
    setError(null)
  }

  return (
    <section className="account-connections" aria-labelledby="account-connections-title">
      <header>
        <span className="account-connections__icon"><ShieldCheck size={21} /></span>
        <div>
          <h3 id="account-connections-title">Đăng nhập & bảo mật</h3>
          <p>Liên kết nhiều cách đăng nhập vào cùng một tài khoản, không tạo hồ sơ trùng.</p>
        </div>
        <span className="account-connections__score"><BadgeCheck size={15} /> {providers.size || 1} phương thức</span>
      </header>

      <div className="account-connections__list">
        <div className="account-provider">
          <span className="account-provider__logo"><GoogleMark /></span>
          <div><strong>Google</strong><small>{googleConnected ? 'Đã liên kết và sẵn sàng' : 'Đăng nhập nhanh, không cần mật khẩu'}</small></div>
          {googleConnected ? <span className="account-provider__connected"><BadgeCheck size={14} /> Đã nối</span> : <button type="button" disabled={Boolean(busy) || backendMode === 'demo'} onClick={() => void connectGoogle()}>{busy === 'google' ? <LoaderCircle className="auth-spin" size={16} /> : <Link2 size={15} />} Liên kết</button>}
        </div>

        <div className="account-provider">
          <span className="account-provider__logo account-provider__logo--phone"><Phone size={20} /></span>
          <div><strong>Số điện thoại</strong><small>{phoneConnected ? (user?.phoneNumber ?? 'Đã xác minh OTP') : 'OTP SMS dành cho số Việt Nam'}</small></div>
          {phoneConnected ? <span className="account-provider__connected"><BadgeCheck size={14} /> Đã nối</span> : <button type="button" disabled={Boolean(busy) || backendMode === 'demo'} onClick={() => toggle('phone')}><Link2 size={15} /> Liên kết</button>}
        </div>
        {openForm === 'phone' && !phoneConnected && (
          <form className="account-link-form" onSubmit={submitPhone}>
            <label><span>{otpSent ? 'Mã OTP' : 'Số điện thoại'}</span><div>{otpSent ? <KeyRound size={17} /> : <Phone size={17} />}<input required value={otpSent ? otp : phone} onChange={(event) => otpSent ? setOtp(event.target.value.replace(/\D/g, '').slice(0, 6)) : setPhone(event.target.value)} placeholder={otpSent ? '6 chữ số' : '0912 345 678'} inputMode={otpSent ? 'numeric' : 'tel'} /></div></label>
            <button id={!otpSent ? 'phone-link-otp-button' : undefined} disabled={busy === 'phone' || (otpSent && otp.length !== 6)}>{busy === 'phone' ? <LoaderCircle className="auth-spin" size={16} /> : null}{otpSent ? 'Xác minh' : 'Gửi OTP'}</button>
          </form>
        )}

        <div className="account-provider">
          <span className="account-provider__logo account-provider__logo--email"><Mail size={20} /></span>
          <div><strong>Email & mật khẩu</strong><small>{emailConnected ? (user?.email ?? 'Đã liên kết') : 'Phương án dự phòng an toàn'}</small></div>
          {emailConnected ? <span className="account-provider__connected"><BadgeCheck size={14} /> Đã nối</span> : <button type="button" disabled={Boolean(busy) || backendMode === 'demo'} onClick={() => toggle('email')}><Link2 size={15} /> Liên kết</button>}
        </div>
        {openForm === 'email' && !emailConnected && (
          <form className="account-link-form account-link-form--email" onSubmit={submitEmail}>
            <label><span>Email</span><div><Mail size={17} /><input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="ban@aurafitness.vn" /></div></label>
            <label><span>Mật khẩu mới</span><div><KeyRound size={17} /><input required minLength={6} type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Tối thiểu 6 ký tự" /></div></label>
            <button disabled={busy === 'email'}>{busy === 'email' ? <LoaderCircle className="auth-spin" size={16} /> : null}Liên kết email</button>
          </form>
        )}
      </div>

      {backendMode === 'demo' && <p className="account-connections__demo">Chế độ xem trước: liên kết tài khoản chỉ hoạt động trên môi trường Firebase.</p>}
      {error && <p className="account-connections__feedback account-connections__feedback--error" role="alert">{error}</p>}
      {message && <p className="account-connections__feedback" role="status">{message}</p>}
    </section>
  )
}
