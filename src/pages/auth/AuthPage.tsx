import { useEffect, useState, type FormEvent } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  Check,
  Eye,
  EyeOff,
  KeyRound,
  LoaderCircle,
  LockKeyhole,
  Mail,
  MessageCircle,
  Phone,
  ShieldCheck,
  Sparkles,
  UserRound,
} from 'lucide-react'
import { getFriendlyAuthError, useAuth } from '../../contexts/AuthContext'

type AuthMode = 'signin' | 'signup'
type AuthMethod = 'phone' | 'email'

function cleanPhoneInput(value: string) {
  return value.replace(/[^\d+\s().-]/g, '').slice(0, 18)
}

function phoneDigits(value: string) {
  return value.replace(/\D/g, '')
}

export default function AuthPage() {
  const { signIn, signUp, signInWithGoogle, sendPhoneOtp, verifyPhoneOtpAndSignIn, resetPassword } = useAuth()
  const [mode, setMode] = useState<AuthMode>('signin')
  const [authMethod, setAuthMethod] = useState<AuthMethod>('phone')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [phoneNumber, setPhoneNumber] = useState('')
  const [otpCode, setOtpCode] = useState('')
  const [otpSent, setOtpSent] = useState(false)
  const [retrySeconds, setRetrySeconds] = useState(0)
  const [receivedOtpHint, setReceivedOtpHint] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (retrySeconds <= 0) return undefined
    const timer = window.setInterval(() => {
      setRetrySeconds((value) => Math.max(0, value - 1))
    }, 1000)
    return () => window.clearInterval(timer)
  }, [retrySeconds])

  const resetFeedback = () => {
    setError(null)
    setMessage(null)
  }

  const resetPhoneStep = () => {
    setOtpSent(false)
    setOtpCode('')
    setReceivedOtpHint(null)
    setRetrySeconds(0)
  }

  const changeMode = (nextMode: AuthMode) => {
    setMode(nextMode)
    resetFeedback()
    resetPhoneStep()
  }

  const changeMethod = (nextMethod: AuthMethod) => {
    setAuthMethod(nextMethod)
    resetFeedback()
    resetPhoneStep()
  }

  const requestOtp = async () => {
    const digits = phoneDigits(phoneNumber)
    if (digits.length < 9 || digits.length > 12) {
      setError('Vui lòng nhập số điện thoại hợp lệ.')
      return
    }
    if (mode === 'signup' && name.trim().length < 2) {
      setError('Vui lòng nhập họ và tên để tạo tài khoản.')
      return
    }

    setLoading(true)
    resetFeedback()
    try {
      const result = await sendPhoneOtp(phoneNumber, mode === 'signup')
      setOtpSent(true)
      setOtpCode('')
      setRetrySeconds(45)
      setReceivedOtpHint(result.otpCode || null)
      setMessage(result.message)
    } catch (authError) {
      setError(getFriendlyAuthError(authError))
    } finally {
      setLoading(false)
    }
  }

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (authMethod === 'phone' && !otpSent) {
      await requestOtp()
      return
    }

    setLoading(true)
    resetFeedback()
    try {
      if (authMethod === 'email') {
        if (mode === 'signin') await signIn(email, password)
        else await signUp(name.trim(), email.trim(), password)
      } else {
        await verifyPhoneOtpAndSignIn(phoneNumber, otpCode, mode === 'signup' ? name : undefined)
        setMessage('Xác thực thành công. Aura đang mở không gian của bạn…')
      }
    } catch (authError) {
      setError(getFriendlyAuthError(authError))
    } finally {
      setLoading(false)
    }
  }

  const google = async () => {
    setLoading(true)
    resetFeedback()
    try {
      await signInWithGoogle()
    } catch (authError) {
      setError(getFriendlyAuthError(authError))
    } finally {
      setLoading(false)
    }
  }

  const forgotPassword = async () => {
    if (!email.trim()) {
      setError('Nhập email trước khi yêu cầu đặt lại mật khẩu.')
      return
    }
    setLoading(true)
    resetFeedback()
    try {
      await resetPassword(email.trim())
      setMessage('Aura đã gửi email đặt lại mật khẩu cho bạn.')
    } catch (authError) {
      setError(getFriendlyAuthError(authError))
    } finally {
      setLoading(false)
    }
  }

  const title = mode === 'signin'
    ? 'Đăng nhập để tiếp tục hành trình'
    : 'Tạo tài khoản Aura của bạn'

  return (
    <div className="auth-shell" data-testid="auth-page">
      <section className="auth-showcase" aria-label="Giới thiệu Aura Fitness">
        <div className="auth-showcase__orb auth-showcase__orb--one" />
        <div className="auth-showcase__orb auth-showcase__orb--two" />
        <div className="auth-brand">
          <span className="auth-brand__mark">A</span>
          <span><strong>AURA</strong><small>FITNESS</small></span>
        </div>

        <div className="auth-showcase__copy">
          <span className="auth-eyebrow"><Sparkles size={15} /> HÀNH TRÌNH CỦA RIÊNG BẠN</span>
          <h2>Một tài khoản.<br />Mọi mục tiêu sức khỏe.</h2>
          <p>Học, tập luyện và theo dõi dinh dưỡng trong một không gian được cá nhân hóa cùng Coach/PT.</p>
        </div>

        <div className="auth-preview-card">
          <header><span><Sparkles size={17} /></span><div><small>AURA DAILY PULSE</small><strong>Hôm nay đang đúng nhịp</strong></div><em>82%</em></header>
          <div className="auth-preview-card__progress"><span /></div>
          <div className="auth-preview-card__metrics">
            <div><small>Năng lượng</small><strong>1.640</strong><span>kcal</span></div>
            <div><small>Đạm</small><strong>92</strong><span>gram</span></div>
            <div><small>Nước</small><strong>1,8</strong><span>lít</span></div>
          </div>
        </div>

        <ul className="auth-benefits">
          <li><Check size={14} /> Theo dõi tiến độ mỗi ngày</li>
          <li><Check size={14} /> Phân tích món ăn bằng Aura AI</li>
          <li><Check size={14} /> Đồng hành trực tiếp cùng Coach/PT</li>
        </ul>
      </section>

      <main className="auth-panel">
        <div className="auth-mobile-brand">
          <span className="auth-brand__mark">A</span>
          <span><strong>AURA</strong><small>FITNESS</small></span>
        </div>

        <div className="auth-panel__content">
          <header className="auth-panel__header">
            <span className="auth-panel__welcome">Chào mừng bạn đến Aura</span>
            <h1>{title}</h1>
            <p>{mode === 'signin' ? 'Tiếp tục nơi bạn đã dừng lại.' : 'Chỉ mất một phút để bắt đầu hành trình mới.'}</p>
          </header>

          <div className="auth-mode-tabs" role="tablist" aria-label="Chọn đăng nhập hoặc đăng ký">
            <button type="button" role="tab" aria-selected={mode === 'signin'} className={mode === 'signin' ? 'is-active' : ''} onClick={() => changeMode('signin')}>Đăng nhập</button>
            <button type="button" role="tab" aria-selected={mode === 'signup'} className={mode === 'signup' ? 'is-active' : ''} onClick={() => changeMode('signup')}>Tạo tài khoản</button>
          </div>

          <div className="auth-method-tabs" aria-label="Phương thức xác thực">
            <button type="button" className={authMethod === 'phone' ? 'is-active' : ''} onClick={() => changeMethod('phone')}><Phone size={16} /> Số điện thoại</button>
            <button type="button" className={authMethod === 'email' ? 'is-active' : ''} onClick={() => changeMethod('email')}><Mail size={16} /> Email</button>
          </div>

          <form className="auth-form" onSubmit={submit} noValidate>
            {mode === 'signup' && (
              <label className="auth-field">
                <span>Họ và tên</span>
                <div><UserRound size={18} /><input required value={name} onChange={(event) => setName(event.target.value)} placeholder="Nguyễn Minh Anh" autoComplete="name" /></div>
              </label>
            )}

            {authMethod === 'phone' ? (
              <>
                {!otpSent ? (
                  <>
                    <label className="auth-field">
                      <span>Số điện thoại</span>
                      <div><Phone size={18} /><input required type="tel" inputMode="tel" value={phoneNumber} onChange={(event) => { setPhoneNumber(cleanPhoneInput(event.target.value)); resetPhoneStep(); resetFeedback() }} placeholder="0912 345 678" autoComplete="tel" /></div>
                    </label>
                    <p className="auth-field-help"><MessageCircle size={14} /> Aura sẽ gửi mã OTP gồm 6 chữ số qua SMS. Không cần mật khẩu.</p>
                  </>
                ) : (
                  <>
                    <div className="auth-otp-destination">
                      <span><BadgeCheck size={20} /></span>
                      <div><small>Mã xác thực đã gửi đến</small><strong>{phoneNumber}</strong></div>
                      <button type="button" onClick={() => { resetPhoneStep(); resetFeedback() }}><ArrowLeft size={14} /> Đổi số</button>
                    </div>
                    <label className="auth-field auth-field--otp">
                      <span>Mã OTP</span>
                      <div><KeyRound size={18} /><input required className="auth-otp-input" type="text" inputMode="numeric" pattern="[0-9]*" maxLength={6} value={otpCode} onChange={(event) => setOtpCode(event.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="••••••" autoComplete="one-time-code" autoFocus /></div>
                    </label>
                    <div className="auth-resend-row">
                      <span>Chưa nhận được mã?</span>
                      <button type="button" disabled={loading || retrySeconds > 0} onClick={() => void requestOtp()}>{retrySeconds > 0 ? `Gửi lại sau ${retrySeconds}s` : 'Gửi lại OTP'}</button>
                    </div>
                  </>
                )}
              </>
            ) : (
              <>
                <label className="auth-field">
                  <span>Email</span>
                  <div><Mail size={18} /><input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="ban@aurafitness.vn" autoComplete="email" /></div>
                </label>
                <label className="auth-field">
                  <span>Mật khẩu</span>
                  <div><LockKeyhole size={18} /><input required minLength={6} type={showPassword ? 'text' : 'password'} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Tối thiểu 6 ký tự" autoComplete={mode === 'signin' ? 'current-password' : 'new-password'} /><button type="button" className="auth-password-toggle" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}>{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button></div>
                </label>
                {mode === 'signin' && <div className="auth-forgot-row"><button type="button" onClick={() => void forgotPassword()}>Quên mật khẩu?</button></div>}
              </>
            )}

            {receivedOtpHint && <div className="auth-demo-otp"><span>Mã thử nghiệm</span><strong>{receivedOtpHint}</strong></div>}
            {error && <div className="auth-message auth-message--error" role="alert">{error}</div>}
            {message && <div className="auth-message auth-message--success" role="status">{message}</div>}

            <button className="auth-primary-button" type="submit" disabled={loading || (authMethod === 'phone' && otpSent && otpCode.length !== 6)}>
              {loading ? <LoaderCircle className="auth-spin" size={20} /> : <><span>{authMethod === 'phone' ? (otpSent ? 'Xác minh và tiếp tục' : 'Nhận mã OTP') : (mode === 'signin' ? 'Đăng nhập' : 'Tạo tài khoản')}</span><ArrowRight size={18} /></>}
            </button>
          </form>

          <div className="auth-divider"><span>hoặc</span></div>
          <button className="auth-google-button" type="button" disabled={loading} onClick={() => void google()}>
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" /><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" /><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l3.66-2.85z" /><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.85c.87-2.6 3.3-4.53 6.16-4.53z" /></svg>
            Tiếp tục với Google
          </button>

          <div className="auth-security-note"><ShieldCheck size={17} /><p><strong>Bảo mật bởi Firebase</strong><span>Aura không lưu mã OTP hoặc mật khẩu của bạn.</span></p></div>
          <p className="auth-terms">Bằng cách tiếp tục, bạn đồng ý với <button type="button">Điều khoản sử dụng</button> và <button type="button">Chính sách quyền riêng tư</button>.</p>
          <div id="recaptcha-container" className="auth-recaptcha" aria-hidden="true" />
        </div>
      </main>
    </div>
  )
}
