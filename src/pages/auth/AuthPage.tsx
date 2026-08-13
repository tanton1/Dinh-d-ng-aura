import { useEffect, useState, type FormEvent } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  Eye,
  EyeOff,
  KeyRound,
  LoaderCircle,
  LockKeyhole,
  Mail,
  MessageCircle,
  Phone,
  ShieldCheck,
  UserRound,
} from 'lucide-react'
import { getFriendlyAuthError, useAuth } from '../../contexts/AuthContext'
import { getCanonicalAuthRedirectUrl } from '../../services/authOriginService'

type AuthMode = 'signin' | 'signup'
type AuthMethod = 'phone' | 'email'

function cleanPhoneInput(value: string) {
  return value.replace(/[^\d+\s().-]/g, '').slice(0, 18)
}

function phoneDigits(value: string) {
  return value.replace(/\D/g, '')
}

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" width="21" height="21" aria-hidden="true">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l3.66-2.85z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.85c.87-2.6 3.3-4.53 6.16-4.53z" />
    </svg>
  )
}

export default function AuthPage() {
  const { signIn, signUp, signInWithGoogle, sendPhoneOtp, verifyPhoneOtpAndSignIn, resetPassword } = useAuth()
  const [mode, setMode] = useState<AuthMode>('signin')
  const [authMethod, setAuthMethod] = useState<AuthMethod | null>(null)
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
  const [loadingAction, setLoadingAction] = useState<'form' | 'google' | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [captchaVisible, setCaptchaVisible] = useState(false)
  const canonicalRedirectUrl = getCanonicalAuthRedirectUrl()

  useEffect(() => {
    if (canonicalRedirectUrl) window.location.replace(canonicalRedirectUrl)
  }, [canonicalRedirectUrl])

  useEffect(() => {
    const handleCaptchaVisibility = (event: Event) => {
      setCaptchaVisible(Boolean((event as CustomEvent<boolean>).detail))
    }
    window.addEventListener('aura-recaptcha-visibility', handleCaptchaVisibility)
    return () => window.removeEventListener('aura-recaptcha-visibility', handleCaptchaVisibility)
  }, [])

  useEffect(() => {
    const handleRedirectError = (event: Event) => setError((event as CustomEvent<string>).detail)
    const redirectError = sessionStorage.getItem('aura:auth-redirect-error')
    if (redirectError) {
      setError(redirectError)
      sessionStorage.removeItem('aura:auth-redirect-error')
    }
    window.addEventListener('aura-auth-redirect-error', handleRedirectError)
    return () => window.removeEventListener('aura-auth-redirect-error', handleRedirectError)
  }, [])

  useEffect(() => {
    if (retrySeconds <= 0) return undefined
    const timer = window.setInterval(() => setRetrySeconds((value) => Math.max(0, value - 1)), 1000)
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

  const selectMethod = (nextMethod: AuthMethod) => {
    setAuthMethod(nextMethod)
    resetFeedback()
    resetPhoneStep()
  }

  const returnToChoices = () => {
    setAuthMethod(null)
    resetFeedback()
    resetPhoneStep()
  }

  const changeMode = (nextMode: AuthMode) => {
    setMode(nextMode)
    setAuthMethod(null)
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
    setLoadingAction('form')
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
      setLoadingAction(null)
    }
  }

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!authMethod) return
    if (authMethod === 'phone' && !otpSent) {
      await requestOtp()
      return
    }

    setLoading(true)
    setLoadingAction('form')
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
      setLoadingAction(null)
    }
  }

  const google = async () => {
    setLoading(true)
    setLoadingAction('google')
    resetFeedback()
    try {
      await signInWithGoogle()
    } catch (authError: any) {
      if (authError?.code === 'auth/link-existing-account') {
        setAuthMethod('email')
        setMode('signin')
        if (typeof authError?.email === 'string') setEmail(authError.email)
      }
      setError(getFriendlyAuthError(authError))
    } finally {
      setLoading(false)
      setLoadingAction(null)
    }
  }

  const forgotPassword = async () => {
    if (!email.trim()) {
      setError('Nhập email trước khi yêu cầu đặt lại mật khẩu.')
      return
    }
    setLoading(true)
    setLoadingAction('form')
    resetFeedback()
    try {
      await resetPassword(email.trim())
      setMessage('Aura đã gửi email đặt lại mật khẩu cho bạn.')
    } catch (authError) {
      setError(getFriendlyAuthError(authError))
    } finally {
      setLoading(false)
      setLoadingAction(null)
    }
  }

  const title = mode === 'signin' ? 'Đăng nhập' : 'Tạo tài khoản'
  const subtitle = mode === 'signin' ? 'Tiếp tục hành trình cùng Aura' : 'Bắt đầu hành trình khỏe đẹp của riêng bạn'

  if (canonicalRedirectUrl) {
    return (
      <main className="auth-origin-redirect" role="status">
        <LoaderCircle className="auth-spin" size={24} />
        <strong>Đang mở đăng nhập Aura an toàn…</strong>
      </main>
    )
  }

  return (
    <main className="auth-shell auth-shell--minimal" data-testid="auth-page">
      <div className="auth-soft-shape auth-soft-shape--top" />
      <div className="auth-soft-shape auth-soft-shape--bottom" />

      <section className={`auth-entry ${authMethod ? 'is-form-step' : 'is-choice-step'}`} aria-labelledby="auth-title">
        <div className="auth-logo-stage">
          <img src="/aura-logo-transparent-512.png" alt="Aura Fit" className="auth-logo-image" width="512" height="341" fetchPriority="high" />
        </div>

        <div className="auth-entry__heading">
          {authMethod && (
            <button type="button" className="auth-back-button" onClick={returnToChoices} aria-label="Quay lại chọn cách đăng nhập">
              <ArrowLeft size={20} />
            </button>
          )}
          <span>Chào mừng bạn đến Aura</span>
          <h1 id="auth-title">{title}</h1>
          <p>{subtitle}</p>
        </div>

        {!authMethod ? (
          <div className="auth-choice-step">
            <div className="auth-choice-list" aria-label={mode === 'signin' ? 'Chọn cách đăng nhập' : 'Chọn cách tạo tài khoản'}>
              <button type="button" className="auth-choice-card" onClick={() => selectMethod('phone')}>
                <span className="auth-choice-card__icon"><Phone size={25} /></span>
                <strong>{mode === 'signin' ? 'Đăng nhập' : 'Tạo tài khoản'} bằng số điện thoại</strong>
                <ArrowRight size={25} />
              </button>
              <button type="button" className="auth-choice-card" onClick={() => selectMethod('email')}>
                <span className="auth-choice-card__icon"><Mail size={25} /></span>
                <strong>{mode === 'signin' ? 'Đăng nhập' : 'Tạo tài khoản'} bằng Email</strong>
                <ArrowRight size={25} />
              </button>
            </div>

            <div className="auth-or"><span>hoặc</span></div>
            <button className="auth-google-quiet" type="button" disabled={loading} onClick={() => void google()}>
              {loadingAction === 'google' ? <LoaderCircle className="auth-spin" size={21} /> : <GoogleIcon />}
              <span>{loadingAction === 'google' ? 'Đang kết nối Google…' : 'Tiếp tục với Google'}</span>
              {loadingAction !== 'google' && <ArrowRight size={19} />}
            </button>
          </div>
        ) : (
          <form className="auth-form auth-entry-form" onSubmit={submit} noValidate>
            {mode === 'signup' && (
              <label className="auth-field">
                <span>Họ và tên</span>
                <div><UserRound size={19} /><input required value={name} onChange={(event) => setName(event.target.value)} placeholder="Nguyễn Minh Anh" autoComplete="name" /></div>
              </label>
            )}

            {authMethod === 'phone' ? (
              !otpSent ? (
                <>
                  <label className="auth-field">
                    <span>Số điện thoại</span>
                    <div><Phone size={19} /><input required type="tel" inputMode="tel" value={phoneNumber} onChange={(event) => { setPhoneNumber(cleanPhoneInput(event.target.value)); resetPhoneStep(); resetFeedback() }} placeholder="0912 345 678" autoComplete="tel" /></div>
                  </label>
                  <p className="auth-field-help"><MessageCircle size={15} /> Hỗ trợ số Việt Nam (+84). Aura gửi mã OTP 6 chữ số qua SMS.</p>
                </>
              ) : (
                <>
                  <div className="auth-otp-destination">
                    <span><BadgeCheck size={21} /></span>
                    <div><small>Mã xác thực đã gửi đến</small><strong>{phoneNumber}</strong></div>
                    <button type="button" onClick={() => { resetPhoneStep(); resetFeedback() }}><ArrowLeft size={14} /> Đổi số</button>
                  </div>
                  <label className="auth-field auth-field--otp">
                    <span>Mã OTP</span>
                    <div><KeyRound size={19} /><input required className="auth-otp-input" type="text" inputMode="numeric" pattern="[0-9]*" maxLength={6} value={otpCode} onChange={(event) => setOtpCode(event.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="••••••" autoComplete="one-time-code" autoFocus /></div>
                  </label>
                  <div className="auth-resend-row">
                    <span>Chưa nhận được mã?</span>
                    <button type="button" disabled={loading || retrySeconds > 0} onClick={() => void requestOtp()}>{retrySeconds > 0 ? `Gửi lại sau ${retrySeconds}s` : 'Gửi lại OTP'}</button>
                  </div>
                </>
              )
            ) : (
              <>
                <label className="auth-field">
                  <span>Email</span>
                  <div><Mail size={19} /><input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="ban@aurafitness.vn" autoComplete="email" /></div>
                </label>
                <label className="auth-field">
                  <span>Mật khẩu</span>
                  <div><LockKeyhole size={19} /><input required type={showPassword ? 'text' : 'password'} minLength={6} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Tối thiểu 6 ký tự" autoComplete={mode === 'signin' ? 'current-password' : 'new-password'} /><button type="button" className="auth-eye-button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}>{showPassword ? <EyeOff size={19} /> : <Eye size={19} />}</button></div>
                </label>
                {mode === 'signin' && <button className="auth-forgot-button" type="button" disabled={loading} onClick={() => void forgotPassword()}>Quên mật khẩu?</button>}
              </>
            )}

            {captchaVisible && <div className="auth-captcha-notice" role="status"><ShieldCheck size={16} /> Hoàn tất xác minh bảo mật bên dưới để nhận OTP.</div>}
            {error && <div className="auth-feedback auth-feedback--error" role="alert">{error}</div>}
            {message && <div className="auth-feedback auth-feedback--success" role="status">{message}{receivedOtpHint && <strong> Mã thử nghiệm: {receivedOtpHint}</strong>}</div>}

            <button id={authMethod === 'phone' && !otpSent ? 'phone-otp-button' : undefined} className="auth-primary-button" type="submit" disabled={loading || (authMethod === 'phone' && otpSent && otpCode.length !== 6)}>
              {loadingAction === 'form' ? <LoaderCircle className="auth-spin" size={21} /> : <><span>{authMethod === 'phone' ? (otpSent ? 'Xác minh và tiếp tục' : 'Nhận mã OTP') : (mode === 'signin' ? 'Đăng nhập' : 'Tạo tài khoản')}</span><ArrowRight size={20} /></>}
            </button>
          </form>
        )}

        <footer className="auth-entry__footer">
          <div className="auth-account-switch">
            <span />
            <p>{mode === 'signin' ? 'Chưa có tài khoản?' : 'Đã có tài khoản?'}</p>
            <span />
          </div>
          <button type="button" onClick={() => changeMode(mode === 'signin' ? 'signup' : 'signin')}>
            {mode === 'signin' ? 'Tạo tài khoản' : 'Đăng nhập'} <ArrowRight size={19} />
          </button>
          <p className="auth-legal">Bằng cách tiếp tục, bạn đồng ý với <button type="button">Điều khoản sử dụng</button> và <button type="button">Chính sách quyền riêng tư</button>.</p>
        </footer>
      </section>

    </main>
  )
}
